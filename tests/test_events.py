"""Earnings reactions, dividends, macro calendar and the earnings-result alert (Phase 2G)."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from src import alerts, events


def closes(values, start="2026-11-02"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


# ------------------------------------------------------------------ timing


@pytest.mark.parametrize(
    "ts,us,expected",
    [
        ("2026-11-17 16:00-05:00", True, ("2026-11-17", "amc")),  # NVDA after the close
        ("2026-10-14 01:00-04:00", False, ("2026-10-14", "bmo")),  # ASML 07:00 Brussels
        ("2026-07-13 20:00-04:00", False, ("2026-07-14", "bmo")),  # 02:00 Brussels next day
        ("2027-01-27 11:00-05:00", False, ("2027-01-27", "amc")),  # 17:00? no: 17:00 < 17:30
    ],
)
def test_report_timing(ts, us, expected):
    d, hour = events.report_timing(pd.Timestamp(ts), us)
    if ts.startswith("2027-01-27"):
        # 11:00 New York = 17:00 Brussels: during the EU session → same day, no hour
        assert (d.isoformat(), hour) == ("2027-01-27", None)
    else:
        assert (d.isoformat(), hour) == expected


def test_reaction_day_after_close_is_next_trading_day():
    idx = pd.bdate_range("2026-11-16", periods=5)  # Mon..Fri
    assert idx[events.reaction_index(idx, date(2026, 11, 17), "amc")].day == 18
    assert idx[events.reaction_index(idx, date(2026, 11, 17), "bmo")].day == 17
    # Friday after the close → Monday (not in this index) → None
    assert events.reaction_index(idx, date(2026, 11, 20), "amc") is None


# ------------------------------------------------------------------ reactions


def test_earnings_reactions_hand_checked():
    # Mon 2 Nov .. : 100, 100, 110 (Wed), 112, 105, 106, 108, 120
    c = closes([100, 100, 110, 112, 105, 106, 108, 120])
    reports = [
        {"date": "2026-11-03", "hour": "amc", "eps_est": 1.0, "eps_actual": 1.2},  # react Wed
        {"date": "2026-11-12", "hour": None, "eps_est": 2.0, "eps_actual": None},  # future
    ]
    out = events.earnings_reactions(reports, c)
    r = out["reports"][0]
    assert r["reaction_date"] == "2026-11-04"
    assert r["move_1d"] == 10.0  # 110 / 100
    assert r["move_5d"] == 8.0  # 4 trading days after Wed = Tue 10 Nov: 108 / 100
    assert r["beat"] is True and r["surprise_pct"] == 20.0
    assert out["avg_abs_move"] == 10.0 and out["beats"] == 1 and out["n"] == 1


def test_earnings_reactions_miss_and_limit():
    c = closes(list(range(100, 140)))
    reports = [
        {"date": f"2026-11-{d:02d}", "hour": "bmo", "eps_est": 1.0, "eps_actual": 0.9}
        for d in (3, 4, 5, 6, 9, 10, 11, 12, 13, 16)
    ]
    out = events.earnings_reactions(reports, c, limit=8)
    assert out["n"] == 8 and out["reports"][0]["date"] == "2026-11-16"
    assert out["reports"][0]["beat"] is False and out["beats"] == 0


def test_yahoo_rows_and_next():
    df = pd.DataFrame(
        {"EPS Estimate": [2.88, 2.47], "Reported EPS": [float("nan"), 2.68]},
        index=pd.DatetimeIndex(
            [pd.Timestamp("2027-02-24 16:00-05:00"), pd.Timestamp("2026-11-17 16:00-05:00")]
        ),
    )
    rows = events.yahoo_earnings_rows(df, us=True)
    assert rows[1] == {"date": "2026-11-17", "hour": "amc", "eps_est": 2.47, "eps_actual": 2.68}
    nxt = events.next_from_rows(rows, date(2026, 11, 22))
    assert nxt["date"] == "2027-02-24" and nxt["hour"] == "amc" and nxt["eps_est"] == 2.88


# ------------------------------------------------------------------ dividends


def quarterly(last="2026-11-12", n=8, amount=0.27):
    idx = pd.date_range(end=last, periods=n, freq="91D")
    return pd.Series([amount] * n, index=idx)


def test_next_dividend_from_calendar():
    cal = {"Ex-Dividend Date": date(2026, 12, 1), "Dividend Date": date(2026, 12, 15)}
    d = events.next_dividend(cal, quarterly(), date(2026, 11, 22), "USD")
    assert d["ex_date"] == "2026-12-01" and d["pay_date"] == "2026-12-15"
    assert d["estimated"] is False and d["amount"] == 0.27 and d["per_year"] == 4


def test_next_dividend_estimated_from_gap():
    cal = {"Ex-Dividend Date": date(2026, 11, 12)}  # already past
    d = events.next_dividend(cal, quarterly(), date(2026, 11, 22), "USD")
    assert d["estimated"] is True and d["ex_date"] == "2027-02-11"  # 12 Nov + 91 days


def test_next_dividend_none_without_history():
    assert events.next_dividend({}, pd.Series(dtype=float), date(2026, 11, 22)) is None


# ------------------------------------------------------------------ macro + alert


def test_macro_events_window(tmp_path):
    p = tmp_path / "m.yaml"
    p.write_text(
        "events:\n  fomc:\n    time: '14:00'\n    tz: America/New_York\n    tentative: true\n"
        "    dates: [2026-11-01, 2026-12-09, 2027-06-09]\n"
    )
    out = events.macro_events(date(2026, 11, 22), days=120, path=p)
    assert [e["date"] for e in out] == ["2026-12-09"] and out[0]["tentative"] is True


def test_macro_config_parses_and_is_sorted():
    out = events.macro_events(date(2026, 11, 22), days=400)
    assert out and out == sorted(out, key=lambda e: e["date"])
    assert {e["kind"] for e in out} == {"fomc", "ecb"}


def test_earnings_result_alert():
    hist = {
        "reports": [
            {
                "date": "2026-11-17",
                "reaction_date": "2026-11-18",
                "eps_est": 2.47,
                "eps_actual": 2.68,
                "beat": True,
                "move_1d": -3.1,
            }
        ]
    }
    due = events.earnings_result_due(hist, "2026-11-18")
    assert due and events.earnings_result_due(hist, "2026-11-19") is None
    row = {
        "user_id": "u",
        "symbol": "NVDA",
        "score": 2,
        "max_score": 6,
        "label": "watch",
        "signals": [],
        "earnings_result": due,
        "price": 180.0,
        "currency": "USD",
        "today": "2026-11-18",
    }
    cfg = {"app_url": "https://x", "kinds": {"earnings_result": {"enabled": True}}}
    out = [a for a in alerts.evaluate([row], cfg, 4, {}) if a.kind == "earnings_result"]
    assert len(out) == 1
    assert "EPS 2,68 vs 2,47 expected (beat)" in out[0].body and "−3,1" in out[0].body


def test_dividend_summary_quarterly_payer():
    from src.events import dividend_summary

    idx = pd.to_datetime(
        [
            "2025-02-10",
            "2025-05-10",
            "2025-08-10",
            "2025-11-10",
            "2026-02-10",
            "2026-05-10",
            "2026-08-10",
            "2026-11-10",
        ]
    )
    h = pd.Series([0.20, 0.20, 0.20, 0.20, 0.25, 0.25, 0.25, 0.25], index=idx)
    d = dividend_summary(h, 50.0, date(2026, 11, 22), "USD")
    assert d["ttm"] == pytest.approx(1.0) and d["per_year"] == 4
    assert d["yield_pct"] == pytest.approx(2.0)
    assert d["growth_pct"] == pytest.approx(25.0)
    assert d["history"][-1] == ["2026-11-10", 0.25]
    assert all(x[0] > "2025-08" for x in d["history"])  # last 15 months only


def test_dividend_summary_stopped_paying():
    from src.events import dividend_summary

    h = pd.Series([0.5], index=pd.to_datetime(["2024-03-01"]))
    assert dividend_summary(h, 10.0, date(2026, 11, 22), "EUR") is None
    assert dividend_summary(None, 10.0, date(2026, 11, 22), "EUR") is None

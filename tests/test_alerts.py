"""Alert rules (CLAUDE.md 7.1, 7.2): pure functions, no Telegram calls."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import yaml

from src import alerts as al

CFG = yaml.safe_load((Path(__file__).parents[1] / "config" / "alerts.yaml").read_text())
SIG = [
    {"code": "T1", "passed": True},
    {"code": "T2", "passed": True},
    {"code": "T3", "passed": False},
    {"code": "S1", "passed": True},
]


def row(**kw):
    base = {
        "user_id": "u1",
        "symbol": "NVDA",
        "price": 125.53,
        "prev_close": 127.0,
        "currency": "USD",
        "change_pct": -1.2,
        "score": 3,
        "max_score": 4,
        "label": "watch",
        "prev_score": 3,
        "buy_below": None,
        "signals": SIG,
        "zones": [],
        "error": None,
    }
    return {**base, **kw}


def kinds(alerts):
    return sorted(a.kind for a in alerts)


def test_formatting_belgian():
    assert al.money(1234.5, "EUR") == "€ 1.234,50"
    assert al.money(125.53, "USD") == "$ 125,53"
    assert al.pct(-6.2) == "−6,2 %"
    assert al.pct(2.34, sign=True) == "+2,3 %"


def test_score_cross_only_when_crossing_up():
    assert kinds(al.evaluate([row(score=4, prev_score=3, label="strong")], CFG, 4)) == [
        "score_cross"
    ]
    assert al.evaluate([row(score=4, prev_score=4, label="strong")], CFG, 4) == []  # already there
    assert al.evaluate([row(score=3, prev_score=4)], CFG, 4) == []  # going down
    msg = al.format_message(al.evaluate([row(score=4, prev_score=2, label="strong")], CFG, 4)[0])
    assert "NVDA: 4/4 bottom signals" in msg
    assert (
        "Price is near its 4-year average, RSI is oversold and the whole market is fearful." in msg
    )
    assert "not a buy signal" in msg
    assert msg.endswith("/#/ticker/NVDA")


def test_buy_level_drop_rise():
    a = al.evaluate([row(buy_below=130.0)], CFG, 4)
    assert kinds(a) == ["buy_level"] and "$ 125,53 ≤ your level $ 130,00" in a[0].body
    assert kinds(al.evaluate([row(change_pct=-6.2)], CFG, 4)) == ["drop"]
    assert al.evaluate([row(change_pct=-4.9)], CFG, 4) == []
    assert al.evaluate([row(change_pct=+7)], CFG, 4) == []  # rise is off by default


def test_support_test_and_break():
    z = {
        "role": "support",
        "tfs": ["M", "W"],
        "touches": 3,
        "low": 122.0,
        "high": 124.0,
        "distance_pct": -1.2,
        "years": [2022, 2023, 2024],
        "lows": 3,
        "highs": 0,
    }
    a = al.evaluate([row(zones=[z])], CFG, 4)
    assert kinds(a) == ["support_test"] and "testing support $ 122,00–$ 124,00" in a[0].title
    assert "3 previous bottoms (2022, 2023, 2024)" in a[0].body
    # daily-only or single-touch zones don't alert
    assert al.evaluate([row(zones=[{**z, "tfs": ["D"]}])], CFG, 4) == []
    assert al.evaluate([row(zones=[{**z, "touches": 1}])], CFG, 4) == []
    # break: previous close above the zone low, now below
    zb = {**z, "low": 126.0, "high": 128.0, "distance_pct": 0.4}
    a = al.evaluate([row(prev_close=127.0, price=125.0, zones=[zb])], CFG, 4)
    assert "support_break" in kinds(a)


def test_unscored_rows_never_alert_but_data_problem_does():
    assert al.evaluate([row(error="no price data", price=None)], CFG, 4) == []
    assert al.evaluate([row(change_pct=-9, suspect=True)], CFG, 4) == []  # suspect data: no alerts
    a = al.evaluate([], CFG, 4, {"user_id": "u1", "suspect": 1, "errors": 0, "failed": False})
    assert kinds(a) == ["data_problem"] and "1 stock with suspect prices" in a[0].title
    assert (
        al.evaluate([], CFG, 4, {"user_id": "u1", "suspect": 0, "errors": 0, "failed": False}) == []
    )


def test_dedupe_once_per_ticker_kind_per_day():
    a = al.evaluate([row(change_pct=-6, buy_below=130.0)], CFG, 4)
    assert kinds(al.dedupe(a, {("u1", "NVDA", "drop")})) == ["buy_level"]
    assert kinds(al.dedupe(a + a, set())) == ["buy_level", "drop"]


def test_quiet_hours_off_by_owner_decision_but_works_when_on():
    night = datetime(2026, 11, 22, 23, 30, tzinfo=timezone.utc)  # 00:30 Brussels
    a = al.evaluate(
        [row(change_pct=-6), row(symbol="X", score=6, prev_score=3, label="extreme")], CFG, 4
    )
    assert al.apply_quiet_hours(a, night, CFG) == a  # disabled → everything passes
    on = {**CFG, "quiet_hours": {**CFG["quiet_hours"], "enabled": True}}
    kept = al.apply_quiet_hours(a, night, on)
    assert [(x.symbol, x.kind) for x in kept] == [("X", "score_cross")]
    noon = datetime(2026, 11, 22, 11, 0, tzinfo=timezone.utc)
    assert al.apply_quiet_hours(a, noon, on) == a


def test_brussels_day_rolls_at_local_midnight():
    assert al.brussels_day(datetime(2026, 11, 22, 23, 30, tzinfo=timezone.utc)) == "2026-11-23"


# ---------------------------------------------------------------- full flow in the daily job


class FakeStore:
    def __init__(self):
        self.tables = {"alerts_log": [], "alert_state": []}

    def load_alert_state(self, day):
        return {
            (r["user_id"], r["symbol"], r["kind"])
            for r in self.tables["alert_state"]
            if r["day"] == day
        }

    def insert(self, table, rows):
        self.tables[table] += rows
        return True

    def upsert(self, table, rows, on_conflict):
        self.tables[table] += rows
        return True


def test_send_alerts_second_run_same_day_sends_nothing(monkeypatch):
    from src import run_daily

    sent = []
    monkeypatch.setattr(al, "telegram_configured", lambda: True)
    monkeypatch.setattr(al, "send_telegram", lambda text, **kw: sent.append(text) or True)
    store = FakeStore()
    watchlist = [{"user_id": "u1", "symbol": "NVDA", "buy_below": 130.0}]
    scored = {
        k: v for k, v in row(score=4, label="strong", change_pct=-6.2).items() if k != "error"
    }
    results = {
        "NVDA": {
            **scored,
            "weekly": {"levels": {"zones": []}},
        }
    }
    cfg = {"alert_threshold": 4}

    first = run_daily.send_alerts(
        store, watchlist, results, {("u1", "NVDA"): 2}, cfg, writes_ok=True
    )
    assert first == (3, 0)  # score_cross + buy_level + drop
    assert len(store.tables["alerts_log"]) == 3 and all(
        r["delivered"] for r in store.tables["alerts_log"]
    )

    second = run_daily.send_alerts(
        store, watchlist, results, {("u1", "NVDA"): 2}, cfg, writes_ok=True
    )
    assert second == (0, 0) and len(sent) == 3


def test_send_alerts_failed_delivery_is_retried(monkeypatch):
    from src import run_daily

    monkeypatch.setattr(al, "telegram_configured", lambda: True)
    monkeypatch.setattr(al, "send_telegram", lambda text, **kw: False)
    store = FakeStore()
    watchlist = [{"user_id": "u1", "symbol": "NVDA", "buy_below": None}]
    scored = {k: v for k, v in row(change_pct=-6.2).items() if k != "error"}
    results = {"NVDA": {**scored, "weekly": {"levels": {"zones": []}}}}
    assert run_daily.send_alerts(
        store, watchlist, results, {}, {"alert_threshold": 4}, writes_ok=True
    ) == (0, 1)
    assert store.tables["alert_state"] == []  # not marked as sent → next run tries again
    assert store.tables["alerts_log"][0]["delivered"] is False


def test_drop_names_the_trading_day_when_not_today():
    weekend = al.evaluate([row(change_pct=-9.3, as_of="2026-11-20", today="2026-11-22")], CFG, 4)
    assert "NVDA \u22129,3\u202f% on Fri 20 Nov" in weekend[0].title
    same_day = al.evaluate([row(change_pct=-9.3, as_of="2026-11-20", today="2026-11-20")], CFG, 4)
    assert "% today" in same_day[0].title


def test_earnings_reminders_week_ahead_and_day_before():
    # Fri 20 Nov → earnings Fri 27 Nov is 5 trading days ahead; Thu 26 Nov → 1 trading day
    ne = {"date": "2026-11-27", "hour": "amc"}
    a = al.evaluate([row(next_earnings=ne, today="2026-11-20")], CFG, 4)
    assert kinds(a) == ["earnings_7d"] and "Fri 27 Nov after the close" in a[0].body
    assert kinds(al.evaluate([row(next_earnings=ne, today="2026-11-26")], CFG, 4)) == [
        "earnings_1d"
    ]
    assert (
        al.evaluate([row(next_earnings=ne, today="2026-11-23")], CFG, 4) == []
    )  # in between: nothing
    # earnings on Monday: the reminder comes on the Friday before (the last run before it)
    mon = {"date": "2026-11-30"}
    assert kinds(al.evaluate([row(next_earnings=mon, today="2026-11-27")], CFG, 4)) == [
        "earnings_1d"
    ]


def test_drop_alert_includes_recent_headline():
    h = {"headline": "Chipmaker cuts guidance", "source": "Reuters"}
    a = al.evaluate([row(change_pct=-7, headline=h)], CFG, 4)
    assert "News: Chipmaker cuts guidance (Reuters)" in a[0].body

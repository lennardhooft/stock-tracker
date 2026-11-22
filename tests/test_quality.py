"""Quality Score, moat, verdict and Top Score (Phase 2E) with hand-checked numbers."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src import quality as q
from src import top_score as top


def year(**kw):
    base = {
        "year": "2025-12-31",
        "revenue": 1000.0,
        "gross_profit": 500.0,
        "operating_income": 200.0,
        "net_income": 150.0,
        "ebit": 200.0,
        "ebitda": 250.0,
        "interest_expense": 10.0,
        "tax_rate": 0.25,
        "shares": 100.0,
        "total_assets": 2000.0,
        "current_assets": 800.0,
        "current_liabilities": 400.0,
        "total_liabilities": 1000.0,
        "long_term_debt": 300.0,
        "total_debt": 400.0,
        "cash": 200.0,
        "equity": 1000.0,
        "retained_earnings": 600.0,
        "working_capital": 400.0,
        "ocf": 220.0,
        "fcf": 180.0,
    }
    base.update(kw)
    return base


def healthy_years(n=4):
    """Growing 10 %/yr, falling share count, steady margins (newest first)."""
    out = []
    for i in range(n):
        f = 1.1**-i
        out.append(
            year(
                year=f"{2025 - i}-12-31",
                revenue=1000 * f,
                gross_profit=500 * f * (1 - 0.01 * i),  # margin creeping up
                operating_income=200 * f,
                net_income=150 * f,
                ebit=200 * f,
                ebitda=250 * f,
                ocf=220 * f,
                fcf=180 * f,
                shares=100 * (1.01**i),
                total_assets=2000 * (1 + 0.02 * i),  # turnover improving
                current_assets=800,
                current_liabilities=400 + 10 * i,
                long_term_debt=300 + 10 * i,
            )
        )
    return out


# ------------------------------------------------------------------ parts


def test_lin_both_directions():
    assert q.lin(2.4, 1.8, 3.0) == pytest.approx(0.5)
    assert q.lin(2.5, 4.0, 1.0) == pytest.approx(0.5)  # lower is better
    assert q.lin(10, 0, 1) == 1.0 and q.lin(-1, 0, 1) == 0.0


def test_piotroski_all_nine_pass():
    p = q.piotroski(healthy_years(2))
    assert p["value"]["f"] == 9 and p["value"]["n"] == 9 and p["score"] == 1.0


def test_piotroski_needs_two_years():
    assert q.piotroski([year()])["na"] == "need_2_years"


def test_altman_hand_checked():
    # 1.2*400/2000 + 1.4*600/2000 + 3.3*200/2000 + 0.6*1500/1000 + 1.0*1000/2000
    # = 0.24 + 0.42 + 0.33 + 0.90 + 0.50 = 2.39 → grey zone, (2.39-1.8)/1.2 = 0.4917
    p = q.altman(year(), 1500.0, financial=False)
    assert p["value"]["z"] == 2.39 and p["value"]["zone"] == "grey"
    assert p["score"] == pytest.approx(0.492, abs=1e-3)


def test_altman_not_for_banks():
    assert q.altman(year(), 1500.0, financial=True)["na"] == "financial"


def test_debt_hand_checked():
    # net debt 200 / EBITDA 250 = 0.8 → 1.0 ; coverage 200/10 = 20 → 1.0
    p = q.debt(year(), financial=False)
    assert p["value"]["nd_ebitda"] == 0.8 and p["value"]["coverage"] == 20.0 and p["score"] == 1.0
    # net debt 1000-0 / 250 = 4 → 0 ; coverage 200/100 = 2 → (2-1.5)/6.5
    p = q.debt(year(total_debt=1000.0, cash=0.0, interest_expense=100.0), financial=False)
    assert p["score"] == pytest.approx((0 + 0.5 / 6.5) / 2, abs=1e-3)


def test_debt_net_cash_is_good():
    p = q.debt(year(total_debt=0.0, cash=500.0, interest_expense=None), financial=False)
    assert p["value"]["net_cash"] is True and p["score"] == 1.0


def test_fcf_share_positive():
    ys = [year(fcf=v) for v in (10, -5, 20, 30)]
    assert q.fcf(ys)["score"] == 0.75
    assert q.fcf(ys[:2])["na"] == "need_3_years"
    assert q.fcf(ys, financial=True)["na"] == "financial"


def test_growth_cagr_and_shrinking():
    ys = [year(revenue=r) for r in (1331, 1210, 1100, 1000)]  # +10 %/yr
    g = q.growth(ys)
    assert g["value"]["cagr"] == pytest.approx(0.10, abs=1e-4) and g["score"] == pytest.approx(1.0)
    ys = [year(revenue=r) for r in (900, 1000)]
    g = q.growth(ys)
    assert g["value"]["shrinking"] is True and g["score"] == pytest.approx(lin(-0.10, -0.05, 0.10))


def lin(x, a, b):
    return q.lin(x, a, b)


def test_margins_vs_own_average_and_losses_capped():
    ys = [year(operating_income=o) for o in (150, 200, 200)]  # 15 % vs 20 % avg → −5 pts → 0
    assert q.margins(ys)["score"] == 0.0
    ys = [year(operating_income=o) for o in (-10, -50, -50)]  # improving but negative → max 0.5
    assert q.margins(ys)["score"] == 0.5


def test_dilution():
    ys = [year(shares=s) for s in (110.25, 105, 100)]  # +5 %/yr → 0
    assert q.dilution(ys)["score"] == pytest.approx(0.0, abs=1e-6)
    ys = [year(shares=s) for s in (95, 100)]  # buyback → 1
    assert q.dilution(ys)["score"] == 1.0


def test_roic_by_year_hand_checked():
    # 200 × (1 − 0.25) / (400 + 1000 − 200) = 150 / 1200 = 0.125
    r = q.roic_by_year([year()])[0]
    assert r["roic"] == pytest.approx(0.125) and r["gross_margin"] == 0.5


def test_moat_wide_narrow_none():
    rows = [{"roic": v, "gross_margin": 0.5} for v in (0.25, 0.24, 0.26, 0.25)]
    assert q.moat(rows)["moat"] == "wide"
    rows = [{"roic": v, "gross_margin": g} for v, g in ((0.12, 0.5), (0.10, 0.4), (0.11, 0.55))]
    assert (
        q.moat(rows)["moat"] == "narrow"
    )  # beats WACC + steady ROIC, but avg < 15 %, margin unstable
    rows = [{"roic": v, "gross_margin": g} for v, g in ((0.02, 0.5), (0.20, 0.3), (-0.05, 0.6))]
    assert q.moat(rows)["moat"] == "none"
    assert q.moat(rows[:2])["na"] == "need_3_years"
    # steady but below the cost of capital: stability alone is no moat
    rows = [{"roic": v, "gross_margin": 0.3} for v in (0.03, 0.04, 0.035)]
    assert q.moat(rows)["moat"] == "none"


def test_banks_use_roe():
    ys = [year(net_income=120.0, equity=1000.0) for _ in range(3)]
    m = q.moat(q.roic_by_year(ys), financial=True)
    assert m["value"]["metric"] == "roe" and m["score"] == pytest.approx(0.7) and m["moat"] is None


# ------------------------------------------------------------------ combine + verdict


def test_build_quality_healthy_is_high():
    out = q.build_quality(healthy_years(), market_cap=5000.0, financial=False)
    assert out["label"] == "high" and out["score"] >= 70 and out["n_parts"] == 8


def test_build_quality_weights_debt_and_roic():
    out = q.build_quality(healthy_years(), market_cap=5000.0, financial=False)
    w = {p["key"]: p["weight"] for p in out["parts"]}
    assert w["debt"] == 1.5 and w["roic"] == 1.5 and w["growth"] == 1.0


def test_build_quality_too_few_parts():
    out = q.build_quality([year()], market_cap=None, financial=True)
    assert out["score"] is None and out["na"] == "too_few_parts"


def test_build_quality_no_reports():
    assert q.build_quality([], market_cap=None, financial=False)["na"] == "no_reports"


@pytest.mark.parametrize(
    "bottom,label,expected",
    [
        (5, "high", "sale"),
        (4, "medium", "check"),
        (4, "low", "trap"),
        (4, None, "check"),  # no quality data → check fundamentals
        (3, "high", "none"),
        (None, "high", None),
    ],
)
def test_verdict_table(bottom, label, expected):
    assert q.verdict(bottom, {"label": label}) == expected


def test_summary_names_weakest_parts():
    quality = {
        "score": 30,
        "label": "low",
        "moat": "none",
        "na": None,
        "parts": [
            {"key": "debt", "score": 0.1},
            {"key": "growth", "score": 0.0},
            {"key": "fcf", "score": 0.9},
            {"key": "altman", "score": None},
        ],
    }
    assert q.summary(quality)["weak"] == ["growth", "debt"]


def test_years_from_frames_merges_and_orders():
    cols = [pd.Timestamp("2024-12-31"), pd.Timestamp("2025-12-31")]
    inc = pd.DataFrame(
        {cols[0]: [100.0, 40.0], cols[1]: [120.0, 50.0]}, index=["Total Revenue", "Gross Profit"]
    )
    bal = pd.DataFrame({cols[0]: [500.0], cols[1]: [np.nan]}, index=["Total Assets"])
    ys = q.years_from_frames(inc, bal, None)
    assert [y["year"] for y in ys] == ["2025-12-31", "2024-12-31"]
    assert (
        ys[0]["revenue"] == 120.0 and "total_assets" not in ys[0] and ys[1]["total_assets"] == 500.0
    )


# ------------------------------------------------------------------ Top Score


def weekly_up(n=260, end=3.0):
    idx = pd.date_range("2020-01-03", periods=n, freq="W-FRI")
    return pd.Series(np.linspace(1.0, end, n) * 100, index=idx)


def test_top_far_above_trend_and_rsi():
    w = weekly_up()
    u1 = top.top_far_above_trend(w, {"weeks": 200, "multiple": 1.8})
    # line 100→300 over 260 weeks: mean of points 60..259 = 100 + 159.5·200/259 = 223.2 → 1.344
    assert u1["passed"] is False and u1["value"]["ratio"] == pytest.approx(1.344, abs=0.001)
    u2 = top.top_weekly_rsi(w, {"period": 14, "above": 70})
    assert u2["passed"] is True  # straight line up → RSI 100


def test_top_expensive_and_insiders():
    fund = {
        "valuation": {"pct": 95, "years": 8, "metric": "pe", "now": 40},
        "insiders": {"net_value": -6e6, "days": 90},
    }
    assert top.top_expensive(fund, {"above_percentile": 90})["passed"] is True
    # 6M / 10B = 0.06 % ≥ 0.05 %
    s = top.top_insider_selling(fund, 1e10, {"min_pct_of_mcap": 0.05})
    assert s["passed"] is True and s["value"]["pct_of_mcap"] == pytest.approx(0.06)
    assert top.top_insider_selling(fund, 1e11, {"min_pct_of_mcap": 0.05})["passed"] is False
    assert (
        top.top_insider_selling({"insiders": None, "insiders_na": "eu"}, 1e10, {})["passed"] is None
    )


def test_top_near_resistance_uses_major_ceilings_only():
    zones = [
        {
            "role": "resistance",
            "tfs": ["W"],
            "distance_pct": 1.0,
            "low": 1,
            "high": 2,
            "touches": 2,
        },
        {
            "role": "resistance",
            "tfs": ["M"],
            "distance_pct": 2.5,
            "low": 1,
            "high": 2,
            "touches": 3,
        },
    ]
    s = top.top_near_resistance({"zones": zones}, {"within_pct": 3})
    assert s["passed"] is True and s["value"]["distance_pct"] == 2.5


def test_compute_top_labels():
    w = weekly_up()
    daily = w.resample("D").ffill()
    out = top.compute_top(
        daily,
        {"fear_greed": {"value": 80}},
        {"top_signals": {}},
        fundamentals={"valuation": {"pct": 95, "years": 8, "metric": "pe", "now": 40}},
    )
    assert out["score"] >= 3 and out["label"] in {"hot", "trim"} and out["max_score"] == 6
    assert top.top_label(1) == "normal" and top.top_label(2) == "hot" and top.top_label(4) == "trim"


def test_weekly_top_history_marks_hot_weeks():
    w = weekly_up(n=300, end=4.0)
    daily = w.resample("D").ffill()
    h = top.weekly_top_history(daily, {"top_signals": {}})
    assert h.iloc[:14].isna().all()  # RSI(14) needs 14 weeks first; U1 needs 200
    assert h.iloc[-1] == 1  # straight line up: RSI 100 fires (U2); 4x over 300 weeks < 1.8x SMA

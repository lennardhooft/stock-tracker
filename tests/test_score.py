from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from src import score as sc

CFG = yaml.safe_load((Path(__file__).parents[1] / "config" / "scoring.yaml").read_text())


def _daily(values, start="2010-01-01"):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="B"), dtype=float)


def test_t1_needs_200_weeks():
    s = sc.signal_near_200w_ma(pd.Series([1.0] * 50), CFG["signals"]["near_200w_ma"])
    assert s["passed"] is None and "200 weeks" in s["detail"]


def test_t1_passes_near_ma_and_fails_far_above():
    flat = pd.Series([100.0] * 200)
    cfg = CFG["signals"]["near_200w_ma"]
    assert sc.signal_near_200w_ma(flat, cfg)["passed"] is True  # 100 <= 100*1.05
    above = pd.Series([100.0] * 199 + [200.0])  # sma = 100.5, limit 105.5
    assert sc.signal_near_200w_ma(above, cfg)["passed"] is False


def test_t2_oversold_on_falling_series():
    falling = pd.Series(np.linspace(200, 100, 40))
    s = sc.signal_weekly_rsi(falling, CFG["signals"]["weekly_rsi"])
    assert s["passed"] is True and s["value"] < 30


def test_t3_drawdown_threshold_exact():
    cfg = CFG["signals"]["drawdown"]
    assert sc.signal_drawdown(_daily([100] * 30 + [70]), cfg)["passed"] is True  # exactly -30%
    assert sc.signal_drawdown(_daily([100] * 30 + [71]), cfg)["passed"] is False  # -29%
    assert sc.signal_drawdown(_daily([100] * 5), cfg)["passed"] is None


def test_s1_market_fear_either_condition():
    cfg = CFG["signals"]["market_fear"]
    assert sc.signal_market_fear({"vix": {"value": 31}}, cfg)["passed"] is True
    assert (
        sc.signal_market_fear({"vix": {"value": 15}, "fear_greed": {"value": 20}}, cfg)["passed"]
        is True
    )
    assert (
        sc.signal_market_fear({"vix": {"value": 15}, "fear_greed": {"value": 60}}, cfg)["passed"]
        is False
    )
    assert sc.signal_market_fear({}, cfg)["passed"] is None


def test_build_score_counts_na_separately():
    sigs = [
        {"passed": True, "weight": 1},
        {"passed": False, "weight": 1},
        {"passed": None, "weight": 1},
        {"passed": True, "weight": 1},
    ]
    out = sc.build_score(sigs, CFG)
    assert out["score"] == 2 and out["max_score"] == 4 and out["n_na"] == 1
    assert out["label"]["key"] == "watch"


@pytest.mark.parametrize(
    "score,key",
    [
        (0, "normal"),
        (1, "normal"),
        (2, "watch"),
        (3, "watch"),
        (4, "strong"),
        (5, "strong"),
        (6, "extreme"),
    ],
)
def test_labels_match_plan_table(score, key):
    assert sc.score_label(score, CFG)["key"] == key


def test_compute_signals_full_pipeline_crash_scenario():
    # 5 years flat at 100, then a slide to 55: should fire T1, T2, T3 (+ S1 with VIX 35)
    values = [100.0] * (252 * 5) + list(np.linspace(100, 55, 120))
    sigs = sc.compute_signals(_daily(values), {"vix": {"value": 35}}, CFG)
    assert [s["code"] for s in sigs] == ["T1", "T2", "T3", "V1", "V2", "S1"]
    price_sigs = [s for s in sigs if s["code"] in ("T1", "T2", "T3", "S1")]
    assert all(s["passed"] is True for s in price_sigs)
    total = sc.build_score(sigs, CFG)
    # no fundamentals given → V1/V2 are n/a, not 0 (6.7): "4/6 (2 n/a)"
    assert (total["score"], total["max_score"], total["n_na"]) == (4, 6, 2)


def test_weekly_score_history_crash_reaches_4():
    values = [100.0] * (252 * 5) + list(np.linspace(100, 55, 120))
    daily = _daily(values)
    vix = pd.Series([35.0] * len(daily), index=daily.index)
    hist = sc.weekly_score_history(daily, vix, CFG)
    assert hist.iloc[-1] == 4
    # flat period after 200 weeks: T1 (price at its average) + S1 (VIX 35) fire, T2/T3 don't
    assert len(hist) > 250 and hist.iloc[250] == 2


def test_weekly_score_history_no_vix_and_short_history():
    daily = _daily([100.0] * 60)
    hist = sc.weekly_score_history(daily, None, CFG)
    # no 200 weeks, RSI flat = 50 → only T3 (0) and T2 (0) computable
    assert hist.dropna().max() == 0


def test_t4_near_major_bottom():
    cfg = {"within_pct": 5, "min_touches": 2}
    lv = {
        "zones": [
            {
                "role": "support",
                "tfs": ["M", "W"],
                "touches": 3,
                "low": 95,
                "high": 97,
                "distance_pct": -3.0,
                "years": [2020, 2022],
            }
        ]
    }
    assert sc.signal_near_major_bottom(100, lv, cfg)["passed"] is True
    lv["zones"][0]["distance_pct"] = -9.0
    assert sc.signal_near_major_bottom(100, lv, cfg)["passed"] is False
    assert sc.signal_near_major_bottom(100, None, cfg)["passed"] is None


def test_v1_valuation_signal():
    cfg = CFG["signals"]["valuation_pct"]
    cheap = {
        "valuation": {
            "metric": "pe",
            "now": 15,
            "pct": 10.0,
            "min": 14,
            "max": 40,
            "n": 10,
            "years": 9.9,
        }
    }
    assert sc.signal_valuation(cheap, cfg)["passed"] is True
    pricey = {"valuation": {**cheap["valuation"], "pct": 60.0}}
    assert sc.signal_valuation(pricey, cfg)["passed"] is False
    short = {"valuation": {**cheap["valuation"], "years": 2.0}}
    assert sc.signal_valuation(short, cfg)["passed"] is None
    assert sc.signal_valuation(None, cfg)["passed"] is None


def test_v2_insider_signal():
    cfg = CFG["signals"]["insider_buying"]
    ins = {
        "net_value": 5000,
        "buy_value": 7000,
        "sell_value": 2000,
        "buys": 2,
        "sells": 1,
        "days": 90,
    }
    assert sc.signal_insider({"insiders": ins}, cfg)["passed"] is True
    assert sc.signal_insider({"insiders": {**ins, "net_value": -1}}, cfg)["passed"] is False
    eu = sc.signal_insider({"insiders": None, "insiders_na": "eu"}, cfg)
    assert eu["passed"] is None and "EU" in eu["detail"]

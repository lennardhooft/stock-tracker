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
    assert [s["code"] for s in sigs] == ["T1", "T2", "T3", "S1"]
    assert all(s["passed"] is True for s in sigs)
    assert sc.build_score(sigs, CFG)["score"] == 4

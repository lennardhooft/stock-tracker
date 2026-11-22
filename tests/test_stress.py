"""Stress test windows and correlation (Phase 3B), hand-checked."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.risk import stress


def weekly(values, start="2007-09-07"):
    return pd.Series(
        values, index=pd.date_range(start, periods=len(values), freq="W-FRI"), dtype=float
    )


def test_window_return_uses_last_close_before_each_date():
    s = pd.Series(
        [100.0, 90.0, 50.0, 60.0],
        index=pd.to_datetime(["2007-10-05", "2008-06-06", "2009-03-06", "2009-06-05"]),
    )
    # start 2007-10-09 → close of 2007-10-05 (100); end 2009-03-09 → 2009-03-06 (50)
    assert stress.window_return(s, "2007-10-09", "2009-03-09") == -0.5


def test_window_return_none_without_history():
    s = pd.Series([100.0, 110.0], index=pd.to_datetime(["2015-01-02", "2015-01-09"]))
    assert stress.window_return(s, "2007-10-09", "2009-03-09") is None


def test_stress_moves_falls_back_to_proxy():
    own = pd.Series([100.0, 70.0], index=pd.to_datetime(["2020-02-14", "2020-03-20"]))
    proxies = {
        "^GSPC": {"gfc": -0.56, "covid": -0.34, "y2022": -0.25},
        "AGG": {"gfc": 0.05, "covid": -0.02, "y2022": -0.14},
    }
    out = stress.stress_moves(own, proxies, "stock")
    assert out["covid"] == -0.3 and out["gfc"] == -0.56 and out["proxy"] == ["gfc", "y2022"]
    assert stress.stress_moves(None, proxies, "bond_etf")["y2022"] == -0.14


def test_correlation_identical_and_opposite():
    rng = np.random.default_rng(1)
    idx = pd.bdate_range("2025-01-01", periods=260)
    a = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.01, 260)), index=idx)
    b = a * 2  # same returns
    r = a.pct_change().fillna(0)
    c = pd.Series(100 * np.cumprod(1 - r.to_numpy()), index=idx)  # opposite returns
    out = stress.correlation({"A": a, "B": b, "C": c})
    m = dict(zip(out["symbols"], out["corr"]))
    assert m["A"][1] == pytest.approx(1.0) and m["A"][2] == pytest.approx(-1.0, abs=0.01)


def test_correlation_needs_two():
    assert stress.correlation({"A": weekly([1, 2, 3])})["corr"] == []

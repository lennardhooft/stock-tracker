"""Indicator tests with hand-checked values (CLAUDE.md 12: tests before use in scoring)."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from src import indicators as ind


def _series(values, start="2024-01-01", freq="B"):
    return pd.Series(
        values, index=pd.date_range(start, periods=len(values), freq=freq), dtype=float
    )


# --- SMA -------------------------------------------------------------------


def test_sma_hand_checked():
    s = _series([1, 2, 3, 4, 5])
    out = ind.sma(s, 3)
    assert math.isnan(out.iloc[0]) and math.isnan(out.iloc[1])
    assert out.iloc[2:].tolist() == [2.0, 3.0, 4.0]


def test_sma_rejects_bad_window():
    with pytest.raises(ValueError):
        ind.sma(_series([1, 2]), 0)


# --- RSI (Wilder) ------------------------------------------------------------


def test_rsi_wilder_hand_checked():
    # closes 1,2,3,2,3,4,5 → changes +1,+1,-1,+1,+1,+1, period 3
    # first avg gain = 2/3, avg loss = 1/3 → RS 2 → RSI 66.667
    # next  (+1): gain (2/3*2+1)/3 = 7/9,  loss (1/3*2)/3 = 2/9  → RS 3.5  → 77.778
    # next  (+1): gain (7/9*2+1)/3 = 23/27, loss (2/9*2)/3 = 4/27 → RS 5.75 → 85.185
    # next  (+1): gain (23/27*2+1)/3 = 73/81, loss 8/81 → RS 9.125 → 90.123
    out = ind.rsi_wilder(_series([1, 2, 3, 2, 3, 4, 5]), period=3)
    assert all(math.isnan(v) for v in out.iloc[:3])
    assert out.iloc[3] == pytest.approx(66.6667, abs=1e-3)
    assert out.iloc[4] == pytest.approx(77.7778, abs=1e-3)
    assert out.iloc[5] == pytest.approx(85.1852, abs=1e-3)
    assert out.iloc[6] == pytest.approx(90.1235, abs=1e-3)


def test_rsi_only_rising_is_100_and_flat_is_50():
    assert ind.rsi_wilder(_series(range(1, 21)), 14).iloc[-1] == 100.0
    assert ind.rsi_wilder(_series([5.0] * 20), 14).iloc[-1] == 50.0


def test_rsi_only_falling_is_0():
    assert ind.rsi_wilder(_series(range(20, 0, -1)), 14).iloc[-1] == pytest.approx(0.0)


def test_rsi_too_short_is_all_nan():
    assert ind.rsi_wilder(_series([1, 2, 3]), 14).isna().all()


def test_rsi_bounded_on_random_data():
    rng = np.random.default_rng(0)
    s = _series(100 + rng.normal(0, 1, 500).cumsum())
    out = ind.rsi_wilder(s, 14).dropna()
    assert ((out >= 0) & (out <= 100)).all()


# --- Weekly resample -----------------------------------------------------------


def test_to_weekly_uses_friday_close_and_partial_week():
    # Mon 2024-01-01 .. Wed 2024-01-10 (8 business days)
    s = _series([1, 2, 3, 4, 5, 6, 7, 8])
    w = ind.to_weekly(s)
    assert list(w.index.strftime("%Y-%m-%d")) == ["2024-01-05", "2024-01-12"]
    assert w.tolist() == [5.0, 8.0]  # Friday close, then latest close of current week


# --- Drawdown / highs ----------------------------------------------------------


def test_drawdown_hand_checked():
    s = _series([100, 120, 90, 84])
    dd = ind.drawdown_pct(s, window=252)
    assert dd.iloc[1] == pytest.approx(0.0)
    assert dd.iloc[2] == pytest.approx(-25.0)
    assert dd.iloc[3] == pytest.approx(-30.0)


def test_drawdown_window_forgets_old_high():
    s = _series([200, 100, 100, 100])
    assert ind.drawdown_pct(s, window=2).iloc[-1] == pytest.approx(0.0)


# --- Percentile ------------------------------------------------------------------


def test_percentile_rank_hand_checked():
    hist = pd.Series([5, 10, 15, 20], dtype=float)
    assert ind.percentile_rank(10, hist) == 50.0
    assert ind.percentile_rank(4, hist) == 0.0
    assert ind.percentile_rank(25, hist) == 100.0


def test_percentile_rank_empty_is_none():
    assert ind.percentile_rank(1.0, pd.Series([], dtype=float)) is None
    assert ind.percentile_rank(float("nan"), pd.Series([1.0])) is None


def test_last_valid():
    assert ind.last_valid(_series([1, 2, np.nan])) == 2.0
    assert ind.last_valid(_series([np.nan])) is None

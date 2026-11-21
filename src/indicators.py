"""Pure indicator functions (CLAUDE.md 6.7).

Every function takes pandas objects and returns a Series or a float. No I/O, no global state.
All functions are unit-tested against hand-checked values in tests/test_indicators.py.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd


def to_weekly(daily_close: pd.Series) -> pd.Series:
    """Resample daily closes to weekly closes, week ending Friday (W-FRI).

    The weekly close is the last available daily close of that week. Weeks without any
    trading day are dropped. The current (unfinished) week uses its latest close.
    """
    if daily_close.empty:
        return daily_close.copy()
    weekly = daily_close.resample("W-FRI").last()
    return weekly.dropna()


def sma(series: pd.Series, window: int) -> pd.Series:
    """Simple moving average. The first window-1 values are NaN."""
    if window <= 0:
        raise ValueError("window must be positive")
    return series.rolling(window=window, min_periods=window).mean()


def rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index with Wilder's smoothing.

    Method (J. Welles Wilder, 1978):
      1. change_t = close_t - close_{t-1}; gain = max(change, 0), loss = max(-change, 0).
      2. The first average gain/loss is the simple mean of the first `period` changes.
      3. After that: avg_t = (avg_{t-1} * (period - 1) + value_t) / period.
      4. RSI = 100 - 100 / (1 + avg_gain / avg_loss). If avg_loss == 0, RSI = 100
         (or 50 when avg_gain is also 0, i.e. a flat series).

    The first `period` values are NaN (not enough data).
    """
    if period <= 0:
        raise ValueError("period must be positive")
    values = close.to_numpy(dtype=float)
    out = np.full(len(values), np.nan)
    if len(values) <= period:
        return pd.Series(out, index=close.index)

    changes = np.diff(values)
    gains = np.clip(changes, 0, None)
    losses = np.clip(-changes, 0, None)

    avg_gain = gains[:period].mean()
    avg_loss = losses[:period].mean()
    out[period] = _rsi_from_averages(avg_gain, avg_loss)

    for i in range(period, len(changes)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = _rsi_from_averages(avg_gain, avg_loss)

    return pd.Series(out, index=close.index)


def _rsi_from_averages(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 50.0 if avg_gain == 0 else 100.0
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


def rolling_high(close: pd.Series, window: int) -> pd.Series:
    """Highest close over the last `window` bars (fewer at the start of the series)."""
    return close.rolling(window=window, min_periods=1).max()


def drawdown_pct(close: pd.Series, window: int) -> pd.Series:
    """Percent below the rolling `window`-bar high, as a negative number (e.g. -32.5)."""
    high = rolling_high(close, window)
    return (close / high - 1.0) * 100.0


def percentile_rank(value: float, history: pd.Series) -> float | None:
    """Percent of `history` values that are <= `value` (0–100). None if no usable history.

    Example: value 10 with history [5, 10, 15, 20] → 2 of 4 values <= 10 → 50.0.
    """
    clean = history.dropna()
    if clean.empty or value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return float((clean <= value).sum() / len(clean) * 100.0)


def last_valid(series: pd.Series) -> float | None:
    """Last non-NaN value of a series as float, or None."""
    clean = series.dropna()
    if clean.empty:
        return None
    return float(clean.iloc[-1])

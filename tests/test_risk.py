"""Per-asset risk numbers (Phase 3A) with hand-checked values."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from src.risk import volatility as v


def series(values):
    return pd.Series(values, index=pd.bdate_range("2025-01-01", periods=len(values)), dtype=float)


def test_annual_vol_alternating_returns():
    # returns alternate +1 % / −1 %: std (sample) ≈ 0.01002 → × √252 ≈ 0.159
    c = [100.0]
    for i in range(300):
        c.append(c[-1] * (1.01 if i % 2 == 0 else 0.99))
    vol = v.annual_vol(series(c))
    r = np.array([0.01, -0.01] * 126)
    assert vol == pytest.approx(r.std(ddof=1) * math.sqrt(252), rel=1e-3)
    assert v.annual_vol(series([100, 101, 102])) is None  # too short


def test_max_drawdown():
    assert v.max_drawdown(series([100, 120, 60, 90] + [90] * 20)) == pytest.approx(0.5)


def test_atr_constant_range():
    df = pd.DataFrame({"High": [11.0] * 30, "Low": [9.0] * 30, "Close": [10.0] * 30})
    assert v.atr(df) == pytest.approx(2.0)


@pytest.mark.parametrize(
    "qt,name,expected",
    [
        ("ETF", "iShares Core MSCI World UCITS ETF", "broad_etf"),
        ("ETF", "Vanguard FTSE All-World UCITS ETF", "broad_etf"),
        ("ETF", "iShares Core Global Aggregate Bond UCITS ETF", "bond_etf"),
        ("ETF", "iShares S&P 500 Information Technology Sector", "sector_etf"),
        ("ETF", "Vanguard S&P 500 UCITS ETF", "broad_etf"),
        ("ETF", "VanEck Semiconductor UCITS ETF", "sector_etf"),
        ("EQUITY", "NVIDIA Corporation", "stock"),
        ("CRYPTOCURRENCY", "Bitcoin USD", "crypto"),
    ],
)
def test_suggested_type(qt, name, expected):
    assert v.suggested_type(qt, name) == expected


def test_region():
    assert v.region_of("Netherlands") == "Europe"
    assert v.region_of("United States") == "North America"
    assert v.region_of("Taiwan") == "Emerging markets"
    assert v.region_of(None) is None

"""Per-asset risk numbers for the sizing engine (CLAUDE.md 13.13.4 step 1) — pure functions.

* annual volatility = std of 1 year of daily returns × √252
* ATR(14) on daily bars (for staged buy levels)
* max drawdown over the available history (as a positive fraction, e.g. 0.55)
* region from the company's country, a suggested asset type from Yahoo's quote type and name
"""

from __future__ import annotations

import math
import re
from typing import Any

import pandas as pd

TRADING_DAYS = 252

NORTH_AMERICA = {"United States", "Canada"}
EUROPE = {
    "Netherlands", "Belgium", "France", "Germany", "Luxembourg", "Ireland", "United Kingdom",
    "Switzerland", "Italy", "Spain", "Portugal", "Austria", "Denmark", "Sweden", "Norway",
    "Finland", "Poland", "Greece", "Czech Republic", "Hungary", "Iceland",
}  # fmt: skip
DEVELOPED_ASIA_PACIFIC = {"Japan", "Australia", "New Zealand", "Singapore", "Hong Kong", "Israel"}


def annual_vol(close: pd.Series, days: int = TRADING_DAYS) -> float | None:
    r = close.dropna().pct_change().dropna().iloc[-days:]
    if len(r) < 60:
        return None
    return float(r.std() * math.sqrt(TRADING_DAYS))


def atr(ohlc: pd.DataFrame, period: int = 14) -> float | None:
    if len(ohlc) <= period:
        return None
    prev = ohlc["Close"].shift(1)
    tr = pd.concat(
        [ohlc["High"] - ohlc["Low"], (ohlc["High"] - prev).abs(), (ohlc["Low"] - prev).abs()],
        axis=1,
    ).max(axis=1)
    return float(tr.ewm(alpha=1 / period, adjust=False).mean().iloc[-1])  # Wilder's smoothing


def max_drawdown(close: pd.Series) -> float | None:
    c = close.dropna()
    if len(c) < 20:
        return None
    return float(-(c / c.cummax() - 1).min())


def region_of(country: str | None) -> str | None:
    if not country:
        return None
    if country in NORTH_AMERICA:
        return "North America"
    if country in EUROPE:
        return "Europe"
    if country in DEVELOPED_ASIA_PACIFIC:
        return "Asia-Pacific"
    return "Emerging markets"


BROAD = re.compile(
    r"\b(all[- ]world|world|acwi|s&p 500|total (stock )?market|ftse all|msci eafe)\b", re.I
)
BOND = re.compile(r"\b(bond|treasury|aggregate|govt|government|corporate|gilt|t-bill)\b", re.I)
SECTOR = re.compile(
    r"\b(sector|information technology|technology|semiconductor|health ?care|financials?|energy|"
    r"utilities|real estate|consumer|industrials|materials|communication|clean|water|robotics|"
    r"cyber|biotech|defen[cs]e|gold|mining|banks?|dividend|small[- ]cap|value|momentum|quality)\b",
    re.I,
)


def suggested_type(quote_type: str | None, name: str | None) -> str:
    qt = (quote_type or "").upper()
    if qt == "CRYPTOCURRENCY":
        return "crypto"
    if qt in {"ETF", "MUTUALFUND"}:
        if BOND.search(name or ""):
            return "bond_etf"
        if BROAD.search(name or "") and not SECTOR.search(name or ""):
            return "broad_etf"
        return "sector_etf"
    return "stock"


def risk_profile(ohlc: pd.DataFrame, profile: dict[str, Any] | None) -> dict[str, Any]:
    """Everything the sizing engine needs for one ticker (no personal data)."""
    p = profile or {}
    close = ohlc["Close"]
    vol, a, dd = annual_vol(close), atr(ohlc), max_drawdown(close)
    return {
        "vol": None if vol is None else round(vol, 4),
        "atr": None if a is None else round(a, 4),
        "max_dd": None if dd is None else round(dd, 4),
        "sector": p.get("sector"),
        "industry": p.get("industry"),
        "country": p.get("country"),
        "region": region_of(p.get("country")),
        "quote_type": p.get("quoteType"),
        "suggested_type": suggested_type(
            p.get("quoteType"), p.get("longName") or p.get("shortName")
        ),
    }

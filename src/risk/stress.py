"""Stress test and correlation (CLAUDE.md 13.11) — Phase 3B.

* Stress: the actual move of each asset in three historical crises (start → end, daily closes).
  Without that history a proxy is used: the S&P 500 for stocks and equity ETFs, AGG for bonds.
* Correlation: 1 year of daily returns between the owner's watchlist tickers.

Pure functions + one fetcher that never raises. Nothing here prints tickers or values.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from src import log
from src.fetch import with_retries

WINDOWS: dict[str, tuple[str, str]] = {
    "gfc": ("2007-10-09", "2009-03-09"),  # 2008 financial crisis, S&P 500 top → bottom
    "covid": ("2020-02-19", "2020-03-23"),  # Covid crash
    "y2022": ("2022-01-03", "2022-10-12"),  # 2022 bear market
}
PROXY = {"bond_etf": "AGG"}  # everything else: ^GSPC
DEFAULT_PROXY = "^GSPC"
MAX_GAP_DAYS = 14


def window_return(close: pd.Series, start: str, end: str) -> float | None:
    """end / start − 1 using the last close on/before each date (within 14 days), else None."""
    c = close.dropna()
    if c.empty:
        return None
    idx = pd.DatetimeIndex(c.index).tz_localize(None) if c.index.tz is not None else c.index
    c = pd.Series(c.to_numpy(), index=idx)

    def at(d: str) -> float | None:
        ts = pd.Timestamp(d)
        before = c[c.index <= ts]
        if before.empty or (ts - before.index[-1]).days > MAX_GAP_DAYS:
            return None
        return float(before.iloc[-1])

    s, e = at(start), at(end)
    return None if s is None or e is None or s <= 0 else round(e / s - 1, 4)


def stress_moves(
    close: pd.Series | None, proxies: dict[str, dict[str, float | None]], asset_type: str
) -> dict[str, Any]:
    """{gfc, covid, y2022: return or None, proxy: [windows that used a proxy]}."""
    proxy = proxies.get(PROXY.get(asset_type, DEFAULT_PROXY), {})
    out: dict[str, Any] = {"proxy": []}
    for key, (start, end) in WINDOWS.items():
        r = window_return(close, start, end) if close is not None else None
        if r is None:
            r = proxy.get(key)
            if r is not None:
                out["proxy"].append(key)
        out[key] = r
    return out


def correlation(
    closes: dict[str, pd.Series], days: int = 252, min_days: int = 120
) -> dict[str, Any]:
    """Correlation matrix of daily returns over the last `days` trading days."""
    if len(closes) < 2:
        return {"symbols": list(closes), "corr": []}
    frame = pd.concat(
        {
            s: c.dropna().set_axis(pd.DatetimeIndex(c.dropna().index).normalize())
            for s, c in closes.items()
        },
        axis=1,
    ).sort_index()
    rets = frame.pct_change(fill_method=None).iloc[-days:]
    m = rets.corr(min_periods=min_days)
    syms = list(m.columns)
    return {
        "symbols": syms,
        "corr": [[None if pd.isna(v) else round(float(v), 2) for v in m.loc[s]] for s in syms],
        "days": days,
    }


def fetch_weekly_since_2007(symbol: str) -> pd.Series | None:
    """Daily closes 2007-09 → 2022-11 for the stress windows (one request, never raises)."""
    try:
        import yfinance as yf

        def _get() -> pd.Series:
            df = yf.Ticker(symbol).history(
                start="2007-09-01", end="2022-11-01", interval="1d", auto_adjust=False
            )
            return df["Close"] if df is not None and not df.empty else pd.Series(dtype=float)

        s = with_retries(_get, "stress history")
        return s if s is not None and not s.empty else None
    except Exception as exc:  # noqa: BLE001
        log.error(f"stress: failed ({log.exc_kind(exc)})")
        return None


def proxy_moves() -> dict[str, dict[str, float | None]]:
    out = {}
    for sym in (DEFAULT_PROXY, *PROXY.values()):
        s = fetch_weekly_since_2007(sym)
        out[sym] = {
            k: window_return(s, a, b) if s is not None else None for k, (a, b) in WINDOWS.items()
        }
    return out

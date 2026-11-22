"""Data-source wrappers (CLAUDE.md 5).

Rules:
  * Every external call has a timeout and at most 3 attempts with exponential backoff.
  * Every public function returns None on failure (never raises), and logs without personal data.
  * yfinance is unofficial; keeping it behind this module means the source can be swapped later.

Note on caching: the plan allows caching raw downloads with actions/cache. We deliberately do NOT
do that on the public repo, because workflows from forked pull requests can restore the base
branch's caches, which would expose which tickers are on the watchlist. History is small enough
(10 years of daily bars per ticker) to download fresh each night.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, TypeVar

import pandas as pd
import requests

from src import log

T = TypeVar("T")

HTTP_TIMEOUT = 20
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0

FEAR_GREED_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


def with_retries(fn: Callable[[], T], what: str, attempts: int = MAX_ATTEMPTS) -> T | None:
    """Run fn() up to `attempts` times with exponential backoff. Returns None on final failure.

    `what` is a public, non-personal label (e.g. "price history"), used in the error log.
    """
    for attempt in range(1, attempts + 1):
        try:
            result = fn()
            if result is None:
                raise ValueError("empty result")
            return result
        except Exception as exc:  # noqa: BLE001 — any source error must not crash the run
            if attempt == attempts:
                log.error(f"{what}: failed after {attempts} attempts ({log.exc_kind(exc)})")
                log.private(f"{what}: {exc!r}")
                return None
            time.sleep(BACKOFF_SECONDS * (2 ** (attempt - 1)))
    return None


# ---------------------------------------------------------------------------
# yfinance
# ---------------------------------------------------------------------------


def _normalize_index(df: pd.DataFrame) -> pd.DataFrame:
    """Drop timezone and time-of-day so every bar is keyed by its trading date."""
    idx = pd.DatetimeIndex(df.index)
    if idx.tz is not None:
        idx = idx.tz_localize(None)
    df = df.copy()
    df.index = idx.normalize()
    df = df[~df.index.duplicated(keep="last")]
    return df.sort_index()


def get_daily_history(symbol: str, period: str = "10y") -> pd.DataFrame | None:
    """Daily bars with columns Open, High, Low, Close, Volume, Splits.

    Close is split-adjusted but not dividend-adjusted (auto_adjust=False), which is what a chart
    shows and what moving averages should use. Returns None on failure or empty data.
    """
    import yfinance as yf

    def _download() -> pd.DataFrame | None:
        raw = yf.Ticker(symbol).history(
            period=period, interval="1d", auto_adjust=False, actions=True, timeout=HTTP_TIMEOUT
        )
        if raw is None or raw.empty or "Close" not in raw:
            return None
        close = raw["Close"].astype(float)
        df = pd.DataFrame(
            {
                "Open": raw.get("Open", close).astype(float),
                "High": raw.get("High", close).astype(float),
                "Low": raw.get("Low", close).astype(float),
                "Close": close,
                "Volume": raw.get("Volume", pd.Series(0, index=raw.index)).astype(float),
                "Splits": raw.get("Stock Splits", pd.Series(0, index=raw.index)).astype(float),
            }
        )
        df = df.dropna(subset=["Close"])
        return _normalize_index(df) if not df.empty else None

    return with_retries(_download, "price history")


def get_currency(symbol: str) -> str | None:
    import yfinance as yf

    def _currency() -> str | None:
        value = yf.Ticker(symbol).fast_info["currency"]
        return str(value) if value else None

    return with_retries(_currency, "currency lookup")


def get_index_quote(symbol: str) -> dict[str, Any] | None:
    """Last close and % change vs the previous close for an index such as ^GSPC or ^VIX."""
    df = get_daily_history(symbol, period="1mo")
    if df is None or len(df) < 2:
        return None
    last, prev = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
    return {
        "value": round(last, 2),
        "change_pct": round((last / prev - 1) * 100, 2) if prev else None,
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
    }


# ---------------------------------------------------------------------------
# CNN Fear & Greed (unofficial, optional)
# ---------------------------------------------------------------------------


def get_fear_greed() -> dict[str, Any] | None:
    def _get() -> dict[str, Any] | None:
        resp = requests.get(
            FEAR_GREED_URL,
            headers={"User-Agent": BROWSER_UA, "Accept": "application/json"},
            timeout=HTTP_TIMEOUT,
        )
        resp.raise_for_status()
        fg = resp.json().get("fear_and_greed", {})
        score = fg.get("score")
        if score is None:
            return None
        return {"value": round(float(score), 1), "rating": fg.get("rating")}

    return with_retries(_get, "fear & greed index")

"""Data sanity checks (CLAUDE.md 13.14 E). Pure functions, no I/O.

A price series is checked before it is used for scoring:
  * zero / negative prices are removed (red),
  * daily moves bigger than `max_daily_move` are checked against the split column. An
    unexplained big move in the latest bars is SUSPECT: it is excluded from scoring until the
    next run sees the same bar again (then it is "confirmed" and used),
  * stale prices (unchanged for `stale_days`+ trading days) and big gaps give a warning,
  * minor currency units (GBp, ZAc, ILA) are flagged so prices can be converted.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

MINOR_CURRENCIES = {
    "GBp": ("GBP", 100.0),
    "GBX": ("GBP", 100.0),
    "ZAc": ("ZAR", 100.0),
    "ILA": ("ILS", 100.0),
}
RECENT_BARS = 5  # unexplained big moves inside the last N bars can still be bad data


@dataclass
class CheckResult:
    clean: pd.DataFrame  # data safe to use for scoring
    issues: list[dict[str, Any]] = field(default_factory=list)
    suspect_dates: list[str] = field(default_factory=list)

    @property
    def status(self) -> str:
        levels = {i["level"] for i in self.issues}
        if "red" in levels:
            return "red"
        if "yellow" in levels:
            return "yellow"
        return "green"

    def to_json(self) -> dict[str, Any]:
        return {"status": self.status, "issues": self.issues, "suspect_dates": self.suspect_dates}


def check_daily(
    df: pd.DataFrame,
    cfg: dict[str, Any],
    previously_suspect: set[str] | None = None,
) -> CheckResult:
    """Run all checks on daily bars (columns Close, optional Splits). Returns cleaned data."""
    previously_suspect = previously_suspect or set()
    issues: list[dict[str, Any]] = []
    data = df.copy()

    # 1. zero / negative prices
    bad = data["Close"] <= 0
    if bad.any():
        issues.append(
            {
                "code": "nonpositive_price",
                "level": "red",
                "detail": f"{int(bad.sum())} bar(s) with zero/negative price removed",
            }
        )
        data = data[~bad]

    if data.empty:
        issues.append({"code": "no_data", "level": "red", "detail": "no usable price data"})
        return CheckResult(clean=data, issues=issues)

    # 2. big daily moves
    max_move = float(cfg.get("max_daily_move", 0.40))
    moves = data["Close"].pct_change().abs()
    splits = data["Splits"] if "Splits" in data else pd.Series(0.0, index=data.index)
    recent_dates = set(data.index[-RECENT_BARS:])
    suspect: list[pd.Timestamp] = []
    for date in moves[moves > max_move].index:
        key = date.strftime("%Y-%m-%d")
        if splits.get(date, 0) not in (0, 0.0) and not np.isnan(splits.get(date, 0)):
            issues.append(
                {
                    "code": "split",
                    "level": "info",
                    "detail": f"move > {max_move:.0%} on {key} explained by a split",
                }
            )
        elif date in recent_dates and key not in previously_suspect:
            suspect.append(date)
            issues.append(
                {
                    "code": "suspect_move",
                    "level": "red",
                    "detail": f"unexplained move > {max_move:.0%} on {key}; "
                    "excluded until the next run confirms it",
                }
            )
        elif date in recent_dates:
            issues.append(
                {
                    "code": "confirmed_move",
                    "level": "info",
                    "detail": f"big move on {key} confirmed by a second run",
                }
            )

    if suspect:
        data = data[data.index < min(suspect)]

    # 3. stale prices
    stale_days = int(cfg.get("stale_days", 3))
    tail = df["Close"].iloc[-(stale_days + 1) :]
    if len(tail) == stale_days + 1 and tail.nunique() == 1:
        issues.append(
            {
                "code": "stale",
                "level": "yellow",
                "detail": f"close unchanged for {stale_days}+ trading days",
            }
        )

    # 4. gaps in the last year
    max_gap = int(cfg.get("max_gap_business_days", 5))
    last_year = df.index[df.index >= df.index[-1] - pd.Timedelta(days=365)]
    if len(last_year) > 1:
        gaps = np.busday_count(
            last_year[:-1].values.astype("datetime64[D]"),
            last_year[1:].values.astype("datetime64[D]"),
        )
        biggest = int(gaps.max())
        if biggest > max_gap:
            issues.append(
                {
                    "code": "gap",
                    "level": "yellow",
                    "detail": f"missing data: gap of {biggest} business days in last year",
                }
            )

    return CheckResult(
        clean=data, issues=issues, suspect_dates=[d.strftime("%Y-%m-%d") for d in suspect]
    )


def normalize_currency(currency: str | None) -> tuple[str | None, float, dict[str, Any] | None]:
    """Map minor units (GBp = pence) to the major currency. Returns (currency, divisor, issue)."""
    if currency in MINOR_CURRENCIES:
        major, divisor = MINOR_CURRENCIES[currency]
        issue = {
            "code": "minor_currency",
            "level": "info",
            "detail": f"prices quoted in {currency}; shown in {major} (÷{divisor:g})",
        }
        return major, divisor, issue
    return currency, 1.0, None

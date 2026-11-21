"""Bottom Score (CLAUDE.md 6). Pure functions: data + config in, signals + score out.

Each signal returns a dict:
  code    "T1" / "T2" / "T3" / "S1"
  key     config key, e.g. "weekly_rsi"
  name    short human name
  passed  True / False / None (None = data missing → shown as "n/a", not counted as 0)
  value   raw value used (float or dict) — so the UI can show *why*
  threshold
  detail  one-line human explanation, e.g. "RSI(w) 27.4 < 30"
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from src import indicators as ind

SIGNAL_META = {
    "near_200w_ma": ("T1", "Near 200-week moving average"),
    "weekly_rsi": ("T2", "Weekly RSI oversold"),
    "drawdown": ("T3", "Deep drawdown from 52-week high"),
    "valuation_pct": ("V1", "Cheap vs own history"),
    "insider_buying": ("V2", "Insider buying"),
    "market_fear": ("S1", "Market fear"),
}


def _signal(key: str, passed: bool | None, value: Any, threshold: Any, detail: str) -> dict:
    code, name = SIGNAL_META[key]
    return {
        "code": code,
        "key": key,
        "name": name,
        "passed": passed,
        "value": value,
        "threshold": threshold,
        "detail": detail,
    }


def _r(x: float | None, nd: int = 2) -> float | None:
    return None if x is None else round(float(x), nd)


# ---------------------------------------------------------------------------
# Individual signals
# ---------------------------------------------------------------------------


def signal_near_200w_ma(weekly_close: pd.Series, cfg: dict) -> dict:
    weeks = int(cfg.get("weeks", 200))
    tol = float(cfg.get("tolerance", 0.05))
    if len(weekly_close.dropna()) < weeks:
        return _signal(
            "near_200w_ma",
            None,
            None,
            None,
            f"needs {weeks} weeks of history, have {len(weekly_close.dropna())}",
        )
    ma = ind.last_valid(ind.sma(weekly_close, weeks))
    close = float(weekly_close.iloc[-1])
    limit = ma * (1 + tol)
    passed = close <= limit
    return _signal(
        "near_200w_ma",
        passed,
        {"close": _r(close), "sma": _r(ma), "pct_vs_sma": _r((close / ma - 1) * 100, 1)},
        _r(limit),
        f"close {close:.2f} {'≤' if passed else '>'} {weeks}w SMA {ma:.2f} × "
        f"{1 + tol:.2f} = {limit:.2f}",
    )


def signal_weekly_rsi(weekly_close: pd.Series, cfg: dict) -> dict:
    period = int(cfg.get("period", 14))
    below = float(cfg.get("below", 30))
    rsi = ind.last_valid(ind.rsi_wilder(weekly_close, period))
    if rsi is None:
        return _signal("weekly_rsi", None, None, below, f"needs > {period} weeks of history")
    passed = rsi < below
    return _signal(
        "weekly_rsi",
        passed,
        _r(rsi, 1),
        below,
        f"RSI(w,{period}) {rsi:.1f} {'<' if passed else '≥'} {below:g}",
    )


def signal_drawdown(daily_close: pd.Series, cfg: dict) -> dict:
    min_pct = float(cfg.get("min_pct", 30))
    lookback = int(cfg.get("lookback_days", 252))
    if len(daily_close) < 20:
        return _signal("drawdown", None, None, -min_pct, "needs at least 20 days of history")
    dd = float(ind.drawdown_pct(daily_close, lookback).iloc[-1])
    high = float(ind.rolling_high(daily_close, lookback).iloc[-1])
    passed = dd <= -min_pct
    note = "" if len(daily_close) >= lookback else f" (only {len(daily_close)} days of history)"
    return _signal(
        "drawdown",
        passed,
        {"pct": _r(dd, 1), "high": _r(high)},
        -min_pct,
        f"{dd:.1f}% from 52w high {high:.2f} ({'≥' if passed else '<'} {min_pct:g}% off){note}",
    )


def signal_market_fear(market: dict, cfg: dict) -> dict:
    vix_above = float(cfg.get("vix_above", 30))
    fg_below = float(cfg.get("fear_greed_below", 25))
    vix = (market.get("vix") or {}).get("value")
    fg = (market.get("fear_greed") or {}).get("value")
    if vix is None and fg is None:
        return _signal("market_fear", None, None, None, "VIX and Fear & Greed both unavailable")
    vix_hit = vix is not None and vix >= vix_above
    fg_hit = fg is not None and fg <= fg_below
    parts = [
        f"VIX {vix:.1f} ({'≥' if vix_hit else '<'} {vix_above:g})"
        if vix is not None
        else "VIX n/a",
        f"F&G {fg:.0f} ({'≤' if fg_hit else '>'} {fg_below:g})" if fg is not None else "F&G n/a",
    ]
    return _signal(
        "market_fear",
        vix_hit or fg_hit,
        {"vix": vix, "fear_greed": fg},
        {"vix_above": vix_above, "fear_greed_below": fg_below},
        " · ".join(parts),
    )


# ---------------------------------------------------------------------------
# Combine
# ---------------------------------------------------------------------------


def compute_signals(daily_close: pd.Series, market: dict, scoring_cfg: dict) -> list[dict]:
    """All enabled Phase 1 signals for one ticker, in display order."""
    sig_cfg = scoring_cfg["signals"]
    weekly = ind.to_weekly(daily_close)
    builders = {
        "near_200w_ma": lambda c: signal_near_200w_ma(weekly, c),
        "weekly_rsi": lambda c: signal_weekly_rsi(weekly, c),
        "drawdown": lambda c: signal_drawdown(daily_close, c),
        "market_fear": lambda c: signal_market_fear(market, c),
    }
    out = []
    for key, build in builders.items():
        c = sig_cfg.get(key, {})
        if c.get("enabled", False):
            s = build(c)
            s["weight"] = float(c.get("weight", 1))
            out.append(s)
    return out


def score_label(score: float, scoring_cfg: dict) -> dict:
    for lab in sorted(scoring_cfg["labels"], key=lambda x: x["min"], reverse=True):
        if score >= lab["min"]:
            return {"key": lab["key"], "text": lab["text"], "colour": lab["colour"]}
    return {"key": "normal", "text": "Normal", "colour": "grey"}


def build_score(signals: list[dict], scoring_cfg: dict) -> dict:
    """Score = sum of weights of passed signals. n/a signals count toward neither side,
    but max_score still includes them, so the UI shows e.g. "3/4 (1 n/a)"."""
    score = sum(s["weight"] for s in signals if s["passed"] is True)
    max_score = sum(s["weight"] for s in signals)
    n_na = sum(1 for s in signals if s["passed"] is None)
    return {
        "score": score,
        "max_score": max_score,
        "n_na": n_na,
        "label": score_label(score, scoring_cfg),
    }

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
    "near_major_bottom": ("T4", "Near a major previous bottom"),
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


def signal_valuation(fund: dict | None, cfg: dict) -> dict:
    """V1 (6.2): current P/E (P/S if losses) in the bottom `below_percentile` of its own history."""
    below = float(cfg.get("below_percentile", 20))
    min_years = float(cfg.get("min_years", 3))
    v = (fund or {}).get("valuation")
    if not v:
        return _signal("valuation_pct", None, None, below, "no usable valuation history")
    if v["years"] < min_years:
        return _signal("valuation_pct", None, v, below, f"only {v['years']} years of history")
    passed = v["pct"] <= below
    return _signal(
        "valuation_pct",
        passed,
        v,
        below,
        f"{v['metric'].upper()} {v['now']} is at the {v['pct']:.0f}th percentile of "
        f"{v['years']:.0f} years (fires at <= {below:g})",
    )


def signal_insider(fund: dict | None, cfg: dict) -> dict:
    """V2 (6.2): net insider open-market purchases > 0 over the last `days` days."""
    ins = (fund or {}).get("insiders")
    if not ins:
        reason = (
            "no free insider data for EU stocks"
            if (fund or {}).get("insiders_na") == "eu"
            else "insider data unavailable"
        )
        return _signal("insider_buying", None, {"na": (fund or {}).get("insiders_na")}, 0, reason)
    passed = ins["net_value"] > 0
    return _signal(
        "insider_buying",
        passed,
        {k: ins[k] for k in ("net_value", "buy_value", "sell_value", "buys", "sells", "days")},
        0,
        f"net open-market buying {ins['net_value']:.0f} over {ins['days']} days",
    )


def signal_near_major_bottom(price: float, levels: dict | None, cfg: dict) -> dict:
    """T4 (6.5): price within `within_pct` of a monthly/yearly support zone with ≥ min_touches."""
    within = float(cfg.get("within_pct", 5))
    min_touches = int(cfg.get("min_touches", 2))
    if not levels or not levels.get("zones"):
        return _signal("near_major_bottom", None, None, within, "no previous bottoms found")
    cands = [
        z
        for z in levels["zones"]
        if z["role"] == "support" and set(z["tfs"]) & {"Y", "M"} and z["touches"] >= min_touches
    ]
    if not cands:
        return _signal("near_major_bottom", False, None, within, "no major support with 2+ touches")
    z = min(cands, key=lambda z: abs(z["distance_pct"]))
    dist = abs(z["distance_pct"])
    passed = dist <= within
    return _signal(
        "near_major_bottom",
        passed,
        {
            "low": z["low"],
            "high": z["high"],
            "distance_pct": z["distance_pct"],
            "touches": z["touches"],
            "years": z["years"],
        },
        within,
        f"support {z['low']:.2f}-{z['high']:.2f} is {dist:.1f}% away ({z['touches']} touches)",
    )


# ---------------------------------------------------------------------------
# Combine
# ---------------------------------------------------------------------------


def compute_signals(
    daily_close: pd.Series,
    market: dict,
    scoring_cfg: dict,
    levels: dict | None = None,
    fundamentals: dict | None = None,
) -> list[dict]:
    """All enabled signals for one ticker, in display order."""
    sig_cfg = scoring_cfg["signals"]
    weekly = ind.to_weekly(daily_close)
    builders = {
        "near_200w_ma": lambda c: signal_near_200w_ma(weekly, c),
        "weekly_rsi": lambda c: signal_weekly_rsi(weekly, c),
        "drawdown": lambda c: signal_drawdown(daily_close, c),
        "valuation_pct": lambda c: signal_valuation(fundamentals, c),
        "insider_buying": lambda c: signal_insider(fundamentals, c),
        "near_major_bottom": lambda c: signal_near_major_bottom(
            float(daily_close.iloc[-1]), levels, c
        ),
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


def weekly_score_history(
    daily_close: pd.Series, vix_daily: pd.Series | None, scoring_cfg: dict
) -> pd.Series:
    """Reconstructed weekly Bottom Score (W-FRI) from prices (T1–T3) and the VIX (S1).

    Fear & Greed has no free history, so S1 here uses the VIX only. Weeks where no signal
    can be computed are NaN. Used for the score-history chart and "score ≥ 4" markers.
    """
    sig = scoring_cfg["signals"]
    weekly = ind.to_weekly(daily_close)
    parts: list[pd.Series] = []

    c = sig.get("near_200w_ma", {})
    if c.get("enabled"):
        sma = ind.sma(weekly, int(c.get("weeks", 200)))
        t1 = (weekly <= sma * (1 + float(c.get("tolerance", 0.05)))).astype(float) * float(
            c.get("weight", 1)
        )
        parts.append(t1.where(sma.notna()))
    c = sig.get("weekly_rsi", {})
    if c.get("enabled"):
        rsi = ind.rsi_wilder(weekly, int(c.get("period", 14)))
        parts.append(
            (rsi < float(c.get("below", 30))).astype(float).where(rsi.notna())
            * float(c.get("weight", 1))
        )
    c = sig.get("drawdown", {})
    if c.get("enabled"):
        dd = (
            ind.drawdown_pct(daily_close, int(c.get("lookback_days", 252))).resample("W-FRI").last()
        )
        dd = dd.reindex(weekly.index)
        parts.append(
            (dd <= -float(c.get("min_pct", 30))).astype(float).where(dd.notna())
            * float(c.get("weight", 1))
        )
    c = sig.get("market_fear", {})
    if c.get("enabled") and vix_daily is not None and not vix_daily.empty:
        vix_w = vix_daily.resample("W-FRI").last().reindex(weekly.index)
        parts.append(
            (vix_w >= float(c.get("vix_above", 30))).astype(float).where(vix_w.notna())
            * float(c.get("weight", 1))
        )

    if not parts:
        return pd.Series(dtype=float)
    frame = pd.concat(parts, axis=1)
    return frame.sum(axis=1, min_count=1)

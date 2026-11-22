"""Top Score: "is it getting hot?" — the mirror of the Bottom Score (CLAUDE.md 13.14 A).

Same signal shape as src/score.py (code, key, passed True/False/None, value, threshold, detail),
thresholds in config/scoring.yaml → top_signals. Labels: 0–1 normal, 2–3 hot, 4+ trim.
This never means "sell": at most "consider trimming", and alerts are only for holdings (Phase 3).
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from src import indicators as ind

TOP_META = {
    "far_above_trend": ("U1", "Far above long-term trend"),
    "weekly_rsi_high": ("U2", "Weekly RSI overbought"),
    "expensive": ("U3", "Expensive vs own history"),
    "insider_selling": ("U4", "Insider selling"),
    "euphoria": ("U5", "Market euphoria"),
    "near_resistance": ("U6", "Near a major ceiling"),
}


def _sig(key: str, passed: bool | None, value: Any, threshold: Any, detail: str) -> dict:
    code, name = TOP_META[key]
    return {
        "code": code,
        "key": key,
        "name": name,
        "passed": passed,
        "value": value,
        "threshold": threshold,
        "detail": detail,
    }


def top_far_above_trend(weekly: pd.Series, cfg: dict) -> dict:
    """U1: close ≥ 200-week SMA × multiple (default 1.8)."""
    weeks, mult = int(cfg.get("weeks", 200)), float(cfg.get("multiple", 1.8))
    if len(weekly.dropna()) < weeks:
        return _sig("far_above_trend", None, None, mult, f"needs {weeks} weeks of history")
    ma = ind.last_valid(ind.sma(weekly, weeks))
    close = float(weekly.iloc[-1])
    ratio = close / ma
    return _sig(
        "far_above_trend",
        ratio >= mult,
        {"ratio": round(ratio, 3), "pct_vs_sma": round((ratio - 1) * 100, 1)},
        mult,
        f"close is {ratio:.2f}x the {weeks}w SMA (fires at >= {mult:g}x)",
    )


def top_weekly_rsi(weekly: pd.Series, cfg: dict) -> dict:
    """U2: weekly RSI(14) > 70 (extra flag above 80)."""
    period, above = int(cfg.get("period", 14)), float(cfg.get("above", 70))
    extreme = float(cfg.get("extreme", 80))
    rsi = ind.last_valid(ind.rsi_wilder(weekly, period))
    if rsi is None:
        return _sig("weekly_rsi_high", None, None, above, f"needs > {period} weeks of history")
    return _sig(
        "weekly_rsi_high",
        rsi > above,
        {"rsi": round(rsi, 1), "extreme": rsi > extreme},
        above,
        f"RSI(w) {rsi:.1f} ({'>' if rsi > above else '<='} {above:g})",
    )


def top_expensive(fund: dict | None, cfg: dict) -> dict:
    """U3: P/E (or P/S) in the top 10 % of its own history."""
    above = float(cfg.get("above_percentile", 90))
    min_years = float(cfg.get("min_years", 3))
    v = (fund or {}).get("valuation")
    if not v or v.get("years", 0) < min_years:
        return _sig("expensive", None, v, above, "no usable valuation history")
    return _sig(
        "expensive",
        v["pct"] >= above,
        v,
        above,
        f"{v['metric'].upper()} at the {v['pct']:.0f}th percentile (fires at >= {above:g})",
    )


def top_insider_selling(fund: dict | None, market_cap: float | None, cfg: dict) -> dict:
    """U4: net open-market insider selling over 90 days above `min_pct_of_mcap` % of market cap.

    Big companies' insiders sell every quarter (pay, planned 10b5-1 sales the free data can't
    separate), so a fixed dollar amount would always fire. A share of market cap doesn't.
    """
    pct = float(cfg.get("min_pct_of_mcap", 0.05))
    ins = (fund or {}).get("insiders")
    if not ins:
        na = (fund or {}).get("insiders_na")
        return _sig("insider_selling", None, {"na": na}, pct, "insider data unavailable")
    if not market_cap:
        return _sig("insider_selling", None, {"na": "mcap"}, pct, "market cap unknown")
    net_sell = max(0.0, -float(ins["net_value"]))
    share = net_sell / market_cap * 100
    return _sig(
        "insider_selling",
        share >= pct,
        {"net_sell": round(net_sell, 0), "pct_of_mcap": round(share, 4), "days": ins["days"]},
        pct,
        f"net selling {share:.3f}% of market cap over {ins['days']} days (fires at >= {pct:g}%)",
    )


def top_euphoria(market: dict, cfg: dict) -> dict:
    """U5: Fear & Greed ≥ 75 (the hype meter, 13.8, comes in Phase 4)."""
    above = float(cfg.get("fear_greed_above", 75))
    fg = (market.get("fear_greed") or {}).get("value")
    if fg is None:
        return _sig("euphoria", None, None, above, "Fear & Greed unavailable")
    return _sig(
        "euphoria",
        fg >= above,
        {"fear_greed": fg},
        above,
        f"F&G {fg:.0f} ({'>=' if fg >= above else '<'} {above:g})",
    )


def top_near_resistance(levels: dict | None, cfg: dict) -> dict:
    """U6: price within `within_pct` below a monthly/yearly ceiling zone."""
    within = float(cfg.get("within_pct", 3))
    zones = (levels or {}).get("zones") or []
    if not zones:
        return _sig("near_resistance", None, None, within, "no previous ceilings found")
    cands = [z for z in zones if z["role"] == "resistance" and set(z["tfs"]) & {"Y", "M"}]
    if not cands:
        return _sig("near_resistance", False, None, within, "no major ceiling above the price")
    z = min(cands, key=lambda z: abs(z["distance_pct"]))
    dist = abs(z["distance_pct"])
    return _sig(
        "near_resistance",
        dist <= within,
        {
            "low": z["low"],
            "high": z["high"],
            "distance_pct": z["distance_pct"],
            "touches": z["touches"],
        },
        within,
        f"ceiling {z['low']:.2f}-{z['high']:.2f} is {dist:.1f}% away",
    )


def weekly_top_history(daily_close: pd.Series, scoring_cfg: dict) -> pd.Series:
    """Reconstructed weekly Top Score from prices only (U1 + U2), for the chart's score panel.

    Valuation, insider, Fear & Greed and ceiling history isn't available for free, so this is a
    lower bound of the real Top Score and is labelled as such in the UI.
    """
    cfg = scoring_cfg.get("top_signals") or {}
    weekly = ind.to_weekly(daily_close)
    parts = []
    c = cfg.get("far_above_trend", {})
    if c.get("enabled", True):
        sma = ind.sma(weekly, int(c.get("weeks", 200)))
        hit = (weekly >= sma * float(c.get("multiple", 1.8))).astype(float)
        parts.append(hit.where(sma.notna()) * float(c.get("weight", 1)))
    c = cfg.get("weekly_rsi_high", {})
    if c.get("enabled", True):
        rsi = ind.rsi_wilder(weekly, int(c.get("period", 14)))
        hit = (rsi > float(c.get("above", 70))).astype(float)
        parts.append(hit.where(rsi.notna()) * float(c.get("weight", 1)))
    if not parts:
        return pd.Series(dtype=float)
    return pd.concat(parts, axis=1).sum(axis=1, min_count=1)


def top_label(score: float) -> str:
    return "trim" if score >= 4 else "hot" if score >= 2 else "normal"


def compute_top(
    daily_close: pd.Series,
    market: dict,
    scoring_cfg: dict,
    *,
    levels: dict | None = None,
    fundamentals: dict | None = None,
    market_cap: float | None = None,
) -> dict:
    """All enabled Top signals + the total, like build_score for the Bottom Score."""
    cfg = scoring_cfg.get("top_signals") or {}
    weekly = ind.to_weekly(daily_close)
    builders = {
        "far_above_trend": lambda c: top_far_above_trend(weekly, c),
        "weekly_rsi_high": lambda c: top_weekly_rsi(weekly, c),
        "expensive": lambda c: top_expensive(fundamentals, c),
        "insider_selling": lambda c: top_insider_selling(fundamentals, market_cap, c),
        "euphoria": lambda c: top_euphoria(market, c),
        "near_resistance": lambda c: top_near_resistance(levels, c),
    }
    signals = []
    for key, build in builders.items():
        c = cfg.get(key, {"enabled": True})
        if c.get("enabled", True):
            s = build(c)
            s["weight"] = float(c.get("weight", 1))
            signals.append(s)
    score = sum(s["weight"] for s in signals if s["passed"] is True)
    return {
        "score": score,
        "max_score": sum(s["weight"] for s in signals),
        "n_na": sum(1 for s in signals if s["passed"] is None),
        "label": top_label(score),
        "signals": signals,
    }

"""Automatic previous bottoms & ceilings: support / resistance zones (CLAUDE.md 6.5).

Pure functions, no I/O. Owner decision: multi-timeframe "real" levels.

1. Resample daily bars to each timeframe (yearly, monthly, weekly, daily).
2. Swing points: a bar is a swing low if its low is the lowest of `window` bars on each side
   (a swing high likewise). A swing only counts if price then moved at least `min_move` away
   from it before breaking it (a ZigZag-style filter that removes noise).
3. Swing points from all timeframes within ±merge_pct are merged into zones.
   Strength = sum of the timeframe weights of every touch.
4. Role: a zone below the current price is support, above it resistance. A zone formed by
   ceilings that price has broken above is a *flipped* support (and vice versa).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

import pandas as pd

TF_ORDER = ["Y", "M", "W", "D"]


@dataclass
class Swing:
    date: str
    price: float
    kind: str  # "low" | "high"
    tf: str  # "Y" | "M" | "W" | "D"
    weight: int
    move: float  # fraction moved away from the level afterwards (0.25 = 25 %)


@dataclass
class Zone:
    low: float
    high: float
    touches: int
    strength: int
    tfs: list[str]
    first: str
    last: str
    years: list[int]
    lows: int
    highs: int
    major: bool
    role: str = ""  # "support" | "resistance"
    flipped: bool = False
    distance_pct: float = 0.0
    points: list[dict[str, Any]] = field(default_factory=list)


def resample_ohlc(daily: pd.DataFrame, rule: str | None) -> pd.DataFrame:
    """Daily OHLC → OHLC on `rule` (W-FRI, ME, YE). `None` returns the daily bars."""
    if rule is None:
        return daily[["Open", "High", "Low", "Close"]].dropna()
    out = daily.resample(rule).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"})
    return out.dropna()


def find_swings(
    bars: pd.DataFrame, window: int, min_move: float, tf: str, weight: int
) -> list[Swing]:
    """Swing lows and highs on one timeframe, filtered by the move away from them."""
    lows = bars["Low"].to_numpy(float)
    highs = bars["High"].to_numpy(float)
    n = len(bars)
    out: list[Swing] = []
    for i in range(window, n - window):
        lo_win = lows[i - window : i + window + 1]
        hi_win = highs[i - window : i + window + 1]
        if lows[i] == lo_win.min() and lows[i] > 0:
            # rebound until price breaks below this low again (or the data ends)
            j = i + 1
            peak = lows[i]
            while j < n and lows[j] >= lows[i]:
                peak = max(peak, highs[j])
                j += 1
            move = peak / lows[i] - 1
            if move >= min_move:
                out.append(
                    Swing(_d(bars.index[i]), float(lows[i]), "low", tf, weight, round(move, 4))
                )
        if highs[i] == hi_win.max():
            j = i + 1
            trough = highs[i]
            while j < n and highs[j] <= highs[i]:
                trough = min(trough, lows[j])
                j += 1
            move = 1 - trough / highs[i]
            if move >= min_move:
                out.append(
                    Swing(_d(bars.index[i]), float(highs[i]), "high", tf, weight, round(move, 4))
                )
    return out


def _d(ts: pd.Timestamp) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%d")


def cluster(swings: list[Swing], merge_pct: float, major_move: float) -> list[Zone]:
    """Merge swing points within ±merge_pct of the zone's running bounds into zones."""
    zones: list[list[Swing]] = []
    for s in sorted(swings, key=lambda x: x.price):
        if zones:
            cur = zones[-1]
            lo = min(p.price for p in cur)
            if s.price <= lo * (1 + merge_pct / 100):
                cur.append(s)
                continue
        zones.append([s])
    out = []
    for pts in zones:
        dates = sorted(p.date for p in pts)
        tfs = sorted({p.tf for p in pts}, key=TF_ORDER.index)
        out.append(
            Zone(
                low=round(min(p.price for p in pts), 4),
                high=round(max(p.price for p in pts), 4),
                touches=len(
                    {p.date[:7] for p in pts}
                ),  # same month on several timeframes = 1 touch
                strength=sum(p.weight for p in pts),
                tfs=tfs,
                first=dates[0],
                last=dates[-1],
                years=sorted({int(p.date[:4]) for p in pts}),
                lows=sum(1 for p in pts if p.kind == "low"),
                highs=sum(1 for p in pts if p.kind == "high"),
                major=any(p.move >= major_move for p in pts),
                points=[
                    {"date": p.date, "price": p.price, "kind": p.kind, "tf": p.tf} for p in pts
                ],
            )
        )
    return out


def assign_roles(zones: list[Zone], price: float) -> list[Zone]:
    """Support below the price, resistance above; mark flipped levels; distance in %."""
    for z in zones:
        mid = (z.low + z.high) / 2
        z.role = "support" if mid < price else "resistance"
        made_of_highs = z.highs > z.lows
        z.flipped = (z.role == "support" and made_of_highs) or (
            z.role == "resistance" and not made_of_highs
        )
        # distance from price to the nearest edge of the zone (0 if price is inside it)
        if z.low <= price <= z.high:
            z.distance_pct = 0.0
        elif z.role == "support":
            z.distance_pct = round((z.high / price - 1) * 100, 2)
        else:
            z.distance_pct = round((z.low / price - 1) * 100, 2)
    return zones


def detect_levels(daily: pd.DataFrame, cfg: dict[str, Any]) -> dict[str, Any]:
    """Full pipeline. Returns {"zones": [...], "swings": [...]} ready to store as JSON.

    `daily` needs columns Open, High, Low, Close and a DatetimeIndex.
    """
    if daily is None or daily.empty or len(daily) < 30:
        return {"zones": [], "swings": []}
    price = float(daily["Close"].iloc[-1])
    swings: list[Swing] = []
    for tf_cfg in cfg["timeframes"].values():
        bars = resample_ohlc(daily, tf_cfg.get("rule"))
        swings += find_swings(
            bars,
            int(tf_cfg["window"]),
            float(tf_cfg["min_move"]),
            tf_cfg["label"],
            int(tf_cfg["weight"]),
        )
    zones = assign_roles(cluster(swings, float(cfg["merge_pct"]), float(cfg["major_move"])), price)

    # Keep the nearest zones per side for each zoom group (10Y: Y+M, 3–5Y: M+W, 1Y: W+D),
    # so long-term bottoms are never crowded out by nearby short-term levels.
    keep = int(cfg.get("keep_per_side", 6))
    groups = [("Y", "M"), ("M", "W"), ("W", "D")]

    def pick(role: str, key) -> list[Zone]:
        chosen: list[Zone] = []
        side = sorted([z for z in zones if z.role == role], key=key)
        for g in groups:
            for z in [z for z in side if set(z.tfs) & set(g)][: keep // 2]:
                if z not in chosen:
                    chosen.append(z)
        return sorted(chosen, key=key)

    below = pick("support", lambda z: -z.high)
    above = pick("resistance", lambda z: z.low)
    major_swings = [s for s in swings if s.tf in ("Y", "M")]
    return {
        "zones": [asdict(z) for z in below + above],
        "swings": [asdict(s) for s in sorted(major_swings, key=lambda s: s.date)],
    }


def nearest(
    levels: dict[str, Any], role: str, tfs: tuple[str, ...] = ("Y", "M")
) -> dict[str, Any] | None:
    """Nearest zone of a role that was seen on at least one of `tfs`."""
    cands = [z for z in levels.get("zones", []) if z["role"] == role and set(z["tfs"]) & set(tfs)]
    if not cands:
        return None
    return min(cands, key=lambda z: abs(z["distance_pct"]))

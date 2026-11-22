"""Support/resistance detection on synthetic prices with known peaks and troughs (CLAUDE.md 6.5)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from src import levels as lv

CFG = yaml.safe_load((Path(__file__).parents[1] / "config" / "scoring.yaml").read_text())["levels"]


def _bars(closes, start="2015-01-01", freq="B", spread=0.0):
    idx = pd.date_range(start, periods=len(closes), freq=freq)
    c = pd.Series(closes, index=idx, dtype=float)
    return pd.DataFrame({"Open": c, "High": c * (1 + spread), "Low": c * (1 - spread), "Close": c})


def _path(points, steps):
    """Piecewise-linear path through `points`, `steps` bars per leg."""
    out = []
    for a, b in zip(points[:-1], points[1:]):
        out += list(np.linspace(a, b, steps, endpoint=False))
    return out + [points[-1]]


# ---------------------------------------------------------------- swing detection


def test_find_swings_finds_known_low_and_high():
    # 100 → 50 (low) → 120 (high) → 80
    bars = _bars(_path([100, 50, 120, 80], 20))
    sw = lv.find_swings(bars, window=5, min_move=0.2, tf="D", weight=1)
    lows = [s for s in sw if s.kind == "low"]
    highs = [s for s in sw if s.kind == "high"]
    assert [s.price for s in lows] == [50.0]
    assert [s.price for s in highs] == [120.0]
    assert lows[0].move == pytest.approx(120 / 50 - 1, abs=1e-3)  # rebound 140 %
    assert highs[0].move == pytest.approx(1 - 80 / 120, abs=1e-3)  # drop 33 %


def test_min_move_filters_small_wiggles():
    # a 4 % wiggle must not count as a swing with min_move 6 %
    bars = _bars(_path([100, 96, 100, 96, 100], 15))
    assert lv.find_swings(bars, window=3, min_move=0.06, tf="D", weight=1) == []


def test_swing_needs_full_window_each_side():
    # the low is the very last bar: not confirmed yet
    bars = _bars(_path([100, 60], 30))
    assert [s for s in lv.find_swings(bars, 5, 0.1, "D", 1) if s.kind == "low"] == []


# ---------------------------------------------------------------- clustering & roles


def _sw(price, kind="low", tf="W", date="2020-01-03", move=0.3, weight=2):
    return lv.Swing(date, price, kind, tf, weight, move)


def test_cluster_merges_within_3_percent_and_counts_touches():
    zones = lv.cluster(
        [_sw(100, date="2020-03-20"), _sw(102.5, date="2022-10-14"), _sw(150, kind="high")], 3, 0.25
    )
    assert len(zones) == 2
    z = zones[0]
    assert (z.low, z.high, z.touches, z.years) == (100, 102.5, 2, [2020, 2022])


def test_same_bottom_on_several_timeframes_is_one_touch_but_stronger():
    pts = [
        _sw(100, tf="Y", weight=4, date="2020-03-23"),
        _sw(100, tf="M", weight=3, date="2020-03-31"),
        _sw(101, tf="W", weight=2, date="2020-03-20"),
    ]
    z = lv.cluster(pts, 3, 0.25)[0]
    assert z.touches == 1 and z.strength == 9 and z.tfs == ["Y", "M", "W"]


def test_roles_and_flip():
    zones = lv.cluster([_sw(80), _sw(110, kind="high"), _sw(130, kind="high")], 3, 0.25)
    lv.assign_roles(zones, price=120)
    by = {z.low: z for z in zones}
    assert by[80].role == "support" and not by[80].flipped
    assert by[110].role == "support" and by[110].flipped  # old ceiling, broken → support
    assert by[130].role == "resistance" and not by[130].flipped
    assert by[80].distance_pct == pytest.approx(-33.33, abs=0.01)


def test_major_flag():
    zones = lv.cluster([_sw(100, move=0.10), _sw(200, move=0.40)], 3, 0.25)
    assert [z.major for z in zones] == [False, True]


# ---------------------------------------------------------------- full pipeline


def test_detect_levels_multi_timeframe_double_bottom():
    # ~7 years of daily data: two big bottoms 2 % apart (50 and 51), a ceiling near 150
    closes = _path([100, 150, 50, 140, 51, 130, 110], 260)
    daily = _bars(closes, start="2015-01-01", spread=0.01)
    out = lv.detect_levels(daily, CFG)
    price = daily["Close"].iloc[-1]
    support = lv.nearest(out, "support")
    assert support is not None
    assert support["low"] == pytest.approx(49.5, rel=0.03)  # the double bottom
    assert support["touches"] >= 2 and support["major"]
    assert {"M", "W"} <= set(support["tfs"])
    assert support["distance_pct"] < 0 and support["high"] < price
    res = lv.nearest(out, "resistance")
    assert res is not None and res["low"] > price
    assert all(s["tf"] in ("Y", "M") for s in out["swings"])


def test_detect_levels_too_little_data():
    assert lv.detect_levels(_bars([1, 2, 3]), CFG) == {"zones": [], "swings": []}


def test_resample_weekly_ohlc():
    daily = _bars([1, 2, 3, 4, 5, 6, 7], start="2024-01-01")  # Mon..Tue next week
    w = lv.resample_ohlc(daily, "W-FRI")
    assert list(w["Open"]) == [1, 6] and list(w["High"]) == [5, 7] and list(w["Close"]) == [5, 7]

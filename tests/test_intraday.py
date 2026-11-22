"""Intraday rules (CLAUDE.md 7.1)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import pytest
import yaml

from src import intraday as it

CFG = yaml.safe_load((Path(__file__).parents[1] / "config" / "alerts.yaml").read_text())
NOW = datetime(2026, 12, 1, 17, 45, tzinfo=timezone.utc)  # 12:45 New York


def row(**kw):
    base = {
        "user_id": "u1",
        "symbol": "NVDA",
        "currency": "USD",
        "price": 125.0,
        "prev_close": 126.0,
        "vol_today": 10e6,
        "avg_vol20": 40e6,
        "elapsed": 0.5,
        "minutes_open": 195,
        "buy_below": None,
        "score": 3,
        "max_score": 6,
        "label": "watch",
        "news": [],
    }
    return {**base, **kw}


def kinds(a):
    return sorted(x.kind for x in a)


def test_quiet_day_no_alerts():
    assert it.evaluate_intraday([row()], CFG, NOW) == []


def test_drop_now_with_headline():
    news = [{"headline": "Guidance cut", "source": "Reuters", "time": "2026-12-01T10:00:00Z"}]
    a = it.evaluate_intraday([row(price=118.0, news=news)], CFG, NOW)
    assert kinds(a) == ["drop"]
    assert "−6,3 % now" in a[0].title and "News: Guidance cut (Reuters)" in a[0].body


def test_volume_spike_scaled_to_time_of_day():
    # halfway through the day, normal so far = 20 M; 45 M = 2,25×
    a = it.evaluate_intraday([row(vol_today=45e6)], CFG, NOW)
    assert kinds(a) == ["volume_spike"] and "2,2× normal" in a[0].title
    assert it.evaluate_intraday([row(vol_today=35e6)], CFG, NOW) == []  # 1,75×
    assert it.evaluate_intraday([row(vol_today=45e6, minutes_open=10)], CFG, NOW) == []  # too early


def test_buy_level_and_breaking_news():
    assert kinds(it.evaluate_intraday([row(buy_below=125.5)], CFG, NOW)) == ["buy_level"]
    fresh = [{"headline": "Big contract", "source": "AP", "time": "2026-12-01T17:30:00+00:00"}]
    old = [{"headline": "Old", "source": "AP", "time": "2026-12-01T15:00:00+00:00"}]
    assert kinds(it.evaluate_intraday([row(news=fresh)], CFG, NOW)) == ["news"]
    assert it.evaluate_intraday([row(news=old)], CFG, NOW) == []


def test_day_stats_from_frames():
    daily = pd.DataFrame(
        {"Close": [100.0, 101.0, 102.0, 99.0, 98.0, 103.0], "Volume": [10, 20, 30, 40, 50, 5.0]},
        index=pd.date_range("2026-11-24", periods=6, freq="B"),
    )  # last bar = 1 Dec (today, partial)
    idx = pd.date_range("2026-12-01 09:30", periods=4, freq="5min", tz="America/New_York")
    intra = pd.DataFrame(
        {"Close": [99.0, 100.0, 101.0, 104.0], "Volume": [1, 2, 3, 4.0]}, index=idx
    )
    s = it.day_stats(daily, intra, date(2026, 12, 1))
    assert s["price"] == 104.0 and s["prev_close"] == 98.0 and s["vol_today"] == 10.0
    assert s["avg_vol20"] == pytest.approx(30.0)  # mean of the 5 completed days
    assert it.day_stats(daily, intra.iloc[0:0], date(2026, 12, 1)) is None


def test_volume_title_keeps_ticker_dots():
    a = it.evaluate_intraday([row(symbol="IWDA.AS", currency="EUR", vol_today=45e6)], CFG, NOW)
    assert a[0].title.startswith("📊 IWDA.AS volume 2,2× normal")

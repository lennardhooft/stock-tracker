"""Market hours (CLAUDE.md 7.3), including the weeks when US and EU daylight saving differ."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src import market_hours as mh


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_us_regular_session_winter():
    # Tue 1 Dec 2026: New York is UTC-5 → 09:30–16:00 = 14:30–21:00 UTC
    assert not mh.is_open("US", utc(2026, 12, 1, 14, 29))
    assert mh.is_open("US", utc(2026, 12, 1, 14, 30))
    assert mh.is_open("US", utc(2026, 12, 1, 20, 59))
    assert not mh.is_open("US", utc(2026, 12, 1, 21, 0))


def test_us_summer_time_shifts_utc_window():
    # Wed 1 Jul 2026: UTC-4 → 13:30–20:00 UTC
    assert mh.is_open("US", utc(2026, 7, 1, 13, 30))
    assert not mh.is_open("US", utc(2026, 7, 1, 20, 0))


def test_dst_mismatch_weeks():
    # Mon 16 Mar 2026: US already on summer time (UTC-4), Europe not yet (UTC+1)
    # → US opens 13:30 UTC = 14:30 Brussels (one hour earlier than usual for us)
    assert mh.is_open("US", utc(2026, 3, 16, 13, 30))
    assert mh.is_open("EU", utc(2026, 3, 16, 8, 0))  # 09:00 Brussels
    assert not mh.is_open("EU", utc(2026, 3, 16, 16, 30))  # 17:30 Brussels: closed


def test_weekends_and_holidays():
    assert not mh.is_open("US", utc(2026, 11, 21, 15, 0))  # Saturday
    assert not mh.is_open("US", utc(2026, 11, 26, 15, 0))  # Thanksgiving
    assert mh.is_open("EU", utc(2026, 11, 26, 10, 0))  # Euronext open that day
    assert not mh.is_open("EU", utc(2026, 4, 6, 10, 0))  # Easter Monday


def test_early_close():
    # Fri 27 Nov 2026: US closes 13:00 New York = 18:00 UTC
    assert mh.is_open("US", utc(2026, 11, 27, 17, 59))
    assert not mh.is_open("US", utc(2026, 11, 27, 18, 0))


def test_elapsed_fraction_and_minutes():
    # 1 Dec 2026, 17:45 UTC = 12:45 New York: 195 of 390 minutes → 0.5
    assert mh.elapsed_fraction("US", utc(2026, 12, 1, 17, 45)) == pytest.approx(0.5)
    assert mh.minutes_open("US", utc(2026, 12, 1, 15, 0)) == pytest.approx(30)
    assert mh.elapsed_fraction("US", utc(2026, 11, 21, 17, 45)) == 0.0  # weekend


def test_market_for():
    assert mh.market_for("ASML.AS") == "EU"
    assert mh.market_for("AAPL") == "US"
    assert mh.market_for("BRK-B", "US") == "US"

"""Fundamentals helpers (Phase 2C): hand-checked values, no network."""

from __future__ import annotations

from datetime import date, datetime, timezone

import pandas as pd
import pytest

from src import fundamentals as fu

TODAY = date(2026, 11, 22)


def test_is_us():
    assert fu.is_us("AAPL") and fu.is_us("BRK-B")
    assert not fu.is_us("ASML.AS") and not fu.is_us("ABI.BR")


def test_valuation_percentile_hand_checked():
    pts = [
        (f"{y}-12-31", v)
        for y, v in zip(range(2016, 2026), [20, 22, 25, 30, 35, 28, 18, 24, 26, 27])
    ]
    v = fu.valuation_from_points(pts, 19.0, today=TODAY)
    # values <= 19: only 18 → 1 of 10 = 10 %
    assert v["pct"] == 10.0 and v["min"] == 18 and v["max"] == 35 and v["n"] == 10
    assert v["years"] == pytest.approx(9.9, abs=0.1)
    assert fu.valuation_from_points(pts, 40.0, today=TODAY)["pct"] == 100.0


def test_valuation_needs_history_and_positive_now():
    pts = [("2024-12-31", 20), ("2025-12-31", 22)]
    assert fu.valuation_from_points(pts, 19, today=TODAY) is None  # < 3 points
    assert fu.valuation_from_points(pts * 3, -5, today=TODAY) is None  # losses
    old = [("2010-12-31", 10), ("2011-12-31", 12), ("2012-12-31", 14), ("2024-12-31", 20)]
    assert fu.valuation_from_points(old, 19, today=TODAY) is None  # only 1 point in 10 years


def test_daily_ratio_uses_figures_only_after_they_are_known():
    idx = pd.date_range("2024-01-01", "2025-06-30", freq="B")
    close = pd.Series(100.0, index=idx)
    pe = fu.daily_ratio_series(close, [("2023-12-31", 5.0), ("2024-12-31", 10.0)])
    assert (
        pd.Timestamp("2024-01-31") not in pe.index
    )  # FY2023 EPS only known ~60 days after year end
    assert pe.loc["2024-03-04"] == pytest.approx(20.0)  # now 100 / 5
    assert pe.loc["2025-02-03"] == pytest.approx(20.0)  # FY2024 not known yet (needs 60 days)
    assert pe.loc["2025-03-03"] == pytest.approx(10.0)  # now FY2024 EPS 10 counts
    assert fu.daily_ratio_series(close, [("2023-12-31", -2.0)]).empty  # losses left out


def test_insider_summary_open_market_only():
    txns = [
        {
            "name": "A. Ceo",
            "transactionCode": "P",
            "change": 1000,
            "transactionPrice": 100,
            "transactionDate": "2026-10-01",
        },
        {
            "name": "B. Cfo",
            "transactionCode": "S",
            "change": -200,
            "transactionPrice": 110,
            "transactionDate": "2026-11-01",
        },
        {
            "name": "C. Dir",
            "transactionCode": "A",
            "change": 5000,
            "transactionPrice": 0,
            "transactionDate": "2026-11-02",
        },  # grant
        {
            "name": "D. Old",
            "transactionCode": "P",
            "change": 300,
            "transactionPrice": 50,
            "transactionDate": "2026-07-01",
        },  # > 90 days
    ]
    s = fu.insider_summary(txns, today=TODAY)
    assert s["buy_value"] == 100000 and s["sell_value"] == 22000 and s["net_value"] == 78000
    assert s["buys"] == 1 and s["sells"] == 1
    assert [r["name"] for r in s["recent"]] == [
        "B. Cfo",
        "A. Ceo",
        "D. Old",
    ]  # 6-month list, newest first


def test_news_parsers():
    fh = [
        {"headline": " Old ", "source": "X", "url": "u1", "datetime": 1700000000},
        {"headline": "New", "source": "Y", "url": "u2", "datetime": 1800000000},
        {"headline": "", "url": "u3", "datetime": 1800000001},
    ]
    out = fu.parse_finnhub_news(fh)
    assert [n["headline"] for n in out] == ["New", "Old"]
    yh = [
        {
            "content": {
                "title": "EU news",
                "pubDate": "2026-11-21T09:00:00Z",
                "provider": {"displayName": "Reuters"},
                "canonicalUrl": {"url": "https://x"},
            }
        },
        {
            "title": "flat",
            "link": "https://y",
            "providerPublishTime": 1763600000,
            "publisher": "AP",
        },
    ]
    out = fu.parse_yahoo_news(yh)
    assert out[0]["headline"] == "EU news" and out[0]["source"] == "Reuters"
    assert out[1]["source"] == "AP"


def test_next_earnings_and_recent_headline():
    rows = [{"date": "2026-11-01"}, {"date": "2027-01-28"}, {"date": "2026-12-02"}]
    assert fu.next_earnings_from(rows, TODAY)["date"] == "2026-12-02"
    now = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)
    news = [
        {"headline": "fresh", "time": "2026-11-21T20:00:00+00:00"},
        {"headline": "stale", "time": "2026-11-10T00:00:00Z"},
    ]
    assert fu.recent_headline(news, now)["headline"] == "fresh"
    assert fu.recent_headline(news[1:], now) is None


def test_valuation_percentile_levels():
    from datetime import date

    from src.fundamentals import valuation_from_points

    pts = [(f"{2016 + i}-12-31", float(v)) for i, v in enumerate(range(10, 20))]
    v = valuation_from_points(pts, 15.0, today=date(2026, 6, 1))
    # numpy linear percentile of 10..19: p20 = 11.8, p80 = 17.2
    assert v["p20"] == 11.8 and v["p80"] == 17.2

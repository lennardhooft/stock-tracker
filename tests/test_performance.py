"""Returns vs benchmark (src/performance.py), hand-checked small cases."""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from src import performance as perf


def s(values, start="2026-01-05"):
    return pd.Series(values, index=pd.bdate_range(start, periods=len(values)), dtype=float)


def tx(d, sym, kind, q, p, cur="EUR", **kw):
    return {
        "date": d,
        "symbol": sym,
        "kind": kind,
        "quantity": q,
        "price": p,
        "currency": cur,
        **kw,
    }


def test_xirr_one_year_ten_percent():
    r = perf.xirr([(date(2025, 1, 1), -1000.0), (date(2026, 1, 1), 1100.0)])
    assert r == pytest.approx(0.10, abs=1e-4)


def test_xirr_needs_in_and_out():
    assert perf.xirr([(date(2025, 1, 1), -1000.0)]) is None


def test_twr_ignores_deposits():
    # day 1: buy 10 @ 100 (close 100); day 2: close 110 (+10 %);
    # day 3: buy 10 more @ 110, close 121 (+10 %)
    closes = {"AAA": s([100, 110, 121])}
    txs = [tx("2026-01-05", "AAA", "buy", 10, 100), tx("2026-01-07", "AAA", "buy", 10, 110)]
    df = perf.daily(txs, closes, {})
    assert list(df["F"]) == [1000, 0, 1100]
    assert list(df["V"]) == [1000, 1100, 2420]
    idx = perf.twr_index(df)
    # 0 %, +10 %, then (2420 / (1100 + 1100)) − 1 = +10 % → 121
    assert idx.iloc[-1] == pytest.approx(121.0)


def test_starting_position_enters_at_market_value():
    # imported at an average price of 50, but it closes at 100 that day: no fake +100 % return
    closes = {"AAA": s([100, 105])}
    df = perf.daily([tx("2026-01-05", "AAA", "start", 10, 50)], closes, {})
    assert df["F"].iloc[0] == 1000
    assert perf.twr_index(df).iloc[-1] == pytest.approx(105.0)


def test_usd_holding_in_eur_and_fees():
    closes = {"BBB": s([10.0, 11.0])}
    fx = {"USD": s([1.25, 1.10])}  # USD per EUR
    df = perf.daily([tx("2026-01-05", "BBB", "buy", 100, 10.0, "USD", fees=5, taxes=0)], closes, fx)
    assert df["F"].iloc[0] == pytest.approx(1005 / 1.25)
    assert df["V"].iloc[1] == pytest.approx(1100 / 1.10)


def test_sell_and_dividend_are_money_out():
    closes = {"AAA": s([100, 100, 100])}
    txs = [
        tx("2026-01-05", "AAA", "buy", 10, 100),
        tx("2026-01-06", "AAA", "dividend", 10, 2, taxes=6),
        tx("2026-01-07", "AAA", "sell", 5, 100, fees=10),
    ]
    df = perf.daily(txs, closes, {})
    assert list(df["F"]) == [1000, -14, -490]
    assert list(df["V"]) == [1000, 1000, 500]
    # the dividend is a return: (1000 / (1000 − 14)) − 1 ≈ +1,42 %
    assert perf.twr_index(df).iloc[1] == pytest.approx(100 * 1000 / 986)


def test_what_if_same_money_into_benchmark():
    closes = {"AAA": s([100, 100, 100])}
    bench = s([50, 55, 60])
    txs = [tx("2026-01-05", "AAA", "buy", 10, 100), tx("2026-01-06", "AAA", "buy", 11, 100)]
    df = perf.daily(txs, closes, {})
    wi = perf.what_if(df, bench)
    # 1000/50 = 20 units, + 1100/55 = 20 → 40 units × 60 = 2400
    assert wi.iloc[-1] == pytest.approx(2400.0)


def test_missing_price_uses_trade_price():
    df = perf.daily(
        [tx("2026-01-05", "NEW", "buy", 10, 20)], {"NEW": None}, {}, end=date(2026, 1, 7)
    )
    assert list(df["V"]) == [200, 200, 200]


def test_build_periods_and_benchmark():
    closes = {"AAA": s([100] * 5 + [110])}
    bench = s([200] * 5 + [210])
    out = perf.build(
        [tx("2026-01-05", "AAA", "buy", 10, 100)], closes, {}, bench, {"AAA": "stock"}, "IWDA.AS"
    )
    assert out["periods"]["all"]["you"] == pytest.approx(10.0)
    assert out["periods"]["all"]["bench"] == pytest.approx(5.0)
    assert out["periods"]["3y"]["you"] is None  # starts before the first trade
    assert out["what_if"] == pytest.approx(1050.0)
    assert out["difference"] == pytest.approx(50.0)
    assert out["parts"]["satellite"]["all"] == pytest.approx(10.0)
    assert out["series"]["t"][-1] == "2026-01-12" and out["series"]["you"][-1] == pytest.approx(
        110.0
    )


def test_build_without_transactions():
    assert perf.build([], {}, {}, None, {}, "IWDA.AS") is None


def test_history_period_covers_first_trade():
    assert perf.history_period(date(2026, 11, 10), date(2026, 11, 22)) == "1mo"
    assert perf.history_period(date(2024, 3, 1), date(2026, 11, 22)) == "5y"

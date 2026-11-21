from __future__ import annotations

import pandas as pd

from src import data_checks as dc

CFG = {"max_daily_move": 0.40, "stale_days": 3, "max_gap_business_days": 5}


def _df(closes, splits=None, start="2024-01-01"):
    idx = pd.date_range(start, periods=len(closes), freq="B")
    return pd.DataFrame(
        {"Close": closes, "Splits": splits or [0.0] * len(closes)}, index=idx, dtype=float
    )


def test_clean_series_is_green():
    r = dc.check_daily(_df([100 + i for i in range(30)]), CFG)
    assert r.status == "green" and len(r.clean) == 30


def test_nonpositive_removed():
    r = dc.check_daily(_df([100, 101, 0, 102, 103]), CFG)
    assert r.status == "red" and (r.clean["Close"] > 0).all()


def test_recent_unexplained_jump_is_suspect_and_excluded():
    closes = [100 + i * 0.1 for i in range(20)] + [200]
    r = dc.check_daily(_df(closes), CFG)
    assert r.suspect_dates and r.status == "red"
    assert len(r.clean) == 20  # last bar dropped


def test_suspect_confirmed_on_next_run():
    closes = [100 + i * 0.1 for i in range(20)] + [200]
    first = dc.check_daily(_df(closes), CFG)
    second = dc.check_daily(_df(closes), CFG, previously_suspect=set(first.suspect_dates))
    assert not second.suspect_dates and len(second.clean) == 21


def test_split_explains_big_move():
    closes = [100 + i * 0.1 for i in range(20)] + [25]
    splits = [0.0] * 20 + [4.0]
    r = dc.check_daily(_df(closes, splits), CFG)
    assert not r.suspect_dates and any(i["code"] == "split" for i in r.issues)


def test_stale_prices_warn():
    r = dc.check_daily(_df([100, 101, 102, 102, 102, 102]), CFG)
    assert any(i["code"] == "stale" for i in r.issues) and r.status == "yellow"


def test_gap_warns():
    idx = list(pd.date_range("2024-01-01", periods=10, freq="B")) + list(
        pd.date_range("2024-02-01", periods=10, freq="B")
    )
    df = pd.DataFrame({"Close": [100.0 + i for i in range(20)]}, index=pd.DatetimeIndex(idx))
    r = dc.check_daily(df, CFG)
    assert any(i["code"] == "gap" for i in r.issues)


def test_minor_currency():
    assert dc.normalize_currency("GBp")[:2] == ("GBP", 100.0)
    assert dc.normalize_currency("USD") == ("USD", 1.0, None)

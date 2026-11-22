"""Generate web/fixtures/detail.json: FAKE chart data for the demo app and UI tests.

Synthetic prices for the fictional fixture companies are run through the real pipeline
(src/levels.py, src/score.py), so the demo shows exactly what the daily job would store.

    python scripts/make_fixtures.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import indicators as ind  # noqa: E402
from src import levels, score  # noqa: E402

WEEKS = 520
EMPTY = {"source": None, "valuation": None, "insiders": None, "news": [], "earnings": None}
_N = "https://example.com/fake-news/"
FUNDAMENTALS = {  # FAKE: invented numbers and headlines for fictional companies
    "NRDX": {
        "source": "Finnhub",
        "valuation": {
            "metric": "pe",
            "now": 18.2,
            "pct": 12.0,
            "min": 14.1,
            "max": 41.7,
            "n": 10,
            "years": 9.8,
        },
        "insiders": {
            "net_value": 2140000,
            "buy_value": 2400000,
            "sell_value": 260000,
            "buys": 3,
            "sells": 1,
            "days": 90,
            "recent": [
                {
                    "date": "2026-11-12",
                    "name": "Jane Ortega (CEO)",
                    "kind": "buy",
                    "shares": 12000,
                    "price": 121.5,
                    "value": 1458000,
                },
                {
                    "date": "2026-11-05",
                    "name": "Tom Baker (Director)",
                    "kind": "buy",
                    "shares": 5000,
                    "price": 124.0,
                    "value": 620000,
                },
                {
                    "date": "2026-10-20",
                    "name": "Ali Chen (CFO)",
                    "kind": "sell",
                    "shares": 2000,
                    "price": 130.0,
                    "value": 260000,
                },
            ],
        },
        "news": [
            {
                "headline": "Nordex cuts full-year guidance as chip demand cools",
                "source": "Fake Wire",
                "url": _N + "1",
                "time": "2026-11-20T21:15:00+00:00",
            },
            {
                "headline": "Analysts split on Nordex after sharp sell-off",
                "source": "Example Times",
                "url": _N + "2",
                "time": "2026-11-19T08:00:00+00:00",
            },
            {
                "headline": "Nordex insiders buy shares after the drop",
                "source": "Demo News",
                "url": _N + "3",
                "time": "2026-11-13T15:30:00+00:00",
            },
        ],
        "earnings": {"date": "2026-11-26", "hour": "amc", "eps_est": 1.24, "source": "Finnhub"},
    },
    "BLMT.BR": {
        "source": "Yahoo",
        "insiders": None,
        "insiders_na": "eu",
        "valuation": {
            "metric": "pe",
            "now": 14.8,
            "pct": 45.0,
            "min": 10.2,
            "max": 22.9,
            "n": 44,
            "years": 3.6,
        },
        "news": [
            {
                "headline": "Belmont Chemicals confirms targets despite weaker volumes",
                "source": "Fake Wire",
                "url": _N + "4",
                "time": "2026-11-18T07:00:00+00:00",
            }
        ],
        "earnings": {"date": "2027-02-19", "hour": None, "eps_est": None, "source": "Yahoo"},
    },
    "ORCA": {
        "source": "Finnhub",
        "valuation": {
            "metric": "ps",
            "now": 11.4,
            "pct": 88.0,
            "min": 5.2,
            "max": 13.0,
            "n": 8,
            "years": 7.9,
        },
        "insiders": {
            "net_value": -3800000,
            "buy_value": 0,
            "sell_value": 3800000,
            "buys": 0,
            "sells": 4,
            "days": 90,
            "recent": [],
        },
        "news": [],
        "earnings": None,
    },
}


def synthetic_daily(seed: int, last: float, from_high_pct: float) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    days = pd.bdate_range(end="2026-11-20", periods=WEEKS * 5 + 260)
    n = len(days)
    # long-term uptrend with two deep corrections, then the last year from the high to `last`
    t = np.linspace(0, 1, n - 252)
    trend = (
        np.exp(1.6 * t)
        * (1 - 0.35 * np.exp(-((t - 0.35) ** 2) / 0.003))
        * (1 - 0.30 * np.exp(-((t - 0.72) ** 2) / 0.002))
    )
    noise = np.exp(np.cumsum(rng.normal(0, 0.012, n - 252)))
    body = trend * noise / (trend[-1] * noise[-1])
    high = last / (1 + from_high_pct / 100)
    last_year = np.linspace(high, last, 252) * np.exp(rng.normal(0, 0.01, 252))
    last_year[-1] = last
    close = np.concatenate([body * high, last_year])
    spread = np.abs(rng.normal(0, 0.012, n))
    df = pd.DataFrame(
        {
            "Open": close * (1 + rng.normal(0, 0.004, n)),
            "High": close * (1 + spread),
            "Low": close * (1 - spread),
            "Close": close,
        },
        index=days,
    )
    df["High"] = df[["Open", "High", "Close"]].max(axis=1)
    df["Low"] = df[["Open", "Low", "Close"]].min(axis=1)
    return df


def main() -> None:
    cfg = yaml.safe_load((ROOT / "config" / "scoring.yaml").read_text())
    app = json.loads((ROOT / "web" / "fixtures" / "app.json").read_text())
    out = {}
    for i, s in enumerate(app["stocks"]):
        if s.get("price") is None:
            continue
        daily = synthetic_daily(100 + i, s["price"], s["pct_from_52w_high"])
        vix = pd.Series(np.where(np.arange(len(daily)) % 900 < 60, 34.0, 17.0), index=daily.index)
        wk = levels.resample_ohlc(daily, "W-FRI").iloc[-WEEKS:]
        sma = ind.sma(ind.to_weekly(daily["Close"]), 200).reindex(wk.index)
        hist = score.weekly_score_history(daily["Close"], vix, cfg).reindex(wk.index)

        def r(x, nd=2):
            return [None if pd.isna(v) else round(float(v), nd) for v in x]

        out[s["symbol"]] = {
            "weekly": {
                "t": [d.strftime("%Y-%m-%d") for d in wk.index],
                "o": r(wk["Open"]),
                "h": r(wk["High"]),
                "l": r(wk["Low"]),
                "c": r(wk["Close"]),
                "sma200": r(sma),
                "score": r(hist, 0),
                "levels": levels.detect_levels(daily, cfg["levels"]),
            },
            "fundamentals": FUNDAMENTALS.get(s["symbol"], EMPTY),
        }
    path = ROOT / "web" / "fixtures" / "detail.json"
    data = {"_note": "FAKE synthetic data for demo/tests", **out}
    path.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB, {len(out)} tickers)")


if __name__ == "__main__":
    main()

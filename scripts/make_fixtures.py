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

from src import events, levels, quality, score, top_score  # noqa: E402
from src import indicators as ind  # noqa: E402

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
            "p20": 17.9,
            "p80": 31.5,
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
            "p20": 12.1,
            "p80": 19.4,
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
    vol = rng.lognormal(13, 0.25, n)
    vol[rng.choice(n, 25, replace=False)] *= 3.5  # a few volume spikes
    df["Volume"] = vol.round()
    return df


def fake_years(profile: str, n: int = 5) -> list[dict]:
    """FAKE annual figures (newest first) with a given character, run through src/quality.py."""
    rows = []
    for i in range(n):
        if profile == "strong":  # growing, cash-rich, high ROIC
            g = 1.12**-i
            y = {
                "revenue": 1000 * g,
                "gross_profit": 620 * g * (1 - 0.004 * i),
                "operating_income": 300 * g,
                "net_income": 240 * g,
                "ebit": 300 * g,
                "ebitda": 350 * g,
                "interest_expense": 4.0,
                "ocf": 330 * g,
                "fcf": 270 * g,
                "shares": 100 * 1.008**i,
                "total_debt": 150.0,
                "cash": 500.0,
                "equity": 900 * g,
                "long_term_debt": 150.0 + 5 * i,
            }
        elif profile == "medium":  # flat sales, some debt, a bad FCF year
            g = 1.01**-i
            y = {
                "revenue": 1000 * g,
                "gross_profit": 300 * g * (1 + 0.02 * (i % 2)),
                "operating_income": 90 * g * (1 + 0.05 * i),
                "net_income": 55 * g,
                "ebit": 90 * g,
                "ebitda": 150 * g,
                "interest_expense": 22.0,
                "ocf": 120 * g,
                "fcf": (-20 if i == 1 else 40) * g,
                "shares": 100 * 0.995**i,
                "total_debt": 520.0,
                "cash": 100.0,
                "equity": 800.0,
                "long_term_debt": 480.0,
            }
        else:  # "weak": shrinking, indebted, burning cash, diluting
            g = 0.93**-i
            y = {
                "revenue": 1000 * g,
                "gross_profit": 280 * g * (1 + 0.03 * i),
                "operating_income": (10 + 25 * i) * g,
                "net_income": (-30 + 20 * i) * g,
                "ebit": (10 + 25 * i) * g,
                "ebitda": 90 * g,
                "interest_expense": 45.0,
                "ocf": (15 if i else -10) * g,
                "fcf": (-40 if i < 3 else 10) * g,
                "shares": 100 * 0.94**i,
                "total_debt": 900.0,
                "cash": 40.0,
                "equity": 300.0,
                "long_term_debt": 850.0 - 30 * i,
            }
        y.update(
            {
                "year": f"{2025 - i}-12-31",
                "tax_rate": 0.24,
                "total_assets": 2000.0,
                "current_assets": 700.0,
                "current_liabilities": 400.0 + 15 * i,
                "total_liabilities": 1100.0,
                "retained_earnings": 500.0,
            }
        )
        rows.append(y)
    return rows


# market caps in the same (fake) units as the statements above
QUALITY_PROFILE = {
    "NRDX": ("strong", 6000),
    "ORCA": ("strong", 9000),
    "BLMT.BR": ("medium", 1500),
    "HALD": ("weak", 250),
    "VLTA.AS": ("medium", 1200),
}
QUALITY_NA = {"WORLD.AS": "etf", "NEWCO": "too_few_parts"}


def fixture_quality(symbol: str) -> dict:
    if symbol in QUALITY_NA:
        return {"score": None, "label": None, "na": QUALITY_NA[symbol], "parts": []}
    profile, mcap = QUALITY_PROFILE.get(symbol, ("medium", 1e9))
    out = quality.build_quality(
        fake_years(profile), market_cap=mcap, financial=False, cfg=CFG_QUALITY
    )
    out["source"] = "Yahoo"
    return out


CFG_QUALITY: dict = {}


def fake_earnings(seed: int, close: pd.Series) -> dict | None:
    """FAKE quarterly reports (after the close) over the last 2 years, through src/events.py."""
    rng = np.random.default_rng(seed + 7)
    days = close.index[-504::63][:8]
    reports = []
    for d in days:
        est = round(float(rng.uniform(0.5, 2.0)), 2)
        reports.append(
            {
                "date": d.strftime("%Y-%m-%d"),
                "hour": "amc",
                "eps_est": est,
                "eps_actual": round(est * float(rng.uniform(0.9, 1.15)), 2),
            }
        )
    out = events.earnings_reactions(reports, close)
    return out if out["n"] else None


def main() -> None:
    cfg = yaml.safe_load((ROOT / "config" / "scoring.yaml").read_text())
    CFG_QUALITY.update(cfg.get("quality") or {})
    app_path = ROOT / "web" / "fixtures" / "app.json"
    app = json.loads(app_path.read_text())
    out = {}
    for i, s in enumerate(app["stocks"]):
        if s.get("price") is None:
            continue
        daily = synthetic_daily(100 + i, s["price"], s["pct_from_52w_high"])
        q = fixture_quality(s["symbol"])
        vix = pd.Series(np.where(np.arange(len(daily)) % 900 < 60, 34.0, 17.0), index=daily.index)
        wk = levels.resample_ohlc(daily, "W-FRI").iloc[-WEEKS:]
        sma = ind.sma(ind.to_weekly(daily["Close"]), 200).reindex(wk.index)
        hist = score.weekly_score_history(daily["Close"], vix, cfg).reindex(wk.index)
        top_hist = top_score.weekly_top_history(daily["Close"], cfg).reindex(wk.index)
        vol = daily["Volume"].resample("W-FRI").sum().reindex(wk.index)

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
                "top": r(top_hist, 0),
                "v": r(vol, 0),
                "levels": levels.detect_levels(daily, cfg["levels"]),
            },
            "fundamentals": {
                **FUNDAMENTALS.get(s["symbol"], EMPTY),
                "quality": q,
                "earnings_history": fake_earnings(i, daily["Close"])
                if s["symbol"] not in QUALITY_NA or s["symbol"] == "NEWCO"
                else None,
            },
        }
        s["quality"] = quality.summary(q)
        s["verdict"] = quality.verdict(s.get("score"), q, float(cfg.get("alert_threshold", 4)))
    app_path.write_text(json.dumps(app, indent=2, ensure_ascii=False) + "\n")
    path = ROOT / "web" / "fixtures" / "detail.json"
    data = {"_note": "FAKE synthetic data for demo/tests", **out}
    path.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB, {len(out)} tickers)")


if __name__ == "__main__":
    main()

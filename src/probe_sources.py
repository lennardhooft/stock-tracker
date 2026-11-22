"""Probe what the free data sources deliver (run from GitHub: Actions → probe → Run).

Uses well-known public tickers only (not the owner's watchlist) and prints only HTTP status,
item counts and which fields are present — never values, never the API key.

    python -m src.probe_sources
"""

from __future__ import annotations

import os
from datetime import date, timedelta

import requests

from src import log

BASE = "https://finnhub.io/api/v1"
SAMPLES = {"US": "AAPL", "EU-Paris": "MC.PA", "EU-Xetra": "SAP.DE", "EU-Brussels": "ABI.BR"}


def get(path: str, **params) -> tuple[int, object]:
    r = requests.get(
        f"{BASE}{path}",
        params=params,
        timeout=20,
        headers={"X-Finnhub-Token": os.environ.get("FINNHUB_API_KEY", "")},
    )
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, None


def describe(data: object) -> str:
    if isinstance(data, list):
        return f"list[{len(data)}]"
    if isinstance(data, dict):
        if "error" in data:
            return "error"
        parts = []
        for k, v in data.items():
            if isinstance(v, list):
                parts.append(f"{k}[{len(v)}]")
            elif isinstance(v, dict):
                parts.append(f"{k}{{{','.join(sorted(v)[:6])}}}")
            else:
                parts.append(k)
        return ", ".join(parts[:8])
    return type(data).__name__


def main() -> None:
    today = date.today()
    for region, sym in SAMPLES.items():
        log.info(f"--- {region} ({sym})")
        checks = {
            "metric": ("/stock/metric", {"symbol": sym, "metric": "all"}),
            "insider": ("/stock/insider-transactions", {"symbol": sym}),
            "news": (
                "/company-news",
                {"symbol": sym, "from": str(today - timedelta(days=14)), "to": str(today)},
            ),
            "earnings": (
                "/calendar/earnings",
                {"symbol": sym, "from": str(today), "to": str(today + timedelta(days=120))},
            ),
        }
        for name, (path, params) in checks.items():
            status, data = get(path, **params)
            extra = ""
            if name == "metric" and isinstance(data, dict):
                q = (data.get("series") or {}).get("quarterly") or {}
                a = (data.get("series") or {}).get("annual") or {}
                qpe, ape, qps = len(q.get("pe", [])), len(a.get("pe", [])), len(q.get("ps", []))
                extra = f" | quarterly pe points: {qpe}, annual pe: {ape}, quarterly ps: {qps}"
            if name == "insider" and isinstance(data, dict):
                extra = f" | transactions: {len(data.get('data') or [])}"
            if name == "earnings" and isinstance(data, dict):
                extra = f" | upcoming: {len(data.get('earningsCalendar') or [])}"
            log.info(f"{name:9} HTTP {status}  {describe(data)}{extra}")

    # yfinance fallbacks for EU
    import yfinance as yf

    probes = {
        "news": lambda t: len(t.news or []),
        "calendar": lambda t: ",".join(sorted((t.calendar or {}).keys()))[:60],
        "earnings_dates": lambda t: len(t.get_earnings_dates(limit=12) or []),
        "trailingPE": lambda t: "yes" if (t.info or {}).get("trailingPE") else "no",
        "quarterly_income": lambda t: t.quarterly_income_stmt.shape[1],
        "annual_income": lambda t: t.income_stmt.shape[1],
        "insider": lambda t: len(t.insider_transactions or []),
    }
    for region, sym in SAMPLES.items():
        ticker = yf.Ticker(sym)
        res = {}
        for name, fn in probes.items():
            try:
                res[name] = fn(ticker)
            except Exception as e:  # noqa: BLE001
                res[name] = f"ERR {type(e).__name__}"
        log.info(f"yfinance {region}: {res}")


if __name__ == "__main__":
    main()

"""Fundamentals, insiders, news and earnings dates (CLAUDE.md 6.2, 13.1, 13.3) — Phase 2C.

Sources (measured with src/probe_sources.py on the free tiers):
  * US stocks: Finnhub — annual P/E history, insider transactions, company news, earnings calendar.
  * EU stocks: Finnhub's free tier refuses them (HTTP 403), so Yahoo (yfinance) is used:
    annual EPS/revenue (4–5 years) for a valuation history, the latest 10 headlines and the
    earnings calendar. There is no free insider source for EU stocks → "n/a" with that reason.

Pure helpers (tested in tests/test_fundamentals.py) do the maths; the fetchers never raise and
return None for anything they could not get. Nothing here prints tickers or values.
"""

from __future__ import annotations

import os
import time as _time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd
import requests

from src import log
from src.fetch import HTTP_TIMEOUT, with_retries

FINNHUB = "https://finnhub.io/api/v1"
REPORT_LAG_DAYS = 60  # annual figures become known ~2 months after the fiscal year ends
OPEN_MARKET = {"P": "buy", "S": "sell"}  # Form 4 codes; grants (A), exercises (M) etc. are ignored


def is_us(symbol: str) -> bool:
    """US listings have no exchange suffix (BRK-B is US, ASML.AS is not)."""
    return "." not in symbol


# ====================================================================== pure helpers


def valuation_from_points(
    points: list[tuple[str, float]],
    now: float | None,
    *,
    years: int = 10,
    today: date | None = None,
) -> dict[str, Any] | None:
    """Percentile of `now` within its own history of (date, value) points over `years`.

    Returns {now, pct, min, max, p20, p80, n, years} or None when there's nothing usable.
    pct = % of historical values at or below `now` (low = cheap vs its own history).
    p20 / p80 = its own 20th / 80th percentile (the chart's cheap / expensive levels).
    """
    today = today or date.today()
    cutoff = (today - timedelta(days=365 * years)).isoformat()
    vals = [v for d, v in points if d >= cutoff and v is not None and np.isfinite(v) and v > 0]
    if now is None or not np.isfinite(now) or now <= 0 or len(vals) < 3:
        return None
    first = min(d for d, v in points if d >= cutoff and v and v > 0)
    span = round((today - date.fromisoformat(first[:10])).days / 365.25, 1)
    return {
        "now": round(float(now), 2),
        "pct": round(float(sum(1 for v in vals if v <= now) / len(vals) * 100), 1),
        "min": round(float(min(vals)), 2),
        "max": round(float(max(vals)), 2),
        "p20": round(float(np.percentile(vals, 20)), 2),
        "p80": round(float(np.percentile(vals, 80)), 2),
        "n": len(vals),
        "years": span,
    }


def daily_ratio_series(close: pd.Series, per_share: list[tuple[str, float]]) -> pd.Series:
    """Daily price ÷ the latest *known* annual per-share figure (EPS or sales/share).

    A fiscal-year figure only counts REPORT_LAG_DAYS after the year ends (no look-ahead).
    Days where the figure is ≤ 0 (losses) are left out.
    """
    if close.empty or not per_share:
        return pd.Series(dtype=float)
    known = pd.Series(
        {
            pd.Timestamp(d) + pd.Timedelta(days=REPORT_LAG_DAYS): v
            for d, v in per_share
            if v is not None
        }
    ).sort_index()
    step = known.reindex(close.index.union(known.index)).ffill().reindex(close.index)
    ratio = close / step
    return ratio[(step > 0) & ratio.notna()]


def insider_summary(
    txns: list[dict[str, Any]], *, today: date | None = None, days: int = 90, months: int = 6
) -> dict[str, Any]:
    """Open-market insider buys/sells (Finnhub). Net value over `days`, list over `months`."""
    today = today or date.today()
    recent_cut = (today - timedelta(days=months * 31)).isoformat()
    window_cut = (today - timedelta(days=days)).isoformat()
    rows = []
    for t in txns:
        code = t.get("transactionCode")
        if code not in OPEN_MARKET:
            continue
        d = (t.get("transactionDate") or t.get("filingDate") or "")[:10]
        shares = float(t.get("change") or 0)
        price = float(t.get("transactionPrice") or 0)
        if not d or d < recent_cut or shares == 0:
            continue
        rows.append(
            {
                "date": d,
                "name": t.get("name") or "",
                "kind": OPEN_MARKET[code],
                "shares": abs(shares),
                "price": round(price, 2),
                "value": round(abs(shares) * price, 2),
            }
        )
    rows.sort(key=lambda r: r["date"], reverse=True)
    win = [r for r in rows if r["date"] >= window_cut]
    buys = sum(r["value"] for r in win if r["kind"] == "buy")
    sells = sum(r["value"] for r in win if r["kind"] == "sell")
    return {
        "net_value": round(buys - sells, 2),
        "buy_value": round(buys, 2),
        "sell_value": round(sells, 2),
        "buys": sum(1 for r in win if r["kind"] == "buy"),
        "sells": sum(1 for r in win if r["kind"] == "sell"),
        "days": days,
        "recent": rows[:15],
    }


def parse_finnhub_news(items: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    out = []
    for n in sorted(items or [], key=lambda x: x.get("datetime") or 0, reverse=True):
        if not n.get("headline") or not n.get("url"):
            continue
        out.append(
            {
                "headline": n["headline"].strip(),
                "source": n.get("source") or "",
                "url": n["url"],
                "time": datetime.fromtimestamp(int(n["datetime"]), tz=timezone.utc).isoformat(),
            }
        )
        if len(out) >= limit:
            break
    return out


def parse_yahoo_news(items: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    """yfinance news, new format {content: {title, pubDate, provider, canonicalUrl}} or old flat."""
    out = []
    for n in items or []:
        c = n.get("content") or n
        title = c.get("title")
        url = (
            (c.get("canonicalUrl") or {}).get("url")
            or (c.get("clickThroughUrl") or {}).get("url")
            or c.get("link")
        )
        when = c.get("pubDate") or c.get("displayTime")
        if not when and c.get("providerPublishTime"):
            when = datetime.fromtimestamp(
                int(c["providerPublishTime"]), tz=timezone.utc
            ).isoformat()
        source = (c.get("provider") or {}).get("displayName") or c.get("publisher") or ""
        if title and url and when:
            out.append({"headline": title.strip(), "source": source, "url": url, "time": str(when)})
    out.sort(key=lambda x: x["time"], reverse=True)
    return out[:limit]


def next_earnings_from(
    rows: list[dict[str, Any]], today: date | None = None
) -> dict[str, Any] | None:
    """Earliest earnings date on/after today from rows {date, hour?, eps_est?, source}."""
    today = today or date.today()
    future = sorted(
        (r for r in rows if r.get("date") and r["date"] >= today.isoformat()),
        key=lambda r: r["date"],
    )
    return future[0] if future else None


def recent_headline(
    news: list[dict[str, Any]], now: datetime, hours: int = 48
) -> dict[str, Any] | None:
    """Most recent headline from the last `hours` ("why is it down?", 13.1)."""
    cut = now - timedelta(hours=hours)
    for n in news or []:
        try:
            t = datetime.fromisoformat(n["time"].replace("Z", "+00:00"))
        except (ValueError, KeyError):
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        if t >= cut:
            return n
    return None


# ====================================================================== fetchers (never raise)

_last_call = 0.0


def _finnhub(path: str, **params: Any) -> Any:
    """GET from Finnhub with the key in a header (never in a URL), ≤ ~55 calls per minute."""
    global _last_call
    key = os.environ.get("FINNHUB_API_KEY")
    if not key:
        return None
    wait = 1.1 - (_time.monotonic() - _last_call)
    if wait > 0:
        _time.sleep(wait)

    def _call() -> Any:
        global _last_call
        _last_call = _time.monotonic()
        r = requests.get(
            f"{FINNHUB}{path}",
            params=params,
            headers={"X-Finnhub-Token": key},
            timeout=HTTP_TIMEOUT,
        )
        if r.status_code == 403:  # not on the free tier: don't retry
            return {"_forbidden": True}
        r.raise_for_status()
        return r.json()

    out = with_retries(_call, f"finnhub {path.split('/')[-1]}")
    return None if isinstance(out, dict) and out.get("_forbidden") else out


def _us_bundle(symbol: str, close: pd.Series, today: date) -> dict[str, Any]:
    out: dict[str, Any] = {"source": "Finnhub"}
    metric = _finnhub("/stock/metric", symbol=symbol, metric="all") or {}
    m = metric.get("metric") or {}
    annual = (metric.get("series") or {}).get("annual") or {}
    pe_pts = [(p["period"], p.get("v")) for p in annual.get("pe", []) if p.get("period")]
    pe_now = m.get("peTTM") or m.get("peBasicExclExtraTTM")
    val = valuation_from_points(pe_pts, pe_now, today=today) if pe_now and pe_now > 0 else None
    if val:
        val["metric"] = "pe"
    else:  # losses → P/S (6.2)
        ps_pts = [(p["period"], p.get("v")) for p in annual.get("ps", []) if p.get("period")]
        val = valuation_from_points(ps_pts, m.get("psTTM"), today=today)
        if val:
            val["metric"] = "ps"
    out["valuation"] = val
    ins = _finnhub("/stock/insider-transactions", symbol=symbol)
    out["insiders"] = (
        insider_summary((ins or {}).get("data") or [], today=today) if ins is not None else None
    )
    news = _finnhub(
        "/company-news",
        symbol=symbol,
        **{"from": str(today - timedelta(days=14)), "to": str(today)},
    )
    out["news"] = parse_finnhub_news(news or [])
    cal = _finnhub(
        "/calendar/earnings",
        symbol=symbol,
        **{"from": str(today), "to": str(today + timedelta(days=120))},
    )
    rows = [
        {
            "date": e.get("date"),
            "hour": e.get("hour") or None,
            "eps_est": e.get("epsEstimate"),
            "source": "Finnhub",
        }
        for e in (cal or {}).get("earningsCalendar") or []
    ]
    out["earnings"] = next_earnings_from(rows, today)
    return out


def _yahoo_bundle(symbol: str, close: pd.Series, today: date) -> dict[str, Any]:
    import yfinance as yf

    t = yf.Ticker(symbol)
    # no free insider source for EU; for US stocks this path only runs without a Finnhub key
    out: dict[str, Any] = {
        "source": "Yahoo",
        "insiders": None,
        "insiders_na": "eu" if not is_us(symbol) else "no_key",
    }

    def _stmt() -> pd.DataFrame:
        df = t.income_stmt
        return (
            df if df is not None else pd.DataFrame()
        )  # empty = no figures (e.g. an ETF): no retry

    inc = with_retries(_stmt, "annual statements")
    if inc is not None and inc.empty:
        inc = None
    val = None
    if inc is not None:
        eps = inc.loc["Diluted EPS"] if "Diluted EPS" in inc.index else None
        if eps is not None:
            pts = [(str(pd.Timestamp(c).date()), float(v)) for c, v in eps.items() if pd.notna(v)]
            series = daily_ratio_series(close, pts)
            if len(series) and pts and sorted(pts)[-1][1] > 0:
                monthly = series.resample("ME").last().dropna()
                val = valuation_from_points(
                    [(str(d.date()), float(v)) for d, v in monthly.items()],
                    float(series.iloc[-1]),
                    today=today,
                )
                if val:
                    val["metric"] = "pe"
        if val is None and {"Total Revenue", "Diluted Average Shares"} <= set(inc.index):
            sps = (inc.loc["Total Revenue"] / inc.loc["Diluted Average Shares"]).dropna()
            pts = [(str(pd.Timestamp(c).date()), float(v)) for c, v in sps.items()]
            series = daily_ratio_series(close, pts)
            if len(series):
                monthly = series.resample("ME").last().dropna()
                val = valuation_from_points(
                    [(str(d.date()), float(v)) for d, v in monthly.items()],
                    float(series.iloc[-1]),
                    today=today,
                )
                if val:
                    val["metric"] = "ps"
    out["valuation"] = val
    out["news"] = parse_yahoo_news(with_retries(lambda: t.news or [], "yahoo news") or [])
    cal = with_retries(lambda: t.calendar or {}, "yahoo calendar") or {}
    dates = cal.get("Earnings Date") or []
    rows = [
        {
            "date": str(d)[:10],
            "hour": None,
            "eps_est": cal.get("Earnings Average"),
            "source": "Yahoo",
        }
        for d in dates
    ]
    out["earnings"] = next_earnings_from(rows, today)
    return out


def collect(symbol: str, close: pd.Series, today: date | None = None) -> dict[str, Any]:
    """Everything for one ticker. Never raises; missing parts are None."""
    today = today or date.today()
    try:
        if is_us(symbol) and os.environ.get("FINNHUB_API_KEY"):
            data = _us_bundle(symbol, close, today)
        else:
            data = _yahoo_bundle(symbol, close, today)
    except Exception as exc:  # noqa: BLE001 — one ticker must never crash the run
        log.error(f"fundamentals: failed ({log.exc_kind(exc)})")
        data = {"source": None, "valuation": None, "insiders": None, "news": [], "earnings": None}
    data["as_of"] = today.isoformat()
    return data

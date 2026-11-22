"""Upcoming events and earnings reactions (CLAUDE.md 13.1, 13.3) — Phase 2G.

* Earnings reaction history: for the last reports, EPS actual vs estimate and how the stock moved
  the trading day after (+1) and over 5 trading days, plus the average absolute move.
* Next earnings date with time (before the open / after the close) from Yahoo's earnings dates.
* Next dividend (ex-date, pay date, amount); when Yahoo only knows a past ex-date, the next one is
  estimated from the usual gap between payments.
* Fed and ECB rate decisions from config/macro_events.yaml (copied from the official calendars).

Pure functions (tested in tests/test_events.py) + one fetcher that never raises.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yaml

from src import log
from src.fetch import with_retries

ROOT = Path(__file__).resolve().parents[1]

# exchange time zone and regular close (EU: all main Euronext/Xetra venues close 17:30 CET)
US_TZ, US_CLOSE = ZoneInfo("America/New_York"), (16, 0)
EU_TZ, EU_CLOSE = ZoneInfo("Europe/Brussels"), (17, 30)
US_OPEN, EU_OPEN = (9, 30), (9, 0)


def _market(us: bool) -> tuple[ZoneInfo, tuple[int, int], tuple[int, int]]:
    return (US_TZ, US_CLOSE, US_OPEN) if us else (EU_TZ, EU_CLOSE, EU_OPEN)


def report_timing(ts: pd.Timestamp, us: bool) -> tuple[date, str | None]:
    """(local report date, "bmo" | "amc" | None) in the exchange's own time zone.

    Yahoo gives a time; 00:00 local usually means "time unknown".
    """
    tz, close, open_ = _market(us)
    t = ts.tz_convert(tz) if ts.tzinfo else ts.tz_localize(tz)
    hm = (t.hour, t.minute)
    if hm == (0, 0):
        return t.date(), None
    if hm >= close:
        return t.date(), "amc"
    if hm < open_:
        return t.date(), "bmo"
    return t.date(), None  # during the session


def reaction_index(dates: pd.DatetimeIndex, report: date, hour: str | None) -> int | None:
    """Index of the first trading day whose close reflects the report.

    After the close → the next trading day; before the open or during the day → that same day.
    """
    target = pd.Timestamp(report) + (pd.Timedelta(days=1) if hour == "amc" else pd.Timedelta(0))
    i = int(dates.searchsorted(target))
    return i if i < len(dates) else None


def earnings_reactions(
    reports: list[dict[str, Any]], close: pd.Series, *, limit: int = 8
) -> dict[str, Any]:
    """reports: [{date, hour, eps_est, eps_actual}] (any order). close: daily closes (date index).

    Move +1 = close on the reaction day vs the close before it; +5 = 4 trading days later.
    """
    close = close.dropna()
    idx = pd.DatetimeIndex(close.index).tz_localize(None).normalize()
    vals = close.to_numpy(float)
    out = []
    for r in sorted(reports, key=lambda x: x["date"], reverse=True):
        if r.get("eps_actual") is None:
            continue
        i = reaction_index(idx, date.fromisoformat(r["date"]), r.get("hour"))
        if i is None or i == 0:
            continue
        base = vals[i - 1]
        move1 = (vals[i] / base - 1) * 100
        move5 = (vals[i + 4] / base - 1) * 100 if i + 4 < len(vals) else None
        est, act = r.get("eps_est"), r["eps_actual"]
        surprise = (act - est) / abs(est) * 100 if est not in (None, 0) else None
        out.append(
            {
                "date": r["date"],
                "hour": r.get("hour"),
                "reaction_date": idx[i].strftime("%Y-%m-%d"),
                "eps_est": None if est is None else round(float(est), 4),
                "eps_actual": round(float(act), 4),
                "surprise_pct": None if surprise is None else round(surprise, 1),
                "beat": None if est is None else bool(act >= est),
                "move_1d": round(float(move1), 2),
                "move_5d": None if move5 is None else round(float(move5), 2),
            }
        )
        if len(out) >= limit:
            break
    moves = [abs(x["move_1d"]) for x in out]
    beats = [x["beat"] for x in out if x["beat"] is not None]
    return {
        "reports": out,
        "avg_abs_move": round(float(np.mean(moves)), 2) if moves else None,
        "beats": sum(beats),
        "n": len(out),
    }


def next_dividend(
    calendar: dict[str, Any],
    history: pd.Series | None,
    today: date,
    currency: str | None = None,
) -> dict[str, Any] | None:
    """Next ex-dividend date (+ pay date, amount). Estimated from the usual gap if needed."""
    hist = (history if history is not None else pd.Series(dtype=float)).dropna()
    hist = hist[hist > 0]
    amount = float(hist.iloc[-1]) if len(hist) else None
    ex = calendar.get("Ex-Dividend Date")
    pay = calendar.get("Dividend Date")
    ex_d = pd.Timestamp(ex).date() if ex else None
    pay_d = pd.Timestamp(pay).date() if pay else None
    per_year = None
    if len(hist) >= 3:
        last = pd.DatetimeIndex(hist.index[-6:]).tz_localize(None)
        gaps = np.diff(last.values).astype("timedelta64[D]").astype(int)
        gap = int(np.median(gaps))
        per_year = int(round(365 / gap)) if gap > 0 else None
    else:
        gap = None
    if ex_d and ex_d >= today:
        return {
            "ex_date": ex_d.isoformat(),
            "pay_date": pay_d.isoformat() if pay_d and pay_d >= ex_d else None,
            "amount": amount,
            "currency": currency,
            "estimated": False,
            "per_year": per_year,
        }
    if gap and len(hist):  # estimate: last ex-date + usual gap (until it's in the future)
        nxt = pd.Timestamp(hist.index[-1]).tz_localize(None).date()
        if gap < 20:
            return None
        while nxt < today:
            nxt += timedelta(days=gap)
        if (nxt - today).days > 200:
            return None
        return {
            "ex_date": nxt.isoformat(),
            "pay_date": None,
            "amount": amount,
            "currency": currency,
            "estimated": True,
            "per_year": per_year,
        }
    return None


def yahoo_earnings_rows(df: pd.DataFrame | None, us: bool) -> list[dict[str, Any]]:
    """Yahoo get_earnings_dates frame → [{date, hour, eps_est, eps_actual}]."""
    if df is None or df.empty:
        return []
    rows = []
    for ts, r in df.iterrows():
        d, hour = report_timing(pd.Timestamp(ts), us)
        est = r.get("EPS Estimate")
        act = r.get("Reported EPS")
        rows.append(
            {
                "date": d.isoformat(),
                "hour": hour,
                "eps_est": None if pd.isna(est) else float(est),
                "eps_actual": None if pd.isna(act) else float(act),
            }
        )
    return rows


def next_from_rows(rows: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    future = sorted((r for r in rows if r["date"] >= today.isoformat()), key=lambda r: r["date"])
    if not future:
        return None
    r = future[0]
    return {"date": r["date"], "hour": r["hour"], "eps_est": r["eps_est"], "source": "Yahoo"}


def macro_events(today: date, *, days: int = 120, path: Path | None = None) -> list[dict[str, Any]]:
    """Fed / ECB decisions from config/macro_events.yaml within `days` from today."""
    cfg = yaml.safe_load((path or ROOT / "config" / "macro_events.yaml").read_text()) or {}
    end = today + timedelta(days=days)
    out = []
    for kind, spec in (cfg.get("events") or {}).items():
        for d in spec.get("dates") or []:
            dd = d if isinstance(d, date) else date.fromisoformat(str(d))
            if today <= dd <= end:
                out.append(
                    {
                        "date": dd.isoformat(),
                        "kind": kind,
                        "time": spec.get("time"),
                        "tz": spec.get("tz"),
                        "tentative": bool(spec.get("tentative")),
                    }
                )
    return sorted(out, key=lambda e: e["date"])


def earnings_result_due(history: dict[str, Any] | None, as_of: str | None) -> dict[str, Any] | None:
    """The report whose reaction day is the latest price bar (for the "earnings result" alert)."""
    if not history or not as_of:
        return None
    for r in history.get("reports") or []:
        if r["reaction_date"] == as_of:
            return r
    return None


# ====================================================================== fetch (never raises)


def collect(
    symbol: str, close: pd.Series, today: date, currency: str | None, us: bool
) -> dict[str, Any]:
    """{earnings_history, next_earnings (Yahoo), dividend} for one ticker."""
    out: dict[str, Any] = {"earnings_history": None, "next_earnings": None, "dividend": None}
    try:
        import yfinance as yf

        t = yf.Ticker(symbol)

        def _dates() -> pd.DataFrame:
            try:
                df = t.get_earnings_dates(limit=16)
            except (ValueError, KeyError):  # ETFs and unknown symbols: no data, no retry
                return pd.DataFrame()
            return df if df is not None else pd.DataFrame()

        df = with_retries(_dates, "yahoo earnings dates")
        rows = yahoo_earnings_rows(df, us)
        if rows:
            hist = earnings_reactions(rows, close)
            out["earnings_history"] = hist if hist["n"] else None
            out["next_earnings"] = next_from_rows(rows, today)
        cal = with_retries(lambda: t.calendar or {}, "yahoo calendar") or {}
        divs = with_retries(lambda: t.dividends, "yahoo dividends")
        out["dividend"] = next_dividend(cal, divs, today, currency)
    except Exception as exc:  # noqa: BLE001 — one ticker must never crash the run
        log.error(f"events: failed ({log.exc_kind(exc)})")
    return out


def now_utc() -> datetime:
    return datetime.now(ZoneInfo("UTC"))

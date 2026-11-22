"""Portfolio returns vs a benchmark (CLAUDE.md 13.14 B). Pure; tested in tests/test_performance.py.

Everything is in EUR and covers the *invested* part only (cash is a snapshot, not a history).

* Flows (money into the investments, EUR):
  buy = qty·price + fees + taxes; sell = −(qty·price − fees − taxes);
  dividend = −(qty·dividend − withholding) (cash paid out);
  a starting position enters at its market value at the close of its date (we measure from then
  on, so gains from before the import aren't counted as returns).
* Time-weighted return, daily: r_t = V_t / (V_{t−1} + F_t) − 1 (flows at the start of the day),
  chained. Deposits and withdrawals don't move it, so it compares with the benchmark's price return.
* "What if ETF": the same EUR flows on the same days into the benchmark (units can't go below 0).
* XIRR: money-weighted yearly return of the flows plus today's value.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pandas as pd

BUCKET = {
    "broad_etf": "core",
    "bond_etf": "core",
    "sector_etf": "satellite",
    "stock": "satellite",
    "other": "satellite",
    "speculative": "speculative",
    "crypto": "speculative",
}
PERIODS = ("ytd", "1y", "3y", "all")


def xirr(flows: list[tuple[date, float]]) -> float | None:
    """Yearly rate r with Σ cf / (1+r)^(days/365) = 0. flows: (date, amount), out < 0, in > 0."""
    flows = [(d, a) for d, a in flows if a]
    if len(flows) < 2 or not (any(a < 0 for _, a in flows) and any(a > 0 for _, a in flows)):
        return None
    d0 = min(d for d, _ in flows)

    def npv(r: float) -> float:
        return sum(a / (1 + r) ** ((d - d0).days / 365.0) for d, a in flows)

    lo, hi = -0.9999, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-9:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round((lo + hi) / 2, 6)


def _rate(cur: str, day: pd.Timestamp, fx: dict[str, pd.Series]) -> float | None:
    """Units of `cur` per 1 EUR on `day` (last known before it, or the first one after)."""
    if not cur or cur == "EUR":
        return 1.0
    s = fx.get(cur)
    if s is None or s.empty:
        return None
    v = _on_days(s, pd.DatetimeIndex([day])).iloc[0]
    return float(v) if pd.notna(v) else float(s.dropna().iloc[0])


def _on_days(s: pd.Series | None, days: pd.DatetimeIndex) -> pd.Series:
    """Last known value on each day (prices from before the first day carry forward)."""
    if s is None or s.empty:
        return pd.Series(float("nan"), index=days)
    s = s.copy()
    s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
    s = s[~s.index.duplicated(keep="last")]
    return s.reindex(s.index.union(days)).sort_index().ffill().reindex(days)


def daily(
    transactions: list[dict[str, Any]],
    closes: dict[str, pd.Series],
    fx: dict[str, pd.Series],
    end: date | None = None,
) -> pd.DataFrame | None:
    """Per trading day: value (V), flow (F) in EUR. None when there's nothing to measure."""
    txs = sorted(
        (t for t in transactions if t.get("kind") in ("buy", "sell", "start", "dividend")),
        key=lambda t: (str(t["date"]), str(t.get("created_at") or "")),
    )
    if not txs:
        return None
    start = pd.Timestamp(str(txs[0]["date"]))
    last = max(
        (
            pd.Timestamp(s.index.max()).tz_localize(None)
            for s in closes.values()
            if s is not None and len(s)
        ),
        default=start,
    )
    stop = pd.Timestamp(end) if end else last
    days = pd.bdate_range(start, max(stop, start))
    if len(days) == 0:
        return None
    syms = sorted({t["symbol"].upper() for t in txs})
    price = pd.DataFrame({s: _on_days(closes.get(s), days) for s in syms}, index=days)
    cur_of = {t["symbol"].upper(): t.get("currency") or "EUR" for t in txs}
    qty = pd.DataFrame(0.0, index=days, columns=syms)
    flow = pd.Series(0.0, index=days)
    for t in txs:
        d = pd.Timestamp(str(t["date"]))
        if d not in days:  # weekend trade → next trading day
            later = days[days >= d]
            if not len(later):
                continue
            d = later[0]
        sym, q, p = t["symbol"].upper(), float(t["quantity"]), float(t["price"])
        extra = float(t.get("fees") or 0) + float(t.get("taxes") or 0)
        rate = float(t["fx_rate"]) if t.get("fx_rate") else _rate(t.get("currency") or "EUR", d, fx)
        if not rate:
            continue
        kind = t["kind"]
        if kind == "buy":
            flow[d] += (q * p + extra) / rate
            qty.loc[d:, sym] += q
        elif (
            kind == "start"
        ):  # enters at market value (its close that day), else at the given price
            close = price.at[d, sym]
            flow[d] += q * (float(close) if pd.notna(close) else p) / rate
            qty.loc[d:, sym] += q
        elif kind == "sell":
            flow[d] -= (q * p - extra) / rate
            qty.loc[d:, sym] -= q
        elif kind == "dividend":
            flow[d] -= (q * p - float(t.get("taxes") or 0)) / rate
    qty = qty.clip(lower=0)
    # no market price (yet)? value at the last trade price instead of 0
    traded = pd.DataFrame(float("nan"), index=days, columns=syms)
    for t in txs:
        if t["kind"] != "dividend":
            later = days[days >= pd.Timestamp(str(t["date"]))]
            if len(later):
                traded.at[later[0], t["symbol"].upper()] = float(t["price"])
    price = price.fillna(traded.ffill())
    value = pd.Series(0.0, index=days)
    for s in syms:
        cur = cur_of[s]
        r = 1.0 if cur == "EUR" else _on_days(fx.get(cur), days).bfill()
        value += (qty[s] * price[s] / r).fillna(0.0)
    return pd.DataFrame({"V": value, "F": flow})


def twr_index(df: pd.DataFrame) -> pd.Series:
    """Chained daily returns as an index starting at 100 (before the first day)."""
    idx, level, prev = [], 100.0, 0.0
    for v, f in zip(df["V"], df["F"]):
        base = prev + f
        r = v / base - 1 if base > 1e-9 else 0.0
        level *= 1 + r
        idx.append(level)
        prev = v
    return pd.Series(idx, index=df.index)


def what_if(df: pd.DataFrame, bench: pd.Series) -> pd.Series:
    """Value (EUR) of putting the same flows into the benchmark on the same days."""
    b = _on_days(bench, df.index)
    units, out = 0.0, []
    for f, px in zip(df["F"], b):
        if pd.notna(px) and px > 0:
            units = max(0.0, units + f / px)
        out.append(units * px if pd.notna(px) else float("nan"))
    return pd.Series(out, index=df.index)


def _period_start(period: str, end: pd.Timestamp) -> pd.Timestamp | None:
    if period == "ytd":
        return pd.Timestamp(date(end.year - 1, 12, 31))
    if period == "1y":
        return end - pd.Timedelta(days=365)
    if period == "3y":
        return end - pd.Timedelta(days=3 * 365)
    return None


def period_return(index: pd.Series, period: str) -> float | None:
    """% return of an index over a period; None when the period starts before the data."""
    if index.empty:
        return None
    end = index.index[-1]
    start = _period_start(period, end)
    if start is None:
        return round((index.iloc[-1] / 100.0 - 1) * 100, 2)
    if start < index.index[0] - pd.Timedelta(days=4):
        return None
    base = index.loc[:start]
    b = float(base.iloc[-1]) if len(base) else 100.0
    return round((index.iloc[-1] / b - 1) * 100, 2)


def annualised(total_pct: float | None, days: int) -> float | None:
    if total_pct is None or days < 365:
        return None
    return round(((1 + total_pct / 100) ** (365.0 / days) - 1) * 100, 2)


def build(
    transactions: list[dict[str, Any]],
    closes: dict[str, pd.Series],
    fx: dict[str, pd.Series],
    bench: pd.Series | None,
    types: dict[str, str],
    bench_symbol: str,
    end: date | None = None,
) -> dict[str, Any] | None:
    """Everything the Returns screen needs. None when there are no transactions."""
    df = daily(transactions, closes, fx, end)
    if df is None:
        return None
    idx = twr_index(df)
    b = None
    if bench is not None and len(bench):
        on = _on_days(bench, df.index)
        prev = _on_days(bench, pd.DatetimeIndex([df.index[0] - pd.Timedelta(days=1)])).iloc[0]
        base = float(prev) if pd.notna(prev) else float(on.dropna().iloc[0])
        b = on / base * 100
    wi = what_if(df, bench) if bench is not None and len(bench) else None
    end_day = df.index[-1]
    value_end = float(df["V"].iloc[-1])
    flows = [(d.date(), -float(f)) for d, f in df["F"].items() if abs(f) > 1e-9]

    periods = {}
    for p in PERIODS:
        mine = period_return(idx, p)
        theirs = period_return(b, p) if b is not None else None
        periods[p] = {"you": mine, "bench": theirs}
    days_total = (end_day - df.index[0]).days
    periods["all"]["you_yearly"] = annualised(periods["all"]["you"], days_total)
    periods["all"]["bench_yearly"] = annualised(periods["all"]["bench"], days_total)

    parts = {}
    for part in ("core", "satellite", "speculative"):
        sub = [
            t for t in transactions if BUCKET.get(types.get(t["symbol"].upper(), "stock")) == part
        ]
        if not sub:
            continue
        d2 = daily(sub, closes, fx, end_day.date())
        if d2 is None or d2["V"].iloc[-1] <= 0 and d2["F"].sum() <= 0:
            continue
        i2 = twr_index(d2)
        parts[part] = {"all": period_return(i2, "all"), "1y": period_return(i2, "1y")}

    # weekly points for the chart (Fridays + the last day), small enough for a phone
    weekly = sorted(set(df.index[df.index.weekday == 4]) | {end_day})
    invested = df["F"].cumsum()
    series = {
        "t": [d.strftime("%Y-%m-%d") for d in weekly],
        "you": [round(float(idx[d]), 2) for d in weekly],
        "bench": [None if b is None or pd.isna(b[d]) else round(float(b[d]), 2) for d in weekly],
        "value": [round(float(df.at[d, "V"]), 2) for d in weekly],
        "what_if": [
            None if wi is None or pd.isna(wi[d]) else round(float(wi[d]), 2) for d in weekly
        ],
        "invested": [round(float(invested[d]), 2) for d in weekly],
    }
    wi_end = float(wi.iloc[-1]) if wi is not None and pd.notna(wi.iloc[-1]) else None
    return {
        "since": df.index[0].strftime("%Y-%m-%d"),
        "as_of": end_day.strftime("%Y-%m-%d"),
        "trading_days": int(len(df)),
        "benchmark": bench_symbol,
        "value": round(value_end, 2),
        "net_invested": round(float(df["F"].sum()), 2),
        "what_if": None if wi_end is None else round(wi_end, 2),
        "difference": None if wi_end is None else round(value_end - wi_end, 2),
        "xirr": xirr(flows + [(end_day.date(), value_end)]),
        "xirr_bench": None
        if wi_end is None
        else xirr([(d, a) for d, a in flows] + [(end_day.date(), wi_end)]),
        "periods": periods,
        "parts": parts,
        "series": series,
    }


def earliest(transactions: list[dict[str, Any]]) -> date | None:
    ds = [str(t["date"]) for t in transactions if t.get("date")]
    return date.fromisoformat(min(ds)) if ds else None


def history_period(since: date | None, today: date) -> str:
    """yfinance period long enough to cover `since` (with a margin)."""
    if since is None:
        return "1mo"
    days = (today - since).days + 10
    for limit, p in (
        (25, "1mo"),
        (85, "3mo"),
        (175, "6mo"),
        (360, "1y"),
        (720, "2y"),
        (1800, "5y"),
    ):
        if days <= limit:
            return p
    return "10y"

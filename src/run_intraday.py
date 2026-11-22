"""Intraday job (CLAUDE.md 7.1, 10): every 15 minutes while the US or EU market is open.

    python -m src.run_intraday            # exits at once when no market is open
    python -m src.run_intraday --force    # run even when markets are closed (testing)

Only checks tickers whose market is open now. Shares the once-per-stock-per-kind-per-day limit
with the daily job (alert_state). Logs counts only (public Actions logs).
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd

from src import alerts, fundamentals, intraday, log, market_hours
from src.fetch import with_retries
from src.run_daily import load_alert_config
from src.storage import Store, SupabaseStore


def _frame(data: pd.DataFrame, symbol: str, many: bool) -> pd.DataFrame | None:
    """One ticker's columns out of a yf.download result."""
    if data is None or data.empty:
        return None
    try:
        df = data[symbol] if many else data
    except KeyError:
        return None
    df = df.dropna(how="all")
    return df if not df.empty else None


def download(symbols: list[str], **kw: Any) -> pd.DataFrame | None:
    import yfinance as yf

    def _get() -> pd.DataFrame | None:
        df = yf.download(
            symbols, group_by="ticker", auto_adjust=False, progress=False, threads=True, **kw
        )
        return df if df is not None and not df.empty else None

    return with_retries(_get, f"intraday prices ({kw.get('interval')})")


def news_for(symbol: str, today: str) -> list[dict[str, Any]]:
    """Today's headlines, newest first (Finnhub for US, Yahoo for EU)."""
    if fundamentals.is_us(symbol):
        items = fundamentals._finnhub(
            "/company-news", symbol=symbol, **{"from": today, "to": today}
        )
        return fundamentals.parse_finnhub_news(items or [], limit=5)
    import yfinance as yf

    items = with_retries(lambda: yf.Ticker(symbol).news or [], "yahoo news")
    return fundamentals.parse_yahoo_news(items or [], limit=5)


def run(store: Store, force: bool = False) -> int:
    now = datetime.now(timezone.utc)
    open_markets = {m for m in market_hours.MARKETS if force or market_hours.is_open(m, now)}
    if not open_markets:
        log.info("markets closed, nothing to do")
        return 0

    acfg = load_alert_config()
    watchlist = store.load_watchlist()
    scores = store.load_latest_scores()
    rows_in = [
        w
        for w in watchlist
        if market_hours.market_for(w["symbol"], w.get("market")) in open_markets
    ]
    symbols = sorted({w["symbol"].upper() for w in rows_in})
    log.info(f"open markets: {len(open_markets)}, tickers to check: {len(symbols)}")
    if not symbols:
        return 0

    daily = download(symbols, period="2mo", interval="1d")
    # --force (testing): use the last trading session, so weekends and holidays work too
    intra = download(symbols, period="5d" if force else "1d", interval="5m")
    many = len(symbols) > 1
    stats: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        mkt = market_hours.market_for(sym)
        local_today = now.astimezone(ZoneInfo(market_hours.MARKETS[mkt].tz)).date()
        frame = _frame(intra, sym, many) if intra is not None else None
        if force and frame is not None:
            last = pd.Timestamp(frame.index[-1])
            local_today = (
                last.tz_convert(market_hours.MARKETS[mkt].tz) if last.tzinfo else last
            ).date()
        s = intraday.day_stats(
            _frame(daily, sym, many) if daily is not None else None,
            _frame(intra, sym, many) if intra is not None else None,
            local_today,
        )
        if s:
            # --force replays the last full session, so compare against a full day's volume
            s["elapsed"] = 1.0 if force else market_hours.elapsed_fraction(mkt, now)
            s["minutes_open"] = 390 if force else market_hours.minutes_open(mkt, now)
            s["news"] = news_for(sym, local_today.isoformat())
            stats[sym] = s

    rows = []
    for w in rows_in:
        sym, uid = w["symbol"].upper(), w["user_id"]
        if sym not in stats:
            continue
        sc = scores.get((uid, sym), {})
        rows.append(
            {
                **stats[sym],
                "user_id": uid,
                "symbol": sym,
                "buy_below": w.get("buy_below"),
                **{k: sc.get(k) for k in ("currency", "score", "max_score", "label")},
            }
        )

    day = alerts.brussels_day(now)
    found = intraday.evaluate_intraday(rows, acfg, now)
    todo = alerts.apply_quiet_hours(alerts.dedupe(found, store.load_alert_state(day)), now, acfg)
    can_send = alerts.telegram_configured()
    log_rows, state_rows, sent, failed = [], [], 0, 0
    for a in todo:
        text = alerts.format_message(a)
        if force:  # a test run must never look like a real alert
            text = "🧪 TEST (not a real alert) · " + text
            a.title = "🧪 TEST · " + a.title
        ok = can_send and alerts.send_telegram(text)
        sent += int(ok)
        failed += int(not ok)
        log_rows.append(alerts.to_log_row(a, ok, now.isoformat()))
        if ok and not force:  # test runs never block real alerts later the same day
            state_rows.append(
                {"user_id": a.user_id, "symbol": a.symbol, "kind": a.kind, "day": day}
            )
    store.insert("alerts_log", log_rows)
    store.upsert("alert_state", state_rows, "user_id,symbol,kind,day")

    status = "ok" if len(stats) == len(symbols) else ("partial" if stats else "failed")
    store.insert(
        "job_runs",
        [
            {
                "job": "intraday",
                "started_at": now.isoformat(),
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "status": status,
                "counts": {
                    "tickers": len(symbols),
                    "checked": len(stats),
                    "alerts_sent": sent,
                    "alerts_failed": failed,
                },
                "sources": {"yahoo_intraday": {"ok": intra is not None, "rows": len(stats)}},
            }
        ],
    )
    log.info(
        f"checked {len(stats)}/{len(symbols)} tickers, alerts {sent} sent / {failed} failed, "
        f"status {status}"
    )
    return 1 if status == "failed" else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Intraday alert job")
    parser.add_argument("--force", action="store_true", help="run even when markets are closed")
    args = parser.parse_args(argv)
    return run(SupabaseStore.from_env(), force=args.force)


if __name__ == "__main__":
    sys.exit(main())

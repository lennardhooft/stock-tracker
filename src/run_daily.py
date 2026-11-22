"""Daily job (CLAUDE.md 10): fetch → sanity checks → Bottom Score → write to Supabase.

    python -m src.run_daily            # production: reads/writes Supabase (env vars needed)
    python -m src.run_daily --local    # local test: example watchlist, writes to out/

Logs only counts and statuses (public repo, rule 2.1.4). Exit code 1 when the run failed
(nothing scored or the database write failed), so GitHub emails the owner.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from src import alerts, data_checks, events, fetch, fundamentals, levels, log, quality, top_score
from src import indicators as ind
from src import score as sc
from src.risk import volatility
from src.storage import LocalStore, Store, SupabaseStore

ROOT = Path(__file__).resolve().parents[1]
SPARKLINE_WEEKS = 52
DETAIL_WEEKS = 520  # ~10 years of weekly bars for the detail chart


def load_scoring_config() -> dict[str, Any]:
    return yaml.safe_load((ROOT / "config" / "scoring.yaml").read_text())


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Market snapshot
# ---------------------------------------------------------------------------


def build_market_snapshot() -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    sources: dict[str, dict[str, Any]] = {}
    market: dict[str, Any] = {}
    for key, symbol in (("sp500", "^GSPC"), ("nasdaq", "^IXIC"), ("vix", "^VIX")):
        q = fetch.get_index_quote(symbol)
        market[key] = q
        sources[f"yahoo_{key}"] = {"ok": q is not None, "rows": 1 if q else 0}
    # exchange rates for the portfolio (units per 1 EUR), Phase 3A
    rates = {}
    for cur in ("USD", "GBP", "CHF", "DKK", "SEK", "NOK", "JPY", "CAD"):
        q = fetch.get_index_quote(f"EUR{cur}=X")
        if q:
            rates[cur] = q["value"]
    market["fx"] = {"rates": rates, "as_of": _now()}
    sources["yahoo_fx"] = {"ok": "USD" in rates, "rows": len(rates)}
    fg = fetch.get_fear_greed()
    market["fear_greed"] = fg
    sources["cnn_fear_greed"] = {"ok": fg is not None, "rows": 1 if fg else 0}
    market["updated_at"] = _now()
    return market, sources


# ---------------------------------------------------------------------------
# One ticker
# ---------------------------------------------------------------------------


def process_symbol(
    symbol: str,
    market: dict[str, Any],
    cfg: dict[str, Any],
    previously_suspect: set[str],
    vix_hist: pd.Series | None = None,
) -> dict[str, Any]:
    """Everything the UI needs for one ticker. Never raises; returns an `error` on failure."""
    raw = fetch.get_daily_history(symbol)
    if raw is None:
        return {"error": "no price data", "rows": 0}

    currency_raw = fetch.get_currency(symbol)
    currency, divisor, cur_issue = data_checks.normalize_currency(currency_raw)

    checks = data_checks.check_daily(raw, cfg.get("data_checks", {}), previously_suspect)
    if cur_issue:
        checks.issues.append(cur_issue)
    clean = checks.clean
    if clean.empty or len(clean) < 2:
        return {
            "error": "not enough usable data",
            "rows": len(raw),
            "checks": checks.to_json(),
            "suspect": bool(checks.suspect_dates),
        }

    ohlc = clean[["Open", "High", "Low", "Close"]] / divisor
    close = ohlc["Close"]
    zones = (
        levels.detect_levels(ohlc, cfg["levels"])
        if "levels" in cfg
        else {"zones": [], "swings": []}
    )
    fund = fundamentals.collect(symbol, close, date.today())
    signals = sc.compute_signals(close, market, cfg, zones, fund)
    total = sc.build_score(signals, cfg)

    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    # Phase 2E: Quality Score + verdict (13.1) and Top Score (13.14 A)
    qual = quality.collect(symbol, last * divisor, cfg.get("quality"))
    top = top_score.compute_top(
        close, market, cfg, levels=zones, fundamentals=fund, market_cap=qual.get("market_cap")
    )
    profile = qual.pop("profile", None)
    fund["quality"] = qual
    # Phase 2G: earnings reactions, next earnings (Yahoo fallback), next dividend (13.1, 13.3)
    ev = events.collect(symbol, close, date.today(), currency, fundamentals.is_us(symbol))
    fund["earnings_history"] = ev["earnings_history"]
    fund["dividend"] = ev["dividend"]
    if fund.get("source") != "Finnhub" or not fund.get("earnings"):
        fund["earnings"] = ev["next_earnings"] or fund.get("earnings")
    year = close.iloc[-252:]
    weekly = ind.to_weekly(close)
    sma200 = ind.sma(weekly, 200)
    wk = levels.resample_ohlc(ohlc, "W-FRI").iloc[-DETAIL_WEEKS:]
    hist = sc.weekly_score_history(close, vix_hist, cfg).reindex(wk.index)
    top_hist = top_score.weekly_top_history(close, cfg).reindex(wk.index)
    vol = (
        clean["Volume"].resample("W-FRI").sum().reindex(wk.index)
        if "Volume" in clean
        else pd.Series(index=wk.index, dtype=float)
    )

    def _clean_list(s: pd.Series, nd: int = 4) -> list[float | None]:
        return [None if pd.isna(v) else round(float(v), nd) for v in s]

    return {
        "as_of": close.index[-1].strftime("%Y-%m-%d"),
        "price": round(last, 4),
        "currency": currency,
        "change_pct": round((last / prev - 1) * 100, 2),
        "prev_close": round(prev, 4),
        "pct_from_52w_high": round((last / float(year.max()) - 1) * 100, 2),
        "high_52w": round(float(year.max()), 4),
        "low_52w": round(float(year.min()), 4),
        "score": total["score"],
        "max_score": total["max_score"],
        "n_na": total["n_na"],
        "label": total["label"]["key"],
        "signals": signals,
        "risk": volatility.risk_profile(ohlc, profile),  # Phase 3A: for the sizing engine
        "quality": quality.summary(qual),
        "top": top,
        "verdict": quality.verdict(total["score"], qual, float(cfg.get("alert_threshold", 4))),
        "sparkline": _clean_list(weekly.iloc[-SPARKLINE_WEEKS:]),
        "checks": checks.to_json(),
        "suspect": bool(checks.suspect_dates),
        "weekly": {
            "t": [d.strftime("%Y-%m-%d") for d in wk.index],
            "o": _clean_list(wk["Open"]),
            "h": _clean_list(wk["High"]),
            "l": _clean_list(wk["Low"]),
            "c": _clean_list(wk["Close"]),
            "sma200": _clean_list(sma200.reindex(wk.index)),
            "score": _clean_list(hist, 0),  # reconstructed weekly Bottom Score (S1 = VIX only)
            "top": _clean_list(top_hist, 0),  # reconstructed weekly Top Score (U1 + U2 only)
            "v": _clean_list(vol, 0),  # weekly volume
            "levels": zones,  # support / resistance zones + major swings (6.5)
        },
        "fundamentals": fund,
        "next_earnings": fund.get("earnings"),
        "next_dividend": fund.get("dividend"),
        "rows": len(raw),
    }


# ---------------------------------------------------------------------------
# Alerts (7.1, 7.2)
# ---------------------------------------------------------------------------


def load_alert_config() -> dict[str, Any]:
    path = ROOT / "config" / "alerts.yaml"
    return yaml.safe_load(path.read_text()) if path.exists() else {"kinds": {}}


def send_alerts(
    store: Store,
    watchlist: list[dict[str, Any]],
    results: dict[str, dict[str, Any]],
    prev_scores: dict[tuple[str, str], float | None],
    cfg: dict[str, Any],
    *,
    writes_ok: bool,
) -> tuple[int, int]:
    """Evaluate, de-duplicate and send today's alerts. Returns (sent, failed). Logs counts only."""
    acfg = load_alert_config()
    rows: list[dict[str, Any]] = []
    problems: dict[str, dict[str, Any]] = {}
    for w in watchlist:
        sym, uid = w["symbol"].upper(), w["user_id"]
        r = results[sym]
        p = problems.setdefault(
            uid, {"user_id": uid, "suspect": 0, "errors": 0, "failed": not writes_ok}
        )
        if "error" in r:
            p["errors"] += 1
            continue
        p["suspect"] += int(bool(r.get("suspect")))
        rows.append(
            {
                **{
                    k: r.get(k)
                    for k in (
                        "price",
                        "prev_close",
                        "currency",
                        "change_pct",
                        "score",
                        "max_score",
                        "label",
                        "signals",
                        "suspect",
                        "as_of",
                    )
                },
                "user_id": uid,
                "symbol": sym,
                "buy_below": w.get("buy_below"),
                "prev_score": prev_scores.get((uid, sym)),
                "zones": (r.get("weekly") or {}).get("levels", {}).get("zones", []),
                "next_earnings": r.get("next_earnings"),
                "earnings_result": events.earnings_result_due(
                    (r.get("fundamentals") or {}).get("earnings_history"), r.get("as_of")
                ),
                "news": (r.get("fundamentals") or {}).get("news") or [],
            }
        )

    now = datetime.now(timezone.utc)
    day = alerts.brussels_day(now)
    for x in rows:
        x["today"] = day
        x["headline"] = fundamentals.recent_headline(x.pop("news"), now)
    found = []
    for uid, p in problems.items():
        user_rows = [x for x in rows if x["user_id"] == uid]
        found += alerts.evaluate(user_rows, acfg, float(cfg.get("alert_threshold", 4)), p)
    todo = alerts.apply_quiet_hours(alerts.dedupe(found, store.load_alert_state(day)), now, acfg)

    can_send = alerts.telegram_configured()
    log_rows, state_rows = [], []
    sent = failed = 0
    for a in todo:
        ok = can_send and alerts.send_telegram(alerts.format_message(a))
        sent += int(ok)
        failed += int(not ok)
        log_rows.append(alerts.to_log_row(a, ok, now.isoformat()))
        if ok:  # undelivered alerts are retried by the next run the same day
            state_rows.append(
                {"user_id": a.user_id, "symbol": a.symbol, "kind": a.kind, "day": day}
            )
    store.insert("alerts_log", log_rows)
    store.upsert("alert_state", state_rows, "user_id,symbol,kind,day")
    if todo and not can_send:
        log.info("alerts: telegram not configured, alerts logged but not sent")
    return sent, failed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run(store: Store) -> int:
    started = _now()
    cfg = load_scoring_config()

    watchlist = store.load_watchlist()
    symbols = sorted({w["symbol"].upper() for w in watchlist})
    log.info(f"watchlist: {len(watchlist)} rows, {len(symbols)} unique tickers")

    market, sources = build_market_snapshot()
    vix_df = fetch.get_daily_history("^VIX")
    vix_hist = vix_df["Close"] if vix_df is not None else None
    sources["yahoo_vix_history"] = {
        "ok": vix_hist is not None,
        "rows": 0 if vix_hist is None else len(vix_hist),
    }
    previous = store.load_previous_suspects()
    prev_scores = store.load_previous_scores()  # before today's scores overwrite them

    results: dict[str, dict[str, Any]] = {}
    for i, symbol in enumerate(symbols, 1):
        results[symbol] = process_symbol(symbol, market, cfg, previous.get(symbol, set()), vix_hist)
        log.private(f"{symbol}: {results[symbol].get('score', results[symbol].get('error'))}")
        if i % 10 == 0:
            log.info(f"processed {i}/{len(symbols)}")

    ok = [s for s, r in results.items() if "error" not in r]
    failed = len(symbols) - len(ok)
    suspect = sum(1 for r in results.values() if r.get("suspect"))
    sources["yahoo_prices"] = {
        "ok": failed == 0,
        "rows": sum(r.get("rows", 0) for r in results.values()),
        "errors": failed,
    }

    # ---- build rows per owner ------------------------------------------------
    now = _now()
    score_rows, detail_rows, history_rows = [], [], []
    for w in watchlist:
        sym, uid = w["symbol"].upper(), w["user_id"]
        r = results[sym]
        base = {"user_id": uid, "symbol": sym, "updated_at": now}
        if "error" in r:
            score_rows.append(
                {
                    **base,
                    "error": r["error"],
                    "checks": r.get("checks"),
                    "suspect": r.get("suspect", False),
                }
            )
            continue
        score_rows.append(
            {
                **base,
                **{
                    k: r[k]
                    for k in (
                        "as_of",
                        "price",
                        "currency",
                        "change_pct",
                        "pct_from_52w_high",
                        "high_52w",
                        "low_52w",
                        "score",
                        "max_score",
                        "n_na",
                        "label",
                        "signals",
                        "sparkline",
                        "checks",
                        "suspect",
                        "next_earnings",
                        "quality",
                        "top",
                        "verdict",
                        "next_dividend",
                        "risk",
                    )
                },
                "error": None,
            }
        )
        detail_rows.append({**base, "weekly": r["weekly"], "fundamentals": r["fundamentals"]})
        history_rows.append(
            {
                "user_id": uid,
                "symbol": sym,
                "date": r["as_of"],
                "score": r["score"],
                "max_score": r["max_score"],
                "n_na": r["n_na"],
                "price": r["price"],
            }
        )

    writes_ok = all(
        [
            store.upsert(
                "market_snapshot",
                [
                    {"id": "latest", "data": market, "updated_at": now},
                    {
                        "id": "macro",
                        "data": {"events": events.macro_events(date.today())},
                        "updated_at": now,
                    },
                ],
                "id",
            ),
            store.upsert("latest_scores", score_rows, "user_id,symbol"),
            store.upsert("ticker_detail", detail_rows, "user_id,symbol"),
            store.upsert("score_history", history_rows, "user_id,symbol,date"),
        ]
    )

    alerts_sent, alerts_failed = send_alerts(
        store, watchlist, results, prev_scores, cfg, writes_ok=writes_ok
    )

    if not writes_ok or (symbols and not ok):
        status = "failed"
    elif failed or suspect or not all(s["ok"] for s in sources.values()):
        status = "partial"
    else:
        status = "ok"

    store.insert(
        "job_runs",
        [
            {
                "job": "daily",
                "started_at": started,
                "finished_at": _now(),
                "status": status,
                "counts": {
                    "tickers": len(symbols),
                    "scored": len(ok),
                    "errors": failed,
                    "suspect": suspect,
                    "rows_written": len(score_rows),
                    "alerts_sent": alerts_sent,
                    "alerts_failed": alerts_failed,
                },
                "sources": sources,
            }
        ],
    )

    log.info(
        f"scored {len(ok)} tickers, {failed} errors, {suspect} suspect, "
        f"writes {'ok' if writes_ok else 'FAILED'}, alerts {alerts_sent} sent / "
        f"{alerts_failed} failed, status {status}"
    )
    return 1 if status == "failed" else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily Bottom Score job")
    parser.add_argument(
        "--local",
        action="store_true",
        help="use the example watchlist and write JSON to out/ (no Supabase)",
    )
    args = parser.parse_args(argv)
    store: Store = LocalStore() if args.local else SupabaseStore.from_env()
    return run(store)


if __name__ == "__main__":
    sys.exit(main())

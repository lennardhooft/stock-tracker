"""Daily job (CLAUDE.md 10): fetch → sanity checks → Bottom Score → write to Supabase.

    python -m src.run_daily            # production: reads/writes Supabase (env vars needed)
    python -m src.run_daily --local    # local test: example watchlist, writes to out/

Logs only counts and statuses (public repo, rule 2.1.4). Exit code 1 when the run failed
(nothing scored or the database write failed), so GitHub emails the owner.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from src import data_checks, fetch, log
from src import indicators as ind
from src import score as sc
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
    fg = fetch.get_fear_greed()
    market["fear_greed"] = fg
    sources["cnn_fear_greed"] = {"ok": fg is not None, "rows": 1 if fg else 0}
    market["updated_at"] = _now()
    return market, sources


# ---------------------------------------------------------------------------
# One ticker
# ---------------------------------------------------------------------------


def process_symbol(
    symbol: str, market: dict[str, Any], cfg: dict[str, Any], previously_suspect: set[str]
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

    close = clean["Close"] / divisor
    signals = sc.compute_signals(close, market, cfg)
    total = sc.build_score(signals, cfg)

    last, prev = float(close.iloc[-1]), float(close.iloc[-2])
    year = close.iloc[-252:]
    weekly = ind.to_weekly(close)
    sma200 = ind.sma(weekly, 200)
    tail = weekly.iloc[-DETAIL_WEEKS:]

    def _clean_list(s: pd.Series) -> list[float | None]:
        return [None if pd.isna(v) else round(float(v), 4) for v in s]

    return {
        "as_of": close.index[-1].strftime("%Y-%m-%d"),
        "price": round(last, 4),
        "currency": currency,
        "change_pct": round((last / prev - 1) * 100, 2),
        "pct_from_52w_high": round((last / float(year.max()) - 1) * 100, 2),
        "high_52w": round(float(year.max()), 4),
        "low_52w": round(float(year.min()), 4),
        "score": total["score"],
        "max_score": total["max_score"],
        "n_na": total["n_na"],
        "label": total["label"]["key"],
        "signals": signals,
        "sparkline": _clean_list(weekly.iloc[-SPARKLINE_WEEKS:]),
        "checks": checks.to_json(),
        "suspect": bool(checks.suspect_dates),
        "weekly": {
            "t": [d.strftime("%Y-%m-%d") for d in tail.index],
            "c": _clean_list(tail),
            "sma200": _clean_list(sma200.iloc[-DETAIL_WEEKS:]),
        },
        "rows": len(raw),
    }


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
    previous = store.load_previous_suspects()

    results: dict[str, dict[str, Any]] = {}
    for i, symbol in enumerate(symbols, 1):
        results[symbol] = process_symbol(symbol, market, cfg, previous.get(symbol, set()))
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
                    )
                },
                "error": None,
            }
        )
        detail_rows.append({**base, "weekly": r["weekly"]})
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
                "market_snapshot", [{"id": "latest", "data": market, "updated_at": now}], "id"
            ),
            store.upsert("latest_scores", score_rows, "user_id,symbol"),
            store.upsert("ticker_detail", detail_rows, "user_id,symbol"),
            store.upsert("score_history", history_rows, "user_id,symbol,date"),
        ]
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
                },
                "sources": sources,
            }
        ],
    )

    log.info(
        f"scored {len(ok)} tickers, {failed} errors, {suspect} suspect, "
        f"writes {'ok' if writes_ok else 'FAILED'}, status {status}"
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

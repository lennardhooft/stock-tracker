"""Storage backends.

* SupabaseStore — production. Talks to Supabase's REST API (PostgREST) with the SERVICE key from
  env vars (GitHub Secrets). The service key bypasses row-level security, so it must never
  reach the browser.
* LocalStore — local testing without Supabase: reads config/watchlist.example.yaml and writes
  JSON into out/ (gitignored).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Protocol

import requests
import yaml

from src.fetch import HTTP_TIMEOUT, with_retries

ROOT = Path(__file__).resolve().parents[1]
LOCAL_USER = "00000000-0000-0000-0000-000000000000"


class Store(Protocol):
    def load_watchlist(self) -> list[dict[str, Any]]: ...
    def load_previous_suspects(self) -> dict[str, set[str]]: ...
    def load_previous_scores(self) -> dict[tuple[str, str], float | None]: ...
    def load_alert_state(self, day: str) -> set[tuple[str, str, str]]: ...
    def load_latest_scores(self) -> dict[tuple[str, str], dict[str, Any]]: ...
    def load_transactions(self) -> list[dict[str, Any]]: ...
    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> bool: ...
    def insert(self, table: str, rows: list[dict[str, Any]]) -> bool: ...


def auth_headers(key: str) -> dict[str, str]:
    """Request headers for a Supabase API key.

    New-style keys (sb_secret_… / sb_publishable_…) go only in the `apikey` header; they are not
    JWTs and must not be sent as a Bearer token. Legacy JWT keys (eyJ…) also need the
    Authorization header.
    """
    if key.startswith("sb_"):
        return {"apikey": key}
    return {"apikey": key, "Authorization": f"Bearer {key}"}


class SupabaseStore:
    def __init__(self, url: str, service_key: str) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {**auth_headers(service_key), "Content-Type": "application/json"}

    @classmethod
    def from_env(cls) -> SupabaseStore:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set (or run with --local)"
            )
        return cls(url, key)

    def _get(self, table: str, params: dict[str, str]) -> list[dict[str, Any]] | None:
        def _call() -> list[dict[str, Any]]:
            r = requests.get(
                f"{self.base}/{table}", headers=self.headers, params=params, timeout=HTTP_TIMEOUT
            )
            r.raise_for_status()
            return r.json()

        return with_retries(_call, f"supabase read {table}")

    def load_watchlist(self) -> list[dict[str, Any]]:
        rows = self._get("watchlist", {"select": "user_id,symbol,name,market,buy_below,asset_type"})
        if rows is None:
            raise RuntimeError("could not read watchlist from Supabase")
        return rows

    def load_previous_suspects(self) -> dict[str, set[str]]:
        rows = self._get("latest_scores", {"select": "symbol,checks"}) or []
        out: dict[str, set[str]] = {}
        for row in rows:
            dates = ((row.get("checks") or {}).get("suspect_dates")) or []
            out.setdefault(row["symbol"], set()).update(dates)
        return out

    def load_previous_scores(self) -> dict[tuple[str, str], float | None]:
        rows = self._get("latest_scores", {"select": "user_id,symbol,score"}) or []
        return {(r["user_id"], r["symbol"]): r.get("score") for r in rows}

    def load_latest_scores(self) -> dict[tuple[str, str], dict[str, Any]]:
        sel = "user_id,symbol,currency,score,max_score,label"
        rows = self._get("latest_scores", {"select": sel}) or []
        return {(r["user_id"], r["symbol"]): r for r in rows}

    def load_transactions(self) -> list[dict[str, Any]]:
        """All owners' transactions (service key; only used to compute returns, never logged)."""
        sel = "user_id,date,symbol,kind,quantity,price,currency,fx_rate,fees,taxes,created_at"
        rows = self._get("transactions", {"select": sel, "order": "date"})
        return rows or []

    def load_alert_state(self, day: str) -> set[tuple[str, str, str]]:
        rows = self._get("alert_state", {"select": "user_id,symbol,kind", "day": f"eq.{day}"}) or []
        return {(r["user_id"], r["symbol"], r["kind"]) for r in rows}

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> bool:
        if not rows:
            return True
        # PostgREST needs the same keys in every object of one request. Rows for a failed ticker
        # carry fewer keys (so they keep yesterday's values), so send each key set separately.
        ok = True
        for batch in group_by_keys(rows):

            def _call(batch: list[dict[str, Any]] = batch) -> bool:
                r = requests.post(
                    f"{self.base}/{table}",
                    headers={**self.headers, "Prefer": MERGE},
                    params={"on_conflict": on_conflict},
                    data=json.dumps(batch, default=str),
                    timeout=HTTP_TIMEOUT,
                )
                r.raise_for_status()
                return True

            ok = bool(with_retries(_call, f"supabase upsert {table}")) and ok
        return ok

    def insert(self, table: str, rows: list[dict[str, Any]]) -> bool:
        if not rows:
            return True

        def _call() -> bool:
            r = requests.post(
                f"{self.base}/{table}",
                headers={**self.headers, "Prefer": "return=minimal"},
                data=json.dumps(rows, default=str),
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            return True

        return bool(with_retries(_call, f"supabase insert {table}"))


MERGE = "resolution=merge-duplicates,return=minimal"


def group_by_keys(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Split rows into batches that each have exactly the same keys (order of first appearance)."""
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(tuple(sorted(row)), []).append(row)
    return list(groups.values())


class LocalStore:
    """Writes to out/<table>.json. For local testing only (out/ is gitignored)."""

    def __init__(self, out_dir: Path = ROOT / "out") -> None:
        self.out = out_dir
        self.out.mkdir(exist_ok=True)

    def load_watchlist(self) -> list[dict[str, Any]]:
        path = ROOT / "seed" / "watchlist.yaml"
        if not path.exists():
            path = ROOT / "config" / "watchlist.example.yaml"
        data = yaml.safe_load(path.read_text()) or {}
        return [
            {
                "user_id": LOCAL_USER,
                "symbol": t["symbol"],
                "name": t.get("name"),
                "market": t.get("market", "US"),
            }
            for t in data.get("tickers", [])
        ]

    def load_previous_suspects(self) -> dict[str, set[str]]:
        path = self.out / "latest_scores.json"
        if not path.exists():
            return {}
        out: dict[str, set[str]] = {}
        for row in json.loads(path.read_text()):
            out.setdefault(row["symbol"], set()).update(
                (row.get("checks") or {}).get("suspect_dates") or []
            )
        return out

    def _read(self, table: str) -> list[dict[str, Any]]:
        path = self.out / f"{table}.json"
        return json.loads(path.read_text()) if path.exists() else []

    def load_previous_scores(self) -> dict[tuple[str, str], float | None]:
        return {(r["user_id"], r["symbol"]): r.get("score") for r in self._read("latest_scores")}

    def load_transactions(self) -> list[dict[str, Any]]:
        return self._read("transactions_seed")  # out/transactions_seed.json, local tests only

    def load_alert_state(self, day: str) -> set[tuple[str, str, str]]:
        return {
            (r["user_id"], r["symbol"], r["kind"])
            for r in self._read("alert_state")
            if r["day"] == day
        }

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> bool:
        keys = on_conflict.split(",")
        path = self.out / f"{table}.json"
        existing = json.loads(path.read_text()) if path.exists() else []
        merged = {tuple(str(r[k]) for k in keys): r for r in existing}
        merged.update({tuple(str(r[k]) for k in keys): r for r in rows})
        path.write_text(json.dumps(list(merged.values()), indent=1, default=str))
        return True

    def insert(self, table: str, rows: list[dict[str, Any]]) -> bool:
        path = self.out / f"{table}.json"
        existing = json.loads(path.read_text()) if path.exists() else []
        path.write_text(json.dumps(existing + rows, indent=1, default=str))
        return True

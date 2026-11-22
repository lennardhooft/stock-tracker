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
        rows = self._get("watchlist", {"select": "user_id,symbol,name,market"})
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

    def upsert(self, table: str, rows: list[dict[str, Any]], on_conflict: str) -> bool:
        if not rows:
            return True

        def _call() -> bool:
            r = requests.post(
                f"{self.base}/{table}",
                headers={**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"},
                params={"on_conflict": on_conflict},
                data=json.dumps(rows, default=str),
                timeout=HTTP_TIMEOUT,
            )
            r.raise_for_status()
            return True

        return bool(with_retries(_call, f"supabase upsert {table}"))

    def insert(self, table: str, rows: list[dict[str, Any]]) -> bool:
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

"""Encrypted backups of the owner's own data (CLAUDE.md 13.14 E).

    python -m src.backup run                   # weekly: export, encrypt, commit to the private repo
    python -m src.backup restore FILE          # show what's in a backup (counts per table)
    python -m src.backup restore FILE --apply  # write it back into Supabase (upsert, no deletes)

Format (same as the app's "Export everything"): JSON
{format, v, kdf: "pbkdf2-sha256", iter, salt, iv, ct} with AES-256-GCM (ct includes the tag).
Logs counts only; the passphrase and tokens come from env vars / GitHub Secrets.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from src import log
from src.fetch import with_retries

FORMAT = "bottom-tracker-backup"
ITERATIONS = 600_000
# owner-entered tables, in restore order (parents first). Scores etc. are rebuilt nightly.
TABLES: dict[str, str] = {
    "watchlist": "id",
    "portfolio_settings": "user_id",
    "risk_settings": "user_id",
    "risk_settings_log": "id",
    "transactions": "id",
    "thesis": "user_id,symbol",
    "pending_decisions": "id",
    "reviews": "id",
}


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _key(passphrase: str, salt: bytes, iterations: int) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations)
    return kdf.derive(passphrase.encode())


def encrypt(data: dict[str, Any], passphrase: str, iterations: int = ITERATIONS) -> dict[str, Any]:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if len(passphrase) < 12:
        raise ValueError("passphrase must be at least 12 characters")
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(passphrase, salt, iterations)).encrypt(iv, json.dumps(data).encode(), None)
    return {
        "format": FORMAT,
        "v": 1,
        "kdf": "pbkdf2-sha256",
        "iter": iterations,
        "salt": _b64(salt),
        "iv": _b64(iv),
        "ct": _b64(ct),
    }


def decrypt(blob: dict[str, Any], passphrase: str) -> dict[str, Any]:
    """Raises ValueError for a wrong passphrase or a damaged / unknown file."""
    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    if blob.get("format") != FORMAT or blob.get("v") != 1 or blob.get("kdf") != "pbkdf2-sha256":
        raise ValueError("not a Bottom Tracker backup (or a newer version)")
    salt, iv, ct = (base64.b64decode(blob[k]) for k in ("salt", "iv", "ct"))
    try:
        plain = AESGCM(_key(passphrase, salt, int(blob["iter"]))).decrypt(iv, ct, None)
    except InvalidTag as exc:
        raise ValueError("wrong passphrase or damaged file") from exc
    return json.loads(plain)


def counts(data: dict[str, Any]) -> dict[str, int]:
    return {t: len(rows) for t, rows in (data.get("tables") or {}).items()}


# ---------------------------------------------------------------- Supabase


def _headers(key: str) -> dict[str, str]:
    from src.storage import auth_headers

    return auth_headers(key)


def export_tables(url: str, key: str) -> dict[str, Any]:
    tables: dict[str, list[dict[str, Any]]] = {}
    for t in TABLES:

        def _get(t: str = t) -> list[dict[str, Any]]:
            r = requests.get(
                f"{url.rstrip('/')}/rest/v1/{t}",
                params={"select": "*"},
                headers=_headers(key),
                timeout=30,
            )
            r.raise_for_status()
            return r.json()

        rows = with_retries(_get, f"backup read {t}")
        if rows is None:
            raise RuntimeError("backup: a table could not be read")
        tables[t] = rows
    return {"created_at": datetime.now(timezone.utc).isoformat(), "tables": tables}


def restore_tables(url: str, key: str, data: dict[str, Any]) -> dict[str, int]:
    done = {}
    for t, conflict in TABLES.items():
        rows = (data.get("tables") or {}).get(t) or []
        if not rows:
            continue
        r = requests.post(
            f"{url.rstrip('/')}/rest/v1/{t}",
            params={"on_conflict": conflict},
            headers={**_headers(key), "Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(rows),
            timeout=60,
        )
        r.raise_for_status()
        done[t] = len(rows)
    return done


# ---------------------------------------------------------------- private repo


def commit_file(repo: str, token: str, path: str, content: bytes, message: str) -> None:
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}
    existing = requests.get(api, headers=h, timeout=30)
    body: dict[str, Any] = {"message": message, "content": _b64(content)}
    if existing.status_code == 200:
        body["sha"] = existing.json()["sha"]
    r = requests.put(api, headers=h, json=body, timeout=60)
    r.raise_for_status()


def record_run(url: str, key: str, started: str, status: str, c: dict[str, int]) -> None:
    requests.post(
        f"{url.rstrip('/')}/rest/v1/job_runs",
        headers={**_headers(key), "Prefer": "return=minimal"},
        data=json.dumps(
            [
                {
                    "job": "backup",
                    "started_at": started,
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "status": status,
                    "counts": c,
                    "sources": {},
                }
            ]
        ),
        timeout=30,
    )


def run() -> int:
    env = os.environ
    need = (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "BACKUP_PASSPHRASE",
        "BACKUP_REPO",
        "BACKUP_REPO_TOKEN",
    )
    missing = [k for k in need if not env.get(k)]
    if missing:
        log.info(f"backup: not configured ({len(missing)} secrets missing), nothing done")
        return 0
    started = datetime.now(timezone.utc).isoformat()
    url, key = env["SUPABASE_URL"], env["SUPABASE_SERVICE_KEY"]
    try:
        data = export_tables(url, key)
        blob = encrypt(data, env["BACKUP_PASSPHRASE"])
        # prove the file can be read back before relying on it
        if counts(decrypt(blob, env["BACKUP_PASSPHRASE"])) != counts(data):
            raise RuntimeError("backup: read-back check failed")
        day = started[:10]
        commit_file(
            env["BACKUP_REPO"],
            env["BACKUP_REPO_TOKEN"],
            f"backups/{day}.json.enc",
            json.dumps(blob).encode(),
            f"Backup {day}",
        )
    except Exception as exc:  # noqa: BLE001
        log.error(f"backup: failed ({log.exc_kind(exc)})")
        record_run(url, key, started, "failed", {})
        return 1
    c = counts(data)
    record_run(url, key, started, "ok", {"rows": sum(c.values()), "tables": len(c)})
    log.info(f"backup: ok, {sum(c.values())} rows from {len(c)} tables, read-back verified")
    return 0


def restore(path: str, apply: bool) -> int:
    blob = json.loads(Path(path).read_text())
    passphrase = os.environ.get("BACKUP_PASSPHRASE") or getpass.getpass("Backup passphrase: ")
    try:
        data = decrypt(blob, passphrase)
    except ValueError as exc:
        print(f"Can't open the backup: {exc}", file=sys.stderr)
        return 1
    print(f"Backup from {data.get('created_at', '?')}:")
    for t, n in counts(data).items():
        print(f"  {t}: {n} rows")
    if not apply:
        print("Nothing written. Add --apply to restore into Supabase.")
        return 0
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY to restore.", file=sys.stderr)
        return 1
    done = restore_tables(url, key, data)
    print(f"Restored {sum(done.values())} rows into {len(done)} tables.")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Encrypted backups")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run")
    r = sub.add_parser("restore")
    r.add_argument("file")
    r.add_argument("--apply", action="store_true")
    a = p.parse_args(argv)
    return run() if a.cmd == "run" else restore(a.file, a.apply)


if __name__ == "__main__":
    sys.exit(main())

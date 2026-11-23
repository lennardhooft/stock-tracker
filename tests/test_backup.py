"""Encrypted backups (src/backup.py): round trip, wrong passphrase, browser format. FAKE data."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src import backup

DATA = {
    "created_at": "2026-11-23T03:00:00+00:00",
    "tables": {
        "watchlist": [{"id": "w1", "symbol": "NRDX"}],
        "transactions": [],
        "thesis": [{"symbol": "ORCA"}],
    },
}


def test_round_trip_and_fresh_salt():
    a = backup.encrypt(DATA, "correct horse battery", iterations=1000)
    b = backup.encrypt(DATA, "correct horse battery", iterations=1000)
    assert a["salt"] != b["salt"] and a["ct"] != b["ct"]
    assert backup.decrypt(a, "correct horse battery") == DATA
    assert "NRDX" not in json.dumps(a)  # nothing readable in the file


def test_wrong_passphrase_and_bad_file():
    blob = backup.encrypt(DATA, "correct horse battery", iterations=1000)
    with pytest.raises(ValueError, match="wrong passphrase"):
        backup.decrypt(blob, "wrong horse battery!")
    with pytest.raises(ValueError, match="not a Bottom Tracker backup"):
        backup.decrypt({**blob, "format": "other"}, "correct horse battery")


def test_short_passphrase_refused():
    with pytest.raises(ValueError):
        backup.encrypt(DATA, "short", iterations=1000)


def test_reads_the_app_export_format():
    # made by web/lib/backup.js (WebCrypto) in tests/js/backup.test.mjs; FAKE data, passphrase below
    blob = json.loads((Path(__file__).parent / "fixtures" / "backup_from_browser.json").read_text())
    data = backup.decrypt(blob, "fake passphrase for tests")
    assert backup.counts(data) == {"watchlist": 1, "transactions": 2}
    assert data["tables"]["transactions"][1]["emotion"] == "plan"


def test_restore_order_parents_first():
    names = list(backup.TABLES)
    assert names.index("transactions") < names.index("reviews")
    assert names.index("watchlist") < names.index("transactions")


def test_not_configured_does_nothing(monkeypatch, capsys):
    for k in (
        "SUPABASE_URL",
        "SUPABASE_SERVICE_KEY",
        "BACKUP_PASSPHRASE",
        "BACKUP_REPO",
        "BACKUP_REPO_TOKEN",
    ):
        monkeypatch.delenv(k, raising=False)
    assert backup.run() == 0
    assert "not configured" in capsys.readouterr().out

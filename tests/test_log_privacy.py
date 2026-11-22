"""Public logs must never contain tickers (CLAUDE.md 2.1 rule 4)."""

from __future__ import annotations

import logging
import sys

from src import fetch, log
from src.storage import group_by_keys


def test_library_logging_is_silenced(capsys, monkeypatch):
    monkeypatch.delenv("LOCAL_DEBUG", raising=False)
    log.silence_libraries()
    logging.getLogger("yfinance").error("SECRETX: possibly delisted")
    logging.getLogger().error("SECRETY: root logger")
    out = capsys.readouterr()
    assert "SECRET" not in out.out + out.err


def test_library_prints_inside_fetch_are_swallowed(capsys, monkeypatch):
    monkeypatch.delenv("LOCAL_DEBUG", raising=False)

    def noisy():
        print("SECRETZ: No earnings dates found")
        print("SECRETZ: HTTP Error 404", file=sys.stderr)
        return 1

    assert fetch.with_retries(noisy, "test") == 1
    out = capsys.readouterr()
    assert "SECRET" not in out.out + out.err


def test_upsert_batches_have_identical_keys():
    rows = [
        {"symbol": "A", "price": 1, "error": None},
        {"symbol": "B", "error": "no price data"},
        {"symbol": "C", "error": None, "price": 2},
    ]
    batches = group_by_keys(rows)
    assert len(batches) == 2
    for b in batches:
        assert len({tuple(sorted(r)) for r in b}) == 1
    assert sum(len(b) for b in batches) == 3

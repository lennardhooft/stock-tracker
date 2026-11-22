"""Row-level security check against the real Supabase project (CLAUDE.md 13.13.2).

An anonymous (not logged in) client must get 0 rows from every table.
Skipped unless SUPABASE_URL and SUPABASE_ANON_KEY are set:

    SUPABASE_URL=... SUPABASE_ANON_KEY=... pytest tests/test_rls.py -q
"""

from __future__ import annotations

import os

import pytest
import requests

from src.storage import auth_headers

URL = os.environ.get("SUPABASE_URL")
ANON = os.environ.get("SUPABASE_ANON_KEY")
TABLES = [
    "watchlist",
    "latest_scores",
    "ticker_detail",
    "score_history",
    "market_snapshot",
    "job_runs",
]

pytestmark = pytest.mark.skipif(not (URL and ANON), reason="needs SUPABASE_URL + SUPABASE_ANON_KEY")


@pytest.mark.parametrize("table", TABLES)
def test_anonymous_reads_nothing(table):
    r = requests.get(
        f"{URL.rstrip('/')}/rest/v1/{table}",
        params={"select": "*", "limit": "1"},
        headers=auth_headers(ANON),
        timeout=20,
    )
    assert r.status_code in (200, 401, 403)
    if r.status_code == 200:
        assert r.json() == [], f"{table} leaks rows to anonymous users"


@pytest.mark.parametrize("table", ["watchlist"])
def test_anonymous_cannot_write(table):
    r = requests.post(
        f"{URL.rstrip('/')}/rest/v1/{table}",
        json={"symbol": "TEST"},
        headers=auth_headers(ANON),
        timeout=20,
    )
    assert r.status_code in (401, 403)

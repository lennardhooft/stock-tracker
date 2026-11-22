"""Check that the external connections work (run from GitHub: Actions → connections → Run).

Prints only "ok" / "failed" per service (public logs). Sends one test message to Telegram.

    python -m src.check_connections
"""

from __future__ import annotations

import os
import sys

import requests

from src import log
from src.alerts import send_telegram
from src.fetch import HTTP_TIMEOUT, with_retries


def check_finnhub() -> bool:
    key = os.environ.get("FINNHUB_API_KEY")
    if not key:
        return False

    def _call() -> bool:
        r = requests.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": "AAPL"},
            headers={"X-Finnhub-Token": key},  # header, so the key never appears in a URL
            timeout=HTTP_TIMEOUT,
        )
        r.raise_for_status()
        return "c" in r.json()

    return bool(with_retries(_call, "finnhub quote"))


def main() -> int:
    results = {
        "finnhub": check_finnhub(),
        "telegram": send_telegram(
            "✅ Bottom Tracker is connected.\n"
            "You'll get alerts here: strong bottom signals, big drops and your buy levels.\n"
            "This bot only talks to you."
        ),
    }
    for name, ok in results.items():
        log.info(f"{name}: {'ok' if ok else 'FAILED'}")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())

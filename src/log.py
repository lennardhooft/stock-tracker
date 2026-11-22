"""Privacy-safe logging (CLAUDE.md 2.1 rule 4).

GitHub Actions logs are PUBLIC on a public repo. So:
  * `info()` / `error()` take a public message that must contain only counts and statuses.
  * `private()` prints details (tickers, prices, exception text) ONLY when LOCAL_DEBUG=1,
    which must never be set in GitHub Actions.
"""

from __future__ import annotations

import os
import sys


def _local_debug() -> bool:
    return os.environ.get("LOCAL_DEBUG") == "1" and os.environ.get("GITHUB_ACTIONS") != "true"


def info(message: str) -> None:
    print(message, flush=True)


def error(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr, flush=True)


def private(message: str) -> None:
    """Detail that may contain personal data. Printed only in local debug mode."""
    if _local_debug():
        print(f"  [local] {message}", flush=True)


def exc_kind(exc: BaseException) -> str:
    """Exception class name (plus HTTP status code if any) — the message may contain a ticker."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    return f"{type(exc).__name__} {status}" if status else type(exc).__name__

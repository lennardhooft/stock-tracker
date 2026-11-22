"""Privacy-safe logging (CLAUDE.md 2.1 rule 4).

GitHub Actions logs are PUBLIC on a public repo. So:
  * `info()` / `error()` take a public message that must contain only counts and statuses.
  * `private()` prints details (tickers, prices, exception text) ONLY when LOCAL_DEBUG=1,
    which must never be set in GitHub Actions.
"""

from __future__ import annotations

import contextlib
import io
import logging
import os
import sys
from collections.abc import Iterator

# Third-party libraries (yfinance, urllib3, peewee, ...) log their own messages, and those contain
# ticker symbols ("XYZ: possibly delisted"). They must never reach the public log, so all library
# logging is switched off unless LOCAL_DEBUG is on. Our own output uses print() below.
NOISY = ("yfinance", "urllib3", "peewee", "requests", "curl_cffi", "httpx")


def _local_debug() -> bool:
    return os.environ.get("LOCAL_DEBUG") == "1" and os.environ.get("GITHUB_ACTIONS") != "true"


def silence_libraries() -> None:
    if _local_debug():
        return
    logging.basicConfig(level=logging.CRITICAL + 1, force=True)
    logging.getLogger().setLevel(logging.CRITICAL + 1)
    for name in NOISY:
        lg = logging.getLogger(name)
        lg.setLevel(logging.CRITICAL + 1)
        lg.propagate = False
        lg.handlers.clear()
        lg.addHandler(logging.NullHandler())
        lg.disabled = True


@contextlib.contextmanager
def quiet() -> Iterator[None]:
    """Swallow anything a library prints to stdout/stderr (it may name a ticker)."""
    if _local_debug():
        yield
        return
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        yield


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


silence_libraries()

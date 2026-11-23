"""The bundled Telegram function must match its sources (run scripts/build_bot.py after edits)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_bundle_is_up_to_date():
    r = subprocess.run([sys.executable, "scripts/build_bot.py", "--check"], cwd=ROOT)
    assert r.returncode == 0, "telegram-bot/index.ts is stale: run scripts/build_bot.py"

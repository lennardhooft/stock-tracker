"""config/guardrails.yaml and its browser copy web/lib/guardrails-config.js must be identical."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_js_copy_matches_yaml():
    js = (ROOT / "web" / "lib" / "guardrails-config.js").read_text()
    blob = re.search(r"/\*JSON\*/(.*?)/\*END\*/", js, re.S).group(1)
    assert json.loads(blob) == yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text())


def test_owner_defaults():
    g = yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text())
    assert g["trade_limit"]["per_month"] == 4
    assert all(v.get("enabled", True) for v in g.values())

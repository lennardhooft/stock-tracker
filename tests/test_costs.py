"""config/costs.yaml and its browser copy web/lib/costs.js must be identical."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_js_costs_match_yaml():
    js = (ROOT / "web" / "lib" / "costs.js").read_text()
    blob = re.search(r"/\*JSON\*/(.*?)/\*END\*/", js, re.S).group(1)
    assert json.loads(blob) == yaml.safe_load((ROOT / "config" / "costs.yaml").read_text())


def test_rates_are_fractions():
    cfg = yaml.safe_load((ROOT / "config" / "costs.yaml").read_text())["dividend_tax"]
    assert 0 < cfg["belgium"] < 1
    assert all(0 <= v < 1 for v in cfg["foreign"].values())
    assert set(cfg["suffix_country"].values()) <= set(cfg["foreign"])

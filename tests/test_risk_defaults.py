"""config/risk.yaml and its browser copy web/lib/risk-defaults.js must be identical."""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_js_defaults_match_yaml():
    js = (ROOT / "web" / "lib" / "risk-defaults.js").read_text()
    blob = re.search(r"/\*JSON\*/(.*?)/\*END\*/", js, re.S).group(1)
    assert json.loads(blob) == yaml.safe_load((ROOT / "config" / "risk.yaml").read_text())


def test_balanced_is_the_owner_default():
    cfg = yaml.safe_load((ROOT / "config" / "risk.yaml").read_text())
    assert cfg["profiles"]["balanced"]["risk_per_position"] == 1.5
    assert (
        cfg["profiles"]["balanced"]["core_min"] + cfg["profiles"]["balanced"]["satellite_max"]
        == 100
    )

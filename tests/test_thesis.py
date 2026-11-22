"""Thesis checks (src/thesis.py) — shared cases with web/lib/thesis.js."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from src import thesis

CASES = json.loads((Path(__file__).parent / "fixtures" / "thesis_cases.json").read_text())


def test_shared_cases():
    for c in CASES["cases"]:
        res = thesis.evaluate(c["rules"], CASES["metrics"])
        assert [r["ok"] for r in res] == c.get("oks", [])
        assert thesis.status(res) == c["status"]


def test_metrics_from_quality_parts():
    q = {
        "score": 74.4,
        "parts": [
            {"key": "growth", "value": {"cagr": 0.0812}},
            {"key": "margins", "value": {"now": 0.231}},
            {"key": "debt", "value": {"nd_ebitda": 1.25, "coverage": 14.0}},
            {"key": "roic", "value": {"avg": 0.183}},
            {"key": "fcf", "value": {"positive": 4}},
            {"key": "dilution", "value": {"per_year": -0.012}},
            {"key": "altman", "value": None},
        ],
    }
    close = pd.Series([100.0] * 60 + [130.0] * 10)
    m = thesis.metrics_from(q, 2, -12.34, close)
    assert m["quality_score"] == 74
    assert m["sales_growth"] == 8.12 and m["operating_margin"] == 23.1
    assert m["net_debt_ebitda"] == 1.25 and m["interest_cover"] == 14.0
    assert m["roic"] == 18.3 and m["fcf_years"] == 4 and m["share_change"] == -1.2
    assert m["bottom_score"] == 2 and m["from_high"] == -12.3
    assert m["rise_3m"] == 30.0


def test_metrics_unknown_without_data():
    m = thesis.metrics_from(None, None, None, None)
    assert all(v is None for v in m.values())


def test_describe_for_alerts():
    r = {"metric": "sales_growth", "op": ">=", "value": 10, "actual": 6.2}
    assert thesis.describe(r) == "sales growth 6,2 % < 10 %"

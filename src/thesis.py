"""Automatic thesis checks (CLAUDE.md 13.14 D). Pure functions, tested in tests/test_thesis.py.

The owner writes machine-checkable rules per holding ("sales growth ≥ 10 %"). The daily job
stores the current metric values per ticker (latest_scores.metrics, not personal), checks every
owner's rules and alerts when a holding goes from intact to broken. The browser shows the same
evaluation (web/lib/thesis.js); both are tested against tests/fixtures/thesis_cases.json.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

# metric → unit (for messages); values are stored in that unit (percentages as %, not fractions)
METRICS: dict[str, str] = {
    "quality_score": "pts",
    "sales_growth": "%",
    "operating_margin": "%",
    "net_debt_ebitda": "x",
    "interest_cover": "x",
    "roic": "%",
    "fcf_years": "yrs",
    "share_change": "%",
    "bottom_score": "pts",
    "from_high": "%",
    "rise_3m": "%",
}
NAMES = {
    "quality_score": "Quality Score",
    "sales_growth": "sales growth",
    "operating_margin": "operating margin",
    "net_debt_ebitda": "net debt / EBITDA",
    "interest_cover": "interest cover",
    "roic": "ROIC",
    "fcf_years": "years with positive free cash flow",
    "share_change": "share count change",
    "bottom_score": "Bottom Score",
    "from_high": "distance from the 52-week high",
    "rise_3m": "3-month change",
}


def _r(v: Any, nd: int = 2) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else round(f, nd)  # NaN → None


def metrics_from(
    quality: dict[str, Any] | None,
    score: float | None,
    pct_from_high: float | None,
    close: pd.Series | None,
) -> dict[str, float | None]:
    """Current values of every metric for one ticker (None when unknown)."""
    parts = {p["key"]: p for p in (quality or {}).get("parts", []) if isinstance(p, dict)}

    def val(key: str, field: str, scale: float = 1.0) -> float | None:
        v = (parts.get(key) or {}).get("value") or {}
        x = v.get(field) if isinstance(v, dict) else None
        return _r(x * scale) if isinstance(x, (int, float)) else None

    rise = None
    if close is not None and len(close) > 63:
        rise = _r((float(close.iloc[-1]) / float(close.iloc[-64]) - 1) * 100, 1)
    return {
        "quality_score": _r((quality or {}).get("score"), 0),
        "sales_growth": val("growth", "cagr", 100),
        "operating_margin": val("margins", "now", 100),
        "net_debt_ebitda": val("debt", "nd_ebitda"),
        "interest_cover": val("debt", "coverage"),
        "roic": val("roic", "avg", 100),
        "fcf_years": val("fcf", "positive"),
        "share_change": val("dilution", "per_year", 100),
        "bottom_score": _r(score, 0),
        "from_high": _r(pct_from_high, 1),
        "rise_3m": rise,
    }


def evaluate(rules: list[dict[str, Any]], metrics: dict[str, Any]) -> list[dict[str, Any]]:
    """Each rule {metric, op ('>=' | '<='), value} with the actual value and ok (None = unknown)."""
    out = []
    for r in rules or []:
        actual = (metrics or {}).get(r.get("metric"))
        target = _r(r.get("value"), 6)
        ok = None
        if actual is not None and target is not None and r.get("op") in (">=", "<="):
            ok = actual >= target if r["op"] == ">=" else actual <= target
        out.append({**r, "actual": actual, "ok": ok})
    return out


def status(results: list[dict[str, Any]]) -> str:
    """none (no rules) · unknown (no rule could be checked) · intact · broken1 · broken."""
    if not results:
        return "none"
    broken = sum(1 for r in results if r["ok"] is False)
    if broken >= 2:
        return "broken"
    if broken == 1:
        return "broken1"
    return "intact" if any(r["ok"] is True for r in results) else "unknown"


def describe(r: dict[str, Any]) -> str:
    """'sales growth 6 % < 10 %' for an alert message."""
    unit = METRICS.get(r["metric"], "")
    u = " %" if unit == "%" else "×" if unit == "x" else ""
    sign = "<" if r["op"] == ">=" else ">"

    def f(x: float) -> str:
        return f"{x:g}".replace(".", ",")

    return f"{NAMES.get(r['metric'], r['metric'])} {f(r['actual'])}{u} {sign} {f(r['value'])}{u}"

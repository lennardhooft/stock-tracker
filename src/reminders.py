"""Personal reminders from the daily job (CLAUDE.md 13.14 C + D, 13.18 B).

Pure functions, tested in tests/test_reminders.py.

* decision_ready — a "Decide tomorrow" idea whose 24 hours are over (once per idea).
* review_due     — 3 and 12 months after a buy or sell, until reviewed (once per trade and moment).
* thesis_broken  — a holding's thesis rules go from intact to broken (on the change only).

Messages go only to the owner's Telegram chat; the public log gets counts only.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime
from typing import Any

from src import thesis
from src.alerts import Alert


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _link(app_url: str, path: str) -> str:
    return f"{app_url.rstrip('/')}/#/{path}"


def decision_alerts(
    pending: list[dict[str, Any]], now: datetime, sent: set[tuple[str, str]], app_url: str
) -> list[tuple[Alert, str]]:
    out = []
    for p in pending:
        key = f"decision:{p['id']}"
        if p.get("status") != "waiting" or (p["user_id"], key) in sent:
            continue
        after = datetime.fromisoformat(str(p["decide_after"]).replace("Z", "+00:00"))
        if after > now:
            continue
        sym = p["symbol"]
        amount = p.get("amount")
        what = f" (€ {amount:,.0f})".replace(",", ".") if amount else ""
        out.append(
            (
                Alert(
                    p["user_id"],
                    sym,
                    "decision_ready",
                    f"🕑 Ready to decide: {sym}{what}",
                    "Your 24 hours are over. Look again with fresh eyes: still in your plan?",
                    _link(app_url, f"canibuy/{sym}"),
                ),
                key,
            )
        )
    return out


def review_alerts(
    transactions: list[dict[str, Any]],
    reviews: list[dict[str, Any]],
    today: date,
    sent: set[tuple[str, str]],
    cfg: dict[str, Any],
    app_url: str,
) -> list[tuple[Alert, str]]:
    months = cfg.get("after_months", [3, 12])
    window = int(cfg.get("remind_window_days", 14))
    done = {(r["transaction_id"], r["due"]) for r in reviews}
    out = []
    for t in transactions:
        if t.get("kind") not in ("buy", "sell") or not t.get("id"):
            continue
        d = date.fromisoformat(str(t["date"])[:10])
        for m in months:
            due = f"{m}m"
            when = add_months(d, m)
            key = f"review:{t['id']}:{due}"
            if (t["id"], due) in done or (t["user_id"], key) in sent:
                continue
            if not (when <= today and (today - when).days <= window):
                continue
            verb = "bought" if t["kind"] == "buy" else "sold"
            out.append(
                (
                    Alert(
                        t["user_id"],
                        t["symbol"],
                        "review_due",
                        f"📝 Review: you {verb} {t['symbol']} {m} months ago",
                        "How did that decision work out? Rate the process, not just the result.",
                        _link(app_url, "portfolio/decisions"),
                    ),
                    key,
                )
            )
    return out


def thesis_alerts(
    theses: list[dict[str, Any]], metrics: dict[str, dict[str, Any]], app_url: str
) -> tuple[list[Alert], list[dict[str, Any]]]:
    """Alerts for holdings that just broke, and the new last_status for every thesis."""
    alerts, updates = [], []
    for th in theses:
        sym = th["symbol"].upper()
        res = thesis.evaluate(th.get("rules") or [], metrics.get(sym) or {})
        st = thesis.status(res)
        if st in ("broken1", "broken") and th.get("last_status") not in ("broken1", "broken"):
            bad = [thesis.describe(r) for r in res if r["ok"] is False]
            alerts.append(
                Alert(
                    th["user_id"],
                    sym,
                    "thesis_broken",
                    f"❗ {sym} thesis rule broken",
                    "; ".join(bad) + ". Check whether your reason to own it still holds.",
                    _link(app_url, f"thesis/{sym}"),
                )
            )
        if st != th.get("last_status"):
            updates.append({"user_id": th["user_id"], "symbol": sym, "last_status": st})
    return alerts, updates

"""Personal reminders (src/reminders.py), FAKE data."""

from __future__ import annotations

from datetime import date, datetime, timezone

from src import reminders as rm

U = "u1"
URL = "https://example.test"


def test_add_months_end_of_month():
    assert rm.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert rm.add_months(date(2025, 11, 30), 3) == date(2026, 2, 28)
    assert rm.add_months(date(2025, 11, 22), 12) == date(2026, 11, 22)


def test_decision_ready_once_after_24h():
    now = datetime(2026, 11, 23, 22, 0, tzinfo=timezone.utc)
    pending = [
        {
            "id": "d1",
            "user_id": U,
            "symbol": "ORCA",
            "amount": 1000,
            "status": "waiting",
            "decide_after": "2026-11-23T20:00:00+00:00",
        },
        {
            "id": "d2",
            "user_id": U,
            "symbol": "NRDX",
            "status": "waiting",
            "decide_after": "2026-11-24T20:00:00+00:00",
        },
        {
            "id": "d3",
            "user_id": U,
            "symbol": "HALD",
            "status": "dropped",
            "decide_after": "2026-11-20T20:00:00+00:00",
        },
    ]
    out = rm.decision_alerts(pending, now, set(), URL)
    assert [(a.symbol, k) for a, k in out] == [("ORCA", "decision:d1")]
    assert "€ 1.000" in out[0][0].title and out[0][0].url.endswith("#/canibuy/ORCA")
    assert rm.decision_alerts(pending, now, {(U, "decision:d1")}, URL) == []


def test_reviews_due_window_and_done():
    txs = [
        {"id": "t1", "user_id": U, "symbol": "ORCA", "kind": "buy", "date": "2026-08-20"},
        {"id": "t2", "user_id": U, "symbol": "NRDX", "kind": "sell", "date": "2025-11-20"},
        {"id": "t3", "user_id": U, "symbol": "WORLD.AS", "kind": "start", "date": "2026-08-20"},
        {"id": "t4", "user_id": U, "symbol": "HALD", "kind": "buy", "date": "2026-05-01"},
    ]
    cfg = {"after_months": [3, 12], "remind_window_days": 14}
    out = rm.review_alerts(txs, [], date(2026, 11, 22), set(), cfg, URL)
    keys = sorted(k for _, k in out)
    # t1 3m due 20 Nov ✓; t2 12m due 20 Nov ✓; t3 is a starting position;
    # t4 3m was due 1 Aug (too old)
    assert keys == ["review:t1:3m", "review:t2:12m"]
    assert "sold NRDX 12 months ago" in [a.title for a, k in out if k == "review:t2:12m"][0]
    done = [{"transaction_id": "t1", "due": "3m"}]
    assert [k for _, k in rm.review_alerts(txs, done, date(2026, 11, 22), set(), cfg, URL)] == [
        "review:t2:12m"
    ]


def test_thesis_alert_only_on_change():
    theses = [
        {
            "user_id": U,
            "symbol": "ORCA",
            "rules": [{"metric": "sales_growth", "op": ">=", "value": 10}],
            "last_status": "intact",
        },
        {
            "user_id": U,
            "symbol": "NRDX",
            "rules": [{"metric": "sales_growth", "op": ">=", "value": 10}],
            "last_status": "broken1",
        },
        {"user_id": U, "symbol": "BLMT.BR", "rules": [], "last_status": None},
    ]
    metrics = {"ORCA": {"sales_growth": 6.0}, "NRDX": {"sales_growth": 4.0}}
    alerts, updates = rm.thesis_alerts(theses, metrics, URL)
    assert [a.symbol for a in alerts] == ["ORCA"]
    assert "sales growth 6 % < 10 %" in alerts[0].body
    assert {u["symbol"]: u["last_status"] for u in updates} == {
        "ORCA": "broken1",
        "BLMT.BR": "none",
    }

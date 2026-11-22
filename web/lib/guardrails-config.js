/* Guardrails — a copy of config/guardrails.yaml for the browser (checked by tests/test_guardrails_config.py).
 * The JSON between the markers must stay valid JSON. */
export const GUARDRAILS = /*JSON*/ {
  "cooling_off": {
    "enabled": true,
    "hours": 24
  },
  "fomo": {
    "enabled": true,
    "rise_3m_pct": 30,
    "top_score_min": 3
  },
  "panic_sell": {
    "enabled": true,
    "drawdown_pct": 20
  },
  "trade_limit": {
    "enabled": true,
    "per_month": 4
  },
  "decision_log": {
    "enabled": true,
    "emotions": [
      "calm",
      "plan",
      "fomo",
      "fear"
    ]
  },
  "checklist": {
    "quality_min": 70,
    "earnings_days": 7,
    "costs_warn_pct": 1.0
  },
  "reviews": {
    "enabled": true,
    "after_months": [
      3,
      12
    ],
    "remind_window_days": 14
  }
} /*END*/;

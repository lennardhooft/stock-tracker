# Alerts (Phase 2B) — Telegram messages + `#/more/alerts`

**Main question (app page):** "What did the app tell me, and when?"
**Primary action:** tap an alert → that stock's page.

## Alerts sent by the daily job (CLAUDE.md 7.1, 6.5, 13.14 E)
| Kind | Fires when | Example message |
|---|---|---|
| `score_cross` | Bottom Score crosses **up** to ≥ the alert threshold (4) | 🟠 **NVDA: 4/4 bottom signals** · Price is near its 4-year average, RSI is oversold, … · $125.53 · ▶ link |
| `buy_level` | Close ≤ the owner's buy level | 🔔 **BLMT.BR reached your buy level** · € 42,15 ≤ € 43,00 · Bottom Score 2/4 (Watch) · ▶ link |
| `drop` | Close ≥ 5 % below the previous close | 🔻 **NVDA −6,2 % today** ($118,40) · Bottom Score 3/4 (Watch) · ▶ link |
| `support_test` | Price within 2 % of (or inside) a monthly/yearly support zone with ≥ 2 touches | 🟢 **NVDA is testing support $105–110** · 3 previous bottoms (2022, 2023, 2024) · ▶ link |
| `support_break` | Close drops below such a zone that the previous close was still above | ⚠️ **NVDA broke below support $105–110** · ▶ link |
| `data_problem` | Something in the run is red (suspect prices, unscored stocks) — one summary per day | ⚠️ **Data check: 1 stock has suspect prices** · left out of scores until confirmed · ▶ health link |

Intraday alerts (drop, volume, buy level and news every 15 minutes) come in stage 2D. Earnings reminders come in 2C (Finnhub).

## Rules (7.2)
- Each kind fires **at most once per stock per day** (state in `alert_state`, Brussels date).
- Quiet hours exist in `config/alerts.yaml` but are **off** (owner decision). When on, only *Extreme* scores pass.
- Messages: ticker, what happened, key numbers, Bottom Score, link to the stock page. Plain language, no advice wording.
- Numbers use the Belgian format (same formatter rules as the app).
- Telegram only ever sends to the owner's chat id. Public job logs show counts only.
- Every sent alert is stored in `alerts_log` (owner-readable) for the app page.

## App page — More → Alerts
- Newest first, grouped by day ("Today", "Yesterday", "Mon 17 Nov").
- Each row: icon + colour + word for the kind, title, one-line body, time (Brussels), tap → stock page.
- **Empty state:** "No alerts yet. You'll get a Telegram message when a stock shows strong bottom signals, drops sharply or reaches your buy level."
- **Not delivered** (Telegram failed): row shows "⚠️ not delivered to Telegram".
- Loading / error / offline: as in the design system.

## Acceptance
- [ ] Rule functions are pure and unit-tested (cross, de-dup, quiet hours, message text).
- [ ] A second run on the same day sends nothing new.
- [ ] Alerts page passes the UX checklist (8.12) at 375 / 768 / 1280, dark + light.

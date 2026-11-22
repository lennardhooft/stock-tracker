# Portfolio 3D — guardrails, decision log, thesis checks, pre-trade checklist, reviews
(CLAUDE.md 13.14 C + D, 13.18 A + B). Same access rule as the Portfolio page (two-step login).
Rules live in `config/guardrails.yaml` (each switchable); costs in `config/costs.yaml` (owner verifies).

## 1. Can I buy this? → pre-trade checklist & order planner — `#/canibuy/SYM`
Order on the screen (answer first, then what to check, then how):
1. **FOMO warning first** (before the answer) when the stock rose ≥ 30 % in 3 months or its Top Score is ≥ 3:
   "ORCA is up 42 % in 3 months. Buying after a big run is often FOMO: is this in your plan?"
2. The sizing answer (unchanged) + amount field.
3. **Checklist** (✅ / ⚠️ / – with a word, never colour alone):
   in your plan (owned, or on your watchlist with a buy level / thesis) · Quality ≥ 70 (stocks) · thesis written ·
   earnings within 7 days · trades this month (2 of 4) · within your sizing room (needs an amount) ·
   sector and region headroom.
4. **Costs** for the amount: broker fee + stock-exchange tax (TOB) + currency exchange, in € and % of the order;
   ⚠️ above 1 %. Rates from `config/costs.yaml` (verify them).
5. **Limit price ideas:** today's price · nearest support zone · 200-week average, each with the distance in %.
   Tapping one fills the planner.
6. **Impact preview:** position weight, sector, region, currency and satellite share — now → after.
7. Actions: **Log this trade** (after you placed it at Bolero; opens Add trade prefilled with quantity and price)
   and, when the stock isn't in your plan, **Decide tomorrow** (24-hour cooling-off).

## 2. Add trade (buy / sell) → decision log
Extra fields for buys and sells: **Why?** (one line, required) and **How do you feel?** chips:
Calm · Following my plan · FOMO · Fear (required). A snapshot of the scores and price is stored with the trade.
**Panic-sell check:** a sale while the stock is ≥ 20 % below its 52-week high (or your position is ≥ 20 % down)
first shows your thesis (why you bought, what would make you sell) and asks
"Has one of your sell reasons actually happened?" Yes / No (required, logged).

## 3. Cooling-off — "Decide tomorrow"
Saves the idea (stock, amount, reason) with a 24-hour timer. The Portfolio page shows "Decisions waiting" and,
after 24 h, "Ready to decide: ORCA € 1.000 — look again with fresh eyes" → opens Can I buy this? with the same
data and **Still buy** / **Drop it**. The nightly job sends one Telegram reminder when it's ready.

## 4. Trade limit
Portfolio page: "Trades this month: 2 of 4". At the limit: warning banner "You've reached your 4 trades for
November. Waiting costs nothing." Buys and sells count; starting positions and dividends don't.

## 5. Thesis — `#/thesis/SYM` (from the ticker page's My notes tab and each holding)
**Main question:** "Is the reason I bought still true?"
- Why I bought · what would make me sell (free text) · target price · review date.
- **Automatic checks** (rules): metric · ≥ / ≤ · value, e.g. "Sales growth ≥ 10 %". Each row shows the current
  value and ✅ / ❌. Metrics: Quality Score, sales growth (per year, 3 y), operating margin, net debt / EBITDA,
  interest cover, ROIC, free-cash-flow years positive, share count change, Bottom Score, distance from 52-week high.
- Status: ✅ thesis intact · ⚠️ 1 rule broken · ❌ several broken; shown on the holding card.
- The nightly job checks every rule (after each report the numbers change) and sends a Telegram alert when a
  holding goes from intact to broken: "ORCA thesis rule broken: sales growth 6 % < 10 %".

## 6. Decisions & reviews — `#/portfolio/decisions`
- **Reviews due** (+3 months and +12 months after each buy/sell): tap → review sheet:
  price then → now, vs MSCI World over the same period, what the signals said then (snapshot), your reason and
  feeling, thesis status now. Rate the **process** (good / bad — separate from the outcome) and add a lesson.
- **By feeling:** for each tag, number of trades and the average result since (buys: price now vs then).
- **All decisions** list with reason, feeling and result since.
The nightly job sends a Telegram reminder when a review comes due.

## States
No trades → decision log empty state. No thesis → "Write down why you bought it" + button. Metric n/a → "–" with
the reason. Guardrail switched off in config → its row/warning isn't shown.

## Acceptance
- [ ] "Can I buy € 2.000 of ASML?" still answered in ≤ 3 taps; checklist visible without extra taps.
- [ ] Every warning says what happened and what to do; no "buy now" language.
- [ ] Rules evaluate the same in the browser (display) and the job (alerts): shared test cases.

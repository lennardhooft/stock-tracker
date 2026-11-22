# Can I buy this? — `#/canibuy/NVDA` (Phase 3A, CLAUDE.md 13.13.4–5)

**Main question:** "How much of this stock fits my rules?"
**Primary action:** none in 3A (the pre-trade checklist and "Log this trade" come in 3D); secondary: **Add trade** after buying at Bolero.

## Flow (guided, not a form dump)
1. **Pick a stock** (prefilled from the ticker page / holding) and optionally an **amount** you're thinking of (decimal keyboard).
2. **The answer first, big:** "Up to € 1.250 · you own € 900 → room for € 350."
   If an amount was entered: ✅ "€ 300 fits your rules" / ⚠️ "€ 2.000 is € 1.650 more than your rules allow."
3. **Limiting rule** highlighted: "Limited by: risk per position (1,5 %)".
4. **All rules** as rows (the lowest wins, marked): risk-per-position amount · type cap · sector headroom · core/satellite headroom · cash available (minus reserve).
5. **How is this calculated?** (expander): the exact formula with the numbers
   "€ 750 max loss ÷ 72 % bad-case drop (1,5 × 48 % volatility) = € 1.042 × 1,2 (Quality on sale) = € 1.250".
6. **Staged plan:** 3 parts: now · at the nearest support zone · at the 200-week average (or −20 % / −30 % when there are none).
7. Disclaimer: "Suggested max based on your settings, not advice."

## Rules (engine `web/lib/sizing.js`, defaults `config/risk.yaml`; owner edits them in Settings → Risk)
- Volatility = annualised std of 1 year of daily returns; bad-case drop = k × volatility (k 1,5), capped by the historical max drawdown.
- `max € = portfolio € × risk per position % ÷ bad-case drop`, then × quality multiplier (≥70 ×1, 40–70 ×0,75, <40 ×0,5),
  × verdict (sale ×1,2, trap ×0,5).
- Final = lowest of: that amount, type cap × portfolio, sector headroom (max 25 %), satellite/speculative headroom, cash − reserve.
- Earnings within 7 days: a "volatility ahead" note, no change.

## States
| State | Shown |
|---|---|
| No portfolio yet | "Add your portfolio first, so the app knows its size." + **Add your first position** |
| No volatility yet (new stock) | uses the type's typical volatility and says so |
| Rule blocks (sector full) | answer "€ 0 — Technology is already at its 25 % max" |

## Acceptance
- [ ] "Can I buy € 2.000 of ASML?" answered in ≤ 3 taps from the ticker page.
- [ ] The worked example from CLAUDE.md 13.13.5 is a unit test.

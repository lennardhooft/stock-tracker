# Today (home) — `#/`

**Main question:** "Is anything worth my attention today?" Answered in 5 seconds, without scrolling or tapping.
**Primary action:** the button on the top attention card (e.g. "Research NRDX"). If there's nothing, none.

## Content, top to bottom
1. **One-line summary** in plain language, built from data:
   - "2 stocks show bottom signals · market mood: Extreme fear · updated today 22:47"
   - "No new bottom signals · market mood: Neutral · updated yesterday 22:47"
2. **"Needs your attention" cards** (max 4, most important first). Each card: what happened, why it matters, one button.
   Phase 1 card types, in priority order:
   1. **Strong bottom signals** — score ≥ 4 (alert threshold from config). "NRDX: 4 of 4 bottom signals. Price is 38 % below its high and RSI is oversold." → **Research NRDX**
   2. **Score rose** since the previous snapshot into Watch or higher. "BLMT.BR moved from Normal to Watch." → **See why**
   3. **Buy level reached** — price ≤ owner's buy level. → **Open BLMT.BR**
   4. **Earnings within 7 days** (Phase 2C) — "ASML reports in 3 days (Wed 26 Nov)". → **See details**
   5. **Data problem** — suspect prices or a failed job. → **See data health**
3. **Calm state** when there are no cards: "Nothing needs your attention today. Your watchlist is calm." (green, positive tone).
4. **Market strip:** 4 compact tiles: S&P 500 · Nasdaq · VIX · Fear & Greed, each with a **word** next to the number ("High fear", "Calm") and a day change. ⓘ on VIX and F&G.
   *Note: the plan mentions MSCI World in the strip; Phase 1 has Nasdaq data. MSCI World (IWDA.AS) is added when the market job fetches it.*
5. **Top of your watchlist:** the 3 highest-scoring stock cards + "See all 12" link → Watchlist.

## States (8.6)
| State | Shown |
|---|---|
| Loading | skeleton summary line, 2 skeleton cards, 4 skeleton tiles |
| Empty watchlist | summary "Your watchlist is empty" + empty state with **Add stock** (→ add sheet) |
| Calm | calm state component + market strip + top 3 |
| Partial | e.g. Fear & Greed missing → tile shows "n/a · source unavailable" |
| Stale | yellow banner under the summary: "Scores are from yesterday 22:47. Today's update hasn't run yet." |
| Error | error state with **Try again**, technical detail hidden behind Details |
| Offline | cached data + offline banner |
| First use | redirect to onboarding once (`#/welcome`) |

## Acceptance
- [ ] At 375 × 667 (small iPhone) the summary + first attention card are visible without scrolling.
- [ ] Every card has exactly one button, labelled with a verb + ticker.
- [ ] Task: "Why does NRDX have a score of 4?" → Today → card button → score breakdown: **≤ 2 taps**.
- [ ] Words + icons alongside every colour (market mood, score).

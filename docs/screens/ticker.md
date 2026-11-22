# Ticker detail — `#/ticker/NRDX`

**Main question:** "Why does this stock have this score, and is it worth researching?"
**Primary action (Phase 1–2):** **Set buy alert** (opens buy-level sheet). Becomes "Can I buy this?" in Phase 3.

## Header
- ← back · ticker · full name (wraps, never truncated here).
- Price, day change (▲/▼ + sign), "delayed 15 min" for EU stocks, "as of" time.
- **Score badge (long form)** with a one-sentence explanation built from the fired signals:
  "Strong bottom signals: price is near its 4-year average, 38 % below its high, and RSI is oversold."

## Tabs inside the page (Phase 1)
**Overview · Chart · Fundamentals · News · My notes** (Fundamentals and News from Phase 2C).

### Overview
1. **Bottom Score card:** each signal as a signal row (✅/❌/n/a, plain-language name, value vs threshold, ⓘ glossary). n/a rows always say why.
2. **Key stats tiles:** price vs 200-week MA (%), from 52w high, 52w low–high **range bar** with the current price marked, market.
3. **Data checks:** only if something's wrong: warning banner with the plain-language issue.

### Chart (Phase 2A update)
- **Weekly candles** with the **200-week MA** (Lightweight Charts), zoom presets 1Y · 3Y · **5Y** · 10Y, log scale on 5Y+.
- **Support / resistance zones** (CLAUDE.md 6.5) as shaded horizontal bands: green = support (below price), red = resistance (above). Line thickness by strength.
  Which zones show depends on the zoom: 10Y shows Y+M levels, 3–5Y M+W, 1Y W+D. At most 3 zones below and 3 above the price.
- **Markers:** ▲ on major previous bottoms, ▼ on major ceilings (monthly/yearly), each with date + price on tap/hover.
  A small ● marks the first week of every period when the Bottom Score was ≥ 4.
- **Compact legend with toggles:** Zones · 200-week average · Score ≥ 4. Choices remembered on the device.
- **Score history** panel under the chart: weekly Bottom Score as coloured bars (grey → yellow → orange → red), same zoom.
  History before the app existed is reconstructed from prices (T1–T3) and the VIX (S1 without Fear & Greed), and labelled as such.
- Text summary under the chart for screen readers: "Price is 12 % above its 200-week average… Nearest support $105–110 (6 % below)."
- Secondary tab **Live**: TradingView widget (weekly).

### Overview: "Nearest levels" card (Phase 2A)
- In words first: "Support at $105–110, 6 % below · 3 previous bottoms (2022, 2023, 2024) · seen on yearly, monthly and weekly charts".
- Same for the nearest resistance above. Flipped levels say so: "old ceiling, now support".
- ⓘ glossary entry for support/resistance.
- n/a state: "Not enough price history to find previous bottoms." 

### Fundamentals tab (Phase 2C)
- **Valuation vs its own history (V1):** "P/E 18,2 — cheaper than 85 % of the last 10 years" as a stat tile + range bar
  (min · now · max of its own history). Loss-making companies use P/S instead, and say so.
  The history length is always shown ("based on 4 years for EU stocks"). n/a with reason when there isn't enough.
- **Insider trades (V2):** net open-market buying in the last 90 days in words ("Insiders bought $ 2,1 mln net"),
  then the last 6 months of open-market buys/sells (who, role, date, shares, value). Grants and option exercises are left out.
  EU stocks: "n/a: no free insider data for EU stocks."
- Source and date of every number.

### News & events tab (Phase 2C)
- **Next earnings date** with countdown ("in 12 days · Tue 2 Dec · after the close"), EPS estimate if known,
  "estimated" vs "confirmed".
- **Latest 10 headlines**: headline, source, time ago; tap opens the article in a new tab.
- Empty state: "No recent news found."

### "Why is it down?" (13.1)
- When the stock fell ≥ 5 % on the day, the header shows the most recent headline from the last 48 hours under the price.
  Drop alerts on Telegram include it too.

### My notes
Buy level (decimal keyboard), notes (multi-line), Save. **Remove from watchlist** at the bottom (destructive style, Undo toast).

## States
| State | Shown |
|---|---|
| Loading | skeleton header + skeleton signal rows |
| Pending (just added) | "This stock is scored after tonight's update." + notes tab still usable |
| No score (error) | plain reason: "Yahoo has no price data for ZZQX. Check the symbol." + **Edit symbol** / **Remove** |
| Partial | n/a signal rows with reasons |
| Suspect data | warning banner, score marked ⚠️ |
| Not on watchlist | "ZZQX isn't on your watchlist." + **Add to watchlist** |

## Acceptance
- [ ] The answer ("why this score") is visible at 375 px without opening a tab.
- [ ] Every signal row has a glossary ⓘ.
- [ ] Chart readable at 375 px, has a text summary and passes axe.
- [ ] Back returns to the exact list position.

### Chart upgrades (Phase 2F, CLAUDE.md 13.17)
Calm by default: price + one lower panel; everything else is a toggle that's remembered on the device.
- **Info line above the chart** (the "tooltip", readable on a phone): date · close · % below the all-time high · weekly RSI · Bottom Score · Top Score.
  Shows the latest week by default and follows the crosshair (long-press + drag on mobile, hover on desktop).
- **Markers:** ▲/▼ major previous bottoms/ceilings (as before), ● Bottom Score ≥ 4 (start of each period), ▼ violet "T" Top Score ≥ 2 (prices-only history: trend + RSI, so max 2).
  **Tap a ●/T marker** → the info line says what happened next: "After this signal: +3 m +8,2 % · +6 m +15,1 % · +12 m +31,0 %".
- **Lines (toggles):** support/resistance zones · 200-week average · 52-week high/low · **cheap/expensive levels** — the price where today's earnings would put the P/E at its own 20th / 80th percentile ("cheap below $ 96", "expensive above $ 142"). Hidden when there's no valuation history.
- **Lower panels (chips, multi-select, default Score + RSI):**
  - **Score**: Bottom Score bars upward (grey→red) and Top Score bars downward (violet), so they're never confused.
  - **RSI**: weekly RSI with the 30 and 70 lines.
  - **Volume**: weekly volume; weeks ≥ 2× the 52-week average are highlighted.
  - **Drawdown**: % below the highest price so far (underwater chart).
  All panels share the time axis and the crosshair with the price chart.
- **Zoom:** 1Y · 3Y · 5Y · 10Y · **Max**; log scale on 5Y+; **double-tap** resets to the chosen zoom.
- Text summary for screen readers stays, plus the info line is `aria-live="polite"` only for marker taps (not for every crosshair move).

### Earnings reaction history (Phase 2G, CLAUDE.md 13.1) — News & events tab
- Lead line in words: "This stock typically moves ±7 % the day after earnings · beat estimates 7 of the last 8 times."
- Table of the last 8 reports (newest first): date · EPS actual vs estimate (✅ beat / ❌ miss, surprise %) · move day +1 · move +5 days.
  Moves with sign and ▲/▼. On a phone the table shows date, beat/miss and +1 day; +5 days wraps under it.
- Next dividend under the earnings card: "Ex-dividend Mon 1 Dec · $ 0,53 per share (estimated)".
- n/a: "No earnings history for this stock (ETFs have none)."
- After a report the daily job sends a Telegram alert: "📊 NVDA reported: EPS 2,68 vs 2,47 expected (beat) · −3,1 % the next day".

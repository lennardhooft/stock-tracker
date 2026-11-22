# Ticker detail — `#/ticker/NRDX`

**Main question:** "Why does this stock have this score, and is it worth researching?"
**Primary action (Phase 1–2):** **Set buy alert** (opens buy-level sheet). Becomes "Can I buy this?" in Phase 3.

## Header
- ← back · ticker · full name (wraps, never truncated here).
- Price, day change (▲/▼ + sign), "delayed 15 min" for EU stocks, "as of" time.
- **Score badge (long form)** with a one-sentence explanation built from the fired signals:
  "Strong bottom signals: price is near its 4-year average, 38 % below its high, and RSI is oversold."

## Tabs inside the page (Phase 1)
**Overview · Chart · My notes.** Fundamentals and News & events tabs appear in Phase 2.

### Overview
1. **Bottom Score card:** each signal as a signal row (✅/❌/n/a, plain-language name, value vs threshold, ⓘ glossary). n/a rows always say why.
2. **Key stats tiles:** price vs 200-week MA (%), from 52w high, 52w low–high **range bar** with the current price marked, market.
3. **Data checks:** only if something's wrong: warning banner with the plain-language issue.

### Chart
- Weekly price line with the **200-week MA** (Lightweight Charts), zoom presets 1Y · 3Y · **5Y** · 10Y, log scale on 5Y+.
- Text summary under the chart for screen readers: "Price is 12 % above its 200-week average, up from 3 % a month ago."
- Secondary tab **Live**: TradingView widget (weekly).

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

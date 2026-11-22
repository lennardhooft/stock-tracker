# Watchlist — `#/watchlist`

**Main question:** "How do my stocks look, and which are closest to a bottom?"
**Primary action:** **+ Add stock** (floating above the tab bar on phones, in the header on desktop).

## Content
1. Header line: "12 stocks · 2 with bottom signals".
2. **Sort** (segmented control): Score · Day change · From high · Name. Default: Score, highest first.
3. **Filter** button → bottom sheet: minimum score (0–6), market (US / EU), search text. Active filters show as removable chips under the sort control ("Score ≥ 2 ✕").
4. **Stock cards** (design-system component): ticker, name, score badge, price + day change, % from 52w high, sparkline. Tap → ticker detail.
5. **Quick actions** per card: long-press **and** a visible ⋯ button → sheet with *Open*, *Set buy level*, *Remove*. Remove uses a toast with **Undo** (no confirm dialog).

## Add stock (sheet)
- One input "Ticker or company", search-as-you-type over a small local list of common US/EU tickers + exact Yahoo symbol entry.
- Validation inline: format check (letters, digits, `.`, `-`), already on list → "Already on your watchlist", unknown → "We'll check this symbol tonight. If Yahoo doesn't know it, it shows as *No score*." plus suggestions for missing EU suffix ("Did you mean ASML.AS?").
- Optional fields collapsed under "More options": name, buy level (`inputmode="decimal"`), notes.
- Button: **Add to watchlist**. Afterwards: toast "Added ASML.AS · scored after tonight's update" and the card appears with the *Pending* badge.

## States
| State | Shown |
|---|---|
| Loading | 4 skeleton cards |
| Empty | empty state "Your watchlist is empty" + **Add stock** |
| Filter matches nothing | "No stocks match these filters." + **Clear filters** |
| Pending / error cards | badge *Pending* / *No score* with the reason on the detail page |
| Stale / offline / error | banners as in the design system |

## Acceptance
- [ ] Task: "Add a stock" → **≤ 4 taps**, invalid symbols can't be saved.
- [ ] Remove → Undo restores the stock with its notes and buy level.
- [ ] Sort and filter choices are remembered on this device.
- [ ] Desktop: list left, selected ticker detail right.

## Tags (Phase 2F, CLAUDE.md 13.6)
- Each stock can have up to 8 tags. Suggested: **core**, **speculative**, **wait-for-dip**; plus your own (letters, digits, `-`, max 20 characters).
- **Where to set them:** ticker page → *My notes* tab → "Tags": tap a suggested chip to toggle it, or type a new one and tap **Add tag**. Saved together with the notes (one **Save**).
- **On the card:** tags as small muted text under the price line ("core · wait-for-dip"). Nothing shown when there are none.
- **Filter:** the filter sheet gets a "Tags" row with one chip per tag in use (any of the chosen tags matches). Active tag filter shows as a removable chip.
- Data: `watchlist.tags text[]` (owner-edited, RLS like the rest of the watchlist).

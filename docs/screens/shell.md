# App shell

**Purpose:** the frame around every screen: where am I, is the data fresh, how do I get elsewhere.

## Layout
- **Phone (< 900 px):** top bar + content + bottom tab bar.
- **Tablet/desktop (≥ 900 px):** left side rail + top bar + content. Lists and details open side by side (list left, detail right).
- Content max width 1200 px. Safe areas respected (notch, home indicator).

## Top bar
- Left: screen title (or ← back on detail screens).
- Right: **search** icon (opens global search sheet), **data-freshness dot**.
- Freshness dot: green = updated after the last expected run · yellow = older than expected · red = last job failed. Tapping it opens the Health page. It always has an accessible label in words.

## Tabs (Phase 1)
**Today · Watchlist · More.** Portfolio and Calendar tabs appear only when Phases 3 and 2 build them (no greyed-out "coming soon").
More contains: Settings, Data health, Glossary, About & disclaimer, Log out.

## Routing
Hash routes with deep links: `#/`, `#/watchlist`, `#/ticker/NVDA`, `#/more`, `#/more/settings`, `#/more/health`, `#/welcome`.
Browser/phone back gesture works. Scroll position is kept when returning to a list. Max depth: tab → detail → sheet.

## Global search
Sheet with one input. Typing filters the watchlist by ticker or name. If nothing matches, it offers "Add *XYZ* to watchlist". Keyboard: `/` opens it on desktop.

## States
- **Not logged in:** login screen (email link) without the tab bar.
- **Offline:** last loaded data stays visible + "Offline: showing data from 14:32" banner. Data is cached locally after each load.

## Acceptance
- [ ] Tabs reachable with the thumb, 44 px targets, current tab marked in colour **and** by `aria-current`.
- [ ] Freshness dot shows the right state for fixture data fresh / stale / failed.
- [ ] Deep link `#/ticker/NRDX` opens directly, back returns to the list at the same scroll position.
- [ ] Works at 375 / 768 / 1280 px in both themes.

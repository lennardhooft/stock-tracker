# Calendar — `#/calendar` (Phase 2G, CLAUDE.md 13.3)

**Main question:** "What's coming up for my stocks and the market?"
**Primary action:** **Subscribe in my phone calendar** (all events appear in Apple/Google Calendar automatically).

## Navigation
- New bottom tab **Calendar** between Watchlist and More (4 tabs; Portfolio comes in Phase 3).
- Today gets a compact **"Coming up"** list (max 3 events in the next 7 days) with "See calendar".

## Content
1. Lead line in words: "3 events in the next 7 days · next: NVDA earnings Wed 26 Nov".
2. **Filter chips:** All · Earnings · Dividends · Central banks. Remembered on the device.
3. **Events grouped by week**, nearest first: "This week", "Next week", then "Week of 7 Dec". Max ~13 weeks ahead.
   Each row: icon + what ("NVDA reports earnings" / "ASML goes ex-dividend · € 1,88" / "Fed rate decision"),
   when ("Wed 26 Nov · after the close"), and a tag *estimated* where the date isn't confirmed. Stock rows open the ticker page.
4. **Subscribe** card at the bottom (and the primary button at the top): explains in one sentence, then a sheet with
   - **Create my calendar link** → a private link (long random secret). Buttons: **Open in Calendar** (`webcal://`), **Copy link**.
   - "Anyone with this link can see your watchlist's events. **Make a new link**" (old link stops working).

## Event sources
| Event | Source | Notes |
|---|---|---|
| Earnings date + time (before open / after close) | Finnhub (US), Yahoo (EU + fallback) | "estimated" unless the source confirms |
| Ex-dividend / payment date + amount | Yahoo | if Yahoo only has a past date: next = last + usual gap, marked *estimated* |
| Fed (FOMC) and ECB rate decisions | `config/macro_events.yaml`, copied from the official calendars | FOMC dates are tentative until the previous meeting confirms them |
CPI, jobs report and AGMs/investor days are not in v1 (no reliable free source; AGMs decided at the end of the build, Q11).

## States
| State | Shown |
|---|---|
| Loading | skeleton rows |
| Empty | "Nothing scheduled in the next 3 months." + **Add stock** |
| Filter matches nothing | "No {earnings} in the next 3 months." + **Show all** |
| Partial | rows that exist; ETFs simply have none |
| Offline / error | banners as elsewhere |

## Subscription privacy
- The link holds a random 32-byte token, stored in `calendar_tokens` (owner-only, RLS). The Edge Function `calendar-ics`
  looks the token up with the service key and returns only that owner's events. The token is never logged.
- Event titles contain tickers (that's the point); nothing else (no notes, buy levels, scores).

## Acceptance
- [ ] "When does NVDA report?" answered in ≤ 2 taps from Today.
- [ ] Subscribing takes ≤ 3 taps and works on iPhone (webcal) and Google (copy link).
- [ ] Screenshots at 375/768/1280, dark + light, empty and filtered states.

# Portfolio & Risk — `#/portfolio` (Phase 3, CLAUDE.md 13.13)

## Phase 3 stages
| Stage | Contents |
|---|---|
| **3A** (this) | Two-step login (authenticator app) · holdings from transactions (buy / sell / starting position) · cash · Portfolio page (value, P/L, allocation, risk budget gauge, warnings) · sizing engine + **Can I buy this?** · Settings → Risk |
| 3B | Live quotes function (60 s refresh) · concentration, correlation, stress test · trade markers + average-cost line on the chart |
| **3C** (built, spec: portfolio-3c.md) | Transactions list · benchmark TWR / XIRR + "what if ETF" · dividend income tracker · realised gains & tax-year report |
| **3D** (built, spec: portfolio-3d.md) | Guardrails (cooling-off, FOMO, panic-sell, trade limit) · decision log · thesis checks · pre-trade checklist · post-trade reviews |
| **3E** (built, spec: portfolio-3e.md) | Bolero importer (done earlier) · encrypted weekly backups + Export everything · Telegram commands |
| later | Optional VPS + WebSocket worker |

**Main question:** "How is my money doing, and how much risk am I taking?"
**Primary action:** **Can I buy this?** (FAB-style primary button). Secondary: *Add trade*, *Cash*.

## Access
Portfolio data is only readable after the **two-step login** (password + 6-digit code from an authenticator app).
The database enforces it (`aal2` in row-level security), not just the app. Without a second step set up, the Portfolio
tab explains why and has one button: **Set up two-step login**.

## Content (top to bottom)
1. **Summary in words:** "Portfolio € 52.340 · ▲ +0,8 % today · +€ 6.120 (+13,2 %) since you bought" and the cash line
   ("Cash € 4.200 · 8 % of your portfolio"). Values in EUR; USD holdings converted at today's rate.
2. **Warnings** (inline banners, only when relevant): position above its cap ("NVDA is 9,4 % of your portfolio, above the 8 % cap.
   Don't add more."), sector above max, satellite above target, cash below reserve.
3. **Risk budget gauge:** one bar per bucket — Core · Satellite · Speculative · Cash — current % vs target/limit, in words
   ("Satellite 22 % of max 30 %").
4. **Holdings list** (cards): ticker + name, value € and weight %, P/L € and %, day change, Bottom/Top badge + verdict,
   "max 8 % · now 6,1 %". Tap → ticker page; ⋯ → *Add trade*, *Can I buy more?*.
5. **Allocation** (stacked bars, not donuts: easier to read on a phone): by asset type, sector, region, currency.
   Each bar has a text legend with %.
6. Footer: "Calculations from your own rules, not financial advice." + prices "as of" time.

## Add trade (sheet)
Kind: **Buy · Sell · Starting position** (positions you already own, with your average price).
Fields: stock (search; adds it to the watchlist if needed), date, quantity, price + currency, fees, taxes, asset type
(prefilled: ETF/stock from Yahoo, editable: broad ETF, sector ETF, bond ETF, stock, speculative, crypto, other).
Inline validation (sell ≤ owned, quantities > 0, decimal keyboard). Save → toast "Saved · Undo".

## Cash (sheet)
Cash per currency (EUR, USD), emergency fund (excluded from everything), planned monthly contribution.

## States
| State | Shown |
|---|---|
| No two-step login | explanation + **Set up two-step login** |
| Empty | "Add what you own to see your portfolio and risk." + primary **Import from Bolero** (fastest start) and secondary **Add your first position** |
| Prices pending | new holding: "valued after tonight's update" (uses your buy price meanwhile) |
| Stale / offline / error | banners as elsewhere |

## Acceptance
- [ ] "How much is my portfolio worth today?" answered at the top in ≤ 1 tap from anywhere.
- [ ] Every warning names the rule and what to do.
- [ ] Screenshots 375/768/1280, dark + light: empty, normal, warnings, MFA missing.

## 3B additions (CLAUDE.md 13.11, 13.13.3, 13.17)
- **Live prices**: while the Portfolio page is open and a market is open, prices refresh every 60 s through the
  `quotes` Edge Function (login required; Yahoo; EU "delayed 15 min"). The summary says "live · 14:32" or
  "closing prices". Values in the holdings list update in place (no jumping).
- **Risk card** (below the risk budget):
  - **Moves together** — "NVDA, ORCA and AMD move together (correlation above 0,8): a bad day hits all three."
    From 1 year of daily returns (daily job). "Can I buy this?" applies the × 0,7 rule when a candidate is that correlated.
  - **Stress test** — what your current holdings would have lost in 2008 (Oct 2007 → Mar 2009), the Covid crash
    (19 Feb → 23 Mar 2020) and 2022 (3 Jan → 12 Oct): "2008: −€ 18.400 (−39 %)". Holdings without that history use a
    proxy (S&P 500 for stocks and ETFs, an aggregate bond ETF for bonds) and say so. Cash counts as 0 %.
  - **Concentration**: largest position, top 3 share, and the warnings that already exist (caps, sector, satellite).
- **Chart**: your buys (●green) and sells (●red) as markers, and a dotted **average cost** line, on the ticker chart
  when you own the stock (only after the two-step login).

# Bolero import — `#/import` (Phase 3E, pulled forward; format in docs/importers/bolero.md)
**Main question:** "Get my Bolero positions into the app without typing them."
1. **Choose file** (the position overview .xlsx). It's read **in the browser**; the file is never uploaded or stored.
2. **Preview**: one row per position — Bolero name, **ticker** (suggested; editable; alternatives in a list), quantity,
   average price + currency, asset type, include ☑. Cash row → cash in EUR. Rows that couldn't be matched are marked
   "check the ticker" and are not included until a ticker is filled in.
   Matching: ISIN if present; otherwise Bolero's name in simpler forms (abbreviations spelled out, fewer words) on Bolero's
   market; if the fund is only found on another exchange, its Yahoo name is searched again to find the right listing.
   Every suggestion is checked for prices on Yahoo and shows Yahoo's name · exchange · currency, with a warning when
   the names or currencies differ. A ticker typed by hand is checked for prices too (no prices → row left out).
   The lookup sends only ISIN / name / market to the `lookup-symbols` function (no amounts).
3. **Import**: starting positions dated today (source = import), missing tickers added to the watchlist, cash set.
   If you imported before: "Replace my previous import" (default on) removes the earlier imported positions first,
   so nothing is counted twice. Manual trades are never touched.
4. Done → Portfolio, toast "12 positions imported".
States: wrong file ("This isn't a Bolero position overview"), empty file, lookup failed (still editable by hand).

# Portfolio & Risk — `#/portfolio` (Phase 3, CLAUDE.md 13.13)

## Phase 3 stages
| Stage | Contents |
|---|---|
| **3A** (this) | Two-step login (authenticator app) · holdings from transactions (buy / sell / starting position) · cash · Portfolio page (value, P/L, allocation, risk budget gauge, warnings) · sizing engine + **Can I buy this?** · Settings → Risk |
| 3B | Live quotes function (60 s refresh) · concentration, correlation, stress test · trade markers + average-cost line on the chart |
| 3C | Transactions list · benchmark TWR / XIRR + "what if ETF" · dividend income tracker · realised gains & tax-year report |
| 3D | Guardrails (cooling-off, FOMO, panic-sell, trade limit) · decision log · thesis checks · pre-trade checklist · post-trade reviews |
| 3E | Bolero importer (needs an anonymised sample export from the owner) · encrypted weekly backups · Telegram commands |
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
| Empty | "Add what you own to see your portfolio and risk." + **Add your first position** / **Set cash** |
| Prices pending | new holding: "valued after tonight's update" (uses your buy price meanwhile) |
| Stale / offline / error | banners as elsewhere |

## Acceptance
- [ ] "How much is my portfolio worth today?" answered at the top in ≤ 1 tap from anywhere.
- [ ] Every warning names the rule and what to do.
- [ ] Screenshots 375/768/1280, dark + light: empty, normal, warnings, MFA missing.

# Portfolio 3C — returns, dividends, transactions, tax (CLAUDE.md 13.14 B, 13.15 A + C)

All four live under the Portfolio tab (depth: tab → detail → sheet). Same access rule as the Portfolio page:
two-step login (aal2), data in memory only. The Portfolio page gets two summary cards and a row of links:

```
[ Returns vs MSCI World ]   Since 22 Nov 2026: ▲ +3,1 %  ·  MSCI World ▲ +2,4 %   ›
[ Dividend income ]         Next 12 months ≈ € 412 after tax · next: ORCA 14 Dec  ›
Transactions ›   Tax overview ›
```

## Returns — `#/portfolio/returns`
**Main question:** "Am I doing better than just buying the world ETF?"
**Primary action:** none needed (read screen); period chips.

1. **Answer first:** "Since 22 Nov 2026 your investments returned ▲ +3,1 %. MSCI World (IWDA.AS, EUR) ▲ +2,4 %.
   You're ahead by 0,7 points." (or "behind").
2. Period chips: **YTD · 1Y · 3Y · Since start** — a period that starts before your first trade is disabled with the reason.
3. **Chart**: your return line vs MSCI World, both indexed to 100 at the start (time-weighted, so deposits don't
   move the line). Text summary below for screen readers.
4. **"What if you'd bought the ETF?"** — same money in on the same days, into IWDA.AS:
   "You'd have € 51.900 instead of € 52.340: you're € 440 ahead." Plus "Your money-weighted return (XIRR): 7,2 % a year
   · the ETF: 6,8 % a year."
5. **By part:** core · satellite · speculative, return since start each — shows whether stock picking adds value.
6. Notes: cash isn't counted (only what you invested); dividends you log count as money out; computed in tonight's
   update from your transactions.

States: no trades → empty state with *Add trade*; first trade today → "Your comparison starts on 22 Nov 2026 and is
calculated tonight."; < 20 trading days → info banner "Early days: give it a few weeks before you read anything into it."

## Dividend income — `#/portfolio/dividends`
**Main question:** "How much dividend will I get, and when?"
**Primary action:** **Log a dividend** (when one is paid).

1. **Answer first:** "Next 12 months ≈ € 412 after tax (€ 680 before tax)."
2. **By month:** bar per month (next 12), each with the amount in text; estimated from the last 12 months of
   payments per holding (pay date ≈ ex-date + 3 weeks when unknown).
3. **Per holding:** dividend per share (last 12 months), times a year, yield now, **yield on cost** (on your average
   price), next ex-date, yearly € after tax. Warning when the payout ratio is above 80 %.
4. **Received this year:** total and list of logged dividends (kind *Dividend* in Add trade).
5. Footer: taxes are estimates from `config/costs.yaml` (Belgian 30 % withholding after foreign withholding by
   listing country) — **verify them**; accumulating ETFs pay none.

States: no dividend payers → "None of your holdings pays a dividend (accumulating ETFs reinvest it)."

## Transactions — `#/portfolio/transactions`
**Main question:** "What did I do, and when?" **Primary action:** **Add trade**.
List grouped by month, newest first: kind (Buy / Sell / Starting position / Dividend, word + icon), ticker, quantity ×
price, total in its currency, fees + taxes. Filter chips: All · Buys · Sells · Dividends · Starting. Each row has
**Delete** (toast with Undo). Imported rows say "from Bolero import".

## Tax overview — `#/portfolio/tax`
**Main question:** "What do I need for my tax return?"
Year chips (years with transactions). Tiles: realised gains, realised losses, net; dividends gross, withholding,
net; TOB paid; broker fees. Table of sales: date, ticker, quantity, proceeds, cost (FIFO), gain — all in EUR.
Starting positions count as bought on the import date at your average price ("bought before {date}").
**Export CSV** and **Print**. Disclaimer: "For your own administration. Rates and rules from config/costs.yaml —
verify with an advisor." No tax amount is calculated.

## Data
- `transactions.kind` gains `dividend` (quantity = shares, price = gross dividend per share, taxes = withholding).
- `portfolio_perf` (written by the daily job, readable only by the owner at aal2): series, periods, XIRR, what-if,
  by part. Computed in `src/performance.py` from transactions + daily prices + EUR rates.
- `latest_scores.dividends`: per ticker dividend history summary (last 12 months, frequency, yield, payout).

## Acceptance
- [ ] "Am I beating the ETF?" answered at the top of Returns in words.
- [ ] Every number has a unit; every metric (TWR, XIRR, what-if, yield on cost) has a glossary ⓘ.
- [ ] Screenshots 375/768/1280 dark + light; empty and early-days states.

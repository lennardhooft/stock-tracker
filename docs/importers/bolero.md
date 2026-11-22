# Bolero export formats (for the importer, Phase 3E) — format only, never real data

Learned from the owner's export on 2026-11-22. The file itself is **not** in the repo and never will be
(privacy rules 2.1 / 13.12). Test fixtures must be FAKE rows in this exact layout.

## Position overview (Portefeuille → Posities → Excel icon) — "positions-only mode"
- File: `portfolio_<YYYY>_<MM>_<DD>T<hh>_<mm>_<ss>.<ms>.xlsx`, one sheet `Sheet0`.
- Rows 0–4 empty, row 5 col B = title `Portfolio Positions`, row 8 = header, row 9 empty, data from row 10.
- Every other column is an empty spacer: the real columns are at **odd indexes 1, 3, 5, … 33** (0-based).
- Header (Dutch, exact text; note the trailing space in `Aantal `):

| idx | header | meaning | keep? |
|---|---|---|---|
| 1 | `Type` | `Aandelen` (stocks) · `ETF's` · `Cash` (one row, no name) | yes → asset type hint, cash row |
| 3 | `Munt` | trading currency (EUR, USD, CAD, …) | yes |
| 5 | `Aantal ` | quantity (number) | yes |
| 7 | `Geblokkeerd` | blocked quantity | no |
| 9 | `Naam` | Bolero's abbreviated name (shortened words, e.g. `EXAMPL.II PLC GLOB.IDX ETF-ACC`, made up) | only to help match |
| 11 | `Alerts` | Ja/Nee | no |
| 13 | `Gem. aankoopkoers` | average purchase price (in `Munt`) | yes → starting position price |
| 15 | `Slotkoers` | previous close | no |
| 17 | `Totale aankoopwaarde` | total cost (in `Munt`) | check only |
| 19 | `Koers` | current price | no |
| 21 | `Wijziging (%)` / 23 `Wijziging` | day change | no |
| 25 | `Huidige waarde` | value in `Munt` | no |
| 27 | `Waarde in EUR` | value in EUR (for the Cash row: the cash amount) | cash only |
| 29 | `Rendement %` / 33 `Rendement ( in munt)` | return | no |
| 31 | `Markt` | exchange: `USA`, `Toronto`, `Frankfurt (Xetra)`, `Euronext Amsterdam`, `Euronext Paris`, … | yes → Yahoo suffix |

- Numbers are real Excel numbers (not text), so no decimal-comma parsing is needed for this file.
- **No ISIN and no ticker** in the default export → names can't be matched reliably (ETFs trade on several
  exchanges). The owner will re-export with the **ISIN** column switched on; the importer must find it by header,
  not by position. Market → Yahoo suffix: `USA` → none, `Toronto` → `.TO`, `Frankfurt (Xetra)` → `.DE`,
  `Euronext Amsterdam` → `.AS`, `Euronext Paris` → `.PA`, `Euronext Brussel(s)` → `.BR`.
- Privacy: no name/address/account number in this file. The importer keeps only: ISIN/ticker, quantity,
  average price, currency, type, cash; parses in the browser; shows a preview before saving.

# Quality Score, verdict and Top Score — Phase 2E (CLAUDE.md 13.1, 13.14 A, 13.16 A)

**Main question:** "Is this a good business that's cheap for now, or is it cheap because it's failing?"
And the mirror: "Is this stock getting hot, so I shouldn't add more?"

## Where it shows

### Ticker detail — score card (top of the page, no tap needed)
- Bottom Score badge **+ verdict badge** on the same line.
- One sentence that leads with the verdict, then the reason:
  - 🟢 "Quality on sale: 4 of 6 bottom signals and a quality score of 82 / 100."
  - 🟡 "Check fundamentals: strong bottom signals, but quality is only 55 / 100."
  - 🔴 "Possible value trap: cheap, but quality is weak (31 / 100): shrinking sales and high debt."
    (names the two weakest quality parts)
  - ⚪ "Not at a bottom" → the existing score sentence stays (no extra text: calm).
  - Quality unknown (ETF or no statements) + high Bottom Score → 🟡 "Check fundamentals: no quality data for this stock."
- **Top Score badge** (violet ▲, distinct from the Bottom Score) only when it's 2 or higher ("getting hot" / "consider trimming").
  At 0–1 it is not shown on the card, so a calm stock stays calm.

### Ticker detail — Overview tab
- New card **"Getting hot? (Top Score)"** under the Bottom Score signals: the U1–U6 signal rows (✅/❌/n/a, value vs threshold, ⓘ).
  Lead line in words: "No signs of overheating." / "2 of 6 overheating signs: far above its 4-year average and RSI overbought."
  Never "sell": the wording is "consider trimming" at most, and alerts only come for holdings (Phase 3).

### Ticker detail — Fundamentals tab (Quality first, then valuation, then insiders)
- **Quality card** at the top:
  - Stat tile: "Quality 82 / 100 · High" (word + colour), context "based on 4 years of annual reports".
  - **Moat** tile: "Wide / Narrow / None" with "ROIC 28 % on average, above the 8,5 % cost of capital in 4 of 4 years".
  - One row per part (icon ✅ good / ⚠️ weak / – n/a, plain name, value in words, ⓘ):
    Piotroski F-score · Bankruptcy risk (Altman Z) · Debt · Free cash flow · Sales growth · Margins · Dilution · Return on capital (ROIC).
    Debt and ROIC are marked "counts 1.5×".
  - **ROIC & gross margin by year**: a small table (year · ROIC · gross margin), newest first. Up to 10 years when available.
  - n/a states with reasons: "ETFs hold many companies, so there's no single quality score." / "Not meaningful for banks and insurers"
    (Altman, debt and ROIC are left out; the score uses the rest) / "Not enough annual reports (need 2)."

### Watchlist and Today
- Stock card: verdict badge only for 🟢/🟡/🔴 (high Bottom Score), Top badge only at ≥ 2. Nothing extra on normal stocks.
- Watchlist filter sheet: **Verdict** chips (All · Quality on sale · Check fundamentals · Possible value trap).
- Today "Needs your attention" card for a strong bottom says the verdict in its first line
  ("Quality on sale" / "Possible value trap: check before researching further").

## Rules
- Quality = weighted average of the available parts (0–100). Debt and ROIC weigh 1.5× (owner decision), the rest 1×.
  Needs at least 4 parts, else "n/a". High ≥ 70 · Medium 40–70 · Low < 40.
- Verdict (13.1): Bottom ≥ 4 and Quality ≥ 70 → sale; 40–70 → check; < 40 → trap; Bottom < 4 → none.
- Data: Yahoo annual statements (4–5 years, US and EU), cached by the daily run (changes quarterly).
- Every part shows its source year and the numbers behind it. No unexplained numbers.

## States
| State | Shown |
|---|---|
| Loading | skeleton tiles in the Quality card |
| ETF | "n/a" card with the ETF reason, no verdict badge |
| Financials (bank/insurer) | score from the parts that apply + note |
| Partial | parts with "n/a + reason"; score shows "based on 6 of 8 parts" |
| Not enough reports | card says so, verdict falls back to 🟡 when the Bottom Score is high |

## Acceptance
- [ ] At 375 px the verdict + sentence are visible without scrolling on the ticker page.
- [ ] Every quality part and Top signal has a glossary ⓘ.
- [ ] Bottom and Top badges are never confused (different hue family + ▼/▲ icon + word).
- [ ] Screenshots at 375/768/1280, dark + light, for sale / check / trap / none / ETF.

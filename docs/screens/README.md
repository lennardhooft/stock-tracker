# Screen specs (CLAUDE.md 8.3)

One spec per screen, written **before** the screen is coded and updated when it changes.
Each spec covers: purpose, the main question, the primary action, content hierarchy,
states (8.6) and acceptance criteria. A screen is done when it passes the checklist in 8.12.

| Screen | Route | Phase | Spec |
|---|---|---|---|
| App shell | all | 1 | [shell.md](shell.md) |
| Today | `#/` | 1 | [today.md](today.md) |
| Watchlist | `#/watchlist` | 1 | [watchlist.md](watchlist.md) |
| Ticker detail | `#/ticker/NVDA` | 1 | [ticker.md](ticker.md) |
| Settings (basic) | `#/more/settings` | 1 | [settings.md](settings.md) |
| Onboarding | `#/welcome` | 1 | [onboarding.md](onboarding.md) |

**What Phase 1 data can show:** Bottom Score (T1, T2, T3, S1), price, day change, distance from
the 52-week high, 52-week high/low, weekly closes + 200-week MA, market strip (S&P 500, Nasdaq,
VIX, Fear & Greed), job health. Not yet available: Top Score, Quality Score/verdict, news,
earnings, valuation, portfolio. Screens hide those parts instead of showing empty placeholders.

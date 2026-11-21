# CLAUDE.md — Stock Bottom Tracker

> Project plan and working instructions for Claude Code.
> Status: **PLAN COMPLETE (frozen). All questions answered. Next step: Phase 0 setup, then Phase 1.**
> All owner questions are answered (see section 16). Remaining choices are made by the owner in the app's Settings.

---

## 1. What this app is

A personal, low-cost (ideally €0) web app that tracks a watchlist of stocks for **long-term investing**.
Its main job is to flag when a stock **may be near a bottom** by combining several technical,
valuation and sentiment signals into one **Bottom Score**. It also sends **intraday alerts**
(big drops, volume spikes, breaking news) and shows **live charts**.

It runs in the background in the cloud, so the owner's computer does not need to be on, and it is viewable on a phone.

**It is not:**
- an auto-trading bot. It never places orders.
- financial advice. Signals mark things worth researching, not buy calls.
- a high-frequency or day-trading tool.

### Core principles
1. **Simple first.** Get a working v1 with a minimal stack, then add features.
2. **Free first.** Use free tiers and free hosting. Paid services are optional upgrades only.
3. **Transparent scoring.** Every score shows *which* signals fired and why. No black box.
4. **Resilient.** If one data source fails, the rest still works and the failure is logged.
5. **Mobile-first UI.** The owner checks this mainly on a phone.

---

## 2. Owner settings (decided)

| Setting | Value |
|---|---|
| Watchlist tickers | Owner adds them in the app (Supabase `watchlist` table). For first testing, Claude Code may use a few well-known examples (e.g. `AAPL`, `MSFT`, `ASML.AS`, `IWDA.AS`), which the owner replaces later. |
| Markets | ✅ **US and EU** (Euronext Brussels/Amsterdam/Paris, Xetra, etc.). Handle Yahoo suffixes, EUR/USD and delayed EU data. |
| Owner timezone | Europe/Brussels |
| Alert channel | ✅ **Telegram** |
| Intraday drop alert threshold | ✅ **−5%** on the day |
| Bottom Score alert threshold | ✅ **≥ 4** |
| Quiet hours | ✅ **None.** Notifications are allowed at any time (quiet-hours feature stays in code but is disabled). |
| Signal weights | ✅ **Default:** all Bottom Score signals equal weight |
| Quality Score weights | ✅ **Default:** equal weights, with **debt and ROIC slightly heavier** (e.g. 1.5×) |
| Support/resistance | ✅ **Multi-timeframe "real" levels** from daily, weekly, monthly and yearly charts (see 6.5) |
| Portfolio | ✅ **Full portfolio tracking** (Portfolio & Risk page, 13.13) |
| Risk profile | ✅ **Balanced** (1.5% max loss per position). Split, caps and limits are **set by the owner in the app** (13.13.4b) |
| Broker | ✅ **Bolero** |
| Benchmark | ✅ **MSCI World in EUR** (e.g. `IWDA.AS`) |
| Guardrails | ✅ All on, max 4 trades/month |
| Backups | ✅ Encrypted, to a separate private GitHub repo |
| AI features | ✅ Built **last** (Phase 5) |
| Starting scope | ✅ **Phase 1 only** to start. Then use it before moving on. |
| Hosting tier | Phase 1 = free (GitHub). Phase 3 = optional VPS (~€4/mo) |
| Repo visibility | ✅ **PUBLIC repo with code only** (free unlimited Actions minutes). Nothing personal ever goes into the repo. All personal and generated data is in Supabase behind login (see 2.1 Privacy rules). Frontend hosted on Cloudflare Pages, data loaded only after login. |


### 2.1 Privacy rules (public repo), HARD RULES for Claude Code
The repo is **public** (free unlimited GitHub Actions minutes, easy sharing of code). The owner's information must stay private. So:
1. **The repo contains code, example configs, docs and tests only.** Never commit: watchlist, buy levels, notes, holdings, transactions, cash, journal, alerts log, Telegram chat ID, generated score data for the owner's tickers, or backups.
2. **All personal and generated data lives in Supabase** behind login + row-level security (only the owner's user ID can read/write). Jobs use the Supabase **service key** stored in **GitHub Secrets**.
3. **All keys and IDs in GitHub Secrets** (`FINNHUB_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ANTHROPIC_API_KEY`, …). Never in code, never in example files.
4. **GitHub Actions logs are public on a public repo.** Scripts must **not print** tickers, prices of holdings, portfolio values, alerts content or any personal data. Only print counts and statuses (e.g. "scored 14 tickers, 0 errors"). Use `::add-mask::` for any value that might leak.
5. **The frontend is behind login:** Supabase auth (email magic link), plus optionally **Cloudflare Access** in front of the site. The site's code can be public; the data it loads is not.
6. **Safety nets:** a `.gitignore` covering `.env`, `*.local.*`, `data/`, `backups/`, `seed/`; **gitleaks** secret scanning as a pre-commit hook and in CI; GitHub secret scanning + push protection turned on.
7. Telegram bot only answers the owner's chat ID.
8. If anything personal is ever committed by mistake: rotate the affected keys immediately and purge it from git history. Deleting the file in a new commit is not enough.

---

## 3. Architecture overview

```
                 ┌──────────────────────────────────────────┐
                 │            DATA SOURCES (free)           │
                 │ yfinance · Finnhub · FRED · CNN F&G      │
                 └───────────────┬──────────────────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        │                        │                         │
┌───────▼────────┐     ┌─────────▼─────────┐     ┌─────────▼─────────┐
│ DAILY JOB      │     │ INTRADAY JOB      │     │ (Phase 3)         │
│ after US close │     │ every 15 min      │     │ REAL-TIME WORKER  │
│ - fetch daily/ │     │ during market hrs │     │ Finnhub WebSocket │
│   weekly data  │     │ - % move          │     │ on VPS (systemd)  │
│ - fundamentals │     │ - volume spike    │     │ - instant alerts  │
│ - compute score│     │ - news            │     └─────────┬─────────┘
└───────┬────────┘     └─────────┬─────────┘               │
        │                        │                         │
        └────────────┬───────────┴─────────────────────────┘
                     │
            ┌────────▼─────────┐        ┌──────────────────┐
            │ Supabase tables  │───────►│ ALERTS           │
            │ (Supabase,       │        │ Telegram / ntfy  │
            │  private, login) │        └──────────────────┘
            └────────┬─────────┘
                     │
            ┌────────▼─────────────────────────────┐
            │ FRONTEND (static, Cloudflare Pages)  │
            │ index.html + JS, reads JSON          │
            │ TradingView widgets for live charts  │
            └──────────────────────────────────────┘
```

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | Python 3.12 | Best ecosystem for finance data |
| Data libs | `yfinance`, `pandas`, `numpy`, `pandas-ta` (or hand-written indicators) | Free, well known |
| HTTP | `requests` / `httpx` | Finnhub REST, alerts |
| Config | Non-personal settings in `config/*.yaml` (thresholds). **Personal settings** (watchlist, buy levels, notes, risk profile) are stored in Supabase and edited in the app | Public repo stays clean |
| Scheduler (Phase 1–2) | GitHub Actions cron | Free, no server |
| Scheduler (Phase 3) | `systemd` service + timer on a VPS | Always-on, real-time |
| Storage (all phases) | **Supabase free tier** (Postgres + login + row-level security). Jobs write results there with a service key from GitHub Secrets. **No data committed to the repo.** | Public repo, private data |
| Frontend | Plain HTML + vanilla JS + small CSS (no build step) | Simple, fast, hostable anywhere |
| Charts | TradingView embed widgets (live) + Lightweight Charts lib (custom overlays) | Free, professional |
| Hosting | **Cloudflare Pages** (or Vercel), since the repo is private | Free |
| Alerts | Telegram Bot API (recommended) or ntfy.sh | Free push to phone |
| Tests | `pytest` | Indicator correctness |
| Lint/format | `ruff` | One tool |

---

## 5. Data sources

> Free-tier limits change, so **check the current limits before relying on them**.

| Source | Used for | Key needed | Notes |
|---|---|---|---|
| **yfinance** (Yahoo, unofficial) | Daily/weekly/intraday OHLCV, P/E, P/S, market cap, `^VIX`, `^GSPC` | No | Unofficial and can break or rate-limit. Wrap every call in retries. Intraday 1m data covers only about 7 days, 5m about 60 days. |
| **Finnhub** | Company news, insider transactions, earnings calendar, analyst recommendations, real-time WebSocket (US) | Yes (free) | Free tier is roughly 60 calls/min. Real-time WebSocket for US stocks. |
| **Financial Modeling Prep** (optional) | Historical P/E, P/S, FCF, ratios over 10 years | Yes (free tier) | Better for "valuation vs own history" than yfinance. |
| **CNN Fear & Greed** | Market sentiment 0–100 | No | Unofficial JSON endpoint and may break. Treat as optional. |
| **FRED** (St. Louis Fed) | Macro: yields, 10y–2y spread, high-yield credit spreads | Yes (free) | Optional, Phase 4 |
| **SEC EDGAR** | Form 4 insider filings (US) | No (needs User-Agent header) | Fallback/alternative to Finnhub insider data |

### Data rules
- Cache raw market downloads with `actions/cache` or in Supabase storage, **never committed**, to avoid re-fetching history daily.
- Fetch long history (10+ years weekly) once, then append new bars daily.
- Every fetch function returns `None` on failure and logs the error. **Never crash the whole run because one ticker failed.**
- Store all timestamps in **UTC**. Convert to Europe/Brussels only in the UI.
- EU tickers use Yahoo suffixes (`.AS` Amsterdam, `.BR` Brussels, `.PA` Paris, `.DE` Xetra). EU data on free feeds is often delayed by about 15 minutes.

---

## 6. The Bottom Score (core feature)

Each signal is **1 point if true, 0 if false**. Score = sum. Default max = 6 (configurable).
Every signal stores its raw value, so the UI can show *why*, e.g. "RSI(w) = 27.4 < 30 ✅".

### 6.1 Price / technical signals
| # | Signal | Default rule | Data |
|---|---|---|---|
| T1 | **Near 200-week moving average** | Close ≤ 200-week SMA × 1.05 | Weekly closes, ≥ 200 weeks history |
| T2 | **Weekly RSI oversold** | RSI(14) on weekly closes < 30 | Weekly closes |
| T3 | **Deep drawdown** | Close ≤ 52-week high × 0.70 (≥ 30% off) | Daily closes |

### 6.2 Valuation signals
| # | Signal | Default rule | Data |
|---|---|---|---|
| V1 | **Cheap vs own history** | Current P/E (or P/S if earnings < 0) in bottom 20th percentile of its own 5–10y range | FMP / yfinance |
| V2 | **Insider buying** | Net insider *open-market purchases* > 0 in last 90 days (ignore option exercises/grants) | Finnhub / EDGAR |

### 6.3 Market sentiment signal
| # | Signal | Default rule | Data |
|---|---|---|---|
| S1 | **Market fear** | VIX ≥ 30 **or** Fear & Greed ≤ 25 | yfinance `^VIX`, CNN |

### 6.4 Extra signals (optional, off by default)
- **T4 Near a major previous bottom** (see 6.5), Phase 2.
- **Capitulation volume:** weekly volume ≥ 2× its 52-week average while price is down.
- **Bullish weekly RSI divergence:** price makes a lower low, RSI makes a higher low.
- **Price below lower Bollinger Band (weekly, 20, 2σ).**
- **Analyst sentiment shift:** net upgrades in last 30 days.
- **Short interest high and falling.**
- **Market breadth:** % of S&P 500 stocks above their 200-day MA < 20%.
- **Macro:** high-yield credit spreads spiking (stress = often near market bottoms).

### 6.5 Automatic previous bottoms & ceilings (support / resistance)

Detect past swing lows (bottoms) and swing highs (ceilings) automatically and draw them on the chart.

**Owner decision: multi-timeframe "real" levels.** Levels are detected separately on **daily, weekly, monthly and yearly** bars, so the chart shows the supports that matter on each horizon:
| Timeframe | Swing window | Min move (ZigZag) | Label | Strength weight |
|---|---|---|---|---|
| Yearly | 2 bars each side | 30% | **Y** (multi-year bottom/ceiling) | 4 |
| Monthly | 3 bars each side | 20% | **M** | 3 |
| Weekly | 8 bars each side | 12% | **W** | 2 |
| Daily | 10 bars each side | 6% | **D** (only shown on zoom ≤ 1Y) | 1 |
- Zones from different timeframes that overlap (±3%) merge. Strength = sum of timeframe weights × touches. A level that shows up on yearly + monthly + weekly charts is the strongest.
- The chart shows each zone's label (e.g. "Y·M·W, 4 touches, last 2024"), with line thickness by strength.
- The levels shown adapt to the zoom: Max/10Y shows Y+M levels, 1–5Y shows M+W, and below 1Y shows W+D.
- The "near major previous bottom" signal (T4) and support alerts use only **monthly or yearly** levels by default.

**Detection (`src/levels.py`)**
1. **Swing points:** on weekly bars, a bar is a *swing low* if its low is the lowest of the N bars on each side (default N = 8 weeks). Swing highs work the same way. Alternative: a **ZigZag** filter that only counts reversals ≥ X% (default 15%), which removes noise. `scipy.signal.find_peaks` with a `prominence` setting is another option.
2. **Major vs minor:** a level is *major* if the move away from it was ≥ 25%. Only major levels are shown by default, with a toggle for minor ones.
3. **Cluster into zones:** swing points within ±3% of each other are merged into one **zone**. More touches = stronger level. Store per zone: price range, number of touches, first/last touch date, and whether it is currently support (below price) or resistance (above price).
4. **Role flip:** an old ceiling that price has broken above becomes potential support, and an old bottom that broke becomes potential resistance. Mark these as flipped.
5. **Keep it readable:** show at most the ~3 nearest zones below price and ~3 above.

**Extra signal (T4, optional):** *Near a major previous bottom.* Price is within 5% of a major support zone with ≥ 2 touches.

**Alerts:** "NVDA is testing support zone $105–110 (3 previous bottoms: 2022, 2023, 2024)" and "broke below support". Both are de-duplicated like other alerts.

**Chart display:** the TradingView embed widget does **not** allow drawing our own lines on it. So the ticker page uses **TradingView Lightweight Charts** (free library) for the "levels" chart: price candles plus horizontal shaded zones (green = support, red = resistance), line thickness by number of touches, and ▲/▼ markers on each detected swing point with date and price on hover. The live TradingView widget stays available as a second tab.

**Also useful on the same chart:**
- All-time high / 52-week high & low lines.
- Previous **drawdown table**: each past major bottom with date, % drop from the prior high, how long it took to recover, and the Bottom Score at that time (links to the backtest view).
- Fibonacci retracement levels (38.2 / 50 / 61.8%) of the last major swing (optional toggle).

**Tests:** detection must be unit-tested on synthetic price series with known peaks and troughs.

### 6.6 Score interpretation (shown in UI)
| Score | Label | Colour |
|---|---|---|
| 0–1 | Normal | grey |
| 2–3 | Watch | yellow |
| 4–5 | Strong bottom signals, research it | orange |
| 6 | Extreme | red |

### 6.7 Implementation notes
- Indicators live in `src/indicators.py` as **pure functions** (input: pandas Series → output: Series/float). They must be unit-tested against known values.
- RSI uses **Wilder's smoothing** (standard). Document this.
- Weekly bars: resample daily to weekly with week ending Friday (`W-FRI`).
- If data is missing for a signal, mark it `null` (not 0) and show "n/a". The score shows e.g. `3/5 (1 n/a)`.
- Thresholds and weights live in `config/scoring.yaml`, **not hard-coded**.

---

## 7. Intraday monitoring

### 7.1 Alerts (Phase 2, every 15 min during market hours)
| Alert | Default rule |
|---|---|
| Big daily drop | Price ≤ previous close × (1 − 0.05) |
| Big daily rise (optional) | ≥ +5% |
| Volume spike | Volume so far today ≥ 2× average volume for the same time of day (or ≥ 3× 20-day average for the full day, simpler) |
| Price target hit | Price ≤ owner's personal buy level from the Supabase `watchlist` table |
| Breaking news | New Finnhub news item for a watchlist ticker since last run |
| Earnings soon | Earnings date within 7 days (sent once, in the daily job) |
| Score change | Bottom Score crosses ≥ threshold (daily job) |

### 7.2 Alert rules
- **De-duplicate:** each alert type fires at most **once per ticker per day**. Keep state in the Supabase `alert_state` table.
- **Quiet hours** (configurable): e.g. no pushes 23:00–07:00 Brussels, except "Extreme" scores.
- Every alert message contains: ticker, what happened, key numbers, and a link to the app page for that ticker.
- Example Telegram message:
  ```
  🔻 NVDA −6.2% today ($118.40)
  Volume 2.8× normal
  Bottom Score: 3/6 (Watch)
  ▶ https://<your-app>.pages.dev/#NVDA
  ```

### 7.3 Market hours
- US regular session: 09:30–16:00 New York time = **15:30–22:00 Brussels** (most of the year; for about 1–3 weeks in March and Oct/Nov the EU and US DST changes are out of sync, so the gap is 1 hour less).
- GitHub cron runs in **UTC** and does not know about DST, so schedule a wide window (`*/15 13-21 * * 1-5`) and have the script itself check "is the market open now?" using `zoneinfo("America/New_York")`, exiting early if not.
- Skip US market holidays (hard-coded list for the year, or the `pandas_market_calendars` package).

---

## 8. Frontend (the app)

Single static site, mobile-first, dark mode by default. **Login required** (Supabase auth + MFA, optionally Cloudflare Access), see 2.1 and 13.13.2. The site code is public; the data only loads after login.

### 8.1 Pages / views
1. **Dashboard (home)**
   - Market strip at top: S&P 500 % today, Nasdaq, VIX, Fear & Greed, last update time.
   - Watchlist table/cards sorted by Bottom Score (highest first):
     ticker · name · price · % today · % from 52w high · Bottom Score badge · mini sparkline.
   - Filter: "Score ≥ X", search box.
2. **Ticker detail** (`#TICKER`)
   - **Live TradingView Advanced Chart widget** (weekly by default, user can switch).
   - Signal checklist: each signal with ✅/❌/n/a, raw value and threshold.
   - Score history chart (score over time, from stored daily snapshots).
   - Custom chart (Lightweight Charts) with weekly price + 200-week MA + markers on the dates when the score was ≥ 4. This is useful for backtesting by eye.
   - Key stats: P/E now vs 5y/10y range (a small range bar), market cap, dividend yield.
   - Latest 10 news headlines (from Finnhub), with source and time.
   - Insider transactions (last 6 months).
   - Next earnings date.
   - Owner's notes + personal buy level (from the Supabase `watchlist` table).
3. **Alerts log:** list of all alerts sent, newest first.
4. **Settings/help:** explains each signal in plain language, plus the disclaimer.

### 8.2 Frontend rules
- No framework and no build step for v1: `index.html`, `app.js`, `style.css`.
- After login, loads the summary and per-ticker detail from **Supabase** (tables/views `latest_scores`, `ticker_detail`) using the Supabase JS client. Row-level security means only the owner's account can read them.
- Show a clear "data is X hours old" warning if the latest scores in Supabase are older than 26 hours on a weekday.
- Must look good at 375px width.
- Optional: make it a **PWA** (manifest + icon) so it can be added to the phone home screen.

---

## 9. Repository structure

```
stock-tracker/
├── CLAUDE.md                  # this file
├── README.md                  # setup instructions for humans
├── requirements.txt
├── config/
│   ├── watchlist.example.yaml # EXAMPLE only. The real watchlist lives in Supabase
│   ├── scoring.yaml           # signal thresholds, enabled flags
│   ├── alerts.yaml            # thresholds, quiet hours, channel
│   ├── risk.yaml              # risk profiles, type caps, multipliers
│   ├── guardrails.yaml        # cooling-off, FOMO, trade limits
│   ├── goals.yaml             # return/volatility assumptions, goals
│   ├── targets.yaml           # sector/region/factor target weights
│   ├── universe.yaml          # scan universe + curated ETF list
│   └── costs.yaml             # TOB / fees / taxes (owner-verified rates)
├── backend/                   # Supabase schema + Edge Functions (or Cloudflare Worker)
│   ├── schema.sql             # holdings, transactions, journal (row-level security)
│   └── functions/             # quotes proxy, ask-claude
├── src/
│   ├── fetch.py               # all data-source wrappers (with retries)
│   ├── indicators.py          # pure indicator functions (SMA, RSI, drawdown, percentile…)
│   ├── levels.py              # swing highs/lows, support/resistance zones
│   ├── quality.py             # Quality Score (Piotroski, Altman Z, debt, FCF…)
│   ├── events.py              # earnings/dividend/macro calendar + .ics export
│   ├── ai_summary.py          # optional Claude API news summaries
│   ├── market_regime.py       # breadth, yield curve, regime label
│   ├── top_score.py           # trim / euphoria signals
│   ├── thesis.py              # automatic thesis-rule checks
│   ├── data_checks.py         # sanity checks, split detection, health status
│   ├── performance.py         # TWR, XIRR, benchmark "what if ETF"
│   ├── dividends.py           # income forecast, yield on cost
│   ├── goals.py               # Monte Carlo goal planner
│   ├── tax_report.py          # realised gains, yearly tax export
│   ├── yearly_review.py       # January review report
│   ├── gaps.py                # portfolio gap finder + opportunity ranking
│   ├── moat.py                # ROIC, moat sub-score
│   ├── telegram_bot.py        # command handlers (deployed as webhook)
│   ├── smart_money.py         # buybacks, 13F, revisions, targets, short interest
│   ├── options_sentiment.py   # put/call, implied volatility
│   ├── hype.py                # Reddit / Google Trends mentions
│   ├── valuation.py           # DCF + reverse DCF
│   ├── backtest.py            # look-alikes, paper trading, signal report
│   ├── importers/             # degiro.py, bolero.py, ibkr.py, generic_csv.py
│   ├── etf_lookthrough.py
│   └── risk/
│       ├── volatility.py      # vol, ATR, max drawdown, correlation
│       ├── sizing.py          # position sizing engine (13.13.4)
│       ├── portfolio.py       # value, P/L, allocation, VaR
│       └── stress.py          # 2008 / 2020 / 2022 scenarios
│   ├── score.py               # builds Bottom Score from indicators + config
│   ├── intraday.py            # intraday checks
│   ├── alerts.py              # Telegram / ntfy sending + de-dup state
│   ├── market_hours.py        # open/closed/holiday logic
│   ├── storage.py             # read/write JSON (later SQLite)
│   ├── run_daily.py           # entrypoint: daily job
│   └── run_intraday.py        # entrypoint: intraday job
├── realtime/                  # Phase 3 only
│   ├── ws_worker.py           # Finnhub WebSocket listener
│   └── stock-tracker.service  # systemd unit file
├── data/                    # GITIGNORED, local dev only. Real data is in Supabase
├── web/
│   ├── index.html
│   ├── glossary.json          # learning-mode texts
│   ├── app.js
│   └── style.css
├── tests/
│   ├── test_indicators.py
│   ├── test_score.py
│   └── test_market_hours.py
└── .github/workflows/
    ├── daily.yml
    ├── intraday.yml
    └── (deploy: Cloudflare Pages auto-deploys on push)
```

### Example watchlist structure (`config/watchlist.example.yaml`; the real data is in the Supabase `watchlist` table)
```yaml
tickers:
  - symbol: NVDA
    name: NVIDIA
    buy_below: 110        # optional personal level → alert
    notes: "Wait for weekly RSI < 35"
  - symbol: ASML.AS
    name: ASML
    market: EU
```

### Example `config/scoring.yaml`
```yaml
signals:
  near_200w_ma:   { enabled: true, tolerance: 0.05 }
  weekly_rsi:     { enabled: true, period: 14, below: 30 }
  drawdown:       { enabled: true, min_pct: 30 }
  valuation_pct:  { enabled: true, years: 10, below_percentile: 20 }
  insider_buying: { enabled: true, days: 90 }
  market_fear:    { enabled: true, vix_above: 30, fear_greed_below: 25 }
alert_threshold: 4
```

---

## 10. Background running (scheduling)

### Phase 1–2: GitHub Actions (free)
- `daily.yml`: cron `45 21 * * 1-5` (UTC, after US close incl. buffer) + `workflow_dispatch` for manual runs.
  Steps: checkout → setup Python (with pip cache) → install → `python -m src.run_daily` → write results to Supabase. **Nothing is committed.** To keep the scheduled workflow alive on a repo without commits, use a keep-alive action or a monthly empty commit (no data).
- `intraday.yml`: cron `*/15 13-21 * * 1-5`. The script exits immediately if the market is closed.
- Secrets in **GitHub → Settings → Secrets**: `FINNHUB_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, (`FMP_API_KEY`).
- Known limits: scheduled runs can be **delayed 5–30 min** under load. Scheduled workflows are **disabled after 60 days of no repo activity** (the daily commit keeps it alive). Private repos have limited free minutes, and 15-min intraday runs may use them up, so use a public repo or reduce frequency.
- Use `concurrency:` groups so two runs never write data at the same time.

### Phase 3: Always-on VPS (optional, ~€4/mo, e.g. Hetzner CX22, or Oracle Cloud free tier)
- Ubuntu, Python venv, code pulled from GitHub.
- `realtime/ws_worker.py` connects to the Finnhub WebSocket and subscribes to watchlist tickers. It checks alert rules on every trade/price update and alerts within seconds.
- Runs as a **systemd service** with `Restart=always`, logs to `journalctl`.
- Reconnect logic with exponential backoff. Heartbeat: if no message for X min during market hours, reconnect and send a "worker unhealthy" alert.
- Daily job can move from GitHub Actions to a systemd timer here too (optional).
- Pushes updated JSON to the repo (or serves it directly behind a small API, later).

### Monitoring / health
- Daily "I'm alive" summary message (optional): top 3 scores, any errors.
- If a job fails, GitHub emails the owner by default. Also send a Telegram message from a `failure()` step.

---

## 11. Build phases (roadmap)

### Phase 0: Setup (≈ 30 min, owner + Claude)
- [ ] Create **public** GitHub repo (code only), turn on secret scanning + push protection, add gitleaks, connect it to Cloudflare Pages (free).
- [ ] Get Finnhub free API key.
- [ ] Create Telegram bot via @BotFather, get token + chat id.
- [ ] Add all keys as GitHub Secrets (never in files).
- [ ] Create Supabase project + schema, add your watchlist in the app (or a one-time seed script run locally with a gitignored file).

### Phase 1: MVP daily score (first build)
- [ ] `fetch.py` with yfinance daily/weekly + VIX.
- [ ] `indicators.py`: SMA, RSI (Wilder), drawdown, percentile, plus tests.
- [ ] `score.py` with T1, T2, T3, S1 (valuation + insiders come next).
- [ ] `run_daily.py` writes the scores + per-ticker detail to Supabase (`latest_scores`, `ticker_detail`).
- [ ] Minimal `index.html` dashboard + TradingView chart on detail view.
- [ ] `daily.yml` workflow + Cloudflare Pages deploy. Lock the site with **Cloudflare Access** (free, email login) so only the owner can open it.
- [ ] Data sanity checks + health page (13.14 E).
- **Done when:** the phone shows the watchlist with scores, updated automatically every weekday night.

### Phase 2: Fundamentals, alerts, intraday
- [ ] Valuation-vs-history (V1) and insider buying (V2).
- [ ] News + earnings calendar on detail page.
- [ ] Telegram alerts with de-dup + quiet hours.
- [ ] `intraday.yml`: drop / volume / buy-level / news alerts every 15 min.
- [ ] Alerts log page.
- [ ] Automatic previous bottoms/ceilings (`levels.py`) + Lightweight Charts levels view + support alerts (section 6.5).
- [ ] Chart upgrades: signal markers, valuation bands, RSI/volume/score panels, drawdown chart, zoom presets + log scale, synced crosshair (13.17).
- [ ] Quality Score + combined verdict badge, "why is it down?", earnings reaction history (13.1).
- [ ] Upcoming events: earnings dates, dividends, macro calendar, reminders, `.ics` subscription (13.3).
- [ ] Watchlist tags (13.6).
- [ ] Top Score / trim signals (13.14 A).
- [ ] ROIC & moat sub-score (13.16 A).
- [ ] Learning mode glossary + ⓘ tooltips (13.16 C).
- [ ] Score history snapshots + chart.

### Phase 3: Portfolio & Risk + real-time
- [ ] **Portfolio & Risk page (13.13):** Supabase holdings (owner decision: Supabase from the start), live value, allocation charts.
- [ ] Risk/position sizing engine + "Can I buy this?" calculator + risk budget gauge, fully tested.
- [ ] Serverless function for live quotes (keys server-side).
- [ ] Broker CSV import (DEGIRO, Bolero, IBKR).
- [ ] Concentration, correlation, stress test (13.11).
- [ ] Transactions table + benchmark comparison TWR/XIRR, "what if ETF" (13.14 B).
- [ ] Emotional guardrails + decision log (13.14 C).
- [ ] Automatic thesis checks (13.14 D).
- [ ] Weekly encrypted backups (13.14 E).
- [ ] Dividend income tracker (13.15 A) + realised gains & tax-year report (13.15 C).
- [ ] Telegram bot commands (13.16 B).
- [ ] Trade markers + average-cost line, portfolio charts (13.17).
- [ ] Pre-trade checklist & order planner, post-trade reviews (13.18).
- [ ] Optional: VPS + Finnhub WebSocket worker + systemd for alerts within seconds.

### Phase 4: Nice-to-haves (non-AI parts only)
- [ ] Peers, relative strength, dividend history, seasonality (13.2). (AI summary is in Phase 5.)
- [ ] Market regime panel (13.4).
- [ ] Journal, staged buy plan, currency impact, fees & taxes calculator (13.5).
- [ ] Compare overlay, tap-to-set alerts (13.6).
- [ ] Smart-money signals: buybacks, 13F funds, estimate revisions, price targets, short interest (13.7).
- [ ] Options put/call + IV, social hype meter (13.8).
- [ ] DCF + reverse DCF tools (13.9).
- [ ] Historical look-alikes, paper trading, monthly signal report (13.10).
- [ ] ETF look-through, phone widget (13.12). (Ask Claude + earnings-call analysis are in Phase 5.)
- [ ] Goal planner with Monte Carlo (13.15 B).
- [ ] Yearly review report (13.15 D).
- [ ] Portfolio gap finder + opportunity feed (13.15 E). Needs ETF look-through + sizing engine first.
- [ ] Backtest view: for each ticker, show past dates with score ≥ 4 and the return 6/12/24 months later. **This is the most useful way to check whether the score means anything.**
- [ ] Extra signals (6.4).
- [ ] Market-wide "bottom gauge" for S&P 500 / Nasdaq index itself.
- [ ] PWA + home-screen icon.
- [ ] Portfolio tracking (positions, average cost, P/L), manual entry only.
- [ ] Weekly email/Telegram digest (Sunday evening): scores, changes, upcoming earnings.
- [ ] Screener mode: score a whole index (e.g. S&P 500) once a week and show the top 20.
- [ ] DCA helper: suggested staged buy levels (e.g. at −20/−30/−40% from high).
- [ ] Currency handling: show EU stocks in EUR, US stocks in USD + EUR equivalent.

### Phase 5: AI features (owner decision: build LAST)
- [ ] AI news summary (13.2), Ask Claude + earnings call analysis (13.12), AI text in the yearly review (13.15 D), AI scan for investor days/AGMs (13.3).
- [ ] Decide on the investor-day/AGM approach (Q11).

---

## 12. Coding conventions (for Claude Code)

- Python: type hints everywhere, `ruff` clean, small pure functions, no global state except config.
- Every external call has: timeout, max 3 retries with backoff, and a logged error on final failure.
- Never commit secrets. Read keys from env vars only (`os.environ`). Provide `.env.example`.
- Indicators must have unit tests with hand-checked values before being used in scoring.
- Configuration over code: thresholds go in YAML.
- JSON output schema changes must be reflected in `web/app.js` in the same commit.
- Keep the frontend dependency-free (CDN scripts for TradingView / Lightweight Charts only).
- Commit messages: short, imperative (`Add weekly RSI signal`).
- When unsure about a financial definition, **ask the owner** rather than guess.
- Every new metric gets a `web/glossary.json` entry (learning mode) in the same commit.
- **Scope rule:** the plan is frozen. Build phases in order, and don't start a later phase's features until the owner says the earlier phase works well in daily use.

### Useful commands
```bash
pip install -r requirements.txt
python -m src.run_daily           # run daily job locally
python -m src.run_intraday --force  # run intraday even if market closed (testing)
pytest -q
ruff check . && ruff format .
python -m http.server -d web 8000   # preview frontend locally
```

---

## 13. Additional features

### 13.1 Avoiding bad bottoms (value traps), HIGH PRIORITY, Phase 2
A low price alone is not enough. A stock can be cheap because the business is failing.

**Quality Score (0–100, separate from the Bottom Score)**, in `src/quality.py`:
- **Piotroski F-score (0–9):** profitability, leverage/liquidity and efficiency checks from the last 2 annual reports.
- **Altman Z-score:** bankruptcy risk (Z < 1.8 = distress zone, > 3 = safe). Not meaningful for banks/insurers, so show "n/a" for financials.
- **Debt:** net debt / EBITDA (warn if > 3–4×), interest coverage (warn if < 3×).
- **Free cash flow:** positive in at least 3 of the last 4 years.
- **Growth:** revenue growth over 3 years. Flag "shrinking" if negative.
- **Margins:** gross/operating margin trend, compared with its own 5y average.
- **Dilution:** share count change over 3 years (warn if > +5%/yr).
- **ROIC & moat check** (see 13.16 A): ROIC level and stability, ROIC vs cost of capital, gross margin stability.
- Data: FMP free tier (financial statements) or Finnhub fundamentals. Cache, since it only changes quarterly.

**Combined verdict on every ticker** (shown as a badge next to the scores):
| Bottom Score | Quality | Label |
|---|---|---|
| High (≥ 4) | High (≥ 70) | 🟢 **Quality on sale** |
| High | Medium (40–70) | 🟡 **Check fundamentals** |
| High | Low (< 40) | 🔴 **Possible value trap** |
| Low | any | ⚪ Not at a bottom |

**"Why is it down?"**: every drop alert and the ticker page shows the most relevant news headline(s) from the last 48 hours (Finnhub company news, sorted by recency, filtered to the ticker). If an AI summary exists (13.2), show that instead.

**Earnings reaction history:** for the last 8 earnings reports show the date, EPS actual vs estimate (beat/miss), and the stock move on day +1 and over +5 days. Also show the average absolute move ("this stock typically moves ±7% on earnings").

### 13.2 Smarter research, Phase 4
- **AI news summary:** once per day, send the day's headlines + summaries per ticker to the Claude API (`claude-haiku` class model, cheap). Get back 3 bullet points + sentiment (−1 to +1) + "is this a business problem or market noise?". Store it in Supabase with the ticker data. Budget: a few cents per day. Key in secret `ANTHROPIC_API_KEY`. Config flag to disable.
- **Peer comparison:** `peers` list per ticker in the Supabase `watchlist` table (or auto via Finnhub peers endpoint). Table: P/E, P/S, EV/EBITDA, margins, growth, drawdown vs peers and sector median.
- **Relative strength:** stock vs S&P 500 (`^GSPC`) and vs its sector ETF (XLK, XLV, …) over 3/6/12 months, shown as a ratio line chart.
- **Dividend yield vs own history:** current yield vs 10y range (high percentile = potentially cheap). Dividend growth streak, payout ratio (warn if > 80%, cut risk).
- **Seasonality:** average and median return per calendar month over 10+ years, shown as a bar chart, with % of years positive.

### 13.3 Upcoming events calendar, Phase 2
For every ticker, and combined across the watchlist:
| Event | Source | Notes |
|---|---|---|
| **Next earnings date + time** (before open / after close) + EPS & revenue estimates | Finnhub earnings calendar | Show the countdown "in 12 days". Mark the date as *confirmed* or *estimated*. |
| **Earnings call** (webcast) | Company IR page / Finnhub | Usually the same day as earnings. Link to IR page stored per ticker in the Supabase `watchlist` table (`ir_url`). |
| **Ex-dividend & payment date** | yfinance / Finnhub / FMP | |
| **Investor day / capital markets day, AGM, product launch events** | Not reliably in free APIs | Option A: owner adds them manually in `config/events.yaml`. Option B (Phase 4): weekly AI scan of news for announced dates, which the owner confirms. |
| **Stock splits, index inclusion** | FMP / news | |
| **Macro events:** Fed (FOMC) & ECB rate decisions, US CPI, jobs report (NFP), GDP | Finnhub economic calendar or a hard-coded yearly list | Big market movers. |

Features:
- **Calendar page** (list by week) + "Next 7 days" strip on the dashboard.
- **Reminders:** Telegram message 7 days and 1 day before earnings of a watchlist stock.
- **Calendar subscription:** serve a private `.ics` feed (Supabase Edge Function with a long secret token in the URL) so the owner can subscribe once in the phone calendar (Apple/Google) and all events appear there automatically.
- After earnings: an automatic alert with beat/miss + the price reaction.

### 13.4 Market-wide view, Phase 4
- **Market regime panel** on the dashboard:
  - S&P 500 and Nasdaq vs their 200-day MA (above = uptrend).
  - Breadth: % of S&P 500 stocks above their 200-day MA (< 20% = washed out, historically near market bottoms).
  - Yield curve 10y–2y (FRED `T10Y2Y`), high-yield credit spread (FRED `BAMLH0A0HYM2`).
  - VIX + Fear & Greed (already in the plan).
  - One overall label: **Risk-on / Neutral / Fearful / Panic**.
- **Economic calendar** (see 13.3).

### 13.5 Your own decisions, Phase 4
- **Investment journal:** per ticker, notes with date. Template fields: *why I bought*, *what would make me sell (thesis breakers)*, *target price*, *review date*. Reminder via Telegram on the review date (default every 6 months). Stored in the Supabase `journal` table, edited with a form in the app.
- **Staged buy plan:** per ticker, define 2–4 buy levels (e.g. at support zones or −20/−30/−40% from high) with an amount or % of the planned position. The app shows which levels are hit/pending and alerts when a level is reached.
- **Portfolio tracking** (manual entries): positions, average cost, P/L in EUR and native currency, weight per position, sector split.
- **Currency impact:** for USD stocks, split the return into stock return vs EUR/USD effect (`EURUSD=X` from yfinance).
- **Fees & taxes calculator:** Belgian stock exchange tax (TOB) and broker fee per trade, plus any capital-gains/dividend withholding tax. **Rates must be configurable** in `config/costs.yaml` and checked against current Belgian rules, never hard-coded.

### 13.6 Comfort & UX, Phase 2–4
- **Tags/groups** in the watchlist: `core`, `speculative`, `wait-for-dip`, custom. Filter by tag.
- **Compare overlay:** pick 2–3 tickers and show % performance from a chosen start date on one chart.
- **Tap-to-set price alerts:** tap a price on the chart to create a price alert (writes to Supabase. In Phase 1–2, buy levels are set on the watchlist form).
- **Weekly digest** (Sunday evening): top scores, biggest changes, events in the coming week, quality warnings.
- **PWA**: install on the phone home screen, dark mode, fast load.

### 13.7 "Smart money" signals, Phase 4
- **Share buybacks:** shares outstanding falling and buyback amount in the last 2 quarters (cash-flow statement, "repurchase of stock"). Extra weight if buybacks happen while the stock is ≥ 30% off its high.
- **Big fund holdings (13F):** quarterly holdings changes of a configurable list of well-known long-term funds (SEC EDGAR 13F filings, or FMP/Finnhub institutional ownership). Show "added / new position / trimmed / sold out". Note: 13F data is up to 45 days old.
- **Analyst estimate revisions:** trend of next-year EPS estimate over 30/90 days (up / flat / down). "Cuts stopping" (down → flat) is flagged as an early bottom sign.
- **Analyst price targets:** mean/low/high target vs current price (% upside) and its trend.
- **Short interest:** % of float short and days to cover, with trend. High and falling = possible squeeze/rebound. (US only; data is twice-monthly and often delayed.)
- Candidate extra Bottom Score signals (off by default): `buyback_at_lows`, `estimate_cuts_stopping`, `smart_money_adding`.

### 13.8 Fear signals per stock, Phase 4
- **Options data:** put/call ratio and implied volatility (IV) vs its own 1-year range. IV spike to the top 10% of the range = panic in that stock. Source: yfinance option chains (unofficial, US only).
- **Social hype meter:** mentions per day on Reddit (r/stocks, r/investing, r/wallstreetbets) and Google Trends interest (`pytrends`, unofficial). Show as a line under the price chart. Extreme spikes near highs = euphoria warning. Very low interest near lows = possible capitulation.

### 13.9 Valuation tools, Phase 4
- **Simple DCF fair value:** inputs prefilled from data (current FCF, shares, net debt) with sliders for growth years 1–5, growth years 6–10, terminal growth, discount rate. Output: fair value per share + margin of safety %. Always shows the assumptions next to the number.
- **Reverse DCF:** solve for the growth rate implied by today's price: "the market prices in ~X% FCF growth per year for 10 years". Compare with historical growth.
- These are tools for thinking. Label them as estimates, never as "the true value".

### 13.10 Proving the system works, Phase 4
- **Historical look-alikes:** for the current Bottom/Quality combination, find all past dates (same ticker, and optionally all watchlist tickers) with a similar score. Show the forward 3/6/12/24-month returns: average, median, best, worst, % positive. Always show sample size ("based on 6 cases").
- **Paper trading mode:** virtual portfolio with configurable rules (e.g. "buy €1,000 when verdict = Quality on sale, sell never/after 2 years"). Tracks results over time vs simply buying an S&P 500 / MSCI World ETF. Stored separately from the real portfolio.
- **Monthly signal report:** every alert of the past months with what happened afterwards (+1m/+3m/+6m), and hit rate per signal type. This helps tune thresholds.

### 13.11 Risk management helpers, Phase 3–4
(These feed into the Portfolio & Risk page, 13.13.)
- **Position sizing helper:** suggested amount based on volatility (see 13.13.4).
- **Concentration warnings:** by single position, sector, region, currency, and asset type.
- **Correlation check:** 1-year correlation matrix of daily returns between holdings. Warn when ≥ 3 holdings have correlation > 0.8 ("these move together").
- **Stress test:** apply the actual historical moves of each holding (or a proxy ETF if it didn't exist yet) in: 2008 crisis (Oct 2007–Mar 2009), COVID crash (Feb–Mar 2020), 2022 bear market. Show the estimated € loss of the current portfolio.

### 13.12 Workflow, Phase 4
- **"Ask Claude" button** on each ticker page: sends the ticker's stored data (scores, signals, levels, news summary, fundamentals, the owner's journal) plus the owner's question to the Claude API. Answers use the data from the app, not guesses. Needs a small backend function (13.13.2) so the API key is never in the browser.
- **Earnings call analysis:** after each earnings call, fetch the transcript (FMP / Finnhub, may need a paid tier; otherwise owner pastes it). AI summary: key numbers, guidance up/down, management tone score, and warning phrases ("headwinds", "softening demand", "elongated sales cycles", "macro uncertainty") counted vs the previous call.
- **Broker import:** the owner uses **Bolero**, so **build the Bolero importer first** (the owner will provide an anonymised sample export; don't guess the format). DEGIRO, IBKR and generic CSV come later.
  - **Bolero files are Excel (.xlsx), not CSV.** Support two files: (1) **Transaction history** (Rekeningen → Transactiehistoriek → Excel icon, file name like `cashmovements_….xlsx`). Bolero exports only the rows loaded in the table, so the owner must load all rows first. (2) **Position overview** (Portefeuille → Posities → Excel icon, with the ISIN column switched on). Parse with SheetJS in the browser.
  - **Positions-only mode (owner may choose this):** the app must work fully with only the position overview. Each holding is stored as a starting position on the import date (with the average buy price if the file includes it, otherwise the owner enters it). From then on, new trades are logged in the app ("Log this trade", 13.18), so the transaction history builds up from that date. Features that need past transactions (TWR/XIRR before the import date, past realised gains, past dividends, trade markers before the import date) show "available from <import date>" instead of failing.
  - **Import privacy rules:**
    - The app **never connects to Bolero** and never asks for Bolero login details. The owner downloads the export from Bolero and uploads the file in the app.
    - The file is **parsed in the browser**. Only the needed fields are saved to Supabase: date, ISIN/ticker, buy/sell, quantity, price, currency, fees, taxes. **Name, address, account number, IBAN and client ID are dropped** and never stored.
    - The original file is not uploaded or kept anywhere.
    - **Test fixtures** for the importer use **fake data** in the real column format (made by hand from the anonymised sample). The owner's real export is never committed. Files go in a gitignored `seed/` folder for local testing only. Parse transactions into holdings (qty, average cost, fees). One parser per broker in `src/importers/`. Show a preview before saving.
- **ETF look-through:** for each ETF held, load its top holdings (issuer data / FMP ETF holdings). Show the *true* exposure, e.g. "you own NVDA directly 4% + via ETFs 2.1% = 6.1% total". Overlap warnings between ETFs and between ETFs and single stocks.
- **Phone home-screen widget:** iOS via the free **Scriptable** app (script calls a read-only Supabase Edge Function with a private token). Android via KWGT or a PWA shortcut. Shows the top 3 Bottom Scores + portfolio value today.

### 13.13 Portfolio & Risk page (MAIN FEATURE, Phase 3)

A page where the owner enters **total portfolio size, cash, and everything they own**. The app tracks it live, and calculates **how much risk can be taken on every new or existing investment**, with ETFs allowed bigger positions than single stocks because they are less volatile.

#### 13.13.1 What the owner enters
- **Cash available to invest** (per currency: EUR, USD).
- **Emergency fund / money not to invest** (excluded from all calculations).
- **Holdings**, entered manually or via broker import (13.12):
  | Field | Example |
  |---|---|
  | Ticker / ISIN | `VWCE.DE`, `NVDA`, `IE00BK5BQT80` |
  | Asset type | `broad_etf`, `sector_etf`, `bond_etf`, `stock`, `crypto`, `cash`, `other` |
  | Quantity | 120 |
  | Average buy price + currency | 98.40 EUR |
  | Broker / account | DEGIRO |
  | Tags | core, speculative |
- **Risk profile:** `conservative`, `balanced`, `aggressive`, or custom (sets the defaults below; every number is editable).
- **Planned monthly contribution** (optional, used for staged-buy suggestions).

#### 13.13.2 Privacy and storage (IMPORTANT)
- Portfolio data is personal. **It must never be committed to the (public) repo.** See 2.1 Privacy rules.
- Recommended: **Supabase free tier** (Postgres + login with email/magic link). Row-level security so only the owner can read/write. The page asks for login.
- Live prices and Claude calls go through a small serverless function (**Supabase Edge Function** or **Cloudflare Worker**, both free tier) that holds the API keys. **No API keys in browser code.**
- **Supabase hardening (owner asked for it to be secret enough):**
  - Project region **EU (Frankfurt)**. Data is encrypted at rest and in transit (HTTPS) by Supabase.
  - **Row-level security ON for every table**, with policies `user_id = auth.uid()`. Add a test that checks an anonymous/other user gets 0 rows.
  - **MFA (authenticator app) required** for the app login, plus a strong password + MFA on the Supabase and GitHub accounts themselves.
  - Only the public *anon* key is in the frontend. The *service* key exists only in GitHub Secrets / Edge Functions.
  - Disable public sign-ups after the owner's account is created (single-user app).
  - Optional extra layer: Cloudflare Access in front of the site, so nobody even sees the login page.
  - Optional: encrypt the most sensitive columns (amounts, notes) client-side with a passphrase only the owner knows (trade-off: losing it means losing the data).
- (Browser-only storage was considered and rejected. The owner chose Supabase.)

#### 13.13.3 Live tracking (shown on the page)
- Total value (EUR), today's change €/%, total P/L €/% (with and without currency effect), cash %, invested %.
- Prices refresh every 60s during market hours via the serverless function (Finnhub quote / WebSocket for US, yfinance-delayed for EU). Shows "live" or "delayed 15 min" per holding.
- Holdings table: value, weight %, P/L, day change, Bottom Score, Quality Score, verdict badge, suggested max weight vs actual weight.
- Allocation charts: by asset type, sector, region, currency, and core vs satellite. Uses ETF look-through when available.
- Portfolio risk metrics: annualised volatility, beta vs MSCI World, estimated max drawdown, 1-month 95% Value-at-Risk ("in a bad month you could lose about €X"), stress test results (13.11).

#### 13.13.4 Risk budget & position sizing engine (`src/risk/sizing.py`)
All defaults live in `config/risk.yaml` and are editable per profile.

**Step 1: Volatility per asset.** Annualised volatility from 1 year of daily returns (`std × √252`), plus the 14-day ATR for staged levels. Use historical max drawdown as a second check.

**Step 2: Base caps per asset type** (default = *balanced* profile):
| Asset type | Max weight per position | Typical volatility |
|---|---|---|
| Broad world / S&P 500 ETF | 100% (no single cap) | ~15% |
| Sector / thematic / single-country ETF | 15% | ~20–30% |
| Bond ETF | no cap | ~5–8% |
| Large-cap stock, Quality ≥ 70 | 8% | ~25–35% |
| Other single stock | 5% | 30–60% |
| Small-cap / speculative / crypto | 2% each, 10% total | 60–100%+ |

**Step 3: Core–satellite targets** (balanced default): core (broad ETFs + bonds) ≥ 70%, satellite (single stocks, sector ETFs) ≤ 30%, speculative ≤ 5–10%, cash reserve ≥ 5%. *Conservative* is 85/15 and *aggressive* 50/50; both are editable.

**Step 4: Risk-per-position rule.** The owner sets the max acceptable loss per position as % of total portfolio (default 1% conservative, 1.5% balanced, 2.5% aggressive). The expected bad-case drop of a position is `k × annual volatility` (default k = 1.5, roughly a bad year), capped by its historical max drawdown.
`max_position_€ = (portfolio_€ × risk_per_position%) / expected_bad_case_drop%`
Example: €50,000 portfolio, 1.5% risk = €750 acceptable loss. A stock with 40% volatility → bad case 60% → max €1,250. A world ETF with 15% volatility → bad case 22.5% → max €3,333 for this rule, and the type cap is none, so ETFs get much bigger positions automatically.

**Step 5: Adjustments (multipliers, all configurable):**
- Quality Score: ≥ 70 ×1.0, 40–70 ×0.75, < 40 ×0.5 (or block).
- Verdict "Quality on sale" ×1.2 (never above the type cap). "Possible value trap" ×0.5.
- Correlation: if correlation with existing holdings > 0.8, then ×0.7.
- Sector already at the max (default 25%), then suggestion = 0 with a warning.
- Earnings within 7 days: no adjustment, but show a "volatility ahead" warning.

**Step 6: Final suggestion** = the **lowest** of: risk-rule amount, type cap, sector headroom, core–satellite headroom, and cash available (minus the cash reserve).

#### 13.13.4b Risk settings in the app (owner decision)
- **Settings → Risk** page where the owner sets and changes: risk profile, max loss per position %, core/satellite/speculative split, cash reserve %, max weight per asset type (broad ETF, sector ETF, quality stock, other stock, speculative), max per sector, max per region, quality/verdict multipliers, and the volatility factor k.
- Prefilled with the *balanced* defaults from `config/risk.yaml`, plus a "reset to defaults" button.
- Stored in Supabase (`risk_settings`), not in the repo. The sizing engine always reads the owner's saved settings.
- Every change is logged with a date, so the yearly review shows when the rules changed.

#### 13.13.5 What the owner sees
- **Risk budget gauge:** total risk used vs allowed ("satellite: 22% of max 30% used", "speculative: 3% of 10%").
- **"Can I buy this?" calculator:** pick a ticker, and the app shows:
  ```
  NVDA · stock · volatility 48% · Quality 82 · verdict: Quality on sale
  Max suggested position: €1,250 (2.5% of a €50,000 portfolio)
    = €750 max loss ÷ 72% bad-case drop (1.5 × 48%) = €1,042 × 1.2 (Quality on sale)
  You already own: €900 → room left: €350
  Limiting factor: risk-per-position rule (1.5%)
  Staged plan: €120 now · €115 at $105 (support zone) · €115 at $92 (200-week MA)
  ```
- Per holding: **over/under-weight warnings**, e.g. "NVDA is 9.4% of the portfolio, above the 8% cap. Consider not adding more."
- **Cash deployment plan:** with €X cash, the suggested split across core ETFs and the current best "Quality on sale" ideas, respecting all caps. Optional monthly DCA schedule.
- **Rebalancing suggestions** when core/satellite drifts more than 5 percentage points from target.

#### 13.13.6 Rules for Claude Code
- The sizing engine is **pure, deterministic Python/TypeScript functions** with full unit tests, including the worked example above.
- Every suggested number shows **which rule limited it** and the inputs used. No unexplained numbers.
- UI wording: "suggested max based on your settings", never "you should buy". A visible disclaimer: calculations from the owner's own rules, not financial advice.
- The engine never places trades and has no broker write access.

### 13.14 Top priority additions (decided after review)

#### A. Top Score: when to trim (Phase 2)
The mirror of the Bottom Score, so the app also helps with selling and trimming, not only buying. `src/top_score.py`, thresholds in `config/scoring.yaml` under `top_signals`.
| # | Signal | Default rule |
|---|---|---|
| U1 | Far above long-term trend | Close ≥ 200-week SMA × 1.8 |
| U2 | Weekly RSI overbought | RSI(14) weekly > 70 (extra flag > 80) |
| U3 | Expensive vs own history | P/E or P/S in the **top 10%** of its 5–10y range |
| U4 | Insider selling | Net insider open-market selling > threshold in last 90 days (ignore planned 10b5-1 sales where data allows) |
| U5 | Euphoria | Hype meter (13.8) at a 1-year high **or** Fear & Greed ≥ 75 |
| U6 | Near major resistance | Within 3% of a major ceiling zone (6.5) |
- Labels: 0–1 normal, 2–3 "getting hot", 4+ **"Consider trimming"**. This is never an automatic sell.
- Shown next to the Bottom Score on every ticker and in the Portfolio page. Alerts only for stocks the owner **holds**.
- If a holding is above its sizing cap (13.13) **and** the Top Score is ≥ 4, show a combined "trim to target weight" suggestion with the € amount.

#### B. Benchmark comparison (Phase 3)
- **Time-weighted return (TWR)** of the real portfolio, so deposits/withdrawals don't distort it, plus the **money-weighted return (IRR/XIRR)**. Both after fees and taxes entered in transactions.
- Compare against the owner's choice of benchmark (default **MSCI World in EUR**, e.g. `IWDA.AS` / `VWCE.DE`; also S&P 500 in EUR).
- **"What if I had just bought the ETF?"** line: the same cash flows on the same dates invested in the benchmark ETF instead. Shows the € difference.
- Periods: YTD, 1y, 3y, since start. Also split by part: core vs satellite vs speculative. This shows whether stock picking adds value.
- Requires a **transactions table** (date, ticker, qty, price, fees, taxes, currency, FX rate), not only current holdings. Broker imports (13.12) fill it.

#### C. Guardrails against emotional decisions (Phase 3)
Config in `config/guardrails.yaml`, each rule switchable on/off.
- **24-hour cooling-off:** a buy that is not in the staged buy plan / watchlist plan gets a "Decide tomorrow" button. The app reminds the owner after 24h with the same data shown again.
- **FOMO warning:** the stock is up ≥ 30% in the last 3 months or the Top Score is ≥ 3. Show this before using the "Can I buy this?" calculator.
- **Panic-sell check:** when marking a sale during a drawdown ≥ 20%, show the journal entry (*why I bought, thesis breakers*) and ask: "Has a thesis breaker actually happened?" Yes/No is logged.
- **Trade limit:** max trades per month (default 4). The counter is shown on the Portfolio page, with a warning when exceeded.
- **Decision log:** every buy/sell gets a one-line reason and emotion tag (calm / FOMO / fear / plan). The monthly report shows results per tag.

#### D. Automatic thesis checks (Phase 3)
- The journal's *thesis breakers* become **machine-checkable rules** per holding, e.g.:
  ```yaml
  NVDA:
    thesis_rules:
      - metric: revenue_growth_yoy
        op: ">="
        value: 0.10
      - metric: net_debt_to_ebitda
        op: "<="
        value: 3
      - metric: gross_margin
        op: ">="
        value: 0.60
      - metric: quality_score
        op: ">="
        value: 60
  ```
- Checked after every quarterly report (triggered by the earnings calendar, 13.3) and weekly as a fallback.
- A broken rule sends an alert: "NVDA thesis rule broken: revenue growth 6% < 10%", with a link to the journal.
- Status per holding: ✅ thesis intact / ⚠️ 1 rule broken / ❌ multiple broken.
- Free-text breakers that can't be automated stay as manual review reminders.

#### E. Data health & backups (Phase 1, built in from the start)
- **Status page** (`#health`): per data source, the last successful fetch, error count, rows received, and green/yellow/red. Last run times of each scheduled job.
- **Sanity checks** before any data is used (`src/data_checks.py`):
  - Daily move > 40%: check for a split/reverse split (yfinance `splits`, compare share count). If unexplained, mark the value as **suspect** and don't use it for scores/alerts until the next run confirms it.
  - Missing days, zero/negative prices, stale prices (unchanged for 3+ trading days), P/E jumps > 5× quarter-on-quarter.
  - Currency mismatches (e.g. GBp vs GBP for London stocks, a factor of 100).
- Suspect data shows a ⚠️ in the UI and is excluded from alerts.
- A daily Telegram message is sent only if something is red.
- **Backups:** weekly automatic export of all portfolio/journal/transaction data (Supabase) to an encrypted JSON file in a **private** location (private GitHub repo or owner's cloud drive). Manual "Export everything" button on the Settings page. Restore tested once during setup.

### 13.15 Second-round additions

#### A. Dividend income tracker (Phase 3)
- Per holding: dividend per share, frequency, next ex-date/pay date, current yield and **yield on cost** (dividend ÷ owner's average buy price).
- **12-month income forecast** by month (bar chart), in EUR after estimated withholding tax (rates from `config/costs.yaml`).
- Received dividends log (from broker import or manual), year-to-date total, growth vs last year.
- Warnings: payout ratio > 80%, dividend cut announced, FCF not covering the dividend.

#### B. Goal planner (Phase 4)
- Inputs: target amount, target date/age, current portfolio value, monthly contribution, expected allocation (from the core/satellite split).
- **Monte Carlo simulation** (1,000+ runs) using historical return/volatility assumptions per asset type, configurable in `config/goals.yaml`. Default to conservative assumptions and inflation-adjusted (real) returns.
- Output: probability of reaching the goal, median / bad-case (10th percentile) / good-case (90th) outcome, fan chart over time.
- Sliders: contribution, years, risk profile, so the owner sees the trade-offs live.
- Clearly labelled as a simulation based on assumptions, not a forecast.

#### C. Realised gains & tax-year report (Phase 3)
- Per calendar year, from the transactions table: realised gains/losses per sale (FIFO by default, configurable if rules require otherwise), dividends received, foreign withholding tax, TOB paid, broker fees.
- Export to CSV/PDF for the owner's tax return or accountant.
- **All tax rates, exemptions and calculation methods come from `config/costs.yaml` and must be verified by the owner against current Belgian rules.** Nothing is hard-coded, and the report is labelled "for your own administration, verify with an advisor".

#### D. Yearly review report (Phase 4)
Generated automatically every January (plus on demand), as one page (HTML + PDF):
- Portfolio return vs benchmark (TWR, XIRR, "what if ETF" difference in €).
- Best and worst 3 decisions (from the decision log, with result since then).
- Signal performance: hit rates of Bottom Score, Top Score and alerts (from 13.10).
- Guardrail stats: how many cooling-offs triggered, how many buys were cancelled after 24h, results per emotion tag.
- Thesis checks: how many broke, and what happened to those holdings.
- Allocation drift over the year, dividends received, costs paid.
- An optional AI-written summary (Claude API) with 3 lessons for next year.

#### E. Portfolio gap finder: opportunities for what's missing (Phase 4)
The opportunity feed starts from **what the portfolio is missing**, then looks for good candidates to fill those gaps.

**Step 1: Find the gaps** (`src/gaps.py`), using ETF look-through (13.12) for the true exposure:
- **Sector gaps:** portfolio sector weights vs a reference (default: MSCI World sector weights, or owner targets in `config/targets.yaml`). Flag sectors at < 50% of the reference weight or at 0%.
- **Region gaps:** e.g. US / Europe / Japan / emerging markets vs the reference.
- **Asset-type gaps:** vs the core/satellite targets (e.g. no bonds, cash too high, satellite underused).
- **Style/factor gaps:** e.g. only growth stocks and no value/dividend payers, only large caps and no small caps.
- **Currency gaps:** e.g. 85% USD exposure for a EUR investor.
- **Diversification gaps:** areas with **low correlation** to current holdings (adding them lowers overall portfolio volatility the most).

**Step 2: Find candidates for each gap.** A weekly scan of a broad universe (S&P 500 + STOXX Europe 600, plus a curated list of broad/sector/region ETFs in `config/universe.yaml`):
- Must belong to a gap sector/region/type.
- Must pass quality filters: Quality Score ≥ 70 (stocks), or for ETFs: low cost (TER), large size, enough liquidity, and available on the owner's broker/exchange (UCITS for EU investors).
- Ranked by: verdict ("Quality on sale" first), Bottom Score, valuation vs history, **diversification benefit** (how much it would lower portfolio volatility / correlation), and Top Score (excluded if ≥ 3).

**Step 3: Make it fit the portfolio.** For each candidate, run the sizing engine (13.13.4) and show:
```
Gap: Healthcare 3% vs 12% reference · Europe 8% vs 16%
Idea: Novo Nordisk (NOVO-B.CO) · Quality 84 · Bottom Score 4/6 · verdict: Quality on sale
Diversification: correlation 0.21 with your portfolio → lowers portfolio volatility by ~0.6 pts
Suggested max: €1,400 (risk rule) · staged: 3 × €465 at support zones
Alternative (lower risk): iShares MSCI World Health Care UCITS ETF, max €4,800
```
- For every gap, show **one ETF option and 1–3 single-stock options**, so the owner can choose the lower-risk route.
- Delivered as a weekly "Opportunities for your portfolio" section on the dashboard + Sunday Telegram digest (top 3).
- Wording: "ideas to research that fit your gaps and rules", never "buy this". Each idea links to its full ticker page (scores, levels, news, quality, DCF).
- The example above illustrates the format only. The real output is always computed from live data.

### 13.16 Final additions (plan frozen after this, build and use Phase 1 first)

#### A. ROIC & moat check, part of the Quality Score (Phase 2)
- **ROIC** = NOPAT ÷ (debt + equity − cash), from annual statements, for up to 10 years.
- Points for: ROIC ≥ 15% average over 5y, ROIC > estimated cost of capital (default WACC 8–9%, configurable) in ≥ 4 of 5 years, low ROIC volatility, and gross margin stability (std dev of gross margin < 3 percentage points over 5y).
- Shown as a **"Moat" sub-score** (none / narrow / wide) on the ticker page with a 10-year ROIC + gross margin chart.
- Weighted into the Quality Score (weight configurable in `config/scoring.yaml`).
- Not meaningful for banks/insurers (use ROE instead) or for very young companies (show "n/a").

#### B. Telegram bot commands (Phase 3)
Two-way bot: the owner asks, the app answers. Runs as a Supabase Edge Function / Cloudflare Worker webhook (or the VPS worker). **Only responds to the owner's chat ID.**
| Command | Answer |
|---|---|
| `/score NVDA` | Bottom, Top, Quality, Moat, verdict, signals that fired |
| `/portfolio` | Value, today's change, P/L, cash, risk budget used |
| `/canibuy ASML 2000` | Sizing engine result: allowed or not, max €, limiting rule, staged plan |
| `/events week` | Earnings, dividends and macro events in the next 7 days |
| `/levels NVDA` | Nearest support/resistance zones |
| `/gaps` | Top portfolio gaps + best idea per gap |
| `/thesis NVDA` | Thesis rule status |
| `/news NVDA` | AI summary of the latest news (if enabled) |
| `/health` | Data source status |
| `/help` | Command list |
- Answers are short and phone-friendly, with a link to the full page in the app.
- Read-only: no command can change the portfolio. Changes happen only in the app.

#### C. Learning mode (Phase 2, grows with every feature)
- A ⓘ icon next to every metric, score and signal. Tapping it shows:
  - **What it is** (1–2 plain sentences).
  - **Why it matters** for a long-term investor.
  - **How to read it** (what's good/bad, typical ranges).
  - **Limitations** (when it misleads).
  - The **current value explained**, e.g. "Weekly RSI is 27: oversold. Historically this stock bounced within 3 months in 4 of the last 6 cases."
- All texts live in one file, `web/glossary.json`, so they're easy to edit and reuse in Telegram `/help` answers.
- Toggle in Settings: "Beginner explanations on/off".
- Rule for Claude Code: **every new metric added to the app must get a glossary entry in the same commit.**

### 13.17 Charts

Library: **TradingView Lightweight Charts** for all custom charts (price, indicators, signals, trades), the **TradingView embed widget** as a "live" tab, and a small chart lib (e.g. Chart.js) for non-price charts (donut, treemap, bars). All charts are touch-friendly, dark mode, and readable at 375px width.

**Ticker page: main price chart**
1. **Signal markers:** icons on dates where the Bottom Score ≥ 4 (green ▲), Top Score ≥ 4 (red ▼), insider buying cluster (👤), earnings (E), and dividend ex-dates (D). Tapping a marker shows what happened afterwards (+3m / +6m / +12m return).
2. **Own trades:** buy (●green) / sell (●red) markers from the transactions table, plus a **dotted average-cost line**, and a shaded profit/loss area between the average cost and the price.
3. **Valuation bands:** price drawn inside bands built from historical P/E (or P/S) percentiles × current EPS/sales: *cheap* (< 20th pct), *fair*, *expensive* (> 80th pct). Toggle on/off.
4. **Support/resistance zones** (6.5), the 200-week MA, the 52-week high/low, and optional Fibonacci levels. Each is a toggle in a compact legend.
5. **Zoom presets:** 1Y · 3Y · 5Y · 10Y · Max. **Log scale** automatically on 5Y+ (toggleable). Default timeframe weekly. Switch to daily/monthly.

**Panels below the price** (stacked, synced)
6. Weekly **RSI** with the 30 and 70 zones shaded.
7. **Volume** with spike bars highlighted (≥ 2× average).
8. **Bottom Score strip:** a thin coloured band over time (grey → yellow → orange → red), with the Top Score strip beneath it.
9. **Drawdown ("underwater") chart:** % below the all-time high over time. Past major bottoms are labelled with depth and recovery time.

**Interaction**
10. **Synced crosshair** across all panels. The tooltip shows date, price, % from ATH, RSI, Bottom/Top Score, and valuation band at that point.
11. Long-press on mobile = crosshair, pinch = zoom, double-tap = reset.
12. Panels and toggles are remembered per device (localStorage, wrapped in try/catch).

**Portfolio charts**
13. **Portfolio vs benchmark** line (TWR-indexed to 100), with a "what if ETF" line and deposit markers.
14. **Treemap** of holdings sized by weight and coloured by today's change (or by Bottom Score, toggle).
15. **Risk budget donut:** core / satellite / speculative / cash vs targets.
16. Allocation donuts (sector, region, currency), dividend income bars by month, and the goal-planner fan chart.

**Performance rule:** charts load the weekly data first (small), and daily data only when zoomed in. Max ~2 seconds to first chart on a phone on 4G.

### 13.18 Trade tools

#### A. Pre-trade checklist & order planner (Phase 3)
Opened from "Can I buy this?" (13.13.5) or the Telegram `/canibuy` link. One screen before any buy:
- ✅/⚠️ checklist: in plan? · Quality ≥ threshold? · thesis written? · earnings within 7 days? · guardrails passed (cooling-off, FOMO, trade limit)? · within sizing cap? · sector/region headroom?
- **Cost preview:** broker fee + TOB + FX conversion cost (from `config/costs.yaml`), shown in € and as % of the order. Warns if total costs > 1% (small orders).
- **Limit price suggestion:** e.g. the current price, nearest support zone, or staged plan level, with the distance in %. The owner chooses.
- **Impact preview:** new weight of the position, sector, region, currency and core/satellite split after the buy, and the change in portfolio volatility.
- "Log this trade" button. When the owner has placed the order at the broker, it records the trade in the transactions table + decision log (reason + emotion tag). **The app never places orders itself.**

#### B. Post-trade review (Phase 3)
- Automatic reminders at **+3 months and +12 months** after each buy/sell (Telegram + a review list in the app).
- The review screen shows: price then vs now, vs the benchmark over the same period, what the signals said at the time, the reason/emotion logged, and whether the thesis rules still hold.
- The owner rates the decision (good process / bad process, separate from good/bad outcome) and adds a lesson line.
- Results feed the monthly signal report (13.10) and the yearly review (13.15 D).

---

## 14. Risks and limitations

- **yfinance is unofficial.** Yahoo can change or block it. Mitigation: wrap it behind `fetch.py` so the source can be swapped (Finnhub/FMP/Alpha Vantage).
- **Free-tier limits** on Finnhub/FMP. Mitigation: caching, batching, fewer calls on weekends.
- **GitHub Actions timing is not exact.** That's fine for daily and 15-min checks, but not for second-level alerts (use Phase 3).
- **EU data is delayed** on free feeds.
- **Supabase free tier limits:** free projects can be paused after a period of inactivity and have storage limits (check the current terms). The daily job writes every weekday, which keeps it active. Store weekly/daily prices compactly, and keep raw intraday data out of the database.
- **Fundamental data quality** (historical P/E) on free sources can be patchy, so show "n/a" rather than wrong numbers.
- **Signals are not predictions.** Stocks can stay "oversold" for months or years (value traps). The backtest view (Phase 4) helps judge usefulness.
- **Not financial advice.** Disclaimer shown in the app footer.

---

## 15. Cost summary

| Setup | Monthly cost |
|---|---|
| Phase 0–2 (public GitHub repo + Actions, Cloudflare Pages, Supabase free tier, free APIs, Telegram) | **€0** |
| Phase 3 (+ VPS for real-time) | ~€4–5 |
| Phase 5, optional: AI features (Claude API) | ~€1–5 |
| Supabase / Cloudflare Worker (portfolio backend) | €0 (free tier) |
| Optional paid data (Polygon / FMP paid) | €15–200, only if ever needed |

---

## 16. Owner decisions (all answered)

1. Which tickers? US only or EU too? → ✅ **US + EU (ticker list still needed)**
2. Telegram or ntfy for alerts? → ✅ **Telegram**
3. Public repo (free unlimited Actions, page is publicly reachable) or private? → ✅ **Public code repo, all personal data private in Supabase (2.1)**
4. Which signals matter most? Should any count double (weights)? → ✅ **Default (equal)**
5. Alert thresholds: −5% daily drop? Score ≥ 4? → ✅ **Yes (−5%, score ≥ 4)**
6. Quiet hours for notifications? → ✅ **No quiet hours**
7. Do you want portfolio/position tracking, or only a watchlist? → ✅ **Full portfolio**
8. Start with Phase 1 only, or Phase 1 + 2 in one go? → ✅ **Phase 1 first**
9. Bottoms/ceilings: what counts as "major"? (default: a move of ≥ 25% away from the level) Show minor levels too? → ✅ **Multi-timeframe real levels (daily/weekly/monthly/yearly), see 6.5**
10. Quality Score: is the proposed mix (Piotroski, Altman Z, debt, FCF, growth, margins, dilution) right, or should some count more? → ✅ **Yes (default weights, debt + ROIC slightly heavier)**
11. Events: add investor days/AGMs manually, or try the AI news scan later? → ✅ **Decide at the end of the build**
12. AI news summaries: OK with a Claude API key and a few euros per month? → ✅ **No for now. All AI features (news summaries, Ask Claude, earnings-call analysis, AI yearly summary) are built LAST, at the end**
13. Portfolio storage: Supabase with login (private, works on all devices), or browser-only to start? → ✅ **Supabase, hardened (see 13.13.2)**
14. Risk profile: conservative / balanced / aggressive? Max loss per position (default 1.5% of portfolio)? → ✅ **Balanced (1.5% max loss per position)**
15. Core–satellite split (default 70/30) and max per single stock (default 5–8%)? Max per sector (default 25%)? → ✅ **Owner sets these in the app (Settings → Risk). Defaults 70/30, 8%/5%, 25% are only starting values**
16. Which brokers do you use (for CSV import)? → ✅ **Bolero (build the Bolero importer first; owner provides an anonymised sample export)**
17. Which "smart money" funds should be followed in the 13F tracker? → ✅ **Default list of 10 funds**
18. Benchmark: MSCI World (EUR) or S&P 500, or both? → ✅ **MSCI World in EUR**
19. Guardrails: which ones on? Max trades per month (default 4)? → ✅ **Default: all guardrails on, max 4 trades/month**
20. Backups: private GitHub repo or your own cloud drive? → ✅ **Default: private GitHub backup repo (encrypted files)**
21. Gap finder: compare against MSCI World weights, or your own target weights per sector/region? → ✅ **MSCI World sector/region weights (owner can override per sector in the app)**
22. Gap finder: which universe to scan (S&P 500 + STOXX 600 by default)? Only UCITS ETFs available at your broker? → ✅ **Default: S&P 500 + STOXX Europe 600; only UCITS ETFs available at Bolero**
23. Goal planner: what's your target amount and date? → ✅ **Owner enters goals later in the app (Goal planner settings)**

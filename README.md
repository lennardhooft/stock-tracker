# Bottom Tracker

A personal web app that scores a stock watchlist for possible long-term bottoms, runs every
weekday night in the cloud, and shows the results on your phone. Costs €0.

> **Not financial advice.** Signals mark things worth researching, not buy calls. The app never
> places orders.

The full plan is in [CLAUDE.md](CLAUDE.md). This README covers setup and daily use.

**Status: Phase 1 (MVP daily score) is built.** Use it for a while before starting Phase 2.

---

## What Phase 1 does

- **Bottom Score** per ticker from 4 signals (1 point each):
  - **T1:** near the 200-week moving average.
  - **T2:** weekly RSI below 30.
  - **T3:** 30%+ below the 52-week high.
  - **S1:** market fear (VIX ≥ 30 or Fear & Greed ≤ 25).
- Every signal shows its raw numbers. Missing data is shown as `n/a`, never as 0.
- **Data sanity checks:** splits, suspicious moves over 40%, stale prices, gaps, GBp/GBP.
- **Pages:**
  - Watchlist dashboard with market strip, filter and search.
  - Ticker page with signal checklist, live TradingView chart, and notes and buy level.
  - Health page.
  - Help page.
- **Daily job** on GitHub Actions at 21:45 UTC on weekdays. It writes to Supabase and commits nothing.

## Privacy model (public repo)

The code is public. Your data is not:

- Watchlist, notes, buy levels and all scores live **only in Supabase**, behind login and row-level security.
- Keys live only in **GitHub Secrets** and **Cloudflare environment variables**.
- Job logs print **counts only**, never tickers or prices.
- Safety nets: `.gitignore`, gitleaks (pre-commit + CI), GitHub push protection.

---

## Phase 0: one-time setup (about 30–45 min)

You need free accounts at GitHub, Supabase and Cloudflare. Do the steps in this order.

### 1. GitHub repository
1. Create a **public** repo (for example `stock-tracker`) and push this folder to it.
2. Go to **Settings → Code security** and turn on **Secret scanning** and **Push protection**.
3. On your computer, install the pre-commit hook once. It blocks commits that contain secrets:

   ```bash
   pip install pre-commit && pre-commit install
   ```

### 2. Supabase (database + login)
1. Create a project and choose region **Central EU (Frankfurt)**. Use a strong database password.
2. Open **SQL Editor**, paste all of [`backend/schema.sql`](backend/schema.sql) and click **Run**.
3. Go to **Authentication → Users → Add user** and create your own user with your email.
4. Go to **Authentication → Sign In / Providers** and switch **Allow new users to sign up** OFF.
5. Go to **Authentication → URL Configuration**. Set **Site URL** to your Cloudflare Pages URL
   (from step 4, e.g. `https://stock-tracker.pages.dev`) and add it under **Redirect URLs**.
6. Go to **Project Settings → API** and note three values:
   - **Project URL**
   - **anon / publishable key** (public, goes to Cloudflare)
   - **service_role / secret key** (SECRET, goes only to GitHub Secrets)
7. Turn on MFA for your Supabase account itself (**Account → Security**).

### 3. GitHub Secrets
Go to **Repo → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value | Needed for |
|---|---|---|
| `SUPABASE_URL` | Project URL | Phase 1 |
| `SUPABASE_SERVICE_KEY` | service_role key | Phase 1 |
| `TELEGRAM_BOT_TOKEN` | from @BotFather | optional now (failure alerts), Phase 2 alerts |
| `TELEGRAM_CHAT_ID` | your chat id | optional now, Phase 2 |
| `FINNHUB_API_KEY` | free key from finnhub.io | Phase 2 |

To make a Telegram bot:
1. In Telegram, message **@BotFather**, send `/newbot`, and copy the token.
2. Send any message to your new bot.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.

### 4. Cloudflare Pages (hosting)
1. Go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
2. Use these build settings:
   - Framework preset: **None**
   - Build command: `sh scripts/build_web.sh`
   - Build output directory: `web`
3. Add **Environment variables**:
   - `SUPABASE_URL`: the Project URL
   - `SUPABASE_ANON_KEY`: the anon/publishable key (never the service key)
4. Deploy, then put the `*.pages.dev` URL into Supabase (step 2.5).

### 5. Cloudflare Access (lock the site)
1. Go to **Zero Trust → Access → Applications → Add → Self-hosted**.
2. Set the domain to your `stock-tracker.pages.dev`. Add a second entry for `*.stock-tracker.pages.dev`, which covers preview builds.
3. Add a policy: **Allow** → **Emails** → your email.

Now only you can even open the login page. The app itself also requires the Supabase email login.

### 6. First run
1. Open the site, log in with the email link, and add tickers with **Add a ticker**.
   - Use Yahoo symbols: `AAPL`, `ASML.AS`, `IWDA.AS`, `SOLB.BR`, `SAP.DE`.
2. Go to GitHub → **Actions → daily → Run workflow**.
3. After about 1–2 minutes, refresh the app. Scores appear, and **Health** shows the run.

From then on it runs automatically every weekday night. If a run fails, GitHub emails you, and Telegram tells you too if it's set up.

### 7. Optional: check that the database is locked
On your computer, set the two values and run the row-level security test:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... pytest tests/test_rls.py -q
```

All tests must pass. They confirm that an anonymous visitor gets 0 rows from every table.

---

## Local development

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
```

Run the tests:

```bash
pytest -q
```

Run the linter:

```bash
ruff check . && ruff format .
```

Run the daily job without Supabase. It uses the example watchlist and writes to `out/`:

```bash
python -m src.run_daily --local
```

Preview the app with FAKE fixture data (demo mode, no login) at http://localhost:8000.
Add `?fixture=empty` (or `calm`, `stale`, `failed`, `partial`, `error`, `offline`, `new`, `login`) to see each state:

```bash
sh scripts/preview_local.sh
```

UI checks (CLAUDE.md 8.11): screenshots of every screen and state at 375/768/1280 px in both themes,
axe-core accessibility, tap targets, overflow, untranslated text and the task walkthroughs.
Screenshots land in `docs/screenshots/` (gitignored):

```bash
npm ci && npx playwright install chromium
npx playwright test
```

The style guide (every component in every state) is at `/styleguide.html`, and the screen specs are in `docs/screens/`.

Set `LOCAL_DEBUG=1` to see tickers and scores in the local logs. **Never set it in GitHub.**

## Project layout (Phase 1)

```
backend/schema.sql     Supabase tables + row-level security
config/scoring.yaml    signal thresholds, weights, labels, data-check limits
src/indicators.py      SMA, Wilder RSI, weekly resample, drawdown, percentile (pure, tested)
src/data_checks.py     sanity checks (splits, suspect moves, stale, gaps, GBp)
src/score.py           T1, T2, T3, S1 + Bottom Score
src/fetch.py           yfinance + CNN Fear & Greed, with retries and timeouts
src/storage.py         Supabase REST writer + local JSON store
src/run_daily.py       daily job entrypoint
web/                   static app (index.html, app.js, style.css, glossary.json)
.github/workflows/     daily job, CI (ruff, pytest, gitleaks), keepalive
```

## Decisions made while building Phase 1

- **No `actions/cache` for price data.** On a public repo, workflows from forked pull requests can restore caches, which would reveal the watchlist. Ten years of daily data per ticker downloads in seconds, so the job fetches it fresh each night.
- **Score snapshots are already saved** (`score_history`). The chart for them is Phase 2, but history can't be collected after the fact, so collection starts now.
- **Login = Supabase email link + Cloudflare Access.** The authenticator-app MFA from 13.13.2 is planned together with the portfolio data in Phase 3. Cloudflare Access already blocks everyone else from the site.
- Config files for later phases (`alerts.yaml`, `risk.yaml`, …) will be added with the phase that uses them.

## Supabase Edge Functions

Deployed from the Supabase dashboard (Edge Functions → Deploy a new function → paste the file).
All have **Verify JWT turned off**; they do their own checks.

| Function | File | What it does | Secrets |
|---|---|---|---|
| `run-update` | `backend/functions/run-update/index.ts` | "Update now" button: checks the login, starts the daily workflow on GitHub | `GITHUB_TOKEN` (fine-grained, this repo, Actions: read and write) |
| `calendar-ics` | `backend/functions/calendar-ics/index.ts` | Private calendar feed (`?token=…`) for the phone calendar: earnings, dividends, Fed/ECB dates | none (uses the injected anon key + `calendar_feed()` in `backend/schema.sql`) |
| `quotes` | `backend/functions/quotes/index.ts` | Live prices for the Portfolio page (login required) | none |
| `lookup-symbols` | `backend/functions/lookup-symbols/index.ts` | Bolero importer: ISIN / name / market → Yahoo ticker (login required) | none |

Fed/ECB dates live in `config/macro_events.yaml`; update them once a year from the official calendars.

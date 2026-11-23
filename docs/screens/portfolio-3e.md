# Phase 3E — encrypted backups and Telegram bot commands (CLAUDE.md 13.14 E, 13.16 B)

## Backups
**What's backed up:** everything you typed in yourself — watchlist (levels, notes, tags), transactions (with
reasons and feelings), cash settings, risk settings + their log, theses, waiting decisions, reviews.
Scores, charts and returns are not: the nightly job rebuilds them.

**Format** (`*.json.enc`): JSON `{format: "bottom-tracker-backup", v: 1, kdf: "pbkdf2-sha256", iter, salt, iv, ct}`,
AES-256-GCM with a key from your passphrase (PBKDF2-SHA256, 600 000 rounds). Without the passphrase the file is
unreadable; lose the passphrase and the backup is lost too. The browser export and the weekly job use the same
format, and `python -m src.backup restore FILE` reads both.

1. **Weekly** (Sunday 03:00 UTC, GitHub Actions `backup.yml`): reads the tables with the service key, encrypts with
   the `BACKUP_PASSPHRASE` secret and commits `backups/YYYY-MM-DD.json.enc` to the **private** repo named in the
   `BACKUP_REPO` secret, using `BACKUP_REPO_TOKEN` (a fine-grained token for that one repo, Contents read/write).
   Not set up yet → the job says "not configured" and does nothing. The public log shows counts only.
   The result is written to `job_runs` (job `backup`), so the Health page shows the last backup.
2. **Export everything** — Settings → Data & backups: type a passphrase (twice, at least 12 characters) →
   the file is encrypted on your device and downloaded. Needs the two-step login (money data).
3. **Restore** (on a computer): `python -m src.backup restore FILE` shows what's inside (counts per table);
   `--apply` writes it back into Supabase (upsert, nothing is deleted). Tested in `tests/test_backup.py`
   (round trip + browser-format file) and once by hand during setup.

## Telegram bot — read-only, owner only
A Supabase Edge Function `telegram-bot` is the bot's webhook. Telegram signs each call with a secret
(derived from the bot token), and the function answers **only** messages from your chat ID. It can't change
anything. Answers are short with a link to the full page.

| Command | Answer |
|---|---|
| `/score NVDA` | Bottom, Top, Quality, moat, verdict, signals that fired |
| `/portfolio` | value, today's change, result since bought, cash, risk budget |
| `/canibuy ASML 2000` | sizing result: up to €…, room, limiting rule, fits or not |
| `/events` (week) | earnings, dividends and Fed/ECB in the next 7 days |
| `/levels NVDA` | nearest support and resistance |
| `/thesis NVDA` | thesis status and each rule |
| `/news NVDA` | latest headlines |
| `/health` | last update, sources that failed |
| `/gaps` | "comes with the gap finder (Phase 4)" |
| `/help` | the list |

The bot reuses the app's tested code (`web/lib/portfolio.js`, `sizing.js`, `risk-defaults.js`, `thesis.js`):
`scripts/build_bot.py` bundles them with `backend/functions/telegram-bot/core.js` into the function's `index.ts`.

**Setup (owner):** Supabase → Edge Functions → Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (same values as
the GitHub secrets). Then run the `telegram-webhook` workflow once: it registers the webhook and the command menu.

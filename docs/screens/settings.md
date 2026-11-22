# Settings (basic, Phase 1) — `#/more/settings`

**Main question:** "How do I make the app work the way I like?"
**Primary action:** none (settings save immediately with a "Saved" toast).

## Sections
1. **Display**
   - Theme: segmented *Dark · Light · Match phone*. Default **Dark**.
   - Language: segmented *English · Nederlands*. Default **English**.
   - Number format: segmented *Belgian (€ 1.234,56) · English (€1,234.56)*. Default **Belgian**.
   - Beginner explanations (ⓘ on every metric): toggle, default on.
2. **Account & security**
   - Logged in as *email*. **Log out**.
   - Short explanation: "Your data is private: only your account can read it."
3. **Data**
   - Link to **Data health**.
   - "Scores update every weekday at about 22:45 (Brussels time)."
4. **About**
   - What the app does in one sentence, the disclaimer ("not financial advice"), version.
   - **Show the welcome tour again**.

Every setting shows a one-line explanation of its effect and its default value.
Display settings are stored on this device (localStorage, wrapped in try/catch) in Phase 1; they move to Supabase with the other settings in Phase 3.

## States
Settings never block: if storage is unavailable, choices still apply for this visit and a small note says "Couldn't save on this device."

## Acceptance
- [ ] Changing theme/language/number format applies instantly without a reload.
- [ ] All labels and explanations come from `web/i18n/`.
- [ ] Works at 375 / 768 / 1280 px in both themes; axe 0 serious.

## Phase 3A additions

### Account & security → Two-step login (CLAUDE.md 13.13.2)
- Status line: "Two-step login is **on** / **off**".
- **Set up**: shows a QR code + the secret in text (for copy) → "Scan it with an authenticator app (Google Authenticator,
  Microsoft Authenticator, 1Password…), then type the 6-digit code." → **Turn on**. Wrong code: inline error, stays open.
- After it's on, every login asks for the 6-digit code after the password (screen: "Enter the code from your authenticator app").
- Portfolio data needs it (enforced by the database). Removing it is not offered in the app (do it in Supabase if a phone is lost).

### Risk → `#/more/risk` (CLAUDE.md 13.13.4b)
- **Profile** segmented: Conservative · Balanced · Aggressive · Custom (changing a number switches to Custom).
- Grouped number inputs (decimal keyboard), each with a one-line effect + default:
  max loss per position %, volatility factor k; core / satellite / speculative split, cash reserve %;
  max weight per asset type (sector ETF, quality stock, other stock, speculative each + total); max per sector, max per region;
  quality multipliers (high / medium / low), verdict multipliers (on sale / value trap).
- **Live preview** at the top: "With these settings, NVDA's max becomes € 1.250" (first holding or NVDA-like example).
- **Save** (stored in Supabase `risk_settings`, every change also logged with the date in `risk_settings_log`) and **Reset to defaults**.

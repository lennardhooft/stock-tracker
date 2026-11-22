# Onboarding (first run) — `#/welcome`

**Main question:** "What is this app and how do I start?"
**Primary action:** the one button per step (**Next**, **Add these stocks**, **Done**).

Shown once after the first login (remembered on the device), skippable on every step, reopenable from Settings.

## Steps (Phase 1)
1. **What it does** — one sentence: "Bottom Tracker checks your stocks every night and tells you when one may be near a long-term bottom. It's a research tool, not advice." Small illustration of a score badge. **Next**
2. **Add your first stocks** — the add-stock input + a few suggestions as tappable chips (e.g. a world ETF like IWDA.AS, some large US and EU stocks). Selected chips get a ✓. **Add these stocks** (disabled until at least one is chosen) or **Skip for now**.
3. **How to read the score** — the 4 score levels as badges with one line each, and "Tap any score to see why." **Done** → Today.

Steps for later phases (added then, not shown now): connect Telegram (Phase 2), import from Bolero (Phase 3).

## States
- Progress dots "Step 2 of 3" (also as text for screen readers).
- Adding stocks fails → inline error on step 2, choices kept, **Try again**.

## Acceptance
- [ ] Each step fits on a 375 × 667 screen without scrolling.
- [ ] **Skip** visible on every step; back gesture goes to the previous step.
- [ ] Suggestions are clearly labelled as examples, not recommendations.

/* Per-device preferences (Phase 1). Moves to Supabase with the other settings in Phase 3.
 * Every storage access is wrapped: in a private window storage can throw, and the app must still work. */
const KEY = "bt.prefs.v1";

export const DEFAULTS = {
  theme: "dark",        // dark | light | system
  lang: "en",           // en | nl
  numfmt: "nl-BE",      // nl-BE | en
  explain: true,        // show ⓘ glossary buttons
  sort: "score",        // score | change | high | name
  minScore: 0,
  market: "all",
  verdict: "all",       // all | sale | check | trap
  tags: [],             // show stocks with any of these tags        // all | US | EU
  onboarded: false,
  chartShow: { zones: true, ma: true, markers: true, range52: false, valuation: true },
  chartPanels: { score: true, rsi: true, volume: false, drawdown: false },
};

let prefs = { ...DEFAULTS };
let storageOk = true;

export function loadPrefs() {
  try {
    prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    storageOk = false;
    prefs = { ...DEFAULTS };
  }
  return prefs;
}

export function prefsGet() {
  return prefs;
}

/** Update preferences. Returns false if they could not be stored on this device. */
export function prefsSet(patch) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
    storageOk = true;
  } catch {
    storageOk = false;
  }
  return storageOk;
}

export function resolvedTheme(theme = prefs.theme) {
  if (theme !== "system") return theme;
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "light" ? "#f5f6f8" : "#0f1115";
}

/* ---- small cache of the last loaded data, for instant reopen and offline (8.6, 8.8) ---- */
const CACHE = "bt.cache.v1";

export function cacheSave(data) {
  try {
    localStorage.setItem(CACHE, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch { /* storage full or blocked: not critical */ }
}

export function cacheLoad() {
  try {
    return JSON.parse(localStorage.getItem(CACHE) || "null");
  } catch {
    return null;
  }
}

export function cacheClear() {
  try { localStorage.removeItem(CACHE); } catch { /* ignore */ }
}

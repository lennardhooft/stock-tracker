/* UI text lookup (CLAUDE.md 8.4). All strings live in web/i18n/<lang>.json.
 * t("score.label.strong") → "Strong"; placeholders: t("time.minAgo", {n: 12}).
 * Missing keys fall back to English, then to the key itself (visible, so it gets fixed).
 */
let strings = {};
let fallback = {};
let current = "en";

async function load(lang, base) {
  const res = await fetch(new URL(`i18n/${lang}.json`, base), { cache: "no-cache" });
  if (!res.ok) throw new Error(`i18n ${lang}: ${res.status}`);
  return res.json();
}

/** Load a language. `base` is the URL of the web root (default: document base). */
export async function initI18n(lang = "en", base = document.baseURI) {
  fallback = await load("en", base);
  strings = lang === "en" ? fallback : await load(lang, base).catch(() => fallback);
  current = lang;
  document.documentElement.lang = lang;
}

export function lang() {
  return current;
}

function lookup(dict, key) {
  return key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
}

export function t(key, vars = {}) {
  let s = lookup(strings, key) ?? lookup(fallback, key) ?? key;
  if (typeof s !== "string") return key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

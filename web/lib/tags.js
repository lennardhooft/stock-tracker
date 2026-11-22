/* Watchlist tags (CLAUDE.md 13.6): suggestions, validation, the tags in use. */
export const TAG_SUGGESTIONS = ["core", "speculative", "wait-for-dip"];
export const MAX_TAGS = 8;

/** "Wait for dip " → "wait-for-dip"; returns "" when it isn't a valid tag. */
export function normalizeTag(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "-");
  return /^[a-z0-9][a-z0-9-]{0,19}$/.test(s) ? s : "";
}

/** Suggestions first, then every other tag used on the watchlist, A–Z. */
export function tagsInUse(rows) {
  const used = new Set(rows.flatMap((r) => r.tags || []));
  const extra = [...used].filter((x) => !TAG_SUGGESTIONS.includes(x)).sort();
  return [...TAG_SUGGESTIONS.filter((x) => used.has(x)), ...extra];
}

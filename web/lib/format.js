/* One shared formatter for every number, change and time in the UI (CLAUDE.md 8.4).
 * Default locale nl-BE ("€ 1.234,56", "12,5 %"); "en" gives English formatting.
 * Times are always shown in Europe/Brussels.
 */
import { t } from "./i18n.js";

const TZ = "Europe/Brussels";
const NNBSP = " "; // narrow no-break space between number and %
const MINUS = "−";

let locale = "nl-BE";

export function setNumberLocale(next) {
  locale = next === "en" ? "en-GB" : "nl-BE";
}
export function getNumberLocale() {
  return locale;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Plain number with fixed decimals. */
export function num(v, decimals = 2) {
  if (!isNum(v)) return t("common.na");
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
    .format(v)
    .replace("-", MINUS);
}

/** Money: "€ 1.234,56" / "$ 342,56". Large values abbreviated with compact=true. */
export function money(v, currency = "EUR", { decimals = 2, compact = false } = {}) {
  if (!isNum(v)) return t("common.na");
  const opts = { style: "currency", currency, currencyDisplay: "narrowSymbol" };
  if (compact && Math.abs(v) >= 1e6) {
    Object.assign(opts, { notation: "compact", maximumFractionDigits: 1 });
  } else {
    Object.assign(opts, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  try {
    return new Intl.NumberFormat(locale, opts).format(v).replace("-", MINUS);
  } catch {
    return `${currency} ${num(v, decimals)}`;
  }
}

/** Percentage of a value already in percent units: 12.5 → "12,5 %". */
export function pct(v, decimals = 1) {
  if (!isNum(v)) return t("common.na");
  return `${num(v, decimals)}${NNBSP}%`;
}

/** Signed change with direction icon and word for screen readers.
 * Returns {text, dir, label}: text "▲ +2,3 %", dir "up"|"down"|"flat". */
export function change(v, decimals = 1) {
  if (!isNum(v)) return { text: t("common.na"), dir: "flat", label: t("common.na") };
  const rounded = Number(v.toFixed(decimals));
  const dir = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
  const icon = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  const sign = dir === "up" ? "+" : dir === "down" ? MINUS : "";
  const body = `${sign}${num(Math.abs(rounded), decimals)}${NNBSP}%`;
  return { text: `${icon} ${body}`, dir, label: `${t(`change.${dir}`)} ${body}` };
}

/** Absolute date-time in Brussels: "22 nov. 2026, 22:47". */
export function dateTime(iso) {
  if (!iso) return t("common.never");
  return new Intl.DateTimeFormat(locale, {
    timeZone: TZ, dateStyle: "medium", timeStyle: "short",
  }).format(new Date(iso));
}

export function date(iso, opts = null) {
  if (!iso) return t("common.na");
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, ...(opts || { dateStyle: "medium" }) }).format(
    new Date(iso),
  );
}

function clock(d) {
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
    .format(d);
}

function brusselsDay(d) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
}

/** Relative time: "just now", "12 min ago", "today 14:02", "yesterday 22:47", else a date. */
export function relativeTime(iso, now = new Date()) {
  if (!iso) return t("common.never");
  const d = new Date(iso);
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return t("time.justNow");
  if (mins < 60) return t("time.minAgo", { n: mins });
  const today = brusselsDay(now);
  const yesterday = brusselsDay(new Date(now.getTime() - 864e5));
  if (brusselsDay(d) === today) return t("time.today", { time: clock(d) });
  if (brusselsDay(d) === yesterday) return t("time.yesterday", { time: clock(d) });
  return dateTime(iso);
}

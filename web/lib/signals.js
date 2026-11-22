/* Plain-language texts built from the raw signal values the daily job stores (8.4, 8.10).
 * The job stores numbers; the UI turns them into sentences in the owner's language and format. */
import { t } from "./i18n.js";
import * as fmt from "./format.js";

/** Mirrors config/scoring.yaml → alert_threshold. */
export const ALERT_THRESHOLD = 4;

export const GLOSSARY_KEY = {
  T1: "near_200w_ma",
  T2: "weekly_rsi",
  T3: "drawdown",
  S1: "market_fear",
};

const num = (v, d = 1) => fmt.num(v, d);

/** {name, detail} for one stored signal. */
export function describeSignal(sig, currency = "EUR") {
  const name = t(`sig.${sig.code}.name`);
  const v = sig.value;
  if (sig.passed === null || v == null) {
    return { name, detail: t(`sig.${sig.code}.na`) };
  }
  switch (sig.code) {
    case "T1": {
      const diff = v.pct_vs_sma;
      const key = diff >= 0 ? "sig.T1.above" : "sig.T1.below";
      return { name, detail: t(key, {
        pct: fmt.pct(Math.abs(diff)), sma: fmt.money(v.sma, currency), limit: "+5 %",
      }) };
    }
    case "T2":
      return { name, detail: t("sig.T2.detail", { rsi: num(v), limit: num(sig.threshold, 0) }) };
    case "T3":
      return { name, detail: t("sig.T3.detail", {
        pct: fmt.pct(v.pct), high: fmt.money(v.high, currency), limit: fmt.pct(sig.threshold, 0),
      }) };
    case "S1": {
      const parts = [];
      parts.push(v.vix != null ? `VIX ${num(v.vix)}` : `VIX ${t("common.na")}`);
      parts.push(v.fear_greed != null ? `Fear & Greed ${num(v.fear_greed, 0)}` : `Fear & Greed ${t("common.na")}`);
      return { name, detail: t("sig.S1.detail", { values: parts.join(" · ") }) };
    }
    default:
      return { name: sig.name || sig.code, detail: sig.detail || "" };
  }
}

/** One sentence explaining a score: "Strong bottom signals: price is near …, and RSI is oversold." */
export function explainScore(row) {
  if (!row || row.score == null) return "";
  const fired = (row.signals || []).filter((s) => s.passed === true).map((s) => t(`sig.${s.code}.short`));
  const label = t(`score.labelLong.${row.label || "normal"}`);
  if (!fired.length) return t("explain.none");
  return t("explain.withSignals", { label, list: joinList(fired) });
}

function joinList(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} ${t("explain.and")} ${items[items.length - 1]}`;
}

/** Market mood word from Fear & Greed (preferred) or VIX. Returns {key, tone}. */
export function marketMood(market) {
  const fg = market?.fear_greed?.value;
  if (typeof fg === "number") {
    if (fg <= 25) return { key: "extremeFear", tone: "negative" };
    if (fg <= 45) return { key: "fear", tone: "warning" };
    if (fg <= 55) return { key: "neutral", tone: "text-2" };
    if (fg <= 75) return { key: "greed", tone: "positive" };
    return { key: "extremeGreed", tone: "positive" };
  }
  const vix = market?.vix?.value;
  if (typeof vix === "number") return vixWord(vix);
  return { key: "unknown", tone: "muted" };
}

export function vixWord(vix) {
  if (vix >= 40) return { key: "panic", tone: "negative" };
  if (vix >= 30) return { key: "fear", tone: "warning" };
  if (vix >= 20) return { key: "nervous", tone: "warning" };
  return { key: "calm", tone: "positive" };
}

/* ---------------- data freshness (8.4) ---------------- */

/** Expected time of the latest daily run (≈22:30 UTC on weekdays) before `now`. */
export function lastExpectedRun(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 30));
  while (d > now || d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** "fresh" | "stale" | "failed" from the latest score update and the last job run. */
export function freshness(latestUpdate, lastRun, now = new Date()) {
  if (lastRun?.status === "failed") return "failed";
  if (!latestUpdate) return "stale";
  const grace = 2 * 3600e3; // scheduled runs can lag
  return new Date(latestUpdate) < new Date(lastExpectedRun(now) - grace) ? "stale" : "fresh";
}

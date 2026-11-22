/* Plain-language texts built from the raw signal values the daily job stores (8.4, 8.10).
 * The job stores numbers; the UI turns them into sentences in the owner's language and format. */
import { t } from "./i18n.js";
import * as fmt from "./format.js";

/** Mirrors config/scoring.yaml → alert_threshold. */
export const ALERT_THRESHOLD = 4;

export const GLOSSARY_KEY = {
  V1: "valuation_pct",
  V2: "insider_buying",
  T4: "support_resistance",
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
  if (sig.code === "V1" && sig.passed === null && v?.years != null) {
    return { name, detail: t("sig.V1.short_history", { years: num(v.years, 1) }) };
  }
  if (sig.code === "V2" && sig.passed === null) {
    return { name, detail: t(v?.na === "eu" ? "sig.V2.naEu" : v?.na === "no_key" ? "sig.V2.naKey" : "sig.V2.na") };
  }
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
    case "V1":
      return { name, detail: t("sig.V1.detail", {
        metric: v.metric === "ps" ? "P/S" : "P/E", now: num(v.now, 1),
        cheaper: fmt.pct(100 - v.pct, 0), years: num(v.years, 0), limit: fmt.pct(100 - sig.threshold, 0),
      }) };
    case "V2": {
      const usd = (x) => fmt.money(Math.abs(x), "USD", { compact: true });
      const key = v.net_value > 0 ? "sig.V2.bought" : v.net_value < 0 ? "sig.V2.sold" : "sig.V2.none";
      return { name, detail: t(key, { value: usd(v.net_value), days: v.days, buys: v.buys, sells: v.sells }) };
    }
    case "T4":
      return { name, detail: t("sig.T4.detail", {
        range: `${fmt.money(v.low, currency)}–${fmt.money(v.high, currency)}`, dist: fmt.pct(Math.abs(v.distance_pct)),
        limit: fmt.pct(sig.threshold, 0), n: v.touches,
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

/* ---------------- support / resistance in words (6.5) ---------------- */

const TF_KEYS = { Y: "yearly", M: "monthly", W: "weekly", D: "daily" };

function joinWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${t("explain.and")} ${items[items.length - 1]}`;
}

/** {title, detail} sentences for one zone, e.g. "Support at $105–110, 6 % below". */
export function describeZone(z, currency) {
  const range = Math.abs(z.high / z.low - 1) < 0.005
    ? fmt.money(z.low, currency)
    : `${fmt.money(z.low, currency)}–${fmt.money(z.high, currency)}`;
  const dist = fmt.pct(Math.abs(z.distance_pct));
  const title = z.distance_pct === 0
    ? t(`levels.inside.${z.role}`, { range })
    : t(`levels.${z.role}Line`, { range, dist });
  const kindKey = z.lows >= z.highs ? "bottoms" : "ceilings";
  const parts = [t(`levels.${kindKey}`, { n: z.touches, years: z.years.slice(-4).join(", ") })];
  parts.push(t("levels.seenOn", { tfs: joinWords(z.tfs.map((x) => t(`levels.tf.${TF_KEYS[x]}`))) }));
  if (z.flipped) parts.push(t(z.role === "support" ? "levels.flippedSupport" : "levels.flippedResistance"));
  return { title, detail: parts.join(" · ") };
}

/* ---------------- Phase 2E: quality, verdict, Top Score (13.1, 13.14 A, 13.16 A) ---------------- */

export const QUALITY_GLOSSARY = {
  piotroski: "piotroski", altman: "altman_z", debt: "debt_quality", fcf: "fcf_quality",
  growth: "growth_quality", margins: "margins_quality", dilution: "dilution", roic: "moat",
};
export const TOP_GLOSSARY = {
  U1: "far_above_trend", U2: "weekly_rsi_high", U3: "expensive", U4: "insider_selling", U5: "euphoria", U6: "near_resistance",
};

/** good | ok | weak | na for a quality part's 0..1 sub-score. */
export function partState(p) {
  if (p?.score == null) return "na";
  return p.score >= 0.67 ? "good" : p.score >= 0.34 ? "ok" : "weak";
}

const pct1 = (x, d = 1) => fmt.pct(x * 100, d);

/** {name, detail} for one quality part (src/quality.py). */
export function describeQualityPart(p) {
  const name = t(`quality.part.${p.key}.name`);
  const v = p.value || {};
  if (p.score == null) return { name, detail: t(`quality.partNa.${p.na}`) || t("common.na") };
  switch (p.key) {
    case "piotroski": return { name, detail: t("quality.part.piotroski.detail", { f: v.f, n: v.n }) };
    case "altman": return { name, detail: t(`quality.part.altman.${v.zone}`, { z: fmt.num(v.z, 1) }) };
    case "debt": {
      const cover = v.coverage != null ? t("quality.part.debt.cover", { c: fmt.num(v.coverage, 1) }) : "";
      if (v.net_cash) return { name, detail: t("quality.part.debt.netCash", { cover }) };
      if (v.nd_ebitda == null) return { name, detail: t("quality.part.debt.noEbitda") };
      return { name, detail: t("quality.part.debt.detail", { x: fmt.num(v.nd_ebitda, 1), cover }) };
    }
    case "fcf": return { name, detail: t("quality.part.fcf.detail", { pos: v.positive, n: v.n }) };
    case "growth": return { name, detail: t(`quality.part.growth.${v.cagr < 0 ? "shrank" : "grew"}`, { pct: pct1(Math.abs(v.cagr)), years: v.years }) };
    case "margins": return { name, detail: t("quality.part.margins.detail", {
      now: pct1(v.now), avg: pct1(v.avg), diff: `${v.diff_pts >= 0 ? "+" : "−"}${fmt.num(Math.abs(v.diff_pts), 1)}`,
    }) };
    case "dilution": {
      const k = Math.abs(v.per_year) < 0.002 ? "flat" : v.per_year > 0 ? "up" : "down";
      return { name, detail: t(`quality.part.dilution.${k}`, { pct: pct1(Math.abs(v.per_year)) }) };
    }
    case "roic":
      return v.metric === "roe"
        ? { name, detail: t("quality.part.roic.roe", { avg: pct1(v.avg), n: v.n }) }
        : { name, detail: t("quality.part.roic.detail", { avg: pct1(v.avg, 0), wacc: pct1(v.wacc), above: v.above_wacc, n: v.n }) };
    default: return { name: p.key, detail: "" };
  }
}

/** One sentence for the verdict, or "" for "none" (the score sentence is enough then). */
export function verdictSentence(row) {
  const v = row?.verdict;
  if (!v || v === "none") return "";
  const q = row.quality?.score;
  if (v === "sale") return t("verdictLine.sale", { score: fmt.num(row.score, 0), max: fmt.num(row.max_score, 0), q });
  if (v === "check") return q == null ? t("verdictLine.checkNoData") : t("verdictLine.check", { q });
  const weak = (row.quality?.weak || []).map((k) => t(`quality.weak.${k}`));
  return t("verdictLine.trap", { q, weak: weak.length ? t("verdictLine.weakList", { list: joinList(weak) }) : "" });
}

/** {name, detail} for one Top signal (src/top_score.py). */
export function describeTop(sig, currency = "EUR") {
  const name = t(`top.${sig.code}.name`);
  const v = sig.value;
  if (sig.code === "U4" && sig.passed === null) return { name, detail: t(v?.na === "eu" ? "top.U4.naEu" : "top.U4.na") };
  if (sig.code === "U6" && sig.passed === false && !v) return { name, detail: t("top.U6.none") };
  if (sig.passed === null || v == null) return { name, detail: t(`top.${sig.code}.na`) };
  switch (sig.code) {
    case "U1": return { name, detail: t("top.U1.detail", { ratio: fmt.num(v.ratio, 2), limit: fmt.num(sig.threshold, 1) }) };
    case "U2": return { name, detail: t(v.extreme ? "top.U2.extreme" : "top.U2.detail", { rsi: fmt.num(v.rsi, 1), limit: fmt.num(sig.threshold, 0) }) };
    case "U3": return { name, detail: t("top.U3.detail", {
      metric: v.metric === "ps" ? "P/S" : "P/E", now: fmt.num(v.now, 1), pct: fmt.pct(v.pct, 0), years: fmt.num(v.years, 0), limit: fmt.pct(sig.threshold, 0),
    }) };
    case "U4": if (!v.net_sell) return { name, detail: t("top.U4.noSell", { days: v.days }) };
      return { name, detail: t("top.U4.detail", {
      value: fmt.money(v.net_sell, "USD", { compact: true }), days: v.days, pct: fmt.pct(v.pct_of_mcap, 2), limit: fmt.pct(sig.threshold, 2),
    }) };
    case "U5": return { name, detail: t("top.U5.detail", { fg: fmt.num(v.fear_greed, 0), limit: fmt.num(sig.threshold, 0) }) };
    case "U6": return { name, detail: t("top.U6.detail", {
      range: `${fmt.money(v.low, currency)}–${fmt.money(v.high, currency)}`, dist: fmt.pct(Math.abs(v.distance_pct)), limit: fmt.pct(sig.threshold, 0),
    }) };
    default: return { name: sig.name || sig.code, detail: sig.detail || "" };
  }
}

/** Lead line for the Top card: "No signs of overheating." / "2 of 6 overheating signs: …". */
export function topSummary(top) {
  const fired = (top?.signals || []).filter((s) => s.passed === true);
  if (!fired.length) return t("top.none");
  return t("top.some", { n: fired.length, max: fmt.num(top.max_score, 0), list: joinList(fired.map((s) => t(`top.${s.code}.short`))) });
}

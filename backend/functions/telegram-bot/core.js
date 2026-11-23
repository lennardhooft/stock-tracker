/* Telegram bot commands (CLAUDE.md 13.16 B) — pure: text in, data in, reply text out.
 * Read-only: no command can change anything. Reuses the app's tested portfolio, sizing and thesis code.
 * Tested in tests/js/bot.test.mjs; bundled into index.ts by scripts/build_bot.py. */
import { valuePortfolio } from "../../../web/lib/portfolio.js";
import { sizeFor } from "../../../web/lib/sizing.js";
import { settingsFor } from "../../../web/lib/risk-defaults.js";
import { evaluate, status as thesisStatus } from "../../../web/lib/thesis.js";

export const COMMANDS = [
  ["score", "Bottom, Top, Quality and verdict for a ticker"],
  ["portfolio", "Value, today, result, cash and risk budget"],
  ["canibuy", "How much fits your rules, e.g. /canibuy ASML.AS 2000"],
  ["events", "Earnings, dividends and Fed/ECB in the next 7 days"],
  ["levels", "Nearest support and resistance for a ticker"],
  ["thesis", "Thesis status and rules for a holding"],
  ["news", "Latest headlines for a ticker"],
  ["health", "Is the data up to date?"],
  ["gaps", "Portfolio gaps (comes later)"],
  ["help", "This list"],
];
const NEEDS = {
  score: ["rows"], portfolio: ["rows", "pf", "market"], canibuy: ["rows", "pf", "market"], events: ["rows", "macro"],
  levels: ["rows", "detail"], thesis: ["rows", "pf"], news: ["rows", "detail"], health: ["runs"], gaps: [], help: [],
};
export const needs = (cmd) => NEEDS[cmd] || [];

/** "/canibuy@MyBot asml.as 2.000" → {cmd: "canibuy", args: ["ASML.AS", "2.000"]} */
export function parseCommand(text) {
  const m = String(text || "").trim().match(/^\/([a-z_]+)(?:@\w+)?\s*(.*)$/i);
  if (!m) return { cmd: "help", args: [] };
  const cmd = m[1].toLowerCase();
  const args = m[2].split(/\s+/).filter(Boolean).map((a, i) => (i === 0 ? a.toUpperCase() : a));
  return { cmd: NEEDS[cmd] ? cmd : "unknown", args, raw: m[1] };
}

/* ---------------------------------------------------------------- formatting (nl-BE) */
const nf = (d) => new Intl.NumberFormat("nl-BE", { minimumFractionDigits: d, maximumFractionDigits: d });
const num = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? "n/a" : nf(d).format(v));
const money = (v, cur = "EUR", d = 0) => (v == null ? "n/a" : `${{ EUR: "€", USD: "$", GBP: "£" }[cur] || `${cur} `}${cur in { EUR: 1, USD: 1, GBP: 1 } ? " " : ""}${num(v, d)}`);
const pct = (v, d = 1) => (v == null ? "n/a" : `${num(v, d)} %`);
const signed = (v, d = 1) => (v == null ? "n/a" : `${v >= 0 ? "▲ +" : "▼ −"}${num(Math.abs(v), d)} %`);
const smart = (v) => num(v, v != null && Number.isInteger(Number(v)) ? 0 : 1);
const signedEur = (v) => `${v >= 0 ? "+" : "−"}${money(Math.abs(v))}`;
/** "2.000" (Belgian) or "2000" or "2,5" → number */
export const parseAmount = (s) => {
  const t = String(s || "").replace(/[€\s]/g, "");
  if (!t) return NaN;
  return Number(/,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t);
};
const link = (app, path) => `▶ ${app.replace(/\/$/, "")}/#/${path}`;
const LABEL = { normal: "Normal", watch: "Watch", strong: "Strong", extreme: "Extreme" };
const VERDICT = { sale: "🟢 Quality on sale", check: "🟡 Check fundamentals", trap: "🔴 Possible value trap", none: "⚪ Not at a bottom" };
const RULE = {
  risk: "max loss per position", typeCap: "cap for this asset type", sector: "sector maximum", region: "region maximum",
  satellite: "satellite maximum", speculative: "speculative maximum", cash: "your cash minus the reserve",
};
const SIGNAL = {
  T1: "near its 200-week average", T2: "weekly RSI oversold", T3: "≥ 30 % below its high", T4: "near a major previous bottom",
  V1: "cheap vs its own history", V2: "insiders buying", S1: "market fearful",
};

function findRow(data, sym) {
  return (data.rows || []).find((r) => r.symbol === sym) || null;
}
const needTicker = (cmd) => `Which ticker? e.g. /${cmd} NVDA`;
const notOnList = (sym) => `${sym} isn't on your watchlist. Add it in the app first.`;

/* ---------------------------------------------------------------- replies */
export function help() {
  return ["Bottom Tracker (read-only):", ...COMMANDS.map(([c, d]) => `/${c} — ${d}`)].join("\n");
}

export function score(data, sym, app) {
  if (!sym) return needTicker("score");
  const r = findRow(data, sym);
  if (!r) return notOnList(sym);
  if (r.error || r.score == null) return `${sym}: no score yet (${r.error || "waiting for tonight's update"}).`;
  const fired = (r.signals || []).filter((s) => s.passed === true).map((s) => SIGNAL[s.code] || s.code);
  const lines = [
    `${sym} · ${money(r.price, r.currency, 2)} (${signed(r.change_pct)} today)`,
    `Bottom Score ${r.score}/${r.max_score} · ${LABEL[r.label] || r.label}`,
    fired.length ? `Fired: ${fired.join(", ")}` : "No bottom signals fired.",
    r.top?.score != null ? `Top Score ${r.top.score}/${r.top.max_score ?? 6}${r.top.score >= 4 ? " · consider trimming" : r.top.score >= 2 ? " · getting hot" : ""}` : null,
    r.quality?.score != null ? `Quality ${Math.round(r.quality.score)}${r.quality.moat ? ` · moat ${r.quality.moat}` : ""}` : "Quality n/a",
    r.verdict ? VERDICT[r.verdict] : null,
    link(app, `ticker/${encodeURIComponent(sym)}`),
  ];
  return lines.filter(Boolean).join("\n");
}

function riskSettings(risk) {
  const base = settingsFor(risk?.profile && risk.profile !== "custom" ? risk.profile : "balanced");
  if (!risk?.settings) return base;
  const s = risk.settings;
  return { ...base, ...s, profile: risk.profile, type_caps: { ...base.type_caps, ...(s.type_caps || {}) },
    multipliers: { ...base.multipliers, ...(s.multipliers || {}) }, typical_vol: base.typical_vol };
}

const fxOf = (data) => data.market?.fx?.rates || {};
const valued = (data) => valuePortfolio(data.pf?.transactions || [], data.rows || [], data.pf?.settings || {}, fxOf(data));

export function portfolio(data, app) {
  const pf = valued(data);
  if (!pf.total) return "No portfolio yet. Add your positions in the app (Portfolio → Import from Bolero).";
  const s = riskSettings(data.pf?.risk);
  const b = (k) => pf.buckets[k]?.pct || 0;
  return [
    `Portfolio ${money(pf.total)} · ${signed(pf.dayChangePct)} today (closing prices)`,
    `Since you bought: ${signedEur(pf.pl)} (${signed(pf.plPct)})`,
    `Cash ${money(pf.cash)} (${pct(pf.total ? (pf.cash / pf.total) * 100 : 0, 0)})`,
    `Core ${pct(b("core"), 0)} (min ${pct(s.core_min, 0)}) · satellite ${pct(b("satellite") + b("speculative"), 0)} (max ${pct(s.satellite_max, 0)})`,
    `Largest: ${pf.holdings.slice(0, 3).map((h) => `${h.symbol} ${pct(h.weight, 0)}`).join(", ")}`,
    link(app, "portfolio"),
  ].join("\n");
}

export function canibuy(data, sym, amountText, app) {
  if (!sym) return needTicker("canibuy");
  const r = findRow(data, sym);
  if (!r) return notOnList(sym);
  const pf = valued(data);
  if (!pf.total) return "Add your portfolio in the app first, so I know its size.";
  const s = riskSettings(data.pf?.risk);
  const type = r.asset_type || r.risk?.suggested_type || "stock";
  const days = r.next_earnings?.date ? Math.round((Date.parse(`${r.next_earnings.date}T12:00:00Z`) - Date.now()) / 864e5) : null;
  const res = sizeFor(pf, { symbol: sym, type, vol: r.risk?.vol, max_dd: r.risk?.max_dd, quality: r.quality?.score ?? null,
    verdict: r.verdict, sector: r.risk?.sector, region: r.risk?.region, earnings_in_days: days }, s);
  const amount = parseAmount(amountText);
  const lines = [
    res.room > 0 ? `${sym}: up to ${money(res.maxPosition)}${res.owned > 0 ? ` · you own ${money(res.owned)} → room ${money(res.room)}` : ` · room ${money(res.room)}`}`
      : `${sym}: no room to add under your rules.`,
    `Limited by: ${RULE[res.limiting] || res.limiting}`,
  ];
  if (Number.isFinite(amount) && amount > 0) {
    lines.push(amount <= res.room + 0.5 ? `✅ ${money(amount)} fits your rules.` : `⚠️ ${money(amount)} is ${money(amount - res.room)} more than your rules allow.`);
  }
  if (days != null && days >= 0 && days <= 7) lines.push(`Earnings in ${days} days: volatility ahead.`);
  lines.push("Suggested max from your own rules, not advice.", link(app, `canibuy/${encodeURIComponent(sym)}`));
  return lines.join("\n");
}

export function events(data, today, app) {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 864e5).toISOString().slice(0, 10);
  const inWeek = (d) => d && d >= today && d <= end;
  const out = [];
  for (const r of data.rows || []) {
    if (inWeek(r.next_earnings?.date)) out.push([r.next_earnings.date, `${r.symbol} earnings${r.next_earnings.hour === "bmo" ? " (before open)" : r.next_earnings.hour === "amc" ? " (after close)" : ""}`]);
    if (inWeek(r.next_dividend?.ex_date)) out.push([r.next_dividend.ex_date, `${r.symbol} ex-dividend${r.next_dividend.amount ? ` ${money(r.next_dividend.amount, r.next_dividend.currency || r.currency, 2)}` : ""}${r.next_dividend.estimated ? " (est.)" : ""}`]);
  }
  for (const m of data.macro || []) if (inWeek(m.date)) out.push([m.date, `${m.kind === "ecb" ? "ECB" : m.kind === "fomc" ? "Fed (FOMC)" : m.kind} rate decision`]);
  if (!out.length) return `Nothing on your calendar in the next 7 days.\n${link(app, "calendar")}`;
  out.sort((a, b) => a[0].localeCompare(b[0]));
  const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return ["Next 7 days:", ...out.map(([d, t]) => `${day(d)} · ${t}`), link(app, "calendar")].join("\n");
}

export function levels(data, sym, detail, app) {
  if (!sym) return needTicker("levels");
  const r = findRow(data, sym);
  if (!r) return notOnList(sym);
  const zones = detail?.weekly?.levels?.zones || [];
  const near = (role) => zones.filter((z) => z.role === role).sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
  const z = (x, word) => (x ? `${word} ${money(x.low, r.currency, 2)}–${money(x.high, r.currency, 2)} (${num(Math.abs(x.distance_pct), 1)} % ${x.role === "support" ? "below" : "above"}, ${x.touches} touches, ${(x.tfs || []).join("·")})` : `No ${word.toLowerCase()} nearby.`);
  return [`${sym} at ${money(r.price, r.currency, 2)}`, z(near("support"), "Support"), z(near("resistance"), "Resistance"), link(app, `ticker/${encodeURIComponent(sym)}`)].join("\n");
}

export function thesis(data, sym, app) {
  if (!sym) return needTicker("thesis");
  const r = findRow(data, sym);
  if (!r) return notOnList(sym);
  const th = (data.pf?.thesis || []).find((x) => x.symbol === sym);
  if (!th) return `No thesis for ${sym} yet. Write it in the app.\n${link(app, `thesis/${encodeURIComponent(sym)}`)}`;
  const res = evaluate(th.rules || [], r.metrics || {});
  const st = thesisStatus(res);
  const head = { intact: "✅ Thesis intact", broken1: "⚠️ 1 rule broken", broken: "❌ Several rules broken", unknown: "Thesis: no data yet", none: "No automatic rules" }[st];
  return [
    `${sym}: ${head}`,
    th.why ? `Why: ${th.why}` : null,
    ...res.map((x) => `${x.ok === false ? "❌" : x.ok ? "✅" : "–"} ${x.metric.replace(/_/g, " ")} ${x.op === ">=" ? "≥" : "≤"} ${smart(x.value)} (now ${smart(x.actual)})`),
    link(app, `thesis/${encodeURIComponent(sym)}`),
  ].filter(Boolean).join("\n");
}

export function news(data, sym, detail, app) {
  if (!sym) return needTicker("news");
  if (!findRow(data, sym)) return notOnList(sym);
  const items = (detail?.fundamentals?.news || []).slice(0, 5);
  if (!items.length) return `No recent headlines for ${sym}.`;
  return [`${sym} — latest headlines:`, ...items.map((n) => `• ${n.headline || n.title}${n.source ? ` (${n.source})` : ""}`), link(app, `ticker/${encodeURIComponent(sym)}`)].join("\n");
}

export function health(data, now, app) {
  const last = (data.runs || []).find((r) => r.job === "daily");
  if (!last) return "No update has run yet.";
  const hours = Math.round((now - Date.parse(last.finished_at)) / 36e5);
  const failed = Object.entries(last.sources || {}).filter(([, v]) => v && v.ok === false).map(([k]) => k.replace(/_/g, " "));
  const c = last.counts || {};
  return [
    `Last update: ${last.status} · ${hours} h ago`,
    `${c.scored ?? 0} of ${c.tickers ?? 0} tickers scored${c.errors ? `, ${c.errors} without prices` : ""}`,
    failed.length ? `Sources with problems: ${failed.join(", ")}` : "All data sources working.",
    link(app, "more/health"),
  ].join("\n");
}

/** The reply for one message. data holds only what needs(cmd) asked for. */
export function answer({ cmd, args, raw }, data, { app, today = new Date().toISOString().slice(0, 10), now = Date.now() } = {}) {
  switch (cmd) {
    case "score": return score(data, args[0], app);
    case "portfolio": return portfolio(data, app);
    case "canibuy": return canibuy(data, args[0], args[1], app);
    case "events": return events(data, today, app);
    case "levels": return levels(data, args[0], data.detail, app);
    case "thesis": return thesis(data, args[0], app);
    case "news": return news(data, args[0], data.detail, app);
    case "health": return health(data, now, app);
    case "gaps": return "The gap finder comes in a later phase (needs ETF look-through).";
    case "unknown": return `I don't know /${raw}.\n\n${help()}`;
    default: return help();
  }
}

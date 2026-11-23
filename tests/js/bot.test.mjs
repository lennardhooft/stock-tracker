import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCommand, answer, parseAmount, help, needs } from "../../backend/functions/telegram-bot/core.js";

const APP = "https://example.test";
// FAKE data in the shapes the function reads from Supabase
const rows = [
  { symbol: "NRDX", price: 118.4, currency: "USD", change_pct: -2.1, score: 4, max_score: 6, label: "strong", verdict: "sale",
    signals: [{ code: "T2", passed: true }, { code: "T3", passed: true }, { code: "V1", passed: false }],
    top: { score: 1, max_score: 6 }, quality: { score: 81, moat: "wide" }, asset_type: "stock",
    risk: { vol: 0.48, max_dd: 0.65, sector: "Technology", region: "North America" }, metrics: { sales_growth: 6.2, quality_score: 81 },
    next_earnings: { date: "2026-11-25", hour: "amc" } },
  { symbol: "WORLD.AS", price: 126.7, currency: "EUR", change_pct: 0.4, score: 1, max_score: 6, label: "normal", asset_type: "broad_etf",
    risk: { vol: 0.13, max_dd: 0.34 }, next_dividend: { ex_date: "2026-11-27", amount: 0.5, currency: "EUR" } },
];
const pf = {
  transactions: [
    { date: "2025-01-02", symbol: "WORLD.AS", kind: "start", quantity: 300, price: 100, currency: "EUR" },
    { date: "2025-06-12", symbol: "NRDX", kind: "buy", quantity: 10, price: 131.2, currency: "USD", fx_rate: 1.14, fees: 15, taxes: 3.5 },
  ],
  settings: { cash: { EUR: 5000 } }, risk: null,
  thesis: [{ symbol: "NRDX", why: "Chips at a low", rules: [{ metric: "sales_growth", op: ">=", value: 10 }, { metric: "quality_score", op: ">=", value: 60 }] }],
};
const data = { rows, pf, market: { fx: { rates: { USD: 1.16 } } }, macro: [{ date: "2026-12-09", kind: "fomc" }, { date: "2026-11-26", kind: "ecb" }],
  runs: [{ job: "daily", status: "partial", finished_at: "2026-11-22T22:00:00Z", counts: { scored: 11, tickers: 14, errors: 3 }, sources: { yahoo_prices: { ok: false }, yahoo_fx: { ok: true } } }] };

test("commands parse: bot mention, case, amounts", () => {
  assert.deepEqual(parseCommand("/canibuy@BottomBot asml.as 2.000").args, ["ASML.AS", "2.000"]);
  assert.equal(parseCommand("/Score nrdx").cmd, "score");
  assert.equal(parseCommand("hello").cmd, "help");
  assert.equal(parseCommand("/sell NRDX").cmd, "unknown");
  assert.equal(parseAmount("2.000"), 2000); assert.equal(parseAmount("2,5"), 2.5); assert.equal(parseAmount("1500"), 1500);
  assert.deepEqual(needs("portfolio"), ["rows", "pf", "market"]);
});

test("/score: scores, fired signals, quality, verdict, link", () => {
  const t = answer(parseCommand("/score nrdx"), data, { app: APP });
  assert.match(t, /NRDX · \$ 118,40 \(▼ −2,1 % today\)/);
  assert.match(t, /Bottom Score 4\/6 · Strong/);
  assert.match(t, /Fired: weekly RSI oversold, ≥ 30 % below its high/);
  assert.match(t, /Quality 81 · moat wide/);
  assert.match(t, /🟢 Quality on sale/);
  assert.match(t, /#\/ticker\/NRDX$/);
  assert.match(answer(parseCommand("/score XYZ"), data, { app: APP }), /isn't on your watchlist/);
  assert.match(answer(parseCommand("/score"), data, { app: APP }), /Which ticker/);
});

test("/portfolio uses the app's own portfolio maths", () => {
  const t = answer(parseCommand("/portfolio"), data, { app: APP });
  // 300 × 126,7 = 38.010 + 10 × 118,4 / 1,16 = 1.020,69 + cash 5.000 = 44.031
  assert.match(t, /Portfolio € 44\.031/);
  assert.match(t, /Cash € 5\.000 \(11 %\)/);
  assert.match(t, /Largest: WORLD\.AS 86 %/);
});

test("/canibuy: sizing answer, amount check, earnings note, no advice language", () => {
  const t = answer(parseCommand("/canibuy NRDX 50.000"), data, { app: APP, today: "2026-11-22" });
  assert.match(t, /^NRDX: up to € [\d.]+ · you own € [\d.]+ → room € [\d.]+/);
  assert.match(t, /Limited by: /);
  assert.match(t, /⚠️ € 50\.000 is € [\d.]+ more than your rules allow/);
  assert.match(t, /not advice/);
  assert.doesNotMatch(t, /buy now|you should/i);
});

test("/events: next 7 days, sorted, Fed/ECB names", () => {
  const t = answer(parseCommand("/events"), data, { app: APP, today: "2026-11-22" });
  const lines = t.split("\n");
  assert.equal(lines[0], "Next 7 days:");
  assert.match(lines[1], /NRDX earnings \(after close\)/);
  assert.match(lines[2], /ECB rate decision/);
  assert.match(lines[3], /WORLD\.AS ex-dividend € 0,50/);
  assert.doesNotMatch(t, /Fed/); // 9 Dec is outside the week
});

test("/thesis, /levels, /news, /health", () => {
  const th = answer(parseCommand("/thesis NRDX"), data, { app: APP });
  assert.match(th, /NRDX: ⚠️ 1 rule broken/);
  assert.match(th, /❌ sales growth ≥ 10 \(now 6,2\)/);
  const detail = { weekly: { levels: { zones: [{ role: "support", low: 104, high: 110, distance_pct: -9.5, touches: 3, tfs: ["Y", "M"] }] } },
    fundamentals: { news: [{ headline: "Nordex beats", source: "Wire" }] } };
  assert.match(answer(parseCommand("/levels NRDX"), { ...data, detail }, { app: APP }), /Support \$ 104,00–\$ 110,00 \(9,5 % below, 3 touches, Y·M\)\nNo resistance nearby\./);
  assert.match(answer(parseCommand("/news NRDX"), { ...data, detail }, { app: APP }), /• Nordex beats \(Wire\)/);
  const h = answer(parseCommand("/health"), data, { app: APP, now: Date.parse("2026-11-23T08:00:00Z") });
  assert.match(h, /Last update: partial · 10 h ago/);
  assert.match(h, /11 of 14 tickers scored, 3 without prices/);
  assert.match(h, /Sources with problems: yahoo prices/);
  assert.match(answer(parseCommand("/help"), {}, { app: APP }), /\/canibuy/);
  assert.equal(help().split("\n").length, 11);
});

/* ------------------------------------------------- the bundled function (index.ts) end to end */
test("bundle: secret header, owner-only, answers, logs no tickers", async () => {
  const src = readFileSync(new URL("../../backend/functions/telegram-bot/index.ts", import.meta.url), "utf8");
  let handler;
  const env = { TELEGRAM_BOT_TOKEN: "123:FAKE", TELEGRAM_CHAT_ID: "42", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service" };
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  const sent = [];
  const logs = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.telegram.org/")) { sent.push(JSON.parse(opts.body)); return new Response("{}"); }
    const path = u.replace("https://db.test/rest/v1/", "");
    const table = path.split("?")[0];
    const body = { watchlist: path.includes("limit=1") ? [{ user_id: "u1" }] : rows.map((r) => ({ symbol: r.symbol, user_id: "u1", asset_type: r.asset_type })),
      latest_scores: rows, transactions: pf.transactions, portfolio_settings: [pf.settings], risk_settings: [], thesis: pf.thesis,
      market_snapshot: [{ data: data.market }], job_runs: data.runs, ticker_detail: [] }[table] ?? [];
    return new Response(JSON.stringify(body));
  };
  try {
    await import("data:text/javascript," + encodeURIComponent(src));
    const { createHash } = await import("node:crypto");
    const secret = createHash("sha256").update("123:FAKE:webhook").digest("hex").slice(0, 64);
    const call = (text, chat = 42, s = secret) => handler(new Request("https://fn.test", { method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": s }, body: JSON.stringify({ message: { text, chat: { id: chat } } }) }));

    assert.equal((await call("/score NRDX", 42, "wrong")).status, 401);
    await call("/portfolio", 999); // a stranger
    assert.equal(sent.length, 0);
    await call("/score NRDX");
    await call("/portfolio");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].chat_id, "42");
    assert.match(sent[0].text, /Bottom Score 4\/6/);
    assert.match(sent[1].text, /Portfolio € 44\.031/);
    assert.ok(logs.every((l) => !/NRDX|WORLD|44\.031/.test(l)), `logs leak: ${logs.join(" | ")}`);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
});

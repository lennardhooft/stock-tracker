// Sizing engine + portfolio maths (CLAUDE.md 13.13.4–6): run with `node --test tests/js`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { positions, valuePortfolio, warnings, toEur } from "../../web/lib/portfolio.js";
import { sizeFor, stagedPlan, check } from "../../web/lib/sizing.js";
import { settingsFor } from "../../web/lib/risk-defaults.js";

const S = settingsFor("balanced");
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/** A € 50.000 portfolio: € 40.000 world ETF, € 900 NVDA, € 9.100 cash. */
function pf50k() {
  const tx = [
    { date: "2025-01-02", symbol: "IWDA.AS", kind: "start", quantity: 400, price: 100, currency: "EUR" },
    { date: "2025-01-02", symbol: "NVDA", kind: "buy", quantity: 9, price: 108, currency: "USD", fx_rate: 1.08 },
  ];
  const rows = [
    { symbol: "IWDA.AS", price: 100, currency: "EUR", change_pct: 1, asset_type: "broad_etf" },
    { symbol: "NVDA", price: 108, currency: "USD", change_pct: -2, risk: { suggested_type: "stock", sector: "Technology", region: "North America" }, quality: { score: 82 } },
  ];
  return valuePortfolio(tx, rows, { cash: { EUR: 9100 } }, { USD: 1.08 });
}

test("worked example 13.13.5: NVDA max € 1.250, room € 350, limited by the risk rule", () => {
  const pf = pf50k();
  near(pf.total, 50000);
  const r = sizeFor(pf, { symbol: "NVDA", type: "stock", vol: 0.48, quality: 82, verdict: "sale", sector: "Technology", region: "North America" }, S);
  near(r.calc.maxLoss, 750);
  near(r.calc.bad, 0.72);
  near(r.calc.base, 1041.67);
  near(r.maxPosition, 1250);
  near(r.owned, 900);
  near(r.room, 350);
  assert.equal(r.limiting, "risk");
});

test("ETF example: 15 % volatility → € 3.333 by the risk rule, no type cap", () => {
  const pf = pf50k();
  const r = sizeFor(pf, { symbol: "VWCE.DE", type: "broad_etf", vol: 0.15 }, S);
  near(r.rules.find((x) => x.key === "risk").cap, 3333.33);
  assert.equal(r.rules.some((x) => x.key === "typeCap"), false);
  assert.equal(r.rules.some((x) => x.key === "satellite"), false); // core
});

test("bad case is capped by the historical max drawdown; value trap halves the amount", () => {
  const pf = pf50k();
  const a = sizeFor(pf, { symbol: "X", type: "stock", vol: 0.6, max_dd: 0.5, quality: 30, verdict: "trap" }, S);
  near(a.calc.bad, 0.5); // 1.5 × 0.6 = 0.9 > 0.5
  near(a.calc.riskAmount, (750 / 0.5) * 0.5 * 0.5);
  assert.ok(a.notes.includes("cappedByDrawdown"));
});

test("sector full → nothing; cash is a limit too", () => {
  const pf = pf50k();
  const full = sizeFor(pf, { symbol: "Y", type: "stock", vol: 0.3, quality: 80, sector: "Technology" }, { ...S, sector_max: 1 });
  assert.equal(full.limiting, "sector");
  assert.equal(full.room, 0);
  const pf2 = { ...pf, cash: 2600 };
  const cash = sizeFor(pf2, { symbol: "Z", type: "stock", vol: 0.2, quality: 80 }, S);
  assert.equal(cash.limiting, "cash"); // 2600 − 5 % of 50.000 = 100
  near(cash.room, 100);
});

test("unknown volatility uses the typical volatility of its type", () => {
  const r = sizeFor(pf50k(), { symbol: "NEW", type: "stock", vol: null }, S);
  near(r.calc.vol, 0.35);
  assert.ok(r.notes.includes("typicalVol"));
});

test("positions: average cost with fees, sells reduce at average cost", () => {
  const p = positions([
    { date: "2025-01-01", symbol: "abc", kind: "buy", quantity: 10, price: 10, currency: "EUR", fees: 2 },
    { date: "2025-02-01", symbol: "ABC", kind: "buy", quantity: 10, price: 20, currency: "EUR" },
    { date: "2025-03-01", symbol: "ABC", kind: "sell", quantity: 5, price: 30, currency: "EUR", fees: 1 },
  ])[0];
  near(p.qty, 15);
  near(p.avgCost, 15.1); // (100 + 2 + 200) / 20
  near(p.realised, 5 * 30 - 1 - 5 * 15.1);
});

test("values in EUR, weights, buckets, warnings", () => {
  const pf = pf50k();
  near(toEur(108, "USD", { USD: 1.08 }), 100);
  const nvda = pf.holdings.find((h) => h.symbol === "NVDA");
  near(nvda.value, 900);
  near(nvda.weight, 1.8);
  near(pf.buckets.core.pct, 80);
  near(pf.buckets.cash.pct, 18.2);
  assert.deepEqual(warnings(pf, S), []);
  const w = warnings(pf, { ...S, type_caps: { ...S.type_caps, stock_quality: 1 } });
  assert.equal(w[0].key, "overCap");
});

test("staged plan: now, support, 200-week average", () => {
  const plan = stagedPlan(300, 100, { support: 90, sma200: 80 });
  assert.deepEqual(plan.map((p) => p.why), ["now", "support", "sma200"]);
  near(plan[1].amount, 100);
  assert.deepEqual(stagedPlan(300, 100).map((p) => p.why), ["now", "minus20", "minus30"]);
  assert.deepEqual(check(400, { room: 350 }), { fits: false, over: 50 });
});

test("number parsing follows the number format (Belgian / English)", async () => {
  const { parseNumber } = await import("../../web/lib/format.js");
  assert.equal(parseNumber("2.000", "nl-BE"), 2000);
  assert.equal(parseNumber("1.234,56", "nl-BE"), 1234.56);
  assert.equal(parseNumber("12,5", "nl-BE"), 12.5);
  assert.equal(parseNumber("12.5", "nl-BE"), 12.5); // not grouped by 3 → a decimal point
  assert.equal(parseNumber("€ 2 000", "nl-BE"), 2000);
  assert.equal(parseNumber("1,234.56", "en"), 1234.56);
  assert.equal(parseNumber("2,000", "en"), 2000);
  assert.ok(Number.isNaN(parseNumber("abc", "nl-BE")));
  assert.ok(Number.isNaN(parseNumber("", "nl-BE")));
});

test("no room: the limiting cap is reported so the UI can say 'already above'", () => {
  const pf = pf50k();
  const r = sizeFor(pf, { symbol: "NVDA", type: "stock", vol: 0.48, quality: 82 }, { ...S, risk_per_position: 0.5 });
  assert.equal(r.room, 0);
  assert.equal(r.limiting, "risk");
  near(r.limitingCap, (250 / 0.72));
  assert.ok(r.owned > r.limitingCap);
});

test("broad ETFs count as 'spread' in the sector and region split, not 'unknown'", () => {
  const pf = pf50k();
  near(pf.alloc.sector.spread.pct, 80);
  assert.equal(pf.alloc.sector.unknown, undefined);
  near(pf.alloc.sector.Technology.pct, 1.8);
});

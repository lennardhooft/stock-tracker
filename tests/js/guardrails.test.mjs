import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fomo, tradeLimit, panicSell, inPlan, cooling, marketFor, brokerFee, tob, orderCosts, limitIdeas, impact, checklist, reviewsDue, resultSince, byEmotion } from "../../web/lib/guardrails.js";
import { evaluate, status } from "../../web/lib/thesis.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("thesis: shared cases with src/thesis.py", () => {
  const c = JSON.parse(readFileSync(new URL("../fixtures/thesis_cases.json", import.meta.url), "utf8"));
  for (const k of c.cases) {
    const res = evaluate(k.rules, c.metrics);
    assert.deepEqual(res.map((r) => r.ok), k.oks || []);
    assert.equal(status(res), k.status);
  }
});

test("FOMO: big 3-month rise or a hot Top Score", () => {
  assert.equal(fomo({ metrics: { rise_3m: 12 }, top: { score: 1 } }), null);
  assert.equal(fomo({ metrics: { rise_3m: 42 } }).byRise, true);
  assert.equal(fomo({ metrics: { rise_3m: 5 }, top: { score: 3 } }).byTop, true);
});

test("trade limit counts buys and sells of this month only", () => {
  const tx = [
    { kind: "buy", date: "2026-11-03" }, { kind: "sell", date: "2026-11-10" }, { kind: "start", date: "2026-11-22" },
    { kind: "dividend", date: "2026-11-15" }, { kind: "buy", date: "2026-10-30" }, { kind: "buy", date: "2026-11-20" }, { kind: "buy", date: "2026-11-21" },
  ];
  const r = tradeLimit(tx, "2026-11-22");
  assert.equal(r.count, 4); assert.equal(r.max, 4); assert.equal(r.reached, true);
  assert.equal(tradeLimit(tx.slice(0, 3), "2026-11-22").reached, false);
});

test("panic sell: 20 % below the high or position 20 % down", () => {
  assert.equal(panicSell({ pct_from_52w_high: -25 }, null), true);
  assert.equal(panicSell({ pct_from_52w_high: -5 }, { plPct: -21 }), true);
  assert.equal(panicSell({ pct_from_52w_high: -5 }, { plPct: -3 }), false);
});

test("in plan and cooling-off", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const pend = [{ symbol: "ORCA", status: "waiting", created_at: "2026-11-22T10:00:00Z", decide_after: "2026-11-23T10:00:00Z" }];
  const c = cooling(pend, "ORCA", now);
  assert.equal(c.ready, true);
  assert.equal(inPlan({ row: {}, owned: 0, thesis: null, cooled: c }), true);
  assert.equal(inPlan({ row: {}, owned: 0, thesis: null, cooled: null }), false);
  assert.equal(inPlan({ row: { buy_below: 100 }, owned: 0 }), true);
  assert.equal(cooling(pend, "ORCA", new Date("2026-11-22T12:00:00Z")).ready, false);
});

test("Bolero fees: Euronext, Germany, US, Toronto (tariff sheet)", () => {
  const eu = marketFor("ASML.AS"), de = marketFor("SAP.DE"), us = marketFor("NVDA"), to = marketFor("SHOP.TO");
  assert.equal(eu.key, "euronext"); assert.equal(us.key, "us"); assert.equal(marketFor("XX.ZZ"), null);
  assert.equal(brokerFee(250, eu), 2.5); assert.equal(brokerFee(900, eu), 5); assert.equal(brokerFee(2500, eu), 7.5);
  assert.equal(brokerFee(5000, eu), 15); assert.equal(brokerFee(25000, eu), 45); assert.equal(brokerFee(40000, eu), 50);
  assert.equal(brokerFee(80000, eu), 65);
  assert.equal(brokerFee(2000, de), 15); assert.equal(brokerFee(15000, de), 60); near(brokerFee(100000, de), 150);
  assert.equal(brokerFee(3000, us), 20); assert.equal(brokerFee(30000, us), 50);
  assert.equal(brokerFee(3000, to), 20); assert.equal(brokerFee(10000, to), 50);
});

test("TOB: stocks 0,35 % (max 1.600), ETFs 0,12 % (max 1.300)", () => {
  near(tob(2000, "stock"), 7); near(tob(2000, "broad_etf"), 2.4); assert.equal(tob(1e6, "stock"), 1600);
});

test("order costs in EUR with a USD fee, warning above 1 %", () => {
  const c = orderCosts(2000, "NVDA", "stock", { USD: 1.25 });
  // $ 2.500 order → $ 7,50? no: 2.500 is in the "up to 2.500" tier → $ 15 = € 12; TOB € 7
  near(c.fee, 12); near(c.tob, 7); near(c.total, 19); near(c.pct, 0.95);
  assert.equal(c.warn, false); assert.equal(c.fxIncluded, false);
  const small = orderCosts(300, "ASML.AS", "stock", {});
  near(small.total, 5 + 1.05); assert.equal(small.warn, true);
});

test("limit ideas only below today's price", () => {
  const l = limitIdeas(100, { support: 92, sma200: 105 });
  assert.deepEqual(l.map((x) => x.key), ["now", "support"]); near(l[1].dist, -8);
});

test("impact: weights now → after", () => {
  const pf = { total: 10000, cash: 2000, holdings: [{ symbol: "ORCA", value: 500 }],
    alloc: { sector: { Technology: { value: 1500 } }, region: { "North America": { value: 2000 } }, currency: { USD: { value: 2500 } } },
    buckets: { satellite: { value: 2500 }, speculative: { value: 0 } } };
  const r = impact(pf, { symbol: "ORCA", type: "stock", sector: "Technology", region: "North America", currency: "USD" }, 1000);
  near(r.position.now, 5); near(r.position.after, 15); near(r.sector.after, 25); near(r.satellite.after, 35); near(r.cashAfter, 1000);
  assert.equal(impact(pf, { symbol: "W", type: "broad_etf" }, 1000).sector, null);
});

test("checklist states", () => {
  const items = checklist({
    row: { quality: { score: 62 } }, type: "stock", owned: 0, thesis: null, cooled: null,
    res: { room: 800, rules: [{ key: "sector", room: 0, vars: { sector: "Technology" } }, { key: "region", room: 3000, vars: {} }] },
    amount: 1000, trades: { enabled: true, count: 4, max: 4, reached: true }, earningsDays: 3, fomoHit: { rise: 40 },
  });
  const s = Object.fromEntries(items.map((i) => [i.key, i.state]));
  assert.deepEqual(s, { plan: "warn", quality: "warn", thesis: "warn", earnings: "warn", fomo: "warn", trades: "warn", sizing: "warn", sector: "warn", region: "ok" });
});

test("reviews due at +3 and +12 months until done", () => {
  const tx = [{ id: "a", kind: "buy", date: "2025-08-20" }, { id: "b", kind: "start", date: "2025-01-01" }];
  assert.deepEqual(reviewsDue(tx, [], "2026-11-22").map((r) => [r.tx.id, r.due, r.date]), [["a", "3m", "2025-11-20"], ["a", "12m", "2026-08-20"]]);
  assert.equal(reviewsDue(tx, [{ transaction_id: "a", due: "3m" }], "2026-11-22").length, 1);
});

test("decision log: result since and per feeling", () => {
  near(resultSince({ kind: "buy", price: 100 }, 120), 20);
  near(resultSince({ kind: "sell", price: 100 }, 80), 20); // sold before a 20 % fall
  const s = byEmotion([
    { kind: "buy", symbol: "A", price: 100, emotion: "fomo" }, { kind: "buy", symbol: "B", price: 50, emotion: "plan" },
    { kind: "buy", symbol: "A", price: 80, emotion: "fomo" }, { kind: "start", symbol: "C", price: 1, emotion: "calm" },
  ], [{ symbol: "A", price: 90 }, { symbol: "B", price: 60 }]);
  assert.equal(s.fomo.n, 2); near(s.fomo.avg, (-10 + 12.5) / 2); near(s.plan.avg, 20); assert.equal(s.calm, undefined);
});

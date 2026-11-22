import { test } from "node:test";
import assert from "node:assert/strict";
import { correlatedGroups, maxCorrelation, stressTest, concentration, withLive, marketOpenNow } from "../../web/lib/riskview.js";

const snap = { symbols: ["A", "B", "C", "D"], corr: [[1, 0.85, 0.1, 0.2], [0.85, 1, 0.82, 0.1], [0.1, 0.82, 1, 0.3], [0.2, 0.1, 0.3, 1]] };

test("correlated groups join transitively (A~B, B~C → A,B,C)", () => {
  const r = correlatedGroups(["A", "B", "C", "D"], snap);
  assert.deepEqual(r.groups, [["A", "B", "C"]]);
  assert.equal(r.pairs.length, 2);
  assert.deepEqual(correlatedGroups(["A", "D"], snap).groups, []);
});

test("max correlation with the holdings", () => {
  assert.equal(maxCorrelation("B", ["A", "C", "D"], snap), 0.85);
  assert.equal(maxCorrelation("Z", ["A"], snap), null);
});

test("stress test: value × crisis move, cash counts as 0, proxies listed", () => {
  const pf = { total: 10000, holdings: [
    { symbol: "A", value: 6000, row: { risk: { stress: { gfc: -0.5, covid: -0.3, y2022: -0.2, proxy: ["gfc"] } } } },
    { symbol: "B", value: 2000, row: { risk: { stress: { gfc: null, covid: -0.1, y2022: 0.05, proxy: [] } } } },
  ] };
  const s = stressTest(pf);
  assert.equal(s.gfc.loss, -3000);
  assert.equal(s.gfc.pct, -30);
  assert.deepEqual(s.gfc.proxies, ["A"]);
  assert.deepEqual(s.gfc.missing, ["B"]);
  assert.equal(s.y2022.loss, -1200 + 100);
});

test("concentration and live prices", () => {
  const pf = { holdings: [{ symbol: "A", weight: 50 }, { symbol: "B", weight: 20 }, { symbol: "C", weight: 10 }, { symbol: "D", weight: 5 }] };
  assert.equal(concentration(pf).top3, 80);
  const rows = withLive([{ symbol: "A", price: 10, change_pct: 0 }], { A: { price: 11, prev_close: 10 } });
  assert.equal(rows[0].price, 11);
  assert.ok(Math.abs(rows[0].change_pct - 10) < 1e-9);
});

test("market hours in Brussels time", () => {
  assert.equal(marketOpenNow(new Date("2026-11-23T10:00:00Z")), true);   // Mon 11:00 Brussels
  assert.equal(marketOpenNow(new Date("2026-11-23T21:30:00Z")), false);  // Mon 22:30
  assert.equal(marketOpenNow(new Date("2026-11-22T12:00:00Z")), false);  // Sunday
});

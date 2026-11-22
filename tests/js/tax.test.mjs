import { test } from "node:test";
import assert from "node:assert/strict";
import { realised, yearReport, toCsv } from "../../web/lib/tax.js";

const tx = (date, kind, quantity, price, extra = {}) => ({ date, symbol: "AAA", kind, quantity, price, currency: "EUR", fees: 0, taxes: 0, ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("FIFO: the oldest purchase is sold first, costs included", () => {
  const r = realised([
    tx("2025-01-10", "buy", 10, 100, { fees: 10 }),   // 101 per share
    tx("2025-06-10", "buy", 10, 150),                  // 150 per share
    tx("2026-03-01", "sell", 15, 200, { fees: 15, taxes: 5 }),
  ], {}, "fifo");
  const s = r.sales[0];
  near(s.cost, 10 * 101 + 5 * 150);
  near(s.proceeds, 15 * 200 - 20);
  near(s.gain, 2980 - 1760);
  assert.equal(s.acquired, "2025-01-10");
  assert.equal(s.year, 2026);
});

test("average cost method", () => {
  const r = realised([tx("2025-01-10", "buy", 10, 100), tx("2025-06-10", "buy", 10, 200), tx("2026-03-01", "sell", 10, 300)], {}, "average");
  near(r.sales[0].cost, 1500);
  near(r.sales[0].gain, 1500);
});

test("USD sale uses the trade's own rate; without one it's flagged approx", () => {
  const usd = { currency: "USD" };
  const r = realised([
    tx("2025-01-10", "buy", 10, 100, { ...usd, fx_rate: 1.25 }),
    tx("2026-03-01", "sell", 10, 110, { ...usd }),
  ], { USD: 1.1 });
  near(r.sales[0].cost, 800);
  near(r.sales[0].proceeds, 1000);
  assert.equal(r.sales[0].approx, true);
});

test("starting positions are lots dated on the import, marked fromStart", () => {
  const r = realised([tx("2026-11-22", "start", 10, 50), tx("2026-12-01", "sell", 4, 60)], {});
  assert.equal(r.sales[0].fromStart, true);
  near(r.sales[0].gain, 40);
});

test("year report: gains, losses, dividends, TOB and fees per year", () => {
  const rep = yearReport([
    tx("2025-02-01", "buy", 10, 100, { fees: 7.5, taxes: 3.5 }),
    { ...tx("2025-06-01", "buy", 5, 20), symbol: "BBB" },
    tx("2026-02-01", "sell", 5, 120, { fees: 7.5, taxes: 2.1 }),
    { ...tx("2026-03-01", "sell", 5, 10), symbol: "BBB" },
    tx("2026-05-01", "dividend", 5, 2, { taxes: 3 }),
  ], {});
  assert.deepEqual(rep.years, [2026, 2025]);
  const y = rep.by[2026];
  assert.equal(y.sales.length, 2);
  near(y.gains, 5 * 120 - 9.6 - 5 * 101.1);
  near(y.losses, 50 - 100);
  near(y.divGross, 10); near(y.divWithholding, 3); near(y.divNet, 7);
  near(y.tob, 2.1); near(y.fees, 7.5);
  near(rep.by[2025].tob, 3.5);
});

test("CSV for Belgian Excel", () => {
  assert.equal(toCsv([["Ticker", "Gain"], ["AAA", 1234.5], ["B;C", -2]]), 'Ticker;Gain\r\nAAA;1234,50\r\n"B;C";-2,00\r\n');
});

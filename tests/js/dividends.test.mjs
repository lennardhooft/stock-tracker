import { test } from "node:test";
import assert from "node:assert/strict";
import { forecast, nextMonths, nextPayment } from "../../web/lib/dividends.js";
import { netShare, countryOf } from "../../web/lib/costs.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("next 12 months start with this month", () => {
  const m = nextMonths("2026-11-22");
  assert.equal(m[0], "2026-11"); assert.equal(m[11], "2027-10"); assert.equal(m.length, 12);
});

test("withholding: US 15 % then Belgian 30 %; UCITS ETF only Belgian", () => {
  assert.equal(countryOf("ORCA"), "US");
  assert.equal(countryOf("BLMT.BR"), "BE");
  near(netShare("ORCA", "stock"), 0.85 * 0.7);
  near(netShare("WORLD.AS", "broad_etf"), 0.7);
});

test("forecast repeats last year's payments, in EUR, by pay month", () => {
  const h = {
    symbol: "ORCA", name: "Orca", qty: 100, type: "stock", costEur: 4000, currency: "USD",
    row: {
      dividends: { ttm: 2.0, per_year: 4, yield_pct: 1.5, currency: "USD", payout: 0.85,
        history: [["2025-11-01", 0.5], ["2026-02-01", 0.5], ["2026-05-01", 0.5], ["2026-08-01", 0.5], ["2026-11-01", 0.5]] },
      next_dividend: { ex_date: "2027-02-01", estimated: true },
    },
  };
  const f = forecast([h], { USD: 1.25 }, "2026-11-22");
  // 4 payments within the last year (the 2025-11-01 one is older); 100 × 0.5 / 1.25 = € 40 each
  near(f.gross, 160);
  near(f.net, 160 * 0.85 * 0.7);
  const byMonth = Object.fromEntries(f.months.map((m) => [m.month, m.gross]));
  // ex 2026-02-01 → next year 2027-02-01 + 21 days → paid in Feb 2027
  near(byMonth["2027-02"], 40);
  near(byMonth["2027-11"] ?? 0, 0);
  near(f.months.reduce((s, m) => s + m.gross, 0), 160 - 40); // Nov 2027 pay falls outside the 12 months
  const p = f.perHolding[0];
  near(p.yieldOnCost, 4);
  assert.equal(p.payoutHigh, true);
  assert.deepEqual(nextPayment(f.perHolding, "2026-11-22"), { symbol: "ORCA", exDate: "2027-02-01" });
});

test("holdings without dividends are left out", () => {
  const f = forecast([{ symbol: "WORLD.AS", qty: 10, row: {} }], {}, "2026-11-22");
  assert.equal(f.payers, 0); assert.equal(f.net, 0);
});

/* Dividend income tracker (CLAUDE.md 13.15 A) — pure, tested in tests/js/dividends.test.mjs.
 * Forecast = each holding's payments of the last 12 months, repeated one year later, times the
 * shares you own now. Taxes are estimates from config/costs.yaml (verify them). */
import { COSTS, netShare } from "./costs.js";
import { toEur } from "./portfolio.js";

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY));

/** The 12 months starting with this month: ["2026-11", ..., "2027-10"]. */
export function nextMonths(today, n = 12) {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return iso(d).slice(0, 7);
  });
}

/**
 * holdings: from valuePortfolio() ({symbol, name, qty, type, costEur, row: {dividends, next_dividend, ...}}).
 * Returns {months: [{month, gross, net}], perHolding: [...], gross, net, payers}.
 */
export function forecast(holdings, fx, today = iso(new Date())) {
  const months = nextMonths(today).map((month) => ({ month, gross: 0, net: 0 }));
  const at = Object.fromEntries(months.map((m, i) => [m.month, i]));
  const payDays = COSTS.dividend_tax.pay_days_after_ex;
  const yearAgo = addDays(today, -365);
  const perHolding = [];
  for (const h of holdings || []) {
    const d = h.row?.dividends;
    if (!d?.ttm || !(h.qty > 0)) continue;
    const cur = d.currency || h.currency || "EUR";
    const keep = netShare(h.symbol, h.type);
    const grossYear = toEur(h.qty * d.ttm, cur, fx);
    if (grossYear == null) continue;
    for (const [ex, amount] of d.history || []) {
      if (ex <= yearAgo || ex > today) continue; // the last 12 months only
      const pay = addDays(addDays(ex, 365), payDays);
      const i = at[pay.slice(0, 7)];
      if (i == null) continue;
      const g = toEur(h.qty * amount, cur, fx) || 0;
      months[i].gross += g;
      months[i].net += g * keep;
    }
    perHolding.push({
      symbol: h.symbol, name: h.name, currency: cur, dps: d.ttm, perYear: d.per_year, yieldPct: d.yield_pct ?? null,
      yieldOnCost: h.costEur ? (grossYear / h.costEur) * 100 : null,
      grossYear, netYear: grossYear * keep, keep,
      nextEx: h.row?.next_dividend?.ex_date || null, nextEstimated: Boolean(h.row?.next_dividend?.estimated),
      payout: d.payout ?? null, payoutHigh: d.payout != null && d.payout > 0.8, growthPct: d.growth_pct ?? null,
    });
  }
  perHolding.sort((a, b) => b.netYear - a.netYear);
  return {
    months, perHolding, payers: perHolding.length,
    gross: perHolding.reduce((s, x) => s + x.grossYear, 0),
    net: perHolding.reduce((s, x) => s + x.netYear, 0),
  };
}

/** The next expected payment across holdings: {symbol, exDate} or null. */
export function nextPayment(perHolding, today = iso(new Date())) {
  const next = perHolding.filter((x) => x.nextEx && x.nextEx >= today).sort((a, b) => a.nextEx.localeCompare(b.nextEx))[0];
  return next ? { symbol: next.symbol, exDate: next.nextEx } : null;
}

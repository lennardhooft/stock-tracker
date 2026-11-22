/* Realised gains & tax-year overview (CLAUDE.md 13.15 C) — pure, tested in tests/js/tax.test.mjs.
 * For the owner's own administration: no tax amount is calculated. Amounts in EUR, converted at the
 * trade's own rate (fx_rate) when known, otherwise today's rate (flagged `approx`). */
import { COSTS } from "./costs.js";

const rateFor = (t, fx) => {
  const cur = t.currency || "EUR";
  if (cur === "EUR") return { rate: 1, approx: false };
  if (t.fx_rate) return { rate: Number(t.fx_rate), approx: false };
  const r = fx?.[cur];
  return { rate: r || null, approx: true };
};

const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at || "").localeCompare(String(b.created_at || ""));

/**
 * Sales with their cost (FIFO lots, or average cost) and dividends, all in EUR.
 * Returns {sales: [{date, year, symbol, qty, proceeds, cost, gain, acquired, fromStart, approx}],
 *          dividends: [{date, year, symbol, gross, withholding, net, approx}],
 *          costs: [{date, year, kind, fees, taxes, approx}]}
 */
export function realised(transactions, fx, method = COSTS.capital_gains.method) {
  const lots = new Map(); // symbol → [{date, qty, unit (EUR per share incl. costs), fromStart}]
  const out = { sales: [], dividends: [], costs: [] };
  for (const t of [...(transactions || [])].sort(byDate)) {
    const sym = String(t.symbol).toUpperCase();
    const q = Number(t.quantity) || 0;
    const p = Number(t.price) || 0;
    const fees = Number(t.fees) || 0;
    const taxes = Number(t.taxes) || 0;
    const { rate, approx } = rateFor(t, fx);
    if (!rate) continue;
    const year = Number(String(t.date).slice(0, 4));
    if (t.kind === "dividend") {
      out.dividends.push({ date: t.date, year, symbol: sym, gross: (q * p) / rate, withholding: taxes / rate, net: (q * p - taxes) / rate, approx });
      continue;
    }
    if (t.kind === "buy" || t.kind === "sell") out.costs.push({ date: t.date, year, kind: t.kind, fees: fees / rate, taxes: taxes / rate, approx });
    const list = lots.get(sym) || [];
    if (t.kind === "buy" || t.kind === "start") {
      if (q > 0) list.push({ date: t.date, qty: q, unit: (q * p + fees + taxes) / q / rate, fromStart: t.kind === "start", approx });
      lots.set(sym, list);
      continue;
    }
    if (t.kind !== "sell") continue;
    const owned = list.reduce((s, l) => s + l.qty, 0);
    const sellQ = Math.min(q, owned);
    if (sellQ <= 0) continue;
    if (method === "average") {
      const unit = list.reduce((s, l) => s + l.qty * l.unit, 0) / owned;
      const keep = owned - sellQ;
      const first = list[0];
      list.splice(0, list.length, ...(keep > 1e-9 ? [{ ...first, qty: keep, unit }] : []));
      out.sales.push(sale(t, year, sym, sellQ, p, fees, taxes, rate, sellQ * unit, first.date, first.fromStart, approx || first.approx));
    } else {
      let left = sellQ;
      let cost = 0;
      const first = list[0];
      let fromStart = false;
      let lotApprox = false;
      while (left > 1e-9 && list.length) {
        const l = list[0];
        const take = Math.min(left, l.qty);
        cost += take * l.unit;
        fromStart ||= l.fromStart;
        lotApprox ||= l.approx;
        l.qty -= take;
        left -= take;
        if (l.qty <= 1e-9) list.shift();
      }
      out.sales.push(sale(t, year, sym, sellQ, p, fees, taxes, rate, cost, first.date, fromStart, approx || lotApprox));
    }
    lots.set(sym, list);
  }
  return out;
}

function sale(t, year, symbol, qty, price, fees, taxes, rate, cost, acquired, fromStart, approx) {
  // proceeds of the part sold (if more was sold than owned, costs are split pro rata)
  const share = qty / (Number(t.quantity) || qty);
  const proceeds = (qty * price - (fees + taxes) * share) / rate;
  return { date: t.date, year, symbol, qty, proceeds, cost, gain: proceeds - cost, acquired, fromStart, approx };
}

/** Totals per calendar year. Returns {years: [newest first], by: {year: {...}}}. */
export function yearReport(transactions, fx, method) {
  const r = realised(transactions, fx, method);
  const by = {};
  const y = (k) => (by[k] ??= { sales: [], dividends: [], gains: 0, losses: 0, net: 0, divGross: 0, divWithholding: 0, divNet: 0, tob: 0, fees: 0, approx: false });
  for (const s of r.sales) {
    const b = y(s.year);
    b.sales.push(s);
    if (s.gain >= 0) b.gains += s.gain; else b.losses += s.gain;
    b.net += s.gain;
    b.approx ||= s.approx;
  }
  for (const d of r.dividends) {
    const b = y(d.year);
    b.dividends.push(d);
    b.divGross += d.gross;
    b.divWithholding += d.withholding;
    b.divNet += d.net;
    b.approx ||= d.approx;
  }
  for (const c of r.costs) {
    const b = y(c.year);
    b.tob += c.taxes;
    b.fees += c.fees;
    b.approx ||= c.approx;
  }
  for (const t of transactions || []) y(Number(String(t.date).slice(0, 4)));
  return { years: Object.keys(by).map(Number).sort((a, b) => b - a), by };
}

/** CSV for a spreadsheet (Belgian Excel: ";" between fields, "," for decimals). */
export function toCsv(rows, { decimalComma = true } = {}) {
  const cell = (v) => {
    if (v == null) return "";
    if (typeof v === "number") {
      const s = (Math.round(v * 100) / 100).toFixed(2);
      return decimalComma ? s.replace(".", ",") : s;
    }
    const s = String(v);
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

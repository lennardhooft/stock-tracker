/* Portfolio maths (CLAUDE.md 13.13.3) — pure functions, tested in tests/js/portfolio.test.mjs.
 * Positions come from the transactions table (buy / sell / starting position), average-cost method.
 * Money in EUR: fx = {USD: 1.08} means 1 EUR = 1.08 USD. Realised gains per tax rules come in 3C. */

export const BUCKET = {
  broad_etf: "core", bond_etf: "core", sector_etf: "satellite", stock: "satellite", other: "satellite",
  speculative: "speculative", crypto: "speculative",
};

/** Amount in `currency` → EUR, using today's rate (EUR itself → as is). */
export function toEur(amount, currency, fx) {
  if (amount == null) return null;
  if (!currency || currency === "EUR") return amount;
  const r = fx?.[currency];
  return r ? amount / r : null;
}

/** Transactions → positions {symbol, qty, currency, avgCost (per share, incl. fees, trade currency), costEur, realised}. */
export function positions(transactions) {
  const by = new Map();
  const sorted = [...(transactions || [])].sort((a, b) => a.date.localeCompare(b.date) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const t of sorted) {
    if (t.kind === "dividend") continue; // income, not a change in what you own (see lib/dividends.js)
    const sym = t.symbol.toUpperCase();
    const p = by.get(sym) || { symbol: sym, qty: 0, cost: 0, costEur: 0, currency: t.currency, realised: 0, realisedEur: 0, firstDate: t.date, trades: 0 };
    const rate = t.fx_rate || null; // units per EUR at the trade, if known
    const extra = (Number(t.fees) || 0) + (Number(t.taxes) || 0);
    if (t.kind === "buy" || t.kind === "start") {
      const c = t.quantity * t.price + extra;
      p.qty += Number(t.quantity);
      p.cost += c;
      p.costEur += rate ? c / rate : t.currency === "EUR" ? c : NaN; // NaN → valued with today's rate later
    } else if (t.kind === "sell" && p.qty > 0) {
      const q = Math.min(Number(t.quantity), p.qty);
      const avg = p.cost / p.qty;
      const avgEur = p.costEur / p.qty;
      const proceeds = q * t.price - extra;
      p.realised += proceeds - q * avg;
      if (rate) p.realisedEur += proceeds / rate - q * avgEur;
      p.cost -= q * avg;
      p.costEur -= q * avgEur;
      p.qty -= q;
    }
    p.trades += 1;
    by.set(sym, p);
  }
  return [...by.values()].map((p) => ({ ...p, avgCost: p.qty > 0 ? p.cost / p.qty : null }));
}

/**
 * Value everything in EUR.
 * rows: watchlist rows {symbol, name, price, currency, change_pct, asset_type, risk{suggested_type, sector, region, vol}, quality, verdict, score…}
 * settings: {cash: {EUR, USD}, emergency_fund}
 * Returns {holdings[], invested, cash, total, dayChange, pl, plPct, cost, buckets{}, alloc{type,sector,region,currency}}.
 */
export function valuePortfolio(transactions, rows, settings, fx) {
  const bySym = Object.fromEntries((rows || []).map((r) => [r.symbol.toUpperCase(), r]));
  const holdings = [];
  for (const p of positions(transactions)) {
    if (p.qty <= 1e-9) continue;
    const r = bySym[p.symbol] || {};
    const priced = r.price != null && !r.error;
    const currency = priced ? r.currency : p.currency;
    const price = priced ? r.price : p.avgCost; // new holding: valued at cost until tonight's update
    const value = toEur(p.qty * price, currency, fx);
    const costEur = Number.isFinite(p.costEur) ? p.costEur : toEur(p.cost, p.currency, fx);
    const type = r.asset_type || r.risk?.suggested_type || "stock";
    const chg = priced && r.change_pct != null ? value - value / (1 + r.change_pct / 100) : 0;
    holdings.push({
      symbol: p.symbol, name: r.name || p.symbol, qty: p.qty, price, currency, priced, value, costEur,
      pl: value != null && costEur != null ? value - costEur : null,
      plPct: value != null && costEur ? (value / costEur - 1) * 100 : null,
      dayChange: chg, change_pct: priced ? r.change_pct : null, type, bucket: BUCKET[type] || "satellite",
      sector: r.risk?.sector || null, region: r.risk?.region || null, row: r,
    });
  }
  const cashIn = settings?.cash || {};
  const cash = Object.entries(cashIn).reduce((s, [cur, v]) => s + (toEur(Number(v) || 0, cur, fx) || 0), 0);
  const invested = holdings.reduce((s, h) => s + (h.value || 0), 0);
  const total = invested + cash;
  const cost = holdings.reduce((s, h) => s + (h.costEur || 0), 0);
  const dayChange = holdings.reduce((s, h) => s + (h.dayChange || 0), 0);
  for (const h of holdings) h.weight = total ? (h.value / total) * 100 : 0;

  const group = (key) => {
    const m = {};
    for (const h of holdings) {
      // broad and bond ETFs spread themselves over many sectors/regions (look-through comes in a later stage)
      const k = (key === "sector" || key === "region") && h.bucket === "core" ? "spread" : h[key] || "unknown";
      m[k] = (m[k] || 0) + h.value;
    }
    if (key === "bucket" || key === "type") m.cash = cash;
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { value: v, pct: total ? (v / total) * 100 : 0 }]));
  };
  const curAlloc = {};
  for (const h of holdings) curAlloc[h.currency] = (curAlloc[h.currency] || 0) + h.value;
  for (const [c, v] of Object.entries(cashIn)) curAlloc[c] = (curAlloc[c] || 0) + (toEur(Number(v) || 0, c, fx) || 0);
  return {
    holdings: holdings.sort((a, b) => b.value - a.value), invested, cash, total, cost, dayChange,
    dayChangePct: total - dayChange ? (dayChange / (total - dayChange)) * 100 : 0,
    pl: invested - cost, plPct: cost ? (invested / cost - 1) * 100 : 0,
    buckets: group("bucket"),
    alloc: {
      type: group("type"), sector: group("sector"), region: group("region"),
      currency: Object.fromEntries(Object.entries(curAlloc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, { value: v, pct: total ? (v / total) * 100 : 0 }])),
    },
  };
}

/** Position cap (%) for one holding under the settings: quality stocks get the higher stock cap. */
export function typeCap(type, qualityScore, settings) {
  const caps = settings.type_caps || {};
  if (type === "stock") return qualityScore != null && qualityScore >= 70 ? caps.stock_quality : caps.stock;
  return caps[type] ?? null;
}

/** Warnings with the rule and what to do (8.10): [{kind, symbol?, key, vars}]. */
export function warnings(pf, settings) {
  const out = [];
  if (!pf.total) return out;
  for (const h of pf.holdings) {
    const cap = typeCap(h.type, h.row?.quality?.score, settings);
    if (cap != null && h.weight > cap + 0.05) out.push({ key: "overCap", symbol: h.symbol, vars: { symbol: h.symbol, weight: h.weight, cap } });
  }
  for (const [sector, v] of Object.entries(pf.alloc.sector)) {
    if (sector !== "unknown" && sector !== "spread" && v.pct > settings.sector_max + 0.05) out.push({ key: "sectorOver", vars: { sector, pct: v.pct, max: settings.sector_max } });
  }
  const sat = pf.buckets.satellite?.pct || 0;
  const spec = pf.buckets.speculative?.pct || 0;
  if (sat + spec > settings.satellite_max + 0.05) out.push({ key: "satelliteOver", vars: { pct: sat + spec, max: settings.satellite_max } });
  if (spec > settings.speculative_max + 0.05) out.push({ key: "speculativeOver", vars: { pct: spec, max: settings.speculative_max } });
  const cashPct = (pf.cash / pf.total) * 100;
  if (cashPct < settings.cash_reserve - 0.05) out.push({ key: "cashLow", vars: { pct: cashPct, min: settings.cash_reserve } });
  return out;
}

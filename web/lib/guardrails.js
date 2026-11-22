/* Guardrails, pre-trade checklist, order costs, impact, decision log, reviews (CLAUDE.md 13.14 C,
 * 13.18) — pure, tested in tests/js/guardrails.test.mjs. Rules: config/guardrails.yaml (copy in
 * guardrails-config.js); fees and taxes: config/costs.yaml (owner verifies them). */
import { GUARDRAILS } from "./guardrails-config.js";
import { COSTS } from "./costs.js";
import { BUCKET, toEur } from "./portfolio.js";

const ETF = new Set(["broad_etf", "sector_etf", "bond_etf"]);
const monthOf = (d) => String(d).slice(0, 7);

/* ------------------------------------------------------------------ FOMO, trade limit, panic sell */
/** {rise, top, byRise, byTop} when buying now looks like chasing, else null. */
export function fomo(row, cfg = GUARDRAILS.fomo) {
  if (!cfg?.enabled || !row) return null;
  const rise = row.metrics?.rise_3m ?? null;
  const top = row.top?.score ?? null;
  const byRise = rise != null && rise >= cfg.rise_3m_pct;
  const byTop = top != null && top >= cfg.top_score_min;
  return byRise || byTop ? { rise, top, byRise, byTop } : null;
}

/** Buys + sells this calendar month vs the limit. */
export function tradeLimit(transactions, today, cfg = GUARDRAILS.trade_limit) {
  const count = (transactions || []).filter((t) => (t.kind === "buy" || t.kind === "sell") && monthOf(t.date) === monthOf(today)).length;
  const max = cfg?.per_month ?? null;
  return { enabled: Boolean(cfg?.enabled), count, max, reached: Boolean(cfg?.enabled) && max != null && count >= max };
}

/** Selling while the stock is far below its high, or the position is far down → ask about the thesis. */
export function panicSell(row, holding, cfg = GUARDRAILS.panic_sell) {
  if (!cfg?.enabled) return false;
  const lim = -cfg.drawdown_pct;
  return (row?.pct_from_52w_high != null && row.pct_from_52w_high <= lim) || (holding?.plPct != null && holding.plPct <= lim);
}

/** A decision that waited its cooling-off time (or is still waiting). */
export function cooling(pending, symbol, now = new Date()) {
  const p = (pending || []).filter((x) => x.symbol === symbol && x.status === "waiting").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!p) return null;
  return { ...p, ready: new Date(p.decide_after) <= now };
}

/** In your plan: owned, a buy level set, a thesis written, or a cooled-off decision. */
export function inPlan({ row, owned, thesis, cooled }) {
  return owned > 0 || row?.buy_below != null || Boolean(thesis?.why) || Boolean(cooled?.ready);
}

/* ------------------------------------------------------------------ order costs */
/** Which fee table applies, from the Yahoo ticker suffix (no suffix = US). null if unknown. */
export function marketFor(symbol) {
  const m = String(symbol || "").toUpperCase().match(/\.[A-Z]{1,3}$/);
  const suffix = m ? m[0] : "";
  for (const [key, mk] of Object.entries(COSTS.broker.markets)) if (mk.suffixes.includes(suffix)) return { key, ...mk };
  return null;
}

/** Broker fee for an order of `value` (in the market's fee currency). */
export function brokerFee(value, mk) {
  for (const [upTo, fee] of mk.tiers) if (value <= upTo) return fee;
  if (mk.rest) return Math.max(mk.rest.min || 0, value * mk.rest.pct);
  if (mk.mid && value <= mk.mid.up_to) return Math.min(mk.mid.max, Math.ceil(value / mk.mid.block) * mk.mid.fee);
  if (mk.high?.pct != null) return value * mk.high.pct;
  return mk.high.base + Math.ceil((value - mk.mid.up_to) / mk.high.block) * mk.high.fee;
}

/** Stock-exchange tax (TOB) in EUR for an order of amountEur. */
export function tob(amountEur, type) {
  const t = ETF.has(type) ? COSTS.tob.etf : COSTS.tob.stock;
  return Math.min(t.max, amountEur * t.rate);
}

/** {fee, tob, fx, total, pct, warn, market, feeKnown, fxIncluded} for buying amountEur of symbol. */
export function orderCosts(amountEur, symbol, type, fx, cfg = GUARDRAILS.checklist) {
  if (!(amountEur > 0)) return null;
  const mk = marketFor(symbol);
  let fee = null;
  if (mk) {
    const rate = mk.currency === "EUR" ? 1 : fx?.[mk.currency];
    if (rate) fee = toEur(brokerFee(amountEur * rate, mk), mk.currency, fx);
  }
  const tax = tob(amountEur, type);
  const fxPct = COSTS.broker.fx_pct;
  const needsFx = mk && mk.currency !== "EUR";
  const fxCost = needsFx && fxPct != null ? amountEur * fxPct : null;
  const total = (fee || 0) + tax + (fxCost || 0);
  const pct = (total / amountEur) * 100;
  return { fee, tob: tax, fx: fxCost, total, pct, warn: pct > cfg.costs_warn_pct, market: mk?.key || null, feeKnown: fee != null, fxIncluded: !needsFx || fxPct != null };
}

/* ------------------------------------------------------------------ order planner */
/** Limit price ideas below today's price: now, nearest support, 200-week average. */
export function limitIdeas(price, { support = null, sma200 = null } = {}) {
  if (!(price > 0)) return [];
  const out = [{ key: "now", price, dist: 0 }];
  for (const [key, p] of [["support", support], ["sma200", sma200]]) {
    if (p > 0 && p < price) out.push({ key, price: p, dist: (p / price - 1) * 100 });
  }
  return out;
}

/** Weights now → after buying amountEur (paid from cash, so the total stays the same). */
export function impact(pf, cand, amountEur) {
  if (!pf?.total || !(amountEur > 0)) return null;
  const tot = pf.total;
  const pos = pf.holdings.find((h) => h.symbol === cand.symbol)?.value || 0;
  const bucket = BUCKET[cand.type] || "satellite";
  const share = (group, key) => (key && pf.alloc[group]?.[key]?.value) || 0;
  const sat = (pf.buckets.satellite?.value || 0) + (pf.buckets.speculative?.value || 0);
  const row = (now) => ({ now: (now / tot) * 100, after: ((now + amountEur) / tot) * 100 });
  return {
    position: row(pos),
    sector: bucket === "core" || !cand.sector ? null : { key: cand.sector, ...row(share("sector", cand.sector)) },
    region: bucket === "core" || !cand.region ? null : { key: cand.region, ...row(share("region", cand.region)) },
    currency: { key: cand.currency || "EUR", ...row(pf.alloc.currency?.[cand.currency || "EUR"]?.value || 0) },
    satellite: bucket === "core" ? { now: (sat / tot) * 100, after: (sat / tot) * 100 } : row(sat),
    cashAfter: pf.cash - amountEur,
  };
}

/* ------------------------------------------------------------------ checklist */
/**
 * Items [{key, state: ok | warn | na, vars}] for the pre-trade checklist.
 * ctx: {row, type, owned, thesis, cooled, res (sizeFor result), amount, trades (tradeLimit), earningsDays, fomoHit}
 */
export function checklist(c, cfg = GUARDRAILS.checklist) {
  const items = [];
  const plan = inPlan(c);
  items.push({ key: "plan", state: plan ? "ok" : "warn" });
  if (c.type === "stock" || c.type === "speculative") {
    const q = c.row?.quality?.score;
    items.push({ key: "quality", state: q == null ? "na" : q >= cfg.quality_min ? "ok" : "warn", vars: { q, min: cfg.quality_min } });
  }
  items.push({ key: "thesis", state: c.thesis?.why ? "ok" : "warn" });
  const d = c.earningsDays;
  items.push({ key: "earnings", state: d != null && d >= 0 && d <= cfg.earnings_days ? "warn" : "ok", vars: { days: d } });
  if (GUARDRAILS.fomo.enabled) items.push({ key: "fomo", state: c.fomoHit ? "warn" : "ok", vars: { rise: c.fomoHit?.rise, top: c.fomoHit?.top } });
  if (c.trades?.enabled) items.push({ key: "trades", state: c.trades.reached ? "warn" : "ok", vars: { n: c.trades.count, max: c.trades.max } });
  const room = c.res?.room ?? 0;
  items.push({ key: "sizing", state: !(c.amount > 0) ? "na" : c.amount <= room + 0.5 ? "ok" : "warn", vars: { room, amount: c.amount } });
  const head = (k) => c.res?.rules?.find((r) => r.key === k);
  for (const k of ["sector", "region"]) {
    const r = head(k);
    if (r) items.push({ key: k, state: r.room > 0 ? "ok" : "warn", vars: { room: r.room, name: r.vars?.sector || r.vars?.region || "" } });
  }
  return items;
}

/* ------------------------------------------------------------------ decision log, reviews */
/** What the app knew when you decided (stored with the trade). */
export function snapshot(row) {
  if (!row) return null;
  return {
    price: row.price ?? null, currency: row.currency ?? null, score: row.score ?? null, top: row.top?.score ?? null,
    quality: row.quality?.score ?? null, verdict: row.verdict ?? null, from_high: row.pct_from_52w_high ?? null,
  };
}

const addMonths = (iso, n) => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/** Reviews that are due (or overdue) and not done: [{tx, due: "3m", date}], oldest first. */
export function reviewsDue(transactions, reviews, today, cfg = GUARDRAILS.reviews) {
  if (!cfg?.enabled) return [];
  const done = new Set((reviews || []).map((r) => `${r.transaction_id}:${r.due}`));
  const out = [];
  for (const tx of transactions || []) {
    if (tx.kind !== "buy" && tx.kind !== "sell") continue;
    for (const m of cfg.after_months) {
      const date = addMonths(tx.date, m);
      if (date <= today && !done.has(`${tx.id}:${m}m`)) out.push({ tx, due: `${m}m`, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Result since the decision, in the trade's currency (%). Buys: price now vs then; sells: what you avoided. */
export function resultSince(tx, priceNow) {
  if (!(priceNow > 0) || !(tx.price > 0)) return null;
  const r = (priceNow / tx.price - 1) * 100;
  return tx.kind === "sell" ? -r : r;
}

/** Per feeling: number of decisions and the average result since (13.14 C "results per tag"). */
export function byEmotion(transactions, rows) {
  const price = Object.fromEntries((rows || []).map((r) => [r.symbol, r.price]));
  const out = {};
  for (const tx of transactions || []) {
    if ((tx.kind !== "buy" && tx.kind !== "sell") || !tx.emotion) continue;
    const o = (out[tx.emotion] ??= { n: 0, sum: 0, counted: 0 });
    o.n += 1;
    const r = resultSince(tx, price[tx.symbol]);
    if (r != null) { o.sum += r; o.counted += 1; }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, avg: v.counted ? v.sum / v.counted : null }]));
}

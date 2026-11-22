/* Portfolio risk views (CLAUDE.md 13.11) — pure functions, tested in tests/js/riskview.test.mjs. */

export const STRESS_KEYS = ["gfc", "covid", "y2022"];

/** Groups of holdings that move together: corr > threshold, joined transitively. Returns [[sym…]] (size ≥ 2). */
export function correlatedGroups(symbols, snapshot, threshold = 0.8) {
  const idx = new Map((snapshot?.symbols || []).map((s, i) => [s, i]));
  const held = symbols.filter((s) => idx.has(s));
  const parent = new Map(held.map((s) => [s, s]));
  const find = (s) => (parent.get(s) === s ? s : find(parent.get(s)));
  const pairs = [];
  for (let a = 0; a < held.length; a++) {
    for (let b = a + 1; b < held.length; b++) {
      const v = snapshot.corr[idx.get(held[a])]?.[idx.get(held[b])];
      if (v != null && v > threshold) { parent.set(find(held[b]), find(held[a])); pairs.push([held[a], held[b], v]); }
    }
  }
  const groups = new Map();
  for (const s of held) { const r = find(s); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); }
  return { groups: [...groups.values()].filter((g) => g.length >= 2), pairs };
}

/** Highest correlation of `symbol` with any of `others`. */
export function maxCorrelation(symbol, others, snapshot) {
  const idx = new Map((snapshot?.symbols || []).map((s, i) => [s, i]));
  if (!idx.has(symbol)) return null;
  let best = null;
  for (const o of others) {
    if (o === symbol || !idx.has(o)) continue;
    const v = snapshot.corr[idx.get(symbol)]?.[idx.get(o)];
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

/** Estimated € loss of today's holdings in each crisis (cash 0 %). {key: {loss, pct, proxies, missing}} */
export function stressTest(pf) {
  const out = {};
  for (const k of STRESS_KEYS) {
    let loss = 0; const proxies = []; const missing = [];
    for (const h of pf.holdings) {
      const s = h.row?.risk?.stress;
      const r = s?.[k];
      if (r == null) { missing.push(h.symbol); continue; }
      loss += h.value * r;
      if ((s.proxy || []).includes(k)) proxies.push(h.symbol);
    }
    out[k] = { loss, pct: pf.total ? (loss / pf.total) * 100 : 0, proxies, missing };
  }
  return out;
}

/** Largest position and top-3 share (%). */
export function concentration(pf) {
  const w = pf.holdings.map((h) => h.weight).sort((a, b) => b - a);
  return { largest: pf.holdings[0] || null, top3: w.slice(0, 3).reduce((a, b) => a + b, 0) };
}

/** Is a US or EU market open now (Brussels time, weekdays; holidays not checked)? */
export function marketOpenNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(now).map((x) => [x.type, x.value]));
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  const m = Number(p.hour) * 60 + Number(p.minute);
  return m >= 9 * 60 && m < 22 * 60; // EU 09:00–17:30, US 15:30–22:00
}

/** Rows with live prices applied (price + day change from the previous close). */
export function withLive(rows, live) {
  if (!live) return rows;
  return rows.map((r) => {
    const q = live[r.symbol];
    if (!q || q.price == null) return r;
    return { ...r, price: q.price, change_pct: q.prev_close ? (q.price / q.prev_close - 1) * 100 : r.change_pct, live: true };
  });
}

/* Position sizing engine (CLAUDE.md 13.13.4) — pure and deterministic, tested in tests/js/sizing.test.mjs
 * with the worked example from 13.13.5. Never places trades; every number says which rule set it. */
import { BUCKET, typeCap } from "./portfolio.js";

/**
 * pf: valuePortfolio() result (total, cash, holdings, buckets, alloc)
 * c: candidate {symbol, type, vol, max_dd, quality (0–100|null), verdict, sector, region, earnings_in_days}
 * s: settings (risk_per_position, k, satellite_max, speculative_max, cash_reserve, type_caps, sector_max, region_max,
 *    multipliers, typical_vol)
 * Returns {total, owned, maxPosition, room, limiting, rules[], calc{}, notes[]}; rules = [{key, room, cap?, vars}].
 */
export function sizeFor(pf, c, s) {
  const total = pf.total;
  const owned = pf.holdings.find((h) => h.symbol === c.symbol)?.value || 0;
  const type = c.type || "stock";
  const bucket = BUCKET[type] || "satellite";
  const notes = [];

  // ---- 1. risk per position: max loss ÷ bad-case drop, adjusted for quality and verdict
  let vol = c.vol;
  if (vol == null || !(vol > 0)) { vol = s.typical_vol?.[type] ?? 0.35; notes.push("typicalVol"); }
  let bad = s.k * vol;
  if (c.max_dd != null && c.max_dd > 0 && c.max_dd < bad) { bad = c.max_dd; notes.push("cappedByDrawdown"); }
  bad = Math.min(Math.max(bad, 0.05), 1);
  const maxLoss = total * (s.risk_per_position / 100);
  const base = maxLoss / bad;
  const m = s.multipliers || {};
  const isStock = type === "stock";
  let qMult = 1;
  if (isStock && c.quality != null) qMult = c.quality >= 70 ? m.quality_high : c.quality >= 40 ? m.quality_medium : m.quality_low;
  const vMult = c.verdict === "sale" ? m.verdict_sale : c.verdict === "trap" ? m.verdict_trap : 1;
  const cMult = c.correlated ? m.correlated : 1;
  const riskAmount = base * qMult * vMult * cMult;
  const rules = [{ key: "risk", room: riskAmount - owned, cap: riskAmount, vars: { pct: s.risk_per_position } }];

  // ---- 2. type cap (one position)
  const capPct = typeCap(type, c.quality, s);
  if (capPct != null) rules.push({ key: "typeCap", room: (total * capPct) / 100 - owned, cap: (total * capPct) / 100, vars: { pct: capPct, type } });

  // ---- 3. sector / region headroom (broad and bond ETFs don't count: they spread themselves)
  if (bucket !== "core" && c.sector) {
    const used = pf.alloc.sector?.[c.sector]?.value || 0;
    rules.push({ key: "sector", room: (total * s.sector_max) / 100 - used, vars: { sector: c.sector, pct: s.sector_max } });
  }
  if (bucket !== "core" && c.region && s.region_max != null) {
    const used = pf.alloc.region?.[c.region]?.value || 0;
    rules.push({ key: "region", room: (total * s.region_max) / 100 - used, vars: { region: c.region, pct: s.region_max } });
  }

  // ---- 4. core–satellite split
  const satUsed = (pf.buckets.satellite?.value || 0) + (pf.buckets.speculative?.value || 0);
  if (bucket !== "core") rules.push({ key: "satellite", room: (total * s.satellite_max) / 100 - satUsed, vars: { pct: s.satellite_max } });
  if (bucket === "speculative") {
    rules.push({ key: "speculative", room: (total * s.speculative_max) / 100 - (pf.buckets.speculative?.value || 0), vars: { pct: s.speculative_max } });
  }

  // ---- 5. cash you can actually use (minus the reserve)
  rules.push({ key: "cash", room: pf.cash - (total * s.cash_reserve) / 100, vars: { pct: s.cash_reserve } });

  let limiting = rules[0];
  for (const r of rules) if (r.room < limiting.room) limiting = r;
  const room = Math.max(0, limiting.room);
  if (c.earnings_in_days != null && c.earnings_in_days >= 0 && c.earnings_in_days <= 7) notes.push("earningsSoon");
  return {
    total, owned, room, maxPosition: owned + room, limiting: limiting.key, limitingCap: limiting.cap ?? null, rules,
    calc: { maxLoss, vol, k: s.k, bad, base, qMult, vMult, cMult, riskAmount },
    notes,
  };
}

/** Staged buy plan (13.13.5): split the room in 3 — now, nearest support, 200-week average (or −20 % / −30 %). */
export function stagedPlan(room, price, { support = null, sma200 = null } = {}) {
  if (!(room > 0) || !(price > 0)) return [];
  const part = room / 3;
  const levels = [];
  if (support && support < price) levels.push({ at: support, why: "support" });
  if (sma200 && sma200 < price * 0.98 && !levels.some((l) => Math.abs(l.at / sma200 - 1) < 0.03)) levels.push({ at: sma200, why: "sma200" });
  for (const d of [0.8, 0.7]) if (levels.length < 2) levels.push({ at: price * d, why: d === 0.8 ? "minus20" : "minus30" });
  levels.sort((a, b) => b.at - a.at);
  return [{ at: null, why: "now", amount: part }, ...levels.slice(0, 2).map((l) => ({ ...l, amount: part }))];
}

/** Does `amount` fit? {fits, over} */
export function check(amount, result) {
  if (!(amount > 0)) return null;
  return amount <= result.room + 0.5 ? { fits: true, over: 0 } : { fits: false, over: amount - result.room };
}

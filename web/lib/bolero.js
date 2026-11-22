/* Bolero position overview → positions (CLAUDE.md 13.12; format: docs/importers/bolero.md).
 * Pure: takes the sheet as rows of cells (SheetJS sheet_to_json(header: 1)). Runs in the browser only;
 * only the fields below are kept — the file itself is never uploaded or stored. */

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const HEADERS = {
  type: (h) => h === "type",
  currency: (h) => h === "munt",
  qty: (h) => h === "aantal",
  name: (h) => h === "naam",
  avgPrice: (h) => h.startsWith("gem. aankoopkoers") || h.startsWith("gemiddelde aankoopkoers"),
  valueEur: (h) => h === "waarde in eur",
  market: (h) => h === "markt",
  isin: (h) => h.includes("isin"),
};

const num = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  // text numbers are in Belgian notation (Bolero): "." = thousands, "," = decimals
  return Number(s.replace(/\./g, "").replace(",", "."));
};

/** Yahoo-friendly type suggestion from Bolero's type + name. */
export function suggestType(boleroType, name) {
  const t = norm(boleroType);
  if (t.startsWith("etf") || t.includes("tracker")) {
    if (/\b(bond|obligat|treasur|aggregate|govt)\b/i.test(name)) return "bond_etf";
    if (/\b(all[- .]?wor|world|wld|a\.?c\.?w\.?i|s&p ?500|msci w)/i.test(name) && !/\b(sector|tech|robot|semi|health|energy|clean|div)/i.test(name)) return "broad_etf";
    return "sector_etf";
  }
  if (t.includes("crypto")) return "crypto";
  return "stock";
}

/**
 * rows: array of arrays (cells). Returns {positions: [{type, currency, qty, name, avgPrice, market, isin, suggested}], cash}.
 * Throws Error with .code "not_bolero" when the header isn't found, "empty" when there are no positions.
 */
export function parseBolero(rows) {
  const headerAt = rows.findIndex((r) => (r || []).some((c) => norm(c) === "naam") && (r || []).some((c) => norm(c) === "type"));
  if (headerAt < 0) throw Object.assign(new Error("not a Bolero position overview"), { code: "not_bolero" });
  const col = {};
  rows[headerAt].forEach((c, i) => {
    const h = norm(c);
    for (const [k, test] of Object.entries(HEADERS)) if (col[k] == null && h && test(h)) col[k] = i;
  });
  for (const k of ["type", "currency", "qty", "name", "avgPrice"]) {
    if (col[k] == null) throw Object.assign(new Error(`column missing: ${k}`), { code: "not_bolero" });
  }
  const positions = [];
  let cash = null;
  let blank = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const type = String(r?.[col.type] ?? "").trim();
    if (!type) { if (++blank > 3 && positions.length) break; continue; }
    blank = 0;
    if (norm(type) === "cash") {
      const v = num(r[col.valueEur ?? -1]);
      if (Number.isFinite(v)) cash = (cash || 0) + v;
      continue;
    }
    const qty = num(r[col.qty]);
    const avgPrice = num(r[col.avgPrice]);
    const name = String(r[col.name] ?? "").trim();
    if (!name || !(qty > 0)) continue;
    positions.push({
      type, name, qty, avgPrice: Number.isFinite(avgPrice) ? avgPrice : null,
      currency: String(r[col.currency] ?? "").trim().toUpperCase() || "EUR",
      market: col.market != null ? String(r[col.market] ?? "").trim() : "",
      isin: col.isin != null ? String(r[col.isin] ?? "").trim().toUpperCase() : "",
      suggested: suggestType(type, name),
    });
  }
  if (!positions.length && cash == null) throw Object.assign(new Error("no positions"), { code: "empty" });
  return { positions, cash };
}

/* Broker name → Yahoo ticker matching helpers (Bolero importer, docs/importers/bolero.md).
 * Pure. The lookup-symbols Edge Function contains an exact copy of the block between the
 * SHARED markers (tests/js/symbolmatch.test.mjs checks they're identical). */

/*SHARED*/
// Bolero market name → Yahoo exchange codes (first = preferred)
const MARKETS = [
  [/usa|nyse|nasdaq|united states/i, ["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"]],
  [/xetra/i, ["GER"]],
  [/frankfurt/i, ["GER", "FRA"]],
  [/amsterdam/i, ["AMS"]],
  [/paris/i, ["PAR"]],
  [/brussel/i, ["BRU"]],
  [/lissabon|lisbon/i, ["LIS"]],
  [/toronto|tsx/i, ["TOR", "VAN", "NEO", "CNQ"]],
  [/london|londen/i, ["LSE"]],
  [/milan|milaan/i, ["MIL"]],
  [/madrid/i, ["MCE"]],
  [/swiss|zwitserland|six|zurich/i, ["EBS"]],
  [/kopenhagen|copenhagen/i, ["CPH"]],
  [/stockholm/i, ["STO"]],
  [/helsinki/i, ["HEL"]],
  [/oslo/i, ["OSL"]],
  [/wenen|vienna/i, ["VIE"]],
];
// Bolero abbreviates long fund and company names; Yahoo search needs the full words
const ABBR = {
  ISHS: "ISHARES", ISH: "ISHARES", ISHR: "ISHARES", WLD: "WORLD", WRLD: "WORLD", VANG: "VANGUARD",
  XTR: "XTRACKERS", XTRA: "XTRACKERS", AMUN: "AMUNDI", GLB: "GLOBAL", GLBL: "GLOBAL", INFO: "INFORMATION",
  TECH: "TECHNOLOGY", SEMICOND: "SEMICONDUCTOR", SEMIC: "SEMICONDUCTOR", HLTH: "HEALTH", HLTHC: "HEALTHCARE",
  EMERG: "EMERGING", EM: "EMERGING", MKT: "MARKETS", MKTS: "MARKETS", DEV: "DEVELOPED", EUROP: "EUROPE",
  DIV: "DIVIDEND", DIVID: "DIVIDEND", SMCAP: "SMALL CAP", INTL: "INTERNATIONAL", TECHN: "TECHNOLOGY",
};
// words that don't identify the company or fund
const STOP = new Set(["INC", "CORP", "CORPORATION", "CO", "SA", "NV", "PLC", "AG", "SE", "LTD", "CLASS", "A", "B", "C",
  "ORD", "SHS", "REG", "ACC", "DIST", "DIS", "UCITS", "ETF", "USD", "EUR", "GBP", "THE", "HLDGS", "HOLDINGS", "HOLD",
  "GROUP", "CL", "CAP", "1C", "1D", "C1", "D", "DR", "ADR", "COM", "N", "S"]);

const tokens = (s) => String(s || "").toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean);
const expand = (s) => tokens(s).flatMap((t) => (ABBR[t] || t).split(" "));

/** Yahoo exchange codes for a broker market name, preferred first ([] if unknown). */
function prefFor(market) {
  return MARKETS.find(([re]) => re.test(market || ""))?.[1] || [];
}

/** Search texts to try, from most to least specific. */
function searchVariants(name) {
  const full = expand(name);
  const core = full.filter((t) => !STOP.has(t));
  const out = [String(name || "").trim(), full.join(" "), core.join(" "), core.slice(0, 3).join(" "), core.slice(0, 2).join(" "), core[0] || ""];
  return [...new Set(out.filter(Boolean))];
}

/** Share of the broker name's meaningful words found in the candidate's name (0..1). */
function nameMatch(brokerName, candName) {
  const a = new Set(expand(brokerName).filter((t) => !STOP.has(t)));
  if (!a.size) return 0;
  const b = new Set(expand(candName));
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return Math.round((n / a.size) * 100) / 100;
}

/** Order candidates: right exchange, then right currency, then name match, then Yahoo's order. */
function rankCandidates(cands, { name, market, currency }) {
  const pref = prefFor(market);
  const seen = new Set();
  const uniq = cands.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
  const ex = (c) => { const i = pref.indexOf(c.exchange); return i === -1 ? 99 : i; };
  const scored = uniq.map((c, i) => ({ ...c, match: nameMatch(name, c.name), _i: i }));
  scored.sort((a, b) => ex(a) - ex(b)
    || Number(Boolean(currency) && b.currency === currency) - Number(Boolean(currency) && a.currency === currency)
    || b.match - a.match || a._i - b._i);
  return scored.map(({ _i, ...c }) => c);
}

/** The ticker to suggest: on the broker's exchange (when known), with prices on Yahoo. */
function pickBest(ranked, market) {
  const pref = prefFor(market);
  const ok = ranked.filter((c) => c.priced !== false && (!pref.length || pref.includes(c.exchange)));
  return ok[0]?.symbol || null;
}
/*END*/

export { MARKETS, ABBR, STOP, tokens, expand, prefFor, searchVariants, nameMatch, rankCandidates, pickBest };

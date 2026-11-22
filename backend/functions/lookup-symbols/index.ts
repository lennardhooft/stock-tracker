// @ts-nocheck — the matching block below is an exact copy of web/lib/symbolmatch.js (plain JS, tested there).
// Supabase Edge Function "lookup-symbols": match broker rows to Yahoo tickers (Bolero importer).
//
// POST {items: [{isin?, name?, market?, currency?}]} (max 60)
//   → {results: [{best, candidates: [{symbol, name, exchange, type, currency, priced, match}]}]}
// - Only a logged-in user may call it. Only ISIN / name / market / currency are sent, never quantities or amounts.
// - Bolero exports have no ISIN, and its names are abbreviated ("ISHS CORE MSCI WLD"). So: try the ISIN, then the
//   name in simpler forms (abbreviations spelled out, fewer words). If nothing is found on the broker's exchange,
//   take Yahoo's own full name of the closest match on another exchange and search again with it (ETFs are often
//   found on London first). Every suggestion is checked for prices on Yahoo; the owner confirms every row.
// - Logs counts only.
// Deploy: dashboard → Edge Functions → "lookup-symbols" → paste, Verify JWT OFF (own check below).

const ALLOWED_ORIGINS = ["https://stock-tracker-dgz.pages.dev", "http://localhost:8000"];
const UA = { "User-Agent": "Mozilla/5.0 (bottom-tracker)" };

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

function cors(origin) {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".stock-tracker-dgz.pages.dev")) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function loggedIn(req) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!token) return false;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey } });
  return r.ok && Boolean((await r.json())?.id);
}

const searchCache = new Map();
async function search(q) {
  if (!q) return [];
  if (searchCache.has(q)) return searchCache.get(q);
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, { headers: UA });
  const out = !r.ok ? [] : ((await r.json())?.quotes || [])
    .filter((x) => ["EQUITY", "ETF"].includes(x.quoteType) && x.symbol && !x.symbol.includes("="))
    .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || "", exchange: x.exchange || "", type: x.quoteType }));
  searchCache.set(q, out);
  return out;
}

/** {priced, currency} from Yahoo's chart endpoint (a ticker without prices is useless for the app). */
async function priceInfo(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
    if (!r.ok) return { priced: false, currency: null };
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    return { priced: typeof m?.regularMarketPrice === "number", currency: m?.currency || null };
  } catch {
    return { priced: false, currency: null };
  }
}

async function lookup(it) {
  const pref = prefFor(it.market);
  const onPref = (cs) => cs.some((c) => !pref.length || pref.includes(c.exchange));
  const pool = [];
  const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(it.isin || "") ? it.isin : "";
  if (isin) pool.push(...(await search(isin)));
  if (!onPref(pool)) {
    for (const q of searchVariants(String(it.name || "").slice(0, 80))) {
      const found = await search(q);
      pool.push(...found);
      if (onPref(found)) break;
    }
  }
  if (!onPref(pool) && pool.length) {
    // second step: Yahoo's own name of the closest matches, searched again to find the right exchange
    const closest = rankCandidates(pool, { name: it.name, market: "" }).slice(0, 3);
    for (const c of closest) {
      if (!c.name) continue;
      const found = await search(c.name);
      pool.push(...found);
      if (onPref(found)) break;
    }
  }
  let ranked = rankCandidates(pool, it).slice(0, 6);
  const info = await Promise.all(ranked.map((c) => priceInfo(c.symbol)));
  ranked = rankCandidates(ranked.map((c, i) => ({ ...c, ...info[i] })), it);
  return { best: pickBest(ranked, it.market), candidates: ranked };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method" }, 405, headers);
  if (!(await loggedIn(req))) return json({ error: "not_logged_in" }, 401, headers);

  const body = await req.json().catch(() => ({}));
  const items = (body?.items || []).slice(0, 60);
  const results = await Promise.all(items.map(async (it) => {
    try {
      return await lookup({ isin: it?.isin, name: it?.name, market: it?.market, currency: it?.currency });
    } catch {
      return { best: null, candidates: [] };
    }
  }));
  console.log("lookup-symbols:", results.filter((r) => r.best).length, "of", items.length, "matched"); // counts only
  return json({ results }, 200, headers);
});

// Supabase Edge Function "lookup-symbols": match broker rows to Yahoo tickers (Bolero importer), Phase 3E.
//
// POST {items: [{isin?, name?, market?}]} (max 60) → {results: [{best, candidates: [{symbol, name, exchange, type}]}]}
// - Only a logged-in user may call it. Only ISIN / name / market are sent — never quantities or amounts.
// - Strategy: search Yahoo by ISIN, then by the broker's name; keep stocks and ETFs; prefer the listing on
//   the exchange the broker says (Bolero "Markt"). The owner confirms every row in the app before saving.
// - Logs counts only.
// Deploy: dashboard → Edge Functions → new function "lookup-symbols", paste, Verify JWT OFF (own check below).

const ALLOWED_ORIGINS = ["https://stock-tracker-dgz.pages.dev", "http://localhost:8000"];

// Bolero market name → Yahoo exchange codes (first = preferred)
const MARKETS: [RegExp, string[]][] = [
  [/usa|nyse|nasdaq|united states/i, ["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS"]],
  [/xetra/i, ["GER"]],
  [/frankfurt/i, ["GER", "FRA"]],
  [/amsterdam/i, ["AMS"]],
  [/paris/i, ["PAR"]],
  [/brussel/i, ["BRU"]],
  [/lissabon|lisbon/i, ["LIS"]],
  [/toronto|tsx/i, ["TOR"]],
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

function cors(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".stock-tracker-dgz.pages.dev")) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

async function loggedIn(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!token) return false;
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey } });
  return r.ok && Boolean((await r.json())?.id);
}

type Cand = { symbol: string; name: string; exchange: string; type: string };

async function search(q: string): Promise<Cand[]> {
  if (!q) return [];
  const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`, {
    headers: { "User-Agent": "Mozilla/5.0 (bottom-tracker)" },
  });
  if (!r.ok) return [];
  return ((await r.json())?.quotes || [])
    .filter((x: Record<string, string>) => ["EQUITY", "ETF"].includes(x.quoteType) && x.symbol && !x.symbol.includes("="))
    .map((x: Record<string, string>) => ({ symbol: x.symbol, name: x.longname || x.shortname || "", exchange: x.exchange || "", type: x.quoteType }));
}

/** Pick the best candidate: right exchange first (in the order of preference), then the search order. */
export function rank(cands: Cand[], market: string | undefined): { best: string | null; candidates: Cand[] } {
  const seen = new Set<string>();
  const uniq = cands.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
  const pref = MARKETS.find(([re]) => re.test(market || ""))?.[1] || [];
  const score = (c: Cand) => { const i = pref.indexOf(c.exchange); return i === -1 ? 99 : i; };
  const sorted = [...uniq].sort((a, b) => score(a) - score(b));
  const best = sorted[0] && (score(sorted[0]) < 99 || !pref.length) ? sorted[0].symbol : null;
  return { best, candidates: sorted.slice(0, 6) };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method" }, 405, headers);
  if (!(await loggedIn(req))) return json({ error: "not_logged_in" }, 401, headers);

  const body = await req.json().catch(() => ({}));
  const items = (body?.items || []).slice(0, 60);
  const results = await Promise.all(items.map(async (it: { isin?: string; name?: string; market?: string }) => {
    try {
      const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(it.isin || "") ? it.isin! : "";
      const byIsin = isin ? await search(isin) : [];
      const byName = await search(String(it.name || "").slice(0, 80));
      return rank([...byIsin, ...byName], it.market);
    } catch {
      return { best: null, candidates: [] };
    }
  }));
  console.log("lookup-symbols:", results.filter((r) => r.best).length, "of", items.length, "matched"); // counts only
  return json({ results }, 200, headers);
});

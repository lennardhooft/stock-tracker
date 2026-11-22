// Supabase Edge Function "quotes": live prices for the Portfolio page (CLAUDE.md 13.13.3), Phase 3B.
//
// POST {symbols: ["NVDA", "ASML.AS", ...]} (max 60) → {quotes: {SYM: {price, prev_close, currency, time}}}
// - Only a logged-in user of this project may call it (same check as run-update).
// - Prices from Yahoo's chart endpoint; EU prices are delayed ~15 min on free data.
// - Logs counts only, never symbols (they reveal holdings).
// Deploy: dashboard → Edge Functions → new function "quotes", paste, Verify JWT OFF (own check below).

const ALLOWED_ORIGINS = ["https://stock-tracker-dgz.pages.dev", "http://localhost:8000"];
const SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;

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

async function quote(symbol: string) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m`, {
    headers: { "User-Agent": "Mozilla/5.0 (bottom-tracker)" },
  });
  if (!r.ok) return null;
  const m = (await r.json())?.chart?.result?.[0]?.meta;
  if (!m || typeof m.regularMarketPrice !== "number") return null;
  return {
    price: m.regularMarketPrice,
    prev_close: m.chartPreviousClose ?? m.previousClose ?? null,
    currency: m.currency ?? null,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

Deno.serve(async (req) => {
  const headers = cors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "method" }, 405, headers);
  if (!(await loggedIn(req))) return json({ error: "not_logged_in" }, 401, headers);

  const body = await req.json().catch(() => ({}));
  const symbols = [...new Set((body?.symbols || []).map((s: string) => String(s).toUpperCase()))]
    .filter((s) => SYMBOL.test(s as string)).slice(0, 60) as string[];
  const out: Record<string, unknown> = {};
  await Promise.all(symbols.map(async (s) => {
    try { const q = await quote(s); if (q) out[s] = q; } catch { /* one symbol must not fail the rest */ }
  }));
  console.log("quotes:", Object.keys(out).length, "of", symbols.length); // counts only
  return json({ quotes: out, at: new Date().toISOString() }, 200, headers);
});

/* Telegram webhook (Supabase Edge Function "telegram-bot"). Read-only; answers ONLY the owner's chat.
 * - Telegram sends the secret header we registered (derived from the bot token: sha256("<token>:webhook")),
 *   so nobody else can call this function with fake messages.
 * - Data is read with the service role key that Supabase gives every function; only the owner's rows.
 * - Logs the command name only (never tickers, amounts or replies).
 * Secrets (Edge Functions → Secrets): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. Verify JWT: OFF. */
import { parseCommand, needs, answer } from "./core.js";

const APP_URL = "https://stock-tracker-dgz.pages.dev";

export async function webhookSecret(token) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${token}:webhook`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 64);
}

async function rest(path) {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`read ${r.status}`);
  return r.json();
}

/** Only what the command needs, only the owner's rows (single-user app: the watchlist's owner). */
export async function load(parts, symbol) {
  const owner = (await rest("watchlist?select=user_id&limit=1"))[0]?.user_id;
  if (!owner) return { rows: [] };
  const mine = `user_id=eq.${owner}`;
  const data = {};
  if (parts.includes("rows")) {
    const [wl, sc] = await Promise.all([rest(`watchlist?select=*&${mine}`), rest(`latest_scores?select=*&${mine}`)]);
    const by = Object.fromEntries(sc.map((s) => [s.symbol, s]));
    data.rows = wl.map((w) => ({ ...(by[w.symbol.toUpperCase()] || {}), ...w, symbol: w.symbol.toUpperCase() }));
  }
  if (parts.includes("pf")) {
    const [tx, ps, rs, th] = await Promise.all([rest(`transactions?select=*&${mine}&order=date`), rest(`portfolio_settings?select=*&${mine}`),
      rest(`risk_settings?select=*&${mine}`), rest(`thesis?select=*&${mine}`)]);
    data.pf = { transactions: tx, settings: ps[0] || null, risk: rs[0] || null, thesis: th };
  }
  if (parts.includes("market")) data.market = (await rest("market_snapshot?select=data&id=eq.latest"))[0]?.data || null;
  if (parts.includes("macro")) data.macro = (await rest("market_snapshot?select=data&id=eq.macro"))[0]?.data?.events || [];
  if (parts.includes("runs")) data.runs = await rest("job_runs?select=*&job=eq.daily&order=started_at.desc&limit=1");
  if (parts.includes("detail") && symbol) data.detail = (await rest(`ticker_detail?select=weekly,fundamentals&${mine}&symbol=eq.${encodeURIComponent(symbol)}`))[0] || null;
  return data;
}

export async function handle(req) {
  if (req.method !== "POST") return new Response("ok");
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return new Response("not configured", { status: 503 });
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(token))) return new Response("forbidden", { status: 401 });
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg?.text) return new Response("ok");
  if (String(msg.chat?.id) !== String(chat)) { // strangers get no answer at all
    console.log("bot: ignored a message from another chat");
    return new Response("ok");
  }
  const c = parseCommand(msg.text);
  let text;
  try {
    const symbol = /^[A-Z0-9.\-^=]{1,20}$/.test(c.args[0] || "") ? c.args[0] : null;
    if (c.args[0] && !symbol) c.args[0] = "";
    text = answer(c, await load(needs(c.cmd), symbol), { app: APP_URL });
  } catch (e) {
    console.log("bot: failed", c.cmd, e?.message ? "(read error)" : "");
    text = "Sorry, I couldn't read your data just now. Try again in a minute, or open the app.";
  }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  console.log("bot: answered", c.cmd); // command name only
  return new Response("ok");
}

Deno.serve(handle);

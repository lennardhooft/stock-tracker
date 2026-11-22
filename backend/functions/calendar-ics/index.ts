// Supabase Edge Function "calendar-ics": the private calendar feed (CLAUDE.md 13.3).
//
// A phone calendar subscribes to  .../functions/v1/calendar-ics?token=<secret>  (no login possible
// there, so the long random secret in the link is the key). The function asks the database
// function public.calendar_feed(token), which returns only that owner's dates and tickers.
// - The token is never logged. Unknown tokens get a plain 404.
// - Uses the project's public anon key (injected by Supabase); calendar_feed is the only thing it can call
//   that returns owner data, and only with a valid token.
//
// Deploy: Supabase dashboard → Edge Functions → Deploy a new function → name "calendar-ics",
// paste this file, and turn OFF "Verify JWT" (calendar apps can't send a login).

type Earn = { date: string; hour?: string | null; eps_est?: number | null; source?: string | null };
type Div = { ex_date?: string; pay_date?: string | null; amount?: number | null; currency?: string | null; estimated?: boolean };
type Stock = { symbol: string; currency?: string | null; earnings?: Earn | null; dividend?: Div | null };
type Macro = { date: string; kind: string; time?: string; tz?: string; tentative?: boolean };

const NAMES: Record<string, string> = { fomc: "Fed rate decision", ecb: "ECB rate decision" };
const CITY: Record<string, string> = { "America/New_York": "New York", "Europe/Berlin": "Frankfurt" };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const ymd = (d: string) => d.replaceAll("-", "");
const nextDay = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const money = (v: number | null | undefined, cur?: string | null) =>
  v == null ? "" : `${cur === "EUR" ? "€" : cur === "USD" ? "$" : (cur ? cur + " " : "")}${v.toFixed(2).replace(".", ",")}`;

/** RFC 5545 line folding at 75 octets (approximate on characters, safe for ASCII titles). */
const fold = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ");

function event(uid: string, date: string, summary: string, description: string, stamp: string): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}@bottom-tracker`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`,
    `DTEND;VALUE=DATE:${ymd(nextDay(date))}`,
    fold(`SUMMARY:${esc(summary)}`),
    fold(`DESCRIPTION:${esc(description)}`),
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

export function buildIcs(feed: { stocks: Stock[]; macro: Macro[] }, appUrl: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bottom Tracker//calendar//EN", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", "X-WR-CALNAME:Bottom Tracker", "X-WR-TIMEZONE:Europe/Brussels",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const s of feed.stocks || []) {
    const link = `${appUrl}#/ticker/${encodeURIComponent(s.symbol)}`;
    const e = s.earnings;
    if (e?.date) {
      const when = e.hour === "bmo" ? " (before the open)" : e.hour === "amc" ? " (after the close)" : "";
      const est = e.eps_est != null ? `EPS estimate ${e.eps_est.toFixed(2).replace(".", ",")}. ` : "";
      lines.push(...event(`earnings-${s.symbol}-${e.date}`, e.date, `${s.symbol} earnings${when}`,
        `${est}Date can still change. ${link}`, stamp));
    }
    const d = s.dividend;
    if (d?.ex_date) {
      const amt = money(d.amount, d.currency || s.currency);
      lines.push(...event(`exdiv-${s.symbol}-${d.ex_date}`, d.ex_date, `${s.symbol} ex-dividend${amt ? " " + amt : ""}`,
        `${d.estimated ? "Estimated date. " : ""}Own the shares before this day to get the dividend. ${link}`, stamp));
    }
    if (d?.pay_date) {
      lines.push(...event(`paydiv-${s.symbol}-${d.pay_date}`, d.pay_date, `${s.symbol} dividend paid`, link, stamp));
    }
  }
  for (const m of feed.macro || []) {
    const at = m.time && m.tz && CITY[m.tz] ? ` (${m.time} ${CITY[m.tz]})` : "";
    lines.push(...event(`${m.kind}-${m.date}`, m.date, `${NAMES[m.kind] || m.kind}${at}`,
      m.tentative ? "Tentative until confirmed at the previous meeting." : "From the official calendar.", stamp));
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

const APP_URL = "https://stock-tracker-dgz.pages.dev/";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const token = new URL(req.url).searchParams.get("token") || "";
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return new Response("not found", { status: 404 });

  const key = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!r.ok) {
    console.log("calendar-ics: feed query failed", r.status); // never the token
    return new Response("temporarily unavailable", { status: 503 });
  }
  const feed = await r.json();
  if (!feed) return new Response("not found", { status: 404 });
  console.log("calendar-ics: served", (feed.stocks || []).length, "stocks"); // counts only
  return new Response(buildIcs(feed, APP_URL), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bottom-tracker.ics"',
      "Cache-Control": "private, max-age=3600",
    },
  });
});

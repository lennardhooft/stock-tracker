/* Upcoming events (CLAUDE.md 13.3): one list built from the watchlist rows + Fed/ECB dates.
 * Event: {date, kind: earnings|exdiv|paydiv|fomc|ecb, symbol?, hour?, amount?, currency?, estimated?, tentative?, time?} */

export const KIND_GROUP = { earnings: "earnings", exdiv: "dividends", paydiv: "dividends", fomc: "macro", ecb: "macro" };

const iso = (d) => d.toISOString().slice(0, 10);
/** Today in Brussels as YYYY-MM-DD (the owner's day, 8.4). */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(now);
}

export function buildEvents(rows, macro, { from = todayIso(), days = 92 } = {}) {
  const end = iso(new Date(new Date(`${from}T12:00:00Z`).getTime() + days * 864e5));
  const out = [];
  for (const r of rows || []) {
    const e = r.next_earnings;
    if (e?.date) out.push({ date: e.date, kind: "earnings", symbol: r.symbol, hour: e.hour || null, estimated: e.source !== "Finnhub" || !e.hour });
    const d = r.next_dividend;
    if (d?.ex_date) out.push({ date: d.ex_date, kind: "exdiv", symbol: r.symbol, amount: d.amount, currency: d.currency || r.currency, estimated: !!d.estimated });
    if (d?.pay_date) out.push({ date: d.pay_date, kind: "paydiv", symbol: r.symbol, amount: d.amount, currency: d.currency || r.currency, estimated: !!d.estimated });
  }
  for (const m of macro || []) out.push({ date: m.date, kind: m.kind, time: m.time, tz: m.tz, tentative: !!m.tentative });
  return out
    .filter((x) => x.date >= from && x.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.symbol || "").localeCompare(b.symbol || ""));
}

/** Monday (YYYY-MM-DD) of the week a date falls in. */
export function weekStart(dateIso) {
  const d = new Date(`${dateIso}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon = 0
  return iso(new Date(d.getTime() - dow * 864e5));
}

/** [{week: monday, rel: "this"|"next"|"later", events}] in date order. */
export function groupByWeek(events, today = todayIso()) {
  const thisWeek = weekStart(today);
  const nextWeek = iso(new Date(new Date(`${thisWeek}T12:00:00Z`).getTime() + 7 * 864e5));
  const groups = new Map();
  for (const e of events) {
    const w = weekStart(e.date);
    if (!groups.has(w)) groups.set(w, { week: w, rel: w === thisWeek ? "this" : w === nextWeek ? "next" : "later", events: [] });
    groups.get(w).events.push(e);
  }
  return [...groups.values()];
}

export function daysUntil(dateIso, today = todayIso()) {
  return Math.round((new Date(`${dateIso}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 864e5);
}

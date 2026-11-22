/* Data layer. Two implementations with the same interface:
 *  - Supabase (production): data only after login, row-level security per owner.
 *  - Demo (tests / local preview): FAKE fixture data, selectable state via ?fixture=…
 *      normal | empty | calm | stale | failed | partial | error | offline | new
 */

/* ======================================================================== Supabase */
function supabaseApi(cfg) {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config.js is missing supabaseUrl / supabaseAnonKey");
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const q = async (p) => {
    const { data, error } = await p;
    if (error) throw error;
    return data;
  };
  return {
    demo: false,
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((e, s) => { if (e === "SIGNED_IN" || e === "SIGNED_OUT") cb(s); }); },
    async login(email) {
      const { error } = await sb.auth.signInWithOtp({
        email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    },
    logout: () => sb.auth.signOut(),

    async loadAll() {
      const [watchlist, scores, market, runs, history, alerts] = await Promise.all([
        q(sb.from("watchlist").select("*").order("symbol")),
        q(sb.from("latest_scores").select("*")),
        q(sb.from("market_snapshot").select("*").eq("id", "latest")),
        q(sb.from("job_runs").select("*").order("started_at", { ascending: false }).limit(20)),
        q(sb.from("score_history").select("symbol,date,score").order("date", { ascending: false }).limit(2000)),
        q(sb.from("alerts_log").select("id,symbol,kind,title,body,url,delivered,sent_at").order("sent_at", { ascending: false }).limit(100)),
      ]);
      return { watchlist, scores, market: market[0] || null, runs, history, alerts };
    },
    async detail(symbol) {
      return (await q(sb.from("ticker_detail").select("weekly").eq("symbol", symbol)))[0] || null;
    },
    add: (row) => q(sb.from("watchlist").insert(row).select().single()),
    update: (id, row) => q(sb.from("watchlist").update(row).eq("id", id)),
    remove: (id) => q(sb.from("watchlist").delete().eq("id", id)),
    restore: (row) => q(sb.from("watchlist").insert(row)),
  };
}

/* ======================================================================== Demo */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function weeklySeries(symbol, last, fromHighPct = -10) {
  const rnd = seeded([...symbol].reduce((a, c) => a + c.charCodeAt(0), 7) * 997);
  const n = 520;
  const high = last / (1 + fromHighPct / 100);
  const closes = [];
  let p = high * (0.35 + rnd() * 0.25);
  for (let i = 0; i < n - 52; i += 1) { // older years: noisy climb towards the high
    p *= 1 + (rnd() - 0.46) * 0.05;
    closes.push(p);
  }
  const k = high / Math.max(...closes.slice(-60));
  for (let i = 0; i < closes.length; i += 1) closes[i] *= k;
  for (let i = 1; i <= 52; i += 1) { // last year: from the high to today's price
    const base = high + (last - high) * (i / 52);
    closes.push(i === 52 ? last : base * (1 + (rnd() - 0.5) * 0.04));
  }
  const c = closes.map((x) => +x.toFixed(2));
  const sma = c.map((_, i) => (i < 199 ? null : +(c.slice(i - 199, i + 1).reduce((a, b) => a + b, 0) / 200).toFixed(2)));
  const start = new Date(Date.UTC(2016, 11, 2));
  const t = c.map((_, i) => new Date(start.getTime() + i * 7 * 864e5).toISOString().slice(0, 10));
  return { t, c, sma200: sma };
}

/** Signals in the exact shape the daily job stores (src/score.py). */
function demoSignals(s, market) {
  const fired = s.fired || [];
  const sma = s.price / (1 + (s.vs_sma ?? 20) / 100);
  return [
    { code: "T1", key: "near_200w_ma", passed: s.na?.includes("T1") ? null : fired.includes("T1"),
      value: s.na?.includes("T1") ? null : { close: s.price, sma, pct_vs_sma: s.vs_sma ?? 20 }, threshold: sma * 1.05, weight: 1 },
    { code: "T2", key: "weekly_rsi", passed: fired.includes("T2"), value: s.rsi ?? 48, threshold: 30, weight: 1 },
    { code: "T3", key: "drawdown", passed: fired.includes("T3"),
      value: { pct: s.pct_from_52w_high, high: s.price / (1 + s.pct_from_52w_high / 100) }, threshold: -30, weight: 1 },
    { code: "S1", key: "market_fear", passed: fired.includes("S1"),
      value: { vix: market.vix?.value ?? null, fear_greed: market.fear_greed?.value ?? null },
      threshold: { vix_above: 30, fear_greed_below: 25 }, weight: 1 },
  ];
}

function demoApi(fixture) {
  const UID = "demo";
  let state = null;

  async function build() {
    const f = await (await fetch("fixtures/app.json", { cache: "no-cache" })).json();
    const now = Date.now();
    const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
    const updated = fixture === "stale" ? hoursAgo(50) : hoursAgo(3);
    const market = { ...f.market, updated_at: updated };
    if (fixture === "partial") market.fear_greed = null;

    let stocks = f.stocks;
    if (fixture === "calm") stocks = stocks.filter((s) => (s.score ?? 0) < 2 && !s.suspect && !s.error && s.score != null);
    if (fixture === "empty" || fixture === "new") stocks = [];

    const watchlist = stocks.map((s, i) => ({
      id: `w${i}`, user_id: UID, symbol: s.symbol, name: s.name, market: s.symbol.includes(".") ? "EU" : "US",
      buy_below: s.buy_below ?? null, notes: s.notes ?? null, created_at: hoursAgo(400),
    }));
    const scores = stocks
      .filter((s) => s.score !== undefined || s.error)
      .filter((s) => s.score !== null || s.error)
      .map((s) => s.error
        ? { user_id: UID, symbol: s.symbol, error: s.error, updated_at: updated }
        : {
          user_id: UID, symbol: s.symbol, as_of: updated.slice(0, 10), price: s.price, currency: s.currency,
          change_pct: s.change_pct, pct_from_52w_high: s.pct_from_52w_high,
          high_52w: s.price / (1 + s.pct_from_52w_high / 100), low_52w: s.low_52w ?? s.price * 0.82,
          score: s.score, max_score: 4, n_na: (s.na || []).length, label: s.label, suspect: !!s.suspect,
          signals: demoSignals(s, market), sparkline: weeklySeries(s.symbol, s.price, s.pct_from_52w_high).c.slice(-52),
          checks: s.suspect ? { status: "red", issues: [{ code: "suspect_move", level: "red", detail: "unexplained move > 40%" }], suspect_dates: [] } : { status: "green", issues: [] },
          updated_at: updated,
        });
    const history = stocks.filter((s) => s.prev_score != null).map((s) => ({ symbol: s.symbol, date: "2000-01-01", score: s.prev_score }))
      .concat(scores.filter((s) => s.score != null).map((s) => ({ symbol: s.symbol, date: s.as_of, score: s.score })))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first, like the real query
    const runStatus = fixture === "failed" ? "failed" : "ok";
    const runs = [
      { job: "daily", started_at: updated, finished_at: updated, status: runStatus,
        counts: { tickers: stocks.length, scored: scores.filter((s) => !s.error).length, errors: scores.filter((s) => s.error).length, suspect: stocks.filter((s) => s.suspect).length },
        sources: { yahoo_prices: { ok: runStatus === "ok", rows: 9000 }, yahoo_vix: { ok: true, rows: 1 }, cnn_fear_greed: { ok: fixture !== "partial", rows: fixture === "partial" ? 0 : 1 } } },
      { job: "daily", started_at: hoursAgo(27), finished_at: hoursAgo(27), status: "ok", counts: { tickers: stocks.length, scored: stocks.length }, sources: {} },
    ];
    const alerts = fixture === "empty" || fixture === "new" ? [] : (f.alerts || []).map((a, i) => ({ id: i, ...a, sent_at: hoursAgo(a.hours_ago) }));
    return { watchlist, scores, market: { id: "latest", data: market, updated_at: updated }, runs, history, alerts };
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    demo: true,
    fixture,
    session: async () => (fixture === "login" ? null : { user: { email: "owner@example.com" } }),
    onAuth() {},
    login: async () => { await delay(300); },
    logout: async () => {},
    async loadAll() {
      if (fixture === "loading") await new Promise(() => {}); // never resolves: skeleton screenshot
      if (fixture === "error" || fixture === "offline") { await delay(50); throw new Error("Failed to fetch"); }
      state ??= await build();
      return structuredClone(state);
    },
    async detail(symbol) {
      if (fixture === "nochart") throw new Error("Failed to fetch");
      const d = await (await fetch("fixtures/detail.json", { cache: "no-cache" })).json();
      return d[symbol] ? { weekly: d[symbol] } : null;
    },
    async add(row) {
      const w = { ...row, id: `w${Date.now()}`, user_id: UID, created_at: new Date().toISOString() };
      state.watchlist.push(w);
      return w;
    },
    async update(id, row) { Object.assign(state.watchlist.find((w) => w.id === id), row); },
    async remove(id) { state.watchlist = state.watchlist.filter((w) => w.id !== id); },
    async restore(row) { state.watchlist.push(row); },
  };
}

export function createApi(cfg, fixture) {
  return cfg.demo ? demoApi(fixture || "normal") : supabaseApi(cfg);
}

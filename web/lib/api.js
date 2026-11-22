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
  let riskSnap = null;
  const invoke = async (name, body) => {
    const { data, error } = await sb.functions.invoke(name, { method: "POST", body });
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
    /** Email + password: works inside the home-screen app (an email link opens Safari instead). */
    async loginPassword(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async setPassword(password) {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
    },
    async userEmail() { return (await sb.auth.getUser()).data.user?.email || ""; },

    /* ---- two-step login (TOTP authenticator app), CLAUDE.md 13.13.2 ---- */
    /** {level: "aal1"|"aal2", needsCode: bool, enabled: bool} */
    async mfaStatus() {
      const { data: a } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: f } = await sb.auth.mfa.listFactors();
      const enabled = (f?.totp || []).some((x) => x.status === "verified");
      return { level: a?.currentLevel || "aal1", needsCode: a?.currentLevel === "aal1" && a?.nextLevel === "aal2", enabled };
    },
    async mfaVerify(code) {
      const { data: f } = await sb.auth.mfa.listFactors();
      const factor = (f?.totp || []).find((x) => x.status === "verified");
      if (!factor) throw new Error("no factor");
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw error;
    },
    /** Start setting up: {factorId, qr (SVG data URL), secret}. Leftover unfinished setups are removed first. */
    async mfaEnroll() {
      const { data: f } = await sb.auth.mfa.listFactors();
      for (const x of f?.all || []) if (x.status !== "verified") await sb.auth.mfa.unenroll({ factorId: x.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Bottom Tracker ${new Date().toISOString().slice(0, 10)}` });
      if (error) throw error;
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    async mfaConfirm(factorId, code) {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw error;
    },

    /* ---- portfolio (readable only at aal2: row-level security) ---- */
    async loadPortfolio() {
      const [tx, ps, rs, perf, th, pend, rev] = await Promise.all([
        q(sb.from("transactions").select("*").order("date")),
        q(sb.from("portfolio_settings").select("*")),
        q(sb.from("risk_settings").select("*")),
        q(sb.from("portfolio_perf").select("data,updated_at")).catch(() => []), // table added in 3C
        q(sb.from("thesis").select("*")).catch(() => []), // tables added in 3D
        q(sb.from("pending_decisions").select("*").order("created_at")).catch(() => []),
        q(sb.from("reviews").select("*")).catch(() => []),
      ]);
      return { transactions: tx, settings: ps[0] || null, risk: rs[0] || null, perf: perf[0] || null, thesis: th, pending: pend, reviews: rev };
    },
    addTransaction: (row) => q(sb.from("transactions").insert(row).select().single()),
    addTransactions: (rows) => q(sb.from("transactions").insert(rows).select()),
    deleteImported: () => q(sb.from("transactions").delete().eq("source", "import")),
    /** Live prices (quotes function): {SYM: {price, prev_close, currency, time}} */
    quotes: async (symbols) => (await invoke("quotes", { symbols }))?.quotes || {},
    /** Broker rows → Yahoo tickers (lookup-symbols function): [{best, candidates}] */
    lookupSymbols: async (items) => (await invoke("lookup-symbols", { items }))?.results || [],
    deleteTransaction: (id) => q(sb.from("transactions").delete().eq("id", id)),
    /* Phase 3D: thesis, cooling-off decisions, post-trade reviews */
    saveThesis: async (row) => (await q(sb.from("thesis").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,symbol" }).select()))[0],
    addPending: async (row) => (await q(sb.from("pending_decisions").insert(row).select()))[0],
    updatePending: (id, patch) => q(sb.from("pending_decisions").update(patch).eq("id", id)),
    addReview: async (row) => (await q(sb.from("reviews").insert(row).select()))[0],
    savePortfolioSettings: (row) => q(sb.from("portfolio_settings").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" })),
    async saveRisk(profile, settings) {
      await q(sb.from("risk_settings").upsert({ profile, settings, updated_at: new Date().toISOString() }, { onConflict: "user_id" }));
      await q(sb.from("risk_settings_log").insert({ profile, settings }));
    },
    /** "Update now": asks the run-update function to start the scoring job on GitHub. */
    async runUpdate() {
      const { data, error } = await sb.functions.invoke("run-update", { method: "POST" });
      if (error) {
        const body = await error.context?.json?.().catch(() => null);
        const e = new Error(body?.error || error.message);
        e.code = body?.code || error.context?.status || null;
        throw e;
      }
      return data?.status || "started";
    },
    logout: () => sb.auth.signOut(),

    async loadAll() {
      const [watchlist, scores, market, runs, history, alerts, intradayRuns] = await Promise.all([
        q(sb.from("watchlist").select("*").order("symbol")),
        q(sb.from("latest_scores").select("*")),
        q(sb.from("market_snapshot").select("*").in("id", ["latest", "macro"])),
        // daily and intraday runs separately: ~40 intraday runs a day must not push the daily ones out
        q(sb.from("job_runs").select("*").eq("job", "daily").order("started_at", { ascending: false }).limit(15)),
        q(sb.from("score_history").select("symbol,date,score").order("date", { ascending: false }).limit(2000)),
        q(sb.from("alerts_log").select("id,symbol,kind,title,body,url,delivered,sent_at").order("sent_at", { ascending: false }).limit(100)),
        q(sb.from("job_runs").select("*").eq("job", "intraday").order("started_at", { ascending: false }).limit(1)),
        q(sb.from("risk_snapshot").select("data,updated_at")),
      ]).then((r) => { riskSnap = r.pop()[0] || null; return r; });
      return {
        riskSnapshot: riskSnap,
        watchlist, scores, market: market.find((m) => m.id === "latest") || null, macro: market.find((m) => m.id === "macro") || null,
        runs: [...runs, ...intradayRuns], history, alerts,
      };
    },
    async detail(symbol) {
      return (await q(sb.from("ticker_detail").select("weekly,fundamentals").eq("symbol", symbol)))[0] || null;
    },
    /** Private calendar feed URL (13.3). create:false only reads; renew:true makes a new secret. */
    async calendarUrl({ create = true, renew = false } = {}) {
      const rows = await q(sb.from("calendar_tokens").select("token").limit(1));
      let token = rows[0]?.token;
      if (!token && !create) return null;
      if (!token || renew) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        await q(sb.from("calendar_tokens").upsert({ token, created_at: new Date().toISOString() }, { onConflict: "user_id" }));
      }
      return `${cfg.supabaseUrl}/functions/v1/calendar-ics?token=${token}`;
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
    { code: "V1", key: "valuation_pct", passed: s.valuation ? s.valuation.pct <= 20 : null,
      value: s.valuation || null, threshold: 20, weight: 1 },
    { code: "V2", key: "insider_buying", passed: s.insiders ? s.insiders.net_value > 0 : null,
      value: s.insiders ? { ...s.insiders } : { na: s.insiders_na || null }, threshold: 0, weight: 1 },
    { code: "S1", key: "market_fear", passed: fired.includes("S1"),
      value: { vix: market.vix?.value ?? null, fear_greed: market.fear_greed?.value ?? null },
      threshold: { vix_above: 30, fear_greed_below: 25 }, weight: 1 },
  ];
}

/** Top Score in the shape src/top_score.py stores; `top_fired` lists the signals that fire. */
function demoTop(s, market) {
  const f = s.top_fired || [];
  const sma = s.price / (1 + (s.vs_sma ?? 20) / 100);
  const v = s.valuation;
  const signals = [
    { code: "U1", key: "far_above_trend", passed: f.includes("U1"), value: { ratio: f.includes("U1") ? 1.92 : +(s.price / sma).toFixed(2) }, threshold: 1.8, weight: 1 },
    { code: "U2", key: "weekly_rsi_high", passed: f.includes("U2"), value: { rsi: f.includes("U2") ? 74.5 : s.rsi ?? 48, extreme: false }, threshold: 70, weight: 1 },
    { code: "U3", key: "expensive", passed: v ? f.includes("U3") : null, value: v ? { ...v, pct: f.includes("U3") ? 94 : v.pct } : null, threshold: 90, weight: 1 },
    { code: "U4", key: "insider_selling", passed: s.insiders ? false : null,
      value: s.insiders ? { net_sell: Math.max(0, -s.insiders.net_value), pct_of_mcap: 0.004, days: 90 } : { na: s.insiders_na || null }, threshold: 0.05, weight: 1 },
    { code: "U5", key: "euphoria", passed: (market.fear_greed?.value ?? 0) >= 75, value: market.fear_greed ? { fear_greed: market.fear_greed.value } : null, threshold: 75, weight: 1 },
    { code: "U6", key: "near_resistance", passed: f.includes("U6"),
      value: f.includes("U6") ? { low: s.price * 1.01, high: s.price * 1.04, distance_pct: 1.0, touches: 3 } : null, threshold: 3, weight: 1 },
  ];
  const score = signals.filter((x) => x.passed === true).length;
  return { score, max_score: 6, n_na: signals.filter((x) => x.passed === null).length, label: score >= 4 ? "trim" : score >= 2 ? "hot" : "normal", signals };
}

function demoApi(fixture) {
  const UID = "demo";
  let demoLoggedIn = false;
  // two-step login in the demo: fixture "mfa" asks for the code (123456); "nomfa" has none set up yet
  let demoMfa = { enabled: fixture !== "nomfa", level: fixture === "mfa" || fixture === "nomfa" ? "aal1" : "aal2" };
  let demoPf = null;
  let demoToken = null;
  let state = null;

  async function build() {
    const f = await (await fetch("fixtures/app.json", { cache: "no-cache" })).json();
    const now = Date.now();
    const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();
    const updated = fixture === "stale" ? hoursAgo(50) : hoursAgo(3);
    const inDays = (n) => new Date(now + n * 864e5).toISOString().slice(0, 10);
    const market = { ...f.market, updated_at: updated, fx: { rates: { USD: 1.16, GBP: 0.88, CAD: 1.62 } } };
    if (fixture === "partial") market.fear_greed = null;

    let stocks = f.stocks;
    if (fixture === "calm") stocks = stocks.filter((s) => (s.score ?? 0) < 2 && !s.suspect && !s.error && s.score != null);
    if (fixture === "empty" || fixture === "new") stocks = [];

    const watchlist = stocks.map((s, i) => ({
      id: `w${i}`, user_id: UID, symbol: s.symbol, name: s.name, market: s.symbol.includes(".") ? "EU" : "US",
      buy_below: s.buy_below ?? null, notes: s.notes ?? null, tags: s.tags || [], created_at: hoursAgo(400),
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
          score: s.score, max_score: 6, n_na: (s.na || []).length + (s.valuation ? 0 : 1) + (s.insiders ? 0 : 1),
          label: s.label, suspect: !!s.suspect,
          next_earnings: s.next_earnings || null,
          signals: demoSignals(s, market), top: demoTop(s, market), quality: s.quality || null, verdict: s.verdict || null,
          risk: s.risk || null,
          metrics: s.metrics || null,
          dividends: s.dividends ? { ...s.dividends, history: (s.dividends.history_days_ago || []).map(([d, a]) => [inDays(-d), a]) } : null,
          next_dividend: s.dividend ? { ...s.dividend, ex_date: inDays(s.dividend.ex_in_days), pay_date: s.dividend.pay_in_days != null ? inDays(s.dividend.pay_in_days) : null } : null,
          sparkline: weeklySeries(s.symbol, s.price, s.pct_from_52w_high).c.slice(-52),
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
      { job: "intraday", started_at: hoursAgo(0.2), finished_at: hoursAgo(0.2), status: "ok", counts: { tickers: stocks.length, checked: stocks.length, alerts_sent: 0 }, sources: {} },
    ];
    const alerts = fixture === "empty" || fixture === "new" ? [] : (f.alerts || []).map((a, i) => ({ id: i, ...a, sent_at: hoursAgo(a.hours_ago) }));
    const macro = { id: "macro", data: { events: (f.macro || []).map((m) => ({ ...m, date: inDays(m.in_days) })) } };
    return { watchlist, scores, market: { id: "latest", data: market, updated_at: updated }, macro, runs, history, alerts, riskSnapshot: f.riskSnapshot ? { data: f.riskSnapshot } : null };
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    demo: true,
    fixture,
    session: async () => (fixture === "login" && !demoLoggedIn ? null : { user: { email: "owner@example.com" } }),
    onAuth() {},
    login: async () => { await delay(300); },
    loginPassword: async (email, password) => {
      await delay(200);
      if (password !== "correct-horse-battery") throw new Error("Invalid login credentials");
      demoLoggedIn = true;
    },
    setPassword: async () => { await delay(200); },
    userEmail: async () => "owner@example.com",
    mfaStatus: async () => ({ ...demoMfa, needsCode: demoMfa.enabled && demoMfa.level === "aal1" }),
    mfaVerify: async (code) => { await delay(150); if (code !== "123456") throw new Error("Invalid TOTP code entered"); demoMfa.level = "aal2"; },
    mfaEnroll: async () => ({ factorId: "demo-factor", secret: "JBSWY3DPEHPK3PXP",
      qr: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="164" height="164"><rect width="164" height="164" fill="#fff"/><rect x="12" y="12" width="40" height="40"/><rect x="112" y="12" width="40" height="40"/><rect x="12" y="112" width="40" height="40"/><rect x="70" y="70" width="24" height="24"/></svg>') }),
    mfaConfirm: async (_id, code) => { await delay(150); if (code !== "123456") throw new Error("Invalid TOTP code entered"); demoMfa = { enabled: true, level: "aal2" }; },
    async loadPortfolio() {
      if (demoMfa.level !== "aal2") return { transactions: [], settings: null, risk: null }; // like RLS: nothing at aal1
      if (!demoPf) {
        const f = await (await fetch("fixtures/app.json", { cache: "no-cache" })).json();
        const empty = fixture === "empty" || fixture === "new" || fixture === "noportfolio";
        demoPf = { transactions: empty ? [] : (f.portfolio?.transactions || []).map((t, i) => ({ id: `t${i}`, ...t })),
          settings: empty ? null : f.portfolio?.settings || null, risk: null,
          perf: empty || fixture === "noperf" ? null : { data: f.portfolio?.perf, updated_at: new Date(Date.now() - 3 * 3600e3).toISOString() },
          thesis: empty ? [] : structuredClone(f.portfolio?.thesis || []),
          pending: empty ? [] : (f.portfolio?.pending || []).map((p) => ({ ...p, created_at: new Date(Date.now() - p.hours_ago * 3600e3).toISOString(),
            decide_after: new Date(Date.now() - (p.hours_ago - 24) * 3600e3).toISOString() })),
          reviews: [] };
        if (fixture === "earlyperf" && demoPf.perf) demoPf.perf.data = { ...demoPf.perf.data, trading_days: 4, since: demoPf.perf.data.as_of };
      }
      return structuredClone(demoPf);
    },
    async addTransaction(row) { const r = { id: `t${Date.now()}`, ...row }; demoPf.transactions.push(r); return r; },
    async addTransactions(rows) { const out = rows.map((row, i) => ({ id: `t${Date.now()}${i}`, ...row })); demoPf.transactions.push(...out); return out; },
    async deleteImported() { demoPf.transactions = demoPf.transactions.filter((x) => x.source !== "import"); },
    async quotes(symbols) {
      const out = {};
      for (const s of symbols) { const r = state?.scores.find((x) => x.symbol === s); if (r?.price) out[s] = { price: +(r.price * 1.01).toFixed(2), prev_close: r.price, currency: r.currency, time: new Date().toISOString() }; }
      return out;
    },
    async lookupSymbols(items) {
      await delay(200);
      const f = await (await fetch("fixtures/app.json", { cache: "no-cache" })).json();
      return items.map((it) => f.lookup?.[it.isin] || f.lookup?.[it.name] || { best: null, candidates: [] });
    },
    async deleteTransaction(id) { demoPf.transactions = demoPf.transactions.filter((x) => x.id !== id); },
    async saveThesis(row) {
      const i = demoPf.thesis.findIndex((x) => x.symbol === row.symbol);
      const next = { ...(i >= 0 ? demoPf.thesis[i] : {}), ...row, updated_at: new Date().toISOString() };
      if (i >= 0) demoPf.thesis[i] = next; else demoPf.thesis.push(next);
      return next;
    },
    async addPending(row) { const r = { id: `p${Date.now()}`, status: "waiting", created_at: new Date().toISOString(), ...row }; demoPf.pending.push(r); return r; },
    async updatePending(id, patch) { Object.assign(demoPf.pending.find((x) => x.id === id) || {}, patch); },
    async addReview(row) { const r = { id: `r${Date.now()}`, created_at: new Date().toISOString(), ...row }; demoPf.reviews.push(r); return r; },
    async savePortfolioSettings(row) { demoPf.settings = { ...(demoPf.settings || {}), ...row }; },
    async saveRisk(profile, settings) { demoPf.risk = { profile, settings }; },
    runUpdate: async () => { await delay(300); return "started"; },
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
      const out = d[symbol] ? structuredClone(d[symbol]) : null;
      // fake headlines get recent times, so "why is it down?" (last 48 h) works on any day
      out?.fundamentals?.news?.forEach((n, i) => { n.time = new Date(Date.now() - (6 + i * 30) * 3600e3).toISOString(); });
      return out;
    },
    calendarUrl: async ({ create = true } = {}) => (create || demoToken ? (demoToken ||= "demo-not-a-real-token-0123456789abcdef", `https://example.supabase.co/functions/v1/calendar-ics?token=${demoToken}`) : null),
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

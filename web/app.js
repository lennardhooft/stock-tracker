/* Bottom Tracker — Phase 1 frontend. Vanilla JS, no build step.
 *
 * Data comes from Supabase after login (row-level security: only the owner's rows).
 * Views (hash routes): ""  watchlist · "#health" · "#help" · "#<SYMBOL>" ticker detail.
 *
 * Demo mode (local preview only): config.js sets {demo: true} and data is read from
 * web/demo/*.json, produced by `python -m src.run_daily --local` + scripts/preview_local.sh.
 */
(() => {
  "use strict";

  const CFG = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const nav = document.getElementById("nav");
  let glossaryCache = null;

  // ------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtNum = (v, d = 2) => (v == null || Number.isNaN(v) ? "n/a"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtPct = (v, d = 1) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${fmtNum(v, d)}%`);
  const pctClass = (v) => (v == null ? "" : v >= 0 ? "up" : "down");
  const CUR = { USD: "$", EUR: "€", GBP: "£", CHF: "CHF ", DKK: "kr ", SEK: "kr " };
  const fmtPrice = (v, cur) => (v == null ? "n/a" : `${CUR[cur] ?? (cur ? cur + " " : "")}${fmtNum(v, 2)}`);
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/Brussels", dateStyle: "medium", timeStyle: "short" }) : "never");

  const LABELS = {
    normal: { text: "Normal", colour: "grey" },
    watch: { text: "Watch", colour: "yellow" },
    strong: { text: "Strong bottom signals, research it", colour: "orange" },
    extreme: { text: "Extreme", colour: "red" },
  };

  function scoreBadge(row, long = false) {
    if (!row || row.score == null) return `<span class="badge none">${row?.error ? "error" : "pending"}</span>`;
    const lab = LABELS[row.label] || LABELS.normal;
    const na = row.n_na ? ` (${row.n_na} n/a)` : "";
    const warn = row.suspect ? " ⚠️" : "";
    return `<span class="badge ${lab.colour}" title="${esc(lab.text)}">${fmtNum(row.score, 0)}/${fmtNum(row.max_score, 0)}${na}${warn}${long ? " · " + esc(lab.text) : ""}</span>`;
  }

  function sparkline(values, w = 84, h = 26) {
    const v = (values || []).filter((x) => x != null);
    if (v.length < 2) return "";
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const pts = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 2 - (y - min) / span * (h - 4)).toFixed(1)}`).join(" ");
    const colour = v[v.length - 1] >= v[0] ? "var(--up)" : "var(--down)";
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  /** Yahoo symbol → TradingView symbol. */
  function tvSymbol(sym) {
    const map = { AS: "EURONEXT", BR: "EURONEXT", PA: "EURONEXT", LS: "EURONEXT", DE: "XETR",
      F: "FWB", L: "LSE", MI: "MIL", MC: "BME", SW: "SIX", CO: "OMXCOP", ST: "OMXSTO",
      HE: "OMXHEX", OL: "OSL", VI: "VIE", TO: "TSX" };
    const idx = { "^GSPC": "SP:SPX", "^IXIC": "NASDAQ:IXIC", "^VIX": "TVC:VIX" };
    if (idx[sym]) return idx[sym];
    const m = sym.match(/^(.+)\.([A-Z]{1,2})$/);
    if (m && map[m[2]]) return `${map[m[2]]}:${m[1].replace(/-/g, ".")}`;
    return sym.replace(/-/g, ".");
  }

  /** Expected time of the latest daily run (21:45 UTC on weekdays) before now. */
  function lastExpectedRun(now = new Date()) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 22, 30));
    while (d > now || d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }

  function staleBanner(latestIso) {
    if (!latestIso) return "";
    const updated = new Date(latestIso);
    const hours = Math.round((Date.now() - updated) / 36e5);
    // stale = older than the last expected run by more than 2 hours (scheduled runs can lag)
    if (updated < new Date(lastExpectedRun() - 2 * 36e5)) {
      return `<div class="banner">Data is ${hours} hours old. The daily job may have failed. See <a href="#health">Health</a>.</div>`;
    }
    return "";
  }

  // ------------------------------------------------------------------------
  // Data layer
  // ------------------------------------------------------------------------
  function supabaseApi() {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) throw new Error("config.js is missing supabaseUrl / supabaseAnonKey");
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
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
      watchlist: () => q(sb.from("watchlist").select("*").order("symbol")),
      scores: () => q(sb.from("latest_scores").select("*")),
      market: async () => (await q(sb.from("market_snapshot").select("*").eq("id", "latest")))[0] || null,
      detail: async (sym) => (await q(sb.from("ticker_detail").select("*").eq("symbol", sym)))[0] || null,
      jobRuns: () => q(sb.from("job_runs").select("*").order("started_at", { ascending: false }).limit(15)),
      addTicker: (row) => q(sb.from("watchlist").insert(row)),
      updateTicker: (id, row) => q(sb.from("watchlist").update(row).eq("id", id)),
      deleteTicker: (id) => q(sb.from("watchlist").delete().eq("id", id)),
    };
  }

  function demoApi() {
    const get = async (name) => {
      const r = await fetch(`demo/${name}.json`, { cache: "no-store" });
      return r.ok ? r.json() : [];
    };
    let wl = null;
    const loadWl = async () => (wl ??= (await get("latest_scores")).map((s, i) => ({
      id: String(i), symbol: s.symbol, name: s.symbol, market: s.symbol.includes(".") ? "EU" : "US",
      buy_below: null, notes: "" })));
    return {
      demo: true,
      session: async () => ({ user: { email: "demo" } }),
      onAuth() {}, login: async () => {}, logout: async () => {},
      watchlist: loadWl,
      scores: () => get("latest_scores"),
      market: async () => (await get("market_snapshot"))[0] || null,
      detail: async (sym) => (await get("ticker_detail")).find((d) => d.symbol === sym) || null,
      jobRuns: async () => (await get("job_runs")).reverse(),
      addTicker: async (row) => { (await loadWl()).push({ ...row, id: String(Date.now()) }); },
      updateTicker: async (id, row) => { Object.assign((await loadWl()).find((w) => w.id === id), row); },
      deleteTicker: async (id) => { wl = (await loadWl()).filter((w) => w.id !== id); },
    };
  }

  let api;
  try {
    api = CFG.demo ? demoApi() : supabaseApi();
  } catch (e) {
    app.innerHTML = `<div class="banner error">${esc(e.message)}</div>`;
    return;
  }

  // ------------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------------
  function viewLogin(message = "") {
    nav.hidden = true;
    app.innerHTML = `
      <div class="login card">
        <h2>Log in</h2>
        <p class="muted">We email you a one-time login link. Only the owner's account can log in.</p>
        <form id="login-form">
          <div class="field"><label for="email">Email</label>
            <input id="email" type="email" autocomplete="email" required></div>
          <button class="btn primary" type="submit" style="width:100%">Send login link</button>
        </form>
        <p id="login-msg" class="muted">${esc(message)}</p>
      </div>`;
    document.getElementById("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("login-msg");
      msg.textContent = "Sending…";
      try {
        await api.login(document.getElementById("email").value.trim());
        msg.textContent = "Check your email for the login link.";
      } catch (err) {
        msg.textContent = `Could not send link: ${err.message}`;
      }
    });
  }

  function marketTile(label, q, opts = {}) {
    if (!q) return `<div class="tile"><div class="k">${label}</div><div class="v muted">n/a</div></div>`;
    const v = opts.int ? fmtNum(q.value, 0) : fmtNum(q.value, opts.dec ?? 2);
    const sub = opts.rating ? `<div class="d muted">${esc(q.rating || "")}</div>`
      : `<div class="d ${pctClass(opts.invert ? -q.change_pct : q.change_pct)}">${fmtPct(q.change_pct, 2)}</div>`;
    return `<div class="tile"><div class="k">${label}</div><div class="v num">${v}</div>${sub}</div>`;
  }

  async function viewDashboard() {
    const [watchlist, scores, market] = await Promise.all([api.watchlist(), api.scores(), api.market()]);
    const bySym = Object.fromEntries(scores.map((s) => [s.symbol, s]));
    const rows = watchlist.map((w) => ({ w, s: bySym[w.symbol.toUpperCase()] }));
    const latest = scores.map((s) => s.updated_at).sort().pop() || market?.updated_at;
    const m = market?.data || {};

    let state = { min: 0, q: "" };
    try { state = { ...state, ...JSON.parse(localStorage.getItem("filters") || "{}") }; } catch { /* storage blocked */ }

    app.innerHTML = `
      ${api.demo ? '<div class="banner">Demo mode: local preview data, no login.</div>' : ""}
      ${staleBanner(latest)}
      <section class="market">
        ${marketTile("S&amp;P 500", m.sp500, { int: true })}
        ${marketTile("Nasdaq", m.nasdaq, { int: true })}
        ${marketTile("VIX", m.vix, { invert: true })}
        ${marketTile("Fear &amp; Greed", m.fear_greed, { int: true, rating: true })}
      </section>
      <div class="updated">Last update: ${fmtTime(latest)} (Brussels)</div>
      <div class="filters">
        <input id="q" type="search" placeholder="Search ticker or name" value="${esc(state.q)}">
        <select id="min" aria-label="Minimum score">
          ${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${+state.min === n ? "selected" : ""}>Score ≥ ${n}</option>`).join("")}
        </select>
      </div>
      <div id="list"></div>
      <details class="card" ${watchlist.length ? "" : "open"}>
        <summary>Add a ticker</summary>
        ${tickerForm()}
      </details>`;

    const list = document.getElementById("list");
    const render = () => {
      const q = state.q.toLowerCase();
      const shown = rows
        .filter(({ s }) => (s?.score ?? 0) >= +state.min)
        .filter(({ w }) => !q || w.symbol.toLowerCase().includes(q) || (w.name || "").toLowerCase().includes(q))
        .sort((a, b) => (b.s?.score ?? -1) - (a.s?.score ?? -1) || a.w.symbol.localeCompare(b.w.symbol));
      list.innerHTML = shown.length ? shown.map(({ w, s }) => `
        <a class="ticker" href="#${encodeURIComponent(w.symbol)}">
          <div class="name"><span class="sym">${esc(w.symbol)}</span><span class="full">${esc(w.name || "")}</span></div>
          <div class="badge">${scoreBadge(s)}</div>
          <div class="meta">
            ${s?.price != null ? `<span><b class="num">${fmtPrice(s.price, s.currency)}</b></span>
            <span class="num ${pctClass(s.change_pct)}">${fmtPct(s.change_pct, 2)}</span>
            <span class="num">${fmtPct(s.pct_from_52w_high)} from 52w high</span>`
              : `<span>${s?.error ? esc(s.error) : "Scored after the next daily run"}</span>`}
          </div>
          <div class="spark">${sparkline(s?.sparkline)}</div>
        </a>`).join("")
        : `<p class="muted center">${rows.length ? "No tickers match the filter." : "Your watchlist is empty. Add a ticker below."}</p>`;
    };
    const save = () => { try { localStorage.setItem("filters", JSON.stringify(state)); } catch { /* ignore */ } };
    document.getElementById("q").addEventListener("input", (e) => { state.q = e.target.value; save(); render(); });
    document.getElementById("min").addEventListener("change", (e) => { state.min = +e.target.value; save(); render(); });
    render();
    bindTickerForm(null);
  }

  function tickerForm(w = null) {
    return `
      <form id="ticker-form">
        ${w ? "" : `<div class="row">
          <div class="field"><label for="f-symbol">Yahoo symbol</label>
            <input id="f-symbol" required maxlength="20" placeholder="AAPL, ASML.AS" autocapitalize="characters"></div>
          <div class="field"><label for="f-market">Market</label>
            <select id="f-market"><option>US</option><option>EU</option><option>OTHER</option></select></div>
        </div>`}
        <div class="field"><label for="f-name">Name</label>
          <input id="f-name" maxlength="100" value="${esc(w?.name || "")}"></div>
        <div class="field"><label for="f-buy">Personal buy level (optional)</label>
          <input id="f-buy" type="number" step="any" min="0" inputmode="decimal" value="${w?.buy_below ?? ""}"></div>
        <div class="field"><label for="f-notes">Notes</label>
          <textarea id="f-notes" maxlength="2000">${esc(w?.notes || "")}</textarea></div>
        <button class="btn primary" type="submit">${w ? "Save" : "Add to watchlist"}</button>
        <span id="f-msg" class="muted" style="margin-left:8px"></span>
      </form>
      ${w ? "" : '<p class="muted" style="font-size:13px">EU stocks use Yahoo suffixes: .AS Amsterdam, .BR Brussels, .PA Paris, .DE Xetra. New tickers get a score after the next nightly run (or run the workflow manually).</p>'}`;
  }

  function bindTickerForm(w) {
    const form = document.getElementById("ticker-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("f-msg");
      const buy = document.getElementById("f-buy").value;
      const row = {
        name: document.getElementById("f-name").value.trim() || null,
        buy_below: buy === "" ? null : Number(buy),
        notes: document.getElementById("f-notes").value.trim() || null,
      };
      try {
        if (w) {
          await api.updateTicker(w.id, row);
          msg.textContent = "Saved.";
        } else {
          const symbol = document.getElementById("f-symbol").value.trim().toUpperCase();
          if (!/^[A-Z0-9.\-^=]{1,20}$/.test(symbol)) { msg.textContent = "Invalid symbol."; return; }
          await api.addTicker({ ...row, symbol, market: document.getElementById("f-market").value });
          route();
        }
      } catch (err) {
        msg.textContent = err.code === "23505" ? "Already on your watchlist." : `Error: ${err.message}`;
      }
    });
  }

  async function viewDetail(symbol) {
    const [watchlist, scores] = await Promise.all([api.watchlist(), api.scores()]);
    const w = watchlist.find((x) => x.symbol.toUpperCase() === symbol);
    const s = scores.find((x) => x.symbol === symbol);
    if (!w) {
      app.innerHTML = `<p class="muted">${esc(symbol)} is not on your watchlist. <a href="#">Back</a></p>`;
      return;
    }
    const issues = (s?.checks?.issues || []).filter((i) => i.level !== "info");
    const icon = (p) => (p === true ? "✅" : p === false ? "❌" : "<span class='muted'>n/a</span>");

    app.innerHTML = `
      <p><a href="#">← Watchlist</a></p>
      <div class="detail-head">
        <div>
          <h1>${esc(w.symbol)}</h1>
          <div class="muted">${esc(w.name || "")}</div>
        </div>
        <div style="text-align:right">
          <div class="price num">${fmtPrice(s?.price, s?.currency)}</div>
          <div class="num ${pctClass(s?.change_pct)}">${fmtPct(s?.change_pct, 2)}</div>
        </div>
      </div>
      ${issues.length ? `<div class="banner">⚠️ Data check: ${issues.map((i) => esc(i.detail)).join("; ")}</div>` : ""}
      ${s?.error ? `<div class="banner error">Not scored: ${esc(s.error)}</div>` : ""}

      <section class="card">
        <h2>Bottom Score ${scoreBadge(s, true)}</h2>
        ${s?.signals ? `<ul class="signals">${s.signals.map((g) => `
          <li><span class="icon">${icon(g.passed)}</span>
            <span class="sname">${esc(g.code)} · ${esc(g.name)}</span>
            <span class="sdetail num">${esc(g.detail)}</span></li>`).join("")}</ul>
          <p class="muted" style="font-size:12px;margin:8px 0 0">As of ${esc(s.as_of)} close. <a href="#help">What do these mean?</a></p>`
        : '<p class="muted">No score yet. It appears after the next daily run.</p>'}
      </section>

      <div class="chart" id="tv"></div>

      <section class="card">
        <h2>Key stats</h2>
        <dl class="stats num">
          <div><dt>52-week high</dt><dd>${fmtPrice(s?.high_52w, s?.currency)}</dd></div>
          <div><dt>52-week low</dt><dd>${fmtPrice(s?.low_52w, s?.currency)}</dd></div>
          <div><dt>From 52w high</dt><dd>${fmtPct(s?.pct_from_52w_high)}</dd></div>
          <div><dt>Market</dt><dd>${esc(w.market)}${w.market === "EU" ? " (delayed ~15 min)" : ""}</dd></div>
        </dl>
      </section>

      <section class="card">
        <h2>My notes &amp; buy level</h2>
        ${tickerForm(w)}
        <button id="del" class="btn danger" style="margin-top:12px">Remove from watchlist</button>
      </section>`;

    bindTickerForm(w);
    document.getElementById("del").addEventListener("click", async () => {
      if (!confirm(`Remove ${w.symbol} from your watchlist?`)) return;
      await api.deleteTicker(w.id);
      location.hash = "";
    });
    mountTradingView(document.getElementById("tv"), tvSymbol(w.symbol));
  }

  function mountTradingView(el, symbol) {
    el.innerHTML = '<div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div>';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.textContent = JSON.stringify({
      symbol, interval: "W", theme: "dark", style: "1", locale: "en", autosize: true,
      timezone: "Europe/Brussels", allow_symbol_change: true, hide_side_toolbar: true,
      backgroundColor: "#0e1116", support_host: "https://www.tradingview.com",
    });
    el.firstChild.appendChild(script);
  }

  async function viewHealth() {
    const runs = await api.jobRuns();
    const last = runs[0];
    const dotFor = (st) => (st === "ok" ? "green" : st === "partial" ? "yellow" : "red");
    // last successful fetch per source
    const lastOk = {};
    for (const r of [...runs].reverse()) for (const [k, v] of Object.entries(r.sources || {})) if (v.ok) lastOk[k] = r.finished_at;
    app.innerHTML = `
      <h1 style="font-size:20px">Data health</h1>
      ${last ? "" : '<div class="banner">No job runs recorded yet.</div>'}
      ${last ? `<section class="card">
        <h2>Latest daily run</h2>
        <p><span class="dot ${dotFor(last.status)}"></span>${esc(last.status)} · ${fmtTime(last.finished_at)}</p>
        <p class="muted num">${Object.entries(last.counts || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(" · ")}</p>
      </section>
      <section class="card">
        <h2>Data sources</h2>
        <table><thead><tr><th>Source</th><th>Last run</th><th>Last success</th></tr></thead><tbody>
        ${Object.entries(last.sources || {}).map(([k, v]) => `<tr>
          <td><span class="dot ${v.ok ? "green" : v.errors && v.rows ? "yellow" : "red"}"></span>${esc(k)}</td>
          <td class="num">${v.ok ? "ok" : "failed"}${v.errors ? ` (${esc(v.errors)} err)` : ""} · ${esc(v.rows ?? 0)} rows</td>
          <td class="num">${fmtTime(lastOk[k])}</td></tr>`).join("")}
        </tbody></table>
      </section>` : ""}
      <section class="card">
        <h2>Recent runs</h2>
        <table><thead><tr><th>When</th><th>Status</th><th>Scored</th></tr></thead><tbody>
        ${runs.map((r) => `<tr><td class="num">${fmtTime(r.started_at)}</td>
          <td><span class="dot ${dotFor(r.status)}"></span>${esc(r.status)}</td>
          <td class="num">${esc(r.counts?.scored ?? "-")}/${esc(r.counts?.tickers ?? "-")}</td></tr>`).join("")}
        </tbody></table>
      </section>`;
  }

  async function viewHelp() {
    glossaryCache ??= await (await fetch("glossary.json")).json();
    app.innerHTML = `
      <h1 style="font-size:20px">How the Bottom Score works</h1>
      ${Object.values(glossaryCache).map((g) => `
        <section class="card gloss">
          <h3>${esc(g.title)}</h3>
          <p>${esc(g.what)}</p>
          <p><b>Why it matters:</b> ${esc(g.why)}</p>
          <p><b>How to read it:</b> ${esc(g.how)}</p>
          <p><b>Limitations:</b> ${esc(g.limits)}</p>
        </section>`).join("")}
      <section class="card"><h3>Disclaimer</h3>
        <p class="muted">This app is a personal research tool. It is not financial advice and never places orders.
        A high score means "worth researching", not "buy". Stocks can stay cheap for a long time.</p></section>`;
  }

  // ------------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------------
  async function route() {
    const session = await api.session();
    if (!session) return viewLogin();
    nav.hidden = false;
    const hash = decodeURIComponent(location.hash.slice(1));
    for (const a of nav.querySelectorAll("a")) a.classList.toggle("active", a.getAttribute("href") === (hash ? `#${hash}` : "#"));
    try {
      if (!hash) await viewDashboard();
      else if (hash === "health") await viewHealth();
      else if (hash === "help") await viewHelp();
      else await viewDetail(hash.toUpperCase());
      window.scrollTo(0, 0);
    } catch (err) {
      app.innerHTML = `<div class="banner error">Could not load data: ${esc(err.message)}</div>`;
    }
  }

  document.getElementById("logout").addEventListener("click", async () => { await api.logout(); viewLogin("Logged out."); });
  window.addEventListener("hashchange", route);
  api.onAuth(() => route());
  route();
})();

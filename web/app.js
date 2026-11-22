/* Bottom Tracker — app shell, router, data loading (CLAUDE.md 8.2, 8.13).
 * Screens live in web/screens/*.js; every visible text comes from web/i18n/.
 */
import { html, mount, $, $$ } from "./lib/dom.js";
import { initI18n, t } from "./lib/i18n.js";
import * as fmt from "./lib/format.js";
import { createApi } from "./lib/api.js";
import { loadPrefs, prefsGet, prefsSet, applyTheme, cacheSave, cacheLoad, cacheClear } from "./lib/settings.js";
import { freshness } from "./lib/signals.js";
import { icon } from "./components/icons.js";
import { openSheet, toast } from "./components/overlays.js";
import { skeletonCards, errorState } from "./components/states.js";
import { renderLogin, renderMfaCode } from "./screens/login.js";
import { renderPortfolio, renderCanIBuy, renderRiskSettings } from "./screens/portfolio.js";
import { renderToday } from "./screens/today.js";
import { renderWatchlist, openAddSheet } from "./screens/watchlist.js";
import { renderCalendar } from "./screens/calendar.js";
import { renderMore, renderSettings, renderHealth, renderGlossary, renderAbout } from "./screens/more.js";
import { renderOnboarding } from "./screens/onboarding.js";
import { renderAlerts } from "./screens/alerts.js";
import { startUpdate } from "./screens/common.js";

const CFG = window.APP_CONFIG || {};
const params = new URLSearchParams(location.search);
const mainEl = $("#main");

/* ------------------------------------------------------------------ prefs + i18n */
loadPrefs();
if (CFG.demo && params.get("theme")) prefsSet({ theme: params.get("theme") });
if (CFG.demo && params.get("lang")) prefsSet({ lang: params.get("lang") });
if (CFG.demo && params.has("onboarded")) prefsSet({ onboarded: params.get("onboarded") !== "0" });
applyTheme();
await initI18n(prefsGet().lang);
fmt.setNumberLocale(prefsGet().numfmt === "en" ? "en" : "nl-BE");
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => applyTheme());

let glossary = {};
fetch("glossary.json").then((r) => r.json()).then((g) => { glossary = g; }).catch(() => {});

/* ------------------------------------------------------------------ api */
let api;
try {
  if (!CFG.demo) await waitFor(() => window.supabase, 8000);
  api = createApi(CFG, params.get("fixture"));
} catch (e) {
  mount(mainEl, errorState({ title: t("errors.configTitle"), body: t("errors.configBody"), detail: e.message }));
  throw e;
}

function waitFor(test, ms) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (test()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("Supabase library did not load"));
      setTimeout(tick, 50);
    })();
  });
}

/* ------------------------------------------------------------------ data */
const ctx = {
  api, t, fmt, data: null, offline: null, loadError: null,
  rows: [], market: null, runs: [], freshness: "fresh", latestUpdate: null,
  mfa: null, pf: null, pfError: null, // portfolio data: memory only, never cached on the device
  isWide: () => matchMedia("(min-width: 900px)").matches,
  navigate: (path) => { location.hash = path; },
  render: () => route(),
  reload,
  glossaryButton,
  openGlossary,
  toast,
};

function buildRows(d) {
  const byScore = Object.fromEntries((d.scores || []).map((s) => [s.symbol, s]));
  const prev = {};
  const seen = {};
  for (const h of d.history || []) {           // history is newest first
    seen[h.symbol] = (seen[h.symbol] || 0) + 1;
    if (seen[h.symbol] === 2) prev[h.symbol] = h.score;
  }
  return (d.watchlist || []).map((w) => {
    const sym = w.symbol.toUpperCase();
    const s = byScore[sym] || {};
    return { ...s, ...w, symbol: sym, wid: w.id, prev_score: prev[sym] ?? null, score: s.score ?? null, error: s.error || null };
  });
}

function setData(d, offlineAt = null) {
  ctx.data = d;
  ctx.offline = offlineAt;
  ctx.rows = buildRows(d);
  ctx.market = d.market?.data || null;
  ctx.macro = d.macro?.data?.events || [];
  ctx.runs = (d.runs || []).filter((r) => r.job === "daily");
  ctx.intradayRun = (d.runs || []).find((r) => r.job === "intraday") || null;
  ctx.latestUpdate = (d.scores || []).map((s) => s.updated_at).filter(Boolean).sort().pop() || d.market?.updated_at || null;
  ctx.freshness = freshness(ctx.latestUpdate, ctx.runs[0]);
}

async function reload({ quiet = false } = {}) {
  if (!quiet) mount(mainEl, skeletonCards(4));
  try {
    const d = await api.loadAll();
    setData(d);
    ctx.loadError = null;
    if (!api.demo) cacheSave(d);
    await loadPortfolio();
  } catch (e) {
    const cached = api.demo && api.fixture === "offline"
      ? { at: new Date(Date.now() - 3 * 3600e3).toISOString(), data: await createApi(CFG, "normal").loadAll() }
      : cacheLoad();
    if (cached) setData(cached.data, cached.at);
    else ctx.loadError = e;
  }
  route();
}

/** Portfolio data needs the two-step login (aal2); the database returns nothing without it. */
async function loadPortfolio() {
  ctx.pf = null;
  ctx.pfError = null;
  if (ctx.mfa?.level !== "aal2") return;
  try { ctx.pf = await api.loadPortfolio(); } catch (e) { ctx.pfError = e; }
}
ctx.loadPortfolio = loadPortfolio;

/* ------------------------------------------------------------------ shell */
const TABS = [
  { key: "today", path: "#/", icon: "today" },
  { key: "watchlist", path: "#/watchlist", icon: "list" },
  { key: "portfolio", path: "#/portfolio", icon: "wallet" },
  { key: "calendar", path: "#/calendar", icon: "calendar" },
  { key: "more", path: "#/more", icon: "more" },
];

function renderNav(active) {
  const item = (cls, tab) => html`<a class="${cls}" href="${tab.path}" ${active === tab.key ? html`aria-current="page"` : ""}>${icon(tab.icon)}<span>${t(`nav.${tab.key}`)}</span></a>`;
  mount($("#tabbar"), html`${TABS.map((tb) => item("tabbar__item", tb))}`);
  mount($("#rail"), html`<div class="rail__brand">${t("app.name")}</div>${TABS.map((tb) => item("rail__item", tb))}`);
}

function renderTopbar({ title, back = "" }) {
  const fr = ctx.freshness;
  mount($("#topbar"), html`
    ${back ? html`<a class="icon-btn page-head__back" href="${back}" aria-label="${t("common.back")}">${icon("back")}</a>` : ""}
    <h1 class="topbar__title truncate">${title}</h1>
    <div class="topbar__actions">
      <button type="button" class="icon-btn" data-action="search" aria-label="${t("nav.search")}" title="${t("nav.search")} (/)">${icon("search")}</button>
      ${ctx.data ? html`<button type="button" class="freshness" data-state="${fr}" data-action="health"
        aria-label="${t(`freshness.${fr}`)}. ${t("freshness.tapForHealth")}" title="${t(`freshness.${fr}`)}"><span class="freshness__dot"></span></button>` : ""}
    </div>`);
}

function setShellVisible(visible) {
  $("#tabbar").hidden = !visible;
  $("#rail").hidden = !visible;
  $("#topbar").hidden = !visible;
}

/* ------------------------------------------------------------------ router */
const scrollMemory = {};
let currentKey = "";

function parse() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/").filter(Boolean);
  return { name: parts[0] || "today", arg: parts[1] || "" };
}

async function route() {
  scrollMemory[currentKey] = window.scrollY;
  const r = parse();
  currentKey = `${r.name}/${r.arg}`;

  const session = await api.session();
  if (!session) {
    setShellVisible(false);
    document.body.classList.add("no-tabbar");
    const v = document.createElement("div");
    mainEl.replaceChildren(v);
    renderLogin(ctx, v);
    document.documentElement.dataset.screen = "login";
    return;
  }
  // second step: the 6-digit code from the authenticator app (only when it's set up)
  if (!ctx.mfa) {
    try { ctx.mfa = await api.mfaStatus(); } catch { ctx.mfa = { level: "aal1", needsCode: false, enabled: false }; }
  }
  if (ctx.mfa.needsCode) {
    setShellVisible(false);
    document.body.classList.add("no-tabbar");
    const v = document.createElement("div");
    mainEl.replaceChildren(v);
    renderMfaCode(ctx, v);
    document.documentElement.dataset.screen = "mfa";
    return;
  }
  setShellVisible(true);
  $("#tabbar").hidden = r.name === "welcome";
  document.body.classList.toggle("no-tabbar", r.name === "welcome");

  if (!ctx.data && !ctx.loadError) { reload(); return; }
  if (ctx.loadError) {
    renderNav("today");
    renderTopbar({ title: t("app.name") });
    mount(mainEl, errorState({ detail: String(ctx.loadError.message || ctx.loadError) }));
    document.documentElement.dataset.screen = "error";
    return;
  }
  if (!prefsGet().onboarded && r.name !== "welcome") { location.replace("#/welcome"); return; }

  // each render gets a fresh container, so screens' event listeners never pile up
  const view = document.createElement("div");
  mainEl.replaceChildren(view);
  let head;
  switch (r.name) {
    case "watchlist": head = renderWatchlist(ctx, view, {}); renderNav("watchlist"); break;
    case "calendar": head = renderCalendar(ctx, view); renderNav("calendar"); break;
    case "portfolio": head = renderPortfolio(ctx, view); renderNav("portfolio"); break;
    case "canibuy": head = renderCanIBuy(ctx, view, r.arg.toUpperCase()); renderNav("portfolio"); break;
    case "ticker": head = renderWatchlist(ctx, view, { selected: r.arg.toUpperCase() }); renderNav("watchlist"); break;
    case "more":
      renderNav("more");
      head = { settings: renderSettings, health: renderHealth, glossary: renderGlossary, about: renderAbout, alerts: renderAlerts, risk: renderRiskSettings }[r.arg]?.(ctx, view)
        ?? renderMore(ctx, view);
      break;
    case "welcome": head = renderOnboarding(ctx, view); renderNav(""); break; // focused flow: no tab bar
    default: head = renderToday(ctx, view); renderNav("today");
  }
  renderTopbar(head || { title: t("app.name") });
  document.title = `${head?.title || ""} · ${t("app.name")}`;
  document.documentElement.dataset.screen = r.arg ? `${r.name}/${r.arg}` : r.name;
  requestAnimationFrame(() => window.scrollTo(0, scrollMemory[currentKey] || 0));
}

/* ------------------------------------------------------------------ glossary, search */
function glossaryButton(key, label = "") {
  if (!prefsGet().explain || !key) return "";
  return html`<button type="button" class="icon-btn icon-btn--sm info-btn" data-glossary="${key}" aria-label="${t("common.info")} ${label}">${icon("info")}</button>`;
}

function openGlossary(key) {
  const g = glossary[key];
  if (!g) return;
  openSheet({ title: g.title, body: html`<div class="stack text-2">
    <p>${g.what}</p><p><b>${t("glossary.why")}</b> ${g.why}</p>
    <p><b>${t("glossary.how")}</b> ${g.how}</p><p><b>${t("glossary.limits")}</b> ${g.limits}</p></div>` });
}

function openSearch() {
  const { el, close } = openSheet({ title: t("search.title"), body: html`
    <label class="field"><span class="visually-hidden">${t("nav.search")}</span>
      <input class="input" id="search-q" type="search" placeholder="${t("search.placeholder")}" autocomplete="off" autocapitalize="characters"></label>
    <ul class="menu" id="search-results" style="margin-top:var(--space-3)"></ul>` });
  const input = $("#search-q", el);
  const results = $("#search-results", el);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const hits = ctx.rows.filter((r) => !q || r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)).slice(0, 8);
    const addRow = q && !ctx.rows.some((r) => r.symbol.toLowerCase() === q)
      ? html`<li><button type="button" class="menu__item" data-add="${q.toUpperCase()}">${icon("plus")}<span class="menu__label">${t("search.add", { symbol: q.toUpperCase() })}</span></button></li>` : "";
    mount(results, html`${hits.map((r) => html`<li><a class="menu__item" href="#/ticker/${encodeURIComponent(r.symbol)}"><b>${r.symbol}</b><span class="menu__label truncate muted">${r.name || ""}</span>${icon("chevron")}</a></li>`)}${addRow}`);
    results.hidden = !hits.length && !addRow;
  };
  input.addEventListener("input", draw);
  results.addEventListener("click", (e) => {
    if (e.target.closest("a")) close();
    const add = e.target.closest("[data-add]");
    if (add) { close(); openAddSheet(ctx, add.dataset.add); }
  });
  draw();
  setTimeout(() => input.focus(), 50);
}

/* ------------------------------------------------------------------ global events */
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-glossary]");
  if (g) { e.preventDefault(); openGlossary(g.dataset.glossary); return; }
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const act = a.dataset.action;
  if (act === "search") openSearch();
  else if (act === "health") ctx.navigate("#/more/health");
  else if (act === "retry" || act === "refresh") { ctx.loadError = null; reload(); }
  else if (act === "run-update") startUpdate(ctx);
});

let gPressed = 0;
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); openSearch(); }
  else if (e.key === "?") openGlossary("bottom_score");
  else if (e.key === "g") gPressed = Date.now();
  else if (Date.now() - gPressed < 1000 && e.key === "t") ctx.navigate("#/");
  else if (Date.now() - gPressed < 1000 && e.key === "w") ctx.navigate("#/watchlist");
});

window.addEventListener("hashchange", route);
matchMedia("(min-width: 900px)").addEventListener("change", route);
window.addEventListener("online", () => { if (ctx.offline) reload({ quiet: true }); });
api.onAuth((s) => { ctx.mfa = null; ctx.pf = null; if (!s) { cacheClear(); ctx.data = null; } reload(); });

export const appCtx = ctx;
route().finally(() => { document.documentElement.dataset.app = "ready"; });

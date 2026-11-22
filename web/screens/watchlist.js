/* Watchlist — docs/screens/watchlist.md. On desktop (≥ 900 px) the list sits left and the
 * selected ticker's detail right; on phones the ticker detail is its own screen. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { prefsGet, prefsSet } from "../lib/settings.js";
import { ALERT_THRESHOLD } from "../lib/signals.js";
import { icon } from "../components/icons.js";
import { stockCard } from "../components/cards.js";
import { emptyState } from "../components/states.js";
import { openSheet, toast } from "../components/overlays.js";
import { statusBanners, startUpdate } from "./common.js";
import { renderTicker } from "./ticker.js";

/* A small local list for search-as-you-type. Examples only, never recommendations. */
export const KNOWN = [
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["NVDA", "NVIDIA"], ["AMZN", "Amazon"], ["GOOGL", "Alphabet"],
  ["META", "Meta Platforms"], ["TSLA", "Tesla"], ["BRK-B", "Berkshire Hathaway"], ["JNJ", "Johnson & Johnson"],
  ["V", "Visa"], ["KO", "Coca-Cola"], ["PG", "Procter & Gamble"],
  ["ASML.AS", "ASML"], ["IWDA.AS", "iShares Core MSCI World"], ["VWCE.DE", "Vanguard FTSE All-World"],
  ["ADYEN.AS", "Adyen"], ["INGA.AS", "ING Group"], ["PHIA.AS", "Philips"], ["HEIA.AS", "Heineken"],
  ["ABI.BR", "AB InBev"], ["UCB.BR", "UCB"], ["KBC.BR", "KBC Group"], ["SOLB.BR", "Solvay"], ["ACKB.BR", "Ackermans & van Haaren"],
  ["MC.PA", "LVMH"], ["OR.PA", "L'Oréal"], ["AIR.PA", "Airbus"], ["TTE.PA", "TotalEnergies"],
  ["SAP.DE", "SAP"], ["SIE.DE", "Siemens"], ["ALV.DE", "Allianz"], ["NOVO-B.CO", "Novo Nordisk"],
];
const SYMBOL_RE = /^[A-Z0-9.\-^=]{1,20}$/;

const SORTS = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol),
  change: (a, b) => (a.change_pct ?? 99) - (b.change_pct ?? 99),
  high: (a, b) => (a.pct_from_52w_high ?? 99) - (b.pct_from_52w_high ?? 99),
  name: (a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol),
};

function filtered(ctx) {
  const p = prefsGet();
  return ctx.rows
    .filter((r) => !p.minScore || (r.score ?? 0) >= p.minScore)
    .filter((r) => p.market === "all" || r.market === p.market)
    .filter((r) => !p.verdict || p.verdict === "all" || r.verdict === p.verdict)
    .sort(SORTS[p.sort] || SORTS.score);
}

function listHtml(ctx, selected) {
  const p = prefsGet();
  const rows = filtered(ctx);
  const strong = ctx.rows.filter((r) => (r.score ?? 0) >= ALERT_THRESHOLD).length;
  const chips = [];
  if (p.minScore) chips.push(html`<button type="button" class="chip" data-clear="minScore">${t("watchlist.chipScore", { n: p.minScore })}${icon("close")}<span class="visually-hidden">${t("watchlist.removeFilter")}</span></button>`);
  if (p.verdict && p.verdict !== "all") chips.push(html`<button type="button" class="chip" data-clear="verdict">${t(`verdict.${p.verdict}`)}${icon("close")}<span class="visually-hidden">${t("watchlist.removeFilter")}</span></button>`);
  if (p.market !== "all") chips.push(html`<button type="button" class="chip" data-clear="market">${p.market}${icon("close")}<span class="visually-hidden">${t("watchlist.removeFilter")}</span></button>`);

  if (!ctx.rows.length) {
    return emptyState({ title: t("state.emptyWatchlistTitle"), body: t("state.emptyWatchlistBody"), action: t("state.emptyWatchlistAction"), actionId: "add-stock" });
  }
  return html`
    <div class="toolbar">
      <p class="text-2 toolbar__grow">${t("watchlist.count", { n: ctx.rows.length, strong })}</p>
      <button type="button" class="icon-btn" data-action="run-update" aria-label="${t("update.button")}" title="${t("update.button")}">${icon("refresh")}</button>
      <button type="button" class="btn btn--secondary" data-action="filters">${icon("settings")}${t("watchlist.filter")}</button>
    </div>
    <div class="segmented" style="display:flex;margin-bottom:var(--space-3)" role="group" aria-label="${t("watchlist.sortBy")}">
      ${["score", "change", "high", "name"].map((k) => html`<button type="button" data-sort="${k}" aria-pressed="${p.sort === k}">${t(`watchlist.sort.${k}`)}</button>`)}
    </div>
    ${chips.length ? html`<div class="chips" style="margin-bottom:var(--space-3)">${chips}</div>` : ""}
    ${rows.length ? html`<ul class="list">${rows.map((r) => html`<li class="row-actions">
        ${stockCard(r, { href: `#/ticker/${encodeURIComponent(r.symbol)}` })}
        <button type="button" class="icon-btn" data-quick="${r.symbol}" aria-label="${t("watchlist.actionsFor", { symbol: r.symbol })}">${icon("more")}</button>
      </li>`)}</ul>`
      : html`<div class="state"><h3 class="state__title">${t("watchlist.noMatch")}</h3><button type="button" class="btn btn--secondary" data-action="clear-filters">${t("watchlist.clearFilters")}</button></div>`}
    ${selected ? "" : ""}`;
}

export function renderWatchlist(ctx, main, { selected = "" }) {
  const wide = ctx.isWide();

  // Phone + a selected ticker: the detail is its own screen.
  if (selected && !wide) return renderTicker(ctx, main, selected);

  const addBtn = html`<button type="button" class="btn btn--primary fab" data-action="add-stock">${icon("plus")}${t("watchlist.add")}</button>`;
  if (wide) {
    mount(main, html`${statusBanners(ctx)}<div class="split">
      <div class="split__list"><div style="margin-bottom:var(--space-3)">${addBtn}</div><div id="wl-list">${listHtml(ctx, selected)}</div></div>
      <div id="wl-detail">${selected ? "" : html`<div class="state split__detail-empty">${icon("list", { cls: "state__icon" })}<p class="state__body">${t("watchlist.pickOne")}</p></div>`}</div>
    </div>`);
    if (selected) renderTicker(ctx, $("#wl-detail", main), selected, { embedded: true });
    $$(`.stock[href="#/ticker/${encodeURIComponent(selected)}"]`, main).forEach((a) => a.setAttribute("aria-current", "page"));
  } else {
    // the spacer keeps the last card clear of the floating Add button
    mount(main, html`${statusBanners(ctx)}<div id="wl-list">${listHtml(ctx)}</div>${ctx.rows.length ? html`${addBtn}<div style="height:64px" aria-hidden="true"></div>` : ""}`);
  }
  bind(ctx, main);
  return selected && wide ? { title: selected, back: "#/watchlist" } : { title: t("nav.watchlist") };
}

function bind(ctx, main) {
  const rerender = () => ctx.render();
  main.addEventListener("click", (e) => {
    const s = e.target.closest("[data-sort]");
    if (s) { prefsSet({ sort: s.dataset.sort }); rerender(); return; }
    const c = e.target.closest("[data-clear]");
    if (c) { prefsSet({ [c.dataset.clear]: c.dataset.clear === "minScore" ? 0 : "all" }); rerender(); return; }
    const q = e.target.closest("[data-quick]");
    if (q) { quickActions(ctx, q.dataset.quick); return; }
    const a = e.target.closest("[data-action]")?.dataset.action;
    if (a === "add-stock") openAddSheet(ctx);
    else if (a === "filters") openFilters(ctx);
    else if (a === "clear-filters") { prefsSet({ minScore: 0, market: "all", verdict: "all" }); rerender(); }
  });
  // long-press on a card = quick actions (with the visible ⋯ button as the alternative)
  let timer = null;
  let fired = false;
  main.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".row-actions .stock");
    if (!card) return;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      quickActions(ctx, card.closest("li").querySelector("[data-quick]").dataset.quick);
    }, 550);
  });
  ["pointerup", "pointerleave", "pointercancel", "scroll"].forEach((ev) => main.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
  main.addEventListener("click", (e) => { if (fired && e.target.closest(".row-actions .stock")) { e.preventDefault(); fired = false; } }, true);
}

function openFilters(ctx) {
  const p = prefsGet();
  const { el, close } = openSheet({ title: t("watchlist.filtersTitle"), body: html`<div class="stack">
    <div class="field"><span class="field__label">${t("watchlist.minScore")}</span>
      <div class="segmented" role="group" aria-label="${t("watchlist.minScore")}">${[0, 1, 2, 3, 4].map((n) => html`<button type="button" data-min="${n}" aria-pressed="${p.minScore === n}">${n === 0 ? t("watchlist.any") : `≥ ${n}`}</button>`)}</div></div>
    <div class="field"><span class="field__label">${t("watchlist.market")}</span>
      <div class="segmented" role="group" aria-label="${t("watchlist.market")}">${["all", "US", "EU"].map((m) => html`<button type="button" data-market="${m}" aria-pressed="${p.market === m}">${m === "all" ? t("watchlist.any") : m}</button>`)}</div></div>
    <div class="field"><span class="field__label">${t("verdictFilter.title")}</span>
      <div class="chips" role="group" aria-label="${t("verdictFilter.title")}">${["all", "sale", "check", "trap"].map((v) => html`<button type="button" class="chip chip--choice" data-verdict="${v}" aria-pressed="${(p.verdict || "all") === v}">${v === "all" ? t("verdictFilter.all") : t(`verdict.${v}`)}</button>`)}</div></div>
    <button type="button" class="btn btn--primary btn--block" data-done>${t("watchlist.showResults")}</button>
  </div>` });
  el.addEventListener("click", (e) => {
    const m = e.target.closest("[data-min]");
    const k = e.target.closest("[data-market]");
    const v = e.target.closest("[data-verdict]");
    if (m) prefsSet({ minScore: Number(m.dataset.min) });
    if (k) prefsSet({ market: k.dataset.market });
    if (v) prefsSet({ verdict: v.dataset.verdict });
    const hit = m || k || v;
    if (hit) $$("button", hit.parentElement).forEach((b) => b.setAttribute("aria-pressed", String(b === hit)));
    if (e.target.closest("[data-done]")) { close(); ctx.render(); }
  });
  el.addEventListener("close", () => ctx.render());
}

function quickActions(ctx, symbol) {
  const row = ctx.rows.find((r) => r.symbol === symbol);
  if (!row) return;
  const { el, close } = openSheet({ title: `${row.symbol} · ${row.name || ""}`, body: html`<ul class="menu">
    <li><a class="menu__item" href="#/ticker/${encodeURIComponent(symbol)}">${icon("chevron")}<span class="menu__label">${t("watchlist.open")}</span></a></li>
    <li><button type="button" class="menu__item" data-q="buy">${icon("bell")}<span class="menu__label">${t("ticker.setBuyAlert")}</span></button></li>
    <li><button type="button" class="menu__item menu__item--danger" data-q="remove">${icon("trash")}<span class="menu__label">${t("watchlist.remove")}</span></button></li>
  </ul>` });
  el.addEventListener("click", (e) => {
    if (e.target.closest("a")) close();
    const q = e.target.closest("[data-q]")?.dataset.q;
    if (q === "buy") { close(); openBuyLevelSheet(ctx, row); }
    if (q === "remove") { close(); removeStock(ctx, row); }
  });
}

/** Remove with an Undo toast instead of a confirm dialog (8.5). */
export async function removeStock(ctx, row) {
  const original = ctx.data.watchlist.find((w) => w.id === row.wid);
  try {
    await ctx.api.remove(row.wid);
  } catch (e) {
    toast(t("errors.saveFailed", { reason: e.message }));
    return;
  }
  ctx.data.watchlist = ctx.data.watchlist.filter((w) => w.id !== row.wid);
  ctx.reload({ quiet: true });
  if (location.hash.startsWith("#/ticker/")) ctx.navigate("#/watchlist");
  toast(t("toast.removed", { name: row.symbol }), {
    undo: async () => {
      const { user_id, ...rest } = original; // user_id is set by the database default
      await ctx.api.restore(ctx.api.demo ? original : rest);
      ctx.reload({ quiet: true });
    },
  });
}

/** Buy level sheet — the Phase 1 primary action on a ticker. */
export function openBuyLevelSheet(ctx, row) {
  const { el, close } = openSheet({ title: t("ticker.buyTitle", { symbol: row.symbol }), body: html`<form class="stack" novalidate>
    <p class="text-2">${t("ticker.buyHint")}</p>
    <label class="field"><span class="field__label">${t("ticker.buyLabel", { cur: row.currency || "" })}</span>
      <input class="input num" name="buy" inputmode="decimal" autocomplete="off" value="${row.buy_below ?? ""}" aria-describedby="buy-err">
      <span class="field__error" id="buy-err" hidden></span></label>
    <button class="btn btn--primary btn--block" type="submit">${t("ticker.saveBuy")}</button>
    ${row.buy_below ? html`<button class="btn btn--ghost btn--block" type="button" data-clear-buy>${t("ticker.clearBuy")}</button>` : ""}
  </form>` });
  const form = $("form", el);
  const input = form.buy;
  const err = $("#buy-err", el);
  const parse = (s) => Number(String(s).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  const validate = () => {
    const v = input.value.trim();
    const ok = v === "" || (Number.isFinite(parse(v)) && parse(v) > 0);
    input.setAttribute("aria-invalid", String(!ok));
    err.hidden = ok;
    err.textContent = ok ? "" : t("ticker.buyInvalid");
    return ok;
  };
  input.addEventListener("input", validate);
  const save = async (value) => {
    try {
      await ctx.api.update(row.wid, { buy_below: value });
      Object.assign(ctx.data.watchlist.find((w) => w.id === row.wid), { buy_below: value });
      close();
      toast(t("toast.saved"));
      ctx.reload({ quiet: true });
    } catch (e) {
      err.hidden = false;
      err.textContent = t("errors.saveFailed", { reason: e.message });
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (validate()) save(input.value.trim() === "" ? null : parse(input.value));
  });
  $("[data-clear-buy]", el)?.addEventListener("click", () => save(null));
  setTimeout(() => input.focus(), 50);
}

/** Add-stock sheet with search-as-you-type and inline validation. */
export function openAddSheet(ctx, prefill = "") {
  const { el, close } = openSheet({ title: t("add.title"), body: html`<form class="stack" novalidate autocomplete="off">
    <label class="field"><span class="field__label">${t("add.label")}</span>
      <input class="input" name="q" value="${prefill}" placeholder="${t("add.placeholder")}" autocapitalize="characters" spellcheck="false" aria-describedby="add-msg">
      <span class="field__hint" id="add-msg">${t("add.hint")}</span></label>
    <ul class="menu" id="add-suggest" hidden></ul>
    <details><summary class="small" style="min-height:var(--tap-min);display:flex;align-items:center;cursor:pointer;color:var(--color-accent)">${t("add.more")}</summary>
      <div class="stack" style="margin-top:var(--space-2)">
        <label class="field"><span class="field__label">${t("add.name")}</span><input class="input" name="name" maxlength="100"></label>
        <label class="field"><span class="field__label">${t("add.notes")}</span><input class="input" name="notes" maxlength="2000"></label>
      </div></details>
    <button class="btn btn--primary btn--block" type="submit">${icon("plus")}${t("add.submit")}</button>
  </form>` });
  const form = $("form", el);
  const input = form.q;
  const msg = $("#add-msg", el);
  const sug = $("#add-suggest", el);

  const state = () => {
    const raw = input.value.trim();
    const sym = raw.toUpperCase();
    const hits = raw ? KNOWN.filter(([s, n]) => s.startsWith(sym) || n.toLowerCase().includes(raw.toLowerCase())).slice(0, 5) : [];
    const exists = ctx.rows.some((r) => r.symbol === sym);
    const euGuess = !sym.includes(".") ? KNOWN.find(([s]) => s.split(".")[0] === sym && s.includes(".")) : null;
    return { sym, hits, exists, valid: SYMBOL_RE.test(sym), euGuess };
  };
  const draw = () => {
    const s = state();
    mount(sug, html`${s.hits.map(([sym, name]) => html`<li><button type="button" class="menu__item" data-pick="${sym}"><b>${sym}</b><span class="menu__label truncate muted">${name}</span>${ctx.rows.some((r) => r.symbol === sym) ? html`<span class="xs muted">${t("add.onList")}</span>` : ""}</button></li>`)}`);
    sug.hidden = !s.hits.length;
    let text = t("add.hint");
    let bad = false;
    if (input.value.trim()) {
      if (!s.valid) { text = t("add.invalid"); bad = true; }
      else if (s.exists) { text = t("add.exists"); bad = true; }
      else if (s.euGuess) text = t("add.didYouMean", { symbol: s.euGuess[0] });
    }
    msg.textContent = text;
    msg.className = bad ? "field__error" : "field__hint";
    input.setAttribute("aria-invalid", String(bad));
  };
  input.addEventListener("input", draw);
  sug.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pick]");
    if (!p) return;
    input.value = p.dataset.pick;
    const known = KNOWN.find(([s]) => s === p.dataset.pick);
    if (known && !form.name.value) form.name.value = known[1];
    draw();
    input.focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const s = state();
    draw();
    if (!input.value.trim() || !s.valid || s.exists) { input.focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    btn.setAttribute("aria-busy", "true");
    const known = KNOWN.find(([k]) => k === s.sym);
    try {
      await ctx.api.add({
        symbol: s.sym, market: s.sym.includes(".") ? "EU" : "US",
        name: form.name.value.trim() || known?.[1] || null, notes: form.notes.value.trim() || null,
      });
      close();
      toast(t("add.added", { symbol: s.sym }), { action: { label: t("update.scoreNow"), run: () => startUpdate(ctx) }, ms: 8000 });
      await ctx.reload({ quiet: true });
    } catch (err) {
      msg.className = "field__error";
      msg.textContent = err.code === "23505" ? t("add.exists") : t("errors.saveFailed", { reason: err.message });
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
  draw();
  setTimeout(() => input.focus(), 50);
}

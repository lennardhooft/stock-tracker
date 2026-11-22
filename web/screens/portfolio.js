/* Portfolio & Risk (Phase 3A) — docs/screens/portfolio.md, canibuy.md, settings.md (Risk)
 * "How is my money doing, and how much risk am I taking?" Personal data: only after the two-step login. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { settingsFor, RISK_DEFAULTS } from "../lib/risk-defaults.js";
import { valuePortfolio, warnings, typeCap, BUCKET } from "../lib/portfolio.js";
import { sizeFor, stagedPlan, check } from "../lib/sizing.js";
import { correlatedGroups, maxCorrelation, stressTest, concentration, marketOpenNow, withLive, STRESS_KEYS } from "../lib/riskview.js";
import { icon } from "../components/icons.js";
import { verdictBadge } from "../components/badges.js";
import { allocBar, budgetBar, holdingCard, statTile } from "../components/cards.js";
import { banner, emptyState } from "../components/states.js";
import { openSheet, toast } from "../components/overlays.js";
import { statusBanners } from "./common.js";
import { openMfaSetup } from "./more.js";
import { moneyCards } from "./money.js";
import { decisionFields, wireDecision, readDecision, tradeSnapshot, guardCards, preTradeTop, preTradeBody, wirePreTrade, thesisLine } from "./guard.js";

const TYPES = ["broad_etf", "sector_etf", "bond_etf", "stock", "speculative", "crypto", "other"];
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "DKK", "SEK", "NOK", "JPY"];
const eur = (v) => fmt.money(v, "EUR", { decimals: Math.abs(v) >= 100 || v === 0 ? 0 : 2 });
const signedEur = (v) => `${v >= 0 ? "+" : "−"}${eur(Math.abs(v))}`;
const signedPct = (v) => `${v >= 0 ? "+" : "−"}${fmt.pct(Math.abs(v))}`;

const parseNum = (s) => fmt.parseNumber(s);

/** The owner's saved risk settings merged over the profile defaults. */
export function riskSettings(ctx) {
  const r = ctx.pf?.risk;
  const base = settingsFor(r?.profile && r.profile !== "custom" ? r.profile : "balanced");
  if (!r?.settings) return base;
  const s = r.settings;
  return { ...base, ...s, profile: r.profile, type_caps: { ...base.type_caps, ...(s.type_caps || {}) },
    multipliers: { ...base.multipliers, ...(s.multipliers || {}) }, typical_vol: base.typical_vol };
}

const fx = (ctx) => ctx.market?.fx?.rates || {};
const portfolioOf = (ctx) => valuePortfolio(ctx.pf?.transactions || [], withLive(ctx.rows, ctx.live), ctx.pf?.settings || {}, fx(ctx));

/** Gate: two-step login on + portfolio data loaded. Returns html for the blocking state, or "". */
function gate(ctx) {
  if (!ctx.mfa?.enabled) {
    return html`<div class="state"><span class="state__icon">${icon("wallet")}</span><h2 class="state__title">${t("pf.mfaTitle")}</h2>
      <p class="state__body">${t("pf.mfaBody")}</p><button type="button" class="btn btn--primary" data-mfa-setup>${t("mfa.setup")}</button></div>`;
  }
  if (ctx.mfa.level !== "aal2") return banner({ tone: "info", title: t("pf.needCodeTitle"), body: t("pf.needCodeBody") });
  if (ctx.pfError) return banner({ tone: "negative", title: t("pf.loadFailed"), body: String(ctx.pfError.message || "") });
  if (!ctx.pf) return html`<div class="stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div>`;
  return "";
}

/* ======================================================================== Portfolio */
export function renderPortfolio(ctx, main) {
  const blocked = gate(ctx);
  if (blocked) {
    mount(main, html`${blocked}`);
    $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
    return { title: t("nav.portfolio") };
  }
  const s = riskSettings(ctx);
  const pf = portfolioOf(ctx);
  if (!pf.holdings.length && !pf.cash) {
    mount(main, html`<div class="state">
      ${icon("wallet", { cls: "state__icon" })}
      <h2 class="state__title">${t("pf.emptyTitle")}</h2>
      <p class="state__body">${t("pf.emptyBody")}</p>
      <div class="stack" style="gap:var(--space-2);width:100%;max-width:320px">
        <a class="btn btn--primary btn--block" href="#/import">${icon("plus")}${t("imp.link")}</a>
        <button type="button" class="btn btn--secondary btn--block" data-action="add-trade">${t("pf.addFirst")}</button>
      </div></div>`);
    $$('[data-action="add-trade"]', main).forEach((b) => b.addEventListener("click", () => openTradeSheet(ctx)));
    return { title: t("nav.portfolio") };
  }

  const warn = warnings(pf, s).map((w) => {
    const v = { ...w.vars };
    for (const k of ["weight", "cap", "pct", "max", "min"]) if (typeof v[k] === "number") v[k] = fmt.pct(v[k], 1);
    return banner({ tone: "warning", title: t(`pf.warn.${w.key}.title`, v), body: t(`pf.warn.${w.key}.body`, v) });
  });
  const b = (k) => pf.buckets[k]?.pct || 0;
  const satAll = b("satellite") + b("speculative");
  const label = (group, k) => (k === "unknown" ? t("pf.unknown") : k === "spread" ? t("pf.spread") : k === "cash" ? t("pf.cash") : group === "type" ? t(`pf.type.${k}`) : k);
  const alloc = (group) => allocBar(Object.entries(pf.alloc[group]).map(([k, v]) => ({ label: label(group, k), pct: v.pct })),
    { label: t(`pf.alloc.${group}`), otherLabel: t("pf.other") });

  mount(main, html`
    ${statusBanners(ctx, { suspect: false })}
    <div class="summary-block" style="margin-bottom:var(--space-3)">
      <p class="summary">${t("pf.summary", { value: eur(pf.total) })} <span class="chg" data-dir="${pf.dayChange >= 0 ? "up" : "down"}">${pf.dayChange >= 0 ? "▲" : "▼"} ${signedPct(pf.dayChangePct)} ${t("pf.today")}</span></p>
      <p class="summary__meta">${t("pf.plLine", { pl: signedEur(pf.pl), pct: signedPct(pf.plPct) })} · ${t("pf.cashLine", { cash: eur(pf.cash), pct: fmt.pct(pf.total ? (pf.cash / pf.total) * 100 : 0, 0) })}</p>
      <p class="xs muted" id="live-state" aria-live="polite">${ctx.liveAt ? t("pf.live", { time: fmt.relativeTime(ctx.liveAt) }) : t("pf.closing")}</p>
    </div>
    <div class="stack" style="gap:var(--space-2);margin-bottom:var(--space-3)">${warn}</div>
    <a class="btn btn--primary btn--block" href="#/canibuy" style="margin-bottom:var(--space-2)">${icon("wallet")}${t("cib.title")}</a>
    <div class="cluster" style="gap:var(--space-2);margin-bottom:var(--space-4)">
      <button type="button" class="btn btn--secondary" data-action="add-trade" style="flex:1">${icon("plus")}${t("pf.addTrade")}</button>
      <button type="button" class="btn btn--secondary" data-action="cash" style="flex:1">${t("pf.cashButton")}</button>
    </div>

    <section class="card" style="margin-bottom:var(--space-4)" aria-labelledby="budget-h">
      <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="budget-h" style="margin:0">${t("pf.budgetTitle")}</h2>${ctx.glossaryButton("risk_budget", t("pf.budgetTitle"))}</div>
      ${budgetBar({ label: t("pf.bucket.core"), pct: b("core"), limit: s.core_min, kind: "min", text: t("pf.atLeast", { pct: fmt.pct(b("core"), 0), limit: fmt.pct(s.core_min, 0) }), note: t("pf.coreLow") })}
      ${budgetBar({ label: t("pf.bucket.satellite"), pct: satAll, limit: s.satellite_max, text: t("pf.ofMax", { pct: fmt.pct(satAll, 0), limit: fmt.pct(s.satellite_max, 0) }), note: t("pf.satHigh") })}
      ${budgetBar({ label: t("pf.bucket.speculative"), pct: b("speculative"), limit: s.speculative_max, text: t("pf.ofMax", { pct: fmt.pct(b("speculative"), 0), limit: fmt.pct(s.speculative_max, 0) }), note: t("pf.specHigh") })}
      ${budgetBar({ label: t("pf.bucket.cash"), pct: b("cash"), limit: s.cash_reserve, kind: "min", text: t("pf.atLeast", { pct: fmt.pct(b("cash"), 0), limit: fmt.pct(s.cash_reserve, 0) }), note: t("pf.cashLow") })}
      <p class="xs muted" style="margin-top:var(--space-2)">${t("pf.budgetNote", { profile: t(`risk.profile.${s.profile || "balanced"}`) })}</p>
      <a class="btn btn--ghost" href="#/more/risk" style="margin-top:var(--space-1)">${t("pf.changeRules")}${icon("chevron")}</a>
    </section>

    ${riskCard(ctx, pf)}

    ${guardCards(ctx)}
    ${moneyCards(ctx, pf)}

    <div class="cluster" style="justify-content:space-between;align-items:baseline"><h2 class="section-title">${t("pf.holdings", { n: pf.holdings.length })}</h2>
      <a class="btn btn--ghost" href="#/import">${t("imp.link")}${icon("chevron")}</a></div>
    <ul class="list">${pf.holdings.map((h) => {
      const cap = typeCap(h.type, h.row?.quality?.score, s);
      return html`<li>${holdingCard(h, {
        href: `#/ticker/${encodeURIComponent(h.symbol)}`,
        valueText: `${eur(h.value)} · ${fmt.pct(h.weight, 1)}`,
        plText: h.pl == null ? "" : `${t("pf.sinceBought")} ${signedEur(h.pl)} (${signedPct(h.plPct)})${h.priced ? "" : ` · ${t("pf.atCost")}`}`,
        capText: cap != null ? t("pf.capLine", { cap: fmt.pct(cap, 0) }) : t(`pf.type.${h.type}`),
        noteText: h.row?.symbol ? thesisLine(ctx, h.row) : "",
        over: cap != null && h.weight > cap + 0.05,
      })}</li>`;
    })}</ul>

    <h2 class="section-title">${t("pf.allocTitle")}</h2>
    <div class="card stack">
      ${["type", "sector", "region", "currency"].map((g) => html`<div><h3 class="small text-2" style="margin-bottom:var(--space-2)">${t(`pf.alloc.${g}`)}</h3>${alloc(g)}</div>`)}
    </div>
    <p class="xs muted" style="margin-top:var(--space-4)">${t("pf.footer", { date: ctx.latestUpdate ? fmt.dateTime(ctx.latestUpdate) : t("common.na") })}</p>`);

  main.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]")?.dataset.action;
    if (a === "add-trade") openTradeSheet(ctx);
    if (a === "cash") openCashSheet(ctx);
  });
  startLive(ctx, main, pf);
  return { title: t("nav.portfolio") };
}

/* ------------------------------------------------------------------ live prices (3B) */
let liveTimer = null;
function startLive(ctx, main, pf) {
  clearTimeout(liveTimer);
  if (!ctx.api.quotes || !pf.holdings.length) return;
  const due = !ctx.liveAt || Date.now() - new Date(ctx.liveAt).getTime() > 55e3;
  const tick = async () => {
    if (!main.isConnected) return; // left the page: stop polling
    if (marketOpenNow() || ctx.api.demo) {
      try {
        const q = await ctx.api.quotes(pf.holdings.map((h) => h.symbol));
        if (Object.keys(q).length && main.isConnected) { ctx.live = { ...(ctx.live || {}), ...q }; ctx.liveAt = new Date().toISOString(); ctx.render(); return; }
      } catch { /* keep the closing prices; try again next minute */ }
    }
    liveTimer = setTimeout(tick, 60e3);
  };
  liveTimer = setTimeout(tick, due ? 300 : 60e3);
}

/* ------------------------------------------------------------------ risk card (3B, 13.11) */
function riskCard(ctx, pf) {
  if (!pf.holdings.length) return "";
  const syms = pf.holdings.map((h) => h.symbol);
  const { groups } = correlatedGroups(syms, ctx.riskSnapshot);
  const st = stressTest(pf);
  const conc = concentration(pf);
  const crisis = (k) => {
    const x = st[k];
    const note = [x.proxies.length ? t("risk3.proxyNote", { list: x.proxies.join(", ") }) : "", x.missing.length ? t("risk3.missingNote", { list: x.missing.join(", ") }) : ""].filter(Boolean).join(" ");
    return html`<li class="signal" data-state="na">
      <span class="signal__icon" style="color:var(--color-negative)">${icon("trendDown")}</span>
      <span class="signal__name num">${t(`risk3.crisis.${k}`)}: ${x.loss <= 0 ? "−" : "+"}${eur(Math.abs(x.loss))} (${signedPct(x.pct)})</span>
      <span class="signal__detail">${t(`risk3.window.${k}`)}${note ? ` · ${note}` : ""}</span></li>`;
  };
  return html`<section class="card" style="margin-bottom:var(--space-4)" id="risk-card" aria-labelledby="risk3-h">
    <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="risk3-h" style="margin:0">${t("risk3.title")}</h2>${ctx.glossaryButton("stress_test", t("risk3.title"))}</div>
    <h3 class="small text-2" style="margin:var(--space-3) 0 var(--space-1)">${t("risk3.togetherTitle")}</h3>
    ${groups.length ? groups.map((g) => banner({ tone: g.length >= 3 ? "warning" : "info", title: t(g.length >= 3 ? "risk3.togetherWarn" : "risk3.togetherPair", { list: g.join(", ") }), body: t("risk3.togetherBody") }))
      : html`<p class="small">${ctx.riskSnapshot ? t("risk3.togetherNone") : t("risk3.togetherPending")}</p>`}
    <h3 class="small text-2" style="margin:var(--space-3) 0 var(--space-1)">${t("risk3.stressTitle")}</h3>
    <ul class="signals">${STRESS_KEYS.map(crisis)}</ul>
    <p class="xs muted">${t("risk3.stressNote")}</p>
    <h3 class="small text-2" style="margin:var(--space-3) 0 var(--space-1)">${t("risk3.concTitle")}</h3>
    <p class="small num">${t("risk3.conc", { symbol: conc.largest?.symbol || "", pct: fmt.pct(conc.largest?.weight || 0, 1), top3: fmt.pct(conc.top3, 0) })}</p>
  </section>`;
}

async function refreshPortfolio(ctx, { watchlistChanged = false } = {}) {
  if (watchlistChanged) await ctx.reload({ quiet: true });
  else { await ctx.loadPortfolio(); ctx.render(); }
}

/* ------------------------------------------------------------------ add trade */
const PRICE_LABEL = { buy: "trade.price", sell: "trade.price", start: "trade.avgPrice", dividend: "trade.dividendPerShare" };

export function openTradeSheet(ctx, { symbol = "", kind = "buy", quantity = "", price = "", reason = "", pendingId = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const row = ctx.rows.find((r) => r.symbol === symbol);
  const { el, close } = openSheet({ title: t("pf.addTrade"), body: html`<form class="stack" id="trade-form" novalidate>
    <div class="segmented" role="group" aria-label="${t("trade.kind")}">${["buy", "sell", "start", "dividend"].map((k) => html`<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${t(`trade.${k}Short`)}</button>`)}</div>
    <p class="small text-2" id="kind-hint">${t(`trade.${kind}Hint`)}</p>
    <label class="field"><span class="field__label">${t("trade.symbol")}</span>
      <input class="input" name="symbol" list="trade-symbols" autocapitalize="characters" autocomplete="off" value="${symbol}" required>
      <datalist id="trade-symbols">${ctx.rows.map((r) => html`<option value="${r.symbol}">${r.name || ""}</option>`)}</datalist>
      <span class="field__hint">${t("trade.symbolHint")}</span></label>
    <div class="cluster" style="gap:var(--space-3);align-items:flex-start">
      <label class="field" style="flex:1;min-width:130px"><span class="field__label">${t("trade.quantity")}</span><input class="input num" name="quantity" inputmode="decimal" required value="${quantity !== "" ? fmt.num(quantity, Number.isInteger(quantity) ? 0 : 3) : ""}"></label>
      <label class="field" style="flex:1;min-width:130px"><span class="field__label">${t("trade.date")}</span><input class="input" type="date" name="date" value="${today}" max="${today}" required></label>
    </div>
    <div class="cluster" style="gap:var(--space-3);align-items:flex-start">
      <label class="field" style="flex:2;min-width:150px"><span class="field__label" id="price-label">${t(PRICE_LABEL[kind])}</span><input class="input num" name="price" inputmode="decimal" required value="${price !== "" ? fmt.num(price, 2) : ""}"></label>
      <label class="field" style="flex:1;min-width:100px"><span class="field__label">${t("trade.currency")}</span>
        <select class="input" name="currency">${CURRENCIES.map((c) => html`<option ${c === (row?.currency || "EUR") ? "selected" : ""}>${c}</option>`)}</select></label>
    </div>
    <div class="cluster" style="gap:var(--space-3);align-items:flex-start">
      <label class="field" style="flex:1;min-width:130px"><span class="field__label">${t("trade.fees")}</span><input class="input num" name="fees" inputmode="decimal" placeholder="0"></label>
      <label class="field" style="flex:1;min-width:130px"><span class="field__label" id="taxes-label">${t(kind === "dividend" ? "trade.withholding" : "trade.taxes")}</span><input class="input num" name="taxes" inputmode="decimal" placeholder="0"></label>
    </div>
    <label class="field"><span class="field__label">${t("trade.type")}</span>
      <select class="input" name="asset_type">${TYPES.map((k) => html`<option value="${k}" ${k === (row?.asset_type || row?.risk?.suggested_type || "stock") ? "selected" : ""}>${t(`pf.type.${k}`)}</option>`)}</select>
      <span class="field__hint">${t("trade.typeHint")}</span></label>
    <div class="stack" id="decision-box" style="gap:var(--space-3)">${decisionFields(ctx, kind, symbol)}</div>
    <p id="trade-msg" class="small" role="status" aria-live="polite"></p>
    <button class="btn btn--primary btn--block" type="submit">${t("trade.save")}</button>
  </form>` });
  const form = $("#trade-form", el);
  const box = $("#decision-box", el);
  const drawDecision = () => {
    mount(box, html`${decisionFields(ctx, kind, form.symbol.value.trim().toUpperCase())}`);
    if (reason && box.querySelector("[name=reason]")) box.querySelector("[name=reason]").value = reason;
  };
  drawDecision();
  wireDecision(box);
  const msg = $("#trade-msg", el);
  const prefillShares = () => { // a dividend is paid on the shares you own
    const sym = form.symbol.value.trim().toUpperCase();
    const owned = valuePortfolio(ctx.pf?.transactions || [], ctx.rows, {}, fx(ctx)).holdings.find((h) => h.symbol === sym)?.qty;
    if (owned) form.quantity.value = fmt.num(owned, Number.isInteger(owned) ? 0 : 4);
  };
  if (kind === "dividend") prefillShares();
  form.symbol.addEventListener("change", () => {
    if (kind === "dividend") prefillShares();
    const r = ctx.rows.find((x) => x.symbol === form.symbol.value.trim().toUpperCase());
    if (r?.currency) form.currency.value = r.currency;
    if (r) form.asset_type.value = r.asset_type || r.risk?.suggested_type || "stock";
    drawDecision();
  });
  el.addEventListener("click", (e) => {
    const k = e.target.closest("[data-kind]");
    if (!k) return;
    kind = k.dataset.kind;
    $$("[data-kind]", el).forEach((b) => b.setAttribute("aria-pressed", String(b === k)));
    $("#kind-hint", el).textContent = t(`trade.${kind}Hint`);
    $("#price-label", el).textContent = t(PRICE_LABEL[kind]);
    $("#taxes-label", el).textContent = t(kind === "dividend" ? "trade.withholding" : "trade.taxes");
    if (kind === "dividend" && !form.quantity.value) prefillShares();
    drawDecision();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $$("[aria-invalid]", form).forEach((x) => x.removeAttribute("aria-invalid"));
    const fail = (field, key, vars) => { msg.className = "small field__error"; msg.textContent = t(key, vars); field?.setAttribute("aria-invalid", "true"); field?.focus(); };
    const sym = form.symbol.value.trim().toUpperCase();
    const qty = parseNum(form.quantity.value);
    const price = parseNum(form.price.value);
    const fees = form.fees.value ? parseNum(form.fees.value) : 0;
    const taxes = form.taxes.value ? parseNum(form.taxes.value) : 0;
    if (!/^[A-Z0-9.\-^=]{1,20}$/.test(sym)) return fail(form.symbol, "trade.badSymbol");
    if (!(qty > 0)) return fail(form.quantity, "trade.badQty");
    if (!(price >= 0)) return fail(form.price, "trade.badPrice");
    if (!(fees >= 0)) return fail(form.fees, "trade.badCost");
    if (!(taxes >= 0)) return fail(form.taxes, "trade.badCost");
    if (!form.date.value || form.date.value > today) return fail(form.date, "trade.badDate");
    if (kind === "sell") {
      const owned = valuePortfolio(ctx.pf?.transactions || [], ctx.rows, {}, fx(ctx)).holdings.find((h) => h.symbol === sym)?.qty || 0;
      if (qty > owned + 1e-9) return fail(form.quantity, "trade.sellTooMuch", { owned: fmt.num(owned, Number.isInteger(owned) ? 0 : 4) });
    }
    const dec = readDecision(box);
    if (dec.missing) return fail(box.querySelector(dec.missing === "guard.needWhy" ? "[name=reason]" : "button"), dec.missing);
    const btn = form.querySelector('[type="submit"]');
    btn.setAttribute("aria-busy", "true");
    try {
      let wl = ctx.rows.find((r) => r.symbol === sym);
      let watchlistChanged = false;
      if (!wl) {
        const w = await ctx.api.add({ symbol: sym, market: sym.includes(".") ? "EU" : "US", asset_type: form.asset_type.value });
        ctx.data.watchlist.push(w);
        watchlistChanged = true;
      } else if ((wl.asset_type || wl.risk?.suggested_type) !== form.asset_type.value) {
        await ctx.api.update(wl.wid, { asset_type: form.asset_type.value });
        Object.assign(ctx.data.watchlist.find((w) => w.id === wl.wid), { asset_type: form.asset_type.value });
        watchlistChanged = true;
      }
      const cur = form.currency.value;
      const tx = await ctx.api.addTransaction({
        date: form.date.value, symbol: sym, kind, quantity: qty, price, currency: cur, fees, taxes,
        fx_rate: cur !== "EUR" && form.date.value === today ? fx(ctx)[cur] || null : null,
        ...(kind === "buy" || kind === "sell" ? { reason: dec.reason || null, emotion: dec.emotion || null, thesis_broken: dec.thesis_broken ?? null, snapshot: tradeSnapshot(ctx, sym) } : {}),
      });
      if (pendingId && kind === "buy") { // the cooled-off idea became a trade
        await ctx.api.updatePending(pendingId, { status: "bought" });
        Object.assign((ctx.pf?.pending || []).find((p) => p.id === pendingId) || {}, { status: "bought" });
      }
      close();
      toast(t("trade.saved", { symbol: sym }), { undo: async () => { await ctx.api.deleteTransaction(tx.id); await refreshPortfolio(ctx); } });
      await refreshPortfolio(ctx, { watchlistChanged });
    } catch (err) {
      fail(null, "errors.saveFailed", { reason: err.message || "" });
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

/* ------------------------------------------------------------------ cash */
function openCashSheet(ctx) {
  const st = ctx.pf?.settings || {};
  const c = st.cash || {};
  const v = (x) => (x == null || x === "" ? "" : fmt.num(x, 2));
  const { el, close } = openSheet({ title: t("pf.cashTitle"), body: html`<form class="stack" id="cash-form" novalidate>
    <p class="small text-2">${t("pf.cashIntro")}</p>
    <label class="field"><span class="field__label">${t("pf.cashEur")}</span><input class="input num" name="eur" inputmode="decimal" value="${v(c.EUR)}"></label>
    <label class="field"><span class="field__label">${t("pf.cashUsd")}</span><input class="input num" name="usd" inputmode="decimal" value="${v(c.USD)}"></label>
    <label class="field"><span class="field__label">${t("pf.emergency")}</span><input class="input num" name="emergency" inputmode="decimal" value="${v(st.emergency_fund)}">
      <span class="field__hint">${t("pf.emergencyHint")}</span></label>
    <label class="field"><span class="field__label">${t("pf.monthly")}</span><input class="input num" name="monthly" inputmode="decimal" value="${v(st.monthly_contribution)}">
      <span class="field__hint">${t("pf.monthlyHint")}</span></label>
    <p id="cash-msg" class="small" role="status" aria-live="polite"></p>
    <button class="btn btn--primary btn--block" type="submit">${t("common.save")}</button>
  </form>` });
  const form = $("#cash-form", el);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = (x) => (x.value.trim() === "" ? 0 : parseNum(x.value));
    const vals = { EUR: n(form.eur), USD: n(form.usd), em: n(form.emergency), mo: form.monthly.value.trim() === "" ? null : parseNum(form.monthly.value) };
    const bad = Object.entries(vals).find(([, x]) => x != null && !(x >= 0));
    if (bad) { const m = $("#cash-msg", el); m.className = "small field__error"; m.textContent = t("pf.cashInvalid"); return; }
    try {
      await ctx.api.savePortfolioSettings({ cash: { EUR: vals.EUR, USD: vals.USD }, emergency_fund: vals.em, monthly_contribution: vals.mo });
      close();
      toast(t("toast.saved"));
      await refreshPortfolio(ctx);
    } catch (err) {
      const m = $("#cash-msg", el); m.className = "small field__error"; m.textContent = t("errors.saveFailed", { reason: err.message || "" });
    }
  });
}

/* ======================================================================== Can I buy this? */
export function renderCanIBuy(ctx, main, symbol) {
  const blocked = gate(ctx);
  if (blocked) {
    mount(main, html`${blocked}`);
    $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
    return { title: t("cib.title"), back: "#/portfolio" };
  }
  const pf = portfolioOf(ctx);
  if (!pf.total) {
    mount(main, emptyState({ title: t("cib.noPortfolioTitle"), body: t("cib.noPortfolioBody"), action: t("pf.addFirst"), actionId: "add-trade" }));
    $$('[data-action="add-trade"]', main).forEach((b) => b.addEventListener("click", () => openTradeSheet(ctx)));
    return { title: t("cib.title"), back: "#/portfolio" };
  }
  const row = ctx.rows.find((r) => r.symbol === symbol);
  if (!row) {
    // pick a stock: holdings first, then the rest of the watchlist
    const held = new Set(pf.holdings.map((h) => h.symbol));
    const list = [...ctx.rows].sort((a, b) => Number(held.has(b.symbol)) - Number(held.has(a.symbol)) || a.symbol.localeCompare(b.symbol));
    mount(main, html`<p class="summary" style="margin-bottom:var(--space-3)">${t("cib.pick")}</p>
      <ul class="menu">${list.map((r) => html`<li><a class="menu__item" href="#/canibuy/${encodeURIComponent(r.symbol)}">${icon(held.has(r.symbol) ? "wallet" : "list")}
        <span class="menu__label">${r.symbol}<span class="menu__hint">${r.name || ""}${held.has(r.symbol) ? ` · ${t("cib.youOwn")}` : ""}</span></span>${icon("chevron")}</a></li>`)}</ul>`);
    return { title: t("cib.title"), back: "#/portfolio" };
  }

  const s = riskSettings(ctx);
  const type = row.asset_type || row.risk?.suggested_type || "stock";
  const days = row.next_earnings?.date ? Math.round((new Date(`${row.next_earnings.date}T12:00:00Z`) - Date.now()) / 864e5) : null;
  const cand = { symbol: row.symbol, type, vol: row.risk?.vol, max_dd: row.risk?.max_dd, quality: row.quality?.score ?? null,
    verdict: row.verdict, sector: row.risk?.sector, region: row.risk?.region, earnings_in_days: days };
  const corr = maxCorrelation(row.symbol, pf.holdings.map((h) => h.symbol), ctx.riskSnapshot);
  cand.correlated = corr != null && corr > 0.8;
  const res = sizeFor(pf, cand, s);
  const c = res.calc;
  const ruleName = (r) => t(`cib.rule.${r.key}`, { ...r.vars, pct: fmt.pct(r.vars.pct, r.vars.pct < 10 ? 1 : 0), type: r.vars.type ? t(`pf.type.${r.vars.type}`) : "" });

  mount(main, html`
    <div class="page-head" style="margin-bottom:var(--space-3)"><div class="page-head__titles">
      <h2 style="font-size:var(--text-lg);font-weight:var(--weight-semibold)">${row.name || row.symbol}</h2>
      <p class="small muted">${row.symbol} · ${t(`pf.type.${type}`)}${c.vol ? ` · ${t("cib.volLine", { vol: fmt.pct(c.vol * 100, 0) })}` : ""}${row.quality?.score != null ? ` · ${t("quality.score")} ${row.quality.score}` : ""}</p>
    </div>${["sale", "check", "trap"].includes(row.verdict) ? html`<div>${verdictBadge(row.verdict)}</div>` : ""}</div>

    ${preTradeTop(ctx, row)}
    <section class="card stack" aria-live="polite" id="cib-answer">
      ${res.room > 0 ? html`<p class="answer">${t("cib.upTo", { amount: eur(res.maxPosition) })}</p>
      <p>${res.owned > 0 ? t("cib.ownRoom", { owned: eur(res.owned), room: eur(res.room) }) : t("cib.room", { room: eur(res.room) })}
        <span class="muted">(${fmt.pct((res.maxPosition / res.total) * 100, 1)} ${t("cib.ofPortfolio")})</span></p>`
      : html`<p class="answer">${t("cib.noRoomBig")}</p>
      <p>${res.limitingCap != null && res.owned > res.limitingCap
        ? t("cib.aboveCap", { owned: eur(res.owned), cap: eur(res.limitingCap) })
        : t("cib.ruleFull")}</p>`}
      <p class="small"><b>${t("cib.limitedBy")}</b> ${ruleName(res.rules.find((r) => r.key === res.limiting))}</p>
      <label class="field"><span class="field__label">${t("cib.amountLabel")}</span>
        <input class="input num" id="cib-amount" inputmode="decimal" placeholder="${t("cib.amountPlaceholder")}"></label>
      <p id="cib-check" class="small" aria-live="polite"></p>
    </section>

    ${res.notes.length ? html`<div class="stack" style="gap:var(--space-2);margin-top:var(--space-3)">${res.notes.map((n) => banner({ tone: n === "earningsSoon" ? "warning" : "info", title: t(`cib.note.${n}`, { days }), body: "" }))}</div>` : ""}

    ${preTradeBody()}

    <h3 class="section-title">${t("cib.rulesTitle")}</h3>
    <ul class="signals card">${res.rules.map((r) => html`<li class="signal rule-row" data-state="${r.key === res.limiting ? "passed" : "na"}" data-limiting="${r.key === res.limiting}">
      <span class="signal__icon">${icon(r.key === res.limiting ? "warning" : "dash", { label: r.key === res.limiting ? t("cib.limiting") : "" })}</span>
      <span class="signal__name">${ruleName(r)}</span>
      <span class="signal__detail num">${r.room <= 0 ? t("cib.noRoom") : t("cib.roomFor", { amount: eur(r.room) })}${r.key === res.limiting ? ` · ${t("cib.limiting")}` : ""}</span></li>`)}</ul>

    <details class="explain card" style="margin-top:var(--space-3)">
      <summary>${t("cib.howTitle")}</summary>
      <p class="small num" style="margin-top:var(--space-2)">${t("cib.how1", { total: eur(res.total), pct: fmt.pct(s.risk_per_position, 1), loss: eur(c.maxLoss) })}</p>
      <p class="small num">${t("cib.how2", { k: fmt.num(c.k, 1), vol: fmt.pct(c.vol * 100, 0), bad: fmt.pct(c.bad * 100, 0) })}</p>
      <p class="small num">${t("cib.how3", { loss: eur(c.maxLoss), bad: fmt.pct(c.bad * 100, 0), base: eur(c.base) })}</p>
      ${c.qMult !== 1 || c.vMult !== 1 || c.cMult !== 1 ? html`<p class="small num">${t("cib.how4", { q: fmt.num(c.qMult, 2), v: fmt.num(c.vMult, 2), amount: eur(c.riskAmount) })}${c.cMult !== 1 ? ` ${t("cib.how5", { c: fmt.num(c.cMult, 2), corr: fmt.num(corr, 2) })}` : ""}</p>` : ""}
      <p class="small text-2">${t("cib.howLast")}</p>
    </details>

    <h3 class="section-title">${t("cib.planTitle")}</h3>
    <div class="card" id="cib-plan"><span class="skeleton skeleton--text"></span></div>

    <p class="xs muted" style="margin-top:var(--space-3)">${t("cib.disclaimer")}</p>`);

  const amount = $("#cib-amount", main);
  const out = $("#cib-check", main);
  amount.addEventListener("input", () => {
    const r = check(parseNum(amount.value), res);
    out.style.color = "";
    if (!r) { out.textContent = ""; return; }
    out.textContent = r.fits ? `✅ ${t("cib.fits", { amount: eur(parseNum(amount.value)) })}` : `⚠️ ${t("cib.tooMuch", { amount: eur(parseNum(amount.value)), over: eur(r.over) })}`;
    out.style.color = r.fits ? "var(--color-positive)" : "var(--color-warning)";
  });
  const pt = wirePreTrade(ctx, main, { row, pf, res, type, cand: { ...cand, currency: row.currency } });

  // staged plan needs the levels + 200-week average from the detail data
  const planEl = $("#cib-plan", main);
  ctx.api.detail(row.symbol).then((d) => {
    if (!planEl.isConnected) return;
    const w = d?.weekly || {};
    const sma = (w.sma200 || []).filter((x) => x != null).pop() || null;
    const sup = (w.levels?.zones || []).filter((z) => z.role === "support").sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
    const plan = stagedPlan(res.room, row.price, { support: sup ? (sup.low + sup.high) / 2 : null, sma200: sma });
    pt.setIdeas(sup ? (sup.low + sup.high) / 2 : null, sma);
    mount(planEl, plan.length ? html`<ul class="signals">${plan.map((p) => html`<li class="signal" data-state="na">
        <span class="signal__icon">${icon(p.why === "now" ? "check" : "trendDown")}</span>
        <span class="signal__name num">${eur(p.amount)} ${p.why === "now" ? t("cib.planNow") : t("cib.planAt", { price: fmt.money(p.at, row.currency) })}</span>
        <span class="signal__detail">${t(`cib.why.${p.why}`)}</span></li>`)}</ul>` : html`<p class="text-2">${t("cib.noPlan")}</p>`);
  }).catch(() => { if (planEl.isConnected) mount(planEl, html`<p class="text-2">${t("cib.noPlan")}</p>`); });
  return { title: t("cib.title"), back: "#/canibuy" };
}

/* ======================================================================== Settings → Risk */
const RISK_FIELDS = [
  ["profile", [["risk_per_position", 0.25, 5], ["k", 0.5, 3]]],
  ["split", [["core_min", 0, 100], ["satellite_max", 0, 100], ["speculative_max", 0, 50], ["cash_reserve", 0, 50]]],
  ["caps", [["type_caps.sector_etf", 1, 50], ["type_caps.stock_quality", 1, 30], ["type_caps.stock", 1, 30], ["type_caps.speculative", 0.5, 20], ["type_caps.crypto", 0.5, 20], ["sector_max", 5, 100], ["region_max", 10, 100]]],
  ["mult", [["multipliers.quality_high", 0, 2], ["multipliers.quality_medium", 0, 2], ["multipliers.quality_low", 0, 2], ["multipliers.verdict_sale", 0, 2], ["multipliers.verdict_trap", 0, 2]]],
];
const getPath = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((x, k) => (x[k] ??= {}), o)[last] = v; }

export function renderRiskSettings(ctx, main) {
  const blocked = gate(ctx);
  if (blocked) {
    mount(main, html`${blocked}`);
    $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
    return { title: t("risk.title"), back: "#/more" };
  }
  let s = structuredClone(riskSettings(ctx));
  let profile = s.profile || "balanced";
  const pf = portfolioOf(ctx);
  const example = pf.holdings.find((h) => h.type === "stock")?.row || ctx.rows.find((r) => (r.asset_type || r.risk?.suggested_type) === "stock" && r.risk?.vol);

  const preview = () => {
    if (!example || !pf.total) return t("risk.previewNone");
    const r = sizeFor(pf, { symbol: example.symbol, type: "stock", vol: example.risk?.vol, max_dd: example.risk?.max_dd,
      quality: example.quality?.score, verdict: example.verdict, sector: example.risk?.sector, region: example.risk?.region }, s);
    // the rule-based max position (independent of what's already owned)
    const caps = r.rules.filter((x) => x.cap != null).map((x) => x.cap);
    return t("risk.preview", { symbol: example.symbol, amount: eur(Math.min(...caps)) });
  };
  const field = ([key, min, max]) => html`<label class="field setting"><span class="setting__label">${t(`risk.f.${key.replace(".", "_")}`)}</span>
    <input class="input num" style="max-width:140px" inputmode="decimal" data-key="${key}" data-min="${min}" data-max="${max}" value="${fmt.num(getPath(s, key), key.startsWith("multipliers") || key === "k" ? 2 : 1)}">
    <span class="setting__hint">${t(`risk.h.${key.replace(".", "_")}`)} ${t("risk.default", { value: fmt.num(getPath(settingsFor(profile === "custom" ? "balanced" : profile), key), key.startsWith("multipliers") || key === "k" ? 2 : 1) })}</span></label>`;

  mount(main, html`<div style="max-width:640px">
    <p class="summary" id="risk-preview" aria-live="polite" style="margin-bottom:var(--space-3)">${preview()}</p>
    <div class="card stack">
      <span class="setting__label">${t("risk.profileLabel")}</span>
      <div class="segmented" role="group" aria-label="${t("risk.profileLabel")}" id="profiles">${["conservative", "balanced", "aggressive", "custom"].map((p) => html`<button type="button" data-profile="${p}" aria-pressed="${p === profile}" ${p === "custom" ? "disabled" : ""}>${t(`risk.profile.${p}`)}</button>`)}</div>
      <span class="setting__hint">${t("risk.profileHint")}</span>
    </div>
    <form id="risk-form" novalidate>
      ${RISK_FIELDS.map(([group, fields]) => html`<h2 class="section-title">${t(`risk.group.${group}`)}</h2><div class="card">${fields.map(field)}</div>`)}
      <p id="risk-msg" class="small" role="status" aria-live="polite" style="margin-top:var(--space-3)"></p>
      <div class="cluster" style="gap:var(--space-2);margin-top:var(--space-3)">
        <button class="btn btn--primary" type="submit" style="flex:1">${t("common.save")}</button>
        <button class="btn btn--secondary" type="button" data-reset style="flex:1">${t("risk.reset")}</button>
      </div>
    </form>
    <p class="xs muted" style="margin-top:var(--space-3)">${t("risk.logNote")}</p>
  </div>`);

  const form = $("#risk-form", main);
  const msg = $("#risk-msg", main);
  const fill = () => $$("[data-key]", form).forEach((i) => { const k = i.dataset.key; i.value = fmt.num(getPath(s, k), k.startsWith("multipliers") || k === "k" ? 2 : 1); });
  const setProfile = (p) => { profile = p; $$("[data-profile]", main).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.profile === p))); };
  main.addEventListener("click", (e) => {
    const p = e.target.closest("[data-profile]");
    if (p && p.dataset.profile !== "custom") { s = settingsFor(p.dataset.profile); setProfile(p.dataset.profile); fill(); $("#risk-preview", main).textContent = preview(); }
    if (e.target.closest("[data-reset]")) { s = settingsFor("balanced"); setProfile("balanced"); fill(); $("#risk-preview", main).textContent = preview(); }
  });
  form.addEventListener("input", (e) => {
    const i = e.target.closest("[data-key]");
    if (!i) return;
    const v = parseNum(i.value);
    if (Number.isFinite(v)) { setPath(s, i.dataset.key, v); setProfile("custom"); $("#risk-preview", main).textContent = preview(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $$("[aria-invalid]", form).forEach((x) => x.removeAttribute("aria-invalid"));
    for (const i of $$("[data-key]", form)) {
      const v = parseNum(i.value);
      if (!(v >= Number(i.dataset.min) && v <= Number(i.dataset.max))) {
        i.setAttribute("aria-invalid", "true"); i.focus();
        msg.className = "small field__error";
        msg.textContent = t("risk.invalid", { field: t(`risk.f.${i.dataset.key.replace(".", "_")}`), min: fmt.num(Number(i.dataset.min), 2), max: fmt.num(Number(i.dataset.max), 2) });
        return;
      }
    }
    if (s.core_min + s.satellite_max > 100.0001) { msg.className = "small field__error"; msg.textContent = t("risk.splitInvalid"); return; }
    const { typical_vol, profile: _p, ...save } = s;
    try {
      await ctx.api.saveRisk(profile, save);
      ctx.pf.risk = { profile, settings: save };
      toast(t("toast.saved"));
      msg.className = "small"; msg.textContent = "";
    } catch (err) {
      msg.className = "small field__error";
      msg.textContent = t("errors.saveFailed", { reason: err.message || "" });
    }
  });
  return { title: t("risk.title"), back: "#/more" };
}

export { RISK_DEFAULTS, BUCKET };

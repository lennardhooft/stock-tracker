/* Phase 3D — guardrails, decision log, thesis checks, pre-trade checklist, reviews.
 * Spec: docs/screens/portfolio-3d.md. Logic: lib/guardrails.js, lib/thesis.js (tested). */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { valuePortfolio } from "../lib/portfolio.js";
import { withLive } from "../lib/riskview.js";
import { GUARDRAILS } from "../lib/guardrails-config.js";
import { fomo, tradeLimit, panicSell, cooling, checklist, orderCosts, limitIdeas, impact, snapshot, reviewsDue, resultSince, byEmotion } from "../lib/guardrails.js";
import { METRICS, evaluate, status as thesisStatus } from "../lib/thesis.js";
import { icon } from "../components/icons.js";
import { banner, emptyState } from "../components/states.js";
import { openSheet, toast } from "../components/overlays.js";
import { openMfaSetup } from "./more.js";
import { openTradeSheet } from "./portfolio.js";

const today = () => new Date().toISOString().slice(0, 10);
const fxOf = (ctx) => ctx.market?.fx?.rates || {};
const eur = (v, d = 0) => fmt.money(v, "EUR", { decimals: d });
const portfolioOf = (ctx) => valuePortfolio(ctx.pf?.transactions || [], withLive(ctx.rows, ctx.live), ctx.pf?.settings || {}, fxOf(ctx));
const STATE_ICON = { ok: "check", warn: "warning", na: "dash" };
const signedPct = (v) => `${v >= 0 ? "+" : "−"}${fmt.pct(Math.abs(v), 1)}`;

/* ================================================================== thesis helpers */
export const thesisOf = (ctx, sym) => (ctx.pf?.thesis || []).find((x) => x.symbol === sym) || null;

export function thesisState(ctx, row) {
  const th = thesisOf(ctx, row.symbol);
  const results = evaluate(th?.rules || [], row.metrics || {});
  return { th, results, status: thesisStatus(results) };
}

/** One line for the holding card ("" when there are no rules). */
export function thesisLine(ctx, row) {
  const { status } = thesisState(ctx, row);
  if (status === "none" || status === "unknown") return "";
  return t(`thesis.status.${status}`);
}

const fmtMetric = (key, v) => {
  if (v == null) return t("common.na");
  const m = METRICS[key] || { unit: "", dec: 1 };
  if (m.unit === "%") return fmt.pct(v, m.dec);
  if (m.unit === "x") return `${fmt.num(v, m.dec)}×`;
  return fmt.num(v, m.dec);
};

/* ================================================================== trade sheet: decision log */
/** Extra fields for a buy or sell: why, feeling, and the panic-sell check. "" for other kinds. */
export function decisionFields(ctx, kind, sym) {
  if (!GUARDRAILS.decision_log.enabled || (kind !== "buy" && kind !== "sell")) return "";
  const row = ctx.rows.find((r) => r.symbol === sym);
  const holding = portfolioOf(ctx).holdings.find((h) => h.symbol === sym);
  const panic = kind === "sell" && panicSell(row, holding);
  const th = thesisOf(ctx, sym);
  return html`
    ${panic ? html`<div class="card stack" style="gap:var(--space-2);border-color:var(--color-warning)" data-panic>
      <p class="small"><b>${icon("warning")} ${t("guard.panicTitle", { pct: fmt.pct(Math.abs(Math.min(row?.pct_from_52w_high ?? 0, holding?.plPct ?? 0)), 0) })}</b></p>
      ${th?.why ? html`<p class="small"><span class="text-2">${t("thesis.why")}:</span> ${th.why}</p>` : html`<p class="small text-2">${t("guard.panicNoThesis")}</p>`}
      ${th?.sell_if ? html`<p class="small"><span class="text-2">${t("thesis.sellIf")}:</span> ${th.sell_if}</p>` : ""}
      <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field__label">${t("guard.panicQ")}</legend>
        <div class="chips" role="group">${["yes", "no"].map((k) => html`<button type="button" class="chip chip--choice" data-broken="${k}" aria-pressed="false">${t(`guard.panic.${k}`)}</button>`)}</div></fieldset>
    </div>` : ""}
    <label class="field"><span class="field__label">${t("guard.why")}</span>
      <input class="input" name="reason" maxlength="200" autocomplete="off" placeholder="${t(kind === "buy" ? "guard.whyBuyPh" : "guard.whySellPh")}"></label>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field__label">${t("guard.feel")}</legend>
      <div class="chips" role="group">${GUARDRAILS.decision_log.emotions.map((k) => html`<button type="button" class="chip chip--choice" data-emotion="${k}" aria-pressed="false">${t(`guard.emotion.${k}`)}</button>`)}</div>
      <span class="field__hint">${t("guard.feelHint")}</span></fieldset>`;
}

/** Wires the chips inside the decision box. */
export function wireDecision(box) {
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-emotion], [data-broken]");
    if (!b) return;
    const attr = b.hasAttribute("data-emotion") ? "data-emotion" : "data-broken";
    $$(`[${attr}]`, box).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
}

/** {reason, emotion, thesis_broken, missing} from the decision box (missing = i18n key of what's missing). */
export function readDecision(box) {
  if (!box || !box.querySelector("[name=reason]")) return { missing: null };
  const reason = box.querySelector("[name=reason]").value.trim();
  const emotion = box.querySelector("[data-emotion][aria-pressed=true]")?.dataset.emotion || null;
  const panic = box.querySelector("[data-panic]");
  const broken = box.querySelector("[data-broken][aria-pressed=true]")?.dataset.broken;
  const missing = panic && !broken ? "guard.needPanic" : !reason ? "guard.needWhy" : !emotion ? "guard.needFeel" : null;
  return { reason: reason || null, emotion, thesis_broken: panic ? broken === "yes" : null, missing };
}

export const tradeSnapshot = (ctx, sym) => snapshot(ctx.rows.find((r) => r.symbol === sym));

/* ================================================================== portfolio page */
/** Trade counter, decisions waiting, reviews due (above the returns card). */
export function guardCards(ctx) {
  const tl = tradeLimit(ctx.pf?.transactions || [], today());
  const now = new Date();
  const pend = (ctx.pf?.pending || []).filter((p) => p.status === "waiting");
  const due = reviewsDue(ctx.pf?.transactions || [], ctx.pf?.reviews || [], today());
  const month = fmt.date(`${today().slice(0, 7)}-15`, { month: "long" });
  return html`
    ${tl.enabled ? html`<p class="small text-2" style="margin-bottom:var(--space-2)" data-trade-count>${t("guard.tradesLine", { n: tl.count, max: tl.max })}</p>
      ${tl.reached ? html`<div style="margin-bottom:var(--space-3)">${banner({ tone: "warning", title: t("guard.limitTitle", { max: tl.max, month }), body: t("guard.limitBody") })}</div>` : ""}` : ""}
    ${pend.map((p) => {
      const ready = new Date(p.decide_after) <= now;
      return html`<a class="card card--link" href="#/canibuy/${encodeURIComponent(p.symbol)}" style="margin-bottom:var(--space-3)" data-pending="${p.id}">
        <span class="card__title">${icon(ready ? "check" : "calendar")} ${t(ready ? "guard.readyTitle" : "guard.waitTitle", { symbol: p.symbol, amount: p.amount ? eur(p.amount) : "" })}</span>
        <span class="small text-2">${ready ? t("guard.readyBody") : t("guard.waitBody", { when: fmt.dateTime(p.decide_after) })}</span>
        ${icon("chevron", { cls: "icon card__chevron" })}</a>`;
    })}
    ${due.length ? html`<a class="card card--link" href="#/portfolio/decisions" style="margin-bottom:var(--space-3)">
      <span class="card__title">${icon("bell")} ${t("guard.reviewsDue", { n: due.length })}</span>
      <span class="small text-2">${t("guard.reviewsDueBody")}</span>${icon("chevron", { cls: "icon card__chevron" })}</a>` : ""}`;
}

/* ================================================================== Can I buy this? */
/** FOMO warning + cooling-off state, shown before the answer. */
export function preTradeTop(ctx, row) {
  const f = fomo(row);
  const c = cooling(ctx.pf?.pending, row.symbol);
  return html`
    ${c ? banner({ tone: c.ready ? "info" : "warning", title: t(c.ready ? "guard.cibReady" : "guard.cibWaiting", { when: fmt.dateTime(c.decide_after) }), body: c.reason ? t("guard.yourReason", { reason: c.reason }) : "" }) : ""}
    ${f ? html`<div style="margin-bottom:var(--space-3)">${banner({ tone: "warning", title: f.byRise ? t("guard.fomoRise", { symbol: row.symbol, pct: fmt.pct(f.rise, 0) }) : t("guard.fomoTop", { symbol: row.symbol, top: f.top }), body: t("guard.fomoBody") })}</div>` : ""}`;
}

/** Checklist, costs, limit ideas, impact and actions (below the answer). */
export function preTradeBody() {
  return html`
    <h3 class="section-title">${t("guard.checkTitle")}</h3>
    <ul class="signals card" id="pt-check"></ul>
    <section class="card stack" style="margin-top:var(--space-3);gap:var(--space-2)" aria-labelledby="pt-plan-h">
      <h3 class="card__title" id="pt-plan-h" style="margin:0">${t("guard.plannerTitle")}</h3>
      <div id="pt-ideas" class="chips" role="group" aria-label="${t("guard.ideasLabel")}"></div>
      <div id="pt-costs" aria-live="polite"></div>
      <div id="pt-impact" aria-live="polite"></div>
    </section>
    <div class="stack" style="gap:var(--space-2);margin-top:var(--space-3)" id="pt-actions"></div>`;
}

/** Wires the pre-trade section. info: {row, pf, res, type, cand}. Returns {setIdeas(support, sma200)}. */
export function wirePreTrade(ctx, main, { row, pf, res, type, cand }) {
  const owned = pf.holdings.find((h) => h.symbol === row.symbol)?.value || 0;
  const th = thesisOf(ctx, row.symbol);
  const days = cand.earnings_in_days;
  const trades = tradeLimit(ctx.pf?.transactions || [], today());
  const f = fomo(row);
  const amountEl = $("#cib-amount", main);
  let price = row.price;
  const rate = row.currency === "EUR" || !row.currency ? 1 : fxOf(ctx)[row.currency];

  const draw = () => {
    const amount = fmt.parseNumber(amountEl.value);
    const cooled = cooling(ctx.pf?.pending, row.symbol);
    const items = checklist({ row, type, owned, thesis: th, cooled, res, amount, trades, earningsDays: days, fomoHit: f });
    mount($("#pt-check", main), html`${items.map((i) => html`<li class="signal" data-state="${i.state === "ok" ? "passed" : i.state === "warn" ? "warn" : "na"}" data-check="${i.key}">
      <span class="signal__icon">${icon(STATE_ICON[i.state], { label: t(`guard.state.${i.state}`) })}</span>
      <span class="signal__name">${t(`guard.check.${i.key}.${i.state}`, { ...i.vars, room: i.vars?.room != null ? eur(i.vars.room) : "", amount: i.vars?.amount ? eur(i.vars.amount) : "", q: i.vars?.q ?? "", rise: i.vars?.rise != null ? fmt.pct(i.vars.rise, 0) : "", top: i.vars?.top ?? "" })}</span>
      <span class="signal__tag">${t(`guard.state.${i.state}`)}</span></li>`)}`);
    const c = orderCosts(amount, row.symbol, type, fxOf(ctx));
    mount($("#pt-costs", main), c ? html`<p class="small" ${c.warn ? html`style="color:var(--color-warning)"` : ""}>${c.warn ? html`${icon("warning")} ` : ""}${t("guard.costs", { total: eur(c.total, 2), pct: fmt.pct(c.pct, 2) })}</p>
      <p class="xs text-2">${c.feeKnown ? t("guard.costsFee", { fee: eur(c.fee, 2) }) : t("guard.costsFeeUnknown")} · ${t("guard.costsTob", { tob: eur(c.tob, 2) })}${c.fxIncluded ? "" : ` · ${t("guard.costsNoFx")}`}</p>`
      : html`<p class="small text-2">${t("guard.costsNeedAmount")}</p>`);
    const im = impact(pf, cand, amount);
    const line = (label, r) => (r ? html`<li class="cluster" style="justify-content:space-between"><span>${label}</span><span class="num">${fmt.pct(r.now, 1)} → <b>${fmt.pct(r.after, 1)}</b></span></li>` : "");
    mount($("#pt-impact", main), im ? html`<h4 class="small text-2" style="margin-top:var(--space-2)">${t("guard.impactTitle")}</h4>
      <ul class="list small" style="gap:var(--space-1)">
        ${line(t("guard.impact.position", { symbol: row.symbol }), im.position)}
        ${im.sector ? line(t("guard.impact.sector", { name: im.sector.key }), im.sector) : ""}
        ${im.region ? line(t("guard.impact.region", { name: im.region.key }), im.region) : ""}
        ${line(t("guard.impact.currency", { name: im.currency.key }), im.currency)}
        ${line(t("guard.impact.satellite"), im.satellite)}
      </ul>${im.cashAfter < 0 ? html`<p class="small" style="color:var(--color-warning)">${icon("warning")} ${t("guard.notEnoughCash", { short: eur(-im.cashAfter) })}</p>` : ""}` : "");
    const inPlanNow = items.find((i) => i.key === "plan")?.state === "ok";
    const showWait = GUARDRAILS.cooling_off.enabled && !inPlanNow && !cooled;
    mount($("#pt-actions", main), html`
      <button type="button" class="btn ${showWait ? "btn--secondary" : "btn--primary"} btn--block" data-pt="log">${icon("plus")}${t("guard.logTrade")}</button>
      ${showWait ? html`<button type="button" class="btn btn--primary btn--block" data-pt="wait">${icon("calendar")}${t("guard.decideTomorrow")}</button>
        <p class="xs text-2">${t("guard.waitWhy", { h: GUARDRAILS.cooling_off.hours })}</p>` : ""}
      ${cooled ? html`<button type="button" class="btn btn--ghost btn--block" data-pt="drop">${t("guard.dropIt")}</button>` : ""}`);
  };

  const setIdeas = (support, sma200) => {
    const ideas = limitIdeas(row.price, { support, sma200 });
    mount($("#pt-ideas", main), html`${ideas.map((x) => html`<button type="button" class="chip chip--choice" data-idea="${x.price}" aria-pressed="${x.price === price}">
      ${t(`guard.idea.${x.key}`)} ${fmt.money(x.price, row.currency)}${x.dist ? ` (${fmt.pct(x.dist, 0)})` : ""}</button>`)}`);
  };
  setIdeas(null, null);
  draw();
  amountEl.addEventListener("input", draw);
  main.addEventListener("click", async (e) => {
    const idea = e.target.closest("[data-idea]");
    if (idea) {
      price = Number(idea.dataset.idea);
      $$("[data-idea]", main).forEach((b) => b.setAttribute("aria-pressed", String(b === idea)));
      return;
    }
    const a = e.target.closest("[data-pt]")?.dataset.pt;
    if (!a) return;
    const amount = fmt.parseNumber(amountEl.value);
    const cooled = cooling(ctx.pf?.pending, row.symbol);
    if (a === "log") {
      const qty = amount > 0 && price > 0 && rate ? Math.floor(((amount * rate) / price) * 1000) / 1000 : "";
      openTradeSheet(ctx, { symbol: row.symbol, kind: "buy", quantity: qty, price, pendingId: cooled?.id || null, reason: cooled?.reason || "" });
    }
    if (a === "wait") openWaitSheet(ctx, row, amount);
    if (a === "drop" && cooled) {
      await ctx.api.updatePending(cooled.id, { status: "dropped" });
      cooled.status = "dropped";
      Object.assign(ctx.pf.pending.find((p) => p.id === cooled.id) || {}, { status: "dropped" });
      toast(t("guard.dropped", { symbol: row.symbol }));
      draw();
    }
  });
  return { setIdeas, redraw: draw };
}

function openWaitSheet(ctx, row, amount) {
  const { el, close } = openSheet({ title: t("guard.decideTomorrow"), body: html`<form class="stack" id="wait-form" novalidate>
    <p class="small text-2">${t("guard.waitIntro", { h: GUARDRAILS.cooling_off.hours, symbol: row.symbol })}</p>
    <label class="field"><span class="field__label">${t("guard.waitReason")}</span><input class="input" name="reason" maxlength="200" autocomplete="off"></label>
    <p id="wait-msg" class="small" role="status" aria-live="polite"></p>
    <button class="btn btn--primary btn--block" type="submit">${t("guard.waitSave")}</button></form>` });
  const form = $("#wait-form", el);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("[type=submit]");
    btn.setAttribute("aria-busy", "true");
    try {
      const after = new Date(Date.now() + GUARDRAILS.cooling_off.hours * 3600e3).toISOString();
      const p = await ctx.api.addPending({ symbol: row.symbol, amount: amount > 0 ? amount : null, reason: form.reason.value.trim() || null, snapshot: snapshot(row), decide_after: after });
      (ctx.pf.pending ||= []).push(p);
      close();
      toast(t("guard.waitSaved", { symbol: row.symbol, when: fmt.dateTime(after) }));
      ctx.render();
    } catch (err) {
      const m = $("#wait-msg", el); m.className = "small field__error"; m.textContent = t("errors.saveFailed", { reason: err.message || "" });
    } finally { btn.removeAttribute("aria-busy"); }
  });
}

/* ================================================================== gate */
function gated(ctx, main, head) {
  if (ctx.mfa?.enabled && ctx.mfa.level === "aal2" && ctx.pf) return false;
  if (ctx.pfError) { mount(main, banner({ tone: "negative", title: t("pf.loadFailed"), body: String(ctx.pfError.message || "") })); return head; }
  mount(main, html`<div class="state"><span class="state__icon">${icon("wallet")}</span><h2 class="state__title">${t("pf.mfaTitle")}</h2>
    <p class="state__body">${t("pf.mfaBody")}</p>${ctx.mfa?.enabled ? "" : html`<button type="button" class="btn btn--primary" data-mfa-setup>${t("mfa.setup")}</button>`}</div>`);
  $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
  return head;
}

/* ================================================================== Thesis — #/thesis/SYM */
export function renderThesis(ctx, main, sym) {
  const head = { title: t("thesis.title", { symbol: sym }), back: `#/ticker/${encodeURIComponent(sym)}` };
  const g = gated(ctx, main, head);
  if (g) return g;
  const row = ctx.rows.find((r) => r.symbol === sym);
  if (!row) { mount(main, emptyState({ title: t("thesis.notOnList", { symbol: sym }), body: "" })); return head; }
  const th = thesisOf(ctx, sym) || { symbol: sym, rules: [] };
  let rules = structuredClone(th.rules || []);
  const metrics = row.metrics || {};
  const drawRules = () => {
    const res = evaluate(rules, metrics);
    const st = thesisStatus(res);
    mount($("#th-status", main), st === "none" ? html`<p class="text-2">${t("thesis.noRules")}</p>`
      : html`<p class="summary" data-status="${st}">${t(`thesis.status.${st}`)}</p>`);
    mount($("#th-rules", main), html`${res.map((r, i) => html`<li class="card stack th-rule" style="gap:var(--space-2)" data-i="${i}">
      <div class="cluster" style="gap:var(--space-2);align-items:flex-end">
        <label class="field" style="flex:2;min-width:150px"><span class="field__label">${t("thesis.metric")}</span>
          <select class="input" data-f="metric">${Object.keys(METRICS).map((k) => html`<option value="${k}" ${k === r.metric ? "selected" : ""}>${t(`thesis.m.${k}`)}</option>`)}</select></label>
        <label class="field" style="flex:1;min-width:90px"><span class="field__label">${t("thesis.op")}</span>
          <select class="input" data-f="op"><option value=">=" ${r.op === ">=" ? "selected" : ""}>${t("thesis.atLeast")}</option><option value="<=" ${r.op === "<=" ? "selected" : ""}>${t("thesis.atMost")}</option></select></label>
        <label class="field" style="flex:1;min-width:90px"><span class="field__label">${t("thesis.value")}</span>
          <input class="input num" data-f="value" inputmode="decimal" value="${r.value != null ? fmt.num(Number(r.value), Number.isInteger(Number(r.value)) ? 0 : 2) : ""}"></label>
        <button type="button" class="icon-btn" data-del="${i}" aria-label="${t("thesis.removeRule", { n: i + 1 })}">${icon("trash")}</button>
      </div>
      <span class="small" style="color:var(--color-${r.ok === false ? "negative" : r.ok ? "positive" : "text-2"})">${icon(r.ok === false ? "cross" : r.ok ? "check" : "dash")}
        ${t("thesis.now", { value: fmtMetric(r.metric, r.actual) })} · ${r.ok === false ? t("thesis.broken") : r.ok ? t("thesis.ok") : t("thesis.unknown")}</span>
    </li>`)}`);
  };
  mount(main, html`<div class="stack" style="max-width:720px">
    <p class="summary">${t("thesis.lead", { symbol: sym })}</p>
    <form class="stack" id="th-form" novalidate>
      <label class="field"><span class="field__label">${t("thesis.why")}</span><textarea class="input" name="why" rows="3" maxlength="1000" placeholder="${t("thesis.whyPh")}">${th.why || ""}</textarea></label>
      <label class="field"><span class="field__label">${t("thesis.sellIf")}</span><textarea class="input" name="sell_if" rows="3" maxlength="1000" placeholder="${t("thesis.sellIfPh")}">${th.sell_if || ""}</textarea></label>
      <div class="cluster" style="gap:var(--space-3);align-items:flex-start">
        <label class="field" style="flex:1;min-width:140px"><span class="field__label">${t("thesis.target", { cur: row.currency || "" })}</span><input class="input num" name="target_price" inputmode="decimal" value="${th.target_price != null ? fmt.num(Number(th.target_price), 2) : ""}"></label>
        <label class="field" style="flex:1;min-width:140px"><span class="field__label">${t("thesis.review")}</span><input class="input" type="date" name="review_date" value="${th.review_date || ""}"></label>
      </div>
      <section class="stack" style="gap:var(--space-2)" aria-labelledby="th-rules-h">
        <div class="cluster" style="justify-content:space-between"><h2 class="section-title" id="th-rules-h" style="margin:0">${t("thesis.rulesTitle")}</h2>${ctx.glossaryButton("thesis_rules", t("thesis.rulesTitle"))}</div>
        <p class="small text-2">${t("thesis.rulesHint")}</p>
        <div id="th-status" aria-live="polite"></div>
        <ul class="list" id="th-rules"></ul>
        <button type="button" class="btn btn--secondary" data-add-rule>${icon("plus")}${t("thesis.addRule")}</button>
      </section>
      <p id="th-msg" class="small" role="status" aria-live="polite"></p>
      <button class="btn btn--primary btn--block" type="submit">${t("thesis.save")}</button>
    </form></div>`);
  drawRules();
  const form = $("#th-form", main);
  form.addEventListener("change", (e) => {
    const li = e.target.closest("[data-i]");
    const f = e.target.dataset.f;
    if (!li || !f) return;
    const r = rules[Number(li.dataset.i)];
    r[f] = f === "value" ? fmt.parseNumber(e.target.value) : e.target.value;
    drawRules();
  });
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-add-rule]")) {
      if (rules.length >= 10) return;
      rules.push({ metric: "quality_score", op: ">=", value: 60 });
      drawRules();
    }
    const del = e.target.closest("[data-del]");
    if (del) { rules.splice(Number(del.dataset.del), 1); drawRules(); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#th-msg", main);
    const bad = rules.find((r) => !Number.isFinite(Number(r.value)) || r.value === null);
    if (bad) { msg.className = "small field__error"; msg.textContent = t("thesis.badValue"); return; }
    const tp = form.target_price.value.trim() ? fmt.parseNumber(form.target_price.value) : null;
    if (tp != null && !(tp > 0)) { msg.className = "small field__error"; msg.textContent = t("thesis.badTarget"); return; }
    const btn = form.querySelector("[type=submit]");
    btn.setAttribute("aria-busy", "true");
    try {
      const saved = await ctx.api.saveThesis({ symbol: sym, why: form.why.value.trim() || null, sell_if: form.sell_if.value.trim() || null,
        target_price: tp, review_date: form.review_date.value || null, rules: rules.map((r) => ({ metric: r.metric, op: r.op, value: Number(r.value) })) });
      const list = (ctx.pf.thesis ||= []);
      const i = list.findIndex((x) => x.symbol === sym);
      if (i >= 0) list[i] = saved; else list.push(saved);
      msg.className = "small"; msg.textContent = "";
      toast(t("thesis.saved", { symbol: sym }));
    } catch (err) {
      msg.className = "small field__error"; msg.textContent = t("errors.saveFailed", { reason: err.message || "" });
    } finally { btn.removeAttribute("aria-busy"); }
  });
  return head;
}

/* ================================================================== Decisions & reviews — #/portfolio/decisions */
export function renderDecisions(ctx, main) {
  const head = { title: t("dec.title"), back: "#/portfolio" };
  const g = gated(ctx, main, head);
  if (g) return g;
  const txs = (ctx.pf.transactions || []).filter((x) => x.kind === "buy" || x.kind === "sell").sort((a, b) => b.date.localeCompare(a.date));
  if (!txs.length) {
    mount(main, emptyState({ title: t("dec.emptyTitle"), body: t("dec.emptyBody"), action: t("pf.addTrade"), actionId: "add-trade" }));
    $('[data-action="add-trade"]', main).addEventListener("click", () => openTradeSheet(ctx));
    return head;
  }
  const price = Object.fromEntries(ctx.rows.map((r) => [r.symbol, r.price]));
  let showAll = false;
  const draw = () => {
    const due = reviewsDue(ctx.pf.transactions, ctx.pf.reviews, today());
    const emo = byEmotion(ctx.pf.transactions, ctx.rows);
    const done = new Map((ctx.pf.reviews || []).map((r) => [`${r.transaction_id}:${r.due}`, r]));
    mount(main, html`<div class="stack" style="max-width:760px">
      <p class="summary">${due.length ? t("dec.leadDue", { n: due.length }) : t("dec.leadNone")}</p>
      ${due.length ? html`<section aria-labelledby="due-h"><h2 class="section-title" id="due-h">${t("dec.dueTitle")}</h2>
        <ul class="list">${(showAll ? due : due.slice(0, 3)).map((d) => html`<li><button type="button" class="card card--link" data-review="${d.tx.id}" data-due="${d.due}">
          <span class="card__title">${t(`dec.reviewOf.${d.tx.kind}`, { symbol: d.tx.symbol, m: d.due === "3m" ? 3 : 12 })}</span>
          <span class="small text-2">${t("dec.dueSince", { date: fmt.date(d.date) })}</span>${icon("chevron", { cls: "icon card__chevron" })}</button></li>`)}</ul>
        ${!showAll && due.length > 3 ? html`<button type="button" class="btn btn--ghost" data-show-all style="margin-top:var(--space-2)">${t("dec.showAll", { n: due.length })}</button>` : ""}</section>` : ""}
      ${Object.keys(emo).length ? html`<section class="card" aria-labelledby="emo-h">
        <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="emo-h" style="margin:0">${t("dec.byFeeling")}</h2>${ctx.glossaryButton("decision_log", t("dec.byFeeling"))}</div>
        <table class="dtable" style="margin-top:var(--space-2)"><thead><tr><th scope="col">${t("dec.feeling")}</th><th scope="col">${t("dec.count")}</th><th scope="col">${t("dec.avgSince")}</th></tr></thead>
        <tbody>${GUARDRAILS.decision_log.emotions.filter((k) => emo[k]).map((k) => html`<tr><th scope="row" style="font-weight:inherit">${t(`guard.emotion.${k}`)}</th><td class="num">${emo[k].n}</td>
          <td class="num">${emo[k].avg != null ? signedPct(emo[k].avg) : t("common.na")}</td></tr>`)}</tbody></table>
        <p class="xs muted" style="margin-top:var(--space-2)">${t("dec.byFeelingNote")}</p></section>` : ""}
      <section aria-labelledby="all-h"><h2 class="section-title" id="all-h">${t("dec.allTitle")}</h2>
        <ul class="list">${txs.map((x) => {
          const r = resultSince(x, price[x.symbol]);
          const revs = ["3m", "12m"].map((k) => done.get(`${x.id}:${k}`)).filter(Boolean);
          return html`<li class="card stack" style="gap:var(--space-1)">
            <div class="cluster" style="justify-content:space-between"><span><b>${t(`trade.${x.kind}`)} ${x.symbol}</b> <span class="small text-2">${fmt.date(x.date)}</span></span>
              <span class="num small">${r != null ? html`${t(x.kind === "sell" ? "dec.sinceSell" : "dec.sinceBuy")} <b>${signedPct(r)}</b>` : ""}</span></div>
            <span class="small">${x.reason ? `“${x.reason}”` : html`<span class="text-2">${t("dec.noReason")}</span>`}${x.emotion ? ` · ${t(`guard.emotion.${x.emotion}`)}` : ""}${x.thesis_broken != null ? ` · ${t(x.thesis_broken ? "dec.panicYes" : "dec.panicNo")}` : ""}</span>
            ${revs.map((rv) => html`<span class="small text-2">${t("dec.reviewed", { due: rv.due === "3m" ? 3 : 12, process: t(`dec.process.${rv.process}`) })}${rv.lesson ? ` · “${rv.lesson}”` : ""}</span>`)}
          </li>`;
        })}</ul></section>
      <p class="xs muted">${t("dec.footer")}</p>
    </div>`);
  };
  draw();
  main.addEventListener("click", (e) => {
    if (e.target.closest("[data-show-all]")) { showAll = true; draw(); return; }
    const b = e.target.closest("[data-review]");
    if (!b) return;
    const tx = ctx.pf.transactions.find((x) => String(x.id) === b.dataset.review);
    if (tx) openReviewSheet(ctx, tx, b.dataset.due, draw);
  });
  return head;
}

function benchChange(ctx, from) {
  const s = ctx.pf?.perf?.data?.series;
  if (!s?.t?.length) return null;
  let i = s.t.findIndex((d) => d >= from);
  if (i < 0) return null;
  const a = s.bench[i];
  const b = s.bench[s.bench.length - 1];
  return a && b ? (b / a - 1) * 100 : null;
}

function openReviewSheet(ctx, tx, due, done) {
  const row = ctx.rows.find((r) => r.symbol === tx.symbol);
  const now = row?.price;
  const r = resultSince(tx, now);
  const bench = benchChange(ctx, tx.date);
  const snap = tx.snapshot || {};
  const ts = row ? thesisState(ctx, row) : { status: "none" };
  let process = null;
  const { el, close } = openSheet({ title: t(`dec.reviewOf.${tx.kind}`, { symbol: tx.symbol, m: due === "3m" ? 3 : 12 }), body: html`<form class="stack" id="rev-form" novalidate>
    <ul class="list small" style="gap:var(--space-1)">
      <li>${t("dec.priceThenNow", { then: fmt.money(tx.price, tx.currency), now: now != null ? fmt.money(now, row.currency) : t("common.na"), date: fmt.date(tx.date) })}${r != null ? html` · <b>${signedPct(tx.kind === "sell" ? -r : r)}</b>` : ""}</li>
      <li>${bench != null ? t("dec.benchSame", { pct: signedPct(bench) }) : t("dec.benchNa")}</li>
      <li>${t("dec.signalsThen", { score: snap.score ?? t("common.na"), quality: snap.quality ?? t("common.na"), verdict: snap.verdict ? t(`verdict.${snap.verdict}`) : t("common.na") })}</li>
      <li>${tx.reason ? t("dec.youSaid", { reason: tx.reason }) : t("dec.noReason")}${tx.emotion ? ` · ${t(`guard.emotion.${tx.emotion}`)}` : ""}</li>
      <li>${t("dec.thesisNow", { status: t(`thesis.statusShort.${ts.status}`) })}</li>
    </ul>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="field__label">${t("dec.rateProcess")}</legend>
      <div class="chips" role="group">${["good", "bad"].map((k) => html`<button type="button" class="chip chip--choice" data-process="${k}" aria-pressed="false">${t(`dec.process.${k}`)}</button>`)}</div>
      <span class="field__hint">${t("dec.rateHint")}</span></fieldset>
    <label class="field"><span class="field__label">${t("dec.lesson")}</span><input class="input" name="lesson" maxlength="300" autocomplete="off"></label>
    <p id="rev-msg" class="small" role="status" aria-live="polite"></p>
    <button class="btn btn--primary btn--block" type="submit">${t("dec.saveReview")}</button></form>` });
  const form = $("#rev-form", el);
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-process]");
    if (!b) return;
    process = b.dataset.process;
    $$("[data-process]", form).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#rev-msg", el);
    if (!process) { msg.className = "small field__error"; msg.textContent = t("dec.needProcess"); return; }
    try {
      const rv = await ctx.api.addReview({ transaction_id: tx.id, due, process, lesson: form.lesson.value.trim() || null });
      (ctx.pf.reviews ||= []).push(rv);
      close();
      toast(t("dec.reviewSaved"));
      done();
    } catch (err) { msg.className = "small field__error"; msg.textContent = t("errors.saveFailed", { reason: err.message || "" }); }
  });
}


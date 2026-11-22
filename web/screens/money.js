/* Phase 3C screens under the Portfolio tab — spec: docs/screens/portfolio-3c.md.
 * Returns vs MSCI World · Dividend income · Transactions · Tax overview. All need the two-step login
 * (same gate as the Portfolio page); money data is held in memory only. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { valuePortfolio } from "../lib/portfolio.js";
import { withLive } from "../lib/riskview.js";
import { forecast, nextPayment } from "../lib/dividends.js";
import { yearReport, toCsv } from "../lib/tax.js";
import { COSTS } from "../lib/costs.js";
import { icon } from "../components/icons.js";
import { statTile } from "../components/cards.js";
import { banner, emptyState } from "../components/states.js";
import { toast } from "../components/overlays.js";
import { compareChart } from "../components/chart.js";
import { openMfaSetup } from "./more.js";
import { openTradeSheet } from "./portfolio.js";

const BENCH_NAME = "MSCI World (IWDA.AS, EUR)";
const eur = (v, d = 0) => fmt.money(v, "EUR", { decimals: d });
const signed = (v, d = 1) => `${v >= 0 ? "▲ +" : "▼ "}${fmt.pct(v, d)}`;
const fx = (ctx) => ctx.market?.fx?.rates || {};
const portfolioOf = (ctx) => valuePortfolio(ctx.pf?.transactions || [], withLive(ctx.rows, ctx.live), ctx.pf?.settings || {}, fx(ctx));
const today = () => new Date().toISOString().slice(0, 10);
const back = { back: "#/portfolio" };

/** Same rule as the Portfolio page: two-step login, then the data. Returns true when blocked. */
function gated(ctx, main, title) {
  if (ctx.mfa?.enabled && ctx.mfa.level === "aal2" && ctx.pf) return false;
  if (ctx.pfError) {
    mount(main, banner({ tone: "negative", title: t("pf.loadFailed"), body: String(ctx.pfError.message || "") }));
    return true;
  }
  mount(main, html`<div class="state"><span class="state__icon">${icon("wallet")}</span><h2 class="state__title">${t("pf.mfaTitle")}</h2>
    <p class="state__body">${t("pf.mfaBody")}</p>${ctx.mfa?.enabled ? "" : html`<button type="button" class="btn btn--primary" data-mfa-setup>${t("mfa.setup")}</button>`}</div>`);
  $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
  return { title, ...back };
}

/* =================================================================== Portfolio page cards */
/** Two summary cards + links for the Portfolio page. */
export function moneyCards(ctx, pf) {
  const perf = ctx.pf?.perf?.data;
  const all = perf?.periods?.all;
  const div = forecast(pf.holdings, fx(ctx), today());
  const next = nextPayment(div.perHolding, today());
  return html`
    <a class="card card--link" href="#/portfolio/returns" style="margin-bottom:var(--space-3)">
      <span class="card__title">${t("ret.cardTitle")}</span>
      <span class="small text-2">${perf && all?.you != null
        ? html`${t("ret.since", { date: fmt.date(perf.since) })}: <b class="num">${signed(all.you)}</b> · ${t("ret.benchShort")} <span class="num">${all.bench != null ? signed(all.bench) : t("common.na")}</span>`
        : t("ret.cardPending")}</span>
      ${icon("chevron", { cls: "icon card__chevron" })}
    </a>
    <a class="card card--link" href="#/portfolio/dividends" style="margin-bottom:var(--space-3)">
      <span class="card__title">${t("div.cardTitle")}</span>
      <span class="small text-2">${div.payers
        ? html`${t("div.cardLine", { net: eur(div.net) })}${next ? ` · ${t("div.cardNext", { symbol: next.symbol, date: fmt.date(next.exDate, { day: "numeric", month: "short" }) })}` : ""}`
        : t("div.cardNone")}</span>
      ${icon("chevron", { cls: "icon card__chevron" })}
    </a>
    <div class="cluster" style="gap:var(--space-2);margin-bottom:var(--space-4)">
      <a class="btn btn--secondary" href="#/portfolio/transactions" style="flex:1">${t("txl.title")}</a>
      <a class="btn btn--secondary" href="#/portfolio/tax" style="flex:1">${t("tax.title")}</a>
    </div>`;
}

/* =================================================================== Returns */
export function renderReturns(ctx, main) {
  const title = t("ret.title");
  const g = gated(ctx, main, title);
  if (g) return g;
  const txs = ctx.pf.transactions || [];
  if (!txs.length) {
    mount(main, emptyState({ title: t("ret.emptyTitle"), body: t("ret.emptyBody"), action: t("pf.addFirst"), actionId: "add-trade" }));
    $('[data-action="add-trade"]', main).addEventListener("click", () => openTradeSheet(ctx));
    return { title, ...back };
  }
  const perf = ctx.pf.perf?.data;
  if (!perf) {
    const first = [...txs].sort((a, b) => a.date.localeCompare(b.date))[0].date;
    mount(main, html`<div class="state"><span class="state__icon">${icon("calendar")}</span><h2 class="state__title">${t("ret.pendingTitle")}</h2>
      <p class="state__body">${t("ret.pendingBody", { date: fmt.date(first) })}</p></div>`);
    return { title, ...back };
  }
  let period = "all";
  const p = perf.periods || {};
  const draw = () => {
    const cur = p[period] || {};
    const diff = cur.you != null && cur.bench != null ? cur.you - cur.bench : null;
    const lead = cur.you == null
      ? t("ret.periodNa")
      : t(period === "all" ? "ret.leadAll" : "ret.leadPeriod", { date: fmt.date(perf.since), period: t(`ret.period.${period}`), you: signed(cur.you), bench: cur.bench != null ? signed(cur.bench) : t("common.na"), name: BENCH_NAME });
    const verdict = diff == null ? "" : Math.abs(diff) < 0.05 ? t("ret.even") : t(diff > 0 ? "ret.ahead" : "ret.behind", { pts: fmt.num(Math.abs(diff), 1) });
    mount($("#ret-answer", main), html`<p class="summary">${lead}</p>${verdict ? html`<p class="summary__meta">${verdict}</p>` : ""}`);
    $$("[data-period]", main).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === period)));
  };
  const early = perf.trading_days < 20;
  const wiAhead = perf.difference != null && perf.difference >= 0;
  mount(main, html`<div class="stack" style="max-width:760px">
    ${early ? banner({ tone: "info", title: t("ret.earlyTitle"), body: t("ret.earlyBody", { date: fmt.date(perf.since) }) }) : ""}
    <div id="ret-answer" aria-live="polite"></div>
    <div class="chips" role="group" aria-label="${t("ret.periodLabel")}">
      ${["ytd", "1y", "3y", "all"].map((k) => html`<button type="button" class="chip chip--choice" data-period="${k}" aria-pressed="${k === period}" ${p[k]?.you == null ? "disabled" : ""}>${t(`ret.period.${k}`)}</button>`)}
    </div>
    <section class="card" aria-labelledby="ret-chart-h">
      <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="ret-chart-h" style="margin:0">${t("ret.chartTitle")}</h2>${ctx.glossaryButton("twr", t("ret.chartTitle"))}</div>
      <div class="cluster small text-2" style="gap:var(--space-3);margin:var(--space-2) 0">
        <span><span class="alloc__dot" style="background:var(--chart-1)"></span> ${t("ret.you")}</span>
        <span><span class="alloc__dot" style="background:var(--chart-2)"></span> ${BENCH_NAME}</span>
      </div>
      <div id="ret-chart" style="height:240px"></div>
      <p class="xs muted" style="margin-top:var(--space-2)">${t("ret.chartAlt", { you: signed(p.all?.you ?? 0), bench: p.all?.bench != null ? signed(p.all.bench) : t("common.na"), date: fmt.date(perf.since) })} ${t("ret.chartNote")}</p>
    </section>
    <section class="card" aria-labelledby="wi-h">
      <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="wi-h" style="margin:0">${t("ret.whatIfTitle")}</h2>${ctx.glossaryButton("what_if", t("ret.whatIfTitle"))}</div>
      ${perf.what_if != null ? html`<p style="margin-top:var(--space-2)">${t("ret.whatIfBody", { etf: eur(perf.what_if), you: eur(perf.value) })}
        <b>${t(wiAhead ? "ret.whatIfAhead" : "ret.whatIfBehind", { diff: eur(Math.abs(perf.difference)) })}</b></p>` : html`<p class="text-2">${t("common.na")}</p>`}
      <div class="tiles" style="margin-top:var(--space-3)">
        ${statTile({ label: t("ret.xirrYou"), value: perf.xirr != null ? `${fmt.pct(perf.xirr * 100, 1)} ${t("ret.perYear")}` : t("common.na"), glossaryKey: "xirr" })}
        ${statTile({ label: t("ret.xirrEtf"), value: perf.xirr_bench != null ? `${fmt.pct(perf.xirr_bench * 100, 1)} ${t("ret.perYear")}` : t("common.na") })}
        ${statTile({ label: t("ret.netIn"), value: eur(perf.net_invested), context: t("ret.netInHint") })}
      </div>
      ${early ? html`<p class="xs muted" style="margin-top:var(--space-2)">${t("ret.xirrEarly")}</p>` : ""}
    </section>
    ${Object.keys(perf.parts || {}).length ? html`<section class="card" aria-labelledby="parts-h">
      <h2 class="card__title" id="parts-h">${t("ret.partsTitle")}</h2>
      <table class="dtable"><thead><tr><th scope="col">${t("ret.part")}</th><th scope="col">${t("ret.period.all")}</th><th scope="col">${t("ret.period.1y")}</th></tr></thead>
      <tbody>${Object.entries(perf.parts).map(([k, v]) => html`<tr><th scope="row" style="font-weight:inherit">${t(`pf.bucket.${k}`)}</th>
        <td class="num">${v.all != null ? signed(v.all) : t("common.na")}</td><td class="num">${v["1y"] != null ? signed(v["1y"]) : t("common.na")}</td></tr>`)}
      <tr><th scope="row" style="font-weight:inherit">${BENCH_NAME}</th><td class="num">${p.all?.bench != null ? signed(p.all.bench) : t("common.na")}</td><td class="num">${p["1y"]?.bench != null ? signed(p["1y"].bench) : t("common.na")}</td></tr></tbody></table>
      <p class="xs muted" style="margin-top:var(--space-2)">${t("ret.partsNote")}</p>
    </section>` : ""}
    <p class="xs muted">${t("ret.footer", { date: fmt.dateTime(ctx.pf.perf.updated_at) })}</p>
  </div>`);
  draw();
  $$("[data-period]", main).forEach((b) => b.addEventListener("click", () => { period = b.dataset.period; draw(); }));
  compareChart($("#ret-chart", main), perf.series, { youLabel: t("ret.you"), benchLabel: "MSCI World" })
    .catch(() => mount($("#ret-chart", main), banner({ tone: "warning", title: t("chart.failed"), body: "" })));
  return { title, ...back };
}

/* =================================================================== Dividends */
export function renderDividends(ctx, main) {
  const title = t("div.title");
  const g = gated(ctx, main, title);
  if (g) return g;
  const pf = portfolioOf(ctx);
  const f = forecast(pf.holdings, fx(ctx), today());
  const year = Number(today().slice(0, 4));
  const rep = yearReport(ctx.pf.transactions || [], fx(ctx));
  const got = rep.by[year] || { dividends: [], divNet: 0, divGross: 0 };
  const max = Math.max(...f.months.map((m) => m.net), 1);
  const monthName = (m) => fmt.date(`${m}-15`, { month: "short", year: "2-digit" });
  mount(main, html`<div class="stack" style="max-width:760px">
    ${f.payers ? html`<div><p class="summary">${t("div.lead", { net: eur(f.net), gross: eur(f.gross) })}</p>
      <p class="summary__meta">${t("div.leadMeta", { n: f.payers })}</p></div>` : html`<div class="state"><span class="state__icon">${icon("bank")}</span>
      <h2 class="state__title">${t("div.noneTitle")}</h2><p class="state__body">${t("div.noneBody")}</p></div>`}
    <button type="button" class="btn btn--primary btn--block" data-action="log-div">${icon("plus")}${t("div.log")}</button>
    ${f.payers ? html`<section class="card" aria-labelledby="months-h">
      <div class="cluster" style="justify-content:space-between"><h2 class="card__title" id="months-h" style="margin:0">${t("div.monthsTitle")}</h2>${ctx.glossaryButton("dividend_forecast", t("div.monthsTitle"))}</div>
      <ul class="mbars">${f.months.map((m) => html`<li class="mbars__row"><span class="mbars__label">${monthName(m.month)}</span>
        <span class="mbars__track" aria-hidden="true"><span class="mbars__fill" style="width:${((m.net / max) * 100).toFixed(1)}%"></span></span>
        <span class="mbars__value num">${m.net > 0 ? eur(m.net, m.net < 10 ? 2 : 0) : "—"}</span></li>`)}</ul>
      <p class="xs muted" style="margin-top:var(--space-2)">${t("div.monthsNote", { days: COSTS.dividend_tax.pay_days_after_ex })}</p>
    </section>
    <section aria-labelledby="dh-h"><h2 class="section-title" id="dh-h">${t("div.perHolding")}</h2>
      <ul class="list">${f.perHolding.map((x) => html`<li class="card stack" style="gap:var(--space-1)">
        <div class="cluster" style="justify-content:space-between"><a href="#/ticker/${encodeURIComponent(x.symbol)}"><b>${x.symbol}</b> <span class="text-2 small">${x.name || ""}</span></a>
          <span class="num"><b>${eur(x.netYear, x.netYear < 10 ? 2 : 0)}</b> <span class="small text-2">${t("div.perYearNet")}</span></span></div>
        <span class="small text-2">${t("div.holdingLine", { dps: fmt.money(x.dps, x.currency), n: x.perYear, yld: x.yieldPct != null ? fmt.pct(x.yieldPct, 1) : t("common.na"), yoc: x.yieldOnCost != null ? fmt.pct(x.yieldOnCost, 1) : t("common.na") })}
          ${ctx.glossaryButton("yield_on_cost", t("div.yoc"))}</span>
        ${x.nextEx ? html`<span class="small">${t(x.nextEstimated ? "div.nextEst" : "div.next", { date: fmt.date(x.nextEx) })}</span>` : ""}
        ${x.growthPct != null ? html`<span class="small text-2">${t(Math.abs(x.growthPct) < 0.5 ? "div.same" : x.growthPct > 0 ? "div.grew" : "div.cut", { pct: fmt.pct(Math.abs(x.growthPct), 0) })}</span>` : ""}
        ${x.payoutHigh ? html`<span class="small" style="color:var(--color-warning)">${icon("warning")} ${t("div.payoutHigh", { pct: fmt.pct(x.payout * 100, 0) })}</span>` : ""}
      </li>`)}</ul></section>` : ""}
    <section class="card" aria-labelledby="rec-h">
      <h2 class="card__title" id="rec-h">${t("div.receivedTitle", { year })}</h2>
      ${got.dividends.length ? html`<p>${t(got.dividends.length === 1 ? "div.receivedLine1" : "div.receivedLine", { net: eur(got.divNet, 2), gross: eur(got.divGross, 2), n: got.dividends.length })}</p>
        <ul class="list small" style="margin-top:var(--space-2)">${got.dividends.slice().reverse().map((d) => html`<li class="cluster" style="justify-content:space-between"><span>${fmt.date(d.date)} · ${d.symbol}</span><span class="num">${eur(d.net, 2)}</span></li>`)}</ul>`
        : html`<p class="text-2">${t("div.receivedNone")}</p>`}
    </section>
    <p class="xs muted">${t("div.footer", { be: fmt.pct(COSTS.dividend_tax.belgium * 100, 0) })}</p>
  </div>`);
  $('[data-action="log-div"]', main).addEventListener("click", () => openTradeSheet(ctx, { kind: "dividend", symbol: f.perHolding[0]?.symbol || "" }));
  return { title, ...back };
}

/* =================================================================== Transactions */
const KIND_ICON = { buy: "plus", sell: "dash", start: "wallet", dividend: "bank" };

export function renderTransactions(ctx, main) {
  const title = t("txl.title");
  const g = gated(ctx, main, title);
  if (g) return g;
  let filter = "all";
  const draw = () => {
    const txs = [...(ctx.pf.transactions || [])].sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const shown = txs.filter((x) => filter === "all" || x.kind === filter);
    const groups = new Map();
    for (const x of shown) {
      const k = x.date.slice(0, 7);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    mount($("#tx-list", main), shown.length ? html`${[...groups].map(([month, list]) => html`<h2 class="section-title">${fmt.date(`${month}-15`, { month: "long", year: "numeric" })}</h2>
      <ul class="list">${list.map((x) => {
        const total = x.kind === "dividend" ? x.quantity * x.price - (x.taxes || 0) : x.quantity * x.price;
        return html`<li class="card tx" data-id="${x.id}">
          <span class="tx__kind">${icon(KIND_ICON[x.kind] || "dash")} ${t(`trade.${x.kind}`)}</span>
          <span class="tx__main"><a href="#/ticker/${encodeURIComponent(x.symbol)}"><b>${x.symbol}</b></a>
            <span class="small text-2 num">${fmt.num(x.quantity, Number.isInteger(Number(x.quantity)) ? 0 : 4)} × ${fmt.money(x.price, x.currency)}${x.kind === "dividend" ? ` ${t("txl.perShare")}` : ""}</span></span>
          <span class="tx__amount num">${fmt.money(total, x.currency)}</span>
          <span class="tx__meta small text-2">${fmt.date(x.date)}${(x.fees || x.taxes) && x.kind !== "dividend" ? ` · ${t("txl.costs", { c: fmt.money((Number(x.fees) || 0) + (Number(x.taxes) || 0), x.currency) })}` : ""}${x.kind === "dividend" && x.taxes ? ` · ${t("txl.withheld", { c: fmt.money(x.taxes, x.currency) })}` : ""}${x.source === "import" ? ` · ${t("txl.fromImport")}` : ""}</span>
          <button type="button" class="icon-btn" data-del="${x.id}" aria-label="${t("txl.delete", { what: `${t(`trade.${x.kind}`)} ${x.symbol} ${fmt.date(x.date)}` })}">${icon("trash")}</button>
        </li>`;
      })}</ul>`)}` : html`<p class="text-2">${t("txl.none")}</p>`);
    $$("[data-filter]", main).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
  };
  mount(main, html`<div class="stack" style="max-width:760px">
    <p class="summary">${t("txl.lead", { n: (ctx.pf.transactions || []).length })}</p>
    <button type="button" class="btn btn--primary btn--block" data-action="add-trade">${icon("plus")}${t("pf.addTrade")}</button>
    <div class="chips" role="group" aria-label="${t("txl.filterLabel")}">
      ${["all", "buy", "sell", "dividend", "start"].map((k) => html`<button type="button" class="chip chip--choice" data-filter="${k}" aria-pressed="${k === filter}">${t(`txl.filter.${k}`)}</button>`)}
    </div>
    <div id="tx-list"></div>
  </div>`);
  draw();
  $('[data-action="add-trade"]', main).addEventListener("click", () => openTradeSheet(ctx));
  main.addEventListener("click", async (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filter = f.dataset.filter; draw(); return; }
    const del = e.target.closest("[data-del]");
    if (!del) return;
    const row = (ctx.pf.transactions || []).find((x) => String(x.id) === del.dataset.del);
    if (!row) return;
    try {
      await ctx.api.deleteTransaction(row.id);
      ctx.pf.transactions = ctx.pf.transactions.filter((x) => x !== row);
      draw();
      const { id, ...copy } = row; // eslint-disable-line no-unused-vars
      toast(t("txl.deleted", { symbol: row.symbol }), { undo: async () => {
        const back = await ctx.api.addTransaction(copy);
        ctx.pf.transactions.push(back);
        draw();
      } });
    } catch (err) {
      toast(t("errors.saveFailed", { reason: err.message || "" }));
    }
  });
  return { title, ...back };
}

/* =================================================================== Tax overview */
export function renderTax(ctx, main) {
  const title = t("tax.title");
  const g = gated(ctx, main, title);
  if (g) return g;
  const rep = yearReport(ctx.pf.transactions || [], fx(ctx));
  if (!rep.years.length) {
    mount(main, emptyState({ title: t("tax.emptyTitle"), body: t("tax.emptyBody") }));
    return { title, ...back };
  }
  let year = rep.years[0];
  const firstStart = (ctx.pf.transactions || []).filter((x) => x.kind === "start").map((x) => x.date).sort()[0];
  const draw = () => {
    const y = rep.by[year];
    mount($("#tax-body", main), html`
      <div class="tiles">
        ${statTile({ label: t("tax.gains"), value: eur(y.gains, 2), glossaryKey: "realised_gain" })}
        ${statTile({ label: t("tax.losses"), value: eur(y.losses, 2) })}
        ${statTile({ label: t("tax.net"), value: eur(y.net, 2), word: !y.sales.length ? "" : y.net >= 0 ? t("tax.netGain") : t("tax.netLoss") })}
      </div>
      <div class="tiles">
        ${statTile({ label: t("tax.divGross"), value: eur(y.divGross, 2) })}
        ${statTile({ label: t("tax.withholding"), value: eur(y.divWithholding, 2), glossaryKey: "dividend_withholding" })}
        ${statTile({ label: t("tax.divNet"), value: eur(y.divNet, 2) })}
      </div>
      <div class="tiles">
        ${statTile({ label: t("tax.tob"), value: eur(y.tob, 2) })}
        ${statTile({ label: t("tax.fees"), value: eur(y.fees, 2) })}
      </div>
      <section class="card" aria-labelledby="sales-h">
        <h2 class="card__title" id="sales-h">${t("tax.salesTitle", { n: y.sales.length })}</h2>
        ${y.sales.length ? html`<div class="table-scroll" tabindex="0" role="region" aria-labelledby="sales-h"><table class="dtable">
          <thead><tr><th scope="col">${t("tax.colSale")}</th><th scope="col">${t("tax.colQty")}</th><th scope="col">${t("tax.colProceeds")}</th><th scope="col">${t("tax.colCost")}</th><th scope="col">${t("tax.colGain")}</th></tr></thead>
          <tbody>${y.sales.map((s) => html`<tr><th scope="row" style="font-weight:inherit;text-align:left"><b>${s.symbol}</b><span class="xs text-2" style="display:block">${fmt.date(s.date)} · ${s.fromStart ? t("tax.boughtBefore", { date: fmt.date(firstStart || s.acquired) }) : t("tax.bought", { date: fmt.date(s.acquired) })}</span></th>
            <td class="num">${fmt.num(s.qty, Number.isInteger(s.qty) ? 0 : 4)}</td><td class="num">${eur(s.proceeds, 2)}</td><td class="num">${eur(s.cost, 2)}</td>
            <td class="num" style="color:var(--color-${s.gain >= 0 ? "positive" : "negative"})">${s.gain >= 0 ? "+" : "−"}${eur(Math.abs(s.gain), 2)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="text-2">${t("tax.noSales")}</p>`}
      </section>
      ${y.approx ? banner({ tone: "info", title: t("tax.approxTitle"), body: t("tax.approxBody") }) : ""}`);
    $$("[data-year]", main).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.year) === year)));
  };
  mount(main, html`<div class="stack" style="max-width:760px">
    <p class="summary">${t("tax.lead")}</p>
    <div class="chips" role="group" aria-label="${t("tax.yearLabel")}">${rep.years.map((yy) => html`<button type="button" class="chip chip--choice" data-year="${yy}" aria-pressed="${yy === year}">${yy}</button>`)}</div>
    <div id="tax-body" class="stack"></div>
    <div class="cluster" style="gap:var(--space-2)">
      <button type="button" class="btn btn--primary" data-action="csv" style="flex:1">${t("tax.csv")}</button>
      <button type="button" class="btn btn--secondary" data-action="print" style="flex:1">${t("tax.print")}</button>
    </div>
    ${banner({ tone: "info", title: t("tax.disclaimerTitle"), body: t("tax.disclaimer", { method: t(`tax.method.${COSTS.capital_gains.method}`) }) })}
  </div>`);
  draw();
  main.addEventListener("click", (e) => {
    const yb = e.target.closest("[data-year]");
    if (yb) { year = Number(yb.dataset.year); draw(); return; }
    const a = e.target.closest("[data-action]")?.dataset.action;
    if (a === "print") window.print();
    if (a === "csv") {
      const y = rep.by[year];
      const rows = [
        [t("tax.csvKind"), t("tax.colDate"), t("tax.colTicker"), t("tax.colQty"), t("tax.colProceeds"), t("tax.colCost"), t("tax.colGain"), t("tax.colAcquired")],
        ...y.sales.map((s) => [t("trade.sell"), s.date, s.symbol, s.qty, s.proceeds, s.cost, s.gain, s.fromStart ? `< ${firstStart || s.acquired}` : s.acquired]),
        ...y.dividends.map((d) => [t("trade.dividend"), d.date, d.symbol, null, d.gross, d.withholding, d.net, null]),
        [],
        [t("tax.gains"), null, null, null, null, null, y.gains], [t("tax.losses"), null, null, null, null, null, y.losses],
        [t("tax.tob"), null, null, null, null, null, y.tob], [t("tax.fees"), null, null, null, null, null, y.fees],
      ];
      const blob = new Blob(["﻿" + toCsv(rows, { decimalComma: fmt.getNumberLocale() !== "en-GB" })], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: `tax-overview-${year}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  return { title, ...back };
}

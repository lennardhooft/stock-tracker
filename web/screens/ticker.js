/* Ticker detail — docs/screens/ticker.md
 * Answers "Why does this stock have this score?" at the top, details in tabs. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { resolvedTheme } from "../lib/settings.js";
import { explainScore } from "../lib/signals.js";
import { icon } from "../components/icons.js";
import { scoreBadge, changeTag } from "../components/badges.js";
import { statTile, rangeBar } from "../components/cards.js";
import { banner, emptyState } from "../components/states.js";
import { toast } from "../components/overlays.js";
import { priceChart, tradingView } from "../components/chart.js";
import { signalList, statusBanners } from "./common.js";
import { openBuyLevelSheet, removeStock, openAddSheet } from "./watchlist.js";

let activeTab = "overview";
let lastSymbol = "";

export function renderTicker(ctx, el, symbol, { embedded = false } = {}) {
  const row = ctx.rows.find((r) => r.symbol === symbol);
  if (symbol !== lastSymbol) { activeTab = "overview"; lastSymbol = symbol; }

  if (!row) {
    mount(el, emptyState({ title: t("ticker.notOnListTitle", { symbol }), body: t("ticker.notOnListBody"), action: t("ticker.addIt"), actionId: "add-this" }));
    $('[data-action="add-this"]', el)?.addEventListener("click", () => openAddSheet(ctx, symbol));
    return { title: symbol, back: "#/watchlist" };
  }

  const scored = row.score != null && !row.error;
  const eu = row.market === "EU";
  const header = html`
    <div class="page-head" style="margin-bottom:var(--space-3)">
      <div class="page-head__titles">
        <h2 style="font-size:var(--text-lg);font-weight:var(--weight-semibold)">${row.name || row.symbol}</h2>
        <p class="small muted">${row.symbol} · ${row.market}</p>
      </div>
      ${scored ? html`<div class="page-head__aside">
        <div class="num" style="font-size:var(--text-xl);font-weight:var(--weight-semibold)">${fmt.money(row.price, row.currency)}</div>
        <div>${changeTag(row.change_pct, 1)}</div>
        <div class="xs muted">${eu ? t("time.delayed") : t("ticker.asOf", { date: fmt.date(row.as_of) })}</div>
      </div>` : ""}
    </div>`;

  let lead;
  if (row.error) {
    lead = html`${banner({ tone: "negative", title: t("ticker.noScoreTitle"), body: t("ticker.noScoreBody", { symbol: row.symbol }) })}`;
  } else if (!scored) {
    lead = html`${banner({ tone: "info", title: t("ticker.pendingTitle"), body: t("ticker.pendingBody") })}`;
  } else {
    lead = html`<div class="card stack" style="gap:var(--space-2)">
      <div class="cluster" style="justify-content:space-between"><span class="cluster"><span class="small text-2">${t("score.bottom")}</span>${scoreBadge(row)}</span>${ctx.glossaryButton("bottom_score", t("score.bottom"))}</div>
      <p>${explainScore(row)}</p>
      ${row.suspect ? html`<p class="small" style="color:var(--color-warning)">⚠️ ${t("score.suspect")}</p>` : ""}
    </div>`;
  }

  const tabs = scored ? ["overview", "chart", "notes"] : ["notes"];
  if (!tabs.includes(activeTab)) activeTab = tabs[0];

  mount(el, html`
    ${embedded ? "" : statusBanners(ctx, { suspect: false })}
    ${header}
    ${lead}
    <button type="button" class="btn btn--primary btn--block" style="margin-top:var(--space-3)" data-t="buy">${icon("bell")}${row.buy_below ? t("ticker.buyIsSet", { level: fmt.money(row.buy_below, row.currency) }) : t("ticker.setBuyAlert")}</button>
    <div class="tabs" role="tablist" aria-label="${row.symbol}">
      ${tabs.map((k) => html`<button type="button" role="tab" id="tab-${k}" aria-controls="panel" aria-selected="${activeTab === k}" data-tab="${k}">${t(`ticker.tab.${k}`)}</button>`)}
    </div>
    <div id="panel" role="tabpanel" aria-labelledby="tab-${activeTab}"></div>`);

  const panel = $("#panel", el);
  const show = (k) => {
    activeTab = k;
    $$("[data-tab]", el).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    panel.setAttribute("aria-labelledby", `tab-${k}`);
    ({ overview: overviewTab, chart: chartTab, notes: notesTab })[k](ctx, panel, row);
  };
  el.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-tab]");
    if (tb) show(tb.dataset.tab);
    if (e.target.closest('[data-t="buy"]')) openBuyLevelSheet(ctx, row);
  });
  show(activeTab);
  return { title: row.symbol, back: "#/watchlist" };
}

function overviewTab(ctx, panel, row) {
  const t1 = (row.signals || []).find((s) => s.code === "T1");
  const vsMa = t1?.value?.pct_vs_sma;
  const issues = (row.checks?.issues || []).filter((i) => i.level !== "info");
  mount(panel, html`
    <section class="card" style="margin-bottom:var(--space-4)">
      <h3 class="card__title">${t("ticker.signalsTitle")}</h3>
      ${signalList(ctx, row)}
    </section>
    <div class="tiles" style="margin-bottom:var(--space-4)">
      ${statTile({ label: t("ticker.vsMa"), value: vsMa != null ? `${vsMa >= 0 ? "+" : "−"}${fmt.pct(Math.abs(vsMa))}` : t("common.na"),
        context: vsMa != null ? t(vsMa >= 0 ? "ticker.vsMaAbove" : "ticker.vsMaBelow") : t("sig.T1.na"), glossaryKey: ctx.glossaryButton("near_200w_ma") ? "near_200w_ma" : "" })}
      ${statTile({ label: t("ticker.fromHigh"), value: fmt.pct(row.pct_from_52w_high), context: t("ticker.highWas", { high: fmt.money(row.high_52w, row.currency) }), glossaryKey: ctx.glossaryButton("pct_from_52w_high") ? "pct_from_52w_high" : "" })}
    </div>
    <div class="card" style="margin-bottom:var(--space-4);position:relative">
      <span style="position:absolute;top:var(--space-3);right:var(--space-3)">${ctx.glossaryButton("range_52w", t("ticker.range52"))}</span>
      ${rangeBar({ min: row.low_52w, max: row.high_52w, value: row.price, format: (v) => fmt.money(v, row.currency), caption: t("ticker.range52") })}
    </div>
    ${issues.length ? banner({ tone: "warning", title: t("ticker.dataCheck"), body: issues.map((i) => t(`checks.${i.code}`)).join(" ") }) : ""}
  `);
}

let chartHandle = null;
async function chartTab(ctx, panel, row) {
  chartHandle?.destroy();
  chartHandle = null;
  let mode = "weekly";
  let years = 5;
  mount(panel, html`
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="${t("chart.source")}">
        <button type="button" data-mode="weekly" aria-pressed="true">${t("chart.weekly")}</button>
        <button type="button" data-mode="live" aria-pressed="false">${t("chart.live")}</button>
      </div>
      <div class="segmented" role="group" aria-label="${t("chart.range")}" id="ranges">
        ${[[1, "1Y"], [3, "3Y"], [5, "5Y"], [10, "10Y"]].map(([y, l]) => html`<button type="button" data-years="${y}" aria-pressed="${y === years}">${l}</button>`)}
      </div>
    </div>
    <div class="chart-box" id="chart"><div class="skeleton" style="height:100%"></div></div>
    <div class="chart-legend" id="legend"><span><i style="background:var(--chart-1)"></i>${t("chart.price")}</span><span><i style="background:var(--chart-2)"></i>${t("chart.ma200")}</span></div>
    <p class="small text-2" id="chart-summary" style="margin-top:var(--space-2)"></p>`);

  const box = $("#chart", panel);
  const summary = $("#chart-summary", panel);
  const drawWeekly = async () => {
    box.innerHTML = '<div class="skeleton" style="height:100%"></div>';
    try {
      const d = await ctx.api.detail(row.symbol);
      if (!d?.weekly?.c?.length) throw new Error("no data");
      box.innerHTML = "";
      chartHandle = await priceChart(box, d.weekly);
      chartHandle.setRange(years);
      summary.textContent = chartSummary(d.weekly, row.currency);
    } catch {
      mount(box, html`<div class="state" style="height:100%;border:0">${icon("error", { cls: "state__icon" })}<p class="state__body">${t("chart.failed")}</p></div>`);
    }
  };
  panel.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    const y = e.target.closest("[data-years]");
    if (m && m.dataset.mode !== mode) {
      mode = m.dataset.mode;
      $$("[data-mode]", panel).forEach((b) => b.setAttribute("aria-pressed", String(b === m)));
      $("#ranges", panel).hidden = mode === "live";
      $("#legend", panel).hidden = mode === "live";
      summary.hidden = mode === "live";
      chartHandle?.destroy();
      chartHandle = null;
      if (mode === "live") tradingView(box, row.symbol, resolvedTheme());
      else drawWeekly();
    }
    if (y) {
      years = Number(y.dataset.years);
      $$("[data-years]", panel).forEach((b) => b.setAttribute("aria-pressed", String(b === y)));
      chartHandle?.setRange(years);
    }
  });
  drawWeekly();
}

/** Text alternative for the chart (8.7). */
function chartSummary(w, currency) {
  const n = w.c.length;
  const last = w.c[n - 1];
  const ma = w.sma200[n - 1];
  const ago = w.sma200[n - 5] != null ? (w.c[n - 5] / w.sma200[n - 5] - 1) * 100 : null;
  if (ma == null) return t("chart.summaryNoMa", { price: fmt.money(last, currency) });
  const now = (last / ma - 1) * 100;
  return t("chart.summary", {
    pct: fmt.pct(Math.abs(now)), dir: t(now >= 0 ? "chart.above" : "chart.below"),
    before: ago != null ? fmt.pct(ago) : t("common.na"),
  });
}

function notesTab(ctx, panel, row) {
  mount(panel, html`<form class="stack" novalidate>
    <label class="field"><span class="field__label">${t("ticker.notes")}</span>
      <textarea class="input" name="notes" rows="5" maxlength="2000" style="min-height:120px">${row.notes || ""}</textarea>
      <span class="field__hint">${t("ticker.notesHint")}</span></label>
    <button class="btn btn--primary" type="submit">${t("common.save")}</button>
    <hr style="border:0;border-top:1px solid var(--color-border);margin:var(--space-4) 0">
    <button class="btn btn--destructive" type="button" data-remove>${icon("trash")}${t("watchlist.remove")}</button>
  </form>`);
  const form = $("form", panel);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.setAttribute("aria-busy", "true");
    try {
      const notes = form.notes.value.trim() || null;
      await ctx.api.update(row.wid, { notes });
      Object.assign(ctx.data.watchlist.find((w) => w.id === row.wid), { notes });
      row.notes = notes;
      toast(t("toast.saved"));
    } catch (err) {
      toast(t("errors.saveFailed", { reason: err.message }));
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
  $("[data-remove]", panel).addEventListener("click", () => removeStock(ctx, row));
}

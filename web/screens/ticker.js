/* Ticker detail — docs/screens/ticker.md
 * Answers "Why does this stock have this score?" at the top, details in tabs. */
import { html, raw, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { resolvedTheme, prefsGet, prefsSet } from "../lib/settings.js";
import { explainScore, describeZone, verdictSentence, describeTop, topSummary, TOP_GLOSSARY,
  QUALITY_GLOSSARY, partState, describeQualityPart } from "../lib/signals.js";
import { icon } from "../components/icons.js";
import { scoreBadge, changeTag, topBadge, verdictBadge } from "../components/badges.js";
import { statTile, rangeBar, signalRow, qualityRow } from "../components/cards.js";
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
    </div>
    ${scored && row.change_pct <= -5 ? html`<p class="small text-2" id="why-down" style="margin:calc(-1 * var(--space-2)) 0 var(--space-3)" aria-live="polite"></p>` : ""}`;

  let lead;
  if (row.error) {
    lead = html`${banner({ tone: "negative", title: t("ticker.noScoreTitle"), body: t("ticker.noScoreBody", { symbol: row.symbol }) })}`;
  } else if (!scored) {
    lead = html`${banner({ tone: "info", title: t("ticker.pendingTitle"), body: t("ticker.pendingBody") })}`;
  } else {
    const vs = verdictSentence(row);
    const showVerdict = ["sale", "check", "trap"].includes(row.verdict);
    lead = html`<div class="card stack" style="gap:var(--space-2)">
      <div class="cluster" style="justify-content:space-between"><span class="cluster"><span class="small text-2">${t("score.bottom")}</span>${scoreBadge(row)}</span>${ctx.glossaryButton("bottom_score", t("score.bottom"))}</div>
      ${showVerdict || row.top?.score >= 2 ? html`<div class="cluster" id="verdict-line">${showVerdict ? verdictBadge(row.verdict) : ""}${row.top?.score >= 2 ? topBadge(row.top) : ""}</div>` : ""}
      ${vs ? html`<p>${vs}</p><p class="small text-2">${explainScore(row)}</p>` : html`<p>${explainScore(row)}</p>`}
      ${row.suspect ? html`<p class="small" style="color:var(--color-warning)">⚠️ ${t("score.suspect")}</p>` : ""}
    </div>`;
  }

  const tabs = scored ? ["overview", "chart", "fundamentals", "news", "notes"] : ["news", "notes"];
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

  const show = (k) => {
    activeTab = k;
    $$("[data-tab]", el).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === k)));
    chartHandle?.destroy();
    chartHandle = null;
    // a fresh panel per tab, so tab listeners never pile up
    const old = $("#panel", el);
    const panel = old.cloneNode(false);
    panel.setAttribute("aria-labelledby", `tab-${k}`);
    old.replaceWith(panel);
    ({ overview: overviewTab, chart: chartTab, fundamentals: fundamentalsTab, news: newsTab, notes: notesTab })[k](ctx, panel, row);
  };
  el.addEventListener("click", (e) => {
    const tb = e.target.closest("[data-tab]");
    if (tb) show(tb.dataset.tab);
    if (e.target.closest('[data-t="buy"]')) openBuyLevelSheet(ctx, row);
  });
  show(activeTab);

  // "why is it down?" (13.1): the latest headline from the last 48 hours under a big drop
  const why = $("#why-down", el);
  if (why) {
    ctx.api.detail(row.symbol).then((d) => {
      const cut = Date.now() - 48 * 3600e3;
      const n = (d?.fundamentals?.news || []).find((x) => new Date(x.time).getTime() >= cut);
      if (n && why.isConnected) {
        mount(why, html`<b>${t("ticker.whyDown")}</b> <a href="${n.url}" target="_blank" rel="noopener noreferrer">${n.headline}</a> <span class="muted">· ${n.source}</span>`);
      } else why.remove();
    }).catch(() => why.remove());
  }
  return { title: row.symbol, back: "#/watchlist" };
}

/* ------------------------------------------------------------------ Fundamentals (2C) */
function fundamentalsTab(ctx, panel, row) {
  mount(panel, html`<div class="stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div>`);
  ctx.api.detail(row.symbol).then((d) => {
    if (!panel.isConnected) return;
    const f = d?.fundamentals || {};
    const v = f.valuation;
    const ins = f.insiders;
    const metric = v?.metric === "ps" ? "P/S" : "P/E";
    const valuation = v ? html`
      <div class="tiles" style="margin-bottom:var(--space-3)">
        ${statTile({ label: metric, value: fmt.num(v.now, 1),
          word: t(v.pct <= 20 ? "fund.cheap" : v.pct >= 80 ? "fund.expensive" : "fund.fair"),
          wordTone: v.pct <= 20 ? "positive" : v.pct >= 80 ? "warning" : "text-2",
          context: t("fund.cheaperThan", { pct: fmt.pct(100 - v.pct, 0), years: fmt.num(v.years, 0) }),
          glossaryKey: ctx.glossaryButton("valuation_pct") ? "valuation_pct" : "" })}
      </div>
      ${rangeBar({ min: v.min, max: v.max, value: v.now, format: (x) => fmt.num(x, 1), caption: t("fund.rangeCaption", { metric, years: fmt.num(v.years, 0) }) })}
      ${v.metric === "ps" ? html`<p class="small text-2" style="margin-top:var(--space-2)">${t("fund.psNote")}</p>` : ""}
      ${v.years < 5 ? html`<p class="small text-2" style="margin-top:var(--space-2)">${t("fund.shortHistory", { years: fmt.num(v.years, 1) })}</p>` : ""}`
      : html`<p class="text-2">${t("fund.noValuation")}</p>`;

    const money = (x) => fmt.money(x, "USD", { compact: true });
    const insiders = ins ? html`
      <p style="margin-bottom:var(--space-3)">${t(ins.net_value > 0 ? "fund.insBought" : ins.net_value < 0 ? "fund.insSold" : "fund.insNone",
        { value: money(Math.abs(ins.net_value)), days: ins.days, buys: ins.buys, sells: ins.sells })}</p>
      ${ins.recent?.length ? html`<ul class="signals">${ins.recent.map((r) => html`<li class="signal" data-state="${r.kind === "buy" ? "passed" : "na"}">
        <span class="signal__icon" style="color:var(--color-${r.kind === "buy" ? "positive" : "negative"})">${icon(r.kind === "buy" ? "plus" : "dash", { label: t(`fund.${r.kind}`) })}</span>
        <span class="signal__name">${t(`fund.${r.kind}`)} · ${r.name}</span>
        <span class="signal__detail num">${fmt.date(`${r.date}T12:00:00Z`)} · ${fmt.num(r.shares, 0)} × ${fmt.money(r.price, "USD")} = ${money(r.value)}</span></li>`)}</ul>`
        : html`<p class="small text-2">${t("fund.insNoList")}</p>`}`
      : html`<p class="text-2">${t(f.insiders_na === "eu" ? "sig.V2.naEu" : "sig.V2.na")}</p>`;

    mount(panel, html`
      ${qualityCard(ctx, f.quality, row)}
      <section class="card" style="margin-bottom:var(--space-4)">
        <h3 class="card__title">${t("fund.valuationTitle")}</h3>${valuation}
      </section>
      <section class="card" style="margin-bottom:var(--space-4)">
        <div class="cluster" style="justify-content:space-between;margin-bottom:var(--space-2)"><h3 class="card__title" style="margin:0">${t("fund.insidersTitle")}</h3>${ctx.glossaryButton("insider_buying", t("fund.insidersTitle"))}</div>
        ${insiders}
      </section>
      <p class="xs muted">${t("fund.source", { source: f.source || t("common.na"), date: fmt.date(`${f.as_of || row.as_of}T12:00:00Z`) })}</p>`);
  }).catch(() => {
    if (panel.isConnected) mount(panel, banner({ tone: "negative", title: t("levels.failed"), body: "" }));
  });
}

/* ------------------------------------------------------------------ Quality (2E, 13.1 / 13.16 A) */
const gk = (ctx, key) => (ctx.glossaryButton(key) ? key : "");

function qualityCard(ctx, q, row) {
  const head = html`<div class="cluster" style="justify-content:space-between;margin-bottom:var(--space-2)"><h3 class="card__title" style="margin:0">${t("quality.title")}</h3>${ctx.glossaryButton("quality_score", t("quality.title"))}</div>`;
  if (!q || q.score == null) {
    const reason = q?.na || (row.quality?.na) || "pending";
    return html`<section class="card" style="margin-bottom:var(--space-4)" id="quality-card">${head}<p class="text-2">${t(`quality.na.${reason}`) || t("quality.na.too_few_parts")}</p></section>`;
  }
  const tone = { high: "positive", medium: "warning", low: "negative" }[q.label];
  const roic = (q.parts || []).find((p) => p.key === "roic");
  const roe = roic?.value?.metric === "roe";
  const moatTile = roe || !q.moat ? "" : statTile({
    label: t("quality.moatTitle"), value: t(`quality.moat.${q.moat}`),
    context: describeQualityPart(roic).detail, glossaryKey: gk(ctx, "moat"),
  });
  const rows = (q.roic_years || []).filter((y) => (roe ? y.roe : y.roic) != null || y.gross_margin != null);
  const pc = (x) => (x == null ? t("common.na") : fmt.pct(x * 100, 1));
  return html`<section class="card" style="margin-bottom:var(--space-4)" id="quality-card">
    ${head}
    <div class="tiles" style="margin-bottom:var(--space-3)">
      ${statTile({ label: t("quality.score"), value: t("quality.outOf", { score: q.score }), word: t(`quality.label.${q.label}`), wordTone: tone,
        context: t("quality.basedOn", { years: q.years, n: q.n_parts }) })}
      ${moatTile}
    </div>
    ${q.financial ? html`<p class="small text-2" style="margin-bottom:var(--space-2)">${t("quality.financialNote")}</p>` : ""}
    <ul class="signals">${(q.parts || []).map((p) => {
      const d = describeQualityPart(p);
      return qualityRow({ ...d, state: partState(p), tag: p.weight > 1 ? t("quality.heavier") : "", glossaryKey: gk(ctx, QUALITY_GLOSSARY[p.key]) });
    })}</ul>
    ${rows.length >= 2 ? html`<h4 class="small text-2" style="margin:var(--space-4) 0 var(--space-1)">${t("quality.yearsTitle")}</h4>
      <table class="dtable"><thead><tr><th scope="col">${t("quality.colYear")}</th><th scope="col">${t(roe ? "quality.colRoe" : "quality.colRoic")}</th><th scope="col">${t("quality.colGm")}</th></tr></thead>
      <tbody>${rows.map((y) => html`<tr><td>${String(y.year).slice(0, 4)}</td><td>${pc(roe ? y.roe : y.roic)}</td><td>${pc(y.gross_margin)}</td></tr>`)}</tbody></table>` : ""}
  </section>`;
}

/* ------------------------------------------------------------------ Top Score (2E, 13.14 A) */
function topCard(ctx, row) {
  const top = row.top;
  if (!top?.signals?.length) return "";
  return html`<section class="card" style="margin-bottom:var(--space-4)" id="top-card">
    <div class="cluster" style="justify-content:space-between;margin-bottom:var(--space-2)">
      <h3 class="card__title" style="margin:0">${t("top.title")}</h3>${ctx.glossaryButton("top_score", t("score.top"))}</div>
    <p style="margin-bottom:var(--space-1)">${topSummary(top)}</p>
    ${top.score >= 2 ? html`<p class="small text-2">${t("top.note")}</p>` : ""}
    <ul class="signals">${top.signals.map((s) => {
      const d = describeTop(s, row.currency);
      return signalRow({ ...s, name: d.name, detail: d.detail }, { glossaryKey: gk(ctx, TOP_GLOSSARY[s.code]) });
    })}</ul>
  </section>`;
}

/* ------------------------------------------------------------------ News & events (2C) */
function newsTab(ctx, panel, row) {
  mount(panel, html`<div class="stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div>`);
  ctx.api.detail(row.symbol).then((d) => {
    if (!panel.isConnected) return;
    const f = d?.fundamentals || {};
    const e = f.earnings || row.next_earnings;
    let earnings;
    if (e?.date) {
      const days = Math.round((new Date(`${e.date}T12:00:00Z`) - new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z")) / 864e5);
      const when = days === 0 ? t("news.today") : days === 1 ? t("news.tomorrow") : t("news.inDays", { n: days });
      const hour = e.hour === "bmo" ? t("news.bmo") : e.hour === "amc" ? t("news.amc") : "";
      earnings = html`<p class="tile__value" style="font-size:var(--text-lg)">${when}</p>
        <p>${fmt.date(`${e.date}T12:00:00Z`)}${hour ? ` · ${hour}` : ""}</p>
        ${e.eps_est != null ? html`<p class="small text-2 num">${t("news.epsEst", { eps: fmt.num(e.eps_est, 2) })}</p>` : ""}
        <p class="xs muted">${t("news.estimated", { source: e.source || "" })}</p>`;
    } else {
      earnings = html`<p class="text-2">${t("news.noEarnings")}</p>`;
    }
    const news = f.news || [];
    mount(panel, html`
      <section class="card" style="margin-bottom:var(--space-4)">
        <h3 class="card__title">${t("news.earningsTitle")}</h3>${earnings}
      </section>
      <h3 class="section-title" style="margin-top:0">${t("news.headlines")}</h3>
      ${news.length ? html`<ul class="menu">${news.map((n) => html`<li><a class="menu__item" href="${n.url}" target="_blank" rel="noopener noreferrer" style="align-items:flex-start;padding-top:var(--space-3);padding-bottom:var(--space-3)">
          <span class="menu__label"><span style="display:block">${n.headline}</span><span class="menu__hint">${n.source} · ${fmt.relativeTime(n.time)}</span></span>
          <span class="visually-hidden">${t("news.opensNewTab")}</span></a></li>`)}</ul>`
        : html`<div class="state"><p class="state__body">${t("news.none")}</p></div>`}`);
  }).catch(() => {
    if (panel.isConnected) mount(panel, banner({ tone: "negative", title: t("levels.failed"), body: "" }));
  });
}

/* ------------------------------------------------------------------ Overview */
function overviewTab(ctx, panel, row) {
  const t1 = (row.signals || []).find((s) => s.code === "T1");
  const vsMa = t1?.value?.pct_vs_sma;
  const issues = (row.checks?.issues || []).filter((i) => i.level !== "info" && t(`checks.${i.code}`));
  mount(panel, html`
    <section class="card" style="margin-bottom:var(--space-4)">
      <h3 class="card__title">${t("ticker.signalsTitle")}</h3>
      ${signalList(ctx, row)}
    </section>
    ${topCard(ctx, row)}
    <section class="card" style="margin-bottom:var(--space-4)" id="levels-card" aria-busy="true">
      <div class="cluster" style="justify-content:space-between;margin-bottom:var(--space-2)"><h3 class="card__title" style="margin:0">${t("levels.title")}</h3>${ctx.glossaryButton("support_resistance", t("levels.title"))}</div>
      <div id="levels-body"><span class="skeleton skeleton--text" style="width:70%"></span><br><span class="skeleton skeleton--text" style="width:50%"></span></div>
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

  // nearest levels need the detail data: load it after the rest is on screen
  ctx.api.detail(row.symbol).then((d) => {
    const body = $("#levels-body", panel);
    if (!body) return;
    $("#levels-card", panel).removeAttribute("aria-busy");
    const zones = d?.weekly?.levels?.zones || [];
    const picks = [nearest(zones, "support"), nearest(zones, "resistance")].filter(Boolean);
    if (!picks.length) { mount(body, html`<p class="text-2">${t("levels.none")}</p>`); return; }
    mount(body, html`<ul class="signals">${picks.map((z) => {
      const dz = describeZone(z, row.currency);
      const sup = z.role === "support";
      return html`<li class="signal" data-state="${sup ? "passed" : "na"}">
        <span class="signal__icon" style="color:var(--color-${sup ? "positive" : "negative"})">${icon(sup ? "trendDown" : "warning", { label: t(`levels.${z.role}`) })}</span>
        <span class="signal__name">${dz.title}</span>
        <span class="signal__detail">${dz.detail}</span></li>`;
    })}</ul>`);
  }).catch(() => {
    const body = $("#levels-body", panel);
    if (!body) return;
    $("#levels-card", panel).removeAttribute("aria-busy");
    mount(body, html`<p class="text-2">${t("levels.failed")}</p>`);
  });
}

/** Nearest zone of a role, preferring long-term (Y/M) levels like the T4 signal does. */
function nearest(zones, role) {
  const side = zones.filter((z) => z.role === role);
  const longTerm = side.filter((z) => z.tfs.includes("Y") || z.tfs.includes("M"));
  const pool = longTerm.length ? longTerm : side;
  return [...pool].sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0] || null;
}

/* ------------------------------------------------------------------ Chart */
let chartHandle = null;

const SWATCH = {
  zones: '<i aria-hidden="true" style="display:inline-block;width:14px;height:10px;border-radius:2px;background:color-mix(in srgb,var(--color-positive) 35%,transparent);border-top:2px solid var(--color-positive)"></i>',
  ma: '<i aria-hidden="true" style="display:inline-block;width:14px;height:0;border-top:2px dashed var(--chart-2)"></i>',
  markers: '<span aria-hidden="true" style="color:var(--color-positive)">▲</span>',
};

function chartTab(ctx, panel, row) {
  let mode = "weekly";
  let years = 5;
  const show = { ...prefsGet().chartShow };
  const toggle = (key, label) => html`<button type="button" class="chip chip--choice" data-show="${key}" aria-pressed="${show[key]}">${raw(SWATCH[key])}${label}</button>`;
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
    <div id="score-panel-wrap">
      <p class="xs muted" style="margin:var(--space-2) 0 2px">${t("chart.scoreHistory")}</p>
      <div class="chart-box" id="score-panel" style="height:84px"></div>
      <p class="xs muted" style="margin-top:2px">${t("chart.scoreHistoryNote")}</p>
    </div>
    <div class="chips" id="legend" role="group" aria-label="${t("chart.legend")}" style="margin-top:var(--space-3)">
      ${toggle("zones", t("chart.zones"))}${toggle("ma", t("chart.ma200short"))}${toggle("markers", t("chart.markers"))}
    </div>
    <p class="small text-2" id="chart-summary" style="margin-top:var(--space-3)"></p>`);

  const box = $("#chart", panel);
  const summary = $("#chart-summary", panel);
  const wrap = $("#score-panel-wrap", panel);
  const drawWeekly = async () => {
    box.innerHTML = '<div class="skeleton" style="height:100%"></div>';
    $("#score-panel", panel).innerHTML = "";
    try {
      const d = await ctx.api.detail(row.symbol);
      if (!d?.weekly?.c?.length) throw new Error("no data");
      if (!panel.isConnected) return; // user switched tab meanwhile
      box.innerHTML = "";
      wrap.hidden = !d.weekly.score?.some((v) => v != null);
      chartHandle = await priceChart(box, d.weekly, { show, scoreEl: wrap.hidden ? null : $("#score-panel", panel) });
      chartHandle.setRange(years);
      summary.textContent = chartSummary(d.weekly, row.currency, nearest(d.weekly.levels?.zones || [], "support"));
      panel.dataset.chart = "ready";
    } catch {
      wrap.hidden = true;
      mount(box, html`<div class="state" style="height:100%;border:0">${icon("error", { cls: "state__icon" })}<p class="state__body">${t("chart.failed")}</p>
        <button type="button" class="btn btn--secondary" data-retry-chart>${icon("refresh")}${t("common.retry")}</button></div>`);
      panel.dataset.chart = "failed";
    }
  };
  panel.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]");
    const y = e.target.closest("[data-years]");
    const sh = e.target.closest("[data-show]");
    if (e.target.closest("[data-retry-chart]")) drawWeekly();
    if (m && m.dataset.mode !== mode) {
      mode = m.dataset.mode;
      $$("[data-mode]", panel).forEach((b) => b.setAttribute("aria-pressed", String(b === m)));
      for (const id of ["#ranges", "#legend"]) $(id, panel).hidden = mode === "live";
      wrap.hidden = mode === "live";
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
    if (sh) {
      show[sh.dataset.show] = !show[sh.dataset.show];
      sh.setAttribute("aria-pressed", String(show[sh.dataset.show]));
      prefsSet({ chartShow: { ...show } });
      chartHandle?.setShow(show);
    }
  });
  drawWeekly();
}

/** Text alternative for the chart (8.7). */
function chartSummary(w, currency, support) {
  const n = w.c.length;
  const last = w.c[n - 1];
  const ma = w.sma200[n - 1];
  const ago = w.sma200[n - 5] != null ? (w.c[n - 5] / w.sma200[n - 5] - 1) * 100 : null;
  let text = ma == null
    ? t("chart.summaryNoMa", { price: fmt.money(last, currency) })
    : t("chart.summary", {
      pct: fmt.pct(Math.abs((last / ma - 1) * 100)), dir: t(last >= ma ? "chart.above" : "chart.below"),
      before: ago != null ? fmt.pct(ago) : t("common.na"),
    });
  if (support) text += ` ${describeZone(support, currency).title}.`;
  return text;
}

/* ------------------------------------------------------------------ My notes */
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

/* Calendar — docs/screens/calendar.md
 * Answers "What's coming up for my stocks and the market?"; primary action: subscribe in the phone calendar. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { prefsGet, prefsSet } from "../lib/settings.js";
import { buildEvents, groupByWeek, daysUntil, todayIso, KIND_GROUP } from "../lib/calendar.js";
import { icon } from "../components/icons.js";
import { emptyState } from "../components/states.js";
import { openSheet, toast } from "../components/overlays.js";
import { statusBanners } from "./common.js";
import { openAddSheet } from "./watchlist.js";

const ICON = { earnings: "calendar", exdiv: "wallet", paydiv: "wallet", fomc: "bank", ecb: "bank" };
const CITY = { "America/New_York": "cal.cityNY", "Europe/Berlin": "cal.cityFrankfurt" };

const day = (d) => fmt.date(`${d}T12:00:00Z`, { weekday: "short", day: "numeric", month: "short" });

/** {title, when, tag} in words for one event. */
export function describeEvent(e) {
  const title = t(`cal.${e.kind}`, { symbol: e.symbol || "" });
  const parts = [day(e.date)];
  if (e.kind === "earnings" && e.hour) parts.push(t(`cal.${e.hour}`));
  if ((e.kind === "exdiv" || e.kind === "paydiv") && e.amount != null) parts.push(t("cal.perShare", { amount: fmt.money(e.amount, e.currency) }));
  if (e.time && CITY[e.tz]) parts.push(`${e.time} ${t(CITY[e.tz])}`);
  const tag = e.estimated ? t("cal.estimated") : e.tentative ? t("cal.tentative") : "";
  return { title, when: parts.join(" · "), tag };
}

export function eventRow(e) {
  const d = describeEvent(e);
  const inner = html`${icon(ICON[e.kind])}<span class="menu__label"><span style="display:block">${d.title}</span>
    <span class="menu__hint num">${d.when}${d.tag ? html` · <span class="tag-word">${d.tag}</span>` : ""}</span></span>`;
  return e.symbol
    ? html`<li><a class="menu__item" href="#/ticker/${encodeURIComponent(e.symbol)}">${inner}${icon("chevron")}</a></li>`
    : html`<li><div class="menu__item menu__item--static">${inner}</div></li>`;
}

function lead(events) {
  if (!events.length) return t("cal.leadEmpty");
  const soon = events.filter((e) => daysUntil(e.date) <= 7);
  const next = describeEvent(events[0]);
  const nextTxt = `${next.title} ${day(events[0].date)}`;
  return soon.length ? t(soon.length === 1 ? "cal.leadOne" : "cal.leadMany", { n: soon.length, next: nextTxt }) : t("cal.leadNone7", { next: nextTxt });
}

export function renderCalendar(ctx, main) {
  const all = buildEvents(ctx.rows, ctx.macro);
  const filter = prefsGet().calFilter || "all";
  const shown = filter === "all" ? all : all.filter((e) => KIND_GROUP[e.kind] === filter);
  const groups = groupByWeek(shown);
  const weekTitle = (g) => (g.rel === "this" ? t("cal.thisWeek") : g.rel === "next" ? t("cal.nextWeek")
    : t("cal.weekOf", { date: fmt.date(`${g.week}T12:00:00Z`, { day: "numeric", month: "short" }) }));

  let body;
  if (!ctx.rows.length && !all.length) {
    body = emptyState({ title: t("cal.leadEmpty"), body: t("state.emptyWatchlistBody"), action: t("state.emptyWatchlistAction"), actionId: "add-stock" });
  } else if (!shown.length) {
    body = html`<div class="state"><p class="state__body">${t("cal.noneFilter")}</p><button type="button" class="btn btn--secondary" data-filter="all">${t("cal.showAll")}</button></div>`;
  } else {
    body = groups.map((g, i) => html`<section aria-labelledby="wk-${i}">
      <h2 class="section-title" id="wk-${i}" ${i === 0 ? html`style="margin-top:0"` : ""}>${weekTitle(g)}</h2>
      <ul class="menu">${g.events.map(eventRow)}</ul></section>`);
  }

  mount(main, html`
    ${statusBanners(ctx, { suspect: false })}
    <div class="summary-block" style="margin-bottom:var(--space-3)"><p class="summary">${lead(all)}</p></div>
    <button type="button" class="btn btn--primary btn--block" data-action="subscribe" style="margin-bottom:var(--space-3)">${icon("calendar")}${t("cal.subscribe")}</button>
    <div class="chips" role="group" aria-label="${t("cal.filterLabel")}" style="margin-bottom:var(--space-4)">
      ${["all", "earnings", "dividends", "macro"].map((k) => html`<button type="button" class="chip chip--choice" data-filter="${k}" aria-pressed="${filter === k}">${t(`cal.filter.${k}`)}</button>`)}
    </div>
    ${body}
    <p class="xs muted" style="margin-top:var(--space-4)">${t("cal.sources")}</p>`);

  main.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { prefsSet({ calFilter: f.dataset.filter }); ctx.render(); }
    if (e.target.closest('[data-action="subscribe"]')) openSubscribe(ctx);
  });
  $$('[data-action="add-stock"]', main).forEach((b) => b.addEventListener("click", () => openAddSheet(ctx)));
  return { title: t("nav.calendar") };
}

/* ------------------------------------------------------------------ subscription (.ics) */
function openSubscribe(ctx) {
  const { el } = openSheet({ title: t("cal.sheetTitle"), body: html`<div class="stack" id="sub-body">
    <p>${t("cal.subscribeBody")}</p>
    <button type="button" class="btn btn--primary btn--block" data-sub="create">${icon("calendar")}${t("cal.create")}</button>
  </div>` });
  const bodyEl = $("#sub-body", el);
  const showLink = (url) => {
    const webcal = url.replace(/^https?:\/\//, "webcal://");
    mount(bodyEl, html`
      <p>${t("cal.subscribeBody")}</p>
      <a class="btn btn--primary btn--block" href="${webcal}" id="sub-open">${icon("calendar")}${t("cal.open")}</a>
      <button type="button" class="btn btn--secondary btn--block" data-sub="copy">${t("cal.copy")}</button>
      <p class="small text-2">${t("cal.howGoogle")}</p>
      <label class="field"><span class="field__label">${t("cal.linkLabel")}</span>
        <input class="input" id="sub-url" readonly value="${url}"></label>
      <p class="small text-2">${t("cal.renewBody")}</p>
      <button type="button" class="btn btn--ghost btn--block" data-sub="renew">${icon("refresh")}${t("cal.renew")}</button>`);
  };
  const get = async (renew) => {
    const btn = el.querySelector("[data-sub=create], [data-sub=renew]");
    btn?.setAttribute("aria-busy", "true");
    try {
      showLink(await ctx.api.calendarUrl({ renew }));
      if (renew) toast(t("cal.renewed"));
    } catch (err) {
      toast(t("cal.failed", { reason: err.message }));
    } finally {
      btn?.removeAttribute("aria-busy");
    }
  };
  el.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-sub]")?.dataset.sub;
    if (a === "create") get(false);
    if (a === "renew") get(true);
    if (a === "copy") {
      const url = $("#sub-url", el).value;
      try { await navigator.clipboard.writeText(url); toast(t("cal.copied")); } catch { $("#sub-url", el).select(); }
    }
  });
  // already has a link? show it straight away
  ctx.api.calendarUrl({ create: false }).then((url) => { if (url && el.isConnected) showLink(url); }).catch(() => {});
}

/** Today: compact "Coming up" list (next 7 days, max 3). */
export function comingUp(ctx) {
  const soon = buildEvents(ctx.rows, ctx.macro, { from: todayIso(), days: 7 }).slice(0, 3);
  if (!soon.length) return "";
  return html`<h2 class="section-title">${t("cal.comingUp")}</h2>
    <ul class="menu">${soon.map(eventRow)}</ul>
    <p style="margin-top:var(--space-3)"><a class="btn btn--ghost" href="#/calendar">${t("cal.seeCalendar")}${icon("chevron")}</a></p>`;
}

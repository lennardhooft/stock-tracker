/* Today (home) — docs/screens/today.md
 * Answers "Is anything worth my attention today?" within 5 seconds. */
import { html, mount, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { ALERT_THRESHOLD, marketMood, explainScore, verdictSentence } from "../lib/signals.js";
import { bottomLabel } from "../components/badges.js";
import { icon } from "../components/icons.js";
import { stockCard } from "../components/cards.js";
import { calmState, emptyState } from "../components/states.js";
import { statusBanners, marketStrip, openBreakdown } from "./common.js";
import { openAddSheet } from "./watchlist.js";

const RANK = { normal: 0, watch: 1, strong: 2, extreme: 3 };

/** Attention cards, most important first, max 4 (spec order). */
export function attentionItems(ctx) {
  const items = [];
  const scored = ctx.rows.filter((r) => r.score != null && !r.error);
  for (const r of scored.filter((x) => x.score >= ALERT_THRESHOLD).sort((a, b) => b.score - a.score)) {
    items.push({ kind: "strong", icon: "trendDown", symbol: r.symbol,
      title: t("attention.strongTitle", { symbol: r.symbol, score: r.score, max: r.max_score }),
      body: verdictSentence(r) || explainScore(r), action: t("attention.research", { symbol: r.symbol }), href: `#/ticker/${encodeURIComponent(r.symbol)}` });
  }
  for (const r of scored) {
    if (r.prev_score == null || r.score >= ALERT_THRESHOLD) continue;
    const now = bottomLabel(r.score);
    const before = bottomLabel(r.prev_score);
    if (RANK[now] > RANK[before] && RANK[now] >= 1) {
      items.push({ kind: "watch", icon: "info", symbol: r.symbol,
        title: t("attention.roseTitle", { symbol: r.symbol, from: t(`score.label.${before}`), to: t(`score.label.${now}`) }),
        body: explainScore(r), action: t("attention.seeWhy"), breakdown: r.symbol });
    }
  }
  for (const r of scored.filter((x) => x.buy_below && x.price <= x.buy_below)) {
    items.push({ kind: "info", icon: "bell", symbol: r.symbol,
      title: t("attention.buyTitle", { symbol: r.symbol }),
      body: t("attention.buyBody", { price: fmt.money(r.price, r.currency), level: fmt.money(r.buy_below, r.currency) }),
      action: t("attention.open", { symbol: r.symbol }), href: `#/ticker/${encodeURIComponent(r.symbol)}` });
  }
  // earnings within 7 days (13.3)
  const todayNoon = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z");
  for (const r of ctx.rows.filter((x) => x.next_earnings?.date)) {
    const days = Math.round((new Date(`${r.next_earnings.date}T12:00:00Z`) - todayNoon) / 864e5);
    if (days < 0 || days > 7) continue;
    const when = days === 0 ? t("news.today").toLowerCase() : days === 1 ? t("news.tomorrow").toLowerCase() : t("news.inDays", { n: days }).toLowerCase();
    items.push({ kind: "info", icon: "calendar", symbol: r.symbol,
      title: t("attention.earningsTitle", { symbol: r.symbol, when }),
      body: t("attention.earningsBody", { date: fmt.date(`${r.next_earnings.date}T12:00:00Z`) }),
      action: t("attention.seeDetails"), href: `#/ticker/${encodeURIComponent(r.symbol)}` });
  }
  const pending = ctx.rows.filter((r) => r.score == null && !r.error);
  if (pending.length) {
    items.push({ kind: "info", icon: "refresh",
      title: t(pending.length === 1 ? "attention.pendingOne" : "attention.pendingMany", { n: pending.length, symbol: pending[0].symbol }),
      body: t("attention.pendingBody"), action: t("update.scoreNow"), run: true });
  }
  const problems = ctx.rows.filter((r) => r.suspect || r.error).length;
  if (problems || ctx.freshness === "failed") {
    items.push({ kind: "warning", icon: "warning",
      title: ctx.freshness === "failed" ? t("attention.jobFailedTitle") : t(problems === 1 ? "attention.dataTitleOne" : "attention.dataTitleMany", { n: problems }),
      body: t("attention.dataBody"), action: t("attention.health"), href: "#/more/health" });
  }
  return items.slice(0, 4);
}

function summary(ctx, items) {
  const strong = ctx.rows.filter((r) => r.score != null && r.score >= ALERT_THRESHOLD).length;
  const mood = marketMood(ctx.market);
  const first = !ctx.rows.length ? t("today.summaryEmpty")
    : ctx.rows.every((r) => r.score == null) ? t("today.summaryPending")
    : strong ? t(strong === 1 ? "today.summaryOne" : "today.summaryMany", { n: strong })
      : items.length ? t("today.summaryAttention") : t("today.summaryCalm");
  return html`<div class="summary-block" style="margin-bottom:var(--space-4)">
    <p class="summary">${first}</p>
    <p class="summary__meta">${t("today.mood")} <b style="color:var(--color-${mood.tone})">${t(`mood.${mood.key}`)}</b> · ${t("today.updated", { time: fmt.relativeTime(ctx.latestUpdate) })}</p>
  </div>`;
}

function card(it) {
  const btn = it.run
    ? html`<button type="button" class="btn btn--primary attention__action" data-action="run-update">${icon("refresh")}${it.action}</button>`
    : it.breakdown
    ? html`<button type="button" class="btn btn--secondary attention__action" data-breakdown="${it.breakdown}">${it.action}</button>`
    : html`<a class="btn ${it.kind === "strong" ? "btn--primary" : "btn--secondary"} attention__action" href="${it.href}">${it.action}</a>`;
  return html`<li class="attention attention--${it.kind}">
    <span class="attention__icon">${icon(it.icon)}</span>
    <h3 class="attention__title">${it.title}</h3>
    <p class="attention__body">${it.body}</p>
    ${btn}
  </li>`;
}

export function renderToday(ctx, main) {
  const items = attentionItems(ctx);
  const top = ctx.rows.filter((r) => r.score != null).sort((a, b) => b.score - a.score).slice(0, 3);

  const body = !ctx.rows.length
    ? emptyState({ title: t("state.emptyWatchlistTitle"), body: t("state.emptyWatchlistBody"), action: t("state.emptyWatchlistAction"), actionId: "add-stock" })
    : items.length
      ? html`<section aria-labelledby="att-h"><h2 class="section-title" id="att-h" style="margin-top:0">${t("today.attention")}</h2><ul class="list" style="gap:var(--space-3)">${items.map(card)}</ul></section>`
      : calmState();

  mount(main, html`
    ${statusBanners(ctx, { suspect: false })}
    ${summary(ctx, items)}
    ${body}
    <h2 class="section-title">${t("today.market")}</h2>
    ${marketStrip(ctx)}
    ${top.length ? html`
      <h2 class="section-title">${t("today.topOfList")}</h2>
      <ul class="list">${top.map((r) => html`<li>${stockCard(r, { href: `#/ticker/${encodeURIComponent(r.symbol)}` })}</li>`)}</ul>
      <p style="margin-top:var(--space-3)"><a class="btn btn--ghost" href="#/watchlist">${t("today.seeAll", { n: ctx.rows.length })}${icon("chevron")}</a></p>` : ""}
  `);

  $$("[data-breakdown]", main).forEach((b) => b.addEventListener("click", () => openBreakdown(ctx, b.dataset.breakdown)));
  $$('[data-action="add-stock"]', main).forEach((b) => b.addEventListener("click", () => openAddSheet(ctx)));
  return { title: t("nav.today") };
}

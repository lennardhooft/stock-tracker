/* Pieces shared by several screens: status banners, market strip, score breakdown sheet. */
import { html } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { marketMood, vixWord, describeSignal, explainScore, GLOSSARY_KEY } from "../lib/signals.js";
import { banner } from "../components/states.js";
import { statTile, signalRow } from "../components/cards.js";
import { scoreBadge } from "../components/badges.js";
import { openSheet, toast } from "../components/overlays.js";

/** Offline / stale / failed / suspect banners for the top of a screen (8.6). */
export function statusBanners(ctx, { suspect = true } = {}) {
  const out = [];
  if (ctx.offline) {
    out.push(banner({ tone: "info", title: t("banner.offlineTitle"), body: t("banner.offlineBody", { time: fmt.relativeTime(ctx.offline) }) }));
  } else if (ctx.freshness === "failed") {
    out.push(banner({ tone: "negative", title: t("banner.failedTitle"), body: t("banner.failedBody"), action: t("banner.healthAction"), actionId: "health" }));
  } else if (ctx.freshness === "stale" && ctx.rows.length) {
    out.push(banner({ tone: "warning", title: t("banner.staleTitle", { time: fmt.relativeTime(ctx.latestUpdate) }), body: t("banner.staleBody"), action: t("banner.healthAction"), actionId: "health" }));
  }
  if (suspect && ctx.rows.some((r) => r.suspect)) {
    out.push(banner({ tone: "warning", title: t("banner.suspectTitle"), body: t("banner.suspectBody") }));
  }
  return out.length ? html`<div class="stack" style="margin-bottom:var(--space-4)">${out}</div>` : "";
}

/** Market strip: 4 tiles with a word next to every number. */
export function marketStrip(ctx) {
  const m = ctx.market || {};
  const na = (label, key) => statTile({ label, value: t("common.na"), context: t("market.unavailable"), glossaryKey: prefsKey(ctx, key) });
  const vix = m.vix?.value;
  const vw = typeof vix === "number" ? vixWord(vix) : null;
  const mood = marketMood({ fear_greed: m.fear_greed });
  return html`<div class="tiles">
    ${m.sp500 ? statTile({ label: "S&P 500", value: fmt.num(m.sp500.value, 0), chg: m.sp500.change_pct, glossaryKey: prefsKey(ctx, "sp500") }) : na("S&P 500")}
    ${m.nasdaq ? statTile({ label: "Nasdaq", value: fmt.num(m.nasdaq.value, 0), chg: m.nasdaq.change_pct, glossaryKey: prefsKey(ctx, "nasdaq") }) : na("Nasdaq")}
    ${vw ? statTile({ label: "VIX", value: fmt.num(vix, 1), word: t(`mood.${vw.key}`), wordTone: vw.tone, glossaryKey: prefsKey(ctx, "vix") }) : na("VIX", "vix")}
    ${m.fear_greed ? statTile({ label: t("market.fearGreed"), value: fmt.num(m.fear_greed.value, 0), word: t(`mood.${mood.key}`), wordTone: mood.tone, glossaryKey: prefsKey(ctx, "fear_greed") }) : na(t("market.fearGreed"), "fear_greed")}
  </div>`;
}

function prefsKey(ctx, key) {
  return ctx.glossaryButton(key) ? key : "";
}

/** Signal rows for a scored row, in plain language. */
export function signalList(ctx, row) {
  return html`<ul class="signals">${(row.signals || []).map((s) => {
    const d = describeSignal(s, row.currency);
    return signalRow({ ...s, name: d.name, detail: d.detail }, { glossaryKey: prefsKey(ctx, GLOSSARY_KEY[s.code]) });
  })}</ul>`;
}

/** Bottom sheet: why does this stock have this score? */
export function openBreakdown(ctx, symbol) {
  const row = ctx.rows.find((r) => r.symbol === symbol);
  if (!row || row.score == null) return;
  openSheet({
    title: `${t("score.bottom")} · ${row.symbol}`,
    body: html`<div class="stack">
      <div>${scoreBadge(row, { long: true })}</div>
      <p class="text-2">${explainScore(row)}</p>
      ${signalList(ctx, row)}
      <a class="btn btn--secondary btn--block" href="#/ticker/${encodeURIComponent(row.symbol)}" data-close-sheet>${t("today.openStock", { symbol: row.symbol })}</a>
    </div>`,
  });
}


/** "Update now": start the scoring job, then refresh when the new scores arrive (~2 min). */
let updateRunning = false;
export async function startUpdate(ctx) {
  if (updateRunning) { toast(t("update.waiting")); return; }
  let status;
  try {
    status = await ctx.api.runUpdate();
  } catch (e) {
    toast(e.message === "not_configured" ? t("update.notConfigured") : t("update.failed"));
    return;
  }
  toast(status === "already_running" ? t("update.already") : t("update.started"), { ms: 7000 });
  updateRunning = true;
  const before = ctx.latestUpdate;
  for (let i = 0; i < 12; i += 1) {         // check every 30 s for up to 6 minutes
    await new Promise((r) => setTimeout(r, ctx.api.demo ? 300 : 30000));
    await ctx.reload({ quiet: true });
    if (ctx.api.demo || ctx.latestUpdate !== before) {
      toast(t("update.done"));
      break;
    }
  }
  updateRunning = false;
}

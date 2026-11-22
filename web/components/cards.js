/* Stock card, signal row, stat tile, range bar, sparkline (CLAUDE.md 8.1). */
import { html, raw } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { icon } from "./icons.js";
import { changeTag, scoreBadge, topBadge } from "./badges.js";

/** Small inline sparkline. Direction is also given as text for screen readers. */
export function sparkline(values, { w = 88, h = 28, neutral = false } = {}) {
  const v = (values || []).filter((x) => typeof x === "number");
  if (v.length < 2) return "";
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v
    .map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((y - min) / span) * (h - 4)).toFixed(1)}`)
    .join(" ");
  const up = v[v.length - 1] >= v[0];
  const colour = neutral ? "var(--color-text-2)" : up ? "var(--color-positive)" : "var(--color-negative)";
  return raw(
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${up ? t("change.up") : t("change.down")}">` +
      `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  );
}

/**
 * Stock card / row.
 * s: {symbol, name, price, currency, change_pct, pct_from_52w_high, score, max_score, n_na,
 *     label, suspect, error, sparkline, top?: {score, max_score}}
 */
export function stockCard(s, { href = "" } = {}) {
  const Tag = href ? "a" : "div";
  const scored = s.score != null && !s.error;
  const body = scored
    ? html`<div class="stock__price num"><strong>${fmt.money(s.price, s.currency)}</strong>${changeTag(s.change_pct, 1)}</div>
      <div class="stock__meta num">${t("stock.fromHigh", { value: fmt.pct(s.pct_from_52w_high) })}</div>
      <div class="stock__spark">${sparkline(s.sparkline, { w: 72 })}</div>`
    : html`<div class="stock__note">${s.error ? t("stock.error") : t("stock.pending")}</div>`;
  return html`<${raw(Tag)} class="stock" ${href ? raw(`href="${href}"`) : ""}>
    <div class="stock__head">
      <div class="stock__id"><span class="stock__ticker">${s.symbol}</span><span class="stock__name truncate">${s.name || ""}</span></div>
      <div class="stock__score">${s.top ? topBadge(s.top) : ""}${scoreBadge(s)}</div>
    </div>
    ${body}
  </${raw(Tag)}>`;
}

/** Signal row: ✅/❌/n/a icon, plain-language name, value vs threshold, ⓘ. */
export function signalRow(sig, { glossaryKey = "" } = {}) {
  const state = sig.passed === true ? "passed" : sig.passed === false ? "failed" : "na";
  const ic = { passed: "check", failed: "cross", na: "dash" }[state];
  return html`<li class="signal" data-state="${state}">
    <span class="signal__icon">${icon(ic, { label: t(`signal.${state}`) })}</span>
    <span class="signal__name">${sig.name}</span>
    ${glossaryKey ? html`<button type="button" class="icon-btn info-btn signal__info" data-glossary="${glossaryKey}" aria-label="${t("common.info")} ${sig.name}">${icon("info")}</button>` : ""}
    <span class="signal__detail">${sig.detail}</span>
  </li>`;
}

/** Stat tile / KPI: label, big value, optional word, change, context line, trend. */
export function statTile({ label, value, word = "", wordTone = "", chg = null, context = "", trend = null, glossaryKey = "" }) {
  const tone = wordTone ? raw(` style="color: var(--color-${wordTone})"`) : "";
  return html`<div class="tile">
    <div class="tile__label"><span>${label}</span>${glossaryKey ? html`<button type="button" class="icon-btn icon-btn--sm info-btn" data-glossary="${glossaryKey}" aria-label="${t("common.info")} ${label}">${icon("info")}</button>` : ""}</div>
    <div class="tile__value">${value}</div>
    ${word ? html`<div class="tile__word"${tone}>${word}</div>` : ""}
    ${chg != null ? changeTag(chg, 2) : ""}
    ${context ? html`<div class="tile__context">${context}</div>` : ""}
    ${trend ? html`<div class="tile__trend">${sparkline(trend, { w: 120, h: 20, neutral: true })}</div>` : ""}
  </div>`;
}

/** Range bar: where `value` sits between min and max of its own history. */
export function rangeBar({ min, max, value, format = (v) => fmt.num(v, 1), caption = "" }) {
  const p = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 50;
  return html`<div class="range" role="img" aria-label="${caption || ""} ${t("range.now")} ${format(value)}, ${t("range.min")} ${format(min)}, ${t("range.max")} ${format(max)}">
    ${caption ? html`<div class="small text-2">${caption}</div>` : ""}
    <div class="range__track"><span class="range__marker" style="left:${p.toFixed(1)}%"></span></div>
    <div class="range__labels"><span>${t("range.min")} ${format(min)}</span><span>${t("range.now")} ${format(value)}</span><span>${t("range.max")} ${format(max)}</span></div>
  </div>`;
}

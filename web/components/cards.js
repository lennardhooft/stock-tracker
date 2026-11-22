/* Stock card, signal row, stat tile, range bar, sparkline (CLAUDE.md 8.1). */
import { html, raw } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { icon } from "./icons.js";
import { changeTag, scoreBadge, topBadge, verdictBadge } from "./badges.js";

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
      ${s.tags?.length ? html`<div class="stock__tags">${s.tags.join(" · ")}</div>` : ""}
      <div class="stock__spark">${sparkline(s.sparkline, { w: 72 })}</div>`
    : html`<div class="stock__note">${s.error ? t("stock.error") : t("stock.pending")}</div>`;
  return html`<${raw(Tag)} class="stock" ${href ? raw(`href="${href}"`) : ""}>
    <div class="stock__head">
      <div class="stock__id"><span class="stock__ticker">${s.symbol}</span><span class="stock__name truncate">${s.name || ""}</span></div>
      <div class="stock__score">${s.top?.score >= 2 ? topBadge(s.top, { short: true }) : ""}${scoreBadge(s)}</div>
    </div>
    ${body}
    ${scored && ["sale", "check", "trap"].includes(s.verdict) ? html`<div class="stock__verdict">${verdictBadge(s.verdict)}</div>` : ""}
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

const QUALITY_ICON = { good: "check", ok: "dash", weak: "warning", na: "dash" };

/** Quality part row (Phase 2E): good / ok / weak / n/a icon + word, name, numbers, ⓘ. */
export function qualityRow({ name, detail, state, tag = "", glossaryKey = "" }) {
  return html`<li class="signal" data-state="${state}">
    <span class="signal__icon">${icon(QUALITY_ICON[state], { label: t(`quality.state.${state}`) })}</span>
    <span class="signal__name">${name} <span class="signal__tag">${t(`quality.state.${state}`)}${tag ? ` · ${tag}` : ""}</span></span>
    ${glossaryKey ? html`<button type="button" class="icon-btn info-btn signal__info" data-glossary="${glossaryKey}" aria-label="${t("common.info")} ${name}">${icon("info")}</button>` : ""}
    <span class="signal__detail">${detail}</span>
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

/* ---------------- Portfolio components (Phase 3A) ---------------- */
const PALETTE = ["--chart-1", "--chart-2", "--chart-3", "--chart-5", "--chart-6", "--chart-7", "--chart-4", "--chart-8"];

/**
 * Stacked allocation bar with a text legend (never colour alone).
 * items: [{label, pct}] (already sorted). Small slices after `max` are grouped as "other".
 */
export function allocBar(items, { label = "", max = 6, otherLabel = "Other" } = {}) {
  let list = items.filter((x) => x.pct > 0.05);
  if (list.length > max) {
    const rest = list.slice(max - 1).reduce((s, x) => s + x.pct, 0);
    list = [...list.slice(0, max - 1), { label: otherLabel, pct: rest }];
  }
  return html`<div class="alloc" role="group" aria-label="${label}">
    <div class="alloc__bar" aria-hidden="true">${list.map((x, i) => html`<span class="alloc__seg" style="width:${x.pct.toFixed(2)}%;background:var(${PALETTE[i % PALETTE.length]})"></span>`)}</div>
    <ul class="alloc__legend">${list.map((x, i) => html`<li><span class="alloc__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span><span class="alloc__name">${x.label}</span><span class="num">${fmt.pct(x.pct, 0)}</span></li>`)}</ul>
  </div>`;
}

/** Risk budget row: "Satellite 22 % of max 30 %" with a bar and a limit marker. kind: "max" | "min". */
export function budgetBar({ label, pct, limit, kind = "max", text = "", note = "" }) {
  const over = kind === "max" ? pct > limit + 0.05 : pct < limit - 0.05;
  const scale = Math.max(100, pct);
  return html`<div class="budget" data-state="${over ? "over" : "ok"}">
    <span class="budget__label">${label}</span><span class="budget__text">${text}</span>
    <div class="budget__track" role="img" aria-label="${label}: ${text}">
      <span class="budget__fill" style="width:${Math.min(100, (pct / scale) * 100).toFixed(1)}%"></span>
      ${limit != null ? html`<span class="budget__limit" style="left:${Math.min(99.5, (limit / scale) * 100).toFixed(1)}%"></span>` : ""}
    </div>
    ${over && note ? html`<span class="budget__note">⚠️ ${note}</span>` : ""}
  </div>`;
}

/** Holding card: stock card layout + value, weight vs cap, P/L. h from valuePortfolio(). */
export function holdingCard(h, { href = "", capText = "", over = false, valueText = "", plText = "" } = {}) {
  return html`<a class="stock" href="${href}">
    <div class="stock__head">
      <div class="stock__id"><span class="stock__ticker">${h.symbol}</span><span class="stock__name truncate">${h.name || ""}</span></div>
      <div class="stock__score">${h.row?.score != null ? scoreBadge(h.row) : ""}</div>
    </div>
    <div class="stock__price num"><strong>${valueText}</strong>${h.change_pct != null ? changeTag(h.change_pct, 1) : ""}</div>
    <div class="holding__line"><span>${plText}</span><span class="${over ? "holding__over" : ""}">${over ? "⚠️ " : ""}${capText}</span></div>
  </a>`;
}

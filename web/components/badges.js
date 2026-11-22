/* Score badge, Top Score badge, verdict badge, change indicator (CLAUDE.md 8.1). */
import { html } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { icon } from "./icons.js";

/** Label key for a Bottom Score (6.6): 0–1 normal, 2–3 watch, 4–5 strong, 6+ extreme. */
export function bottomLabel(score) {
  if (score >= 6) return "extreme";
  if (score >= 4) return "strong";
  if (score >= 2) return "watch";
  return "normal";
}

/** Label key for a Top Score (13.14 A): 0–1 normal, 2–3 hot, 4+ trim. */
export function topLabel(score) {
  if (score >= 4) return "trim";
  if (score >= 2) return "hot";
  return "normal";
}

const BOTTOM_ICON = { normal: "dash", watch: "info", strong: "trendDown", extreme: "warning" };

/**
 * Bottom Score badge: "4/6 · Strong" with colour + icon + word.
 * row: {score, max_score, n_na, suspect, error}. If `onTap` id is set it renders a <button>.
 */
export function scoreBadge(row, { tapId = "", long = false } = {}) {
  if (!row || row.error) {
    return html`<span class="badge badge--error" title="${t("stock.error")}">${icon("error", { cls: "icon icon-sm" })}${t("score.error")}</span>`;
  }
  if (row.score == null) {
    return html`<span class="badge badge--pending" title="${t("stock.pending")}">${icon("refresh", { cls: "icon icon-sm" })}${t("score.pending")}</span>`;
  }
  const key = row.label || bottomLabel(row.score);
  const words = long ? t(`score.labelLong.${key}`) : t(`score.label.${key}`);
  const na = row.n_na ? html` <span class="xs">(${t("score.naCount", { n: row.n_na })})</span>` : "";
  const warn = row.suspect ? html` <span title="${t("score.suspect")}">⚠️</span>` : "";
  const inner = html`${icon(BOTTOM_ICON[key], { cls: "icon icon-sm" })}${fmt.num(row.score, 0)}/${fmt.num(row.max_score, 0)} · ${words}${na}${warn}`;
  const aria = `${t("score.bottom")} ${row.score} / ${row.max_score}, ${words}`;
  return tapId
    ? html`<button type="button" class="badge badge--${key}" data-breakdown="${tapId}" aria-label="${aria}. ${t("score.tapForBreakdown")}">${inner}</button>`
    : html`<span class="badge badge--${key}" aria-label="${aria}">${inner}</span>`;
}

/** Top Score badge — violet family, ▲ icon, distinct from the Bottom Score. */
export function topBadge(row, { short = false } = {}) {
  if (!row || row.score == null) return "";
  const key = topLabel(row.score);
  const words = t(`score.topLabel.${key}`);
  const shown = short ? t(`score.topShort.${key}`) : words;
  return html`<span class="badge badge--top-${key}" aria-label="${t("score.top")} ${row.score}/${row.max_score}, ${words}">▲ ${fmt.num(row.score, 0)}/${fmt.num(row.max_score, 0)} · ${shown}</span>`;
}

/** Verdict badge: sale | check | trap | none. */
export function verdictBadge(verdict) {
  if (!verdict) return "";
  return html`<span class="verdict verdict--${verdict}"><span class="verdict__dot" aria-hidden="true"></span>${t(`verdict.${verdict}`)}</span>`;
}

/** Change with sign + arrow + colour + screen-reader word. */
export function changeTag(v, decimals = 1) {
  const c = fmt.change(v, decimals);
  return html`<span class="chg" data-dir="${c.dir}"><span aria-hidden="true">${c.text}</span><span class="visually-hidden">${c.label}</span></span>`;
}

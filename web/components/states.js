/* Empty, error, calm, skeleton and banner components (CLAUDE.md 8.6). */
import { html } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { icon } from "./icons.js";

export function emptyState({ title, body, action = "", actionId = "", iconName = "empty" }) {
  return html`<div class="state">
    ${icon(iconName, { cls: "state__icon" })}
    <h3 class="state__title">${title}</h3>
    <p class="state__body">${body}</p>
    ${action ? html`<button type="button" class="btn btn--primary" data-action="${actionId}">${icon("plus")}${action}</button>` : ""}
  </div>`;
}

export function calmState({ title = t("state.calmTitle"), body = t("state.calmBody") } = {}) {
  return html`<div class="state state--calm" role="status">
    ${icon("calm", { cls: "state__icon" })}
    <h3 class="state__title">${title}</h3>
    <p class="state__body">${body}</p>
  </div>`;
}

export function errorState({ title = t("state.errorTitle"), body = t("state.errorBody"), detail = "", retryId = "retry" } = {}) {
  return html`<div class="state state--error" role="alert">
    ${icon("error", { cls: "state__icon" })}
    <h3 class="state__title">${title}</h3>
    <p class="state__body">${body}</p>
    <button type="button" class="btn btn--secondary" data-action="${retryId}">${icon("refresh")}${t("common.retry")}</button>
    ${detail ? html`<details><summary>${t("common.details")}</summary><code>${detail}</code></details>` : ""}
  </div>`;
}

/** Skeleton list in the shape of stock cards. */
export function skeletonCards(n = 4) {
  const one = html`<div class="skeleton-card" aria-hidden="true">
    <span class="skeleton skeleton--title" style="width:55%"></span>
    <span class="skeleton skeleton--text" style="width:72px;height:24px;border-radius:999px"></span>
    <span class="skeleton skeleton--text" style="width:80%"></span>
    <span class="skeleton skeleton--text" style="width:88px;height:24px"></span>
  </div>`;
  return html`<div class="list" role="status" aria-label="${t("common.loading")}">${Array.from({ length: n }, () => one)}</div>`;
}

/** Inline banner. tone: info | warning | negative | positive. */
export function banner({ tone = "info", title = "", body = "", action = "", actionId = "" }) {
  const ic = { info: "info", warning: "warning", negative: "error", positive: "check" }[tone];
  return html`<div class="banner banner--${tone}" role="${tone === "negative" ? "alert" : "status"}">
    <span class="banner__icon">${icon(ic)}</span>
    <div class="banner__body"><span class="banner__title">${title}</span> ${body}</div>
    ${action ? html`<button type="button" class="btn btn--ghost banner__action" data-action="${actionId}">${action}</button>` : ""}
  </div>`;
}

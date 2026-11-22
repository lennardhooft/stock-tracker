/* Toasts, bottom sheet / side panel, confirm dialog (CLAUDE.md 8.1, 8.5). */
import { html, mount } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { icon } from "./icons.js";

function region() {
  let r = document.getElementById("toasts");
  if (!r) {
    r = document.createElement("div");
    r.id = "toasts";
    r.className = "toast-region";
    r.setAttribute("aria-live", "polite");
    document.body.append(r);
  }
  return r;
}

/** toast("Removed NVDA", {undo: () => …}) — auto-hides after 5 s. */
export function toast(message, { undo = null, ms = 5000 } = {}) {
  const el = document.createElement("div");
  el.className = "toast";
  mount(el, html`<span class="toast__msg">${message}</span>${undo ? html`<button type="button" class="btn btn--ghost">${t("common.undo")}</button>` : ""}`);
  const close = () => el.remove();
  if (undo) el.querySelector("button").addEventListener("click", () => { undo(); close(); });
  region().append(el);
  setTimeout(close, ms);
  return close;
}

/** Bottom sheet on phones, side panel on desktop. Built on native <dialog> (focus trap + Esc). */
export function openSheet({ title, body }) {
  const d = document.createElement("dialog");
  d.className = "sheet";
  d.setAttribute("aria-label", title);
  mount(d, html`<div class="sheet__grip" aria-hidden="true"></div>
    <div class="sheet__head"><h2 class="sheet__title">${title}</h2>
      <button type="button" class="icon-btn" data-close aria-label="${t("common.close")}">${icon("close")}</button></div>
    <div class="sheet__body">${body}</div>`);
  document.body.append(d);
  const close = () => { d.close(); d.remove(); };
  d.querySelector("[data-close]").addEventListener("click", close);
  d.addEventListener("click", (e) => {
    if (e.target === d) close(); // tap on backdrop
    else if (e.target.closest("a[href]")) close(); // links navigate away
  });
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  d.showModal();
  return { el: d, close };
}

/** Confirm dialog for truly irreversible actions. Resolves true/false. */
export function confirmDialog({ title, body, confirm, destructive = true }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "dialog";
    mount(d, html`<h2 class="dialog__title">${title}</h2><p class="text-2">${body}</p>
      <div class="dialog__actions">
        <button type="button" class="btn btn--secondary" value="no">${t("common.cancel")}</button>
        <button type="button" class="btn ${destructive ? "btn--destructive" : "btn--primary"}" value="yes">${confirm}</button>
      </div>`);
    document.body.append(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => done(b.value === "yes")));
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    d.showModal();
  });
}

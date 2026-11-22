/* Login (owner decision: email + password, with the email link as a fallback).
 *
 * Why a password: on iPhone an app saved to the home screen has its own storage. An email link
 * always opens Safari and logs *Safari* in, not the home-screen app. A password typed into this
 * screen logs in right here. The email link still works in a normal browser and is how the owner
 * sets the password the first time (Settings → Account → Set password). */
import { html, mount, $ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { icon } from "../components/icons.js";

export function renderLogin(ctx, main) {
  mount(main, html`<div class="narrow stack">
    <div class="card stack">
      <h1>${t("login.title")}</h1>
      <form id="login-form" class="stack" novalidate>
        <label class="field"><span class="field__label">${t("login.email")}</span>
          <input class="input" id="login-email" type="email" autocomplete="username" inputmode="email" required aria-describedby="login-msg"></label>
        <label class="field"><span class="field__label">${t("login.password")}</span>
          <input class="input" id="login-password" type="password" autocomplete="current-password" required aria-describedby="login-msg"></label>
        <button class="btn btn--primary btn--block" type="submit">${t("login.submit")}</button>
      </form>
      <p id="login-msg" class="small" role="status" aria-live="polite"></p>
      <hr style="border:0;border-top:1px solid var(--color-border);margin:var(--space-2) 0">
      <p class="small text-2">${t("login.noPassword")}</p>
      <button type="button" class="btn btn--secondary btn--block" data-link>${icon("bell")}${t("login.sendLink")}</button>
    </div>
    <p class="xs muted" style="text-align:center">${t("about.disclaimerShort")}</p>
  </div>`);

  const form = $("#login-form", main);
  const email = $("#login-email", main);
  const pw = $("#login-password", main);
  const msg = $("#login-msg", main);
  const err = (text, field) => {
    msg.className = "small field__error";
    msg.textContent = text;
    field?.setAttribute("aria-invalid", "true");
  };
  const validEmail = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    email.removeAttribute("aria-invalid");
    pw.removeAttribute("aria-invalid");
    if (!validEmail()) return err(t("login.invalid"), email);
    if (!pw.value) return err(t("login.passwordMissing"), pw);
    const btn = form.querySelector("button");
    btn.setAttribute("aria-busy", "true");
    msg.className = "small text-2";
    msg.textContent = t("login.checking");
    try {
      await ctx.api.loginPassword(email.value.trim(), pw.value);
      ctx.reload();
    } catch (ex) {
      btn.removeAttribute("aria-busy");
      err(/invalid/i.test(ex.message || "") ? t("login.wrongPassword") : t("login.failed", { reason: ex.message || "" }), pw);
    }
  });

  main.querySelector("[data-link]").addEventListener("click", async (e) => {
    if (!validEmail()) return err(t("login.invalid"), email);
    const btn = e.currentTarget;
    btn.setAttribute("aria-busy", "true");
    try {
      await ctx.api.login(email.value.trim());
      msg.className = "small";
      msg.style.color = "var(--color-positive)";
      msg.textContent = t("login.linkSent");
    } catch (ex) {
      err(t("login.failed", { reason: ex.message || "" }));
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

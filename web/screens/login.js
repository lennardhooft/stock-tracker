/* Login (email link). Shown without the tab bar. */
import { html, mount, $ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { icon } from "../components/icons.js";

export function renderLogin(ctx, main) {
  mount(main, html`<div class="narrow stack">
    <div class="card stack">
      <h1>${t("login.title")}</h1>
      <p class="text-2">${t("login.body")}</p>
      <form id="login-form" class="stack" novalidate>
        <label class="field"><span class="field__label">${t("login.email")}</span>
          <input class="input" id="login-email" type="email" autocomplete="email" inputmode="email" required aria-describedby="login-msg"></label>
        <button class="btn btn--primary btn--block" type="submit">${icon("bell")}${t("login.send")}</button>
      </form>
      <p id="login-msg" class="small" role="status" aria-live="polite"></p>
    </div>
    <p class="xs muted" style="text-align:center">${t("about.disclaimerShort")}</p>
  </div>`);

  const form = $("#login-form", main);
  const input = $("#login-email", main);
  const msg = $("#login-msg", main);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      input.setAttribute("aria-invalid", "true");
      msg.className = "small field__error";
      msg.textContent = t("login.invalid");
      return;
    }
    input.removeAttribute("aria-invalid");
    const btn = form.querySelector("button");
    btn.setAttribute("aria-busy", "true");
    msg.className = "small text-2";
    msg.textContent = t("login.sending");
    try {
      await ctx.api.login(email);
      msg.className = "small";
      msg.style.color = "var(--color-positive)";
      msg.textContent = t("login.sent");
    } catch (err) {
      msg.className = "small field__error";
      msg.textContent = t("login.failed", { reason: err.message || "" });
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

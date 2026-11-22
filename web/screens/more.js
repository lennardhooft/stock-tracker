/* More tab: Settings, Data health, Glossary, About — docs/screens/settings.md */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t, initI18n } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { prefsGet, prefsSet, applyTheme, cacheClear } from "../lib/settings.js";
import { icon } from "../components/icons.js";
import { banner } from "../components/states.js";
import { toast, openSheet } from "../components/overlays.js";

export function renderMore(ctx, main) {
  const item = (href, ic, label, hint = "") => html`<li><a class="menu__item" href="${href}">${icon(ic)}<span class="menu__label">${label}${hint ? html`<span class="menu__hint">${hint}</span>` : ""}</span>${icon("chevron")}</a></li>`;
  mount(main, html`<div class="stack" style="max-width:640px">
    <ul class="menu">
      ${item("#/more/alerts", "bell", t("more.alerts"), t("more.alertsHint", { n: (ctx.data?.alerts || []).length }))}
      ${item("#/more/settings", "settings", t("more.settings"), t("more.settingsHint"))}
      ${item("#/more/risk", "wallet", t("risk.title"), t("risk.menuHint"))}
      ${item("#/more/health", "refresh", t("more.health"), t(`freshness.${ctx.freshness}`))}
      ${item("#/more/glossary", "info", t("more.glossary"), t("more.glossaryHint"))}
      ${item("#/more/about", "calm", t("more.about"))}
    </ul>
    <ul class="menu"><li><button type="button" class="menu__item menu__item--danger" data-logout>${icon("logout")}<span class="menu__label">${t("more.logout")}</span></button></li></ul>
  </div>`);
  main.querySelector("[data-logout]").addEventListener("click", async () => {
    cacheClear();
    await ctx.api.logout();
    location.hash = "#/";
    location.reload();
  });
  return { title: t("nav.more") };
}

function seg(name, value, options) {
  return html`<div class="segmented" role="group" aria-label="${t(`settings.${name}`)}">${options.map(([v, label]) => html`<button type="button" data-set="${name}" data-value="${v}" aria-pressed="${value === v}">${label}</button>`)}</div>`;
}

export function renderSettings(ctx, main) {
  const p = prefsGet();
  mount(main, html`<div style="max-width:640px">
    <h2 class="section-title" style="margin-top:0">${t("settings.display")}</h2>
    <div class="card">
      <div class="setting"><span class="setting__label">${t("settings.theme")}</span>
        ${seg("theme", p.theme, [["dark", t("settings.dark")], ["light", t("settings.light")], ["system", t("settings.system")]])}
        <span class="setting__hint">${t("settings.themeHint")}</span></div>
      <div class="setting"><span class="setting__label">${t("settings.lang")}</span>
        ${seg("lang", p.lang, [["en", "English"], ["nl", "Nederlands"]])}
        <span class="setting__hint">${t("settings.langHint")}</span></div>
      <div class="setting"><span class="setting__label">${t("settings.numfmt")}</span>
        ${seg("numfmt", p.numfmt, [["nl-BE", "€ 1.234,56"], ["en", "€1,234.56"]])}
        <span class="setting__hint">${t("settings.numfmtHint")}</span></div>
      <div class="setting">
        <button type="button" class="toggle" role="switch" aria-checked="${p.explain}" data-toggle="explain"><span><span class="setting__label">${t("settings.explain")}</span><span class="setting__hint" style="display:block">${t("settings.explainHint")}</span></span><span class="toggle__track"></span></button></div>
    </div>
    <h2 class="section-title">${t("settings.account")}</h2>
    <div class="card stack">
      <p class="text-2">${t("settings.privacy")}</p>
      <div id="mfa-box" class="stack">
        <h3 style="font-size:var(--text-md)">${t("mfa.title")}</h3>
        <p class="small text-2">${t("mfa.why")}</p>
        <p id="mfa-state" class="small">${ctx.mfa?.enabled ? html`<b style="color:var(--color-positive)">${icon("check")} ${t("mfa.on")}</b>` : html`<b style="color:var(--color-warning)">${t("mfa.off")}</b>`}</p>
        ${ctx.mfa?.enabled ? "" : html`<button type="button" class="btn btn--primary" data-mfa-setup>${t("mfa.setup")}</button>`}
      </div>
      <hr style="border:0;border-top:1px solid var(--color-border);margin:var(--space-2) 0">
      <form id="pw-form" class="stack" novalidate>
        <h3 style="font-size:var(--text-md)">${t("settings.pwTitle")}</h3>
        <p class="small text-2">${t("settings.pwHint")}</p>
        <input type="email" autocomplete="username" id="pw-user" hidden>
        <label class="field"><span class="field__label">${t("settings.pwNew")}</span>
          <input class="input" type="password" name="pw1" autocomplete="new-password" minlength="12" aria-describedby="pw-msg"></label>
        <label class="field"><span class="field__label">${t("settings.pwRepeat")}</span>
          <input class="input" type="password" name="pw2" autocomplete="new-password" aria-describedby="pw-msg"></label>
        <button class="btn btn--primary" type="submit">${t("settings.pwSave")}</button>
        <p id="pw-msg" class="small" role="status" aria-live="polite"></p>
      </form>
      <a class="btn btn--secondary" href="#/more">${t("more.logoutHint")}</a>
    </div>
    <h2 class="section-title">${t("settings.data")}</h2>
    <div class="card stack">
      <p class="text-2">${t("settings.schedule")}</p>
      <a class="btn btn--secondary" href="#/more/health">${t("more.health")}</a>
    </div>
    <h2 class="section-title">${t("settings.about")}</h2>
    <div class="card stack">
      <p class="text-2">${t("about.disclaimerShort")}</p>
      <a class="btn btn--secondary" href="#/welcome" data-tour>${t("settings.tour")}</a>
    </div>
  </div>`);

  main.querySelector("[data-mfa-setup]")?.addEventListener("click", () => openMfaSetup(ctx));

  // password (owner decision): needed to log in inside the home-screen app
  const pwForm = main.querySelector("#pw-form");
  ctx.api.userEmail?.().then((email) => { pwForm.querySelector("#pw-user").value = email; });
  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = pwForm.querySelector("#pw-msg");
    const [a, b] = [pwForm.pw1.value, pwForm.pw2.value];
    const fail = (key) => { msg.className = "small field__error"; msg.textContent = t(key); };
    pwForm.pw1.removeAttribute("aria-invalid");
    pwForm.pw2.removeAttribute("aria-invalid");
    if (a.length < 12) { pwForm.pw1.setAttribute("aria-invalid", "true"); return fail("settings.pwTooShort"); }
    if (a !== b) { pwForm.pw2.setAttribute("aria-invalid", "true"); return fail("settings.pwMismatch"); }
    const btn = pwForm.querySelector("button");
    btn.setAttribute("aria-busy", "true");
    try {
      await ctx.api.setPassword(a);
      pwForm.reset();
      msg.className = "small";
      msg.style.color = "var(--color-positive)";
      msg.textContent = t("settings.pwSaved");
    } catch (ex) {
      msg.className = "small field__error";
      msg.textContent = t("errors.saveFailed", { reason: ex.message || "" });
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });

  main.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-set]");
    const tg = e.target.closest("[data-toggle]");
    const tour = e.target.closest("[data-tour]");
    if (tour) prefsSet({ onboarded: false });
    if (!b && !tg) return;
    const patch = b ? { [b.dataset.set]: b.dataset.value } : { [tg.dataset.toggle]: tg.getAttribute("aria-checked") !== "true" };
    const ok = prefsSet(patch);
    if ("theme" in patch) applyTheme();
    if ("lang" in patch) await initI18n(patch.lang);
    if ("numfmt" in patch) fmt.setNumberLocale(patch.numfmt === "en" ? "en" : "nl-BE");
    toast(ok ? t("toast.saved") : t("settings.notStored"));
    ctx.render();
  });
  return { title: t("more.settings"), back: "#/more" };
}

export function renderHealth(ctx, main) {
  const runs = ctx.runs;
  const last = runs[0];
  const dot = (st) => ({ ok: "green", partial: "yellow", failed: "red" })[st] || "yellow";
  const lastOk = {};
  for (const r of [...runs].reverse()) for (const [k, v] of Object.entries(r.sources || {})) if (v.ok) lastOk[k] = r.finished_at;
  const srcName = (k) => t(`health.src.${k}`) === `health.src.${k}` ? k : t(`health.src.${k}`);
  mount(main, html`<div class="stack" style="max-width:720px">
    ${banner({ tone: ctx.freshness === "fresh" ? "positive" : ctx.freshness === "failed" ? "negative" : "warning",
      title: t(`freshness.${ctx.freshness}`), body: t("health.lastUpdate", { time: fmt.relativeTime(ctx.latestUpdate) }) })}
    <section class="card stack" style="gap:var(--space-2)">
      <button type="button" class="btn btn--primary" data-action="run-update">${icon("refresh")}${t("update.button")}</button>
      <p class="small text-2">${t("update.hint")}</p>
    </section>
    ${last ? html`<section class="card">
      <h2 class="card__title">${t("health.lastRun")}</h2>
      <p><span class="badge badge--${last.status === "ok" ? "normal" : last.status === "partial" ? "watch" : "extreme"}">${t(`health.status.${last.status}`)}</span> <span class="text-2">${fmt.dateTime(last.finished_at)}</span></p>
      <p class="small text-2 num" style="margin-top:var(--space-2)">${t("health.counts", { scored: last.counts?.scored ?? 0, tickers: last.counts?.tickers ?? 0, errors: last.counts?.errors ?? 0, suspect: last.counts?.suspect ?? 0 })}</p>
    </section>
    <section class="card">
      <h2 class="card__title">${t("health.intraday")}</h2>
      ${ctx.intradayRun ? html`<p><span class="badge badge--${ctx.intradayRun.status === "ok" ? "normal" : ctx.intradayRun.status === "partial" ? "watch" : "extreme"}">${t(`health.status.${ctx.intradayRun.status}`)}</span> <span class="text-2">${fmt.relativeTime(ctx.intradayRun.finished_at)}</span></p>
        <p class="small text-2 num" style="margin-top:var(--space-2)">${t("health.intradayCounts", { checked: ctx.intradayRun.counts?.checked ?? 0, tickers: ctx.intradayRun.counts?.tickers ?? 0, sent: ctx.intradayRun.counts?.alerts_sent ?? 0 })}</p>`
        : html`<p class="text-2">${t("health.intradayNone")}</p>`}
    </section>
    <section class="card">
      <h2 class="card__title">${t("health.sources")}</h2>
      <ul class="signals">${Object.entries(last.sources || {}).map(([k, v]) => html`<li class="signal" data-state="${v.ok ? "passed" : "na"}">
        <span class="signal__icon" style="color:var(--color-${v.ok ? "positive" : "negative"})">${icon(v.ok ? "check" : "error", { label: v.ok ? t("health.ok") : t("health.failed") })}</span>
        <span class="signal__name">${srcName(k)}</span>
        <span class="signal__detail">${v.ok ? t("health.ok") : t("health.failed")} · ${t("health.lastSuccess", { time: fmt.relativeTime(lastOk[k]) })}</span></li>`)}</ul>
    </section>` : banner({ tone: "info", title: t("health.noRuns"), body: "" })}
    <section class="card">
      <h2 class="card__title">${t("health.recent")}</h2>
      <ul class="signals">${runs.slice(0, 10).map((r) => html`<li class="signal" data-state="passed">
        <span class="signal__icon"><span class="freshness__dot" style="display:inline-block;margin-top:6px;background:var(--color-${dot(r.status) === "green" ? "positive" : dot(r.status) === "red" ? "negative" : "warning"})"></span></span>
        <span class="signal__name num">${fmt.dateTime(r.started_at)}</span>
        <span class="signal__detail">${t(`health.status.${r.status}`)} · ${t("health.scoredOf", { scored: r.counts?.scored ?? "–", tickers: r.counts?.tickers ?? "–" })}</span></li>`)}</ul>
    </section>
  </div>`);
  return { title: t("more.health"), back: "#/more" };
}

export function renderGlossary(ctx, main) {
  mount(main, html`<div class="stack" style="max-width:720px" id="gl"><p class="text-2">${t("common.loading")}</p></div>`);
  fetch("glossary.json").then((r) => r.json()).then((g) => {
    const el = main.querySelector("#gl");
    if (!el) return;
    mount(el, html`${Object.values(g).map((e) => html`<section class="card stack" style="gap:var(--space-2)">
      <h2 style="font-size:var(--text-md)">${e.title}</h2>
      <p>${e.what}</p>
      <p class="small text-2"><b>${t("glossary.why")}</b> ${e.why}</p>
      <p class="small text-2"><b>${t("glossary.how")}</b> ${e.how}</p>
      <p class="small text-2"><b>${t("glossary.limits")}</b> ${e.limits}</p></section>`)}`);
  });
  return { title: t("more.glossary"), back: "#/more" };
}

export function renderAbout(ctx, main) {
  mount(main, html`<div class="card stack" style="max-width:640px">
    <h2>${t("app.name")}</h2>
    <p>${t("about.what")}</p>
    <p class="text-2">${t("about.disclaimer")}</p>
    <p class="small muted">${t("about.privacy")}</p>
  </div>`);
  $$("a", main);
  return { title: t("more.about"), back: "#/more" };
}

/** Set up two-step login: QR + secret → 6-digit code → on (CLAUDE.md 13.13.2). */
export async function openMfaSetup(ctx) {
  const { el, close } = openSheet({ title: t("mfa.setupTitle"), body: html`<div class="stack" id="mfa-setup"><span class="skeleton skeleton--title"></span></div>` });
  const box = $("#mfa-setup", el);
  let enrol;
  try {
    enrol = await ctx.api.mfaEnroll();
  } catch (e) {
    mount(box, html`<p class="field__error">${t("mfa.setupFailed", { reason: e.message || "" })}</p>`);
    return;
  }
  mount(box, html`
    <ol class="stack small" style="padding-left:1.2em;margin:0">
      <li>${t("mfa.step1")}</li><li>${t("mfa.step2")}</li><li>${t("mfa.step3")}</li>
    </ol>
    <img src="${enrol.qr}" alt="${t("mfa.qrAlt")}" width="180" height="180" style="background:#fff;border-radius:var(--radius-md);padding:8px;align-self:center">
    <label class="field"><span class="field__label">${t("mfa.secret")}</span>
      <input class="input num" readonly value="${enrol.secret}" id="mfa-secret"></label>
    <form class="stack" id="mfa-confirm" novalidate>
      <label class="field"><span class="field__label">${t("mfa.code")}</span>
        <input class="input num" id="mfa-new-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required aria-describedby="mfa-setup-msg"></label>
      <p id="mfa-setup-msg" class="small" role="status" aria-live="polite"></p>
      <button type="submit" class="btn btn--primary btn--block">${t("mfa.turnOn")}</button>
    </form>`);
  $("#mfa-confirm", el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#mfa-new-code", el);
    const msg = $("#mfa-setup-msg", el);
    const code = input.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) { msg.className = "small field__error"; msg.textContent = t("mfa.sixDigits"); return; }
    const btn = e.target.querySelector("button");
    btn.setAttribute("aria-busy", "true");
    try {
      await ctx.api.mfaConfirm(enrol.factorId, code);
      ctx.mfa = await ctx.api.mfaStatus();
      close();
      toast(t("mfa.turnedOn"));
      await ctx.loadPortfolio();
      ctx.render();
    } catch {
      msg.className = "small field__error";
      msg.textContent = t("mfa.wrong");
      input.select();
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

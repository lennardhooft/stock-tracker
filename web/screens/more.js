/* More tab: Settings, Data health, Glossary, About — docs/screens/settings.md */
import { html, mount, $$ } from "../lib/dom.js";
import { t, initI18n } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { prefsGet, prefsSet, applyTheme, cacheClear } from "../lib/settings.js";
import { icon } from "../components/icons.js";
import { banner } from "../components/states.js";
import { toast } from "../components/overlays.js";

export function renderMore(ctx, main) {
  const item = (href, ic, label, hint = "") => html`<li><a class="menu__item" href="${href}">${icon(ic)}<span class="menu__label">${label}${hint ? html`<span class="menu__hint">${hint}</span>` : ""}</span>${icon("chevron")}</a></li>`;
  mount(main, html`<div class="stack" style="max-width:640px">
    <ul class="menu">
      ${item("#/more/alerts", "bell", t("more.alerts"), t("more.alertsHint", { n: (ctx.data?.alerts || []).length }))}
      ${item("#/more/settings", "settings", t("more.settings"), t("more.settingsHint"))}
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

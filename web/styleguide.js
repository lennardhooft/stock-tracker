/* Living style guide (CLAUDE.md 8.1): renders every component in every state from FAKE
 * fixture data, using the same component functions the screens use.
 * URL options: ?theme=light|dark  ?lang=en|nl  ?fmt=en (English number format)
 */
import { html, mount, $, $$ } from "./lib/dom.js";
import { initI18n, t, lang } from "./lib/i18n.js";
import * as fmt from "./lib/format.js";
import { icon, ICON_NAMES } from "./components/icons.js";
import { scoreBadge, topBadge, verdictBadge, changeTag } from "./components/badges.js";
import { stockCard, signalRow, statTile, rangeBar, qualityRow } from "./components/cards.js";
import { emptyState, calmState, errorState, skeletonCards, banner } from "./components/states.js";
import { toast, openSheet, confirmDialog } from "./components/overlays.js";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = theme;

await initI18n(params.get("lang") === "nl" ? "nl" : "en");
fmt.setNumberLocale(params.get("fmt") === "en" ? "en" : "nl-BE");

const fixtures = await (await fetch("fixtures/stocks.json")).json();
const glossary = await (await fetch("glossary.json")).json();

// ---------------------------------------------------------------- shell
const navItems = [
  ["today", "today"],
  ["watchlist", "list"],
  ["more", "more"],
];
mount($("#tabbar"), html`${navItems.map(([key, ic], i) => html`<a class="tabbar__item" href="#${key}" ${i === 0 ? html`aria-current="page"` : ""}>${icon(ic)}<span>${t(`nav.${key}`)}</span></a>`)}`);
for (const [key, ic] of navItems) mount($(`#rail-${key}`), html`${icon(ic)}<span>${t(`nav.${key}`)}</span>`);
mount($("#theme"), icon(theme === "dark" ? "sun" : "moon"));
$("#theme").addEventListener("click", () => {
  params.set("theme", theme === "dark" ? "light" : "dark");
  location.search = params.toString();
});
$("#lang").textContent = lang() === "en" ? "NL" : "EN";
$("#lang").addEventListener("click", () => {
  params.set("lang", lang() === "en" ? "nl" : "en");
  location.search = params.toString();
});
$$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });

// ---------------------------------------------------------------- helpers
const section = (id, title, intro, body) =>
  html`<section class="sg-section" id="${id}"><h2>${title}</h2>${intro ? html`<p>${intro}</p>` : ""}${body}</section>`;
const swatch = (v) => html`<div class="sg-swatch"><div class="sg-swatch__chip" style="background: var(${v})"></div><div class="sg-swatch__name">${v}</div></div>`;
const label = (s) => html`<div class="sg-label">${s}</div>`;
const demo = (s, el) => html`<div class="sg-demo">${label(s)}${el}</div>`;

const S = fixtures.stocks;
const gl = (key) => (glossary[key] ? key : "");

// ---------------------------------------------------------------- sections
const colours = section("colours", "Colours", "Dark theme first. Semantic colours are always paired with an icon and a word.", html`
  ${label("neutrals")}<div class="sg-grid">${["--color-bg", "--color-surface", "--color-raised", "--color-border", "--color-border-strong", "--color-text", "--color-text-2", "--color-muted"].map(swatch)}</div><br>
  ${label("accent + semantic")}<div class="sg-grid">${["--color-accent", "--color-positive", "--color-negative", "--color-warning", "--color-info"].map(swatch)}</div><br>
  ${label("Bottom Score scale")}<div class="sg-grid">${["--score-normal", "--score-watch", "--score-strong", "--score-extreme"].map(swatch)}</div><br>
  ${label("Top Score scale (separate family)")}<div class="sg-grid">${["--top-normal", "--top-hot", "--top-trim"].map(swatch)}</div><br>
  ${label("chart palette (colour-blind safe)")}<div class="sg-grid">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => swatch(`--chart-${n}`))}</div>`);

const type = section("type", "Typography", "System font. Numbers always use tabular figures so columns line up.", html`
  <div class="stack">
    <div style="font-size:var(--text-2xl);font-weight:700">32 · Portfolio € 52.340,18</div>
    <div style="font-size:var(--text-xl);font-weight:600">24 · Today</div>
    <div style="font-size:var(--text-lg);font-weight:600">20 · Section title</div>
    <div style="font-size:var(--text-md)">16 · Body text: 2 stocks show bottom signals.</div>
    <div style="font-size:var(--text-sm)" class="text-2">14 · Secondary text and labels</div>
    <div style="font-size:var(--text-xs)" class="muted">12 · Captions, tile labels</div>
    <div class="num card" style="max-width:260px">
      ${["1.234,56", "98,40", "12.006,10"].map((n) => html`<div style="text-align:right">€ ${n}</div>`)}
    </div>
    <div class="small text-2">Formatter (nl-BE): ${fmt.money(1234.56, "EUR")} · ${fmt.money(342.56, "USD")} · ${fmt.pct(12.5)} · ${fmt.money(1_234_000, "EUR", { compact: true })} · ${fmt.relativeTime(new Date(Date.now() - 12 * 60000).toISOString())}</div>
  </div>`);

const spacing = section("spacing", "Spacing, radius, elevation", "4 px base scale. Three shadow levels.", html`
  <div class="stack" style="max-width:320px">${["--space-1", "--space-2", "--space-3", "--space-4", "--space-6", "--space-8", "--space-12"].map((v) => html`<div>${label(v)}<div class="sg-box" style="width: var(${v})"></div></div>`)}</div><br>
  <div class="sg-row">${["--radius-sm", "--radius-md", "--radius-lg"].map((r) => html`<div class="sg-elev" style="border-radius: var(${r}); border:1px solid var(--color-border)">${r}</div>`)}</div>
  <div class="sg-row">${["--shadow-1", "--shadow-2", "--shadow-3"].map((s) => html`<div class="sg-elev" style="box-shadow: var(${s})">${s}</div>`)}</div>`);

const icons = section("icons", "Icons", "24 px, 2 px stroke, currentColor.", html`<div class="sg-icons">${ICON_NAMES.map((n) => html`<div>${icon(n)}<span>${n}</span></div>`)}</div>`);

const shell = section("shell", "App shell", "Top bar with data-freshness dot (green / yellow / red, tappable). Bottom tab bar on phones, side rail from 900 px. Phase 1 shows only Today, Watchlist and More.", html`
  <div class="sg-shell">
    <header class="topbar"><h1 class="topbar__title">${t("nav.today")}</h1><div class="topbar__actions">
      <button class="icon-btn" aria-label="${t("nav.search")}">${icon("search")}</button>
      <button type="button" class="freshness" data-state="fresh" aria-label="${t("freshness.fresh")}"><span class="freshness__dot"></span></button>
      <button type="button" class="freshness" data-state="stale" aria-label="${t("freshness.stale")}"><span class="freshness__dot"></span></button>
      <button type="button" class="freshness" data-state="failed" aria-label="${t("freshness.failed")}"><span class="freshness__dot"></span></button>
    </div></header>
    <div style="height:64px"></div>
    <nav class="tabbar" aria-label="Example">${navItems.map(([key, ic], i) => html`<a class="tabbar__item" href="#shell" ${i === 1 ? html`aria-current="page"` : ""}>${icon(ic)}<span>${t(`nav.${key}`)}</span></a>`)}</nav>
  </div>`);

const btnRow = (variant, text) => html`<div class="sg-row">
  ${demo("default", html`<button class="btn btn--${variant}">${text}</button>`)}
  ${demo("hover", html`<button class="btn btn--${variant} is-hover">${text}</button>`)}
  ${demo("pressed", html`<button class="btn btn--${variant} is-pressed">${text}</button>`)}
  ${demo("focus", html`<button class="btn btn--${variant} is-focus">${text}</button>`)}
  ${demo("disabled", html`<button class="btn btn--${variant}" disabled>${text}</button>`)}
  ${demo("loading", html`<button class="btn btn--${variant}" aria-busy="true">${text}</button>`)}
</div>`;
const buttons = section("buttons", "Buttons", "One primary action per screen. Labels say what they do. Minimum 44 px high.", html`
  ${label("primary")}${btnRow("primary", "Add stock")}
  ${label("secondary")}${btnRow("secondary", "Set buy alert")}
  ${label("ghost")}${btnRow("ghost", "Show all")}
  ${label("destructive")}${btnRow("destructive", "Remove")}
  ${label("icon buttons")}<div class="sg-row">
    <button class="icon-btn" aria-label="Search">${icon("search")}</button>
    <button class="icon-btn" aria-label="Refresh">${icon("refresh")}</button>
    <button class="icon-btn is-focus" aria-label="Settings">${icon("settings")}</button>
    <button class="icon-btn" disabled aria-label="Close">${icon("close")}</button>
  </div>`);

const forms = section("forms", "Form controls", "Inline validation, 16 px text (no zoom on iPhone), the right keyboard per field.", html`
  <div class="sg-two">
    <div class="stack">
      <label class="field"><span class="field__label">Yahoo symbol</span><input class="input" placeholder="AAPL, ASML.AS" autocapitalize="characters"><span class="field__hint">EU stocks use a suffix: .AS Amsterdam, .BR Brussels</span></label>
      <label class="field"><span class="field__label">Focus</span><input class="input is-focus" value="ASML.AS"></label>
      <label class="field"><span class="field__label">Personal buy level</span><input class="input" inputmode="decimal" value="abc" aria-invalid="true" aria-describedby="err1"><span class="field__error" id="err1">${icon("error", { cls: "icon icon-sm" })} Enter a number, for example 105,50</span></label>
      <label class="field"><span class="field__label">Disabled</span><input class="input" value="NRDX" disabled></label>
      <label class="field"><span class="field__label">Market</span><select class="select"><option>US</option><option>EU</option><option>Other</option></select></label>
    </div>
    <div class="stack">
      ${label("segmented control")}
      <div class="segmented" role="group" aria-label="Sort by"><button aria-pressed="true">Score</button><button aria-pressed="false">Day change</button><button aria-pressed="false">From high</button><button aria-pressed="false">Name</button></div>
      <div class="segmented" role="group" aria-label="Range"><button aria-pressed="false">1Y</button><button aria-pressed="false">3Y</button><button aria-pressed="true">5Y</button><button aria-pressed="false">10Y</button><button aria-pressed="false" disabled>Max</button></div>
      ${label("toggle")}
      <button class="toggle" role="switch" aria-checked="true" data-toggle><span>Beginner explanations</span><span class="toggle__track"></span></button>
      <button class="toggle" role="switch" aria-checked="false" data-toggle><span>Light theme</span><span class="toggle__track"></span></button>
      <button class="toggle" role="switch" aria-checked="false" disabled><span>Telegram alerts (Phase 2)</span><span class="toggle__track"></span></button>
      ${label("slider")}
      <label class="field"><span class="field__label">Max loss per position: <b id="sl-v" class="num">${fmt.pct(1.5)}</b></span><input class="slider" type="range" min="0.5" max="3" step="0.5" value="1.5" id="sl"></label>
    </div>
  </div>`);

const badges = section("badges", "Score & verdict badges", "Number + word + colour + icon. Tappable badges open the score breakdown.", html`
  ${label("Bottom Score")}<div class="sg-row">
    ${scoreBadge({ score: 0, max_score: 4 })}${scoreBadge({ score: 2, max_score: 4 })}${scoreBadge({ score: 4, max_score: 4, label: "strong" }, { tapId: "NRDX" })}${scoreBadge({ score: 6, max_score: 6 })}
  </div>
  <div class="sg-row">
    ${scoreBadge({ score: 3, max_score: 4, n_na: 1 })}${scoreBadge({ score: 4, max_score: 6, suspect: true })}${scoreBadge({ score: 4, max_score: 4 }, { long: true })}
  </div>
  ${label("pending / error")}<div class="sg-row">${scoreBadge({ score: null })}${scoreBadge({ error: "no price data" })}</div>
  ${label("Top Score (violet family)")}<div class="sg-row">${topBadge({ score: 1, max_score: 6 })}${topBadge({ score: 3, max_score: 6 })}${topBadge({ score: 5, max_score: 6 })}</div>
  ${label("verdict")}<div class="sg-row">${["sale", "check", "trap", "none"].map(verdictBadge)}</div>
  ${label("change")}<div class="sg-row">${changeTag(2.34)}${changeTag(-1.8)}${changeTag(0)}${changeTag(null)}</div>`);

const cards = section("cards", "Stock cards", "Ticker + name (truncated), price + day change + distance from high, sparkline, score badge. States: scored, partial (n/a), suspect, long name, pending, error.", html`
  <ul class="list" style="max-width:520px">${S.map((s, i) => html`<li>${stockCard(i === 0 ? { ...s, top: { score: 3, max_score: 6 }, verdict: "sale" } : i === 1 ? { ...s, verdict: "trap" } : s, { href: "#cards" })}</li>`)}</ul>`);

const sigs = section("signals", "Signal rows", "Plain-language name first, the numbers and threshold below, ⓘ opens the glossary.", html`
  <div class="card" style="max-width:520px"><h3 class="card__title">${t("score.bottom")} ${scoreBadge({ score: 2, max_score: 4, n_na: 1 })}</h3>
    <ul class="signals">${fixtures.signals.map((sg, i) => signalRow(sg, { glossaryKey: gl(["near_200w_ma", "weekly_rsi", "drawdown", "market_fear"][i]) }))}</ul>
  </div>`);

const quality = section("quality", "Quality rows & data table (Phase 2E)", "Good / OK / Weak always as icon + word. Heavier parts say so. Small tables use tabular figures.", html`
  <div class="card" style="max-width:520px"><h3 class="card__title">${t("quality.title")}</h3>
    <ul class="signals">
      ${qualityRow({ name: t("quality.part.piotroski.name"), detail: t("quality.part.piotroski.detail", { f: 8, n: 9 }), state: "good" })}
      ${qualityRow({ name: t("quality.part.debt.name"), detail: t("quality.part.debt.detail", { x: "2,4", cover: "" }), state: "ok", tag: t("quality.heavier") })}
      ${qualityRow({ name: t("quality.part.growth.name"), detail: t("quality.part.growth.shrank", { pct: "6,0 %", years: 3 }), state: "weak" })}
      ${qualityRow({ name: t("quality.part.altman.name"), detail: t("quality.partNa.financial"), state: "na" })}
    </ul>
    <table class="dtable" style="margin-top:var(--space-3)"><thead><tr><th scope="col">${t("quality.colYear")}</th><th scope="col">${t("quality.colRoic")}</th><th scope="col">${t("quality.colGm")}</th></tr></thead>
      <tbody><tr><td>2025</td><td>24,1 %</td><td>61,2 %</td></tr><tr><td>2024</td><td>22,8 %</td><td>60,4 %</td></tr></tbody></table>
  </div>`);

const m = fixtures.market;
const tiles = section("tiles", "Stat tiles & range bar", "Every number with a unit, a sign and context. Range bars show where a value sits in its own history.", html`
  <div class="tiles">
    ${statTile({ label: "S&P 500", value: fmt.num(m.sp500.value, 0), chg: m.sp500.change_pct })}
    ${statTile({ label: "MSCI World", value: fmt.money(m.msci_world.value, "EUR"), chg: m.msci_world.change_pct })}
    ${statTile({ label: "VIX", value: fmt.num(m.vix.value, 1), word: "High fear", wordTone: "warning", context: "Above 30 = fear", glossaryKey: gl("vix") })}
    ${statTile({ label: "Fear & Greed", value: fmt.num(m.fear_greed.value, 0), word: "Extreme fear", wordTone: "negative", glossaryKey: gl("fear_greed") })}
  </div><br>
  <div class="tiles">
    ${statTile({ label: "P/E", value: fmt.num(18.2, 1), context: "Cheaper than 85 % of the last 10 years", trend: [24, 26, 25, 22, 21, 19, 18] })}
    ${statTile({ label: "From 52w high", value: fmt.pct(-38.5), word: "Deep drawdown", wordTone: "warning" })}
    ${statTile({ label: "Market cap", value: fmt.money(48_200_000_000, "USD", { compact: true }) })}
    ${statTile({ label: "Dividend yield", value: t("common.na"), context: "No dividend paid" })}
  </div><br>
  <div class="card" style="max-width:520px">${rangeBar({ min: 14.1, max: 41.7, value: 18.2, caption: "P/E now vs its 10-year range" })}</div>`);

const banners = section("banners", "Banners", "Inline, never blocking. Stale, suspect, offline and error states.", html`
  <div class="stack" style="max-width:620px">
    ${banner({ tone: "warning", title: t("banner.staleTitle", { time: "yesterday 22:47" }), body: t("banner.staleBody"), action: "Health", actionId: "health" })}
    ${banner({ tone: "warning", title: t("banner.suspectTitle"), body: t("banner.suspectBody") })}
    ${banner({ tone: "info", title: t("banner.offlineTitle"), body: t("banner.offlineBody", { time: "14:32" }) })}
    ${banner({ tone: "negative", title: "NRDX is above its 8 % cap.", body: "Don't add more." })}
    ${banner({ tone: "positive", title: "Saved.", body: "Your buy level is set." })}
  </div>`);

const overlays = section("overlays", "Toast, sheet, dialog", "Undo via a toast instead of a confirm dialog. Dialogs only for truly irreversible actions. Sheets slide up on phones and in from the right on desktop.", html`
  <div class="sg-row">
    <button class="btn btn--secondary" id="demo-toast">Show toast</button>
    <button class="btn btn--secondary" id="demo-sheet">Open sheet</button>
    <button class="btn btn--destructive" id="demo-dialog">Open confirm dialog</button>
  </div>
  ${label("static toast")}
  <div class="toast" style="position:static;max-width:440px;animation:none"><span class="toast__msg">${t("toast.removed", { name: "NRDX" })}</span><button class="btn btn--ghost">${t("common.undo")}</button></div>`);

const states = section("states", "Screen states", "Every screen builds all of these, not only the happy path (8.6).", html`
  <div class="sg-two">
    <div>${label("loading (skeleton)")}${skeletonCards(3)}</div>
    <div>${label("empty")}${emptyState({ title: t("state.emptyWatchlistTitle"), body: t("state.emptyWatchlistBody"), action: t("state.emptyWatchlistAction"), actionId: "add" })}</div>
    <div>${label("calm (nothing to do)")}${calmState()}</div>
    <div>${label("error")}${errorState({ detail: "HTTP 503 from database" })}</div>
  </div>`);

const money = section("money", "Portfolio 3C: link cards, month bars, transaction rows", "A whole card links to a detail screen. Month bars always show the amount in text. Transaction rows: kind (icon + word), ticker, quantity × price, amount, date, delete.", html`
  <div class="sg-two">
    <div>${label("link card")}<a class="card card--link" href="#money"><span class="card__title">Returns vs MSCI World</span><span class="small text-2">Since 1 Mar 2024: <b class="num">▲ +24,7 %</b> · MSCI World ▲ +21,0 %</span>${icon("chevron", { cls: "icon card__chevron" })}</a></div>
    <div>${label("month bars")}<ul class="mbars">${[["nov 26", 0], ["dec 26", 62], ["jan 27", 0], ["feb 27", 14]].map(([m, v]) => html`<li class="mbars__row"><span class="mbars__label">${m}</span><span class="mbars__track" aria-hidden="true"><span class="mbars__fill" style="width:${(v / 62) * 100}%"></span></span><span class="mbars__value num">${v ? fmt.money(v, "EUR", { decimals: 0 }) : "—"}</span></li>`)}</ul></div>
    <div>${label("transaction row")}<ul class="list"><li class="card tx"><span class="tx__kind">${icon("plus")} Buy</span><span class="tx__main"><b>NRDX</b><span class="small text-2 num">22 × $ 131,20</span></span><span class="tx__amount num">$ 2.886,40</span><span class="tx__meta small text-2">12 Jun 2025 · costs $ 18,50</span><button type="button" class="icon-btn" aria-label="Delete buy NRDX">${icon("trash")}</button></li></ul></div>
  </div>`);

mount($("#sg"), html`
  <p class="text-2" style="margin-bottom:var(--space-8)">${t("styleguide.intro")} <span class="muted">(${theme} · ${lang()} · ${fmt.getNumberLocale()})</span></p>
  ${colours}${type}${spacing}${icons}${shell}${buttons}${forms}${badges}${cards}${sigs}${quality}${tiles}${banners}${overlays}${states}${money}`);

// ---------------------------------------------------------------- interactions
$$("[data-toggle]").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true"))));
$$(".segmented").forEach((g) => g.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  $$("button", g).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
$("#sl").addEventListener("input", (e) => { $("#sl-v").textContent = fmt.pct(Number(e.target.value)); });
$("#demo-toast").addEventListener("click", () => toast(t("toast.removed", { name: "NRDX" }), { undo: () => toast(t("toast.saved")) }));
$("#demo-sheet").addEventListener("click", () => openSheet({
  title: `${t("score.bottom")} · NRDX`,
  body: html`<p class="text-2" style="margin-bottom:var(--space-3)">Possible bottom: price is 38 % below its high and RSI is oversold.</p><ul class="signals">${fixtures.signals.map((sg) => signalRow(sg))}</ul>`,
}));
$("#demo-dialog").addEventListener("click", () => confirmDialog({
  title: t("dialog.deleteTitle", { name: "NRDX" }), body: t("dialog.deleteBody", { name: "NRDX" }), confirm: t("dialog.deleteAction"),
}));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-glossary]");
  if (g) {
    const entry = glossary[g.dataset.glossary];
    if (entry) openSheet({ title: entry.title, body: html`<div class="stack text-2"><p>${entry.what}</p><p><b>Why it matters:</b> ${entry.why}</p><p><b>How to read it:</b> ${entry.how}</p><p><b>Limitations:</b> ${entry.limits}</p></div>` });
  }
  const bd = e.target.closest("[data-breakdown]");
  if (bd) $("#demo-sheet").click();
  if (e.target.closest('a[href="#cards"]')) e.preventDefault();
});
document.documentElement.dataset.ready = "1";

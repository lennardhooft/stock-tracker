/* Bolero import — docs/screens/portfolio.md ("Bolero import"), CLAUDE.md 13.12.
 * The file is read in the browser (SheetJS, loaded only here) and never uploaded or stored.
 * Only ISIN / name / market go to the lookup function; only ticker, quantity, average price,
 * currency and type are saved. */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { parseBolero } from "../lib/bolero.js";
import { icon } from "../components/icons.js";
import { banner } from "../components/states.js";
import { toast } from "../components/overlays.js";
import { openMfaSetup } from "./more.js";

const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
const TYPES = ["broad_etf", "sector_etf", "bond_etf", "stock", "speculative", "crypto", "other"];
const SYMBOL = /^[A-Z0-9.\-^=]{1,20}$/;
let loading = null;
const loadXlsx = () => (window.XLSX ? Promise.resolve(window.XLSX) : (loading ??= new Promise((res, rej) => {
  const s = document.createElement("script");
  s.src = XLSX_URL;
  s.onload = () => res(window.XLSX);
  s.onerror = () => rej(new Error("SheetJS failed to load"));
  document.head.append(s);
})));

export function renderImport(ctx, main) {
  if (!ctx.mfa?.enabled || ctx.mfa.level !== "aal2" || !ctx.pf) {
    mount(main, html`<div class="state"><span class="state__icon">${icon("wallet")}</span><h2 class="state__title">${t("pf.mfaTitle")}</h2>
      <p class="state__body">${t("pf.mfaBody")}</p>${ctx.mfa?.enabled ? "" : html`<button type="button" class="btn btn--primary" data-mfa-setup>${t("mfa.setup")}</button>`}</div>`);
    $("[data-mfa-setup]", main)?.addEventListener("click", () => openMfaSetup(ctx));
    return { title: t("imp.title"), back: "#/portfolio" };
  }
  mount(main, html`<div style="max-width:720px" class="stack">
    <p class="summary">${t("imp.lead")}</p>
    <details class="card explain"><summary>${t("imp.howTitle")}</summary>
      <ol class="small stack" style="padding-left:1.2em;margin-top:var(--space-2)"><li>${t("imp.how1")}</li><li>${t("imp.how2")}</li><li>${t("imp.how3")}</li></ol>
    </details>
    <button type="button" class="btn btn--primary btn--block" data-choose>${icon("plus")}${t("imp.choose")}</button>
    <input type="file" id="imp-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    <p class="xs muted">${t("imp.privacy")}</p>
    <div id="imp-body" aria-live="polite"></div>
  </div>`);
  $("[data-choose]", main).addEventListener("click", () => $("#imp-file", main).click());
  $("#imp-file", main).addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) readFile(ctx, main, f); });
  return { title: t("imp.title"), back: "#/portfolio" };
}

async function readFile(ctx, main, file) {
  const body = $("#imp-body", main);
  mount(body, html`<div class="stack"><span class="skeleton skeleton--title"></span><span class="skeleton skeleton--text"></span></div>`);
  let parsed;
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    parsed = parseBolero(rows);
  } catch (e) {
    mount(body, banner({ tone: "negative", title: t(e.code === "empty" ? "imp.emptyFile" : e.code === "not_bolero" ? "imp.notBolero" : "imp.readFailed"), body: e.code ? "" : String(e.message || "") }));
    return;
  }
  let lookups = [];
  let lookupFailed = false;
  try {
    lookups = await ctx.api.lookupSymbols(parsed.positions.map((p) => ({ isin: p.isin || undefined, name: p.name, market: p.market })));
  } catch { lookupFailed = true; }
  renderPreview(ctx, main, parsed, lookups, lookupFailed);
}

function renderPreview(ctx, main, parsed, lookups, lookupFailed) {
  const body = $("#imp-body", main);
  const hadImport = (ctx.pf.transactions || []).some((x) => x.source === "import");
  const noIsin = !parsed.positions.some((p) => p.isin);
  mount(body, html`
    <h2 class="section-title" style="margin-top:0">${t("imp.previewTitle", { n: parsed.positions.length })}</h2>
    ${noIsin ? banner({ tone: "info", title: t("imp.noIsinTitle"), body: t("imp.noIsinBody") }) : ""}
    ${lookupFailed ? banner({ tone: "warning", title: t("imp.lookupFailed"), body: "" }) : ""}
    <ul class="list" id="imp-rows">${parsed.positions.map((p, i) => {
      const lk = lookups[i] || {};
      const ticker = lk.best || "";
      return html`<li class="card stack" style="gap:var(--space-2)" data-row="${i}">
        <label class="toggle" style="min-height:44px"><span><b>${p.name}</b><span class="small text-2" style="display:block">${fmt.num(p.qty, Number.isInteger(p.qty) ? 0 : 4)} × ${fmt.money(p.avgPrice, p.currency)} · ${p.market || "—"}${p.isin ? ` · ${p.isin}` : ""}</span></span>
          <input type="checkbox" data-include ${ticker ? "checked" : ""} aria-label="${t("imp.include", { name: p.name })}" style="width:24px;height:24px;flex:none"></label>
        <div class="cluster" style="gap:var(--space-2);align-items:flex-start">
          <label class="field" style="flex:1;min-width:140px"><span class="field__label">${t("imp.ticker")}</span>
            <input class="input" data-ticker list="cand-${i}" value="${ticker}" autocapitalize="characters" autocomplete="off" aria-describedby="hint-${i}">
            <datalist id="cand-${i}">${(lk.candidates || []).map((c) => html`<option value="${c.symbol}">${c.name} · ${c.exchange}</option>`)}</datalist></label>
          <label class="field" style="flex:1;min-width:140px"><span class="field__label">${t("trade.type")}</span>
            <select class="input" data-type>${TYPES.map((k) => html`<option value="${k}" ${k === p.suggested ? "selected" : ""}>${t(`pf.type.${k}`)}</option>`)}</select></label>
        </div>
        <span class="small" id="hint-${i}" style="color:var(--color-${ticker ? "text-2" : "warning"})">${ticker ? t("imp.suggested") : t("imp.checkTicker")}</span>
      </li>`;
    })}</ul>
    ${parsed.cash != null ? html`<label class="toggle card" style="margin-top:var(--space-3)"><span>${t("imp.cash", { amount: fmt.money(parsed.cash, "EUR") })}<span class="setting__hint" style="display:block">${t("imp.cashHint")}</span></span>
      <input type="checkbox" id="imp-cash" checked style="width:24px;height:24px;flex:none"></label>` : ""}
    ${hadImport ? html`<label class="toggle card" style="margin-top:var(--space-3)"><span>${t("imp.replace")}<span class="setting__hint" style="display:block">${t("imp.replaceHint")}</span></span>
      <input type="checkbox" id="imp-replace" checked style="width:24px;height:24px;flex:none"></label>` : ""}
    <p id="imp-msg" class="small" role="status" aria-live="polite" style="margin-top:var(--space-3)"></p>
    <button type="button" class="btn btn--primary btn--block" id="imp-go" style="margin-top:var(--space-2)">${t("imp.go")}</button>`);

  // a filled-in ticker includes the row; an emptied one excludes it
  $("#imp-rows", body).addEventListener("input", (e) => {
    const inp = e.target.closest("[data-ticker]");
    if (!inp) return;
    const li = inp.closest("[data-row]");
    const ok = SYMBOL.test(inp.value.trim().toUpperCase());
    $("[data-include]", li).checked = ok;
    const hint = $(`#hint-${li.dataset.row}`, li);
    hint.textContent = ok ? t("imp.suggested") : t("imp.checkTicker");
    hint.style.color = `var(--color-${ok ? "text-2" : "warning"})`;
  });

  $("#imp-go", body).addEventListener("click", async (e) => {
    const msg = $("#imp-msg", body);
    const picks = [];
    for (const li of $$("[data-row]", body)) {
      if (!$("[data-include]", li).checked) continue;
      const p = parsed.positions[Number(li.dataset.row)];
      const sym = $("[data-ticker]", li).value.trim().toUpperCase();
      if (!SYMBOL.test(sym)) { msg.className = "small field__error"; msg.textContent = t("imp.badTicker", { name: p.name }); $("[data-ticker]", li).focus(); return; }
      if (!(p.avgPrice >= 0)) { msg.className = "small field__error"; msg.textContent = t("imp.noPrice", { name: p.name }); return; }
      picks.push({ p, sym, type: $("[data-type]", li).value });
    }
    const useCash = $("#imp-cash", body)?.checked;
    if (!picks.length && !useCash) { msg.className = "small field__error"; msg.textContent = t("imp.nothing"); return; }
    const btn = e.currentTarget;
    btn.setAttribute("aria-busy", "true");
    try {
      // watchlist: add missing tickers (with their type), update types that changed
      for (const { sym, type } of picks) {
        const w = ctx.rows.find((r) => r.symbol === sym);
        if (!w) {
          const added = await ctx.api.add({ symbol: sym, market: sym.includes(".") ? "EU" : "US", asset_type: type });
          ctx.data.watchlist.push(added);
          ctx.rows.push({ ...added, symbol: sym, wid: added.id });
        } else if ((w.asset_type || w.risk?.suggested_type) !== type) {
          await ctx.api.update(w.wid, { asset_type: type });
        }
      }
      if ($("#imp-replace", body)?.checked) await ctx.api.deleteImported();
      const today = new Date().toISOString().slice(0, 10);
      if (picks.length) {
        await ctx.api.addTransactions(picks.map(({ p, sym }) => ({
          date: today, symbol: sym, kind: "start", quantity: p.qty, price: p.avgPrice, currency: p.currency,
          fees: 0, taxes: 0, source: "import", note: "Bolero position overview",
        })));
      }
      if (useCash) {
        const cur = ctx.pf.settings || {};
        await ctx.api.savePortfolioSettings({ cash: { ...(cur.cash || {}), EUR: parsed.cash }, emergency_fund: cur.emergency_fund || 0, monthly_contribution: cur.monthly_contribution ?? null });
      }
      toast(t("imp.done", { n: picks.length }));
      await ctx.reload({ quiet: true });
      location.hash = "#/portfolio";
    } catch (err) {
      msg.className = "small field__error";
      msg.textContent = t("errors.saveFailed", { reason: err.message || "" });
    } finally {
      btn.removeAttribute("aria-busy");
    }
  });
}

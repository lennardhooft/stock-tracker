/* First-run onboarding — docs/screens/onboarding.md (3 steps, skippable). */
import { html, mount, $, $$ } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import { prefsSet } from "../lib/settings.js";
import { icon } from "../components/icons.js";
import { scoreBadge } from "../components/badges.js";
import { toast } from "../components/overlays.js";
import { KNOWN } from "./watchlist.js";

const EXAMPLES = ["IWDA.AS", "ASML.AS", "AAPL", "MSFT", "ABI.BR", "SAP.DE"];
let step = 0;
const picked = new Set();

function finish(ctx) {
  prefsSet({ onboarded: true });
  step = 0;
  ctx.navigate("#/");
}

export function renderOnboarding(ctx, main) {
  const total = 3;
  const dots = html`<div class="steps" aria-hidden="true">${[0, 1, 2].map((i) => html`<span ${i === step ? html`aria-current="step"` : ""}></span>`)}</div>
    <p class="visually-hidden">${t("welcome.stepOf", { n: step + 1, total })}</p>`;
  const skip = html`<button type="button" class="btn btn--ghost" data-skip>${t("welcome.skip")}</button>`;
  const already = new Set(ctx.rows.map((r) => r.symbol));

  let body;
  if (step === 0) {
    body = html`<h1>${t("welcome.s1Title")}</h1>
      <p class="text-2">${t("welcome.s1Body")}</p>
      <div class="cluster">${scoreBadge({ score: 4, max_score: 4 })}${scoreBadge({ score: 1, max_score: 4 })}</div>
      <button type="button" class="btn btn--primary btn--block" data-next>${t("welcome.next")}</button>`;
  } else if (step === 1) {
    body = html`<h1>${t("welcome.s2Title")}</h1>
      <p class="text-2">${t("welcome.s2Body")}</p>
      <div class="chips" role="group" aria-label="${t("welcome.examples")}">
        ${EXAMPLES.map((s) => {
          const name = KNOWN.find(([k]) => k === s)?.[1] || s;
          const on = already.has(s) || picked.has(s);
          return html`<button type="button" class="chip chip--choice" data-pick="${s}" aria-pressed="${on}" ${already.has(s) ? html`disabled` : ""}>${on ? icon("check") : icon("plus")}${s} <span class="muted">${name}</span></button>`;
        })}
      </div>
      <p class="xs muted">${t("welcome.examplesNote")}</p>
      <p class="field__error" id="ob-err" hidden></p>
      <button type="button" class="btn btn--primary btn--block" data-add ${picked.size ? "" : html`disabled`}>${picked.size ? t("welcome.addThese", { n: picked.size }) : t("welcome.selectFirst")}</button>
      <button type="button" class="btn btn--secondary btn--block" data-next>${already.size ? t("welcome.next") : t("welcome.later")}</button>`;
  } else {
    body = html`<h1>${t("welcome.s3Title")}</h1>
      <ul class="signals">
        ${[[0, "normal"], [2, "watch"], [4, "strong"], [6, "extreme"]].map(([sc, k]) => html`<li class="signal" style="grid-template-columns:auto 1fr" data-state="passed">
          <span>${scoreBadge({ score: sc, max_score: 6 })}</span><span class="signal__detail" style="grid-column:2">${t(`welcome.level.${k}`)}</span></li>`)}
      </ul>
      <p class="text-2">${t("welcome.tapHint")}</p>
      <button type="button" class="btn btn--primary btn--block" data-done>${t("welcome.done")}</button>`;
  }

  mount(main, html`<div class="narrow card stack" style="margin-top:var(--space-4)">${dots}${body}${step === 0 ? html`<div style="text-align:center">${skip}</div>` : ""}</div>`);

  main.addEventListener("click", async (e) => {
    if (e.target.closest("[data-skip]") || e.target.closest("[data-done]")) { finish(ctx); return; }
    if (e.target.closest("[data-next]")) { step += 1; ctx.render(); return; }
    const p = e.target.closest("[data-pick]");
    if (p) {
      picked.has(p.dataset.pick) ? picked.delete(p.dataset.pick) : picked.add(p.dataset.pick);
      ctx.render();
      return;
    }
    const add = e.target.closest("[data-add]");
    if (add) {
      add.setAttribute("aria-busy", "true");
      try {
        for (const s of picked) {
          if (already.has(s)) continue;
          await ctx.api.add({ symbol: s, market: s.includes(".") ? "EU" : "US", name: KNOWN.find(([k]) => k === s)?.[1] || null });
        }
        toast(t(picked.size === 1 ? "welcome.addedOne" : "welcome.addedMany", { n: picked.size }));
        picked.clear();
        await ctx.reload({ quiet: true });
        step = 2;
        ctx.render();
      } catch (err) {
        const el = $("#ob-err", main);
        el.hidden = false;
        el.textContent = t("errors.saveFailed", { reason: err.message });
        add.removeAttribute("aria-busy");
      }
    }
  });
  $$("button", main);
  return { title: t("welcome.title") };
}

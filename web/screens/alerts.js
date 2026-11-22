/* Alerts log — docs/screens/alerts.md. "What did the app tell me, and when?" */
import { html, mount } from "../lib/dom.js";
import { t } from "../lib/i18n.js";
import * as fmt from "../lib/format.js";
import { icon } from "../components/icons.js";
import { emptyState } from "../components/states.js";
import { statusBanners } from "./common.js";

/* icon + colour + word per kind: colour never carries meaning alone (8.0.3) */
const KIND = {
  score_cross: { icon: "trendDown", tone: "--score-strong" },
  buy_level: { icon: "bell", tone: "--color-info" },
  drop: { icon: "trendDown", tone: "--color-negative" },
  rise: { icon: "chevron", tone: "--color-positive" },
  support_test: { icon: "check", tone: "--color-positive" },
  support_break: { icon: "warning", tone: "--color-negative" },
  data_problem: { icon: "warning", tone: "--color-warning" },
  volume_spike: { icon: "info", tone: "--color-info" },
  news: { icon: "info", tone: "--color-info" },
  earnings_7d: { icon: "calendar", tone: "--color-info" },
  earnings_1d: { icon: "calendar", tone: "--color-info" },
};

const TZ = "Europe/Brussels";
const dayKey = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

function dayLabel(key) {
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
  if (key === today) return t("alerts.today");
  if (key === yesterday) return t("alerts.yesterday");
  return fmt.date(`${key}T12:00:00Z`);
}

const clock = (iso) => new Intl.DateTimeFormat(fmt.getNumberLocale(), { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/* the stored title starts with an emoji for Telegram; the app shows its own icon instead */
const cleanTitle = (s) => s.replace(/^[^\p{L}\p{N}]+/u, "");

export function renderAlerts(ctx, main) {
  const list = ctx.data?.alerts || [];
  if (!list.length) {
    mount(main, html`${statusBanners(ctx, { suspect: false })}<div style="max-width:720px">${emptyState({ title: t("alerts.emptyTitle"), body: t("alerts.emptyBody"), iconName: "bell" })}</div>`);
    return { title: t("more.alerts"), back: "#/more" };
  }
  const groups = new Map();
  for (const a of list) {
    const k = dayKey(a.sent_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  mount(main, html`${statusBanners(ctx, { suspect: false })}<div style="max-width:720px">
    ${[...groups].map(([k, items]) => html`
      <h2 class="section-title" ${k === [...groups.keys()][0] ? html`style="margin-top:0"` : ""}>${dayLabel(k)}</h2>
      <ul class="menu">${items.map((a) => {
        const kind = KIND[a.kind] || KIND.data_problem;
        const href = a.symbol && a.symbol !== "_data" ? `#/ticker/${encodeURIComponent(a.symbol)}` : "#/more/health";
        return html`<li><a class="menu__item" href="${href}" style="align-items:flex-start;padding-top:var(--space-3);padding-bottom:var(--space-3)">
          <span style="color:var(${kind.tone});padding-top:2px">${icon(kind.icon)}</span>
          <span class="menu__label">
            <span class="xs" style="color:var(${kind.tone});font-weight:var(--weight-semibold);text-transform:uppercase;letter-spacing:.04em">${t(`alerts.kind.${a.kind}`)}</span>
            <span style="display:block;font-weight:var(--weight-semibold)">${cleanTitle(a.title)}</span>
            <span class="menu__hint" style="white-space:pre-line">${a.body || ""}</span>
            ${a.delivered ? "" : html`<span class="menu__hint" style="color:var(--color-warning)">⚠️ ${t("alerts.notDelivered")}</span>`}
          </span>
          <span class="xs muted num" style="padding-top:2px">${clock(a.sent_at)}</span>
        </a></li>`;
      })}</ul>`)}
  </div>`);
  return { title: t("more.alerts"), back: "#/more" };
}

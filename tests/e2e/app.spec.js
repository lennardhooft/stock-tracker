// App screen checks (CLAUDE.md 8.11 / 8.12) using FAKE fixture data (demo mode).
// - every Phase 1 screen at 375 / 768 / 1280 px in dark and light
// - every state from 8.6 (loading, empty, calm, partial, stale, failed, error, offline, first use)
// - axe-core 0 serious/critical, no horizontal overflow, 44 px tap targets, no untranslated keys
// - task walkthroughs from 8.11.5 with tap counts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const DEMO_CONFIG = "window.APP_CONFIG = { demo: true };";

async function open(page, path, { fixture = "normal", theme = "dark", lang = "en", onboarded = true, width = 375, height = 812, wait = true } = {}) {
  await page.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: DEMO_CONFIG }));
  await page.setViewportSize({ width, height });
  const q = new URLSearchParams({ fixture, theme, lang, onboarded: onboarded ? "1" : "0" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/?${q}${path}`);
  if (wait) await page.waitForFunction(() => document.documentElement.dataset.screen);
  await page.waitForTimeout(250);
  return errors;
}

async function quality(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);

  const rawKeys = await page.evaluate(() => {
    const txt = document.body.innerText;
    return (txt.match(/\b[a-z]+\.[a-zA-Z]+(\.[a-zA-Z0-9]+)*\b/g) || [])
      .filter((k) => /^(common|nav|score|sig|today|attention|watchlist|add|ticker|chart|more|settings|health|welcome|login|banner|state|mood|market|explain|checks|search|glossary|errors|about|time|toast|stock|freshness)\./.test(k));
  });
  expect(rawKeys, `${label}: untranslated i18n keys`).toEqual([]);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, [role=switch], a.btn, a.tabbar__item, a.rail__item, a.menu__item, a.stock, input, select, textarea")]
      .filter((el) => el.offsetParent !== null && !el.closest(".tradingview-widget-container"))
      .map((el) => {
        const after = getComputedStyle(el, "::after");
        const ext = after.content !== "none" && after.position === "absolute" ? Math.max(0, -2 * parseFloat(after.top || "0")) : 0;
        return { tag: el.outerHTML.slice(0, 70), w: el.offsetWidth + ext, h: el.offsetHeight + ext };
      })
      .filter((x) => x.h < 43.5 || x.w < 43.5),
  );
  expect(small, `${label}: tap targets under 44px`).toEqual([]);

  const tabsOverflow = await page.evaluate(() =>
    [...document.querySelectorAll(".tabs")].some((t) => t.scrollWidth > t.clientWidth + 1));
  expect(tabsOverflow, `${label}: in-page tabs wider than the screen`).toBe(false);

  const emptyAria = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-pressed=''], [aria-checked=''], [aria-selected='']")].map((e) => e.outerHTML.slice(0, 60)));
  expect(emptyAria, `${label}: empty aria state`).toEqual([]);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .exclude(".tradingview-widget-container").analyze();
  const serious = axe.violations.filter((v) => ["serious", "critical"].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(serious, `${label}: axe serious/critical`).toEqual([]);
}

const shot = (page, name) => page.screenshot({ path: `docs/screenshots/app-${name}.png`, fullPage: true });

/* ------------------------------------------------------------ screens × widths × themes */
const SCREENS = [
  ["today", "#/"],
  ["watchlist", "#/watchlist"],
  ["ticker", "#/ticker/NRDX"],
  ["more", "#/more"],
  ["settings", "#/more/settings"],
  ["health", "#/more/health"],
  ["alerts", "#/more/alerts"],
];

for (const theme of ["dark", "light"]) {
  for (const width of [375, 768, 1280]) {
    for (const [name, path] of SCREENS) {
      test(`${name} ${theme} ${width}`, async ({ page }) => {
        const errors = await open(page, path, { theme, width });
        expect(errors).toEqual([]);
        await quality(page, `${name} ${theme} ${width}`);
        await shot(page, `${name}-${theme}-${width}`);
      });
    }
  }
}

/* ------------------------------------------------------------ states (8.6) */
const STATES = [
  ["empty", "#/", "empty"],
  ["empty-watchlist", "#/watchlist", "empty"],
  ["empty-alerts", "#/more/alerts", "empty"],
  ["calm", "#/", "calm"],
  ["partial", "#/", "partial"],
  ["stale", "#/", "stale"],
  ["failed", "#/", "failed"],
  ["offline", "#/", "offline"],
  ["error", "#/", "error"],
  ["pending-ticker", "#/ticker/KESL.DE", "normal"],
  ["error-ticker", "#/ticker/ZZQX", "normal"],
  ["not-on-list", "#/ticker/ABCD", "normal"],
];
for (const [name, path, fixture] of STATES) {
  test(`state ${name}`, async ({ page }) => {
    const errors = await open(page, path, { fixture });
    expect(errors).toEqual([]);
    await quality(page, `state ${name}`);
    await shot(page, `state-${name}`);
  });
}

test("state loading shows skeletons", async ({ page }) => {
  await open(page, "#/", { fixture: "loading", wait: false });
  await expect(page.locator(".skeleton").first()).toBeVisible();
  await shot(page, "state-loading");
});

test("login screen", async ({ page }) => {
  await open(page, "#/", { fixture: "login" });
  await expect(page.locator("#tabbar")).toBeHidden();
  await quality(page, "login");
  await page.fill("#login-email", "not-an-email");
  await page.click("button[type=submit]");
  await expect(page.locator("#login-msg")).toHaveClass(/field__error/);
  await shot(page, "login");
});

test("onboarding 3 steps, each fits a 375x667 screen", async ({ page }) => {
  await open(page, "#/", { fixture: "new", onboarded: false, height: 667 });
  await expect(page).toHaveURL(/#\/welcome/);
  for (let step = 1; step <= 3; step += 1) {
    await quality(page, `welcome ${step}`);
    const fits = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
    expect(fits, `welcome step ${step} fits without scrolling`).toBe(true);
    await shot(page, `welcome-${step}`);
    if (step === 2) {
      await page.click('[data-pick="IWDA.AS"]');
      await page.click("[data-add]");
      await expect(page.locator(".steps [aria-current=step]")).toBeVisible();
    } else if (step === 1) {
      await page.click("[data-next]");
    }
  }
  await page.click("[data-done]");
  await expect(page.locator("html")).toHaveAttribute("data-screen", "today");
  await expect(page.locator(".attention", { hasText: "IWDA.AS is waiting for its first score" })).toBeVisible();
});

test("Dutch: no missing translations on main screens", async ({ page }) => {
  for (const [name, path] of SCREENS) {
    await open(page, path, { lang: "nl" });
    await quality(page, `nl ${name}`);
  }
  await expect(page.locator("#tabbar")).toContainText("Volglijst");
});

/* ------------------------------------------------------------ task walkthroughs (8.11.5) */
test("task: Today answers 'anything worth my attention?' above the fold on a small phone", async ({ page }) => {
  await open(page, "#/", { width: 375, height: 667 });
  const summary = page.locator(".summary");
  const firstAction = page.locator(".attention__action").first();
  await expect(summary).toBeInViewport();
  await expect(firstAction).toBeInViewport();
});

test("task: why does NRDX have its score — ≤ 2 taps from Today", async ({ page }) => {
  await open(page, "#/");
  await page.getByRole("link", { name: "Research NRDX" }).click();                   // tap 1
  await expect(page.locator("section.card").first().locator(".signal")).toHaveCount(6);
  await expect(page.locator(".signal__detail").first()).toContainText("200-week average");
});

test("task: add a stock — ≤ 4 taps, invalid input cannot be saved", async ({ page }) => {
  await open(page, "#/");
  await page.locator("#tabbar").getByText("Watchlist").click();                       // tap 1
  await page.getByRole("button", { name: "Add stock" }).click();                      // tap 2
  const input = page.locator('input[name="q"]');
  await input.fill("NOT VALID!");
  await page.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("as");
  await page.locator('[data-pick="ASML.AS"]').click();                                // tap 3
  await page.getByRole("button", { name: "Add to watchlist" }).click();               // tap 4
  await expect(page.locator(".toast")).toContainText("ASML.AS");
  await expect(page.locator(".stock__ticker", { hasText: "ASML.AS" })).toBeVisible();
});

test("task: remove a stock and undo", async ({ page }) => {
  await open(page, "#/watchlist");
  await page.locator('[data-quick="ORCA"]').click();
  await page.getByRole("button", { name: "Remove from watchlist" }).click();
  await expect(page.locator(".stock__ticker", { hasText: "ORCA" })).toHaveCount(0);
  await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".stock__ticker", { hasText: "ORCA" })).toBeVisible();
});

test("task: set a buy level with inline validation", async ({ page }) => {
  await open(page, "#/ticker/ORCA");
  await page.getByRole("button", { name: "Set buy level" }).click();
  const input = page.locator('input[name="buy"]');
  await input.fill("abc");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("300,50");
  await page.getByRole("button", { name: "Save buy level" }).click();
  await expect(page.locator(".toast")).toContainText("Saved");
});

test("chart tab: candles, levels, score panel, text summary, remembered toggles", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator("#panel")).toHaveAttribute("data-chart", "ready", { timeout: 15000 });
  await expect(page.locator("#chart canvas").first()).toBeVisible();
  await expect(page.locator("#score-panel canvas").first()).toBeVisible();
  await expect(page.locator("#chart-summary")).toContainText("200-week average");
  await expect(page.locator("#chart-summary")).toContainText("Support at");
  await page.getByRole("button", { name: "10Y" }).click();
  await quality(page, "chart");
  await shot(page, "ticker-chart-dark-375");
  // toggles are remembered on this device
  await page.locator('[data-show="zones"]').click();
  await expect(page.locator('[data-show="zones"]')).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.screen);
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator('[data-show="zones"]')).toHaveAttribute("aria-pressed", "false");
});

test("overview: nearest support & resistance in words", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  const card = page.locator("#levels-card");
  await expect(card).not.toHaveAttribute("aria-busy", "true");
  await expect(card).toContainText("Support at");
  await expect(card).toContainText("Resistance at");
  await expect(card).toContainText("chart");
  await quality(page, "levels card");
});

test("chart: failed load shows a retry, not a blank box", async ({ page }) => {
  await open(page, "#/ticker/NRDX", { fixture: "nochart" });
  await expect(page.locator("#levels-card")).toContainText("couldn't be loaded");
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator("#panel")).toHaveAttribute("data-chart", "failed");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await quality(page, "chart failed");
});

test("deep link + back keeps the list scroll position", async ({ page }) => {
  await open(page, "#/watchlist", { height: 500 });
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  await page.locator(".stock", { hasText: "WORLD.AS" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "ticker/WORLD.AS");
  await page.goBack();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "watchlist");
  await page.waitForTimeout(150);
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(300);
});

test("search: '/' opens search, typing filters, unknown offers to add", async ({ page }) => {
  await open(page, "#/", { width: 1280 });
  await page.keyboard.press("/");
  await page.fill("#search-q", "orca");
  await expect(page.locator("#search-results")).toContainText("ORCA");
  await page.fill("#search-q", "zzzz");
  await expect(page.locator("#search-results")).toContainText("Add ZZZZ");
});

test("settings: theme and language apply instantly", async ({ page }) => {
  await open(page, "#/more/settings");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Nederlands" }).click();
  await expect(page.locator("#tabbar")).toContainText("Volglijst");
});

test("alerts page: grouped by day, kind as word + icon, tap opens the stock", async ({ page }) => {
  await open(page, "#/more/alerts");
  await expect(page.locator(".section-title").first()).toHaveText("Today");
  await expect(page.getByText("Bottom signals", { exact: true })).toBeVisible();
  await expect(page.getByText("not delivered to Telegram", { exact: false })).toBeVisible();
  await page.getByText("NRDX: 4/4 bottom signals").click();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "ticker/NRDX");
});

test("fundamentals tab: valuation vs history and insider trades (US)", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "Fundamentals" }).click();
  await expect(page.locator("#panel")).toContainText("cheaper than 88");
  await expect(page.locator("#panel")).toContainText("Insiders bought");
  await expect(page.locator("#panel")).toContainText("Jane Ortega");
  await quality(page, "fundamentals");
  await shot(page, "ticker-fundamentals-dark-375");
});

test("fundamentals tab: EU stock says why insiders are n/a and that history is short", async ({ page }) => {
  await open(page, "#/ticker/BLMT.BR");
  await page.getByRole("tab", { name: "Fundamentals" }).click();
  await expect(page.locator("#panel")).toContainText("no free insider data for EU stocks");
  await expect(page.locator("#panel")).toContainText("only 3,6 years");
  await quality(page, "fundamentals eu");
});

test("news tab: earnings countdown and headlines open in a new tab", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#panel")).toContainText("Next earnings");
  await expect(page.locator('#panel a[target="_blank"]').first()).toHaveAttribute("rel", /noopener/);
  await quality(page, "news");
  await shot(page, "ticker-news-dark-375");
});

test("why is it down: latest headline under a big drop", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await expect(page.locator("#why-down")).toContainText("Why is it down?");
  await expect(page.locator("#why-down")).toContainText("cuts full-year guidance");
});

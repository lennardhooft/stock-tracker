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
      .filter((k) => /^(common|nav|score|sig|today|attention|watchlist|add|ticker|chart|more|settings|health|welcome|login|banner|state|mood|market|explain|checks|search|glossary|errors|about|time|toast|stock|freshness|quality|top|verdict|verdictLine|verdictFilter|fund|news|levels|tags|cal|pf|cib|risk|trade|mfa|imp|risk3)\./.test(k));
  });
  expect(rawKeys, `${label}: untranslated i18n keys`).toEqual([]);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, [role=switch], a.btn, a.tabbar__item, a.rail__item, a.menu__item, a.stock, input, select, textarea")]
      .filter((el) => el.offsetParent !== null && !el.closest(".tradingview-widget-container"))
      .map((el) => {
        // a checkbox inside a <label>: the whole label is the tap target (WCAG 2.5.8)
        const lab = el.matches("input[type=checkbox], input[type=radio]") ? el.closest("label") : null;
        if (lab) return { tag: el.outerHTML.slice(0, 70), w: lab.offsetWidth, h: lab.offsetHeight };
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
  ["ticker-trap", "#/ticker/HALD"],
  ["ticker-hot", "#/ticker/ORCA"],
  ["calendar", "#/calendar"],
  ["portfolio", "#/portfolio"],
  ["canibuy", "#/canibuy/VLTA.AS"],
  ["risk", "#/more/risk"],
  ["import", "#/import"],
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
  ["empty-calendar", "#/calendar", "empty"],
  ["portfolio-no-mfa", "#/portfolio", "nomfa"],
  ["portfolio-empty", "#/portfolio", "noportfolio"],
  ["mfa-code", "#/", "mfa"],
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

test("login with email + password (works in the home-screen app)", async ({ page }) => {
  await open(page, "#/", { fixture: "login" });
  await expect(page.locator("#tabbar")).toBeHidden();
  await expect(page.locator("#login-password")).toHaveAttribute("autocomplete", "current-password");
  await quality(page, "login");
  await page.fill("#login-email", "not-an-email");
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("#login-msg")).toHaveClass(/field__error/);
  await page.fill("#login-email", "owner@example.com");
  await page.fill("#login-password", "wrong-password");
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("#login-msg")).toContainText("wrong");
  await shot(page, "login");
  await page.fill("#login-password", "correct-horse-battery");
  await page.click("#login-form button[type=submit]");
  await expect(page.locator("html")).toHaveAttribute("data-screen", "today");  // logged in, in this app
});

test("settings: set a password with validation", async ({ page }) => {
  await open(page, "#/more/settings");
  await page.fill('input[name="pw1"]', "short");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("#pw-msg")).toContainText("at least 12");
  await page.fill('input[name="pw1"]', "a-long-enough-password");
  await page.fill('input[name="pw2"]', "a-different-password!!");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("#pw-msg")).toContainText("don't match");
  await page.fill('input[name="pw2"]', "a-long-enough-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("#pw-msg")).toContainText("Password saved");
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
  await expect(page.locator("#panel-score canvas").first()).toBeVisible();
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

test("update now: starts the job and refreshes when scores arrive", async ({ page }) => {
  await open(page, "#/more/health");
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.locator(".toast").first()).toContainText("Update started");
  await expect(page.locator(".toast", { hasText: "Scores updated" })).toBeVisible({ timeout: 5000 });
});

test("adding a stock offers to score it now", async ({ page }) => {
  await open(page, "#/watchlist");
  await page.getByRole("button", { name: "Add stock" }).click();
  await page.locator('input[name="q"]').fill("SAP.DE");
  await page.getByRole("button", { name: "Add to watchlist" }).click();
  await expect(page.locator(".toast").getByRole("button", { name: "Score now" })).toBeVisible();
});

/* ------------------------------------------------------------ Phase 2E: quality, verdict, Top Score */
test("verdict: quality on sale leads the score card and the Today card", async ({ page }) => {
  await open(page, "#/");
  await expect(page.locator(".list").first()).toContainText("Quality on sale: 6 of 6 bottom signals and a quality score of 96 / 100.");
  await open(page, "#/ticker/NRDX");
  await expect(page.locator("#verdict-line .verdict--sale")).toHaveText("Quality on sale");
});

test("verdict: value trap names the weakest parts", async ({ page }) => {
  await open(page, "#/ticker/HALD");
  await expect(page.locator("#verdict-line .verdict--trap")).toBeVisible();
  await expect(page.locator("#main")).toContainText("Possible value trap: cheap, but quality is weak (14 / 100): bankruptcy risk and high debt.");
  await page.getByRole("tab", { name: "Fundamentals" }).click();
  await expect(page.locator("#quality-card")).toContainText("Low");
  await expect(page.locator('#quality-card .signal[data-state="weak"]').first()).toBeVisible();
  await quality(page, "quality trap");
  await shot(page, "ticker-quality-trap-dark-375");
});

test("quality card: score, moat, parts with ⓘ, ROIC by year", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "Fundamentals" }).click();
  const card = page.locator("#quality-card");
  await expect(card).toContainText("96 / 100");
  await expect(card).toContainText("Wide");
  await expect(card.locator(".signal")).toHaveCount(8);
  await expect(card).toContainText("counts 1.5×");
  await expect(card.locator(".dtable tbody tr")).toHaveCount(5);
  await card.locator("[data-glossary=moat]").first().click();
  await expect(page.locator(".sheet")).toContainText("Moat (ROIC)");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheet[open]")).toHaveCount(0);
  for (const theme of ["dark", "light"]) {
    for (const width of [375, 768, 1280]) {
      await open(page, "#/ticker/NRDX", { theme, width });
      await page.getByRole("tab", { name: "Fundamentals" }).click();
      await expect(page.locator("#quality-card .signal").first()).toBeVisible();
      await quality(page, `quality ${theme} ${width}`);
      await shot(page, `ticker-quality-${theme}-${width}`);
    }
  }
});

test("quality: ETF says why there is no score", async ({ page }) => {
  await open(page, "#/ticker/WORLD.AS");
  await page.getByRole("tab", { name: "Fundamentals" }).click();
  await expect(page.locator("#quality-card")).toContainText("an ETF holds many companies");
  await quality(page, "quality etf");
});

test("top score: hot stock shows the badge and the overheating signs, calm stock doesn't", async ({ page }) => {
  await open(page, "#/ticker/ORCA");
  await expect(page.locator("#verdict-line .badge--top-trim")).toBeVisible();
  await expect(page.locator("#top-card")).toContainText("4 of 6 overheating signs");
  await expect(page.locator("#top-card")).toContainText("Never a sell signal");
  await expect(page.locator("#top-card .signal")).toHaveCount(6);
  await shot(page, "ticker-top-dark-375");
  await open(page, "#/ticker/NRDX");
  await expect(page.locator("#top-card")).toContainText("No signs of overheating.");
  await expect(page.locator("#verdict-line .badge--top-trim, #verdict-line .badge--top-hot")).toHaveCount(0);
});

test("watchlist: verdict badges only on bottoms, verdict filter", async ({ page }) => {
  await open(page, "#/watchlist");
  await expect(page.locator(".stock__verdict")).toHaveCount(2);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.locator('[data-verdict="trap"]').click();
  await page.locator("[data-done]").click();
  await expect(page.locator(".stock__ticker")).toHaveText(["HALD"]);
  await expect(page.locator('[data-clear="verdict"]')).toContainText("Possible value trap");
  await quality(page, "watchlist verdict filter");
  await page.locator('[data-clear="verdict"]').click();
  await expect(page.locator(".stock__ticker").first()).toBeVisible();
});

test("quality texts in Dutch", async ({ page }) => {
  await open(page, "#/ticker/HALD", { lang: "nl" });
  await expect(page.locator("#main")).toContainText("Mogelijke waardeval");
  await page.getByRole("tab", { name: "Cijfers" }).click();
  await expect(page.locator("#quality-card")).toContainText("Kwaliteit van het bedrijf");
  await quality(page, "quality nl");
});

/* ------------------------------------------------------------ Phase 2F: tags + chart upgrades */
test("tags: add on the notes tab, show on the card, filter by tag", async ({ page }) => {
  await open(page, "#/ticker/NEWCO");
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.locator('[data-tag="speculative"]').click();
  await page.fill("#tag-new", "bad tag!!");
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.locator("#tag-msg")).toHaveClass(/field__error/);
  await page.fill("#tag-new", "Turnaround");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-tag="turnaround"]')).toHaveAttribute("aria-pressed", "true");
  await quality(page, "tags editor");
  await shot(page, "ticker-tags-dark-375");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast").first()).toBeVisible();
  await page.evaluate(() => { location.hash = "#/watchlist"; });
  await expect(page.locator(".stock", { hasText: "NEWCO" }).locator(".stock__tags")).toHaveText("speculative · turnaround");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.locator('[data-tag="wait-for-dip"]').click();
  await page.locator("[data-done]").click();
  await expect(page.locator(".stock__ticker")).toHaveText(["HALD", "BLMT.BR"]);
  await expect(page.locator('[data-clear-tag="wait-for-dip"]')).toBeVisible();
  await page.locator('[data-clear-tag="wait-for-dip"]').click();
  await expect(page.locator('[data-clear-tag]')).toHaveCount(0);
});

test("chart: info line, panels on/off (remembered), cheap/expensive levels", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator("#panel")).toHaveAttribute("data-chart", "ready");
  await expect(page.locator("#chart-info")).toContainText("below its high");
  await expect(page.locator("#chart-info")).toContainText("RSI");
  await expect(page.locator('[data-panel-wrap="score"]')).toBeVisible();
  await expect(page.locator('[data-panel-wrap="rsi"]')).toBeVisible();
  await expect(page.locator('[data-panel-wrap="volume"]')).toBeHidden();
  await page.locator('[data-panel="drawdown"]').click();
  await expect(page.locator('[data-panel-wrap="drawdown"]')).toBeVisible();
  await expect(page.locator("#chart-summary")).toContainText("cheap vs its own history below");
  await expect(page.locator("#val-toggle")).toBeVisible();
  await quality(page, "chart panels");
  await shot(page, "ticker-chart-panels-dark-375");
  await page.locator('[data-years="0"]').click();
  await expect(page.locator('[data-years="0"]')).toHaveAttribute("aria-pressed", "true");
  // remembered on this device
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.screen);
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator('[data-panel-wrap="drawdown"]')).toBeVisible();
});

test("chart: EU stock without valuation history hides the cheap/expensive toggle", async ({ page }) => {
  await open(page, "#/ticker/WORLD.AS");
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator("#panel")).toHaveAttribute("data-chart", "ready");
  await expect(page.locator("#val-toggle")).toBeHidden();
});

test("chart math: RSI, drawdown and forward returns", async ({ page }) => {
  await open(page, "#/");
  const r = await page.evaluate(async () => {
    const m = await import("/components/chart.js");
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    return {
      rsiUp: m.rsiWilder(up)[19],
      rsiFirst: m.rsiWilder(up)[13],
      dd: m.drawdownSeries([10, 12, 11, 9], [10, 12, 11, 9]).map((x) => Math.round(x)),
      fwd: m.forwardReturn([100, 110, 121], 0, 2),
      future: m.forwardReturn([100, 110], 0, 5),
      starts: m.runStarts([1, 4, 5, 2, 4], 4),
    };
  });
  expect(r.rsiUp).toBe(100);
  expect(r.rsiFirst).toBeNull(); // needs 14 changes
  expect(r.dd).toEqual([0, 0, -8, -25]);
  expect(r.fwd).toBeCloseTo(21, 5);
  expect(r.future).toBeNull();
  expect(r.starts).toEqual([1, 4]);
});

/* ------------------------------------------------------------ Phase 2G: calendar + earnings history */
test("calendar: grouped by week, filter remembered, stock rows open the ticker", async ({ page }) => {
  await open(page, "#/calendar");
  await expect(page.locator(".summary")).toContainText("next 7 days");
  await expect(page.locator("#main")).toContainText("Fed rate decision");
  await expect(page.locator("#main")).toContainText("tentative");
  await page.locator('[data-filter="dividends"]').click();
  await expect(page.locator('[data-filter="dividends"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#main .menu li", { hasText: "Fed rate decision" })).toHaveCount(0);
  await expect(page.locator("#main .menu").first()).toContainText("BLMT.BR goes ex-dividend");
  await quality(page, "calendar filtered");
  await shot(page, "calendar-dividends-dark-375");
  await page.locator('[data-filter="all"]').click();
  await page.getByRole("link", { name: /NRDX reports earnings/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "ticker/NRDX");
});

test("calendar: subscribe makes a private link (webcal + copy) and can renew it", async ({ page }) => {
  await open(page, "#/calendar");
  await page.getByRole("button", { name: "Subscribe in my phone calendar" }).click();
  await page.getByRole("button", { name: "Create my calendar link" }).click();
  await expect(page.locator("#sub-open")).toHaveAttribute("href", /^webcal:\/\/.+calendar-ics\?token=/);
  await expect(page.locator("#sub-url")).toHaveValue(/^https:\/\/.+calendar-ics\?token=/);
  await quality(page, "subscribe sheet");
  await shot(page, "calendar-subscribe-dark-375");
});

test("today: coming up in the next 7 days links to the calendar", async ({ page }) => {
  await open(page, "#/");
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await page.getByRole("link", { name: "See calendar" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "calendar");
});

test("news tab: earnings reaction history and next dividend", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "News" }).click();
  const h = page.locator("#history-card");
  await expect(h).toContainText("typically moves ±");
  await expect(h.locator("tbody tr")).toHaveCount(8);
  await expect(h.locator(".beat").first()).toContainText("beat");
  await quality(page, "earnings history");
  await shot(page, "ticker-earnings-history-dark-375");
  await open(page, "#/ticker/BLMT.BR");
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#dividend-card")).toContainText("Ex-dividend");
  await expect(page.locator("#dividend-card")).toContainText("€ 0,62");
  await open(page, "#/ticker/WORLD.AS");
  await page.getByRole("tab", { name: "News" }).click();
  await expect(page.locator("#history-card")).toContainText("ETFs have none");
});

test("calendar in Dutch", async ({ page }) => {
  await open(page, "#/calendar", { lang: "nl" });
  await expect(page.locator("#main")).toContainText("Rentebeslissing Fed");
  await quality(page, "calendar nl");
});

/* ------------------------------------------------------------ Phase 3A: portfolio, sizing, two-step login */
test("two-step login: wrong code is refused, right code opens the portfolio", async ({ page }) => {
  await open(page, "#/portfolio", { fixture: "mfa" });
  await expect(page.locator("html")).toHaveAttribute("data-screen", "mfa");
  await expect(page.locator("#mfa-code")).toHaveAttribute("autocomplete", "one-time-code");
  await page.fill("#mfa-code", "111111");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#mfa-msg")).toContainText("didn't work");
  await shot(page, "mfa-code");
  await page.fill("#mfa-code", "123456");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator(".summary")).toContainText("Portfolio €");
});

test("two-step login: set up from the portfolio gate (QR + code)", async ({ page }) => {
  await open(page, "#/portfolio", { fixture: "nomfa" });
  await expect(page.locator("#main")).toContainText("Set up two-step login first");
  await page.getByRole("button", { name: "Set up two-step login" }).click();
  await expect(page.locator("dialog[open] img")).toBeVisible();
  await expect(page.locator("#mfa-secret")).toHaveValue(/[A-Z2-7]{16}/);
  await quality(page, "mfa setup");
  await shot(page, "mfa-setup");
  await page.fill("#mfa-new-code", "123456");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.locator(".toast").first()).toContainText("Two-step login is on");
  await expect(page.locator(".summary")).toContainText("Portfolio €");
});

test("portfolio: value, warnings with the rule, risk budget, holdings, allocation", async ({ page }) => {
  await open(page, "#/portfolio");
  await expect(page.locator(".summary")).toContainText("Portfolio €");
  await expect(page.locator("#main")).toContainText("ORCA is 8,7 % of your portfolio, above the 8,0 % cap.");
  await expect(page.locator(".budget")).toHaveCount(4);
  await expect(page.locator(".list .stock")).toHaveCount(5);
  await expect(page.locator(".alloc")).toHaveCount(4);
  await expect(page.locator("#main")).toContainText("not financial advice");
});

test("add trade: validation in Belgian format, sell more than owned is refused, undo", async ({ page }) => {
  await open(page, "#/portfolio");
  await page.getByRole("button", { name: "Add trade" }).click();
  await page.locator('[data-kind="sell"]').click();
  await page.fill('input[name="symbol"]', "HALD");
  await page.fill('input[name="quantity"]', "500");
  await page.fill('input[name="price"]', "8,42");
  await page.getByRole("button", { name: "Save trade" }).click();
  await expect(page.locator("#trade-msg")).toContainText("You own 120 shares");
  await page.locator('[data-kind="start"]').click();
  await page.fill('input[name="symbol"]', "VLTA.AS");
  await page.fill('input[name="quantity"]', "1");
  await page.fill('input[name="price"]', "1.150,00");
  await quality(page, "trade sheet");
  await shot(page, "trade-sheet");
  await page.getByRole("button", { name: "Save trade" }).click();
  await expect(page.locator(".toast").first()).toContainText("VLTA.AS saved");
  await expect(page.locator(".list .stock")).toHaveCount(6);
});

test("can I buy this: the answer first, limiting rule, check an amount, how it's calculated, staged plan", async ({ page }) => {
  await open(page, "#/canibuy/VLTA.AS");
  await expect(page.locator(".answer")).toContainText("Up to €");
  await expect(page.locator("#cib-answer")).toContainText("Limited by:");
  await page.fill("#cib-amount", "2.000");
  await expect(page.locator("#cib-check")).toContainText("more than your rules allow");
  await page.fill("#cib-amount", "100");
  await expect(page.locator("#cib-check")).toContainText("fits your rules");
  await page.getByText("How is this calculated?").click();
  await expect(page.locator("details.explain")).toContainText("max loss per position");
  await expect(page.locator("#cib-plan .signal")).toHaveCount(3);
  await quality(page, "can I buy");
  await shot(page, "canibuy-dark-375");
  await open(page, "#/canibuy/NRDX");
  await expect(page.locator(".answer")).toHaveText("No room to add");
  await expect(page.locator("#cib-answer")).toContainText("already above this rule's max");
});

test("can I buy this: ≤ 3 taps from a ticker page", async ({ page }) => {
  await open(page, "#/ticker/VLTA.AS");
  await page.getByRole("link", { name: "Can I buy this?" }).click(); // tap 1
  await page.fill("#cib-amount", "300");                             // tap 2 (type)
  await expect(page.locator("#cib-check")).toContainText("fits");
});

test("risk settings: profile changes the preview, invalid numbers are refused, saving works", async ({ page }) => {
  await open(page, "#/more/risk");
  const before = await page.locator("#risk-preview").textContent();
  await page.locator('[data-profile="aggressive"]').click();
  await expect(page.locator("#risk-preview")).not.toHaveText(before);
  await page.fill('[data-key="risk_per_position"]', "9");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("#risk-msg")).toContainText("between");
  await page.fill('[data-key="risk_per_position"]', "2,0");
  await expect(page.locator('[data-profile="custom"]')).toHaveAttribute("aria-pressed", "true");
  await quality(page, "risk settings");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast").first()).toContainText("Saved");
});

test("portfolio in Dutch", async ({ page }) => {
  await open(page, "#/portfolio", { lang: "nl" });
  await expect(page.locator(".summary")).toContainText("Portefeuille");
  await quality(page, "portfolio nl");
});

/* ------------------------------------------------------------ Phase 3B: live prices, risk check, chart trades */
test("portfolio: live prices, moves together, stress test, concentration", async ({ page }) => {
  await open(page, "#/portfolio");
  await expect(page.locator("#live-state")).toContainText("live prices");
  const card = page.locator("#risk-card");
  await expect(card).toContainText("ORCA, NRDX move together");
  await expect(card.locator(".signal")).toHaveCount(3);
  await expect(card).toContainText("2008 crisis: −€");
  await expect(card).toContainText("Largest position: WORLD.AS");
  await quality(page, "risk card");
  await shot(page, "portfolio-risk-dark-375");
});

test("can I buy this: a stock that moves with your holdings gets × 0,7", async ({ page }) => {
  await open(page, "#/canibuy/NEWCO"); // NEWCO correlates 0,83 with NRDX (fixture)
  await page.getByText("How is this calculated?").click();
  await expect(page.locator("details.explain")).toContainText("moves with what you own");
});

test("chart: your trades and average cost on the ticker chart", async ({ page }) => {
  await open(page, "#/ticker/NRDX");
  await page.getByRole("tab", { name: "Chart" }).click();
  await expect(page.locator("#panel")).toHaveAttribute("data-chart", "ready");
  await shot(page, "ticker-chart-trades-dark-375");
});

/* ------------------------------------------------------------ Bolero import (FAKE file) */
test("bolero import: parse in the browser, match tickers, fix one by hand, import", async ({ page }) => {
  await open(page, "#/import");
  await expect(page.locator(".summary")).toContainText("Bring your Bolero positions in");
  await page.setInputFiles("#imp-file", "tests/fixtures/bolero_positions_FAKE.xlsx");
  await expect(page.locator("[data-row]")).toHaveCount(3, { timeout: 15000 });
  const rows = page.locator("[data-row]");
  await expect(rows.nth(0).locator("[data-ticker]")).toHaveValue("NRDX");
  await expect(rows.nth(1).locator("[data-ticker]")).toHaveValue("WORLD.AS");
  await expect(rows.nth(1).locator("[data-type]")).toHaveValue("broad_etf");
  await expect(rows.nth(2).locator("[data-include]")).not.toBeChecked(); // no match → not included
  await expect(rows.nth(2)).toContainText("Check the ticker");
  await expect(rows.nth(1)).toContainText("Yahoo: Global Index Tracker ETF · AMS · EUR");
  await expect(rows.nth(1)).toContainText("The names differ");
  // a ticker Yahoo has no prices for is flagged and left out
  await rows.nth(2).locator("[data-ticker]").fill("NOSUCH.XX");
  await expect(rows.nth(2)).toContainText("Yahoo has no prices for NOSUCH.XX");
  await expect(rows.nth(2).locator("[data-include]")).not.toBeChecked();
  // a ticker typed by hand (not a suggestion) is checked for prices on Yahoo
  await rows.nth(2).locator("[data-ticker]").fill("ORCA");
  await expect(rows.nth(2)).toContainText("ORCA: prices found");
  await expect(rows.nth(2).locator("[data-include]")).toBeChecked();
  // one of the row's own suggestions: shows Yahoo's name right away
  await rows.nth(2).locator("[data-ticker]").fill("NEWCO");
  await expect(rows.nth(2)).toContainText("Yahoo: Newly Listed Co · NYQ · USD");
  await expect(rows.nth(2).locator("[data-include]")).toBeChecked();
  await expect(page.locator("#imp-cash")).toBeChecked();
  await quality(page, "import preview");
  await shot(page, "import-preview-dark-375");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-screen", "portfolio");
  await expect(page.locator(".toast").first()).toContainText("3 positions imported");
  // EUR cash from the file (1.234,56) + the existing USD cash (400 USD ≈ € 345) is kept
  await expect(page.locator(".summary__meta")).toContainText("cash € 1.579");
});

test("bolero import: a file that isn't a position overview is refused", async ({ page }) => {
  await open(page, "#/import");
  await page.setInputFiles("#imp-file", { name: "other.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("not a spreadsheet") });
  await expect(page.locator("#imp-body")).toContainText(/isn't a Bolero position overview|Couldn't read this file/);
});

test("empty portfolio: import from Bolero is the main action", async ({ page }) => {
  await open(page, "#/portfolio", { fixture: "noportfolio" });
  const imp = page.getByRole("link", { name: "Import from Bolero" });
  await expect(imp).toBeVisible();
  await expect(page.getByRole("button", { name: "Add your first position" })).toBeVisible();
  await imp.click();
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.getByRole("button", { name: "Choose the Excel file" })).toBeVisible();
});

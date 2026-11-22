// Style guide checks (CLAUDE.md 8.11): screenshots at 375 / 768 / 1280 px in dark and light,
// axe-core accessibility scan (0 serious/critical), no horizontal overflow, 44 px tap targets.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WIDTHS = [375, 768, 1280];
const THEMES = ["dark", "light"];

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`styleguide ${theme} ${width}px`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/styleguide.html?theme=${theme}`);
      await page.waitForSelector("html[data-ready='1']");
      expect(errors, "JavaScript errors").toEqual([]);

      // no horizontal scrolling at any width
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);

      // interactive elements are at least 44x44 px (8.0.6), except inline text links
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, [role=switch], a.btn, a.tabbar__item, a.rail__item, input, select")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => {
            const r = { width: el.offsetWidth, height: el.offsetHeight }; // ignores tap-shrink transform
            const after = getComputedStyle(el, "::after");
            // an absolutely positioned ::after with negative inset extends the tap area
            const ext = after.content !== "none" && after.position === "absolute" ? -2 * parseFloat(after.top || "0") : 0;
            return { tag: el.outerHTML.slice(0, 80), w: r.width + Math.max(0, ext), h: r.height + Math.max(0, ext) };
          })
          .filter((x) => x.h < 43.5 || (x.w < 43.5 && !x.tag.startsWith("<input"))),
      );
      expect(small, "tap targets under 44px").toEqual([]);

      await page.screenshot({ path: `docs/screenshots/styleguide-${theme}-${width}.png`, fullPage: true });

      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = axe.violations
        .filter((v) => ["serious", "critical"].includes(v.impact))
        .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(serious, "axe serious/critical violations").toEqual([]);
    });
  }
}

test("styleguide Dutch + interactions", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/styleguide.html?lang=nl");
  await page.waitForSelector("html[data-ready='1']");
  await expect(page.locator("#tabbar")).toContainText("Volglijst");

  await page.click("#demo-sheet");
  await expect(page.locator("dialog.sheet[open]")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/styleguide-sheet-375.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog.sheet")).toHaveCount(0);

  await page.click("#demo-toast");
  await expect(page.locator(".toast-region .toast")).toBeVisible();
});

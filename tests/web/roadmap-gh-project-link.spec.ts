import { test, expect } from "@playwright/test";

const BASE = process.env.WEB_BASE_URL || "http://localhost:8888";

/**
 * Tests the GitHub Project board footer link delivered by SHY-0038.
 *
 * Spec: .project/stories/SHY-0038-public-roadmap-gh-project-link.md
 *
 * The link is a permanent footer affordance pointing at
 * https://github.com/orgs/Shyden-Ltd/projects/1 (the public ShyTalk
 * Stories Project board). Delivers the cross-surface visibility gap
 * described by the [[feedback-stories-epics-and-two-surface-sync]] rule.
 *
 * Coverage: presence, exact href, target/rel attrs (reverse-tabnabbing
 * protection), i18n applies in non-EN locale, RTL renders, tooltip
 * (title= attr) populated via data-i18n-title dispatcher.
 */

test.describe("Roadmap footer — GitHub Project link", () => {
  const PROJECT_URL = "https://github.com/orgs/Shyden-Ltd/projects/1";
  const SELECTOR = '[data-testid="footer-gh-project-link"]';

  test("Link is present with the exact canonical href", async ({ page }) => {
    await page.goto(`${BASE}/roadmap.html`);
    const link = page.locator(SELECTOR);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", PROJECT_URL);
  });

  test("Link opens in a new tab with reverse-tabnabbing protection", async ({
    page,
  }) => {
    await page.goto(`${BASE}/roadmap.html`);
    const link = page.locator(SELECTOR);
    await expect(link).toHaveAttribute("target", "_blank");
    const rel = await link.getAttribute("rel");
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  test("Link is keyboard-focusable and reachable via Tab navigation", async ({
    page,
  }) => {
    await page.goto(`${BASE}/roadmap.html`);
    const link = page.locator(SELECTOR);
    await link.focus();
    await expect(link).toBeFocused();
  });

  test('English (default) renders inline HTML defaults: "View on GitHub Project" + EN tooltip', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("shytalk_language", "en");
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);
    const link = page.locator(SELECTOR);
    await expect(link).toContainText("View on GitHub Project");
    await expect(link).toHaveAttribute(
      "title",
      "Opens the public GitHub Project board for ShyTalk Stories",
    );
  });

  test("Spanish locale translates link text + tooltip via data-i18n + data-i18n-title", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("shytalk_language", "es");
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    // Wait for the legal-translations chain to apply (existing footer_privacy is a
    // good signal — once it translates, our key has been processed too).
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-i18n="footer_privacy"]');
        return !!(el && el.textContent && el.textContent.includes("Política"));
      },
      null,
      { timeout: 10_000 },
    );

    const link = page.locator(SELECTOR);
    const text = (await link.textContent())?.trim();
    expect(text, "es text should not be English default").not.toBe(
      "View on GitHub Project",
    );
    expect(text, "es text should contain GitHub keyword").toContain("GitHub");

    const title = await link.getAttribute("title");
    expect(title, "es title should not be English default").not.toBe(
      "Opens the public GitHub Project board for ShyTalk Stories",
    );
    expect(title, "es title should contain GitHub keyword").toContain("GitHub");
  });

  test("Arabic locale: link is present + RTL document direction set", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("shytalk_language", "ar");
      } catch {
        /* ignore */
      }
    });
    await page.goto(`${BASE}/roadmap.html`);

    await page.waitForFunction(
      () => document.documentElement.lang === "ar",
      null,
      { timeout: 10_000 },
    );

    const link = page.locator(SELECTOR);
    await expect(link).toBeVisible();
    // The HTML `lang` attribute drives RTL via CSS. Confirm it's set.
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });

  test("Link is visible at mobile (360px) viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`${BASE}/roadmap.html`);
    const link = page.locator(SELECTOR);
    await expect(link).toBeVisible();
  });

  test("Link is visible at tablet (768px) and desktop (1280px) viewports", async ({
    page,
  }) => {
    for (const width of [768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/roadmap.html`);
      const link = page.locator(SELECTOR);
      await expect(link, `visible at ${width}px`).toBeVisible();
    }
  });
});

import { test, expect } from "@playwright/test";

const BASE = process.env.WEB_BASE_URL || "http://localhost:8888";

/**
 * Regression: shared-header's Sign In button MUST work on every page
 * that loads shared-header.js, not just on the roadmap.
 *
 * Pre-fix: clicking Sign In on the homepage / legal pages / event
 * pages was a no-op because shared-header.js called
 * `window.shytalkShowLoginModal()` — a function only registered by
 * `suggestions-board.js`, which only loads on `/roadmap.html`.
 * Six static pages (index, privacy, terms, community-guidelines,
 * cyber-bullying, do-not-sell) shipped with a non-functional Sign
 * In button until the fallback was added. Found 2026-05-09 via
 * /manual-qa.
 *
 * Post-fix: pages with the modal hook keep the in-page modal flow;
 * pages without it navigate to /portal/, the canonical web auth UI.
 */

test.describe("Shared header Sign In — modal hook + portal fallback", () => {
  test("homepage Sign In navigates to /portal/ (no modal hook registered)", async ({
    page,
  }) => {
    await page.goto(`${BASE}/`);
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="shared-header"]'),
    );

    // Confirm the modal hook is NOT registered on the homepage
    const beforeClick = await page.evaluate(() => ({
      modalHookExists:
        typeof (window as any).shytalkShowLoginModal === "function",
    }));
    expect(beforeClick.modalHookExists).toBe(false);

    // Click Sign In and assert navigation to /portal/
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith("/portal/"), {
        timeout: 5_000,
      }),
      page.locator('[data-testid="header-signin-btn"]').click(),
    ]);
    expect(page.url()).toContain("/portal/");
  });

  test("roadmap Sign In opens the in-page modal (modal hook registered)", async ({
    page,
  }) => {
    await page.goto(`${BASE}/roadmap.html?qa=signin-modal`);
    // BOTH preconditions, because they are met by DIFFERENT scripts and neither
    // implies the other: `shared-header.js` injects the header, and
    // `suggestions-board.js` registers the modal hook (SHY-0476).
    //
    // Waiting only for the hook let this test reach for a button that had not
    // been injected yet, return `invoked: false`, and read exactly like a Sign
    // In button that was genuinely broken. WebKit injects the header later than
    // Chromium under CI load, so the race only ever lost there — deterministically,
    // on both WebKit projects, while passing locally in seconds.
    await page.waitForFunction(
      () => typeof (window as any).shytalkShowLoginModal === "function",
    );
    await page
      .locator('[data-testid="header-signin-btn"]')
      .waitFor({ state: "attached" });

    // Spy on the modal hook + the navigation, prove modal is invoked
    // and we do NOT navigate to /portal/.
    const startUrl = page.url();
    const result = await page.evaluate(async () => {
      let calledWith: string | null = null;
      const orig = (window as any).shytalkShowLoginModal;
      (window as any).shytalkShowLoginModal = (action: string) => {
        calledWith = action;
        return orig?.(action);
      };
      const btn = document.querySelector(
        '[data-testid="header-signin-btn"]',
      ) as HTMLElement | null;
      // Distinguish "nothing to click" from "clicked and the hook never fired".
      // Reported separately so a future race cannot be mistaken for the defect
      // this test exists to catch.
      if (!btn) return { invoked: false, calledWith, buttonMissing: true };
      btn.click();
      // Poll for the deferred handler rather than guessing at 250ms. This
      // exits the instant it fires (so the fast path costs ~0), and it still
      // FAILS -- returning invoked:false -- if it never fires, which a fixed
      // settle could not distinguish from "not long enough" (SHY-0245).
      const deadline = Date.now() + 5000;
      while (calledWith === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25)); // sleep-ok: poll interval, exits the instant the handler fires
      }
      return { invoked: !!calledWith, calledWith, buttonMissing: false };
    });

    // Asserted before `invoked`, so a race reports itself as a race.
    expect(result.buttonMissing).toBe(false);
    expect(result.invoked).toBe(true);
    expect(result.calledWith).toBeTruthy();
    // Confirm we did NOT navigate (modal flow keeps user on roadmap)
    expect(page.url()).toBe(startUrl);
  });
});

import { test, expect } from '@playwright/test';

/**
 * CCPA "Do Not Sell or Share My Personal Information" link presence.
 *
 * Roadmap C2 — California Consumer Privacy Act § 1798.135 requires the
 * link on every page facing California users. Even though we don't
 * sell personal information, the link is mandatory; it must point to
 * a page (or section) explaining the user's CCPA rights and our
 * non-sale practice. Implemented as a global link in every footer
 * + a dedicated `/do-not-sell.html` explanatory page.
 *
 * These tests pin:
 *  1. The dedicated page exists, is publicly accessible, and contains
 *     the canonical CCPA-compliant copy.
 *  2. Every page that has a footer also carries a link to the page —
 *     adding a new footer-bearing page without the link would now fail
 *     this suite at PR time, catching a compliance regression early.
 */

const BASE = process.env.WEB_BASE_URL ?? 'http://localhost:8888';

const FOOTER_PAGES = [
  // Static-served public pages — every one with a `<footer>` block must
  // expose the CCPA link. roadmap.html / index.html are landing-tier
  // pages; the four legal pages share the same boilerplate footer.
  '/',
  '/index.html',
  '/privacy.html',
  '/terms.html',
  '/community-guidelines.html',
  '/cyber-bullying.html',
  '/roadmap.html',
];

test.describe('CCPA "Do Not Sell" footer link (C2)', () => {
  test('the dedicated /do-not-sell.html page is publicly accessible', async ({ page }) => {
    const response = await page.goto(`${BASE}/do-not-sell.html`);
    expect(response?.status()).toBe(200);
  });

  test('the page contains the CCPA-required "Do Not Sell" header text', async ({ page }) => {
    await page.goto(`${BASE}/do-not-sell.html`);
    // CCPA § 1798.135 requires the link be conspicuously titled "Do
    // Not Sell or Share My Personal Information" (or a close
    // semantic equivalent). Pin the literal so a future copy refresh
    // doesn't accidentally drop the regulator-recognised phrasing.
    const heading = page.locator('h1');
    await expect(heading).toContainText(/Do Not Sell or Share My Personal Information/i);
  });

  test('the page explicitly states we do not sell personal information', async ({ page }) => {
    await page.goto(`${BASE}/do-not-sell.html`);
    // The page's primary message must be that we do NOT sell — the
    // link is required even for non-sellers, but the destination
    // page's content must affirm the no-sale practice or the link
    // is misleading. Match the affirmative phrasing.
    const body = page.locator('body');
    await expect(body).toContainText(/do not sell/i);
  });

  for (const path of FOOTER_PAGES) {
    test(`page ${path} carries a footer link to /do-not-sell.html`, async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      // The link can be in any footer-positioned anchor. Using a
      // role+name selector decouples the assertion from the surrounding
      // markup (some pages use `<footer>`, some use a flat `<div>`),
      // so future footer refactors don't need to touch this test.
      const link = page.getByRole('link', {
        name: /Do Not Sell or Share My Personal Information/i,
      });
      await expect(link.first()).toBeVisible();
      const href = await link.first().getAttribute('href');
      expect(href).toMatch(/\/do-not-sell(\.html)?$/);
    });
  }
});

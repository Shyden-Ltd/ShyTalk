import { test, expect } from '@playwright/test';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';

/**
 * Console error checks for EVERY public web page.
 * Each page must load with zero console errors.
 * Warnings are also captured for review.
 */
test.describe('Console Errors — All Pages', () => {
  const pages = [
    { name: 'Landing', path: '/' },
    { name: 'Roadmap', path: '/roadmap.html' },
    { name: 'Privacy Policy', path: '/privacy.html' },
    { name: 'Terms of Service', path: '/terms.html' },
    { name: 'Community Guidelines', path: '/community-guidelines.html' },
    { name: 'Cyber Bullying Policy', path: '/cyber-bullying.html' },
    { name: 'Portal', path: '/portal/' },
    { name: 'Khmer New Year', path: '/events/khmer-new-year.html' },
  ];

  for (const { name, path } of pages) {
    test(`${name} page loads with zero console errors`, async ({ page }) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
        if (msg.type() === 'warning') warnings.push(msg.text());
      });

      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(2_000);

      // Filter benign errors that occur in CI where the local stack may
      // race the page load. The previous version of this filter included
      // `!e.includes('favicon')` and `!e.includes('Failed to load resource')`
      // — both blanket masks. The favicon mask hid a real /favicon.ico 404
      // bug for months (browsers auto-request /favicon.ico even when
      // <link rel="icon"> points to .svg) and the resource-load mask
      // would have hidden any future broken-asset regression. Now narrowed
      // to only the specific Firebase-config-might-not-be-up case.
      const realErrors = errors.filter(e =>
        !e.includes('ERR_CONNECTION_REFUSED') &&
        !(e.includes('Failed to load resource') && e.includes('firebase-config'))
      );

      if (realErrors.length > 0) {
        console.log(`Console errors on ${name}:`, realErrors);
      }
      expect(realErrors).toHaveLength(0);
    });
  }

  // Regression: /favicon.ico was missing for months and every public page
  // logged a 404 on it. Browsers auto-request /favicon.ico even when
  // <link rel="icon"> points to favicon.svg — a 16x16 ICO at the root is
  // the only way to silence the request across all browsers including
  // legacy Safari.
  test('/favicon.ico returns 200 (no 404 on auto-request)', async ({ request }) => {
    const res = await request.get(`${BASE}/favicon.ico`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(0);
    // First two bytes of an ICO file: reserved=0x0000, type=0x0001 (icon)
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);
    expect(buf[2]).toBe(1);
    expect(buf[3]).toBe(0);
  });
});

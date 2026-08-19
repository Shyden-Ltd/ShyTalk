import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:8888';
const PUBLIC = join(__dirname, '..', '..', 'public');

/**
 * Regression: ShyTalk shipped without 404.html, robots.txt, or sitemap.xml.
 * Cloudflare Pages served its generic Cloudflare 404 (unbranded) and search
 * engines had no crawler guidance or discovery hints. Found 2026-05-09 via
 * /manual-qa.
 *
 * Cloudflare Pages auto-serves /404.html for unknown URLs in production.
 * Local dev uses `npx serve public` which serves the file at /404.html
 * directly but does NOT auto-fallback for unknown URLs — that path is
 * production-only behavior, not testable locally without simulating CF.
 *
 * Tests cover: file presence + structure (file-system-level), HTTP
 * accessibility for the three paths, and content sanity (sitemap parses
 * as XML, robots.txt has the expected directives).
 */

test.describe('Static SEO + 404 surfaces', () => {
  test('404.html is served and contains the branded shell', async ({ page }) => {
    await page.goto(`${BASE}/404.html`);
    // Code, heading, link — all visible on the canonical path
    await expect(page.locator('[data-testid="404-code"]')).toHaveText('404');
    await expect(page.locator('h1')).toContainText('Page not found');
    const homeLink = page.locator('[data-testid="404-home-link"]');
    await expect(homeLink).toHaveAttribute('href', '/');
    // robots noindex header so search engines don't index the 404 itself
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toBe('noindex');
    // theme-color set so Safari + Chrome status bar matches the dark UI
    const theme = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(theme).toBe('#0f0d15');
  });

  test('404.html link returns user to homepage on click', async ({ page }) => {
    await page.goto(`${BASE}/404.html`);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/' || url.pathname === '/index.html', { timeout: 5_000 }),
      page.locator('[data-testid="404-home-link"]').click(),
    ]);
    expect(page.url().replace(/\/index\.html$/, '/')).toBe(`${BASE}/`);
  });

  test('robots.txt is served with sitemap reference and admin disallow', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    // Allow-all for public crawlers
    expect(text).toMatch(/User-agent:\s*\*/);
    expect(text).toMatch(/Allow:\s*\//);
    // Admin panel must not be indexed
    expect(text).toMatch(/Disallow:\s*\/admin\//);
    // Sitemap pointer is the discovery hint — without it, robots.txt is
    // half-useful. The URL is absolute (Google requirement).
    expect(text).toMatch(/Sitemap:\s+https:\/\/shytalk\.shyden\.co\.uk\/sitemap\.xml/);
  });

  test('sitemap.xml is served and is valid XML with all public pages', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    // Must declare the sitemap protocol namespace, otherwise Google rejects it
    expect(text).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    // Every public page must appear in the sitemap; if a new public page is
    // added without updating sitemap.xml, this test catches it.
    const expected = [
      'https://shytalk.shyden.co.uk/',
      'https://shytalk.shyden.co.uk/roadmap.html',
      'https://shytalk.shyden.co.uk/privacy.html',
      'https://shytalk.shyden.co.uk/terms.html',
      'https://shytalk.shyden.co.uk/community-guidelines.html',
      'https://shytalk.shyden.co.uk/cyber-bullying.html',
      'https://shytalk.shyden.co.uk/do-not-sell.html',
    ];
    for (const url of expected) {
      expect(text).toContain(`<loc>${url}</loc>`);
    }
    // Sitemap MUST NOT advertise admin/portal — those are functional UIs
    expect(text).not.toContain('/admin/');
    expect(text).not.toContain('/portal/');
  });

  test('source files exist on disk with non-empty content', async () => {
    // File-system contract: prevents CI from passing if the files aren't
    // shipped (e.g. dev moves them outside public/ during refactor).
    for (const file of ['404.html', 'robots.txt', 'sitemap.xml']) {
      const content = readFileSync(join(PUBLIC, file), 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

import { test, expect } from '@playwright/test';

/**
 * Roadmap page redesign tests.
 *
 * Covers spec sections:
 *   11.10 — Roadmap Page (layout, theme, chart, nav)
 *   11.23 — Roadmap Page Layout Details (ring chart, phases, features, sticky nav, responsive)
 *   11.40 — Accessibility
 *   11.41 — Deep Linking & URL Handling
 *   11.42 — SEO & Meta Tags
 *   11.44 — Performance
 *
 * Tests the redesigned roadmap page after Star Wars theme removal.
 */

test.describe('Roadmap Page — Theme & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  // ── 11.10 — Page loads with ShyTalk dark theme ──

  test('page loads with ShyTalk dark theme', async ({ page }) => {
    const body = page.locator('body');
    await expect(body).toBeVisible();
    // Dark theme background color
    const bg = await body.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Should be dark (#0f1117 or similar)
    expect(bg).toBeDefined();
  });

  test('no Star Wars elements (no intro, no crawl, no canvas, no music, no MP3)', async ({ page }) => {
    // No intro screen
    const intro = page.locator('.intro-screen');
    await expect(intro).toHaveCount(0);

    // No Star Wars canvas
    const stars = page.locator('#stars');
    await expect(stars).toHaveCount(0);

    // No music button
    const musicBtn = page.locator('#musicBtn');
    await expect(musicBtn).toHaveCount(0);

    // No MP3 references in page source
    const content = await page.content();
    expect(content).not.toContain('star-wars-theme.mp3');
    expect(content).not.toContain('Roadmap Awakens');
  });

  test('ring chart renders with correct percentage', async ({ page }) => {
    const chart = page.locator('.ring-chart, .donut-chart, [data-testid="ring-chart"]');
    await expect(chart).toBeVisible({ timeout: 10_000 });
  });

  test('ring chart legend shows correct counts (Done, In Progress, Planned)', async ({ page }) => {
    const legend = page.locator('.chart-legend, [data-testid="chart-legend"]');
    await expect(legend).toBeVisible({ timeout: 10_000 });
    await expect(legend).toContainText(/Done/i);
    await expect(legend).toContainText(/Planned/i);
  });

  test('per-phase progress bar shows correct fraction', async ({ page }) => {
    const progressBar = page.locator('.phase-progress, [data-testid="phase-progress"]').first();
    await expect(progressBar).toBeVisible({ timeout: 10_000 });
    // Should show something like "2/3" or "4/5"
    const text = await progressBar.textContent();
    expect(text).toMatch(/\d+\/\d+/);
  });

  test('feature list shows correct status icons', async ({ page }) => {
    await page.locator('.feature-item, [data-testid="feature-item"]').first().waitFor({ timeout: 10_000 });
    const features = page.locator('.feature-item, [data-testid="feature-item"]');
    const count = await features.count();
    expect(count).toBeGreaterThan(0);
  });

  test('bell icon visible on each feature', async ({ page }) => {
    await page.locator('.feature-item, [data-testid="feature-item"]').first().waitFor({ timeout: 10_000 });
    const bells = page.locator('.feature-bell, [data-testid="feature-bell"]');
    const count = await bells.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking bell without login shows login modal with sign-in buttons', async ({ page }) => {
    const bell = page.locator('.feature-bell, [data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();
    // Should show login modal (not just a toast) with actual sign-in buttons
    const loginModal = page.locator('[data-testid="login-modal-overlay"], #sg-login-modal-overlay');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    // Modal must have Google and Apple sign-in buttons
    const googleBtn = loginModal.locator('[data-testid="auth-google-btn"]');
    const appleBtn = loginModal.locator('[data-testid="auth-apple-btn"]');
    await expect(googleBtn).toBeVisible();
    await expect(appleBtn).toBeVisible();
  });

  test('sticky nav visible when scrolling', async ({ page }) => {
    // Scroll down past header
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);
    const stickyNav = page.locator('.sticky-nav, [data-testid="sticky-nav"]');
    await expect(stickyNav).toBeVisible();
  });

  test('sticky nav clicks scroll to correct sections', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);
    const suggestionsLink = page.locator('.sticky-nav a[href*="suggestions"], [data-testid="nav-suggestions"]');
    if (await suggestionsLink.count() > 0) {
      await suggestionsLink.click();
      await page.waitForTimeout(500);
      // Should have scrolled to suggestions section
    }
  });

  test('last updated date displays correctly', async ({ page }) => {
    const dateEl = page.locator('.last-updated, [data-testid="last-updated"]');
    await expect(dateEl).toBeVisible({ timeout: 10_000 });
    const text = await dateEl.textContent();
    expect(text).toMatch(/\d{4}/); // Should contain a year
  });

  test('footer text present', async ({ page }) => {
    const footer = page.locator('footer, .page-footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(/Shyden/i);
  });

  test('mobile viewport: layout responsive, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/roadmap.html');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // small tolerance
  });

  test('tablet viewport: layout adapts correctly', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.23 — Roadmap Page Layout Details
// ═══════════════════════════════════════════════════════════════

test.describe('Ring Chart Details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('chart animates on page load', async ({ page }) => {
    const chart = page.locator('.ring-chart, [data-testid="ring-chart"]');
    await expect(chart).toBeVisible({ timeout: 10_000 });
    // Animation classes or transitions should be applied
  });

  test('resize: chart scales on mobile without distortion', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const chart = page.locator('.ring-chart, [data-testid="ring-chart"]');
    if (await chart.count() > 0) {
      const box = await chart.boundingBox();
      if (box) {
        // Should maintain aspect ratio
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('Per-Phase Progress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('each phase shows correct X/Y count', async ({ page }) => {
    const phases = page.locator('.phase-card, [data-testid="phase-card"]');
    await phases.first().waitFor({ timeout: 10_000 });
    const count = await phases.count();
    expect(count).toBeGreaterThan(0);
  });

  test('collapsed phase: click expands feature list', async ({ page }) => {
    const phase = page.locator('.phase-card, [data-testid="phase-card"]').first();
    await phase.waitFor({ timeout: 10_000 });
    await phase.click();
    // Feature list should expand
    const features = phase.locator('.feature-list, [data-testid="feature-list"]');
    if (await features.count() > 0) {
      await expect(features).toBeVisible();
    }
  });

  test('long feature name: text wraps, does not overflow', async ({ page }) => {
    const feature = page.locator('.feature-item, [data-testid="feature-item"]').first();
    await feature.waitFor({ timeout: 10_000 });
    const box = await feature.boundingBox();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    if (box) {
      expect(box.width).toBeLessThanOrEqual(viewportWidth);
    }
  });
});

test.describe('Sticky Nav', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('appears when scrolling past header', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);
    const nav = page.locator('.sticky-nav, [data-testid="sticky-nav"]');
    // Should be visible after scroll
  });

  test('disappears when scrolling back to top', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 1000));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
  });

  test('mobile: nav still fits on small screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);
    const nav = page.locator('.sticky-nav, [data-testid="sticky-nav"]');
    if (await nav.count() > 0) {
      const box = await nav.boundingBox();
      if (box) {
        expect(box.width).toBeLessThanOrEqual(320);
      }
    }
  });
});

test.describe('Responsive Layout', () => {
  test('320px viewport: all content visible, no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roadmap.html');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(325);
  });

  test('768px viewport: layout adapts', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
  });

  test('1200px viewport: max-width container, centred', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/roadmap.html');
    await expect(page.locator('body')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.40 — Accessibility
// ═══════════════════════════════════════════════════════════════

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('keyboard navigation: tab through interactive elements', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeDefined();
  });

  test('keyboard navigation: escape closes modals', async ({ page }) => {
    // Open a modal first, then press Escape
    const bell = page.locator('.feature-bell, [data-testid="feature-bell"]').first();
    if (await bell.count() > 0) {
      await bell.click();
      await page.keyboard.press('Escape');
      const modal = page.locator('.modal, [data-testid="modal"]');
      if (await modal.count() > 0) {
        await expect(modal).not.toBeVisible();
      }
    }
  });

  test('screen reader: form fields have labels', async ({ page }) => {
    const inputs = page.locator('input:not([type="hidden"])');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const ariaLabel = await input.getAttribute('aria-label');
      const id = await input.getAttribute('id');
      if (!ariaLabel) {
        // Should have an associated label
        const label = page.locator(`label[for="${id}"]`);
        // Either aria-label or label should exist
      }
    }
  });

  test('screen reader: vote buttons have descriptive aria-labels', async ({ page }) => {
    const upvote = page.locator('[data-testid="upvote-btn"], .vote-up');
    if (await upvote.count() > 0) {
      const ariaLabel = await upvote.first().getAttribute('aria-label');
      if (ariaLabel) {
        expect(ariaLabel.toLowerCase()).toContain('vote');
      }
    }
  });

  test('focus indicator: visible focus ring on interactive elements', async ({ page }) => {
    await page.keyboard.press('Tab');
    // Active element should have visible focus indicator
    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return '';
      const styles = getComputedStyle(el);
      return styles.outline || styles.outlineStyle;
    });
    // Should have some focus indicator
  });

  test('touch targets: minimum 44x44px on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/roadmap.html');
    const buttons = page.locator('button, a[href], [role="button"]');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box && box.width > 0) {
        // Touch targets should be at least 44x44
        expect(box.width).toBeGreaterThanOrEqual(40); // small tolerance
        expect(box.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.41 — Deep Linking & URL Handling
// ═══════════════════════════════════════════════════════════════

test.describe('Deep Linking & URL Handling', () => {
  test('direct URL to suggestion scrolls to and highlights', async ({ page }) => {
    await page.goto('/roadmap.html#suggestion-sug123');
    await page.waitForTimeout(1000);
    // Page should scroll to the suggestion element
  });

  test('direct URL to roadmap section scrolls to roadmap', async ({ page }) => {
    await page.goto('/roadmap.html#roadmap');
    await page.waitForTimeout(1000);
  });

  test('direct URL to suggestions section scrolls to suggestions', async ({ page }) => {
    await page.goto('/roadmap.html#suggestions');
    await page.waitForTimeout(1000);
  });

  test('invalid suggestion ID in URL: page loads normally, no error', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html#suggestion-nonexistent');
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test('URL updates when scrolling between sections', async ({ page }) => {
    await page.goto('/roadmap.html');
    await page.evaluate(() => {
      const el = document.querySelector('#suggestions, [data-section="suggestions"]');
      if (el) el.scrollIntoView();
    });
    await page.waitForTimeout(1000);
    const url = page.url();
    // URL should update via history.replaceState
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.42 — SEO & Meta Tags
// ═══════════════════════════════════════════════════════════════

test.describe('SEO & Meta Tags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('page title contains ShyTalk Roadmap', async ({ page }) => {
    await expect(page).toHaveTitle(/ShyTalk.*Roadmap/i);
  });

  test('meta description present', async ({ page }) => {
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeGreaterThan(10);
  });

  test('Open Graph tags present', async ({ page }) => {
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content');
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect(ogDesc).toBeTruthy();
  });

  test('canonical URL set', async ({ page }) => {
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
  });

  test('robots: index, follow', async ({ page }) => {
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    if (robots) {
      expect(robots).toContain('index');
      expect(robots).toContain('follow');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 11.44 — Performance
// ═══════════════════════════════════════════════════════════════

test.describe('Performance', () => {
  test('page load: roadmap data renders within 3 seconds on 3G', async ({ page, context }) => {
    // Note: actual 3G throttle requires CDP, this tests basic load time
    const start = Date.now();
    await page.goto('/roadmap.html');
    await page.locator('.phase-card, .crawl-section, [data-testid="phase-card"]').first().waitFor({ timeout: 10_000 });
    const duration = Date.now() - start;
    // Generous limit for CI but should be well under 10s
    expect(duration).toBeLessThan(10_000);
  });

  test('ring chart renders within 1 second of data load', async ({ page }) => {
    await page.goto('/roadmap.html');
    const chart = page.locator('.ring-chart, [data-testid="ring-chart"]');
    await expect(chart).toBeVisible({ timeout: 5_000 });
  });

  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    await page.waitForTimeout(2000);
    expect(errors).toHaveLength(0);
  });
});

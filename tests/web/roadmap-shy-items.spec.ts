import { test, expect, Page } from '@playwright/test';

/**
 * SHY-0061: roadmap renderer reads SHY-derived `phases[].items[]`.
 *
 * Until this story, roadmap-app.js consumed only the legacy
 * `phases[].features[]` — items synced from story files (SHY-0038)
 * rendered nowhere. These tests pin the new behaviour with a
 * `page.route` fixture so counts are deterministic and independent
 * of the live roadmap-data.json:
 *   - items render inside their phase with a shyId badge chip
 *   - item statuses are normalised (sync emits "In Progress"/"Done"
 *     title case; the renderer's switch expects lowercase-hyphenated)
 *   - in-progress items lift into the top In Progress section
 *   - progress math includes items in numerator + denominator
 *   - a phase with ONLY items still renders (line-575 guard extension)
 *   - a phases entry with no `items` key renders unchanged, no errors
 *   - the badge aria-label is translated (storyBadge LABELS key)
 */

const FIXTURE = {
  _meta: { schemaVersion: 2, generatedAt: '2026-06-09T23:00:00.000Z' },
  lastUpdated: '2026-06-09',
  currentlyWorkingOn: [],
  phases: [
    {
      title: 'Safety & Compliance',
      titleI18n: {},
      status: 'in-progress',
      progress: 50,
      features: [
        { name: 'Legacy done feature', status: 'done', i18n: {} },
        { name: 'Legacy planned feature', status: 'planned', i18n: {} },
      ],
      items: [
        {
          shyId: 'SHY-0060',
          name: 'Age-gating per feature',
          status: 'In Progress',
          description: null,
          i18n: {},
        },
        {
          shyId: 'SHY-0099',
          name: 'Imaginary shipped story',
          status: 'Done',
          description: null,
          i18n: {},
        },
      ],
    },
    {
      title: 'Items Only Phase',
      titleI18n: {},
      status: 'in-progress',
      progress: 100,
      features: [],
      items: [
        {
          shyId: 'SHY-0101',
          name: 'All items phase entry',
          status: 'Done',
          description: null,
          i18n: {},
        },
      ],
    },
    {
      title: 'Legacy Only Phase',
      titleI18n: {},
      status: 'planned',
      progress: 0,
      features: [{ name: 'Old style feature', status: 'planned', i18n: {} }],
      // no `items` key at all — schemaVersion-1-shaped entry
    },
  ],
};

async function gotoWithFixture(page: Page, fixture: unknown = FIXTURE) {
  const consoleErrors: string[] = [];
  // Network-layer noise from the page's Express-API calls (localhost:3000)
  // when running against a bare static server is environment health, not
  // renderer health — these tests own the latter. Each engine phrases the
  // failure differently; all three signatures are strictly network-layer.
  // A renderer crash logs an uncaught exception, which matches none of
  // these and still fails the assertion.
  const NETWORK_NOISE = [
    'Failed to load resource', // chromium / mobile-chrome
    'Could not connect to the server.', // webkit / mobile-safari
    'Cross-Origin Request Blocked', // firefox
  ];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !NETWORK_NOISE.some((sig) => text.includes(sig))) {
      consoleErrors.push(text);
    }
  });
  await page.route('**/roadmap-data.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    }),
  );
  await page.goto('/roadmap.html');
  await expect(page.locator('.phase-card').first()).toBeVisible();
  return consoleErrors;
}

test.describe('roadmap renders SHY-derived items', () => {
  test('non-in-progress item renders inside its phase with a shyId badge chip', async ({ page }) => {
    await gotoWithFixture(page);
    const phase = page.locator('[data-testid="phase-card"]', { hasText: 'Safety & Compliance' });
    const itemRow = phase.locator('.feature-item', { hasText: 'Imaginary shipped story' });
    await expect(itemRow).toHaveCount(1);
    await expect(itemRow.locator('.shy-badge')).toHaveText('SHY-0099');
    // In-progress entries render ONLY in the top lift — same semantics as
    // in-progress features (roadmap-app.js phase-body skip).
    await expect(
      phase.locator('.feature-item', { hasText: 'Age-gating per feature' }),
    ).toHaveCount(0);
  });

  test('title-case item statuses are normalised to the renderer icon classes', async ({ page }) => {
    await gotoWithFixture(page);
    const phase = page.locator('[data-testid="phase-card"]', { hasText: 'Safety & Compliance' });
    const doneItem = phase.locator('.feature-item', { hasText: 'Imaginary shipped story' });
    await expect(doneItem.locator('.feature-status-icon--done')).toHaveCount(1);
    // "In Progress" (title case from sync) must normalise to the lift
    // predicate — proven by the row appearing in the top section with the
    // in-progress icon class.
    const lifted = page
      .locator('#in-progress-section .feature-item', { hasText: 'Age-gating per feature' });
    await expect(lifted.locator('.feature-status-icon--in-progress')).toHaveCount(1);
  });

  test('in-progress item lifts into the top section and keeps its badge', async ({ page }) => {
    await gotoWithFixture(page);
    const top = page.locator('#in-progress-section');
    const lifted = top.locator('.feature-item', { hasText: 'Age-gating per feature' });
    await expect(lifted).toHaveCount(1);
    await expect(lifted.locator('.shy-badge')).toHaveText('SHY-0060');
  });

  test('phase progress counts include items in numerator and denominator', async ({ page }) => {
    await gotoWithFixture(page);
    // Safety & Compliance: 1 done feature + 1 done item of 4 total = (2/4)
    const phase = page.locator('[data-testid="phase-card"]', { hasText: 'Safety & Compliance' });
    await expect(phase.locator('.phase-progress-text')).toContainText('(2/4)');
  });

  test('global donut legend counts include items (consistent with per-phase math)', async ({ page }) => {
    await gotoWithFixture(page);
    // FIXTURE totals: done = 1 feature + 2 items (SHY-0099, SHY-0101) = 3;
    // in-progress = SHY-0060 = 1; planned = 2 legacy features.
    // Pins the reviewer-flagged side-effect as intended behaviour: the
    // public stats card reflects synced stories, matching phase sums.
    await expect(page.locator('#count-done')).toHaveText(/3/);
    await expect(page.locator('#count-in-progress')).toHaveText(/1/);
    await expect(page.locator('#count-planned')).toHaveText(/2/);
  });

  test('a phase with only items renders with correct count', async ({ page }) => {
    await gotoWithFixture(page);
    const phase = page.locator('[data-testid="phase-card"]', { hasText: 'Items Only Phase' });
    await expect(phase).toHaveCount(1);
    await expect(phase.locator('.feature-item', { hasText: 'All items phase entry' })).toHaveCount(1);
    await expect(phase.locator('.phase-progress-text')).toContainText('(1/1)');
  });

  test('a phases entry without an items key renders unchanged with zero console errors', async ({ page }) => {
    const errors = await gotoWithFixture(page);
    const phase = page.locator('[data-testid="phase-card"]', { hasText: 'Legacy Only Phase' });
    await expect(phase).toHaveCount(1);
    await expect(phase.locator('.feature-item', { hasText: 'Old style feature' })).toHaveCount(1);
    await expect(phase.locator('.shy-badge')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('malformed item entries are skipped without console errors', async ({ page }) => {
    const fixture = JSON.parse(JSON.stringify(FIXTURE));
    fixture.phases[0].items.push({ status: 'Done', i18n: {} }); // no shyId, no name
    const errors = await gotoWithFixture(page, fixture);
    // All three well-formed items still render their badges page-wide
    // (SHY-0099 + SHY-0101 in phase bodies, SHY-0060 in the lift)…
    await expect(page.locator('.shy-badge')).toHaveCount(3);
    // …and nothing blew up.
    expect(errors).toEqual([]);
  });
});

test.describe('badge aria-label is translated', () => {
  test.use({ locale: 'ar' });

  test('Arabic storyBadge template is used in phase rows and the in-progress lift', async ({ page }) => {
    await gotoWithFixture(page);
    const badges = page.locator('.shy-badge');
    await expect(badges).toHaveCount(3); // SHY-0099 + SHY-0101 bodies, SHY-0060 lift
    for (const badge of await badges.all()) {
      const id = (await badge.textContent())?.trim();
      const label = await badge.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label).toContain(id as string);
      // Arabic template, not the English "Story SHY-NNNN"
      expect(label).not.toContain('Story ');
    }
  });
});

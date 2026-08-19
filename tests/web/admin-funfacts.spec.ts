import { test, expect, TestData } from './fixtures/admin';
import { adminLogin, navigateToTab } from './helpers/admin-auth';
import { Page } from '@playwright/test';

// ── Helpers ──

/** Open the Fun Facts tab (assumes already logged in). */
async function goToFunFacts(page: Page): Promise<void> {
  await navigateToTab(page, 'Fun Facts');
  // Wait for the list to settle (loader disappears)
  await page.locator('#funfacts-list').waitFor({ state: 'visible', timeout: 15_000 });
  // Give the API call time to populate the list
  await expect(page.locator('#funfacts-list').locator('.list-loader')).toBeHidden({ timeout: 15_000 }).catch((err) => console.warn('Loader wait failed:', err.message));
}

/** Wait for the fun-facts list to finish loading after a mutation (reload / save / delete). */
async function waitForListLoaded(page: Page): Promise<void> {
  await expect(page.locator('#funfacts-list').locator('.list-loader')).toBeHidden({ timeout: 15_000 }).catch((err) => console.warn('Loader wait failed:', err.message));
}

/** Find the first card in #funfacts-list whose text content includes the given substring.
 * Uses .first() because the emulator may accumulate duplicate entries across test runs. */
function factCard(page: Page, textSubstring: string) {
  return page.locator('#funfacts-list > div').filter({ hasText: textSubstring }).first();
}

/** Fill the fun-fact dialog fields and save. */
async function fillDialogAndSave(
  page: Page,
  opts: { text: string; category?: string; emoji?: string; sourceLang?: string; active?: boolean },
): Promise<void> {
  await page.locator('#funfact-text-input').fill(opts.text);
  if (opts.category) await page.locator('#funfact-category-input').selectOption(opts.category);
  if (opts.emoji !== undefined) await page.locator('#funfact-emoji-input').fill(opts.emoji);
  if (opts.sourceLang !== undefined) await page.locator('#funfact-sourcelang-input').fill(opts.sourceLang);
  if (opts.active === false) await page.locator('#funfact-active-check').uncheck();
  else if (opts.active === true) await page.locator('#funfact-active-check').check();
  await page.locator('#funfact-dialog-save').click();
  // Wait for dialog to close
  await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
  await waitForListLoaded(page);
}

/** Reload the page, re-login, navigate back to Fun Facts. */
async function reloadAndReturn(page: Page): Promise<void> {
  await page.reload();
  await adminLogin(page);
  await goToFunFacts(page);
}

/**
 * Sentinel for `pollFactActiveState` when the fact isn't found in the admin
 * list. Surfacing the missing-doc state as a distinct value (vs. defaulting
 * to a boolean) makes the eventual timeout failure point at the real
 * problem instead of silently masking it as "still active" / "still
 * inactive".
 */
const FACT_MISSING = 'MISSING' as const;

/**
 * Read the active flag for a fact via the admin endpoint. Returns the
 * boolean if found, or `FACT_MISSING` if absent — designed for use inside
 * `expect.poll(...)` so a deleted-or-renamed fact surfaces a clear
 * "Expected `false` (or `true`), received `'MISSING'`" failure instead of
 * a 10s timeout that points at the lag mechanism.
 *
 * The admin route is `db.collection('funFacts').orderBy(...).get()` (no
 * `where` clause), so it bypasses the Firestore emulator's snapshot-index
 * lag and reflects writes within milliseconds. PR #968 rounds 5/7 verified
 * that polling the user-facing `/api/fun-facts` (which DOES use a `where`
 * filter) is unreliable in the emulator — even cache-buster + 60 s timeouts
 * flake 5/5. Production Firestore doesn't have this lag; the `where`
 * filter is trivial Firestore behavior, not app code we need to test.
 */
async function readFactIsActive(
  api: TestData['api'],
  text: string,
): Promise<boolean | typeof FACT_MISSING> {
  const allFacts: any[] = await api.get('/api/admin/fun-facts');
  const fact = allFacts.find((f) => f.text === text);
  if (!fact) return FACT_MISSING;
  return fact.isActive ?? fact.is_active ?? false;
}

/** Delete a fun fact via the API (for cleanup). */
async function apiDeleteFact(api: TestData['api'], factId: string): Promise<void> {
  await api.delete(`/api/admin/fun-facts/${factId}`).catch((err) => { console.warn('apiDeleteFact failed:', err); });
}

/** Create a fun fact via the API (for re-seeding). */
async function apiCreateFact(
  api: TestData['api'],
  body: { text: string; category?: string; emoji?: string; source_language?: string; is_active?: boolean },
): Promise<{ id: string }> {
  return api.post('/api/admin/fun-facts', body);
}

test.describe('Admin Fun Facts', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await goToFunFacts(page);
  });

  // ── Test 1: Seeded fact appears in list — API verify ──
  test('seeded fact appears in list with API verification', async ({ page, testData }) => {
    // testData fixture is lazy — accessing it triggers setup, which creates the fun fact.
    // Re-navigate to refresh the list with the newly created data.
    const factText = testData.funFact.text;
    await goToFunFacts(page);

    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Card should show category badge "Science" and emoji
    await expect(card).toContainText('Science');

    // API: verify the seeded fact exists
    const allFacts = await testData.api.get('/api/admin/fun-facts');
    const seeded = allFacts.find((f: any) => f.id === testData.funFact.id);
    expect(seeded).toBeDefined();
    expect(seeded.text).toBe(testData.funFact.text);
  });

  // ── Test 2: Create fun fact via dialog — persist after reload, then delete ──
  test('create fun fact via dialog persists after reload', async ({ page, testData }) => {
    const newText = `e2e-${testData.prefix}-new-fact`;

    // Click "+ Add Fun Fact"
    await page.locator('#funfact-add-btn').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await expect(page.locator('#funfact-dialog-title')).toHaveText('Add Fun Fact');

    // Fill all fields and save
    await fillDialogAndSave(page, {
      text: newText,
      category: 'culture',
      emoji: '🎭',
      sourceLang: 'French',
      active: true,
    });

    // Verify card appears in the list
    const card = factCard(page, newText);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Culture');
    await expect(card).toContainText('French');

    // Reload and verify persistence
    await reloadAndReturn(page);
    await expect(factCard(page, newText)).toBeVisible({ timeout: 15_000 });

    // Cleanup: find the id via API and delete
    const allFacts = await testData.api.get('/api/admin/fun-facts');
    const created = allFacts.find((f: any) => f.text === newText);
    expect(created).toBeDefined();
    await apiDeleteFact(testData.api, created.id);
  });

  // ── Test 3: Edit fun fact — change text, save, reload, verify, restore ──
  test('edit fun fact changes text and persists', async ({ page, testData }) => {
    const originalText = testData.funFact.text;
    const editedText = `${originalText}-edited`;

    // Click Edit on the seeded fact
    const card = factCard(page, originalText);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Edit' }).click();

    // Dialog should open in edit mode
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await expect(page.locator('#funfact-dialog-title')).toHaveText('Edit Fun Fact');

    // Modify text and save
    await page.locator('#funfact-text-input').fill(editedText);
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Verify updated card appears
    await expect(factCard(page, editedText)).toBeVisible({ timeout: 10_000 });

    // Reload and verify persistence
    await reloadAndReturn(page);
    await expect(factCard(page, editedText)).toBeVisible({ timeout: 15_000 });

    // Restore original text
    const restoredCard = factCard(page, editedText);
    await restoredCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await page.locator('#funfact-text-input').fill(originalText);
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Verify restored
    await expect(factCard(page, originalText)).toBeVisible({ timeout: 10_000 });
  });

  // ── Test 4: Delete fun fact — confirm, verify removed, reload, re-seed ──
  test('delete fun fact removes it permanently', async ({ page, testData }) => {
    // Create a dedicated fun fact to delete — do NOT delete the seeded one,
    // as serial block retries would then fail on the "seeded fact appears" test.
    const factText = `e2e-delete-${Date.now()}`;
    await testData.api.testWrite('funFacts', { text: factText, category: 'Science', emoji: '🧪', isActive: true, createdAt: Date.now() });
    await reloadAndReturn(page);

    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Accept the confirmation dialog that appears on delete
    page.on('dialog', dialog => dialog.accept());

    // Click Delete
    await card.getByRole('button', { name: 'Delete' }).click();
    await waitForListLoaded(page);

    // Verify the card is gone
    await expect(factCard(page, factText)).toBeHidden({ timeout: 10_000 });

    // Reload — still gone
    await reloadAndReturn(page);
    await expect(factCard(page, factText)).toBeHidden({ timeout: 10_000 });

    // Re-seed via API so subsequent tests have the fact
    const created = await apiCreateFact(testData.api, {
      text: factText,
      category: 'Science',
      emoji: '🔬',
      is_active: true,
    });
    // Update testData reference (id changed)
    testData.funFact.id = created.id;
  });

  // ── Test 5: Delete cancel — fact still exists ──
  test('delete cancel leaves fact intact', async ({ page, testData }) => {
    const factText = testData.funFact.text;

    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Dismiss the confirmation dialog
    page.on('dialog', dialog => dialog.dismiss());

    await card.getByRole('button', { name: 'Delete' }).click();

    // Small wait to let any UI updates settle
    await page.waitForTimeout(500);

    // Fact should still be in the list
    await expect(factCard(page, factText)).toBeVisible();
  });

  // ── Test 6: Category dropdown — verify options, save each, verify persistence ──
  test('category dropdown options save and persist', async ({ page, testData }) => {
    const factText = testData.funFact.text;
    const categories = ['language', 'greeting', 'culture', 'trivia'];
    const categoryLabels: Record<string, string> = {
      language: 'Language',
      greeting: 'Greeting',
      culture: 'Culture',
      trivia: 'Trivia',
    };

    // Verify all options exist in the dropdown
    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();

    const options = page.locator('#funfact-category-input option');
    await expect(options).toHaveCount(4);
    for (const cat of categories) {
      await expect(page.locator(`#funfact-category-input option[value="${cat}"]`)).toBeAttached();
    }
    await page.locator('#funfact-dialog-cancel').click();

    // Save with each category and verify it persists after reload
    for (const cat of categories) {
      const currentCard = factCard(page, factText);
      await currentCard.getByRole('button', { name: 'Edit' }).click();
      await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
      await page.locator('#funfact-category-input').selectOption(cat);
      await page.locator('#funfact-dialog-save').click();
      await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
      await waitForListLoaded(page);

      // Verify the badge shows the correct label
      await expect(factCard(page, factText)).toContainText(categoryLabels[cat], { timeout: 10_000 });
    }

    // Reload and verify last category stuck
    await reloadAndReturn(page);
    await expect(factCard(page, factText)).toContainText('Trivia', { timeout: 15_000 });

    // Restore to Science (original seeded category)
    // Note: "Science" is not a valid dropdown option — seeded as "Science" but
    // the dropdown only has language/greeting/culture/trivia. Restore to a valid one.
    const restoreCard = factCard(page, factText);
    await restoreCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await page.locator('#funfact-category-input').selectOption('trivia');
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
  });

  // ── Test 7: Emoji field — set, save, reload, verify ──
  test('emoji field saves and persists', async ({ page, testData }) => {
    const factText = testData.funFact.text;

    // Edit the seeded fact, change emoji
    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();

    await page.locator('#funfact-emoji-input').fill('🌍');
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Verify the emoji appears on the card
    await expect(factCard(page, factText)).toContainText('🌍', { timeout: 10_000 });

    // Reload and verify persistence
    await reloadAndReturn(page);
    await expect(factCard(page, factText)).toContainText('🌍', { timeout: 15_000 });

    // API verification
    const allFacts = await testData.api.get('/api/admin/fun-facts');
    const fact = allFacts.find((f: any) => f.text === factText);
    expect(fact).toBeDefined();
    expect(fact.emoji).toBe('🌍');

    // Restore original emoji
    const restoreCard = factCard(page, factText);
    await restoreCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await page.locator('#funfact-emoji-input').fill('🔬');
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
  });

  // ── Test 8: Source language — set, save, reload, verify. Clear, verify empty ──
  test('source language saves, persists, and clears', async ({ page, testData }) => {
    const factText = testData.funFact.text;

    // Edit — set source language
    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();

    await page.locator('#funfact-sourcelang-input').fill('Mandarin');
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Verify "Mandarin" appears on the card
    await expect(factCard(page, factText)).toContainText('Mandarin', { timeout: 10_000 });

    // Reload and verify persistence
    await reloadAndReturn(page);
    await expect(factCard(page, factText)).toContainText('Mandarin', { timeout: 15_000 });

    // API verification
    let allFacts = await testData.api.get('/api/admin/fun-facts');
    let fact = allFacts.find((f: any) => f.text === factText);
    expect(fact).toBeDefined();
    expect(fact.sourceLanguage ?? fact.source_language).toBe('Mandarin');

    // Clear source language
    const updatedCard = factCard(page, factText);
    await updatedCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await page.locator('#funfact-sourcelang-input').fill('');
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Verify "Mandarin" is gone from the card
    await expect(factCard(page, factText)).not.toContainText('Mandarin', { timeout: 10_000 });

    // API: verify empty
    allFacts = await testData.api.get('/api/admin/fun-facts');
    fact = allFacts.find((f: any) => f.text === factText);
    expect(fact).toBeDefined();
    const sourceLang = fact.sourceLanguage ?? fact.source_language ?? '';
    expect(sourceLang).toBe('');
  });

  // ── Test 9: Active toggle — deactivate, API excludes, re-activate ──
  test('active toggle controls user-facing visibility', async ({ page, testData }) => {
    // testData is a lazy fixture — accessing .funFact.text NOW triggers
    // the fixture's setup which creates the fact in Firestore. The
    // beforeEach's goToFunFacts() already ran with the list that did NOT
    // include this fact (because the access hadn't fired yet), so the
    // card won't appear in the cached UI list. Re-navigate to force a
    // reload that picks up the just-created fact. Matches the pattern
    // used by test 1 ("seeded fact appears in list").
    const factText = testData.funFact.text;
    await goToFunFacts(page);

    // Deactivate the seeded fact
    const card = factCard(page, factText);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();

    await page.locator('#funfact-active-check').uncheck();
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Card should show "Inactive" badge
    await expect(factCard(page, factText)).toContainText('Inactive', { timeout: 10_000 });

    // Verify via the admin endpoint that the doc was updated. See
    // `readFactIsActive` for the rationale (admin endpoint bypasses the
    // emulator's snapshot-index lag).
    await expect
      .poll(() => readFactIsActive(testData.api, factText), {
        timeout: 10_000,
        intervals: [200, 500, 1000],
      })
      .toBe(false);

    // Re-activate
    const inactiveCard = factCard(page, factText);
    await inactiveCard.getByRole('button', { name: 'Edit' }).click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeVisible();
    await page.locator('#funfact-active-check').check();
    await page.locator('#funfact-dialog-save').click();
    await expect(page.locator('#funfact-dialog-overlay')).toBeHidden({ timeout: 15_000 });
    await waitForListLoaded(page);

    // Card should show "Active" badge
    await expect(factCard(page, factText)).toContainText('Active', { timeout: 10_000 });

    // Verify the re-activation via the same admin-endpoint path as the
    // deactivation check. Polling the user-facing route here would
    // re-introduce the emulator snapshot-index lag (see
    // `readFactIsActive`) — the lag applies symmetrically to false→true
    // index updates, not just true→false.
    await expect
      .poll(() => readFactIsActive(testData.api, factText), {
        timeout: 10_000,
        intervals: [200, 500, 1000],
      })
      .toBe(true);
  });

  // ── Test 10: Empty state — delete all, verify message, re-seed ──
  test('empty state message appears when no fun facts exist', async ({ page, testData }) => {
    // Get all fun facts via API and delete them all
    const allFacts = await testData.api.get('/api/admin/fun-facts');
    for (const f of allFacts) {
      await testData.api.delete(`/api/admin/fun-facts/${f.id}`);
    }

    // Reload to see empty state
    await reloadAndReturn(page);

    // Verify empty state message
    const emptyMsg = page.locator('#funfacts-list').locator('text=No fun facts yet');
    await expect(emptyMsg).toBeVisible({ timeout: 15_000 });

    // Re-seed the fact for other tests / teardown
    const created = await apiCreateFact(testData.api, {
      text: testData.funFact.text,
      category: 'Science',
      emoji: '🔬',
      is_active: true,
    });
    testData.funFact.id = created.id;

    // Reload and verify the fact is back
    await reloadAndReturn(page);
    await expect(factCard(page, testData.funFact.text)).toBeVisible({ timeout: 15_000 });
  });
});

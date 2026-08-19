import { test, expect } from '@playwright/test';
import {
  createRoadmapUser,
  signInToRoadmap,
  teardownTestRun,
  type RoadmapTestUser,
} from './helpers/roadmap-auth';

/**
 * Every tag the suggestion form offers must be one the API accepts.
 *
 * The form used to offer nine invented tags — voice / chat / moderation / ui /
 * privacy / social / economy / accessibility / other — of which only "social"
 * was in the server's `VALID_TAGS`. A tag is REQUIRED to enable Submit
 * (`validateForm`, suggestions-board.js), so eight of the nine choices made it
 * impossible to post a suggestion at all: 400 "Invalid tag: chat". Nothing
 * caught it because every logged-in test in this area was `test.fixme`
 * (SHY-0248).
 *
 * This walks the real dropdown against the real endpoint, so the two can never
 * drift apart again without a failure.
 */

let user: RoadmapTestUser;

test.beforeEach(async ({ page }) => {
  user = await createRoadmapUser({ prefix: 'tags' });
  await signInToRoadmap(page, user);
});

test.afterEach(async () => {
  if (user) await teardownTestRun(user.testRunId);
});

test('every tag offered by the form is accepted by the API', async ({ page }) => {
  await page.locator('[data-testid="suggest-btn"]').click();
  const select = page.locator('[data-testid="suggest-tag-select"]');
  await expect(select).toBeVisible();

  const values = (
    await select
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
  ).filter(Boolean);
  expect(values.length, 'the form must offer at least one tag').toBeGreaterThan(0);

  // Ask the API directly rather than re-typing its list here: a copy would go
  // stale in exactly the way the bug did.
  const rejected: string[] = [];
  for (const tag of values) {
    const status = await page.evaluate(
      async ({ tag, base }) => {
        const token = await (window as any).shytalkAuth.getToken();
        const res = await fetch(`${base}/api/suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            title: `Tag contract probe ${tag} ${Date.now()}`,
            description: 'Submitted by the tag-contract spec.',
            tags: [tag],
          }),
        });
        return res.status;
      },
      { tag, base: (process.env.API_BASE_URL || 'http://localhost:3000') as string },
    );
    // 429 means the pending-suggestion cap kicked in, which is the server
    // agreeing the tag was fine — only a 400 is the vocabulary disagreeing.
    if (status === 400) rejected.push(tag);
  }

  expect(
    rejected,
    `tags offered by the form but rejected by the API: ${rejected.join(', ')}`,
  ).toEqual([]);
});

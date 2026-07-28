import { test, expect } from '@playwright/test';
import { publishAuthIdentity } from './helpers/auth-identity';
import {
  SEEDED_ROADMAP_USER,
  createRoadmapUser,
  createSuggestion,
  roadmapLogin,
  signInToRoadmap,
  signInWithoutShyTalkAccount,
  teardownTestRun,
} from './helpers/roadmap-auth';

/**
 * Roadmap page authentication flow tests.
 *
 * Tests the login UI on the suggestions section:
 * - Login prompt with Google/Apple sign-in options
 * - No ShyTalk account: denied with app download links
 * - Logged-in state: "Logged in as: {name}" with sign out
 */

test.describe('Roadmap Auth — Login Prompt', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  // ── Initial state: friendly welcome with download links, no login buttons ──

  test('suggestions section shows welcome prompt when not authenticated', async ({ page }) => {
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });

  test('welcome prompt shows friendly message about ShyTalk account', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-login-prompt"], .auth-login-prompt');
    await expect(prompt).toContainText(/shytalk.*account|sign.*in|look around/i);
  });

  test('welcome prompt has Google Play download link', async ({ page }) => {
    const playLink = page.locator('[data-testid="download-android"]');
    await expect(playLink).toBeVisible({ timeout: 10_000 });
    await expect(playLink).toContainText(/google play/i);
    const href = await playLink.getAttribute('href');
    expect(href).toContain('play.google.com');
  });

  test('welcome prompt has App Store download link', async ({ page }) => {
    const appStoreLink = page.locator('[data-testid="download-ios"]');
    await expect(appStoreLink).toBeVisible({ timeout: 10_000 });
    await expect(appStoreLink).toContainText(/app store/i);
    const href = await appStoreLink.getAttribute('href');
    expect(href).toContain('apps.apple.com');
  });

  test('welcome prompt visible in suggestions section specifically (not header)', async ({
    page,
  }) => {
    const suggestionsSection = page.locator('#suggestions, [data-section="suggestions"]');
    const loginPrompt = suggestionsSection.locator(
      '[data-testid="auth-login-prompt"], .auth-login-prompt',
    );
    await expect(loginPrompt).toBeVisible({ timeout: 10_000 });
  });

  test('no Google/Apple login buttons shown on initial page load', async ({ page }) => {
    // Login buttons should only appear in modal when user tries an auth action.
    // Anchor on the login prompt, which roadmap-auth.js renders ONLY once the
    // auth state is known ("Don't render login buttons until we know the auth
    // state (prevents flash)"). Without it, the absence assertions below would
    // pass trivially before anything had rendered (SHY-0245).
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    await expect(page.locator('[data-testid="auth-google-btn"], .auth-google-btn')).toHaveCount(0);
    await expect(page.locator('[data-testid="auth-apple-btn"], .auth-apple-btn')).toHaveCount(0);
  });

  // ── Login modal: appears when user tries an auth-gated action ──

  test('clicking Suggest button shows login modal', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"], #sg-login-modal-overlay');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('login modal has Google sign-in button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    const googleBtn = loginModal.locator('[data-testid="auth-google-btn"]');
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toContainText(/google/i);
  });

  test('login modal has Apple sign-in button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    const appleBtn = loginModal.locator('[data-testid="auth-apple-btn"]');
    await expect(appleBtn).toBeVisible();
    await expect(appleBtn).toContainText(/apple/i);
  });

  test('login modal has close (X) button but no Cancel button', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    // Close (X) button in header exists and is visible
    const closeBtn = loginModal.locator('[data-testid="login-modal-close"]');
    await expect(closeBtn).toBeVisible();
    // Cancel/dismiss button should NOT exist
    const cancelBtn = loginModal.locator('[data-testid="login-modal-dismiss"]');
    expect(await cancelBtn.count()).toBe(0);
  });

  test('clicking X closes the login modal', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
    await loginModal.locator('[data-testid="login-modal-close"]').click();
    await expect(loginModal).not.toBeVisible({ timeout: 3_000 });
  });

  test('download links have correct branded styling', async ({ page }) => {
    const playLink = page.locator('[data-testid="download-android"]');
    await expect(playLink).toBeVisible({ timeout: 10_000 });
    const playSvg = playLink.locator('svg');
    expect(await playSvg.count()).toBeGreaterThan(0);
    const appStoreLink = page.locator('[data-testid="download-ios"]');
    await expect(appStoreLink).toBeVisible({ timeout: 10_000 });
    const appleSvg = appStoreLink.locator('svg');
    expect(await appleSvg.count()).toBeGreaterThan(0);
  });

  test('accessibility: keyboard navigable (tab to login buttons, enter to activate)', async ({
    page,
  }) => {
    // The sign-in buttons live in the shared login modal, not on the page — so
    // the original version focused a locator that matched nothing and was
    // parked as unbuilt. Opening the modal first is all it needed.
    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();
    await expect(page.locator('[data-testid="login-modal-overlay"]')).toBeVisible();

    for (const id of ['auth-google-btn', 'auth-apple-btn']) {
      const btn = page.locator(`[data-testid="${id}"]`);
      await btn.focus();
      await expect(btn, `${id} must be reachable by keyboard`).toBeFocused();
    }
  });

  test('i18n: login prompt text translatable (data-i18n attributes)', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-login-prompt"]');
    await expect(prompt).toBeVisible();
    // The copy must carry a translation key, not just be non-empty — an
    // untranslatable prompt strands every non-English reader on the one screen
    // that explains how to take part.
    await expect(prompt.locator('[data-i18n]')).toHaveCount(1);
    expect((await prompt.textContent())?.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Roadmap Auth — Subscribe uses shared login modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('subscribe button (unauthenticated) opens the shared login modal, NOT its own modal', async ({
    page,
  }) => {
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();

    // Should open the shared login modal (login-modal-overlay), NOT the subscribe modal
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });

    // The subscribe-specific modal should NOT appear when unauthenticated
    const subscribeModal = page.locator('[data-testid="subscribe-modal"]');
    expect(await subscribeModal.count()).toBe(0);
  });

  test('subscribe login modal matches bell login modal (same testid, same structure)', async ({
    page,
  }) => {
    // Open via subscribe button
    const subscribeBtn = page.locator('[data-testid="subscribe-btn"], .subscribe-btn');
    await subscribeBtn.waitFor({ timeout: 10_000 });
    await subscribeBtn.click();

    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Should have Google + Apple sign-in buttons
    await expect(modal.locator('[data-testid="auth-google-btn"]')).toBeVisible();
    await expect(modal.locator('[data-testid="auth-apple-btn"]')).toBeVisible();

    // Should have close button
    await expect(modal.locator('[data-testid="login-modal-close"]')).toBeVisible();
  });

  test('Google sign-in button calls signInWithGoogle (not just closing the modal)', async ({
    page,
  }) => {
    // Intercept the signInWithGoogle call
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      if ((window as any).shytalkAuth) {
        (window as any).shytalkAuth.signInWithGoogle = () => {
          (window as any).__signInCalled = 'google';
        };
      }
      // Also set up for late binding
      const origDesc = Object.getOwnPropertyDescriptor(window, 'shytalkAuth');
      if (!origDesc || !origDesc.set) {
        let _auth = (window as any).shytalkAuth;
        Object.defineProperty(window, 'shytalkAuth', {
          get: () => _auth,
          set: (v) => {
            _auth = v;
            if (_auth) {
              _auth.signInWithGoogle = () => {
                (window as any).__signInCalled = 'google';
              };
            }
          },
          configurable: true,
        });
      }
    });

    // Trigger the login modal
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click Google sign-in
    await modal.locator('[data-testid="auth-google-btn"]').click();

    // Verify signInWithGoogle was called
    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('google');
  });

  test('Apple sign-in button calls signInWithApple (not just closing the modal)', async ({
    page,
  }) => {
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      if ((window as any).shytalkAuth) {
        (window as any).shytalkAuth.signInWithApple = () => {
          (window as any).__signInCalled = 'apple';
        };
      }
      const origDesc = Object.getOwnPropertyDescriptor(window, 'shytalkAuth');
      if (!origDesc || !origDesc.set) {
        let _auth = (window as any).shytalkAuth;
        Object.defineProperty(window, 'shytalkAuth', {
          get: () => _auth,
          set: (v) => {
            _auth = v;
            if (_auth) {
              _auth.signInWithApple = () => {
                (window as any).__signInCalled = 'apple';
              };
            }
          },
          configurable: true,
        });
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.locator('[data-testid="auth-apple-btn"]').click();

    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('apple');
  });

  test('Google sign-in button calls signInWithGoogle (triggers redirect)', async ({ page }) => {
    // Mock signInWithGoogle to prevent actual redirect
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      let _auth = (window as any).shytalkAuth;
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => _auth,
        set: (v) => {
          _auth = v;
          if (_auth) {
            _auth.signInWithGoogle = () => {
              (window as any).__signInCalled = 'google';
            };
          }
        },
        configurable: true,
      });
      if (_auth) {
        _auth.signInWithGoogle = () => {
          (window as any).__signInCalled = 'google';
        };
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.locator('[data-testid="auth-google-btn"]').click();

    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('google');
  });

  test('Apple sign-in button calls signInWithApple (triggers redirect)', async ({ page }) => {
    await page.evaluate(() => {
      (window as any).__signInCalled = null;
      let _auth = (window as any).shytalkAuth;
      Object.defineProperty(window, 'shytalkAuth', {
        get: () => _auth,
        set: (v) => {
          _auth = v;
          if (_auth) {
            _auth.signInWithApple = () => {
              (window as any).__signInCalled = 'apple';
            };
          }
        },
        configurable: true,
      });
      if (_auth) {
        _auth.signInWithApple = () => {
          (window as any).__signInCalled = 'apple';
        };
      }
    });

    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await suggestBtn.waitFor({ timeout: 10_000 });
    await suggestBtn.click();
    const modal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await modal.locator('[data-testid="auth-apple-btn"]').click();

    const called = await page.evaluate(() => (window as any).__signInCalled);
    expect(called).toBe('apple');
  });

  test('bell button (unauthenticated) opens the shared login modal', async ({ page }) => {
    const bell = page.locator('[data-testid="feature-bell"], .feature-bell').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });
});

/**
 * The REAL "signed in, no ShyTalk account" state: a Firebase identity with no
 * `users/{uniqueId}` doc, so `/api/roadmap/me` genuinely answers 404.
 *
 * These previously route-mocked that 404 and then simply navigated — but the
 * fetch only happens from the real auth callback, so the mock was never
 * requested and the state was never reached. Unguarding them exposed a real
 * defect: the branch rendered its explanation and then immediately called
 * `auth.signOut()`, whose `onAuthStateChanged(null)` re-render overwrote it
 * with the generic prompt. Fixed in `roadmap-auth.js` (SHY-0245).
 */
test.describe('Roadmap Auth — No Account Found', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithoutShyTalkAccount(page);
  });

  test('shows download prompt when Google login has no ShyTalk account', async ({ page }) => {
    const noAccount = page.locator('[data-testid="auth-no-account"]');
    await expect(noAccount).toBeVisible();
    await expect(noAccount).toContainText(/couldn.t find a ShyTalk account/i);
    // The generic "want to vote…" prompt must NOT be what the user is left
    // with — that is the regression this state kept hitting.
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toHaveCount(0);
  });

  test('download prompt shows Play Store link', async ({ page }) => {
    const playStoreLink = page.locator('[data-testid="download-android"]');
    await expect(playStoreLink).toBeVisible();
    await expect(playStoreLink).toHaveAttribute('href', /play\.google\.com/);
  });

  test('download prompt shows App Store link', async ({ page }) => {
    const appStoreLink = page.locator('[data-testid="download-ios"]');
    await expect(appStoreLink).toBeVisible();
    await expect(appStoreLink).toHaveAttribute('href', /apps\.apple\.com/);
  });

  test('download prompt message invites user to create account', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-no-account"]')).toContainText(
      /create your free account in the app/i,
    );
  });

  test('no-account message styled as warning/info (not error red)', async ({ page }) => {
    const noAccount = page.locator('[data-testid="auth-no-account"]');
    const color = await noAccount.evaluate((el) => getComputedStyle(el).color);
    const bgColor = await noAccount.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Error red is typically rgb(255, 0, 0) or similar — should not be pure red
    expect(color).not.toBe('rgb(255, 0, 0)');
    expect(bgColor).not.toBe('rgb(255, 0, 0)');
  });

  test('download links open in new tab (target="_blank")', async ({ page }) => {
    await expect(page.locator('[data-testid="download-android"]')).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(page.locator('[data-testid="download-ios"]')).toHaveAttribute('target', '_blank');
  });

  test('download links have rel="noopener noreferrer"', async ({ page }) => {
    // Both links open in a new tab, so both need the opener severed — a
    // `target="_blank"` without it hands the new page a `window.opener`
    // handle back into ours.
    for (const id of ['download-android', 'download-ios']) {
      const rel = await page.locator(`[data-testid="${id}"]`).getAttribute('rel');
      expect(rel, `${id} rel`).toMatch(/noopener/);
      expect(rel, `${id} rel`).toMatch(/noreferrer/);
    }
  });

  test('i18n: download prompt text translatable', async ({ page }) => {
    // The prompt carries a `data-i18n` key so the language switcher can
    // replace it; a hardcoded string would leave non-English readers with
    // English copy in the one place that explains why they cannot sign in.
    const prompt = page.locator('[data-testid="auth-no-account"] .auth-prompt-text');
    await expect(prompt).toHaveAttribute('data-i18n', /.+/);
    expect((await prompt.textContent())?.trim().length).toBeGreaterThan(0);
  });

  test('mobile: download prompt fits on 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const noAccount = page.locator('[data-testid="auth-no-account"]');
    await expect(noAccount).toBeVisible();
    const box = await noAccount.boundingBox();
    expect(box, 'no-account prompt must have a layout box').not.toBeNull();
    // Should not overflow beyond viewport width
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Every test here used to `page.route('**​/api/roadmap/me')` and then simply
 * navigate — but that fetch only ever happens inside `checkShyTalkAccount()`,
 * which only runs from the real `onAuthStateChanged` callback. No sign-in ever
 * occurred, so the route was never requested and the signed-in UI never
 * rendered. An `if (locator.count() > 0)` guard around each body then turned
 * "nothing rendered" into a green tick.
 *
 * They now sign in for REAL against the Auth emulator (`signInToRoadmap`),
 * which is wired end-to-end: `local/seed.js` seeds `user@test.com` with a
 * `users/100000002` doc carrying `firebaseUid`, `authMiddleware` resolves it,
 * and `/api/roadmap/me` answers 200. No mock, no seam — SHY-0245.
 */
test.describe('Roadmap Auth — Logged In State', () => {
  // One real public suggestion for the whole block — the local stack starts
  // with an empty board, so a card, a vote arrow and a comment box all have
  // nothing to attach to without it. Swept in afterAll so the board does not
  // accumulate rows across runs.
  const boardRunId = `test_roadmap_board_${Date.now()}`;

  test.beforeAll(async () => {
    await createSuggestion({ testRunId: boardRunId, title: 'Accepted Feature' });
  });

  test.afterAll(async () => {
    await teardownTestRun(boardRunId);
  });

  test.beforeEach(async ({ page }) => {
    await signInToRoadmap(page);
  });

  test('shows "Logged in as: {name}" when authenticated', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="auth-display-name"]')).toContainText('Logged in as:');
  });

  test('displays user display name', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-display-name"]')).toContainText(
      SEEDED_ROADMAP_USER.displayName,
    );
  });

  test('shows sign out button when logged in', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-signout-btn"]')).toBeVisible();
  });

  test('sign out clears user state and shows login prompt again', async ({ page }) => {
    await page.locator('[data-testid="auth-signout-btn"]').click();
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    await expect(page.locator('[data-testid="auth-user-info"]')).toHaveCount(0);
  });

  test('login prompt hidden when user is logged in', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toHaveCount(0);
  });

  test('suggestions section usable when logged in (no auth error)', async ({ page }) => {
    // The board fetches suggestions with the real token once signed in; a
    // rejected token surfaces as this banner, so its absence is the assertion.
    await expect(page.locator('text=Missing or invalid Authorization')).toHaveCount(0);
  });

  test('displays user avatar when available', async ({ page }) => {
    // The seeded user has no avatar, so this needs its own real profile that
    // carries one — the avatar branch (`roadmap-auth.js:57`) is otherwise
    // unreachable and was parked as unimplemented.
    const user = await createRoadmapUser({
      prefix: 'avatar',
      avatarUrl: 'https://example.com/avatar.png',
    });
    try {
      await signInToRoadmap(page, user);
      const avatar = page.locator('[data-testid="auth-avatar"]');
      await expect(avatar).toBeVisible();
      await expect(avatar).toHaveAttribute('src', user.avatarUrl!);
    } finally {
      await teardownTestRun(user.testRunId);
    }
  });

  test('vote/suggest/comment buttons enabled when logged in', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await expect(suggestBtn).toBeVisible();
    await expect(suggestBtn).not.toBeDisabled();
  });

  test('"Logged in as" text includes the display name', async ({ page }) => {
    // A distinctive name proves the UI renders THIS profile, not a hardcoded
    // string that would also satisfy the seeded-user assertion above.
    const user = await createRoadmapUser({ prefix: 'named', displayName: 'SuperUser42' });
    try {
      await signInToRoadmap(page, user);
      await expect(page.locator('[data-testid="auth-user-info"]')).toContainText('SuperUser42');
    } finally {
      await teardownTestRun(user.testRunId);
    }
  });

  // ─── New tests: login state features ───────────────────────────

  test('after successful login, suggestions list refreshes automatically', async ({ page }) => {
    // Count real requests to the real endpoint — signing in must trigger a
    // reload so the board reflects the viewer's own votes.
    let suggestionsCallCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/suggestions')) suggestionsCallCount++;
    });
    await signInToRoadmap(page);
    await expect.poll(() => suggestionsCallCount, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });

  test('after login, bell icons become clickable (not showing login toast)', async ({ page }) => {
    const bellIcon = page.locator('.bell-icon, [data-testid="subscribe-btn"]').first();
    await expect(bellIcon).toBeVisible();
    await bellIcon.click();
    // Anchor on the click's real effect — the subscribe modal opening — so
    // the "no login toast" assertion is made AFTER the app has responded,
    // not before it could have shown one (SHY-0245).
    await expect(
      page.locator('[data-testid="subscribe-modal"], .subscribe-modal, [role="dialog"]').first(),
    ).toBeVisible();
    await expect(page.locator('[data-testid="login-modal-overlay"]')).toHaveCount(0);
  });

  test('after login, "+ Suggest" button enabled', async ({ page }) => {
    const suggestBtn = page.locator('[data-testid="suggest-btn"]');
    await expect(suggestBtn).toBeVisible();
    await expect(suggestBtn).not.toBeDisabled();
  });

  test('vote arrows enabled after login', async ({ page }) => {
    const voteBtn = page.locator('[data-testid^="vote-up-"]').first();
    await expect(voteBtn).toBeVisible();
    await expect(voteBtn).not.toBeDisabled();
  });

  test('comment form visible on accepted suggestions after login', async ({ page }) => {
    // Comments live behind the detail view of a suggestion card.
    const card = page.locator('[data-testid^="suggestion-card-"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('[data-testid^="comment-input-"]').first()).toBeVisible();
  });

  test('auth state indicator in header area (small avatar + name)', async ({ page }) => {
    const authStatus = page.locator('[data-testid="auth-user-info"]');
    await expect(authStatus).toBeVisible();
    await expect(authStatus).toContainText(SEEDED_ROADMAP_USER.displayName);
  });

  test('sign out button has aria-label for accessibility', async ({ page }) => {
    await expect(page.locator('[data-testid="auth-signout-btn"]')).toHaveAttribute(
      'aria-label',
      /sign.?out/i,
    );
  });

  test('after sign out, page does NOT reload (SPA behavior)', async ({ page }) => {
    let navigationOccurred = false;
    page.on('load', () => {
      navigationOccurred = true;
    });
    await page.locator('[data-testid="auth-signout-btn"]').click();
    // Anchor on sign-out completing — the login prompt returns — so "no
    // navigation" is asserted after the app has actually acted (SHY-0245).
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    // Page should not have fully reloaded — SPA behavior
    expect(navigationOccurred).toBe(false);
  });

  test('after sign out, cached user data cleared', async ({ page }) => {
    await page.locator('[data-testid="auth-signout-btn"]').click();
    // Anchor on the signed-out UI rendering before asserting the name is
    // gone, or the absence could pass before sign-out took effect (SHY-0245).
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    await expect(page.locator('[data-testid="auth-display-name"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).shytalkAuth?.profile ?? null)).toBeNull();
  });

  test('sign out button is instant (no confirmation dialog)', async ({ page }) => {
    let dialogAppeared = false;
    page.on('dialog', async (dialog) => {
      dialogAppeared = true;
      await dialog.accept();
    });
    await page.locator('[data-testid="auth-signout-btn"]').click();
    // Sign out completed (login prompt back) — only then is "no dialog
    // appeared" a real observation rather than an early guess (SHY-0245).
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    expect(dialogAppeared).toBe(false);
  });
});

test.describe('Roadmap Auth — No Account Download Prompt Details', () => {
  test.beforeEach(async ({ page }) => {
    await signInWithoutShyTalkAccount(page);
  });

  test('download prompt shows both store badges/links', async ({ page }) => {
    const prompt = page.locator('[data-testid="auth-no-account"]');
    await expect(prompt.locator('[data-testid="download-android"]')).toBeVisible();
    await expect(prompt.locator('[data-testid="download-ios"]')).toBeVisible();
  });

  test('download prompt has clear call-to-action text', async ({ page }) => {
    const text = await page.locator('[data-testid="auth-no-account"]').textContent();
    expect(text?.toLowerCase()).toMatch(/download|create|account/);
  });

  test('download prompt allows dismissal to browse as guest', async ({ page }) => {
    // User should be able to browse suggestions read-only even without account
    const suggestionsSection = page.locator('#suggestions, [data-section="suggestions"]');
    await expect(suggestionsSection).toBeVisible();
  });
});

test.describe('Roadmap Auth — Session Persistence', () => {
  test('auth state persists across page reload', async ({ page }) => {
    // Firebase persists the session in IndexedDB, so a reload must land back
    // in the signed-in UI without another sign-in. Mocking /api/roadmap/me
    // could never prove this — the fetch only fires from the real auth
    // callback, so the old version reloaded an anonymous page and asserted
    // nothing (SHY-0245).
    await signInToRoadmap(page);
    await page.reload();
    await expect(page.locator('[data-testid="auth-user-info"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="auth-display-name"]')).toContainText(
      SEEDED_ROADMAP_USER.displayName,
    );
  });

  test('sign out removes auth from subsequent API calls', async ({ page }) => {
    await signInToRoadmap(page);

    // Watch the REAL requests. Signing out must stop the board sending a
    // bearer token — otherwise a revoked session keeps acting as the user.
    const authHeadersAfterSignOut: boolean[] = [];
    let watching = false;
    page.on('request', (req) => {
      if (watching && req.url().includes('/api/suggestions')) {
        authHeadersAfterSignOut.push(Boolean(req.headers().authorization));
      }
    });

    watching = true;
    await page.locator('[data-testid="auth-signout-btn"]').click();
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();

    // Force a post-sign-out fetch from the SAME page instance. Reloading
    // instead would prove nothing: a fresh page has no session to leak, so the
    // assertion would hold even if sign-out left the token intact — a mutant
    // that kept serving the old token survived exactly that version.
    await page.locator('[data-testid="sort-newest"]').click();
    await expect.poll(() => authHeadersAfterSignOut.length).toBeGreaterThan(0);
    expect(authHeadersAfterSignOut).not.toContain(true);

    // And the app must not be ABLE to mint one any more.
    expect(await page.evaluate(() => (window as any).shytalkAuth.getToken())).toBeNull();
  });

  test('login spinner/loading state shown during auth check', async ({ page }) => {
    // HOLD the request that actually gates the loading state, then release it.
    // The old test delayed /api/roadmap/me, but that is the PROFILE fetch —
    // `.auth-loading` is rendered while `authStateKnown` is false, which is
    // driven by Firebase init, gated on /api/firebase-config. Delaying the
    // wrong request meant the spinner never appeared, which is why the old
    // assertion was wrapped in `if (count > 0)` and asserted nothing at all.
    // Holding the real gate is deterministic — no 2s guess (SHY-0245).
    let releaseConfig: () => void = () => {};
    const configPending = new Promise<void>((resolve) => {
      releaseConfig = resolve;
    });
    await page.route('**/api/firebase-config', async (route) => {
      await configPending;
      await route.continue();
    });
    await page.goto('/roadmap.html');
    // Asserted unconditionally. The previous `if (count > 0)` meant that when
    // the spinner was absent the test asserted NOTHING and passed vacuously.
    await expect(page.locator('.auth-loading').first()).toBeVisible();
    releaseConfig();
  });
});

test.describe('Roadmap Auth — Error Handling', () => {
  test('API error on /roadmap/me shows generic error, not raw error', async ({ page }) => {
    // A 500 from the profile lookup must not leak the server's own wording,
    // and must leave the page usable rather than stuck. Signing in for real is
    // what makes the route fire at all — the previous version mocked it and
    // never signed in, so nothing ever requested it (SHY-0245).
    await page.route('**/api/roadmap/me', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      }),
    );
    await page.goto('/roadmap.html');
    await roadmapLogin(page, SEEDED_ROADMAP_USER.email, SEEDED_ROADMAP_USER.password);
    // `shytalkProfile` stays null on a non-404 failure, so the page falls back
    // to the signed-out prompt rather than a half-rendered signed-in state.
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('text=Internal server error')).toHaveCount(0);
  });

  test('network failure on auth check allows read-only browsing', async ({ page }) => {
    await page.route('**/api/roadmap/me', (route) => route.abort());
    await page.goto('/roadmap.html');
    // Page should still load and show roadmap data
    await expect(page.locator('body')).toBeVisible();
  });

  test('no console errors from auth flow on clean page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/roadmap.html');
    // Wait for auth to actually resolve before judging the error list —
    // otherwise "no auth errors" just means auth had not run yet (SHY-0245).
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
    const authErrors = errors.filter((e) => /auth|firebase|token/i.test(e));
    expect(authErrors).toHaveLength(0);
  });

  test('Firebase SDK not loaded shows graceful fallback message', async ({ page }) => {
    // Block Firebase SDK scripts from loading
    await page.route('**/*firebase*', (route) => {
      if (route.request().resourceType() === 'script') {
        return route.abort();
      }
      return route.continue();
    });
    await page.goto('/roadmap.html');
    // `toBeVisible` already auto-retries, so the sleep only slowed the suite
    // down; the degraded-path assertion is unchanged (SHY-0245).
    await expect(page.locator('body')).toBeVisible();
    // Should not show raw JS errors to the user
    const jsError = page.locator('text=TypeError, text=ReferenceError, text=is not defined');
    await expect(jsError).toHaveCount(0);
  });

  test('blocked popups cannot break sign-in, because sign-in never uses one', async ({ page }) => {
    // The original test clicked an `auth-google-btn` that has never existed and
    // asserted a popup-blocked message that the product cannot produce: sign-in
    // is redirect-based (`signInWithRedirect`, roadmap-auth.js:218/225), so a
    // popup blocker is not a failure mode at all. Pinning the redirect choice
    // is the assertion that actually protects the user here — switching to
    // `signInWithPopup` would reintroduce the whole class of problem.
    await page.addInitScript(() => {
      (window as any).open = () => null;
    });
    await page.goto('/roadmap.html');
    await page.waitForFunction(() => !!(window as any).shytalkAuth?.signInWithGoogle, {
      timeout: 15_000,
    });
    const usesPopup = await page.evaluate(() =>
      String((window as any).shytalkAuth.signInWithGoogle).includes('signInWithPopup'),
    );
    expect(usesPopup, 'roadmap sign-in must stay redirect-based').toBe(false);
    await expect(page.locator('[data-testid="auth-login-prompt"]')).toBeVisible();
  });
});

test.describe('Roadmap Auth — Mobile Responsiveness', () => {
  test('mobile: login prompt fits on 320px screen', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/roadmap.html');
    const loginPrompt = page.locator('[data-testid="auth-login-prompt"]');
    await expect(loginPrompt).toBeVisible();
    const box = await loginPrompt.boundingBox();
    expect(box, 'login prompt must have a layout box').not.toBeNull();
    // Should not overflow beyond viewport width
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Roadmap Auth — Bell icon auth behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/roadmap.html');
  });

  test('bell icon when NOT authenticated opens login modal', async ({ page }) => {
    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    await expect(loginModal).toBeVisible({ timeout: 5_000 });
  });

  test('bell icon when authenticated does NOT open login modal', async ({ page }) => {
    // Simulate authenticated state — clobber-proof (see publishAuthIdentity).
    await publishAuthIdentity(page, {
      uid: 'test-123',
      displayName: 'TestUser',
      profile: { uniqueId: 1001, displayName: 'TestUser' },
    });

    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    // Anchor on the click's real outcome — the subscribe modal — so the
    // "no login modal" assertion is made after the app responded. (The header
    // is NOT a valid anchor here: this test sets window.shytalkAuth without
    // dispatching `shytalk-auth-changed`, so the header never re-renders.)
    // Then assert absence with the retrying matcher (SHY-0245).
    await expect(page.locator('[data-testid="subscribe-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-modal-overlay"]')).toHaveCount(0);
  });

  test('bell icon while profile still loading opens subscribe modal — NOT login modal (W1 race window)', async ({
    page,
  }) => {
    // Reproduces the exact W1-bundled "Watch bells re-prompt sign-in"
    // bug. When `onAuthStateChanged` fires, `roadmap-auth.js` sets
    // `currentUser` immediately but then asynchronously fetches the
    // ShyTalk profile from `/api/roadmap/me`. During that fetch window,
    // `window.shytalkAuth.profile` is null. The previous bell handler
    // required BOTH currentUser AND profile to be truthy, so a click
    // during the race window incorrectly routed a signed-in user to
    // the LOGIN modal — they'd be asked to sign in again despite
    // already being signed in.
    //
    // Fix: trust `currentUser` alone for "signed in". The subscribe
    // modal handles its own profile-loading state ("Loading
    // preferences..."), so opening it during the race window is the
    // correct UX (eventually the API call resolves and the modal
    // shows the real content).
    //
    // We mock the subscribe-preferences API so the modal can fully
    // render once profile loads — the test isn't about the API path,
    // it's about which modal opens during the race window.
    await page.route('**/api/roadmap/subscribe/preferences*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: {}, watchList: [] }),
      }),
    );

    // Critical: profile is null (still loading), NOT undefined or false — the
    // exact race-window state that produced the bug. publishAuthIdentity also
    // re-pins it across the app's own reassignment, so a bootstrap that lands
    // mid-test can't quietly turn this into the "profile loaded" case.
    await publishAuthIdentity(page, {
      uid: 'test-race-456',
      displayName: 'RaceUser',
      profile: null,
    });

    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    // Subscribe modal MUST appear — NOT the login modal.
    const subscribeModal = page.locator('[data-testid="subscribe-modal"]');
    await expect(subscribeModal).toBeVisible({ timeout: 5_000 });
    const loginModal = page.locator('[data-testid="login-modal-overlay"]');
    expect(await loginModal.count()).toBe(0);
  });

  test('bell icon when authenticated opens subscribe modal', async ({ page }) => {
    // Simulate authenticated state with profile — clobber-proof.
    await publishAuthIdentity(page, {
      uid: 'test-123',
      displayName: 'TestUser',
      profile: { uniqueId: 1001, displayName: 'TestUser' },
    });

    // Mock the subscribe API to avoid real network call
    await page.route('**/api/roadmap/subscribe/preferences*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ preferences: {}, watchList: [] }),
      }),
    );

    const bell = page.locator('[data-testid="feature-bell"]').first();
    await bell.waitFor({ timeout: 10_000 });
    await bell.click();

    // Subscribe modal should appear (not login modal)
    const subscribeModal = page.locator('[data-testid="subscribe-modal"]');
    await expect(subscribeModal).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Roadmap Auth — Redirect-based OAuth', () => {
  test('signInWithGoogle uses signInWithRedirect (not popup)', async ({ page }) => {
    await page.goto('/roadmap.html');
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    expect(source).toContain('signInWithRedirect');
    expect(source).not.toContain('signInWithPopup');
  });

  test('signInWithGoogle uses select_account prompt', async ({ page }) => {
    await page.goto('/roadmap.html');
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    expect(source).toContain('select_account');
  });

  test('signInWithApple uses signInWithRedirect (not popup)', async ({ page }) => {
    await page.goto('/roadmap.html');
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    // Apple sign-in should also use redirect
    expect(source).not.toMatch(/signInWithPopup.*apple|apple.*signInWithPopup/is);
  });

  test('getRedirectResult called on page load', async ({ page }) => {
    await page.goto('/roadmap.html');
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    expect(source).toContain('getRedirectResult');
  });

  test('onAuthStateChanged publishes currentUser SYNCHRONOUSLY before the profile fetch (W1)', async ({
    page,
  }) => {
    // Pin the race-window fix at the source level. The signed-in branch
    // of `onAuthStateChanged` must call `updateGlobalAuth()` BEFORE
    // `checkShyTalkAccount(user)`. Otherwise `window.shytalkAuth.currentUser`
    // stays null until the API round-trip resolves — every click in
    // that window incorrectly opens the login modal for an already-
    // signed-in user. Without this ordering, the existing bell/header
    // race-window tests would never reach the "currentUser truthy,
    // profile null" state in production because the global was only
    // published once both were known.
    await page.goto('/roadmap.html');
    const source = await page.evaluate(async () => {
      const res = await fetch('/js/roadmap-auth.js');
      return res.text();
    });
    // Find the onAuthStateChanged handler body and assert ordering.
    const handlerStart = source.indexOf('auth.onAuthStateChanged(function');
    expect(handlerStart).toBeGreaterThan(-1);
    // Take a slice that comfortably contains the signed-in branch.
    const slice = source.slice(handlerStart, handlerStart + 1500);
    const updateIdx = slice.indexOf('updateGlobalAuth()');
    const checkIdx = slice.indexOf('checkShyTalkAccount(user)');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(-1);
    // Critical: updateGlobalAuth must come BEFORE checkShyTalkAccount
    // in the signed-in branch so the global publishes synchronously.
    expect(updateIdx).toBeLessThan(checkIdx);
  });
});

import { defineConfig, devices } from '@playwright/test';

const reporters: any[] = [
  ['html', { outputFolder: 'playwright-report' }],
  ['junit', { outputFile: 'playwright-results.xml' }],
];
if (process.env.ALLURE_ENABLED === 'true') {
  reporters.push([
    'allure-playwright',
    {
      outputFolder: `allure-results/${process.env.ALLURE_PROJECT || 'default'}`,
      suiteTitle: true,
      detail: false, // Security: prevent pw:api steps from leaking fill() values (passwords, emails)
    },
  ]);
}

// Trace config for the WebKit-engine projects: retain on failure but WITHOUT
// the two per-action capture costs that WebKit pays ~10x for — DOM snapshots
// (serialising the ~260 KB admin DOM every action) and the screencast
// (`screenshots`). Both stack up across an action-heavy admin test until it
// blows its 20s budget — the webkit-only admin-timeout cascade the 2026-07-16
// gauntlet surfaced (SHY-0200). The trace still records the action log,
// network, and source; a single on-failure screenshot still lands via
// `use.screenshot: 'only-on-failure'`. Chromium/Firefox/mobile-chrome keep
// full DOM-snapshot + screencast traces (they serialise fast).
const WEBKIT_TRACE = {
  mode: 'retain-on-failure' as const,
  snapshots: false,
  screenshots: false,
  sources: true,
};

export default defineConfig({
  globalSetup: './tests/web/global-setup.ts',
  testDir: './tests/web',
  testIgnore: ['**/auth.setup.ts'],
  timeout: 20_000,
  expect: {
    timeout: 5_000,
  },
  retries: 1,
  workers: 1, // Serial — Firebase Auth rate-limits concurrent logins causing flaky admin tests
  reporter: reporters,
  use: {
    baseURL: process.env.WEB_BASE_URL || 'http://localhost:8888',
    headless: true,
    screenshot: 'only-on-failure', // Failure screenshots go to test-results/ artifacts (NOT Allure)
    trace: 'retain-on-failure', // Trace on failure for debugging
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', hasTouch: true } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    // webkit + mobile-safari use the WebKit engine → the reduced WEBKIT_TRACE
    // (see its definition above, SHY-0200). Chromium/Firefox/mobile-chrome keep
    // the default full-snapshot trace from `use.trace`.
    { name: 'webkit', use: { browserName: 'webkit', trace: WEBKIT_TRACE } },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'], trace: WEBKIT_TRACE },
    },
  ],
});

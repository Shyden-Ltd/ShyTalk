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

export default defineConfig({
  testDir: './tests/web',
  testIgnore: ['**/auth.setup.ts'],
  timeout: 60_000,
  retries: 1,
  workers: 1, // Serial — Firebase Auth rate-limits concurrent logins causing flaky admin tests
  reporter: reporters,
  use: {
    baseURL: process.env.WEB_BASE_URL || 'https://dev.shytalk.shyden.co.uk',
    headless: true,
    screenshot: 'off', // Security: Allure report is public
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
});

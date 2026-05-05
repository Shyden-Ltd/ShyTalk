import { defineConfig } from "@playwright/test";

/**
 * Integration test runner configuration.
 *
 * Distinct from `playwright.config.ts` (browser/web tests) because:
 *   - testDir is `tests/integration` not `tests/web`
 *   - globalSetup probes the local stack, not browser auth
 *   - no browser binary is required (these tests are HTTP/RTC, no UI)
 *   - reports go to a separate Allure folder so the dashboards don't
 *     mix browser test runs with API integration runs
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md`.
 *
 * Run with:
 *   npm run test:integration       # locally, requires `bash local/start.sh` first
 *   npm run test:integration:ci    # CI wrapper that brings up the stack
 */

const reporters: any[] = [
  ["list"],
  ["html", { outputFolder: "playwright-report-integration" }],
  ["junit", { outputFile: "playwright-results-integration.xml" }],
];
if (process.env.ALLURE_ENABLED === "true") {
  reporters.push([
    "allure-playwright",
    {
      outputFolder: `allure-results/${process.env.ALLURE_PROJECT || "integration"}`,
      suiteTitle: true,
      detail: false,
    },
  ]);
}

export default defineConfig({
  testDir: "./tests/integration",
  globalSetup: "./tests/integration/global-setup.ts",
  // Integration tests must be deterministic — no retries.
  // A flaky integration test masks a real cross-system regression.
  retries: 0,
  // Worker count: 1 to avoid Firebase Emulator + LiveKit Docker
  // contention. Bump only after confirming the local stack handles
  // parallelism without races.
  workers: 1,
  // 30s default. Per-test override available for cron-trigger tests.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: reporters,
  use: {
    // Integration tests are API-driven (HTTP, RTC, RTDB). No browser.
    // Setting browserName to undefined avoids launching a browser binary.
    baseURL: process.env.API_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "integration",
      // No browserName means no browser is launched — the test runner
      // executes Node-side code that talks to the local stack via HTTP.
    },
  ],
});

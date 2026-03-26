import { test, expect } from "@playwright/test";

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/");
  });

  test("loads with correct title", async ({ page }) => {
    await expect(page).toHaveTitle(/ShyTalk Admin/i);
  });

  test("shows login screen with Sign In button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });

  test("has email and password inputs", async ({ page }) => {
    const emailInput = page.locator(
      '#login-screen input[type="email"], #login-screen input[placeholder*="mail" i]',
    );
    const passwordInput = page.locator('#login-screen input[type="password"]');
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
  });

  test("login box has admin panel heading", async ({ page }) => {
    const heading = page.locator(".login-box h2");
    await expect(heading).toBeVisible();
    await expect(heading).toContainText("Admin");
  });

  test("shows correct API endpoint from config", async ({ page }) => {
    const apiBase = await page.evaluate(
      () => (window as any).SHYTALK_CONFIG?.API_BASE,
    );
    expect(apiBase).toBeTruthy();
    // In CI/local mode the API_BASE is localhost; in dev/prod it's the domain
    expect(apiBase).toMatch(/shytalk\.shyden\.co\.uk|localhost/);
  });

  test("has Firebase config loaded", async ({ page }) => {
    const firebaseConfig = await page.evaluate(
      () => (window as any).SHYTALK_CONFIG?.FIREBASE_CONFIG,
    );
    expect(firebaseConfig).toBeTruthy();
    expect(firebaseConfig.projectId).toBeTruthy();
  });

  test("dashboard screen exists but is hidden before login", async ({
    page,
  }) => {
    const dashboard = page.locator("#dashboard-screen");
    await expect(dashboard).not.toBeVisible();
  });

  test("dashboard has all expected tab buttons", async ({ page }) => {
    const expectedTabs = [
      "tab-users",
      "tab-appeals",
      "tab-reports",
      "tab-gifts",
      "tab-economy",
      "tab-maintenance",
      "tab-monitor",
      "tab-banners",
      "tab-funfacts",
      "tab-backups",
      "tab-logs",
      "tab-devices",
      "tab-starting-screens",
    ];
    for (const tabId of expectedTabs) {
      const tab = page.locator(`#${tabId}`);
      await expect(tab).toBeAttached();
    }
  });

  test("loads logger script with admin-panel source", async ({ page }) => {
    const loggerLoaded = await page.evaluate(
      () => typeof (window as any).ShyTalkLogger !== "undefined",
    );
    expect(loggerLoaded).toBe(true);
  });

  test("login screen shows error area for failed login", async ({ page }) => {
    const errorArea = page.locator("#login-error, .login-error");
    await expect(errorArea).toBeAttached();
  });
});

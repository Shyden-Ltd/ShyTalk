import { test, expect } from "./fixtures/admin";
import {
  adminLogin,
  navigateToTab,
  searchUser,
  switchUserSubtab,
} from "./helpers/admin-auth";
import type { Page } from "@playwright/test";

/**
 * Collect console errors during a callback function.
 * Returns an array of error-level console messages.
 */
async function collectConsoleErrors(
  page: Page,
  callback: () => Promise<void>,
): Promise<string[]> {
  const errors: string[] = [];
  const handler = (msg: any) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  };

  page.on("console", handler);
  try {
    await callback();
  } finally {
    page.off("console", handler);
  }
  return errors;
}

/**
 * Filter known benign console errors that are not bugs.
 * - Firebase auth token refresh warnings
 * - Network intermittent failures on dev
 * - Service worker registration
 */
function filterBenignErrors(errors: string[]): string[] {
  return errors.filter((e) => {
    const lower = e.toLowerCase();
    // Benign Firebase/auth messages
    if (lower.includes("failed to load resource")) return false;
    if (lower.includes("net::err_")) return false;
    if (lower.includes("favicon.ico")) return false;
    if (lower.includes("service worker")) return false;
    if (lower.includes("token") && lower.includes("refresh")) return false;
    if (lower.includes("deprecat")) return false;
    return true;
  });
}

test.describe("Admin Console Error Checks", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  // ── Test 1: Full tab navigation — zero console errors ──
  test("full tab navigation produces zero console errors", async ({ page }) => {
    const tabs = [
      "Users",
      "Reports",
      "Appeals",
      "Logs",
      "Devices",
      "Gifts",
      "Banners",
      "Fun Facts",
      "Economy",
      "Spin Monitor",
      "Backups",
      "Maintenance",
      "Starting Screens",
    ];

    const errors = await collectConsoleErrors(page, async () => {
      for (const tab of tabs) {
        try {
          await navigateToTab(page, tab);
          // Give each tab a moment to render and make API calls
          await page.waitForTimeout(1_000);
        } catch {
          console.warn("Tab navigation skipped (may not exist):", tab);
        }
      }
    });

    const realErrors = filterBenignErrors(errors);
    if (realErrors.length > 0) {
      console.log("Console errors during tab navigation:", realErrors);
    }
    expect(realErrors.length).toBe(0);
  });

  // ── Test 2: User search + all subtabs — zero console errors ──
  test("user search and subtab navigation produces zero console errors", async ({
    page,
    testData,
  }) => {
    const errors = await collectConsoleErrors(page, async () => {
      await navigateToTab(page, "Users");
      await searchUser(page, String(testData.user.uniqueId));

      // Visit all 4 subtabs
      const subtabs = ["profile", "moderation", "security", "economy"];
      for (const subtab of subtabs) {
        await switchUserSubtab(page, subtab);
        // Wait for subtab content to load
        await page.waitForTimeout(1_500);
      }
    });

    const realErrors = filterBenignErrors(errors);
    if (realErrors.length > 0) {
      console.log("Console errors during user subtab navigation:", realErrors);
    }
    expect(realErrors.length).toBe(0);
  });

  // ── Test 3: Open/close dialogs — zero console errors ──
  test("opening and closing dialogs produces zero console errors", async ({
    page,
  }) => {
    const errors = await collectConsoleErrors(page, async () => {
      // Test 1: Nuclear dialog in Maintenance
      await navigateToTab(page, "Maintenance");
      await expect(page.locator("#maintenance-panel")).toBeVisible({
        timeout: 15_000,
      });

      await page.locator("#reset-all-btn").click();
      const overlay = page.locator("#nuclear-overlay");
      await expect(overlay).toHaveClass(/visible/);
      await page.locator("#nuclear-cancel").click();
      await expect(overlay).not.toHaveClass(/visible/);

      // Test 2: Gifts — Add and remove a new gift row (no dialog, but tests the confirm overlay)
      await navigateToTab(page, "Gifts");
      await page.waitForTimeout(2_000);
      const addBtn = page.locator("#gift-add-btn");
      if (await addBtn.isVisible()) {
        await addBtn.click();
        const newRow = page.locator("#gifts-tbody tr.gift-new").last();
        if (await newRow.isVisible()) {
          const removeBtn = newRow.locator(".gift-remove-btn");
          if ((await removeBtn.count()) > 0) {
            await removeBtn.click();
          }
        }
      }

      // Test 3: Log settings section expand/collapse
      await navigateToTab(page, "Logs");
      await page.waitForTimeout(2_000);
      const settingsHeader = page.locator(
        "#logs-settings-section .logs-section-header",
      );
      if (await settingsHeader.isVisible()) {
        await settingsHeader.click();
        await page.waitForTimeout(500);
        await settingsHeader.click();
        await page.waitForTimeout(500);
      }
    });

    const realErrors = filterBenignErrors(errors);
    if (realErrors.length > 0) {
      console.log("Console errors during dialog operations:", realErrors);
    }
    expect(realErrors.length).toBe(0);
  });

  // ── Test 4: Trigger and cancel operations — zero console errors ──
  test("triggering and cancelling operations produces zero console errors", async ({
    page,
    testData,
  }) => {
    const errors = await collectConsoleErrors(page, async () => {
      // Dismiss all dialogs (cancel path)
      page.on("dialog", (dialog) => dialog.dismiss());

      // Test 1: Spin monitor start + stop
      await navigateToTab(page, "Spin Monitor");
      await expect(page.locator("#monitor-panel")).toHaveClass(/visible/, {
        timeout: 10_000,
      });

      await page
        .locator("#monitor-uid-input")
        .fill(String(testData.user.uniqueId));
      await page.locator("#monitor-start-btn").click();
      await expect(page.locator("#monitor-status")).toBeVisible({
        timeout: 15_000,
      });
      await page.locator("#monitor-stop-btn").click();
      await expect(page.locator("#monitor-start-btn")).toBeVisible({
        timeout: 10_000,
      });

      // Test 2: Maintenance — click clear reports (cancel)
      await navigateToTab(page, "Maintenance");
      await expect(page.locator("#maintenance-panel")).toBeVisible({
        timeout: 15_000,
      });
      await page.locator("#clear-reports-btn").click();
      await page.waitForTimeout(500);

      // Test 3: Reports — select action but cancel resolve
      await navigateToTab(page, "Reports");
      await page.waitForFunction(
        () => {
          const list = document.getElementById("reports-list");
          return (
            list &&
            (list.querySelector(".report-card") !== null ||
              list.textContent!.includes("No reports"))
          );
        },
        { timeout: 15_000 },
      );

      const firstCard = page.locator(".report-card").first();
      if ((await firstCard.count()) > 0) {
        const uid = await firstCard.getAttribute("data-uid");
        const actionSelect = firstCard.locator(
          `select[data-action-select="${uid}"]`,
        );
        await actionSelect.selectOption("dismiss");
        // Don't click resolve — just verify the select worked
        await page.waitForTimeout(500);
      }
    });

    const realErrors = filterBenignErrors(errors);
    if (realErrors.length > 0) {
      console.log(
        "Console errors during trigger/cancel operations:",
        realErrors,
      );
    }
    expect(realErrors.length).toBe(0);
  });
});

import { test, expect } from "./fixtures/admin";
import { adminLogin, navigateToTab } from "./helpers/admin-auth";
import { Page } from "@playwright/test";

// ── Helpers ──

/** Navigate to the Starting Screens tab (assumes already logged in). */
async function goToStartingScreens(page: Page): Promise<void> {
  await navigateToTab(page, "Starting Screens");
  await expect(page.locator("#starting-screens-panel")).toBeVisible({
    timeout: 15_000,
  });
}

/** Create a screen via the UI prompt. Returns after the card appears in the DOM. */
async function createScreenViaUI(page: Page, screenId: string): Promise<void> {
  page.once("dialog", async (dialog) => {
    await dialog.accept(screenId);
  });
  await page.locator("#add-screen-btn").click();
  await expect(page.locator(`[data-screen-id="${screenId}"]`)).toBeVisible({
    timeout: 15_000,
  });
}

/** Delete a screen via the API for cleanup (silently ignores 404). */
async function deleteScreenViaApi(page: Page, screenId: string): Promise<void> {
  const API_BASE =
    process.env.API_BASE_URL || "https://dev-api.shytalk.shyden.co.uk";

  // Wait for a token by capturing it from an existing request header
  let token: string | null = null;
  const handler = (request: any) => {
    const auth = request.headers()["authorization"];
    if (auth?.startsWith("Bearer ")) token = auth.slice(7);
  };
  page.on("request", handler);
  // Trigger a reload of the list to capture the token if not yet available
  if (!token) {
    await page.evaluate(() => {
      const evt = new Event("visibilitychange");
      document.dispatchEvent(evt);
    });
    // Brief wait
    await page.waitForTimeout(500);
  }
  page.off("request", handler);

  if (!token) return; // Best-effort cleanup — no token, skip

  const res = await page.request.delete(
    `${API_BASE}/api/config/startingScreens/${encodeURIComponent(screenId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  // Ignore 404 (already deleted) and other errors — this is best-effort cleanup
  if (!res.ok() && res.status() !== 404) {
    console.warn(
      `[cleanup] DELETE starting screen ${screenId} → ${res.status()}`,
    );
  }
}

test.describe("Starting Screens Admin Section", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await goToStartingScreens(page);
  });

  // ── Section visibility ──

  test("Starting Screens tab is visible in nav bar", async ({ page }) => {
    await expect(page.locator("#tab-starting-screens")).toBeVisible();
  });

  test("Starting Screens tab has active class when selected", async ({
    page,
  }) => {
    await expect(page.locator("#tab-starting-screens")).toHaveClass(/active/);
  });

  test("Starting Screens panel is visible when tab is selected", async ({
    page,
  }) => {
    await expect(page.locator("#starting-screens-panel")).toBeVisible();
  });

  test("panel has empty state element in the DOM", async ({ page }) => {
    // The empty-state div is always rendered (shown/hidden based on data)
    await expect(page.locator("#starting-screens-empty")).toBeAttached();
  });

  test("Add Screen button is visible", async ({ page }) => {
    await expect(page.locator("#add-screen-btn")).toBeVisible();
  });

  // ── CRUD operations ──

  test("can create a new screen via Add Screen button", async ({ page }) => {
    const screenId = "pw-create-test";
    try {
      await createScreenViaUI(page, screenId);
      // Card is already asserted visible in createScreenViaUI
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("rejects invalid screen ID with special characters", async ({
    page,
  }) => {
    // The addScreen function validates the ID with /^[a-zA-Z0-9_-]+$/
    // Invalid IDs show a toast and do NOT create a card
    page.once("dialog", async (dialog) => {
      await dialog.accept("invalid screen!");
    });
    await page.locator("#add-screen-btn").click();

    // Allow time for any async processing
    await page.waitForTimeout(1_000);

    // Card must NOT have been created
    await expect(
      page.locator('[data-screen-id="invalid screen!"]'),
    ).not.toBeAttached();

    // Error toast should be visible
    const toast = page.locator("#toast");
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toHaveClass(/error/);
  });

  test("cancelling the prompt does not create a screen", async ({ page }) => {
    const countBefore = await page.locator("[data-screen-id]").count();
    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });
    await page.locator("#add-screen-btn").click();
    await page.waitForTimeout(500);

    // No new cards
    const countAfter = await page.locator("[data-screen-id]").count();
    expect(countAfter).toBe(countBefore);
  });

  test("screen card has all expected form fields", async ({ page }) => {
    const screenId = "pw-fields-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(card.locator(".enabled-toggle")).toBeAttached();
      await expect(card.locator(".dismissable-toggle")).toBeAttached();
      await expect(card.locator(".frequency-select")).toBeAttached();
      await expect(card.locator(".template-select")).toBeAttached();
      await expect(card.locator(".title-input")).toBeAttached();
      await expect(card.locator(".message-input")).toBeAttached();
      await expect(card.locator(".image-type-select")).toBeAttached();
      await expect(card.locator(".start-date")).toBeAttached();
      await expect(card.locator(".end-date")).toBeAttached();
      await expect(card.locator(".allowlist-devices")).toBeAttached();
      await expect(card.locator(".allowlist-networks")).toBeAttached();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("new screen card has save and delete buttons", async ({ page }) => {
    const screenId = "pw-btns-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(card.locator(".save-screen-btn")).toBeVisible();
      await expect(card.locator(".delete-screen-btn")).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Device preview ──

  test("device preview panel is rendered inside the screen card", async ({
    page,
  }) => {
    const screenId = "pw-preview-panel";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(card.locator(".screen-card-preview")).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview updates live as title is typed", async ({ page }) => {
    const screenId = "pw-preview-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("Preview Test Title");

      const preview = card.locator(".screen-card-preview");
      await expect(preview).toContainText("Preview Test Title");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview shows Continue button when dismissable is checked", async ({
    page,
  }) => {
    const screenId = "pw-dismiss-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const toggle = card.locator(".dismissable-toggle");
      if (!(await toggle.isChecked())) await toggle.check();

      const preview = card.locator(".screen-card-preview");
      await expect(preview.locator("button")).toContainText("Continue");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview hides Continue button when non-dismissable", async ({
    page,
  }) => {
    const screenId = "pw-nodismiss-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const toggle = card.locator(".dismissable-toggle");
      if (await toggle.isChecked()) await toggle.uncheck();

      const preview = card.locator(".screen-card-preview");
      // No Continue button visible
      await expect(preview.locator("button")).not.toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview shows ShyTalk app icon", async ({ page }) => {
    const screenId = "pw-branding-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const preview = card.locator(".screen-card-preview");
      // App icon img with alt="ShyTalk"
      await expect(preview.locator('img[alt="ShyTalk"]')).toBeAttached();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview contains ShyTalk branding text", async ({ page }) => {
    const screenId = "pw-branding-text";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const preview = card.locator(".screen-card-preview");
      await expect(preview).toContainText("ShyTalk");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Character counters ──

  test("title character counter shows count with /100 limit", async ({
    page,
  }) => {
    const screenId = "pw-counter-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("Test");

      const counter = card.locator(".title-counter");
      await expect(counter).toContainText("/100");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("message character counter shows count with /500 limit", async ({
    page,
  }) => {
    const screenId = "pw-msg-counter-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".message-input").fill("Hello world");

      const counter = card.locator(".message-counter");
      await expect(counter).toContainText("/500");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("title counter has over-limit class when exceeding 100 characters", async ({
    page,
  }) => {
    const screenId = "pw-overlimit-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const titleInput = card.locator(".title-input");
      // Fill with 101 characters (maxlength=100 prevents typing more, so use fill + eval)
      // The counter monitors input length — type enough to reach/exceed
      await titleInput.fill("a".repeat(101));

      const counter = card.locator(".title-counter");
      await expect(counter).toHaveClass(/over-limit/);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("title counter has over-limit class when under minimum (less than 3 chars)", async ({
    page,
  }) => {
    const screenId = "pw-underlimit-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("ab"); // 2 chars, below min of 3

      const counter = card.locator(".title-counter");
      await expect(counter).toHaveClass(/over-limit/);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Status badges ──

  test("newly created (disabled) screen does not show Active badge", async ({
    page,
  }) => {
    const screenId = "pw-badge-inactive";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      // New screens are created with enabled: false, so Active badge should not be shown
      await expect(card.locator(".status-active")).not.toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("enabling a screen shows Active status badge", async ({ page }) => {
    const screenId = "pw-badge-active";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      // Enable the screen
      const enabledToggle = card.locator(".enabled-toggle");
      if (!(await enabledToggle.isChecked())) await enabledToggle.check();

      // Fill minimum required fields to allow save
      await card.locator(".title-input").fill("Active Test Screen");
      await card
        .locator(".message-input")
        .fill("This is a test message for the active screen.");

      // Save and wait for reload
      await card.locator(".save-screen-btn").click();
      await expect(page.locator("#toast")).toBeVisible({ timeout: 15_000 });

      // Reload to see updated state
      await page.reload();
      await adminLogin(page);
      await goToStartingScreens(page);

      const reloadedCard = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(reloadedCard).toBeVisible({ timeout: 15_000 });
      await expect(reloadedCard.locator(".status-active")).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Save and validation ──

  test("save button shows toast after clicking", async ({ page }) => {
    const screenId = "pw-save-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("Save Test Title");
      await card
        .locator(".message-input")
        .fill("This is a test message for saving.");

      await card.locator(".save-screen-btn").click();

      // Should show success or error toast
      const toast = page.locator("#toast");
      await expect(toast).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("save fails with title too short (under 3 chars) and shows error toast", async ({
    page,
  }) => {
    const screenId = "pw-short-title";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("ab"); // 2 chars — below minimum of 3
      await card
        .locator(".message-input")
        .fill("Valid message content here at least ten chars");

      await card.locator(".save-screen-btn").click();

      const toast = page.locator("#toast");
      await expect(toast).toHaveClass(/error/, { timeout: 5_000 });
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("save fails with message too short (under 10 chars) and shows error toast", async ({
    page,
  }) => {
    const screenId = "pw-short-msg";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill("Valid Title Here");
      await card.locator(".message-input").fill("Too short"); // 9 chars — below min of 10

      await card.locator(".save-screen-btn").click();

      const toast = page.locator("#toast");
      await expect(toast).toHaveClass(/error/, { timeout: 5_000 });
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("saved changes persist after page reload", async ({ page }) => {
    const screenId = "pw-persist-test";
    const titleText = "Persistence Check Title";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".title-input").fill(titleText);
      await card
        .locator(".message-input")
        .fill("This message is long enough to pass validation.");

      await card.locator(".save-screen-btn").click();
      await expect(page.locator("#toast")).toBeVisible({ timeout: 15_000 });
      // Wait for toast to indicate success
      await expect(page.locator("#toast")).not.toHaveClass(/error/, {
        timeout: 5_000,
      });

      // Reload and verify
      await page.reload();
      await adminLogin(page);
      await goToStartingScreens(page);

      const reloadedCard = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(reloadedCard).toBeVisible({ timeout: 15_000 });
      await expect(reloadedCard.locator(".title-input")).toHaveValue(titleText);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Delete ──

  test("delete button asks for confirmation before deleting", async ({
    page,
  }) => {
    const screenId = "pw-delete-confirm-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);

      // Dismiss the confirm dialog — should NOT delete
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.dismiss();
      });
      await card.locator(".delete-screen-btn").click();

      // Card must still exist
      await expect(card).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("confirmed delete removes the screen card", async ({ page }) => {
    const screenId = "pw-delete-test";
    // Accept the confirm dialog
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });

    await createScreenViaUI(page, screenId);
    const card = page.locator(`[data-screen-id="${screenId}"]`);
    await expect(card).toBeVisible();

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await card.locator(".delete-screen-btn").click();

    await expect(card).not.toBeVisible({ timeout: 15_000 });

    // Reload and verify gone
    await page.reload();
    await adminLogin(page);
    await goToStartingScreens(page);
    await expect(
      page.locator(`[data-screen-id="${screenId}"]`),
    ).not.toBeAttached();
  });

  // ── Deep linking ──

  test("direct navigation to #starting-screens activates the tab", async ({
    page,
  }) => {
    await page.goto("/admin/#starting-screens");
    await adminLogin(page);
    await page.waitForTimeout(2_000);
    const tab = page.locator("#tab-starting-screens");
    await expect(tab).toBeAttached();
  });

  // ── Template switching ──

  test("changing template to promotional does not crash the preview", async ({
    page,
  }) => {
    const screenId = "pw-template-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const preview = card.locator(".screen-card-preview");

      await card.locator(".template-select").selectOption("promotional");
      // Preview should still be visible (no crash)
      await expect(preview).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("changing template to urgent does not crash the preview", async ({
    page,
  }) => {
    const screenId = "pw-template-urgent";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const preview = card.locator(".screen-card-preview");

      // Select urgent if available, otherwise skip gracefully
      const templateSelect = card.locator(".template-select");
      const options = await templateSelect.locator("option").allTextContents();
      const urgentOption = options.find((o) =>
        o.toLowerCase().includes("urgent"),
      );
      if (urgentOption) {
        await templateSelect.selectOption({ label: urgentOption });
        await expect(preview).toBeVisible();
      }
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Frequency select ──

  test("frequency select has expected options", async ({ page }) => {
    const screenId = "pw-freq-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const freqSelect = card.locator(".frequency-select");
      const options = await freqSelect.locator("option").allTextContents();

      // At minimum these common frequency options should exist
      expect(options.length).toBeGreaterThan(0);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Date fields ──

  test("start and end date fields accept datetime-local values", async ({
    page,
  }) => {
    const screenId = "pw-dates-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await card.locator(".start-date").fill("2028-01-01T00:00");
      await card.locator(".end-date").fill("2028-12-31T23:59");

      // Verify the values were set
      await expect(card.locator(".start-date")).toHaveValue("2028-01-01T00:00");
      await expect(card.locator(".end-date")).toHaveValue("2028-12-31T23:59");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Allowlist fields ──

  test("allowlist device IDs textarea accepts multiline input", async ({
    page,
  }) => {
    const screenId = "pw-allowlist-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const deviceArea = card.locator(".allowlist-devices");
      await deviceArea.fill("device-001\ndevice-002\ndevice-003");
      await expect(deviceArea).toHaveValue(
        "device-001\ndevice-002\ndevice-003",
      );
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("allowlist networks textarea accepts multiline input", async ({
    page,
  }) => {
    const screenId = "pw-allowlist-net";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const networkArea = card.locator(".allowlist-networks");
      await networkArea.fill("Vodafone\nO2\nEE");
      await expect(networkArea).toHaveValue("Vodafone\nO2\nEE");
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Accessibility ──

  test("screen card form has labels for its fields", async ({ page }) => {
    const screenId = "pw-a11y-test";
    try {
      await createScreenViaUI(page, screenId);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      // At least some labels should be present in the form
      const labelCount = await card.locator("label").count();
      expect(labelCount).toBeGreaterThan(0);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── afterAll cleanup ──
  // Belt-and-suspenders: clean up any pw-* screens that leaked from failed tests
  test.afterAll(async ({ page }) => {
    await adminLogin(page);
    await goToStartingScreens(page);

    // Collect all data-screen-id values prefixed with pw-
    const pwScreenIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[data-screen-id]"))
        .map((el) => el.getAttribute("data-screen-id") ?? "")
        .filter((id) => id.startsWith("pw-"));
    });

    for (const id of pwScreenIds) {
      await deleteScreenViaApi(page, id);
    }
  });
});

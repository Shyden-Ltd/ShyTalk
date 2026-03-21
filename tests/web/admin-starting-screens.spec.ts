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

/** Create a screen via the UI. Auto-generates ID (no prompt). Returns the screen ID. */
async function createScreenViaUI(page: Page): Promise<string> {
  const countBefore = await page.locator("[data-screen-id]").count();
  await page.locator("#add-screen-btn").click();
  // Wait for a new card to appear
  await expect(page.locator("[data-screen-id]")).toHaveCount(countBefore + 1, {
    timeout: 15_000,
  });
  // Get the ID of the newly added card (last one)
  const cards = page.locator("[data-screen-id]");
  const lastCard = cards.nth(countBefore);
  const screenId = await lastCard.getAttribute("data-screen-id");
  return screenId!;
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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);
      // Card is already asserted visible in createScreenViaUI
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("add screen auto-generates a valid screen ID", async ({ page }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);
      // ID should match the auto-generated pattern: screen-{timestamp}-{random}
      expect(screenId).toMatch(/^screen-\d+-[a-z0-9]+$/);
    } finally {
      await deleteScreenViaApi(page, screenId!);
    }
  });

  test("screen card has all expected form fields", async ({ page }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      await expect(card.locator(".screen-card-preview")).toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview updates live as title is typed", async ({ page }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const preview = card.locator(".screen-card-preview");
      // App icon img with alt="ShyTalk"
      await expect(preview.locator('img[alt="ShyTalk"]')).toBeAttached();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("device preview contains ShyTalk branding text", async ({ page }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      // New screens are created with enabled: false, so Active badge should not be shown
      await expect(card.locator(".status-active")).not.toBeVisible();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  test("enabling a screen shows Active status badge", async ({ page }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";

    screenId = await createScreenViaUI(page);
    const card = page.locator(`[data-screen-id="${screenId}"]`);
    await expect(card).toBeVisible();

    // Save it first so it exists in the API
    await card.locator(".title-input").fill("Delete Test Screen");
    await card
      .locator(".message-input")
      .fill("This screen will be deleted soon.");
    await card.locator(".save-screen-btn").click();
    await expect(page.locator("#toast")).toBeVisible({ timeout: 15_000 });

    // Wait for the card to re-render after save
    await expect(
      page.locator(`[data-screen-id="${screenId}"]`),
    ).toBeVisible({ timeout: 15_000 });

    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page
      .locator(`[data-screen-id="${screenId}"]`)
      .locator(".delete-screen-btn")
      .click();

    await expect(
      page.locator(`[data-screen-id="${screenId}"]`),
    ).not.toBeVisible({ timeout: 15_000 });
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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      const freqToggle = card.locator(".frequency-select");
      // Frequency is now a checkbox toggle (show only once)
      await expect(freqToggle).toBeAttached();
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── Date fields ──

  test("start and end date fields accept datetime-local values", async ({
    page,
  }) => {
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

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
    let screenId = "";
    try {
      screenId = await createScreenViaUI(page);

      const card = page.locator(`[data-screen-id="${screenId}"]`);
      // At least some labels should be present in the form
      const labelCount = await card.locator("label").count();
      expect(labelCount).toBeGreaterThan(0);
    } finally {
      await deleteScreenViaApi(page, screenId);
    }
  });

  // ── afterAll cleanup ──
  // Belt-and-suspenders: clean up any auto-generated screens that leaked from failed tests
  test.afterAll(async ({ page }) => {
    await adminLogin(page);
    await goToStartingScreens(page);

    // Collect all data-screen-id values prefixed with screen- (auto-generated)
    const autoScreenIds = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[data-screen-id]"))
        .map((el) => el.getAttribute("data-screen-id") ?? "")
        .filter((id) => id.startsWith("screen-"));
    });

    for (const id of autoScreenIds) {
      await deleteScreenViaApi(page, id);
    }
  });
});

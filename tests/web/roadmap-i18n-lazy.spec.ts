import { test, expect, Page, Route } from "@playwright/test";

/**
 * SHY-0073: lazy item translations + gated GitHub story links.
 *
 * The renderer collects story-derived item strings (from data, not DOM),
 * chunks them ≤50 (the service's PUBLIC_MAX_TEXTS cap), fires all chunks
 * in one Promise.all round, and applies results via text-node swaps.
 * Item badges link to the GitHub story file; non-English visitors get a
 * once-per-session translated confirm dialog (real focus trap; privacy-
 * mode falls back to once-per-page-load). English visitors pay zero
 * translate cost. Failures are fail-silent (English stays) with exactly
 * one console.error — the operator's dev-console surface.
 */

const ITEM = (shyId: string, name: string, status = "Done") => ({
  shyId,
  name,
  status,
  description: null,
  i18n: {},
  slug: "fixture-slug",
});

const FIXTURE = {
  _meta: { schemaVersion: 2, generatedAt: "2026-06-10T11:00:00.000Z" },
  lastUpdated: "2026-06-10",
  currentlyWorkingOn: [],
  phases: [
    {
      title: "Safety & Compliance",
      titleI18n: {},
      status: "in-progress",
      progress: 50,
      features: [{ name: "Legacy feature", status: "done", i18n: {} }],
      items: [
        ITEM("SHY-9001", "Tracked story one"),
        ITEM("SHY-9002", "Tracked story two", "In Progress"),
      ],
    },
  ],
};

/** Fixture with >50 unique item strings to force chunking. */
function bigFixture(count = 60) {
  const f = JSON.parse(JSON.stringify(FIXTURE));
  f.phases[0].items = Array.from({ length: count }, (_, i) =>
    ITEM(`SHY-8${String(i).padStart(3, "0")}`, `Bulk story number ${i}`),
  );
  return f;
}

type TranslateCall = { texts: string[]; target: string };

async function setupPage(
  page: Page,
  {
    fixture = FIXTURE,
    translate = "echo-de",
  }: { fixture?: unknown; translate?: "echo-de" | "fail" | "rate-limit" } = {},
) {
  const consoleErrors: string[] = [];
  const translateCalls: TranslateCall[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  // Popups to GitHub must never hit the real network (offline-safe CI):
  await page
    .context()
    .route("https://github.com/**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html>mock story</html>",
      }),
    );
  await page.route("**/roadmap-data.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixture),
    }),
  );
  await page.route("**/api/translate", async (route: Route) => {
    const body = route.request().postDataJSON() as TranslateCall;
    translateCalls.push(body);
    if (translate === "fail") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"down"}',
      });
    }
    if (translate === "rate-limit") {
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: '{"error":"Too many requests, slow down"}',
      });
    }
    const translations: Record<string, string> = {};
    for (const t of body.texts)
      translations[t] = `[${body.target.toUpperCase()}] ${t}`;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-Translation-Missed": "0" },
      body: JSON.stringify({ translations, missed: [] }),
    });
  });
  await page.goto("/roadmap.html");
  await expect(
    page.locator('[data-testid="phase-card"]').first(),
  ).toBeVisible();
  return { consoleErrors, translateCalls };
}

test.describe("English visitors pay zero translate cost", () => {
  test("no translate request fires and links navigate without a dialog", async ({
    page,
  }) => {
    const { translateCalls } = await setupPage(page);
    // Default locale is en — give any stray async a tick, then assert.
    await page.waitForTimeout(250);
    expect(translateCalls).toHaveLength(0);
    const link = page.locator("a.shy-badge", { hasText: "SHY-9001" });
    await expect(link).toHaveAttribute(
      "href",
      /github\.com\/Shyden-Ltd\/ShyTalk\/blob\/main\/\.project\/stories\/SHY-9001-fixture-slug\.md/,
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });
});

test.describe("non-English lazy translation", () => {
  test.use({ locale: "de" });

  test("item names translate in place; legacy features keep embedded i18n path", async ({
    page,
  }) => {
    await setupPage(page);
    await expect(
      page.locator(".feature-item", { hasText: "[DE] Tracked story one" }),
    ).toHaveCount(1);
    // Legacy feature untouched by the service (no embedded de payload → raw name)
    await expect(
      page.locator(".feature-item", { hasText: "Legacy feature" }),
    ).toHaveCount(1);
  });

  test("in-progress lifted items translate too", async ({ page }) => {
    await setupPage(page);
    await expect(
      page.locator("#in-progress-section .feature-item", {
        hasText: "[DE] Tracked story two",
      }),
    ).toHaveCount(1);
  });

  test(">50 strings chunk into multiple requests fired as one round", async ({
    page,
  }) => {
    const { translateCalls } = await setupPage(page, {
      fixture: bigFixture(60),
    });
    await expect(
      page.locator(".feature-item", { hasText: "[DE] Bulk story number 0" }),
    ).toHaveCount(1);
    expect(translateCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of translateCalls) {
      expect(c.texts.length).toBeLessThanOrEqual(50);
      expect(c.target).toBe("de");
    }
  });

  test("service failure: page keeps English, exactly one console.error, no layout break", async ({
    page,
  }) => {
    const { consoleErrors } = await setupPage(page, { translate: "fail" });
    await page.waitForTimeout(300);
    await expect(
      page.locator(".feature-item", { hasText: "Tracked story one" }),
    ).toHaveCount(1);
    const translateErrors = consoleErrors.filter((e) =>
      e.includes("[translate]"),
    );
    expect(translateErrors).toHaveLength(1);
  });

  test("rate-limited response is fail-silent too", async ({ page }) => {
    const { consoleErrors } = await setupPage(page, {
      translate: "rate-limit",
    });
    await page.waitForTimeout(300);
    await expect(
      page.locator(".feature-item", { hasText: "Tracked story one" }),
    ).toHaveCount(1);
    expect(consoleErrors.filter((e) => e.includes("[translate]"))).toHaveLength(
      1,
    );
  });
});

test.describe("gated story links (non-English)", () => {
  test.use({ locale: "de" });

  test("first click opens a translated confirm dialog; cancel stays; confirm-once unlocks the session", async ({
    page,
    context,
  }) => {
    await setupPage(page);
    const link = page.locator("a.shy-badge", { hasText: "SHY-9001" });
    await link.click();
    const dialog = page.locator(".shy-story-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    // Dialog copy comes from LABELS (translated, not the English template)
    await expect(dialog).not.toContainText("available in English only");

    // Cancel: dialog closes, no new tab
    await dialog.locator('[data-testid="story-dialog-cancel"]').click();
    await expect(dialog).toBeHidden();
    expect(context.pages()).toHaveLength(1);

    // Confirm: navigates (new tab) and arms the session pass
    await link.click();
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.locator('[data-testid="story-dialog-confirm"]').click(),
    ]);
    expect(popup.url()).toContain("SHY-9001-fixture-slug");
    await popup.close();

    // Second link click: no dialog, direct navigation
    const [popup2] = await Promise.all([
      context.waitForEvent("page"),
      page.locator("a.shy-badge", { hasText: "SHY-9002" }).click(),
    ]);
    expect(popup2.url()).toContain("SHY-9002-fixture-slug");
    await expect(page.locator(".shy-story-dialog")).toBeHidden();
  });

  test("dialog focus is trapped and Esc cancels", async ({ page }) => {
    await setupPage(page);
    await page.locator("a.shy-badge", { hasText: "SHY-9001" }).click();
    const dialog = page.locator(".shy-story-dialog");
    await expect(dialog).toBeVisible();
    // Tab cycles within the dialog's two buttons
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focusedInside = await page.evaluate(() => {
      const d = document.querySelector(".shy-story-dialog");
      return d ? d.contains(document.activeElement) : false;
    });
    expect(focusedInside).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("privacy mode (sessionStorage unavailable)", () => {
  test.use({ locale: "fr" });

  test("dialog falls back to once-per-page-load, never blocks navigation", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      // Simulate privacy mode: sessionStorage throws on access.
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("SecurityError: sessionStorage disabled");
        },
      });
    });
    await setupPage(page);
    const link = page.locator("a.shy-badge", { hasText: "SHY-9001" });
    await link.click();
    await expect(page.locator(".shy-story-dialog")).toBeVisible();
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.locator('[data-testid="story-dialog-confirm"]').click(),
    ]);
    expect(popup.url()).toContain("fixture-slug");
  });
});

test.describe("RTL locale", () => {
  test.use({ locale: "ar" });

  test("Arabic translations apply and the dialog renders in the RTL layout", async ({
    page,
  }) => {
    await setupPage(page);
    await expect(
      page.locator(".feature-item", { hasText: "[AR] Tracked story one" }),
    ).toHaveCount(1);
    await page.locator("a.shy-badge", { hasText: "SHY-9001" }).click();
    await expect(page.locator(".shy-story-dialog")).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";
import { adminLogin, navigateToTab } from "./helpers/admin-auth";

/**
 * The admin Support tab, in a real browser — SHY-0387 / SHY-0396.
 *
 * ## Why this file exists
 *
 * On 2026-08-22 this tab rendered NOTHING in chromium, firefox and webkit — no
 * tickets, no empty state, not even "Loading…". One line was responsible:
 *
 *     import { renderEvidence } from "/js/tabs/users.js";   // 404
 *
 * A 404 on an ES module import aborts the whole module, so `init()` never ran.
 * Every unit test stayed green throughout, because they read `support.js` as
 * TEXT — `support-follow-up-reaches-the-admin.test.js` greps the file and
 * asserts it renders follow-ups, which was perfectly true of the source and
 * completely irrelevant to a module the browser refuses to execute.
 *
 * `grep tests/web -e "navigateToTab(page, 'Support')"` returned ZERO hits, so
 * nothing in CI ever opened this tab. It would have merged dead.
 *
 * The first test below is therefore the important one, and it is deliberately
 * boring: the tab loads and shows something. `navigateToTab` waits on
 * `data-module-ready`, which a dead module never sets — so that alone would
 * have caught it.
 *
 * Everything is asserted against the REAL module and the REAL API. The one
 * mocked case is the XSS payload, and it says why in place.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const OPEN_TICKETS = "**/api/support-tickets?status=open**";

/** Two tickets from one person, one of them carrying follow-ups. */
const FIXTURE = {
  tickets: [
    {
      id: "spec-alpha",
      userId: 100000002,
      uniqueId: 100000002,
      category: "payment",
      message: "SPEC ALPHA: my coins never arrived after paying",
      status: "open",
      createdAt: 1755000000000,
      attachments: [],
      messages: [
        {
          message: "SPEC FOLLOWUP: it happened again today",
          addedAt: 1755000600000,
          addedBy: 100000002,
        },
      ],
    },
    {
      id: "spec-bravo",
      userId: 100000002,
      uniqueId: 100000002,
      category: "bug",
      message: "SPEC BRAVO: nobody can hear me in rooms",
      status: "open",
      createdAt: 1755000900000,
      attachments: [],
      messages: [],
    },
  ],
};

const cardFor = (page, needle: string) =>
  page.locator("#support-list > *").filter({ hasText: needle });

test.describe("Admin Support tab", () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  /**
   * The blocker guard. Deliberately makes no claim about CONTENT — a tab that
   * loads and lists nothing is a different (and much smaller) problem than a
   * tab whose JavaScript never ran at all.
   */
  test("the tab actually loads — its module runs and nothing 404s", async ({
    page,
  }) => {
    const notFound: string[] = [];
    page.on("response", (r) => {
      const u = r.url();
      if (r.status() >= 400 && /\/(admin\/)?js\//.test(u))
        notFound.push(`${r.status()} ${u}`);
    });
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    // Throws if `data-module-ready` is never set — which is exactly what a
    // module aborted by a failed import looks like.
    await navigateToTab(page, "Support");

    expect(
      notFound,
      "an admin module failed to load; a 404 import kills the whole tab",
    ).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await expect(page.locator("#support-panel")).toHaveAttribute(
      "data-module-ready",
      "true",
    );
  });

  test("two requests from one person are shown as two separate tickets", async ({
    page,
  }) => {
    await page.route(OPEN_TICKETS, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FIXTURE),
      }),
    );
    await navigateToTab(page, "Support");

    // SHY-0396 allows a second request, so an admin has to be able to tell them
    // apart. One card containing both would mean the two problems are triaged
    // as one, which is the outcome the refusal used to cause by another route.
    await expect(cardFor(page, "SPEC ALPHA")).toHaveCount(1);
    await expect(cardFor(page, "SPEC BRAVO")).toHaveCount(1);
    await expect(cardFor(page, "SPEC ALPHA")).not.toContainText("SPEC BRAVO");
  });

  /**
   * SHY-0396's whole point at the admin end. The append endpoint was built,
   * tested and green while nothing displayed `messages`, so somebody choosing
   * "it is the problem I already reported" wrote their words into Firestore
   * where no human would ever read them.
   */
  test("a follow-up is shown under the original message", async ({ page }) => {
    await page.route(OPEN_TICKETS, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FIXTURE),
      }),
    );
    await navigateToTab(page, "Support");

    const card = cardFor(page, "SPEC ALPHA");
    await expect(card).toContainText("SPEC FOLLOWUP: it happened again today");

    // Asserted on POSITION, not merely presence: a follow-up rendered above the
    // message it follows reads as a separate report.
    const original = card.locator("div", { hasText: "SPEC ALPHA" }).last();
    const followUp = card.locator("div", { hasText: "SPEC FOLLOWUP" }).last();
    const oy = (await original.boundingBox())!.y;
    const fy = (await followUp.boundingBox())!.y;
    expect(
      fy,
      "the follow-up must render BELOW the original message",
    ).toBeGreaterThan(oy);
  });

  /**
   * The element is `white-space: pre-wrap`, so the template literal's own SOURCE
   * indentation renders as leading spaces. It shipped once: follow-ups were
   * pushed ~90px right with blank gaps between them, while the original message
   * — a single source line — was unaffected.
   */
  test("a follow-up carries no leading whitespace from the source", async ({
    page,
  }) => {
    await page.route(OPEN_TICKETS, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FIXTURE),
      }),
    );
    await navigateToTab(page, "Support");

    const text = await cardFor(page, "SPEC ALPHA")
      .locator("div", { hasText: "SPEC FOLLOWUP" })
      .last()
      .textContent();
    expect(text).toBe("SPEC FOLLOWUP: it happened again today");
  });

  /**
   * A follow-up is untrusted text typed by the same person into the same queue
   * as the original message, which was already escaped. Mocked because the API
   * would store the payload verbatim and this must not depend on seeding one.
   */
  test("HTML inside a follow-up renders as text, never as markup", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__xss_executed = false;
    });
    await page.route(OPEN_TICKETS, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tickets: [
            {
              ...FIXTURE.tickets[0],
              messages: [
                {
                  message:
                    "SPEC XSS <img src=x onerror=window.__xss_executed=true> <b>notbold</b>",
                  addedAt: 1755000600000,
                  addedBy: 100000002,
                },
              ],
            },
          ],
        }),
      }),
    );
    await navigateToTab(page, "Support");

    const card = cardFor(page, "SPEC ALPHA");
    await expect(card).toContainText(
      "<img src=x onerror=window.__xss_executed=true>",
    );
    expect(await card.locator("img").count()).toBe(0);
    expect(await card.locator("b").count()).toBe(0);
    expect(await page.evaluate(() => (window as any).__xss_executed)).toBe(
      false,
    );
  });

  /**
   * `apiCall(method, path, body)` — passing the path alone put it in the METHOD
   * slot and left `path` undefined, so every card showed a red "Attachments
   * could not be loaded", INCLUDING tickets with no attachments, and no request
   * ever reached the wire.
   */
  test("a ticket with no attachments shows no attachment error", async ({
    page,
  }) => {
    await page.route(OPEN_TICKETS, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FIXTURE),
      }),
    );
    const attachmentCalls: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/support-tickets\/[^/]+\/attachments/.test(r.url()))
        attachmentCalls.push(r.url());
    });

    await navigateToTab(page, "Support");
    await expect(cardFor(page, "SPEC ALPHA")).toBeVisible();

    await expect(page.locator("#support-list")).not.toContainText(
      "Attachments could not be loaded",
    );
    // The request has to be MADE, or "no error shown" would also be satisfied by
    // never asking — which is what the broken arity actually did.
    expect(
      attachmentCalls.length,
      "the attachments endpoint was never called",
    ).toBeGreaterThan(0);
  });
});

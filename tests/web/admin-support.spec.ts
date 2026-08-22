import { test, expect, type Page } from "@playwright/test";
import { adminLogin, navigateToTab } from "./helpers/admin-auth";
import { AdminApi } from "./helpers/api";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The admin Support tab, in a real browser, against the real stack — SHY-0387 /
 * SHY-0396.
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
 * TEXT — a source-scanning guard can only prove what the source SAYS, never
 * that a browser will execute it.
 *
 * `grep tests/web -e "navigateToTab(page, 'Support')"` returned ZERO hits, so
 * nothing in CI ever opened this tab. It would have merged dead.
 *
 * ## No mocks
 *
 * Every ticket below is raised through the REAL API and read back from the REAL
 * admin queue. An earlier draft used `page.route` to stub the list, and the
 * no-new-stubs ratchet refused it — correctly. A stubbed list would have proved
 * that the renderer can render a fixture, which is not the thing that broke.
 * The bug was in the seam between a real response and a real module, and only
 * real data crosses it.
 *
 * See [[feedback-assert-the-seam-not-the-sides]] and
 * [[feedback-no-stubs-mocks-fakes-real-only]].
 */

/** Unique per run, so parallel projects cannot read each other's tickets. */
const marker = () =>
  `SPEC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const cardFor = (page: Page, needle: string) =>
  page.locator("#support-list > *").filter({ hasText: needle });

/** Raise a ticket as the signed-in admin, and optionally add a follow-up. */
async function uploadFixture(
  api: AdminApi,
  page: Page,
  file: string,
  contentType: string,
): Promise<string> {
  // The real signed-URL path, with real bytes — the same three steps the app
  // takes. A stub here would prove the renderer can render a fixture, which is
  // not the thing that breaks.
  const slot = await api.post("/api/support-tickets/upload-url", {
    contentType,
  });
  const put = await page.request.put(slot.uploadUrl, {
    headers: { "Content-Type": contentType },
    data: readFileSync(resolve(file)),
  });
  expect(put.ok(), `uploading ${file} failed with ${put.status()}`).toBe(true);
  return slot.r2Key;
}

async function seedTicket(
  api: AdminApi,
  message: string,
  opts: { category?: string; followUp?: string; attachments?: string[] } = {},
): Promise<string> {
  const raised = await api.post("/api/support-tickets", {
    message,
    category: opts.category ?? "bug",
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  });
  const id = raised.ticketId;
  expect(id, "the API did not return a ticket id").toBeTruthy();
  if (opts.followUp) {
    await api.post(`/api/support-tickets/${id}/messages`, {
      message: opts.followUp,
    });
  }
  return id;
}

test.describe("Admin Support tab", () => {
  let api: AdminApi;

  test.beforeEach(async ({ page }) => {
    // Constructed BEFORE the login navigation: it captures the bearer token off
    // the first authenticated request, and the panel fires those on load.
    api = new AdminApi(page);
    await adminLogin(page);
    await api.waitForToken();
  });

  /**
   * The blocker guard. Deliberately makes no claim about CONTENT — a tab that
   * loads and lists nothing is a different, much smaller problem than a tab
   * whose JavaScript never ran at all.
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
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // Throws if `data-module-ready` is never set — exactly what a module
    // aborted by a failed import looks like.
    await navigateToTab(page, "Support");

    expect(
      notFound,
      "an admin module failed to load; a 404 import kills the whole tab",
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
    await expect(page.locator("#support-panel")).toHaveAttribute(
      "data-module-ready",
      "true",
    );
  });

  test("two requests from one person are shown as two separate tickets", async ({
    page,
  }) => {
    const alpha = `${marker()} ALPHA my coins never arrived`;
    const bravo = `${marker()} BRAVO nobody can hear me in rooms`;
    await seedTicket(api, alpha, { category: "payment" });
    await seedTicket(api, bravo, { category: "bug" });

    await navigateToTab(page, "Support");

    // SHY-0396 allows a second request, so an admin has to be able to tell them
    // apart. One card holding both would mean two problems triaged as one —
    // the outcome the refusal used to cause by another route.
    await expect(cardFor(page, alpha)).toHaveCount(1);
    await expect(cardFor(page, bravo)).toHaveCount(1);
    await expect(cardFor(page, alpha)).not.toContainText(bravo);
  });

  /**
   * SHY-0396's whole point at the admin end. The append endpoint was built,
   * tested and green while nothing displayed `messages`, so somebody choosing
   * "it is the problem I already reported" wrote their words into Firestore
   * where no human would ever read them.
   */
  test("a follow-up is shown under the original message", async ({ page }) => {
    const original = `${marker()} original message`;
    const followUp = `${marker()} it happened again today`;
    await seedTicket(api, original, { followUp });

    await navigateToTab(page, "Support");
    const card = cardFor(page, original);
    await expect(card).toContainText(followUp);

    // Asserted on POSITION, not merely presence: a follow-up rendered above the
    // message it follows reads as a separate report.
    const oy = (await card
      .locator("div", { hasText: original })
      .last()
      .boundingBox())!.y;
    const fy = (await card
      .locator("div", { hasText: followUp })
      .last()
      .boundingBox())!.y;
    expect(
      fy,
      "the follow-up must render BELOW the original message",
    ).toBeGreaterThan(oy);
  });

  /**
   * The element is `white-space: pre-wrap`, so the template literal's own SOURCE
   * indentation renders as leading spaces. It shipped once: follow-ups were
   * pushed ~90px right with blank gaps, while the original message — a single
   * source line — was unaffected, which is why it was easy to miss.
   */
  test("a follow-up carries no leading whitespace from the source", async ({
    page,
  }) => {
    const original = `${marker()} original for whitespace`;
    const followUp = `${marker()} follow-up for whitespace`;
    await seedTicket(api, original, { followUp });

    await navigateToTab(page, "Support");
    const text = await cardFor(page, original)
      .locator("div", { hasText: followUp })
      .last()
      .textContent();
    expect(text).toBe(followUp);
  });

  /**
   * A follow-up is untrusted text typed by the same person into the same queue
   * as the original message, which was already escaped. Stored through the real
   * API, which keeps it verbatim — so this proves the RENDERER escapes it, not
   * that a fixture happened to contain entities.
   */
  test("HTML inside a follow-up renders as text, never as markup", async ({
    page,
  }) => {
    const original = `${marker()} original for xss`;
    const payload = `${marker()} <img src=x onerror=window.__xss_executed=true> <b>notbold</b>`;
    await seedTicket(api, original, { followUp: payload });

    await page.addInitScript(() => {
      (window as any).__xss_executed = false;
    });
    await navigateToTab(page, "Support");

    const card = cardFor(page, original);
    await expect(card).toContainText(
      "<img src=x onerror=window.__xss_executed=true>",
    );
    expect(await card.locator("img").count()).toBe(0);
    expect(await card.locator("b").count()).toBe(0);
    // "Did not become true", not "is false": `addInitScript` runs only on
    // NAVIGATION and reaching this tab is a click, so the sentinel is
    // legitimately undefined. Comparing to `false` would fail on the SAFE
    // outcome, which is the kind of assertion that gets weakened rather than
    // fixed.
    expect(
      await page.evaluate(() => (window as any).__xss_executed === true),
    ).toBe(false);
  });

  /**
   * `apiCall(method, path, body)` — passing the path alone put it in the METHOD
   * slot and left `path` undefined, so every card showed a red "Attachments
   * could not be loaded", INCLUDING tickets with no attachments, and no request
   * ever reached the wire.
   */
  /**
   * The admin has to be able to WATCH what somebody sent, with sound.
   *
   * The grid thumbnail is deliberately `muted` — a wall of tickets all talking
   * at once is unusable. The LIGHTBOX is the one that plays, and it must not
   * inherit that mute, or an admin judging a harassment report hears nothing
   * and never learns the audio was there.
   *
   * Whether a given FILE carries audio is a property of the file, not of the
   * panel, and is proven at the storage layer instead: a clip recorded on the
   * real phone reached the admin byte-identical with its audio track intact.
   * What this test owns is that the player lets you hear it.
   */
  test("an attached video plays with sound, not muted", async ({ page }) => {
    const message = `${marker()} ticket with a video`;
    const key = await uploadFixture(
      api,
      page,
      "assets/Duck Warning.mp4",
      "video/mp4",
    );
    await seedTicket(api, message, { attachments: [key] });

    await navigateToTab(page, "Support");
    const card = cardFor(page, message);
    await expect(card).toBeVisible();

    const thumb = card.locator('[data-evidence-type="video"]').first();
    await expect(thumb).toBeVisible();
    // The thumbnail SHOULD be muted — that is the grid behaving well.
    expect(
      await thumb.locator("video").evaluate((v: HTMLVideoElement) => v.muted),
    ).toBe(true);

    await thumb.click();
    const player = page.locator(".evidence-lightbox video");
    await expect(player).toBeVisible();

    expect(
      await player.evaluate((v: HTMLVideoElement) => ({
        muted: v.muted,
        controls: v.controls,
        volume: v.volume,
      })),
    ).toEqual({ muted: false, controls: true, volume: 1 });
  });

  test("an attached image is shown to the admin", async ({ page }) => {
    const message = `${marker()} ticket with a screenshot`;
    const key = await uploadFixture(
      api,
      page,
      "public/emulator-blocked-screenshot.png",
      "image/png",
    );
    await seedTicket(api, message, { attachments: [key] });

    await navigateToTab(page, "Support");
    const img = cardFor(page, message)
      .locator('[data-evidence-type="image"] img')
      .first();
    await expect(img).toBeVisible();
    // A broken <img> is still "visible" to Playwright; naturalWidth separates a
    // rendered picture from a broken-link icon.
    expect(
      await img.evaluate((i: HTMLImageElement) => i.naturalWidth),
    ).toBeGreaterThan(0);
  });

  test("a ticket with no attachments shows no attachment error", async ({
    page,
  }) => {
    const message = `${marker()} ticket with no attachments`;
    const id = await seedTicket(api, message);

    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/api/support-tickets/${id}/attachments`))
        calls.push(r.url());
    });

    await navigateToTab(page, "Support");
    await expect(cardFor(page, message)).toBeVisible();

    // Scoped to THIS card, not the whole list. The queue accumulates tickets
    // across runs, and an older one whose stored object has since gone will
    // show the error legitimately — asserting over the list made this test fail
    // for somebody else's ticket, on whichever browser happened to render it.
    await expect(cardFor(page, message)).not.toContainText(
      "Attachments could not be loaded",
    );
    // The request has to be MADE. "No error shown" is also satisfied by never
    // asking — which is precisely what the broken arity did.
    expect(
      calls.length,
      "the attachments endpoint was never called",
    ).toBeGreaterThan(0);
  });
});

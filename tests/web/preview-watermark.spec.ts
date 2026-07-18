import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/**
 * TDD contract for the web watermark (`public/js/preview-watermark.js`):
 *
 * 1. The watermark element (`#preview-watermark`) MUST be present on
 *    every public page when the page is served from a non-prod host
 *    (localhost, dev API). It MUST contain the literal string
 *    "ShyTalk Preview".
 * 2. The watermark MUST display the detected environment, build/release
 *    indicator, browser identification, and the signed-in user's UID
 *    (or "-" when not signed in).
 * 3. On a prod host (mocked via host header / hostname), the watermark
 *    element MUST NOT exist — false-positive watermarks on real prod
 *    erode trust in the signal.
 *
 * The Playwright suite runs against the local web server, so by default
 * every test exercises the non-prod path. The "prod hides watermark"
 * test mocks env detection by overriding the watermark module's
 * `getEnvironment()` via a `window.__preview_env_override` hook before
 * the script runs.
 */

const PAGES = [
  "/",
  "/admin/",
  "/portal/",
  "/roadmap.html",
  "/privacy.html",
  "/terms.html",
  "/community-guidelines.html",
  "/cyber-bullying.html",
];

test.describe("Preview watermark — visibility on non-prod hosts", () => {
  for (const page of PAGES) {
    test(`shows on ${page}`, async ({ page: browser }) => {
      await browser.goto(page);
      const watermark = browser.locator("#preview-watermark");
      await expect(watermark).toBeVisible();
      await expect(watermark).toContainText("ShyTalk Preview");
    });
  }
});

test.describe("Preview watermark — content", () => {
  test("displays environment label", async ({ page }) => {
    await page.goto("/");
    const watermark = page.locator("#preview-watermark");
    // "local" because Playwright runs against http://localhost:8888
    await expect(watermark).toContainText(/local|dev/i);
  });

  test("displays browser identification", async ({ page }) => {
    await page.goto("/");
    const watermark = page.locator("#preview-watermark");
    // Browser engine should appear in the badge — Chromium / Firefox /
    // WebKit. The watermark module derives this from the User-Agent.
    const text = await watermark.textContent();
    expect(text).toMatch(/Chromium|Chrome|Firefox|WebKit|Safari/i);
  });

  test("displays UID with - placeholder when not signed in", async ({
    page,
  }) => {
    await page.goto("/");
    const watermark = page.locator("#preview-watermark");
    await expect(watermark).toContainText(/UID:\s*[-\d]/);
  });
});

test.describe("Preview watermark — EVERY public page carries it (SHY-0205)", () => {
  // Glob-discovered so a new page can never ship without the badge: the
  // moment someone adds public/foo.html without the loader script, this
  // suite grows a RED test for it automatically.
  const publicRoot = path.resolve(__dirname, "..", "..", "public");
  const discovered: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) {
        discovered.push(
          "/" + path.relative(publicRoot, full).split(path.sep).join("/"),
        );
      }
    }
  })(publicRoot);

  test("discovery found the full corpus", () => {
    // Guard against the walk silently scanning the wrong directory —
    // the repo has 11 public pages today; fewer than 9 means the glob
    // broke, not that pages were legitimately deleted.
    expect(discovered.length).toBeGreaterThanOrEqual(9);
  });

  for (const urlPath of discovered) {
    test(`badge present on ${urlPath}`, async ({ page }) => {
      await page.goto(urlPath);
      const watermark = page.locator("#preview-watermark");
      await expect(watermark).toBeVisible();
      await expect(watermark).toContainText("ShyTalk Preview");
    });
  }
});

test.describe("Preview watermark — git identity lines (SHY-0205)", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const liveSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  test("branch and sha arrive via serve-web meta injection", async ({
    page,
  }) => {
    await page.goto("/");
    // serve-web.js injects the LIVE working-tree identity; the badge
    // must show the sha (7 chars) — proof the page names the code
    // actually being served, not a stale stamp.
    await expect(page.locator("#preview-watermark")).toContainText(
      liveSha.slice(0, 7),
    );
  });

  test("server-echo line shows the api marker with a health dot", async ({
    page,
  }) => {
    await page.goto("/");
    const watermark = page.locator("#preview-watermark");
    await expect(watermark).toContainText(/api (unknown|[0-9a-f?]{1,7})/);
    await expect(watermark).toContainText("●");
  });

  test("live local stack turns the dot green", async ({ page }) => {
    await page.goto("/");
    // The poll fires at load; the 2s re-render then paints the verdict.
    await expect
      .poll(
        async () =>
          page
            .locator("#preview-watermark span")
            .first()
            .evaluate((el) => window.getComputedStyle(el).color),
        { timeout: 10_000 },
      )
      .toBe("rgb(102, 187, 106)");
  });

  test("an unreachable backend turns the dot red — REAL induced failure", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Closed port ⇒ genuine fetch failure (no mocks — the rule).
      (window as any).__preview_api_override = "http://127.0.0.1:1";
    });
    await page.goto("/");
    await expect
      .poll(
        async () =>
          page
            .locator("#preview-watermark span")
            .first()
            .evaluate((el) => window.getComputedStyle(el).color),
        { timeout: 10_000 },
      )
      .toBe("rgb(255, 82, 82)");
  });
});

test.describe("Preview watermark — QA context lines (SHY-0205)", () => {
  test("journey marker line appears while set and disappears when cleared", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("#preview-watermark")).not.toContainText("▶");
    await page.evaluate(() => {
      (window as any).__journey_marker = "j01 s03";
    });
    await expect(page.locator("#preview-watermark")).toContainText(
      "▶ j01 s03",
      {
        timeout: 5_000,
      },
    );
    await page.evaluate(() => {
      (window as any).__journey_marker = "";
    });
    await expect(page.locator("#preview-watermark")).not.toContainText("▶", {
      timeout: 5_000,
    });
  });

  test("cohort pairs with the UID when the hook is set", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__shytalk_user_uid = "10000005";
      (window as any).__shytalk_user_cohort = "adult";
    });
    await page.goto("/");
    await expect(page.locator("#preview-watermark")).toContainText(
      "UID: 10000005 · adult",
    );
  });

  test("locale and route pair on one line", async ({ page }) => {
    await page.goto("/roadmap.html");
    await expect(page.locator("#preview-watermark")).toContainText(
      "· /roadmap.html",
    );
  });

  test("zh locale switch is reflected in the locale line (real i18n path)", async ({
    page,
  }) => {
    // Same mechanism the language selector uses (the 404-i18n idiom):
    // the stored preference drives the inline init bridge, which sets
    // document.documentElement.lang — the exact source the watermark
    // reads. No hooks, the REAL i18n path.
    await page.addInitScript(() => {
      localStorage.setItem("shytalk_language", "zh");
    });
    await page.goto("/");
    await page.waitForFunction(() => document.documentElement.lang === "zh", null, {
      timeout: 5_000,
    });
    await expect(page.locator("#preview-watermark")).toContainText("zh · /", {
      timeout: 5_000,
    });
  });

  test("build-identity console line is emitted once per load", async ({ page }) => {
    const identityLines: string[] = [];
    page.on("console", (msg) => {
      if (msg.text().includes("[ShyTalk] build identity:")) identityLines.push(msg.text());
    });
    await page.goto("/");
    await expect.poll(() => identityLines.length, { timeout: 5_000 }).toBe(1);
    expect(identityLines[0]).toMatch(/build identity: local .+@[0-9a-f]{4,}/);
  });
});

test.describe("Preview watermark — production opt-out", () => {
  test('not rendered when env override is "prod"', async ({ page }) => {
    // Override the watermark module's environment detection BEFORE the
    // page script runs. The module reads `window.__preview_env_override`
    // first; if it's set, that value wins over hostname-based detection.
    await page.addInitScript(() => {
      (window as any).__preview_env_override = "prod";
    });
    await page.goto("/");
    await expect(page.locator("#preview-watermark")).toHaveCount(0);
  });
});

test.describe("Preview watermark — overlay does not break the page", () => {
  test("main page content renders alongside watermark", async ({ page }) => {
    await page.goto("/");
    // Body should still contain whatever main-page content the
    // unmodified landing page renders. Specifically check that the
    // <main> or <body> still has text — i.e. the watermark isn't
    // covering or replacing the page.
    const bodyText = await page.locator("body").textContent();
    expect(bodyText?.length || 0).toBeGreaterThan(50);
  });

  test("watermark background alpha is transparent enough to see through", async ({
    page,
  }) => {
    // The badge must be visibly transparent so the underlying UI
    // remains legible. Read the computed background-color via JS and
    // verify the alpha component is at most 0.5. Below this threshold
    // the underlying page colour clearly bleeds through.
    await page.goto("/");
    const alpha = await page.locator("#preview-watermark").evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundColor;
      // matches "rgba(r, g, b, a)" or "rgb(r, g, b)" (alpha 1)
      const m =
        /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)/.exec(bg);
      return m && m[1] !== undefined ? parseFloat(m[1]) : 1;
    });
    expect(alpha).toBeLessThanOrEqual(0.5);
    expect(alpha).toBeGreaterThanOrEqual(0.1);
  });

  test("watermark does not intercept pointer events on the page beneath it", async ({
    page,
  }) => {
    // The watermark must NOT block clicks on whatever's underneath.
    // Read the CSS `pointer-events` property directly — `none` means
    // the badge is visually present but clicks pass straight through
    // to the element behind it (the standard "decoration overlay"
    // contract). The user explicitly required "taps or clicks must
    // not be blocked by any watermark".
    await page.goto("/");
    const pointerEvents = await page
      .locator("#preview-watermark")
      .evaluate((el) => {
        return window.getComputedStyle(el).pointerEvents;
      });
    expect(pointerEvents).toBe("none");
  });

  test("clicks at the watermark coordinates reach the page beneath", async ({
    page,
  }) => {
    // End-to-end check that confirms `pointer-events: none` actually
    // works for real click dispatches — places a button under the
    // watermark via JS, clicks at the watermark's bounding box, and
    // verifies the button received the click.
    await page.goto("/");
    await page.evaluate(() => {
      const wm = document.getElementById("preview-watermark");
      if (!wm) throw new Error("no watermark");
      const rect = wm.getBoundingClientRect();
      const btn = document.createElement("button");
      btn.id = "pw-test-button";
      btn.textContent = "click me";
      btn.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;z-index:1;`;
      btn.dataset.clicked = "0";
      btn.addEventListener("click", () => {
        btn.dataset.clicked = "1";
      });
      document.body.appendChild(btn);
    });
    // Click at the centre of the watermark.
    const box = await page.locator("#preview-watermark").boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const clicked = await page
      .locator("#pw-test-button")
      .getAttribute("data-clicked");
    expect(clicked).toBe("1");
  });
});

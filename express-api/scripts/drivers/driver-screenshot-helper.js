/**
 * driver-screenshot-helper.js
 *
 * Shared `takeScreenshot(pages, outputDir, slug)` for the web-playwright
 * base driver + the 6 web-mobile wrapper drivers (gap C3 — per-cell
 * screenshot capture on failure).
 *
 * Each driver maintains a `pages` Map (persona name → Playwright Page).
 * This helper iterates the map and writes one PNG per persona to
 * `outputDir`, named `screenshot-<slug>-<persona>.png`. The slug is
 * the driver's matrix-cell slug (e.g. "chromium", "mobile-chrome-
 * android", "mobile-firefox-ios") so artifacts from different cells
 * don't collide in a shared report-dir.
 *
 * Best-effort semantics:
 *   - Falsy outputDir → returns [] (operator didn't pass --report-dir)
 *   - One persona's screenshot failure does NOT block the others
 *   - Caller MUST call this BEFORE driver.close() (closed browsers
 *     can't screenshot)
 */

const fs = require('fs');
const path = require('path');

async function takeScreenshotForPages(pages, outputDir, slug) {
  if (!outputDir) return [];
  fs.mkdirSync(outputDir, { recursive: true });
  const saved = [];
  for (const [name, page] of pages.entries()) {
    try {
      const filename = `screenshot-${slug}-${name}.png`;
      const fullPath = path.join(outputDir, filename);
      await page.screenshot({ path: fullPath, fullPage: true });
      saved.push(fullPath);
    } catch (_e) {
      /* best-effort: one persona's failure doesn't block the others */
    }
  }
  return saved;
}

/**
 * Appium-flavoured screenshot. iOS wrappers (mobile-safari-ios,
 * mobile-webkit-ios) drive via Appium's HTTP API, not Playwright
 * pages — so they POST to `/session/<sid>/screenshot` and decode the
 * base64 PNG response. One file per session (Appium doesn't expose
 * a per-persona-page concept on iOS the way Playwright does).
 */
async function takeScreenshotViaAppium({ appiumBaseUrl, sessionId, fetchImpl, outputDir, slug }) {
  if (!outputDir || !sessionId) return [];
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sessionId}/screenshot`);
    if (!r.ok) return [];
    const body = await r.json();
    const base64 = body && body.value;
    if (!base64) return [];
    const filename = `screenshot-${slug}-default.png`;
    const fullPath = path.join(outputDir, filename);
    fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'));
    return [fullPath];
  } catch (_e) {
    /* best-effort */
    return [];
  }
}

module.exports = { takeScreenshotForPages, takeScreenshotViaAppium };

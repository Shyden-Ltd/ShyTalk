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
 * Best-effort semantics — the function MUST NEVER throw:
 *   - Falsy outputDir → returns [] (operator didn't pass --report-dir)
 *   - mkdir failure (EACCES, EROFS, disk full) → returns []
 *   - One persona's screenshot failure does NOT block the others
 *   - Caller MUST call this BEFORE driver.close() (closed browsers
 *     can't screenshot)
 *
 * Scenario-collision policy: the runner is responsible for passing a
 * scenario-unique outputDir (e.g. `<reportDir>/scenario-<idx>/`) so
 * multiple failing scenarios in the same feature don't overwrite each
 * other's PNGs. This helper does not encode scenario index into the
 * filename itself.
 */

const fs = require('fs');
const path = require('path');

/**
 * Defensive: persona keys come from driver-controlled `pages` Maps.
 * In practice they're "Alice"/"Bob"/etc. from operator-written feature
 * files, but `path.join(outputDir, untrustedKey)` resolves `..`
 * segments and could escape outputDir if conventions change. Strip
 * to a conservative filename-safe charset.
 */
function safeFilenamePart(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Best-effort recursive mkdir. Returns true on success, false on any
 * failure — never throws. Keeps the outer helpers' best-effort
 * contract intact when EACCES/EROFS/disk-full hits before the
 * per-iteration try/catch.
 */
function ensureDirSafe(outputDir) {
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    return true;
  } catch (_e) {
    return false;
  }
}

async function takeScreenshotForPages(pages, outputDir, slug) {
  if (!outputDir) return [];
  if (!ensureDirSafe(outputDir)) return [];
  const saved = [];
  for (const [name, page] of pages.entries()) {
    try {
      const filename = `screenshot-${slug}-${safeFilenamePart(name)}.png`;
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
 * W3C WebDriver HTTP screenshot. Used by:
 *   - firefox-android via Geckodriver (port 4444)
 *   - safari-ios + webkit-ios via Appium (port 4723)
 *
 * Both speak the same W3C `/session/<sid>/screenshot` endpoint and
 * return `{value: <base64-png>}`. The name "ViaAppium" is historical
 * — the helper works for any W3C-compliant HTTP driver.
 *
 * One file per session (W3C HTTP drivers don't expose a per-persona-
 * page concept like Playwright does).
 */
async function takeScreenshotViaAppium({ appiumBaseUrl, sessionId, fetchImpl, outputDir, slug }) {
  if (!outputDir || !sessionId) return [];
  if (!ensureDirSafe(outputDir)) return [];
  try {
    const r = await fetchImpl(`${appiumBaseUrl}/session/${sessionId}/screenshot`);
    if (!r.ok) return [];
    const body = await r.json();
    const base64 = body && body.value;
    if (!base64 || typeof base64 !== 'string') return [];
    const filename = `screenshot-${slug}-default.png`;
    const fullPath = path.join(outputDir, filename);
    fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'));
    return [fullPath];
  } catch (_e) {
    /* best-effort */
    return [];
  }
}

module.exports = {
  takeScreenshotForPages,
  takeScreenshotViaAppium,
  safeFilenamePart,
  ensureDirSafe,
};

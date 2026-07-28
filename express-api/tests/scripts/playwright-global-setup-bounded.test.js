/**
 * Pins that the Playwright global setup can never wait forever.
 *
 * On 2026-07-28 a degraded Firestore emulator left `/api/test/clear` never
 * answering. The setup's `fetch` had no timeout, so Playwright sat at 0% CPU
 * producing zero output — no test started and the pre-push gate never
 * returned. An unbounded wait is indistinguishable from "slow", which is what
 * made it expensive to diagnose. This is a structure pin, not a behaviour
 * test: the file runs inside Playwright, so the guarantee worth protecting is
 * that the bound is present at all and that a timeout is not swallowed.
 */
const fs = require('fs');
const path = require('path');

const SETUP_PATH = path.join(__dirname, '../../../tests/web/global-setup.ts');

describe('tests/web/global-setup.ts — bounded waits', () => {
  let src;

  beforeAll(() => {
    if (!fs.existsSync(SETUP_PATH)) {
      throw new Error(`global-setup not found at expected path: ${SETUP_PATH}`);
    }
    src = fs.readFileSync(SETUP_PATH, 'utf8');
  });

  test('every fetch carries an abort signal (no unbounded wait)', () => {
    const fetchCalls = src.match(/await fetch\(/g) || [];
    expect(fetchCalls.length).toBeGreaterThan(0);
    // One signal per fetch. A new fetch added without one reintroduces the hang.
    const signals = src.match(/signal:\s*AbortSignal\.timeout\(/g) || [];
    expect(signals.length).toBe(fetchCalls.length);
  });

  test('the timeout is a finite, non-zero number of milliseconds', () => {
    const m = src.match(/CLEAR_TIMEOUT_MS\s*=\s*([0-9_]+)/);
    expect(m).not.toBeNull();
    const ms = Number(m[1].replace(/_/g, ''));
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
    // Long enough not to flake on a cold emulator, short enough to be obvious.
    expect(ms).toBeLessThanOrEqual(60_000);
  });

  test('a timeout THROWS rather than being swallowed as "endpoint missing"', () => {
    expect(src).toMatch(/TimeoutError/);
    expect(src).toMatch(/throw new Error\(/);
    // The old code had a bare `catch {}` that hid every failure equally.
    expect(src).not.toMatch(/}\s*catch\s*\{\s*\/\/[^\n]*\n\s*}/);
  });
});

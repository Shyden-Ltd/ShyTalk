'use strict';

/**
 * driver-verdict-honoured.test.js — SHY-0330
 *
 * A journey step must FAIL when the driver could not perform it.
 *
 * Before this story, 116 step handlers called a driver method, discarded its
 * return value, and unconditionally returned `{ ok: true }`. 98 of those called
 * STUB-ONLY methods — every driver wires unimplemented methods to a stub that
 * logs and returns false — so a step calling a method nobody has written
 * reported PASS. The entire 114-method missing-driver inventory was therefore
 * invisible in pass/fail terms, which is why a matrix run could log 256
 * `not implemented yet` lines and still not fail on them.
 *
 * A pass has to mean the action happened.
 *
 * No test doubles: `executeStep` takes its drivers through `ctx`, so a plain
 * async function IS the injected dependency the dispatcher is documented to
 * take — nothing is standing in for a real collaborator. That also keeps this
 * file honest against the no-new-stubs ratchet without needing an exemption.
 */

const fs = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, '../../scripts/manual-qa-runner.js');
const { executeStep } = require('../../scripts/manual-qa-runner');

/** Minimal ctx for a step that only needs a UI driver. */
function makeCtx(overrides = {}) {
  return {
    apiBase: 'https://dev-api.example',
    firebaseApiKey: 'fake-key',
    sessions: new Map(),
    personaPlatforms: new Map(),
    personaPaths: new Map(),
    locale: 'en',
    fetch: async () => ({}),
    ...overrides,
  };
}

const TAP_STEP = { kind: 'When', text: 'Adam on Android taps "signin_signUpLink"' };

/** The Android tap matcher locates the tag in a UI dump before tapping, so a
 *  dump containing the tag is part of the minimum viable context. */
const DUMP_WITH_TAG = '<node resource-id="signin_signUpLink" bounds="[0,0][100,100]" />';

/** ctx wired for the tap step, with androidTap's verdict under test. */
function tapCtx(tapImpl) {
  return makeCtx({
    uiDriver: {
      androidUiDump: async () => DUMP_WITH_TAG,
      androidTap: tapImpl,
    },
  });
}

/**
 * Step handlers that `await` a driver call and then unconditionally report
 * success, without inspecting what the driver said.
 */
function discardedVerdictSites() {
  const lines = fs.readFileSync(RUNNER, 'utf8').split('\n');
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/^\s*await ctx\.(uiDriver|webDriver)\.(\w+)\(/);
    if (!m) return;
    // An unconditional success within the next few lines, with nothing between
    // that could have inspected the result.
    const after = lines.slice(i + 1, i + 4);
    if (after.some((l) => /^\s*return \{ ok: true \};/.test(l))) {
      out.push({ line: i + 1, driver: m[1], method: m[2] });
    }
  });
  return out;
}

describe('driver verdicts are honoured (SHY-0330)', () => {
  test('no step handler discards a driver verdict', () => {
    const sites = discardedVerdictSites();
    const detail = sites
      .slice(0, 12)
      .map((s) => `  manual-qa-runner.js:${s.line}  ctx.${s.driver}.${s.method}`)
      .join('\n');
    expect(
      sites.length === 0
        ? ''
        : `${sites.length} step handler(s) ignore what the driver reported and pass regardless:\n${detail}` +
            (sites.length > 12 ? `\n  ... and ${sites.length - 12} more` : ''),
    ).toBe('');
  });

  test('the iOS tap step uses the method both iOS drivers implement identically', () => {
    // `iosTap` means DIFFERENT things per driver: ios-simctl-driver takes a
    // string identifier, ios-appium-driver takes numeric COORDINATES (its
    // string method is iosTapByTag). Calling `iosTap(tag)` therefore sends
    // x="<tag>", y=undefined under Appium — a guaranteed no-op. Only
    // `iosTapByTag` has one meaning on both.
    const src = fs.readFileSync(RUNNER, 'utf8');
    expect(src).not.toMatch(/await ctx\.uiDriver\.iosTap\(\s*tag\s*\)/);
  });

  test('a driver returning TRUE passes the step', async () => {
    const ctx = tapCtx(async () => true);
    expect((await executeStep(TAP_STEP, ctx)).ok).toBe(true);
  });

  test('a driver returning FALSE fails the step', async () => {
    const ctx = tapCtx(async () => false);
    const r = await executeStep(TAP_STEP, ctx);
    expect(r.ok).toBe(false);
    // The message must name the method, so the run log points at the gap.
    expect(r.error).toMatch(/androidTap/);
  });

  test('a driver returning UNDEFINED fails the step — forgetting to return is not success', async () => {
    // `!== true` rather than `if (!x)`: a driver that forgets to return must
    // read as failure. This is the case a truthiness check would let through
    // unchanged, and it is how the original defect stayed invisible.
    const ctx = tapCtx(async () => undefined);
    expect((await executeStep(TAP_STEP, ctx)).ok).toBe(false);
  });

  test('an UNIMPLEMENTED driver method fails the step rather than passing', async () => {
    // The real stub contract: every driver wires unimplemented methods to one
    // that now THROWS. Previously it returned false, the handler discarded it,
    // and the step passed — which is why 256 "not implemented yet" lines could
    // appear in a run whose steps were not failing on them.
    const notImplemented = async () => {
      const err = new Error('[android-driver] androidTap is NOT IMPLEMENTED (device=X)');
      err.code = 'DRIVER_METHOD_NOT_IMPLEMENTED';
      throw err;
    };
    const ctx = tapCtx(notImplemented);
    const r = await executeStep(TAP_STEP, ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NOT IMPLEMENTED/);
  });
});

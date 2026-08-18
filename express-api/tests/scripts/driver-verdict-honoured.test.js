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
 */

const fs = require('fs');
const path = require('path');

const RUNNER = path.join(__dirname, '../../scripts/manual-qa-runner.js');

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
});

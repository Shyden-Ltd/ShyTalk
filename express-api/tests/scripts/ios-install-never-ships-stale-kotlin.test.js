/**
 * The iOS install must never ship a stale Kotlin framework.
 *
 * `ios-local-install.sh` staged `shared.framework` under
 * `shared/build/xcode-frameworks/<config>/<sdk>` only `if [ ! -d ... ]`, on the
 * assumption — written in a comment — that Xcode's in-project "Compile Kotlin
 * Framework" phase would refresh it whenever Kotlin changed.
 *
 * It does not. `grep -c "Compile Kotlin Framework"` over a complete build log
 * returns ZERO: that phase never runs. So every install after the first rebuilt
 * the Swift app around a FROZEN framework and reported success.
 *
 * On 2026-08-22 that put an 08:11 framework on the phone for the rest of the
 * day. The 08:48 notice cap and the 13:59 attachment limits were never on the
 * device, while `** BUILD SUCCEEDED **` and `Verified: bundle carries
 * ShyTalkLocalHost=…` both said otherwise. A device test run against stale code
 * is worse than no device test, because it gets reported as proof.
 *
 * Same family as the Gradle up-to-date trap and stale `node_modules`: a green
 * signal produced by machinery that never looked at the change.
 */

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '../../../scripts/dev/ios-local-install.sh');
const code = fs
  .readFileSync(SCRIPT, 'utf8')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

describe('ios-local-install.sh', () => {
  test('relinks the Kotlin framework on every run', () => {
    expect(code).toContain(':shared:linkDebugFrameworkIosArm64');
    // The bug in one line: staging only when the directory is absent.
    expect(code).not.toMatch(/if\s*\[\s*!\s*-d\s*"\$STAGE\/shared\.framework"\s*\]/);
  });

  test('replaces the staged framework rather than leaving whatever is there', () => {
    expect(code).toMatch(/rm\s+-rf\s+"\$STAGE\/shared\.framework"/);
  });

  test("clears Xcode's intermediates, which cache the old Swift module", () => {
    expect(code).toMatch(/rm\s+-rf.*Intermediates\.noindex/);
  });

  /**
   * The post-condition that would have caught it. The script already refuses to
   * trust exit 0 for the host address; the Kotlin half needs the same treatment,
   * because that is the half a device test is actually exercising.
   */
  test('refuses to hand over a bundle whose framework is older than the sources', () => {
    expect(code).toContain('BUNDLED_FW');
    expect(code).toMatch(/-newer\s+"\$BUNDLED_FW"/);
    expect(code).toMatch(/Do NOT trust a device result/);
  });
});

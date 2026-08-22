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
  test('refuses to hand over a bundle whose Kotlin is older than the sources', () => {
    expect(code).toContain('BUNDLED_KOTLIN');
    expect(code).toMatch(/-newer\s+"\$BUNDLED_KOTLIN"/);
    expect(code).toMatch(/Do NOT trust a device result/);
  });

  /**
   * Xcode 26 links the app into `iosApp.debug.dylib` and leaves `iosApp` a
   * ~90 KB launcher stub, and there is no `Frameworks/shared.framework` in the
   * bundle at all. A check pointed at the framework refused a perfectly good
   * build; a check pointed at the stub found no Kotlin in a working app.
   */
  test('looks for the Kotlin where Xcode actually puts it', () => {
    expect(code).toContain('iosApp.debug.dylib');
  });

  /**
   * `grep -q` exits on the FIRST match, killing `nm` with SIGPIPE — and under
   * `set -o pipefail` that fails the pipeline. The check then reported "no
   * Kotlin in it" about a dylib holding 176,704 Kotlin symbols.
   */
  test('counts Kotlin symbols without killing nm mid-stream', () => {
    expect(code).toMatch(/grep\s+-c\s+"kfun:"/);
    expect(code).not.toMatch(/grep\s+-q\s+"kfun:"/);
  });
});

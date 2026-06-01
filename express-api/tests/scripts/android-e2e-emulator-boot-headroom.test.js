/**
 * e2e-tests.yml — Android emulator boot headroom + heap size.
 *
 * Self-discovered 2026-06-01 on PR #950 (an XML-only i18n diff that
 * could not affect Android UI behavior): the `Run E2E tests on
 * emulator` step timed out twice in a row with the same signature:
 *
 *   adb: device 'emulator-5554' not found    (repeated polls)
 *   ##[error]Timeout waiting for emulator to boot.
 *   error: could not connect to TCP port 5554: Connection refused
 *
 * The action's emulator-boot-timeout defaulted to 600s. The first
 * failure hit 15:12:28 against an emulator start at 15:02:25 — i.e.
 * the boot hit the deadline EXACTLY. The same workflow had run
 * successfully on the same ubuntu-24.04 runner image ~2h earlier
 * on the immediately-prior PR-branch commit; no Android-relevant
 * file changed between the two SHAs.
 *
 * Two mitigations were applied:
 *
 *   1. `emulator-boot-timeout: 1800` — 3× the default. The cold
 *      sdkmanager install + AVD create + first boot routinely takes
 *      8-9 min on 2-core GHA runners (well within 10 min on a good
 *      day; over the cliff on a slow day). 30 min gives genuine
 *      headroom without prolonging a real failure (the action exits
 *      on actual process death without waiting the full window).
 *
 *   2. `heap-size: 4096` — explicitly raises the emulator's RAM
 *      ceiling above the AVD profile defaults (often 2048M for
 *      pixel_6, 1024M for older pixel_2). API 33 + google_apis system
 *      services routinely peak past 2GB during early boot; OOM-kill
 *      of zygote yields the silent-boot-failure signature observed.
 *
 * Pin both values here so a future "CI cleanup" PR that drops them
 * fails this test before the workflow ships, instead of failing the
 * NEXT translation PR's Android E2E.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const E2E_TESTS_YML = path.join(REPO_ROOT, '.github/workflows/e2e-tests.yml');

describe('e2e-tests.yml — Android emulator boot headroom', () => {
  let yamlText;
  let emulatorStepBlock;

  beforeAll(() => {
    yamlText = fs.readFileSync(E2E_TESTS_YML, 'utf8');

    // Bound the emulator step body via index arithmetic — avoids the
    // sonarjs/slow-regex flag that fires on unbounded lazy quantifiers.
    // The step starts at `- name: Run E2E tests on emulator` and ends at
    // the next sibling step (`      - ` at 6-space indent) or job
    // boundary (`    \w` at 4-space indent).
    const headerIdx = yamlText.indexOf('      - name: Run E2E tests on emulator');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    // Defence in depth: `substring(-1)` returns the whole string in
    // ECMA-262, so a future `.skip()` of the assert above would let
    // the rest of beforeAll silently slice the entire file and match
    // regexes anywhere in the YAML, producing spurious "passes".
    // Bail out so a missing header surfaces as a clear test failure
    // rather than as misleading green tests.
    if (headerIdx < 0) return;
    const lines = yamlText.substring(headerIdx).split('\n');
    let endLineIdx = lines.length;
    for (let i = 1; i < lines.length; i++) {
      if (/^ {6}- /.test(lines[i]) || /^ {4}\S/.test(lines[i])) {
        endLineIdx = i;
        break;
      }
    }
    emulatorStepBlock = lines.slice(0, endLineIdx).join('\n');
  });

  test('emulator step uses the pinned action SHA (v2.37.0)', () => {
    // Sanity guard. If the action version is bumped, the safety options
    // below need re-verification against the new release's input schema.
    expect(emulatorStepBlock).toContain(
      'reactivecircus/android-emulator-runner@e89f39f1abbbd05b1113a29cf4db69e7540cae5a',
    );
  });

  test('emulator-boot-timeout is at least 1800s (3× the 600s default)', () => {
    // Bounded space/tab classes avoid sonarjs/slow-regex flags on
    // unbounded `\s*` quantifiers. Line indent in YAML steps is at
    // most ~20 chars; the {1,20} ceiling is well above that.
    const match = emulatorStepBlock.match(/^[ \t]{1,20}emulator-boot-timeout:[ \t]{1,4}(\d+)/m);
    expect(match).not.toBeNull();
    const seconds = parseInt(match[1], 10);
    expect(seconds).toBeGreaterThanOrEqual(1800);
  });

  test('heap-size is at least 4096 MB (above pixel_6 AVD default of 2048)', () => {
    const match = emulatorStepBlock.match(/^[ \t]{1,20}heap-size:[ \t]{1,4}(\d+)/m);
    expect(match).not.toBeNull();
    const mb = parseInt(match[1], 10);
    expect(mb).toBeGreaterThanOrEqual(4096);
  });

  test('emulator-options retains the headless / no-audio / no-boot-anim flags', () => {
    // These flags are the baseline boot-time mitigations from the action
    // README. Without them, boot adds 20-40s on every run for animation
    // / audio init / swiftshader cold-start. Pin them so a future
    // "simplify CI options" PR doesn't silently drop them.
    expect(emulatorStepBlock).toMatch(/emulator-options:[^\n]*-no-snapshot/);
    expect(emulatorStepBlock).toMatch(/emulator-options:[^\n]*-no-window/);
    expect(emulatorStepBlock).toMatch(/emulator-options:[^\n]*-noaudio/);
    expect(emulatorStepBlock).toMatch(/emulator-options:[^\n]*-no-boot-anim/);
  });
});

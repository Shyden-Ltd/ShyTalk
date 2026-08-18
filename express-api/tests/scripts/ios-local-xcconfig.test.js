'use strict';

/**
 * Pins the iOS Local Build Configuration file (SHY-0345).
 *
 * `Local.xcconfig` is the project-level baseConfigurationReference for BOTH the
 * `Debug-Local` and `Release-Local` XCBuildConfigurations — the sibling of the
 * Android `local` product flavour, pointed at the emulator stack.
 *
 * **Its load-bearing job is `KOTLIN_FRAMEWORK_BUILD_TYPE`.** The KMP/Compose
 * "Compile Kotlin Framework" build phase infers debug-vs-release from the Xcode
 * CONFIGURATION name and recognises only the literal `Debug` / `Release`. A
 * custom name like `Debug-Local` defeats that heuristic, and the build dies:
 *
 *   error: Unable to detect Kotlin framework build type for
 *          CONFIGURATION=Debug-Local automatically. Specify
 *          'KOTLIN_FRAMEWORK_BUILD_TYPE' to 'debug' or 'release'
 *
 * Without it the Local configuration cannot build AT ALL — device or simulator.
 * `Dev.xcconfig` already carried the equivalent line; `Local.xcconfig` never
 * did, and its sibling's comment asserted a shared file "can't carry one value".
 * It can: xcconfig supports `[config=<name>]` conditionals, which is what makes
 * one file serve both configurations.
 *
 * These assertions are structural on purpose — the real proof is that
 * `xcodebuild -configuration Debug-Local` now reaches `** BUILD SUCCEEDED **`,
 * which no unit test can stand in for. What this file prevents is the value
 * being dropped again, silently, by someone tidying the config.
 */

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const REPO_ROOT = join(__dirname, '..', '..', '..');
const XCCONFIG = join(REPO_ROOT, 'iosApp', 'Configurations', 'Local.xcconfig');
const PBXPROJ = join(REPO_ROOT, 'iosApp', 'iosApp.xcodeproj', 'project.pbxproj');

const source = () => readFileSync(XCCONFIG, 'utf8');

/** Assignments as `{ key, condition, value }`, ignoring comments. */
function settings(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//'))
    .map((l) => /^([A-Z_][A-Z0-9_]*)(\[[^\]]*\])?\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ key: m[1], condition: m[2] || null, value: m[3].trim() }));
}

/** Build configurations whose project-level xcconfig is Local.xcconfig. */
function configurationsUsingLocalXcconfig() {
  const pbx = readFileSync(PBXPROJ, 'utf8');
  const names = new Set();
  const re =
    /\/\* ([A-Za-z-]+) \*\/ = \{\s*isa = XCBuildConfiguration;\s*baseConfigurationReference = \w+ \/\* Local\.xcconfig \*\//g;
  for (const m of pbx.matchAll(re)) names.add(m[1]);
  return [...names];
}

describe('SHY-0345 — Local.xcconfig makes the Local configuration buildable', () => {
  test('declares KOTLIN_FRAMEWORK_BUILD_TYPE at all', () => {
    // The defect, in one assertion. Absent, every Local build fails in the
    // "Compile Kotlin Framework" phase before any code is compiled.
    const keys = settings(source()).map((s) => s.key);
    expect(keys).toContain('KOTLIN_FRAMEWORK_BUILD_TYPE');
  });

  test('file exists at the expected path', () => {
    expect(existsSync(XCCONFIG)).toBe(true);
  });

  // Mirror of Android's `applicationIdSuffix = ".local"`. Allows the
  // local-flavor iOS app to be installed alongside the dev variant
  // on the same physical device for side-by-side comparison.
  test('declares BUNDLE_ID_SUFFIX = .local', () => {
    expect(source()).toMatch(/^BUNDLE_ID_SUFFIX\s*=\s*\.local$/m);
  });

  // Operator-overridable. Default `localhost` works on iOS Simulator
  // (shares the Mac's network namespace). For a physical iPhone the
  // operator must override to the Mac's local-network IP or mDNS .local
  // hostname at build time:
  //
  //   xcodebuild -configuration Debug-Local LOCAL_HOST=Macbook.local …
  //
  // Documented in the xcconfig's comment block; pinned at the variable
  // value level here.
  test('declares LOCAL_HOST variable (defaults to localhost)', () => {
    expect(source()).toMatch(/^LOCAL_HOST\s*=\s*localhost$/m);
  });

  // Pin the total variable count so a stray addition (typo, copy-paste,
  // experimental key) doesn't silently land alongside the documented
  // BUNDLE_ID_SUFFIX + LOCAL_HOST + KOTLIN_FRAMEWORK_BUILD_TYPE, one line
  // each. The `KOTLIN_FRAMEWORK_BUILD_TYPE[config=Release-Local]` override is
  // deliberately NOT counted here: this regex requires `=` straight after the
  // key, so a `[config=…]` conditional does not match it. The by-name absence
  // guard below is what stops a dead knob creeping back, in either form.
  test('contains exactly three unconditional variable declarations', () => {
    const varLines = source().match(/^[A-Z_][A-Z0-9_]*\s*=/gm);
    expect(varLines).not.toBeNull();
    expect(varLines.length).toBe(3);
  });

  // Regression guard for the defect that removed them. These four keys
  // existed for months, were documented as live operator knobs, and were
  // read by nothing — every URL is computed in AppEnvironment.swift from
  // LOCAL_HOST alone. LOCAL_FIREBASE_RTDB_URL was actively misleading: it
  // documented `?ns=demo-shytalk-default-rtdb` while the app ships
  // `?ns=demo-shytalk`. Re-adding any of them re-creates a knob that
  // looks followed and does nothing, so fail loudly instead.
  test.each([
    'LOCAL_API_BASE_URL',
    'LOCAL_LIVEKIT_URL',
    'LOCAL_FIREBASE_PROJECT_ID',
    'LOCAL_FIREBASE_RTDB_URL',
  ])('does NOT declare the dead knob %s', (key) => {
    expect(source()).not.toMatch(new RegExp(`^${key}\\s*=`, 'm'));
  });

  test('defaults to debug', () => {
    const def = settings(source()).find(
      (s) => s.key === 'KOTLIN_FRAMEWORK_BUILD_TYPE' && s.condition === null,
    );
    expect(def).toBeDefined();
    expect(def.value).toBe('debug');
  });

  test('overrides to release for Release-Local', () => {
    // The reason the sibling comment claimed a shared file "can't carry one
    // value". It can — this is the conditional that does it. Without the
    // override, a Release-Local build would embed a DEBUG Kotlin framework.
    const override = settings(source()).find(
      (s) => s.key === 'KOTLIN_FRAMEWORK_BUILD_TYPE' && s.condition === '[config=Release-Local]',
    );
    expect(override).toBeDefined();
    expect(override.value).toBe('release');
  });

  test('every build configuration fronted by this file resolves to the RIGHT value', () => {
    // Rewritten after review. The first version asked only whether SOME value
    // reached each configuration:
    //
    //     configs.filter((c) => !hasDefault && !conditioned.has(c))
    //
    // Once any bare default exists — which is the whole point of the fix —
    // `!hasDefault` is false for every element and the filter is
    // unconditionally empty. The test could never fail, while the story claimed
    // it stopped "a new *-Local configuration slipping through". It stopped
    // nothing. A test that cannot go red is worse than no test: it reports
    // safety that is not there.
    //
    // What matters is not that a value arrives but that the CORRECT one does. A
    // `Release-*` configuration silently inheriting the `debug` default is
    // exactly the defect this file exists to prevent, and it is the shape a
    // future `Release-Local-Foo` would take.
    const configs = configurationsUsingLocalXcconfig();
    expect(configs.length).toBeGreaterThan(0);

    const decls = settings(source()).filter((s) => s.key === 'KOTLIN_FRAMEWORK_BUILD_TYPE');
    const fallback = decls.find((s) => s.condition === null)?.value;
    const conditioned = new Map(
      decls
        .filter((s) => s.condition)
        .map((s) => [/\[config=([^\]]+)\]/.exec(s.condition)?.[1], s.value])
        .filter(([k]) => k),
    );

    /** What this configuration actually ends up with. */
    const resolved = (c) => (conditioned.has(c) ? conditioned.get(c) : fallback);
    /** What it OUGHT to have, from its own name. */
    const expected = (c) => (/^Release/.test(c) ? 'release' : 'debug');

    const wrong = configs.filter((c) => resolved(c) !== expected(c));
    expect(wrong).toEqual([]);
  });

  test('the pinned key is declared exactly twice — no stray or duplicate copy', () => {
    // Matches the convention the sibling `ios-dev-xcconfig.test.js` sets for
    // this file class. A second bare declaration would silently win or lose
    // depending on order, and neither outcome announces itself.
    const decls = settings(source()).filter((s) => s.key === 'KOTLIN_FRAMEWORK_BUILD_TYPE');
    expect(decls).toHaveLength(2);
    expect(decls.filter((s) => s.condition === null)).toHaveLength(1);
  });

  test('the xcconfig file exists where the Xcode project expects it', () => {
    // An explicit check with a readable failure, rather than an ENOENT thrown
    // from inside four other tests if the file is ever moved.
    expect(existsSync(XCCONFIG)).toBe(true);
  });

  test('Debug-Local and Release-Local are both fronted by this file', () => {
    // Guards the assumption the test above rests on. If the project were
    // re-pointed at separate xcconfigs, this file's conditional would stop
    // being the thing that matters and the pin would quietly mean nothing.
    const configs = configurationsUsingLocalXcconfig().sort();
    expect(configs).toEqual(['Debug-Local', 'Release-Local']);
  });
});

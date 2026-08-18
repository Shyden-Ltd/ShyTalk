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

const { readFileSync } = require('node:fs');
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

  test('every build configuration fronted by this file has a value', () => {
    // Derived from the Xcode project, not hardcoded, so adding a third
    // `*-Local` configuration without giving it a build type fails HERE rather
    // than as an unexplained build error later.
    const configs = configurationsUsingLocalXcconfig();
    expect(configs.length).toBeGreaterThan(0);

    const decls = settings(source()).filter((s) => s.key === 'KOTLIN_FRAMEWORK_BUILD_TYPE');
    const hasDefault = decls.some((s) => s.condition === null);
    const conditioned = new Set(
      decls
        .map((s) => s.condition && /\[config=([^\]]+)\]/.exec(s.condition))
        .filter(Boolean)
        .map((m) => m[1]),
    );

    const uncovered = configs.filter((c) => !hasDefault && !conditioned.has(c));
    expect(uncovered).toEqual([]);
  });

  test('Debug-Local and Release-Local are both fronted by this file', () => {
    // Guards the assumption the test above rests on. If the project were
    // re-pointed at separate xcconfigs, this file's conditional would stop
    // being the thing that matters and the pin would quietly mean nothing.
    const configs = configurationsUsingLocalXcconfig().sort();
    expect(configs).toEqual(['Debug-Local', 'Release-Local']);
  });
});

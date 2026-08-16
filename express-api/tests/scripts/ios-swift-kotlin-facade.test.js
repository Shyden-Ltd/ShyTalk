'use strict';

// SHY-0306 — a Swift call into the shared KMP framework must name a facade the
// Kotlin side can actually export.
//
// SHY-0300 shipped `AppCheckTokenProviderKt.registerAppCheckBridge(bridge:)`.
// No Kotlin file produces that name. Kotlin/Native names a file's top-level
// facade after THE FILE, and the function lives in
// `AppCheckTokenProvider.ios.kt`, so the generated header declares:
//
//   @interface SharedAppCheckTokenProvider_iosKt : SharedBase   <- .ios -> _ios
//   @interface SharedIosPushBridgeKt            : SharedBase   <- the working one
//
// The rule, read out of that header rather than assumed: take the file's base
// name, replace every `.` with `_`, append `Kt`.
//
// Why this test exists at all: the Kotlin compiles fine, and the Swift side is
// only compiled by `xcodebuild` — which runs in the iOS deploy and test jobs,
// the slowest and latest feedback in the repo. A name mismatch was therefore
// invisible to every fast gate and surfaced ~an hour into a deploy as
// "type 'X' has no member 'y'". This checks the same property from source in
// milliseconds, with no Xcode, no simulator and no network.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SWIFT_DIR = path.join(REPO_ROOT, 'iosApp');
const KOTLIN_DIRS = [
  path.join(REPO_ROOT, 'shared/src/iosMain'),
  path.join(REPO_ROOT, 'shared/src/commonMain'),
];

function walk(dir, ext, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'Pods' || entry.name === 'build') continue;
      walk(p, ext, acc);
    } else if (entry.name.endsWith(ext)) {
      acc.push(p);
    }
  }
  return acc;
}

/**
 * The Swift facade class a Kotlin file's top-level declarations land on.
 * `Foo.kt` -> `FooKt`; `Foo.ios.kt` -> `Foo_iosKt`. Verified against the
 * generated shared.h, not inferred from documentation.
 */
function facadeNameFor(kotlinFile) {
  return `${path.basename(kotlinFile, '.kt').replace(/\./g, '_')}Kt`;
}

/**
 * Top-level functions a Kotlin file EXPORTS to Swift.
 *
 * `private` and `internal` are excluded deliberately: Kotlin/Native does not
 * put them on the facade, so accepting one would let this check pass on code
 * that cannot link. Indented `fun`s are members of a class or interface, not
 * top-level, so only column-0 declarations count.
 */
function exportedTopLevelFuns(src) {
  return src
    .split('\n')
    .map((l) =>
      l.match(/^(?:@\w+\s+)*(?:(public|private|internal)\s+)?fun\s+(?:<[^>]*>\s*)?(\w+)\s*\(/),
    )
    .filter((m) => m && m[1] !== 'private' && m[1] !== 'internal')
    .map((m) => m[2]);
}

/** Swift source with `//` line comments and string literals removed, so a
 *  facade named in prose or in a log message is not read as a call.
 *
 *  The string pattern is `"[^"\n]*"` rather than one that understands `\"`:
 *  the escape-aware form uses a nested alternation that eslint's
 *  sonarjs/slow-regex rejects as super-linear. The simple form ends a string
 *  early at an escaped quote, which can leave real code un-stripped — that
 *  direction is safe here, because the worst outcome is an EXTRA reference to
 *  resolve (a loud failure), never a missed one. */
function swiftCodeOnly(src) {
  const withoutComments = src
    .split('\n')
    .map((l) => {
      // indexOf/slice rather than /\/\/.*$/ — eslint's sonarjs/slow-regex
      // rejects the `.*$` form, and this is both linear and plainer.
      const i = l.indexOf('//');
      return i === -1 ? l : l.slice(0, i);
    })
    .join('\n');
  return withoutComments.replace(/"[^"\n]*"/g, '""');
}

/**
 * The references no Kotlin facade satisfies.
 *
 * Extracted so it can be exercised with synthetic input. Inline, the filter
 * was unfalsifiable: weakening it to accept everything made `unresolved` empty
 * and the real-tree test passed, which mutation testing caught.
 */
function unresolvedReferences(references, exportsByFacade) {
  return references.filter(({ facade, member }) => !exportsByFacade.get(facade)?.has(member));
}

/** Every `SomethingKt.member` reference in Swift code. */
function facadeReferences(file) {
  const code = swiftCodeOnly(fs.readFileSync(file, 'utf8'));
  const out = [];
  const re = /\b([A-Z]\w*Kt)\.(\w+)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push({ file: path.relative(REPO_ROOT, file), facade: m[1], member: m[2] });
  }
  return out;
}

describe('SHY-0306 — Swift references a Kotlin facade that exists', () => {
  const kotlinFiles = KOTLIN_DIRS.flatMap((d) => walk(d, '.kt'));

  /** facade name -> Set of exported top-level function names */
  const exportsByFacade = new Map();
  for (const f of kotlinFiles) {
    const facade = facadeNameFor(f);
    const funs = exportedTopLevelFuns(fs.readFileSync(f, 'utf8'));
    if (!funs.length) continue;
    if (!exportsByFacade.has(facade)) exportsByFacade.set(facade, new Set());
    for (const fn of funs) exportsByFacade.get(facade).add(fn);
  }

  const references = walk(SWIFT_DIR, '.swift').flatMap(facadeReferences);

  test('the scan finds Swift facade references at all (not vacuous)', () => {
    // Without this, a regression in the reference regex would make the
    // assertion below pass over an empty set and prove nothing.
    expect(references.length).toBeGreaterThan(0);
  });

  test('the scan finds Kotlin facades at all (not vacuous)', () => {
    expect(exportsByFacade.size).toBeGreaterThan(0);
  });

  test('every facade Swift calls is exported by some Kotlin file', () => {
    // RED today: AppCheckTokenProviderKt.registerAppCheckBridge — the function
    // lives in AppCheckTokenProvider.ios.kt, which exports it as
    // AppCheckTokenProvider_iosKt.
    const unresolved = unresolvedReferences(references, exportsByFacade).map(
      ({ file, facade, member }) => {
        const owner = kotlinFiles.find((f) =>
          exportedTopLevelFuns(fs.readFileSync(f, 'utf8')).includes(member),
        );
        const hint = owner
          ? ` — ${path.relative(REPO_ROOT, owner)} exports it as ${facadeNameFor(owner)}`
          : ' — no Kotlin file exports that top-level function';
        return `${file}: ${facade}.${member}${hint}`;
      },
    );
    expect(unresolved).toEqual([]);
  });

  test('the resolver rejects a reference nothing exports, and accepts one that is', () => {
    // The control for the check above. Mutation testing found that weakening
    // the resolver to accept everything left every real-tree assertion green —
    // an empty `unresolved` list reads identically to a correct one. Driving
    // it with synthetic input is the only way that mutant can die.
    const exports = new Map([['RealKt', new Set(['present'])]]);
    const refs = [
      { file: 'a.swift', facade: 'RealKt', member: 'present' }, // resolvable
      { file: 'b.swift', facade: 'RealKt', member: 'absent' }, // member missing
      { file: 'c.swift', facade: 'GhostKt', member: 'present' }, // facade missing
    ];

    expect(unresolvedReferences(refs, exports).map((r) => r.file)).toEqual(['b.swift', 'c.swift']);
  });

  test('the .kt/.ios.kt naming rule is applied, not assumed', () => {
    // The rule this whole check rests on, pinned directly so a change to it is
    // deliberate. Measured against the generated shared.h.
    expect(facadeNameFor('/x/IosPushBridge.kt')).toBe('IosPushBridgeKt');
    expect(facadeNameFor('/x/AppCheckTokenProvider.ios.kt')).toBe('AppCheckTokenProvider_iosKt');
  });

  test('a private or internal top-level fun is not treated as exported', () => {
    // Kotlin/Native leaves these off the facade, so accepting one would let
    // this check pass on code that cannot link.
    const src = [
      'fun exported(x: Int) {}',
      'private fun hidden(x: Int) {}',
      'internal fun alsoHidden(x: Int) {}',
      '    fun memberNotTopLevel(x: Int) {}',
    ].join('\n');
    expect(exportedTopLevelFuns(src)).toEqual(['exported']);
  });

  test('a facade named in a Swift comment or string is not a reference', () => {
    const file = path.join(REPO_ROOT, 'iosApp/iosApp/AppDelegate.swift');
    const code = swiftCodeOnly('// see FooKt.bar\nlet s = "BazKt.qux"\nRealKt.method()\n');
    expect(code).not.toMatch(/FooKt\.bar/);
    expect(code).not.toMatch(/BazKt\.qux/);
    expect(code).toMatch(/RealKt\.method/);
    expect(fs.existsSync(file)).toBe(true); // the tree this scans really is here
  });
});

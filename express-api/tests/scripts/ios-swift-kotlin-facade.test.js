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
      // Pods/build/DerivedData hold third-party checkouts (243+ Swift files
      // under iosApp/build/dd/SourcePackages alone) — scanning them would be
      // slow and would resolve references that are not ours.
      if (['Pods', 'build', 'DerivedData'].includes(entry.name)) continue;
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
 * Top-level declarations a Kotlin file EXPORTS to Swift.
 *
 * `private` and `internal` are excluded deliberately: Kotlin/Native does not
 * put them on the facade, so accepting one would let this check pass on code
 * that cannot link. Indented declarations are members of a class or interface,
 * not top-level, so only column-0 ones count.
 *
 * Review caught two gaps in the first version, both of which made the tool
 * blind rather than noisy — the dangerous direction for a check like this:
 *
 *   - it only understood `fun` preceded by a visibility keyword, so the ~20
 *     real top-level `actual fun` declarations in `*.ios.kt` files were
 *     invisible. A future Swift call to one would have been reported as
 *     unresolved WITH a misleading "no Kotlin file exports that" hint;
 *   - it ignored top-level `val`/`var`, which land on the same facade as
 *     properties and which the reference scanner does pick up.
 */
const KOTLIN_MODIFIERS = new Set([
  'public',
  'private',
  'internal',
  'protected',
  'actual',
  'expect',
  'suspend',
  'inline',
  'external',
  'operator',
  'infix',
  'tailrec',
  'const',
  'lateinit',
]);

function exportedTopLevelDecls(src) {
  const out = [];
  for (const line of src.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('@file:')) continue; // indented = member
    const words = line.replace(/^(?:@\w+\s+)*/, '').split(/\s+/);
    let i = 0;
    let hidden = false;
    while (i < words.length && KOTLIN_MODIFIERS.has(words[i])) {
      if (words[i] === 'private' || words[i] === 'internal') hidden = true;
      i += 1;
    }
    const kind = words[i];
    if (kind !== 'fun' && kind !== 'val' && kind !== 'var') continue;
    if (hidden) continue;
    // `fun <T> name(` — skip a generic parameter list before the name.
    const rest = words
      .slice(i + 1)
      .join(' ')
      .replace(/^<[^>]*>\s*/, '');
    const name = rest.match(/^(\w+)/);
    if (name) out.push(name[1]);
  }
  return out;
}

/**
 * Swift source reduced to the parts that can actually contain a call.
 *
 * A single left-to-right pass rather than a chain of regexes, because review
 * found three ways the regex version was wrong and they interact:
 *
 *   - stripping `//` BEFORE strings truncated a line at the `//` inside a URL
 *     literal (`let u = "https://x"; RealKt.call()` lost the call);
 *   - blanking whole string literals also discarded interpolated expressions,
 *     so `"wired=\(SomeKt.thing())"` hid a genuine reference;
 *   - `/* … *\/` block comments were never stripped at all, so a facade named
 *     in one read as a live call.
 *
 * Order and nesting only come out right if the scanner knows which state it is
 * in, so it tracks four: code, string, line comment, block comment — and
 * treats the inside of a `\( … )` interpolation as CODE, which is what it is.
 * Linear, and no regex for eslint's sonarjs/slow-regex to object to.
 */
function swiftCodeOnly(src) {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const two = src.slice(i, i + 2);

    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== '*/') i += 1;
      i += 2;
      continue;
    }
    if (src[i] === '"') {
      i += 1;
      // Skip the literal, but keep what is inside \( … ) — that is real code.
      while (i < src.length && src[i] !== '"') {
        if (src.slice(i, i + 2) === '\\(') {
          i += 2;
          // interpolation nesting, so `\(f(g()))` closes on the right paren
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === '(') depth += 1;
            else if (src[i] === ')') depth -= 1;
            if (depth > 0) out += src[i];
            i += 1;
          }
          out += ' ';
          continue;
        }
        if (src[i] === '\\') i += 1; // an escape never ends the literal
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
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
    const funs = exportedTopLevelDecls(fs.readFileSync(f, 'utf8'));
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
          exportedTopLevelDecls(fs.readFileSync(f, 'utf8')).includes(member),
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

  test('an `actual fun` and a top-level val are recognised as exported', () => {
    // Review finding, and the dangerous direction: the first version only
    // understood `fun` after a visibility keyword, so ~20 real top-level
    // `actual fun` declarations in *.ios.kt files were invisible. A future
    // Swift call to one would have been reported unresolved WITH a misleading
    // "no Kotlin file exports that" hint. Top-level val/var land on the same
    // facade and the reference scanner does pick them up.
    const src = [
      'actual fun currentTimeMillis(): Long = 0L',
      'suspend fun fetch(x: Int) {}',
      'val exportedProp: Int = 1',
      'internal val hiddenProp: Int = 1',
      'expect fun declared()',
      'inline fun <T> generic(x: T) {}',
    ].join('\n');

    expect(exportedTopLevelDecls(src)).toEqual([
      'currentTimeMillis',
      'fetch',
      'exportedProp',
      'declared',
      'generic',
    ]);
  });

  test('a reference inside a string INTERPOLATION is still a reference', () => {
    // Blanking whole string literals hid `"wired=\(SomeKt.thing())"`, which is
    // real code inside a literal — a silent miss, not a loud one.
    expect(swiftCodeOnly('NSLog("wired=\\(AppCheckBridgeKt.hasAppCheckBridge())")')).toMatch(
      /AppCheckBridgeKt\.hasAppCheckBridge/,
    );
  });

  test('a // inside a URL literal does not truncate the rest of the line', () => {
    // Stripping comments before strings chopped the line at the `//` in
    // `https://`, discarding any call that followed it on the same line.
    const code = swiftCodeOnly('let u = "https://x.com"; RealKt.call()');
    expect(code).toMatch(/RealKt\.call/);
  });

  test('a facade named in a BLOCK comment is not a reference', () => {
    // `/* */` was never stripped, so prose in one read as a live call.
    const code = swiftCodeOnly('/* GhostKt.gone() */\nRealKt.call()');
    expect(code).not.toMatch(/GhostKt\.gone/);
    expect(code).toMatch(/RealKt\.call/);
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
    expect(exportedTopLevelDecls(src)).toEqual(['exported']);
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

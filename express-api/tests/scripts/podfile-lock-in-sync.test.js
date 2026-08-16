'use strict';

// SHY-0305 — a Podfile change without a matching Podfile.lock regeneration
// must fail on its own PR, not silently, and not an hour later in the Swift
// compiler on a deploy.
//
// What happened: SHY-0300 added `pod 'FirebaseAppCheck'` to iosApp/Podfile and
// `import FirebaseAppCheck` to AppDelegate.swift, and never regenerated the
// lock. Every iOS build on develop then failed with
//
//   AppDelegate.swift:3:8: error: Unable to resolve module dependency:
//   'FirebaseAppCheck'   ** ARCHIVE FAILED **   exit 65
//
// CI already had a guard for this — `pod install --deployment`, whose own
// comment says it "fails loud on lock mismatch". It never ran. It is skipped
// on a Pods cache hit, and the cache key hashes Podfile.LOCK only, so changing
// the PODFILE leaves the key untouched, the cache hits, and the guard is
// skipped by exactly the condition it exists to catch.
//
// This suite is the cheap, always-on replacement: it needs no CocoaPods, no
// macOS and no network, so it runs in lint on every PR on the ubuntu runner.
//
// The invariant it rests on was verified against a known-good commit before
// being relied upon — at SHY-0300's parent, the lock's PODFILE CHECKSUM equals
// sha1(Podfile) exactly; at develop's tip they differ.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PODFILE = path.join(REPO_ROOT, 'iosApp/Podfile');
const PODFILE_LOCK = path.join(REPO_ROOT, 'iosApp/Podfile.lock');
const GUARD = path.join(REPO_ROOT, 'scripts/check-podfile-lock-sync.sh');

function sha1OfFile(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

function lockChecksum(lockText) {
  const m = lockText.match(/^PODFILE CHECKSUM: ([0-9a-f]{40})$/m);
  return m ? m[1] : null;
}

/** The pods a Podfile declares, in `pod 'Name'` order. */
function declaredPods(podfileText) {
  return podfileText
    .split('\n')
    .filter((l) => !/^\s*#/.test(l)) // never count a commented-out pod
    .map((l) => l.match(/^\s*pod\s+['"]([^'"/]+)/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** The DEPENDENCIES section of a Podfile.lock — the pods it was resolved FOR,
 *  which is not the same as the full transitive SPEC list. FirebaseAppCheck was
 *  absent here while `FirebaseAppCheckInterop` and `AppCheckCore` were present
 *  as transitive deps of other pods, which is exactly why a naive grep for
 *  "AppCheck" in the lock looked reassuring. */
function lockDependencies(lockText) {
  const section = lockText.match(/^DEPENDENCIES:\n([\s\S]*?)\n\n/m);
  if (!section) return [];
  return section[1]
    .split('\n')
    .map((l) => l.match(/^\s*-\s+"?([^\s"(]+)/))
    .filter(Boolean)
    .map((m) => m[1]);
}

function runGuard(cwd) {
  return spawnSync('/bin/bash', [GUARD], {
    encoding: 'utf8',
    timeout: 30000,
    ...(cwd ? { cwd } : {}),
    env: { ...process.env, ...(cwd ? { SHYTALK_REPO: cwd } : {}) },
  });
}

describe('SHY-0305 — the committed Podfile.lock matches the committed Podfile', () => {
  const podfile = fs.readFileSync(PODFILE, 'utf8');
  const lock = fs.readFileSync(PODFILE_LOCK, 'utf8');

  test('the lock records the checksum of the Podfile actually committed', () => {
    // The live defect. RED until the lock is regenerated.
    expect(lockChecksum(lock)).toBe(sha1OfFile(PODFILE));
  });

  test('every pod the Podfile declares appears in the lock DEPENDENCIES', () => {
    // Checksum equality is necessary but not sufficient — it would still pass
    // if someone hand-edited the checksum line. This asserts the substance.
    const missing = declaredPods(podfile).filter((p) => !lockDependencies(lock).includes(p));
    expect(missing).toEqual([]);
  });

  test('a commented-out pod is not required to be in the lock', () => {
    // Guards the guard: a `# pod 'Foo'` line must not be counted, or every
    // future documentation comment becomes a false failure.
    expect(declaredPods("  # pod 'NotReal'\n  pod 'Real'\n")).toEqual(['Real']);
  });
});

describe('SHY-0305 — the guard script', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0305-'));
    fs.mkdirSync(path.join(tmp, 'iosApp'), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  /** Build a real Podfile + lock pair on disk, in sync unless told otherwise. */
  function writePair({ podfileBody, checksum, dependencies }) {
    const pf = path.join(tmp, 'iosApp/Podfile');
    fs.writeFileSync(pf, podfileBody);
    const sum = checksum ?? sha1OfFile(pf);
    const deps = (dependencies ?? declaredPods(podfileBody)).map((d) => `  - ${d}`).join('\n');
    fs.writeFileSync(
      path.join(tmp, 'iosApp/Podfile.lock'),
      `PODS:\n  - Whatever (1.0)\n\nDEPENDENCIES:\n${deps}\n\nSPEC CHECKSUMS:\n  Whatever: abc\n\nPODFILE CHECKSUM: ${sum}\n\nCOCOAPODS: 1.17.0\n`,
    );
  }

  test('accepts a matching pair', () => {
    // The control. Without it, a guard that always fails would pass every
    // rejection case below.
    writePair({ podfileBody: "target 'iosApp' do\n  pod 'FirebaseCore'\nend\n" });
    expect(runGuard(tmp).status).toBe(0);
  });

  test('rejects a Podfile edited without regenerating the lock', () => {
    // The actual defect: the lock still carries the OLD Podfile's checksum.
    const oldBody = "target 'iosApp' do\n  pod 'FirebaseCore'\nend\n";
    writePair({ podfileBody: oldBody });
    const staleSum = lockChecksum(fs.readFileSync(path.join(tmp, 'iosApp/Podfile.lock'), 'utf8'));
    fs.writeFileSync(
      path.join(tmp, 'iosApp/Podfile'),
      "target 'iosApp' do\n  pod 'FirebaseCore'\n  pod 'FirebaseAppCheck'\nend\n",
    );

    const r = runGuard(tmp);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Podfile\.lock/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/pod install/); // says how to fix it
    expect(staleSum).toMatch(/^[0-9a-f]{40}$/); // fixture sanity
  });

  test('rejects a hand-edited checksum whose lock is still missing the pod', () => {
    // Checksum equality alone is not enough — this is the shape that would
    // sneak past a checksum-only guard.
    const body = "target 'iosApp' do\n  pod 'FirebaseCore'\n  pod 'FirebaseAppCheck'\nend\n";
    writePair({ podfileBody: body, dependencies: ['FirebaseCore'] });

    const r = runGuard(tmp);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/FirebaseAppCheck/);
  });

  test('accepts a Podfile whose commented-out pod is absent from the lock', () => {
    // The false-positive direction, and the one a JS-side parser test cannot
    // prove: the GUARD must ignore `# pod 'X'`. Caught by mutation — making
    // the guard count comments left every other case green, because no other
    // fixture here has a commented-out pod for it to trip over.
    //
    // This is not hypothetical: iosApp/Podfile documents the LiveKit migration
    // to SPM in prose that sits right beside real `pod` lines.
    writePair({
      podfileBody:
        "target 'iosApp' do\n" +
        "  pod 'FirebaseCore'\n" +
        '  # LiveKit moved to SPM — kept here as a note, NOT a declaration:\n' +
        "  # pod 'LiveKitClient'\n" +
        'end\n',
      dependencies: ['FirebaseCore'],
    });

    const r = runGuard(tmp);

    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/LiveKitClient/);
  });

  test('accepts the REAL repository, running the real script with no overrides', () => {
    // Every other case here feeds the guard a synthetic temp tree. Those
    // fixtures are simple by design, so a bug that only shows against the real
    // file's structure — its SPEC REPOS section, its subspec entries, its
    // prose comments — would be caught by lint in CI and by nothing in this
    // suite. No cwd and no SHYTALK_REPO: the script resolves the repo from its
    // own BASH_SOURCE, exactly as the lint step invokes it.
    const r = spawnSync('/bin/bash', [GUARD], { encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
    expect(r.status).toBe(0);
  });

  test('handles subspecs, version constraints and quoted lock entries', () => {
    // The script claims all three in its comments and none was exercised.
    // `pod 'A/B'` resolves under its parent; a version constraint is not part
    // of the name; CocoaPods quotes a lock entry when it carries a version.
    const pf = path.join(tmp, 'iosApp/Podfile');
    fs.writeFileSync(
      pf,
      "target 'iosApp' do\n" +
        "  pod 'GoogleUtilities/Environment'\n" +
        "  pod 'FirebaseCore', '~> 12.14'\n" +
        "  pod 'Local', :path => '../vendor/Local'\n" +
        'end\n',
    );
    fs.writeFileSync(
      path.join(tmp, 'iosApp/Podfile.lock'),
      'PODS:\n  - Whatever (1.0)\n\nDEPENDENCIES:\n' +
        '  - GoogleUtilities/Environment\n' +
        '  - "FirebaseCore (~> 12.14)"\n' +
        '  - Local (from `../vendor/Local`)\n' +
        `\nSPEC CHECKSUMS:\n  Whatever: abc\n\nPODFILE CHECKSUM: ${sha1OfFile(pf)}\n\nCOCOAPODS: 1.17.0\n`,
    );

    const r = runGuard(tmp);
    if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
    expect(r.status).toBe(0);
  });

  test('names EVERY missing pod, not just the first', () => {
    // Exercises the MISSING accumulation. A guard that stopped at the first
    // would send a developer round the loop once per pod.
    writePair({
      podfileBody: "target 'iosApp' do\n  pod 'Alpha'\n  pod 'Beta'\n  pod 'Gamma'\nend\n",
      dependencies: ['Beta'],
    });

    const r = runGuard(tmp);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Alpha/);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Gamma/);
  });

  test('a Podfile declaring no pods at all is accepted', () => {
    // The degenerate path: an empty DECLARED must not loop over one empty
    // string and report "" as a missing pod.
    writePair({ podfileBody: "target 'iosApp' do\nend\n", dependencies: [] });

    const r = runGuard(tmp);
    if (r.status !== 0) throw new Error(`${r.stdout}\n${r.stderr}`);
    expect(r.status).toBe(0);
  });

  test('fails loudly when no SHA-1 tool is available, never silently passing', () => {
    // macOS has shasum and no sha1sum; a minimal Linux image can have neither.
    // Unreachable in both environments this is normally run in, which is
    // exactly why it needs asserting: the dangerous outcome is a guard that
    // cannot hash and reports success anyway.
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const tool of ['sed', 'awk', 'grep', 'sort', 'cat', 'printf', 'tail']) {
      for (const dir of ['/usr/bin', '/bin']) {
        const src = path.join(dir, tool);
        if (fs.existsSync(src) && !fs.existsSync(path.join(bin, tool))) {
          fs.symlinkSync(src, path.join(bin, tool));
        }
      }
    }
    writePair({ podfileBody: "target 'iosApp' do\n  pod 'FirebaseCore'\nend\n" });

    const r = spawnSync('/bin/bash', [GUARD], {
      encoding: 'utf8',
      timeout: 30000,
      cwd: tmp,
      env: { PATH: bin, SHYTALK_REPO: tmp },
    });

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/shasum|sha1sum/);
  });

  test('rejects a missing lock outright', () => {
    writePair({ podfileBody: "target 'iosApp' do\n  pod 'FirebaseCore'\nend\n" });
    fs.rmSync(path.join(tmp, 'iosApp/Podfile.lock'));

    expect(runGuard(tmp).status).not.toBe(0);
  });

  test('a whitespace-only Podfile change is still a change', () => {
    // CocoaPods hashes the bytes, so a trailing newline moves the checksum.
    // A guard that normalised whitespace would drift from CocoaPods' own view
    // and start disagreeing with `pod install --deployment`.
    writePair({ podfileBody: "target 'iosApp' do\n  pod 'FirebaseCore'\nend\n" });
    fs.appendFileSync(path.join(tmp, 'iosApp/Podfile'), '\n');

    expect(runGuard(tmp).status).not.toBe(0);
  });
});

// ── the CI-side root cause ──────────────────────────────────────────
//
// Regenerating the lock fixes today's breakage; these pin the reason it went
// unnoticed. Every iOS cache whose key is derived from Podfile.lock must also
// hash the Podfile, or a Podfile-only change leaves the key untouched, the
// cache hits, and the `pod install --deployment` guard is skipped by exactly
// the condition it exists to catch.
//
// Enumerated across ALL workflows rather than asserted at one known site, so a
// third workflow added later is caught rather than quietly exempt.

describe('SHY-0305 — no iOS cache key may hash the lock without the Podfile', () => {
  const WORKFLOWS = path.join(REPO_ROOT, '.github/workflows');

  /** Every `key:` line in every workflow that hashes iosApp/Podfile.lock. */
  function lockKeyedCacheKeys() {
    return fs
      .readdirSync(WORKFLOWS)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .flatMap((f) =>
        fs
          .readFileSync(path.join(WORKFLOWS, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ file: f, line: i + 1, text: line }))
          .filter(({ text }) => /^\s*key:/.test(text) && text.includes('iosApp/Podfile.lock')),
      );
  }

  test('there is at least one such cache key (the scan is not vacuous)', () => {
    // Without this, deleting every cache would make the assertion below pass
    // while proving nothing.
    expect(lockKeyedCacheKeys().length).toBeGreaterThan(0);
  });

  test('every one of them also hashes iosApp/Podfile', () => {
    const offenders = lockKeyedCacheKeys()
      .filter(({ text }) => !/['"]iosApp\/Podfile['"]/.test(text))
      .map(({ file, line }) => `${file}:${line}`);
    expect(offenders).toEqual([]);
  });

  /** Every non-comment `pod install` invocation across all workflows. */
  function podInstallSites() {
    return fs
      .readdirSync(WORKFLOWS)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .flatMap((f) =>
        fs
          .readFileSync(path.join(WORKFLOWS, f), 'utf8')
          .split('\n')
          .map((line, i) => ({ file: f, line: i + 1, text: line }))
          .filter(({ text }) => !/^\s*#/.test(text))
          .filter(({ text }) => /(^|\s|&&)pod install(\s|$)/.test(text)),
      );
  }

  test('CI actually invokes `pod install` somewhere (the scan is not vacuous)', () => {
    // Without this, a regression in the matching regex above would make the
    // --deployment assertion pass over an empty set and prove nothing. Its
    // sibling scan has this guard; this one did not until review.
    expect(podInstallSites().length).toBeGreaterThan(0);
  });

  test('every `pod install` in CI runs with --deployment', () => {
    // Plain `pod install` silently REGENERATES a mismatched lock instead of
    // failing, which would have masked this breakage on prod while dev failed.
    const offenders = podInstallSites()
      .filter(({ text }) => !text.includes('--deployment'))
      .map(({ file, line }) => `${file}:${line}`);
    expect(offenders).toEqual([]);
  });

  test('the lint job runs the guard, unconditionally', () => {
    // This step is the PR's whole "caught on every PR regardless of surface"
    // guarantee. Nothing pinned it — actionlint checks syntax, not presence,
    // and an `if:` added later would silently restore the blind spot for
    // exactly the PRs that change only the Podfile.
    // Line-based rather than a `[\s\S]*?` capture with a lookahead: that shape
    // is super-linear under backtracking and eslint's sonarjs/slow-regex
    // rejects it. Slicing lines is both linear and easier to read.
    const lines = fs.readFileSync(path.join(WORKFLOWS, 'lint.yml'), 'utf8').split('\n');
    const start = lines.findIndex((l) =>
      /^\s*- name: Validate Podfile\.lock is in sync with Podfile\s*$/.test(l),
    );
    expect(start).toBeGreaterThan(-1);

    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^\s*- name: /.test(l));
    const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');

    expect(body).toMatch(/run: bash scripts\/check-podfile-lock-sync\.sh/);
    // No regex: `^\s*` under the multiline flag is what sonarjs/slow-regex
    // objects to, and a plain prefix test says the same thing more directly.
    const gated = body.split('\n').filter((l) => l.trimStart().startsWith('if:'));
    expect(gated).toEqual([]); // never gated on a changed-paths filter
  });
});

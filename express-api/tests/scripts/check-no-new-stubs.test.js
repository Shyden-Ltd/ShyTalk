/* eslint-disable sonarjs/no-os-command-from-path --
 * This test spawns hardcoded binaries (`git`, `node`) with literal argv to
 * drive the REAL guard against REAL throwaway git repos — no user-controlled
 * command and no PATH manipulation. Matches the sibling check-story / check-epic
 * / check-node-version frontmatter test convention. */
/**
 * check-no-new-stubs.test.js — SHY-0108 (EPIC-0003 Phase X)
 *
 * Tests the anti-regression ratchet guard. Real-only (CLAUDE.md § No
 * Stubs): the scan logic is exercised against REAL temporary files on
 * disk (real `fs`) and against the REAL repo — never `jest.mock`, which
 * would be self-defeating for the very guard that bans it.
 *
 * The three banned literals are built by string concatenation so this
 * test source is itself free of the patterns it exercises (defence in
 * depth alongside the guard's own self-exclusion of these two files).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const guard = require('../../../scripts/check-no-new-stubs');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT_ABS = path.join(REPO_ROOT, guard.SCRIPT_REL);

/**
 * Real-only test helpers (CLAUDE.md § No Stubs). No jest.mock, no faked
 * collaborators — these build a REAL throwaway git repo on disk and drive
 * the REAL guard against it.
 */
function makeTempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108repo-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'shy0108@test.local']);
  git(['config', 'user.name', 'shy0108']);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(['add', '-A']); // gitTrackedFiles uses `git ls-files` → staged is enough
  return dir;
}

/**
 * Run `fn` while capturing the process's REAL stdout/stderr writes (output
 * inspection, NOT a behavioural double), restoring the originals afterwards.
 */
function capture(fn) {
  const outChunks = [];
  const errChunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => {
    outChunks.push(String(s));
    return true;
  };
  process.stderr.write = (s) => {
    errChunks.push(String(s));
    return true;
  };
  let ret;
  try {
    ret = fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { ret, stdout: outChunks.join(''), stderr: errChunks.join('') };
}

const JEST_MOCK = 'jest' + ".mock('../src/thing')";
const FAKE_REPO = 'class ' + 'FakeUserRepository : UserRepository {}';
const PAGE_ROUTE = 'await page' + ".route('**/api/**', (r) => r.fulfill({ status: 200 }))";

describe('SHY-0108 classifyContent — value matrix (exact booleans)', () => {
  test('jest.mock → jestMock only', () => {
    expect(guard.classifyContent(JEST_MOCK)).toEqual({
      jestMock: true,
      fakeRepository: false,
      pageRoute: false,
    });
  });

  test('Fake<Word>Repository → fakeRepository only', () => {
    expect(guard.classifyContent(FAKE_REPO)).toEqual({
      jestMock: false,
      fakeRepository: true,
      pageRoute: false,
    });
  });

  test('page.route → pageRoute only', () => {
    expect(guard.classifyContent(PAGE_ROUTE)).toEqual({
      jestMock: false,
      fakeRepository: false,
      pageRoute: true,
    });
  });

  test('clean content → all false', () => {
    expect(guard.classifyContent('const repo = realUserRepository();')).toEqual({
      jestMock: false,
      fakeRepository: false,
      pageRoute: false,
    });
  });

  test('all three present → all true', () => {
    expect(guard.classifyContent(`${JEST_MOCK}\n${FAKE_REPO}\n${PAGE_ROUTE}`)).toEqual({
      jestMock: true,
      fakeRepository: true,
      pageRoute: true,
    });
  });

  test('a plain "Repository" with no Fake prefix is NOT flagged', () => {
    expect(guard.classifyContent('const x = new UserRepository();').fakeRepository).toBe(false);
  });
});

describe('SHY-0108 scanFiles — real temp tree + extension gating', () => {
  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108-'));
    fs.writeFileSync(path.join(dir, 'a.test.js'), JEST_MOCK);
    fs.mkdirSync(path.join(dir, 'kt'));
    fs.writeFileSync(path.join(dir, 'kt', 'Foo.kt'), FAKE_REPO);
    fs.writeFileSync(path.join(dir, 'b.spec.ts'), PAGE_ROUTE);
    fs.writeFileSync(path.join(dir, 'clean.test.js'), 'const x = real();');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

  test('buckets each offender into its category', () => {
    const off = guard.scanFiles(['a.test.js', 'kt/Foo.kt', 'b.spec.ts', 'clean.test.js'], read);
    expect(off.jestMock).toEqual(['a.test.js']);
    expect(off.fakeRepository).toEqual(['kt/Foo.kt']);
    expect(off.pageRoute).toEqual(['b.spec.ts']);
  });

  test('jest.mock / page.route patterns do NOT apply to a .kt file (extension gate)', () => {
    const p = 'kt/Weird.kt';
    fs.writeFileSync(path.join(dir, p), `${JEST_MOCK}\n${PAGE_ROUTE}`);
    const off = guard.scanFiles([p], read);
    expect(off.jestMock).toEqual([]);
    expect(off.pageRoute).toEqual([]);
  });

  test('Fake*Repository pattern does NOT apply to a .js file (extension gate)', () => {
    const p = 'js-with-fake.test.js';
    fs.writeFileSync(path.join(dir, p), FAKE_REPO);
    const off = guard.scanFiles([p], read);
    expect(off.fakeRepository).toEqual([]);
  });

  test('output is sorted (deterministic)', () => {
    fs.writeFileSync(path.join(dir, 'z.test.js'), JEST_MOCK);
    fs.writeFileSync(path.join(dir, 'm.test.js'), JEST_MOCK);
    const off = guard.scanFiles(['z.test.js', 'm.test.js', 'a.test.js'], read);
    expect(off.jestMock).toEqual(['a.test.js', 'm.test.js', 'z.test.js']);
  });
});

describe('SHY-0108 diffBaseline — new vs stale', () => {
  const baseline = { jestMock: ['known.test.js'], fakeRepository: [], pageRoute: [] };

  test('a new offender (not in baseline) is reported under newOffenders', () => {
    const off = { jestMock: ['known.test.js', 'new.test.js'], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders.jestMock).toEqual(['new.test.js']);
    expect(d.staleEntries.jestMock).toEqual([]);
    expect(guard.isClean(d)).toBe(false);
  });

  test('a baseline entry that no longer offends is reported under staleEntries', () => {
    const off = { jestMock: [], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.staleEntries.jestMock).toEqual(['known.test.js']);
    expect(d.newOffenders.jestMock).toEqual([]);
    expect(guard.isClean(d)).toBe(false);
  });

  test('offenders exactly equal to baseline → clean', () => {
    const d = guard.diffBaseline(
      { jestMock: ['known.test.js'], fakeRepository: [], pageRoute: [] },
      baseline,
    );
    expect(guard.isClean(d)).toBe(true);
  });
});

describe('SHY-0108 committed baseline is in sync with the real repo', () => {
  test('real repo scan equals committed baseline (guard green on this branch)', () => {
    const off = guard.scanRepo({ cwd: REPO_ROOT });
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders).toEqual({ jestMock: [], fakeRepository: [], pageRoute: [] });
    expect(d.staleEntries).toEqual({ jestMock: [], fakeRepository: [], pageRoute: [] });
  });

  test('baseline is non-trivial (captures the known EPIC-0003 debt)', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    // Sanity: the drain has real debt to ratchet — not an empty file.
    expect(baseline.jestMock.length).toBeGreaterThan(100);
    expect(baseline.fakeRepository.length).toBeGreaterThan(10);
    expect(baseline.pageRoute.length).toBeGreaterThan(0);
  });
});

describe('SHY-0108 diffBaseline — rename + multi-category coverage', () => {
  test('a renamed offender surfaces as BOTH a stale old-path AND a new new-path', () => {
    const baseline = { jestMock: ['old.test.js'], fakeRepository: [], pageRoute: [] };
    const off = { jestMock: ['new.test.js'], fakeRepository: [], pageRoute: [] };
    const d = guard.diffBaseline(off, baseline);
    expect(d.newOffenders.jestMock).toEqual(['new.test.js']);
    expect(d.staleEntries.jestMock).toEqual(['old.test.js']);
    expect(guard.isClean(d)).toBe(false);
  });

  test('new offenders across all three categories are each reported', () => {
    const d = guard.diffBaseline(
      { jestMock: ['j.test.js'], fakeRepository: ['F.kt'], pageRoute: ['p.spec.ts'] },
      { jestMock: [], fakeRepository: [], pageRoute: [] },
    );
    expect(d.newOffenders.jestMock).toEqual(['j.test.js']);
    expect(d.newOffenders.fakeRepository).toEqual(['F.kt']);
    expect(d.newOffenders.pageRoute).toEqual(['p.spec.ts']);
    expect(guard.isClean(d)).toBe(false);
  });
});

describe('SHY-0108 scanFiles — unreadable file is skipped (catch branch)', () => {
  test('a path whose readFile throws is skipped; readable offenders still bucketed', () => {
    const read = (p) => {
      if (p === 'unreadable.test.js') throw new Error('EISDIR');
      return JEST_MOCK;
    };
    const off = guard.scanFiles(['unreadable.test.js', 'ok.test.js'], read);
    expect(off.jestMock).toEqual(['ok.test.js']);
  });
});

describe('SHY-0108 loadBaseline — error paths (the exit-2 sources)', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108base-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('missing baseline file → throws "Baseline not found"', () => {
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/Baseline not found/);
  });

  test('malformed JSON → throws "malformed JSON"', () => {
    fs.writeFileSync(path.join(dir, guard.BASELINE_REL), '{ not valid json');
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/malformed JSON/);
  });

  test('a non-array category → throws "must be an array"', () => {
    fs.writeFileSync(path.join(dir, guard.BASELINE_REL), JSON.stringify({ jestMock: 'nope' }));
    expect(() => guard.loadBaseline({ cwd: dir })).toThrow(/must be an array/);
  });

  test('missing categories normalise to empty arrays (no throw)', () => {
    fs.writeFileSync(
      path.join(dir, guard.BASELINE_REL),
      JSON.stringify({ jestMock: ['x.test.js'] }),
    );
    expect(guard.loadBaseline({ cwd: dir })).toEqual({
      jestMock: ['x.test.js'],
      fakeRepository: [],
      pageRoute: [],
    });
  });
});

describe('SHY-0108 gitTrackedFiles — real subprocess', () => {
  test('returns repo-relative paths for the real repo (incl. the guard script)', () => {
    const files = guard.gitTrackedFiles(REPO_ROOT);
    expect(Array.isArray(files)).toBe(true);
    expect(files).toContain('scripts/check-no-new-stubs.js');
  });

  test('a non-git directory → throws "git ls-files failed"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shy0108nogit-'));
    try {
      expect(() => guard.gitTrackedFiles(dir)).toThrow(/git ls-files failed/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SHY-0108 generateBaseline — deterministic write', () => {
  let repo;
  beforeEach(() => {
    repo = makeTempRepo({ 'a.test.js': JEST_MOCK, 'scripts/keep.txt': 'so scripts/ exists' });
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  test('writes a baseline capturing the offender; sorted + trailing newline', () => {
    const off = guard.generateBaseline({ cwd: repo });
    expect(off.jestMock).toEqual(['a.test.js']);
    const written = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written)).toEqual({
      jestMock: ['a.test.js'],
      fakeRepository: [],
      pageRoute: [],
    });
  });

  test('is deterministic — two runs produce byte-identical output', () => {
    guard.generateBaseline({ cwd: repo });
    const first = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    guard.generateBaseline({ cwd: repo });
    const second = fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8');
    expect(second).toBe(first);
  });
});

describe('SHY-0108 reportAndExit — return code + emitted annotations', () => {
  test('clean diff → returns 0 and prints the remaining-debt summary', () => {
    const baseline = guard.loadBaseline({ cwd: REPO_ROOT });
    const clean = guard.diffBaseline(baseline, baseline);
    const { ret, stdout } = capture(() => guard.reportAndExit(clean, baseline));
    expect(ret).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  test('a NEW offender → returns 1 and emits a ::error file= NEW annotation', () => {
    const baseline = { jestMock: [], fakeRepository: [], pageRoute: [] };
    const diff = guard.diffBaseline(
      { jestMock: ['new.test.js'], fakeRepository: [], pageRoute: [] },
      baseline,
    );
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, baseline));
    expect(ret).toBe(1);
    expect(stderr).toContain('::error file=new.test.js::NEW jest.mock(');
  });

  test('a STALE entry → returns 1 and emits a STALE baseline annotation', () => {
    const baseline = { jestMock: ['gone.test.js'], fakeRepository: [], pageRoute: [] };
    const diff = guard.diffBaseline({ jestMock: [], fakeRepository: [], pageRoute: [] }, baseline);
    const { ret, stderr } = capture(() => guard.reportAndExit(diff, baseline));
    expect(ret).toBe(1);
    expect(stderr).toContain('STALE baseline entry');
  });
});

describe('SHY-0108 main() — CLI exit-code contract (real spawned process)', () => {
  const runCli = (args, cwd) => spawnSync('node', [SCRIPT_ABS, ...args], { cwd, encoding: 'utf8' });

  test('--help → exit 0 + usage banner', () => {
    const r = runCli(['--help'], REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bans (ratchet');
  });

  test('-h shorthand → exit 0 + usage banner', () => {
    const r = runCli(['-h'], REPO_ROOT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Bans (ratchet');
  });

  test('clean repo (baseline matches offenders) → exit 0', () => {
    const repo = makeTempRepo({
      'a.test.js': JEST_MOCK,
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: ['a.test.js'], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/clean/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a NEW offender absent from the baseline → exit 1', () => {
    const repo = makeTempRepo({
      'a.test.js': JEST_MOCK,
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: [], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('ratchet violated');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a STALE baseline entry (no longer offends) → exit 1 at the process boundary', () => {
    const repo = makeTempRepo({
      'scripts/no-stubs-baseline.json': `${JSON.stringify(
        { jestMock: ['gone.test.js'], fakeRepository: [], pageRoute: [] },
        null,
        2,
      )}\n`,
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('STALE baseline entry');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('missing baseline → exit 2', () => {
    const repo = makeTempRepo({ 'a.test.js': 'const x = real();' });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/Baseline not found/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('malformed baseline → exit 2', () => {
    const repo = makeTempRepo({
      'a.test.js': 'const x = real();',
      'scripts/no-stubs-baseline.json': '{ broken',
    });
    try {
      const r = runCli([], repo);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/malformed JSON/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('--generate-baseline → exit 0 + writes the baseline file', () => {
    const repo = makeTempRepo({ 'a.test.js': JEST_MOCK, 'scripts/keep.txt': 'x' });
    try {
      const r = runCli(['--generate-baseline'], repo);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/wrote/);
      const written = JSON.parse(fs.readFileSync(path.join(repo, guard.BASELINE_REL), 'utf8'));
      expect(written.jestMock).toEqual(['a.test.js']);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

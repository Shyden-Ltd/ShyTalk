/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash`, `git`, and the script-under-test in
   temporary directories with controlled inputs. Not security-sensitive. */
/**
 * Tests for `scripts/check-node-version.sh` — the local Node-major guard
 * delivered by SHY-0069 (see `.project/stories/SHY-0069-pin-local-node-and-hook-observability.md`).
 *
 * Why this exists: on 2026-06-09 brew silently upgraded local node to
 * 26.3.0, which wedges full Jest suite runs (0% CPU, no output, no
 * timeout). CI pins node 24. The guard fails a push fast, BEFORE any
 * test step, when the local major drifts from `.nvmrc`.
 *
 * Exit codes (documented in --help and the script header):
 *   0  local node major matches .nvmrc major (silent)
 *   1  major mismatch (actionable message on stderr)
 *   2  .nvmrc missing / unreadable / non-numeric
 *   3  node not found on PATH
 *
 * Fixture strategy: each test creates a fresh tmpdir git repo with a
 * controlled `.nvmrc`, then runs the script with `cwd` inside it. The
 * script-under-test is invoked via absolute path. PATH manipulation is
 * scoped to each spawnSync `env` option — never `process.env` globally —
 * so nothing leaks across Jest workers.
 */

const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-node-version.sh');
const HOOK = path.join(REPO_ROOT, '.husky', 'pre-push');

const REAL_MAJOR = process.version.replace(/^v/, '').split('.')[0];

const TEMP_DIRS = [];

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Spawn the script + return { code, stdout, stderr }. */
function runScript(opts = {}) {
  const res = spawnSync('bash', [SCRIPT], {
    encoding: 'utf-8',
    cwd: opts.cwd ?? REPO_ROOT,
    timeout: 30_000,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/** Fresh git repo in a tmpdir, optionally with an .nvmrc payload. */
function tempRepo(nvmrcContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-node-version-'));
  TEMP_DIRS.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (nvmrcContent !== undefined) {
    fs.writeFileSync(path.join(dir, '.nvmrc'), nvmrcContent);
  }
  return dir;
}

/** PATH shim dir whose `node` prints the given version string. */
function nodeShim(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-shim-'));
  TEMP_DIRS.push(dir);
  const shim = path.join(dir, 'node');
  fs.writeFileSync(shim, `#!/bin/bash\necho "${version}"\n`);
  fs.chmodSync(shim, 0o755);
  return dir;
}

describe('check-node-version.sh', () => {
  describe('happy path', () => {
    test('exits 0 and stays silent when .nvmrc major matches node major', () => {
      const repo = tempRepo(`${REAL_MAJOR}\n`);
      const res = runScript({ cwd: repo });
      expect(res.code).toBe(0);
      expect(res.stdout).toBe('');
      expect(res.stderr).toBe('');
    });

    test('resolves .nvmrc from the git root when invoked from a subdirectory', () => {
      const repo = tempRepo(`${REAL_MAJOR}\n`);
      const sub = path.join(repo, 'deep', 'nested');
      fs.mkdirSync(sub, { recursive: true });
      const res = runScript({ cwd: sub });
      expect(res.code).toBe(0);
      expect(res.stderr).toBe('');
    });
  });

  describe('major mismatch', () => {
    test('exits 1 with actionable stderr naming both versions, the guard tag, and the brew hint', () => {
      const repo = tempRepo('24\n');
      const shimDir = nodeShim('v26.3.0');
      const res = runScript({
        cwd: repo,
        env: { PATH: `${shimDir}:${process.env.PATH}` },
      });
      expect(res.code).toBe(1);
      expect(res.stderr).toContain('node-version-guard');
      expect(res.stderr).toContain('26');
      expect(res.stderr).toContain('24');
      expect(res.stderr).toContain('brew link');
    });
  });

  describe('fail-closed config errors (exit 2)', () => {
    test('exits 2 when .nvmrc is missing', () => {
      const repo = tempRepo(undefined);
      const res = runScript({ cwd: repo });
      expect(res.code).toBe(2);
      expect(res.stderr).toContain('.nvmrc');
    });

    test('exits 2 on garbage .nvmrc content', () => {
      const repo = tempRepo('abc\n');
      const res = runScript({ cwd: repo });
      expect(res.code).toBe(2);
      expect(res.stderr).toContain('.nvmrc');
    });
  });

  describe('fail-closed missing node (exit 3)', () => {
    test('exits 3 with a "node not found" message when node is absent from PATH', () => {
      const repo = tempRepo('24\n');
      // /usr/bin:/bin provides bash/git/coreutils but no node on macOS.
      const res = runScript({ cwd: repo, env: { PATH: '/usr/bin:/bin' } });
      expect(res.code).toBe(3);
      expect(res.stderr).toContain('node not found');
    });
  });

  describe('version-string normalisation', () => {
    test.each([
      ['v-prefixed full semver', `v${REAL_MAJOR}.0.0\n`],
      ['bare major with trailing newline', `${REAL_MAJOR}\n`],
      ['surrounding whitespace', `  ${REAL_MAJOR}  \n`],
      ['major.minor', `${REAL_MAJOR}.1\n`],
    ])('exits 0 for %s', (_label, content) => {
      const repo = tempRepo(content);
      const res = runScript({ cwd: repo });
      expect(res.code).toBe(0);
    });
  });

  describe('hook wiring', () => {
    const hookSource = () => fs.readFileSync(HOOK, 'utf-8');

    test('.husky/pre-push invokes the guard unconditionally, before the HAS_CODE filter and the Express-tests step', () => {
      const src = hookSource();
      const guardIdx = src.indexOf('check-node-version.sh');
      const hasCodeIdx = src.indexOf('HAS_CODE=');
      const expressIdx = src.indexOf('Express tests with coverage');
      expect(guardIdx).toBeGreaterThan(-1);
      expect(hasCodeIdx).toBeGreaterThan(-1);
      expect(expressIdx).toBeGreaterThan(-1);
      // Before HAS_CODE: even config-only pushes (e.g. editing .nvmrc
      // itself) must get the drift check — reviewer finding, SHY-0069.
      expect(guardIdx).toBeLessThan(hasCodeIdx);
      expect(guardIdx).toBeLessThan(expressIdx);
    });

    test('the Jest coverage step no longer discards stderr', () => {
      const jestLines = hookSource()
        .split('\n')
        .filter((l) => l.includes('jest --coverage'));
      expect(jestLines.length).toBeGreaterThan(0);
      for (const line of jestLines) {
        expect(line).not.toMatch(/2>\/dev\/null/);
      }
    });
  });
});

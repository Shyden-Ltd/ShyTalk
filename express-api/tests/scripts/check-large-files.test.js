/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash`, `git`, `dd`, and the script-under-test
   in temporary directories with controlled inputs. Not security-sensitive. */
/**
 * Tests for `scripts/check-large-files.sh` — the >5MB file guard delivered
 * by SHY-0035 (see `.project/audit/repo-size-audit-2026-06-08.md` for the
 * audit that motivated this script and `.project/stories/SHY-0035-investigate-repo-size.md`
 * for the spec).
 *
 * Exit codes (documented in --help and the script header):
 *   0  no large files (or all exempted)
 *   1  large files detected
 *   2  usage error
 *   3  git not available / not a git repo
 *   4  --against ref unreachable locally
 *
 * Fixture strategy: each test that needs a synthetic git repo creates a
 * fresh tmpdir, runs `git init`, commits files of controlled size, then
 * exercises the script with `cwd` set to the tmpdir. The script-under-test
 * is invoked via absolute path so it doesn't rely on the host CWD.
 */

const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-large-files.sh');

const THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MiB

const TEMP_DIRS = [];

/** Spawn the script + return { code, stdout, stderr }. */
function runScript(args, opts = {}) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: opts.cwd ?? REPO_ROOT,
    timeout: 30_000,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
  };
}

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-large-files-'));
  TEMP_DIRS.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@shytalk.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

/** Create a file of EXACTLY `size` bytes inside repo. */
function writeFileOfSize(repoDir, relPath, size) {
  const full = path.join(repoDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  // Allocate sparse-ish file then write a single byte at offset (size-1)
  // — keeps the test fast vs writing N zeroes. Git still sees the full
  // size when packing.
  const fd = fs.openSync(full, 'w');
  try {
    if (size > 0) {
      fs.writeSync(fd, Buffer.from([0]), 0, 1, size - 1);
    }
  } finally {
    fs.closeSync(fd);
  }
}

function commit(repoDir, message) {
  execFileSync('git', ['add', '-A'], { cwd: repoDir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: repoDir });
}

afterAll(() => {
  for (const d of TEMP_DIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  }
});

// ============================================================== tests

describe('scripts/check-large-files.sh', () => {
  describe('precondition', () => {
    it('script file exists', () => {
      expect(fs.existsSync(SCRIPT)).toBe(true);
    });

    it('script is executable (user-x bit set)', () => {
      const mode = fs.statSync(SCRIPT).mode;
      expect(mode & 0o100).toBe(0o100);
    });
  });

  describe('--help', () => {
    it('exits 0 and prints usage + threshold + exit codes', () => {
      const { code, stdout } = runScript(['--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/check-large-files\.sh|Usage:/);
      expect(stdout).toMatch(/--against/);
      expect(stdout).toMatch(/--help/);
      expect(stdout).toMatch(/Exit codes/);
      // Marker syntax documented.
      expect(stdout).toMatch(/allow-large-file/);
    });
  });

  describe('usage errors → exit 2', () => {
    it('exits 2 on unknown flag', () => {
      const { code, stderr } = runScript(['--bogus']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown flag/);
    });

    it('exits 2 when --against given without a value', () => {
      const { code, stderr } = runScript(['--against']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--against requires/);
    });

    it('exits 2 when --against=<empty> is given (equals-form rejects empty value)', () => {
      const { code, stderr } = runScript(['--against=']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--against requires/);
    });
  });

  describe('--against=<ref> equals-form (common shell convention)', () => {
    it('accepts equals-form and behaves identically to space-form', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'a.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'b.txt', 100);
      commit(repo, 'feature small add');
      const { code, stderr } = runScript(['--against=main'], { cwd: repo });
      expect(code).toBe(0);
      expect(stderr).toMatch(/mode: diff/);
    });
  });

  describe('--against unreachable ref → exit 4', () => {
    it('exits 4 with an actionable message when ref is missing', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'a.txt', 100);
      commit(repo, 'init');
      const { code, stderr } = runScript(['--against', 'definitely-not-a-ref'], { cwd: repo });
      expect(code).toBe(4);
      expect(stderr).toMatch(/definitely-not-a-ref/);
      expect(stderr).toMatch(/fetch/);
    });
  });

  describe('HEAD-mode (no --against)', () => {
    it('exits 0 when no tracked file exceeds the threshold', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'a.txt', 1024);
      writeFileOfSize(repo, 'b/c.txt', THRESHOLD_BYTES - 1); // 1 byte under
      commit(repo, 'small files');
      const { code, stderr } = runScript([], { cwd: repo });
      expect(code).toBe(0);
      expect(stderr).toMatch(/scanned: 2 files, large: 0/);
    });

    it('exits 1 and lists the offending file when one tracked file exceeds threshold', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'big.bin', THRESHOLD_BYTES + 1);
      writeFileOfSize(repo, 'small.txt', 100);
      commit(repo, 'one big one small');
      const { code, stderr } = runScript([], { cwd: repo });
      expect(code).toBe(1);
      expect(stderr).toMatch(/scanned: 2 files, large: 1/);
      expect(stderr).toMatch(/big\.bin/);
      expect(stderr).not.toMatch(/small\.txt/);
    });

    it('a file at EXACTLY the 5 MiB threshold passes (off-by-one boundary)', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'exactly-5MiB.bin', THRESHOLD_BYTES);
      commit(repo, 'boundary file');
      const { code, stderr } = runScript([], { cwd: repo });
      expect(code).toBe(0);
      expect(stderr).toMatch(/large: 0/);
    });
  });

  describe('--against <ref> diff-mode', () => {
    it('exits 0 when the diff adds no large files', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'a.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'b.txt', 100);
      commit(repo, 'feature add');
      const { code, stderr } = runScript(['--against', 'main'], { cwd: repo });
      expect(code).toBe(0);
      expect(stderr).toMatch(/large: 0/);
    });

    it('exits 1 when the diff adds a >5 MiB file', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'a.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'huge.bin', THRESHOLD_BYTES + 1024);
      commit(repo, 'feature huge add');
      const { code, stderr } = runScript(['--against', 'main'], { cwd: repo });
      expect(code).toBe(1);
      expect(stderr).toMatch(/huge\.bin/);
    });

    it('does NOT report pre-existing large files unchanged in the diff', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'pre-existing-big.bin', THRESHOLD_BYTES + 1024);
      commit(repo, 'pre-existing large');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'tiny.txt', 100);
      commit(repo, 'tiny addition');
      const { code, stderr } = runScript(['--against', 'main'], { cwd: repo });
      expect(code).toBe(0);
      expect(stderr).not.toMatch(/pre-existing-big\.bin/);
    });
  });

  describe('escape hatch via ALLOW_LARGE_FILE_BODY', () => {
    it('exempts a file when [allow-large-file: <path>] marker matches', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'base.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'legit-asset.png', THRESHOLD_BYTES + 1024);
      commit(repo, 'legit large asset');

      const body = `## Summary\nAdds a hero image.\n\n[allow-large-file: legit-asset.png reason: cross-platform hero illustration]\n`;
      const { code, stderr } = runScript(['--against', 'main'], {
        cwd: repo,
        env: { ALLOW_LARGE_FILE_BODY: body },
      });
      expect(code).toBe(0);
      expect(stderr).toMatch(/exempted by \[allow-large-file\] marker/);
    });

    it('does NOT exempt a file when the marker path does not match', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'base.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'actually-huge.bin', THRESHOLD_BYTES + 1024);
      commit(repo, 'unexpected large');

      // Marker references a DIFFERENT path — should not exempt actually-huge.bin.
      const body = `[allow-large-file: some-other-path.png reason: misdirected]`;
      const { code, stderr } = runScript(['--against', 'main'], {
        cwd: repo,
        env: { ALLOW_LARGE_FILE_BODY: body },
      });
      expect(code).toBe(1);
      expect(stderr).toMatch(/actually-huge\.bin/);
    });

    it('parses multiple markers in one body', () => {
      const repo = tempRepo();
      writeFileOfSize(repo, 'base.txt', 100);
      commit(repo, 'base');
      execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo });
      writeFileOfSize(repo, 'asset-a.png', THRESHOLD_BYTES + 1024);
      writeFileOfSize(repo, 'asset-b.png', THRESHOLD_BYTES + 2048);
      commit(repo, 'two large assets');

      const body = [
        '## Summary',
        'Adds two heroes.',
        '',
        '[allow-large-file: asset-a.png reason: hero one]',
        '[allow-large-file: asset-b.png reason: hero two]',
      ].join('\n');
      const { code, stderr } = runScript(['--against', 'main'], {
        cwd: repo,
        env: { ALLOW_LARGE_FILE_BODY: body },
      });
      expect(code).toBe(0);
      expect(stderr).toMatch(/asset-a\.png.*exempted/);
      expect(stderr).toMatch(/asset-b\.png.*exempted/);
    });
  });
});

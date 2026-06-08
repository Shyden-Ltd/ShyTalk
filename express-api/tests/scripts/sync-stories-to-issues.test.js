/* eslint-disable sonarjs/no-os-command-from-path
   -- test harness invokes `bash` and a mock `gh` binary under controlled
   inputs with carefully constructed fixture content. Not security-sensitive. */
/**
 * Tests for `scripts/sync-stories-to-issues.sh` — the GitHub Issues +
 * Projects v2 mirror script delivered by SHY-0002.
 *
 * Architecture: the script invokes `gh` for every API call. Tests
 * substitute a mock-gh binary (at a tempdir) via the `GH` env var. The
 * mock records every call to a recording file the test reads back.
 *
 * Exit codes covered:
 *   0   success
 *   2   usage error (missing arg, unknown flag, no --all/--story)
 *   30  missing GH_PAT_PROJECT
 *   34  --story <ID> file not found
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-stories-to-issues.sh');

/** Spawn the sync script with the given args + return { code, stdout, stderr }. */
function runScript(args, opts = {}) {
  // Timeout: was 15s when the test was authored against ~10 SHY files.
  // As the SHY corpus grew past 30 files, --all dry-run started taking
  // ~21s wall-clock locally (bash + awk + jq subprocess overhead per
  // file). Bumped to 60s for ~3× headroom. The slow per-file overhead
  // is a real perf issue tracked as a follow-up SHY (sync-stories
  // optimisation); not in scope for SHY-0034. See [[feedback-fix-pre-
  // existing-and-new-same]] — perf SHY filed in the same session.
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 60_000,
    ...opts,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
  };
}

const TEMP_DIRS = [];
function tempDir(prefix = 'sync-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
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

/**
 * Create a mock-gh binary that:
 *  - Writes every invocation (one line per call: `argv-joined`) to a
 *    recording file in the same dir.
 *  - Returns the JSON content of a "responses" file keyed by the FIRST
 *    two argv tokens (e.g. `issue list` → reads `gh-responses-issue-list`).
 *  - Default exit 0; can be overridden via `gh-exit-code` file.
 * Returns the path to the mock-gh binary + the dir containing recordings.
 */
function makeMockGh() {
  const dir = tempDir('mockgh-');
  const ghPath = path.join(dir, 'gh');
  const recording = path.join(dir, 'recording.log');
  fs.writeFileSync(recording, '');
  // Bash mock: writes argv to recording, then echoes the response file
  // for the (cmd, subcmd) pair if present, else echoes empty.
  const mockSource = `#!/usr/bin/env bash
echo "$@" >>"${recording}"
key="$1-$2"
respfile="${dir}/gh-responses-\${key}"
if [ -f "\${respfile}" ]; then
  cat "\${respfile}"
fi
exitfile="${dir}/gh-exit-code"
if [ -f "\${exitfile}" ]; then
  exit "$(cat "\${exitfile}")"
fi
exit 0
`;
  fs.writeFileSync(ghPath, mockSource);
  fs.chmodSync(ghPath, 0o755);
  return { ghPath, dir, recording };
}

function readRecording(recordingPath) {
  if (!fs.existsSync(recordingPath)) return [];
  return fs
    .readFileSync(recordingPath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ============================================================== tests

describe('scripts/sync-stories-to-issues.sh', () => {
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
    it('exits 0 and prints synopsis + flags + exit codes + examples', () => {
      const { code, stdout } = runScript(['--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(/sync-stories-to-issues\.sh/);
      expect(stdout).toMatch(/--all/);
      expect(stdout).toMatch(/--story/);
      expect(stdout).toMatch(/--dry-run/);
      expect(stdout).toMatch(/--verbose/);
      // Exit codes listed.
      for (const c of [0, 2, 30, 33, 34]) {
        expect(stdout).toMatch(new RegExp(`\\b${c}\\b`));
      }
      expect(stdout).toMatch(/EXAMPLES?/);
    });
  });

  describe('usage errors → exit 2', () => {
    it('exits 2 when no arguments given', () => {
      const { code, stderr } = runScript([]);
      expect(code).toBe(2);
      expect(stderr).toMatch(/missing argument|see --help/);
    });

    it('exits 2 on unknown flag', () => {
      const { code, stderr } = runScript(['--bogus']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/unknown flag/);
    });

    it('exits 2 when neither --all nor --story given', () => {
      const { code, stderr } = runScript(['--verbose']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/specify --all or --story/);
    });

    it('exits 2 when --story given without an argument', () => {
      const { code, stderr } = runScript(['--story']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--story requires/);
    });
  });

  describe('auth check → exit 30 (skipped in dry-run)', () => {
    it('exits 30 when GH_PAT_PROJECT is missing and NOT --dry-run', () => {
      const { code, stderr } = runScript(['--all'], {
        env: {
          ...process.env,
          GH_PAT_PROJECT: '',
          GH_TOKEN: '',
        },
      });
      expect(code).toBe(30);
      expect(stderr).toMatch(/GH_PAT_PROJECT missing/);
    });

    it('does NOT require GH_PAT_PROJECT in --dry-run mode', () => {
      const { code } = runScript(['--all', '--dry-run'], {
        env: {
          ...process.env,
          GH_PAT_PROJECT: '',
        },
      });
      expect(code).toBe(0);
    });
  });

  describe('--story <ID> file lookup', () => {
    it('exits 34 when the named story file does not exist', () => {
      const { code, stderr } = runScript(['--story', 'SHY-9999', '--dry-run']);
      expect(code).toBe(34);
      expect(stderr).toMatch(/SHY-9999.*not.found|not.found.*SHY-9999/i);
    });
  });

  describe('--all --dry-run against the live stories directory', () => {
    it('exits 0, lists every SHY-NNNN file, prints summary', () => {
      const { code, stderr } = runScript(['--all', '--dry-run']);
      expect(code).toBe(0);
      // Should mention each live story.
      expect(stderr).toMatch(/SHY-0001/);
      expect(stderr).toMatch(/SHY-0002/);
      // Summary line.
      expect(stderr).toMatch(/Sync result: \d+ created, \d+ updated, \d+ skipped, \d+ failed/);
      // DRY-RUN tag visible.
      expect(stderr).toMatch(/DRY-RUN/);
    });
  });

  describe('mock-gh: create flow (no existing issue)', () => {
    it('calls `gh issue create` with the constructed title + labels', () => {
      const { ghPath, recording, dir } = makeMockGh();
      // Mock `gh issue list` returns empty JSON array (no existing issue).
      fs.writeFileSync(path.join(dir, 'gh-responses-issue-list'), '');

      const { code } = runScript(['--story', 'SHY-0001'], {
        env: {
          ...process.env,
          GH: ghPath,
          GH_PAT_PROJECT: 'fake-pat-for-test',
        },
      });
      expect(code).toBe(0);

      const calls = readRecording(recording);
      // At least one `issue list` (lookup) and one `issue create`.
      const hasList = calls.some((c) => c.startsWith('issue list'));
      const hasCreate = calls.some((c) => c.startsWith('issue create'));
      expect(hasList).toBe(true);
      expect(hasCreate).toBe(true);
      // Title includes SHY-0001:.
      const createCall = calls.find((c) => c.startsWith('issue create'));
      expect(createCall).toMatch(/SHY-0001:/);
    });
  });

  describe('body-hash change detection', () => {
    it('skips update when stored body-hash matches current hash', () => {
      // Compute the current body-hash of the live SHY-0001 file via
      // shasum directly so we know what to embed in the mock response.
      const storyPath = path.join(
        REPO_ROOT,
        '.project',
        'stories',
        'SHY-0001-establish-agile-workflow.md',
      );
      // Use the same body-extraction the script uses to compute hash.
      const body = spawnSync(
        'bash',
        ['-c', `awk 'BEGIN{n=0} /^---[[:space:]]*$/{n++; next} n>=2{print}' "${storyPath}"`],
        { encoding: 'utf-8' },
      ).stdout;
      const hash = spawnSync(
        'bash',
        ['-c', `printf '%s' "$0" | shasum -a 256 | awk '{print $1}'`, body],
        {
          encoding: 'utf-8',
        },
      ).stdout.trim();

      const { ghPath, recording, dir } = makeMockGh();
      // `issue list` returns one existing issue.
      fs.writeFileSync(path.join(dir, 'gh-responses-issue-list'), '42\n');
      // `issue view` returns a body containing the SAME body-hash.
      fs.writeFileSync(
        path.join(dir, 'gh-responses-issue-view'),
        `Some body content\n\n_Last synced: 2026-01-01T00:00:00Z from commit abc body-hash: ${hash}_\n`,
      );

      const { code, stderr } = runScript(['--story', 'SHY-0001', '--verbose'], {
        env: {
          ...process.env,
          GH: ghPath,
          GH_PAT_PROJECT: 'fake-pat-for-test',
        },
      });
      expect(code).toBe(0);
      const calls = readRecording(recording);
      // Should NOT have called `issue edit`.
      const hasEdit = calls.some((c) => c.startsWith('issue edit'));
      expect(hasEdit).toBe(false);
      // Should mention skipping or unchanged.
      expect(stderr).toMatch(/unchanged|skipping|body-hash unchanged/);
    });
  });
});

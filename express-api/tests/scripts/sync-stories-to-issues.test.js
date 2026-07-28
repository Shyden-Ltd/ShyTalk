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

const STORIES_DIR = path.join(REPO_ROOT, '.project', 'stories');

/**
 * How many stories a `--all` run actually has to walk, counted at load time.
 *
 * This number only ever goes up — every story added to the repo makes the
 * run longer — so a FIXED timeout here is a deadline that has to be raised
 * by hand every few months. This file's own history records exactly that:
 * 15s when written against ~10 stories, bumped to 60s at ~30. The corpus is
 * past 190 now, and the 60s constant started failing under a full parallel
 * Jest run while still passing in isolation. Deriving the budget from the
 * corpus is what stops the next bump from being needed.
 */
const LIVE_STORY_COUNT = fs
  .readdirSync(STORIES_DIR)
  .filter((f) => /^SHY-\d{4}-.*\.md$/.test(f)).length;

/**
 * Per-story cost is ~185ms on an idle Apple Silicon Mac (bash + jq + awk
 * subprocesses per file, measured after SHY-0040 cut the per-file overhead).
 * Under the full suite — 400+ test files competing for the same cores — it
 * inflates several-fold, and that inflation is the ONLY reason these tests
 * ever failed. 6× covers it; the 60s floor keeps small runs from inheriting
 * a uselessly tight budget.
 */
const PER_STORY_BUDGET_MS = 6 * 185;
const SCRIPT_TIMEOUT_MS = Math.max(60_000, LIVE_STORY_COUNT * PER_STORY_BUDGET_MS);

/** Spawn the sync script with the given args + return { code, stdout, stderr }. */
function runScript(args, opts = {}) {
  // SHY-0079: isolate the board-items.json sidecar per run so no test reads
  // or clobbers the real repo file. Caller-supplied BOARD_ITEMS_FILE wins.
  const env = { ...(opts.env ?? process.env) };
  if (!env.BOARD_ITEMS_FILE) {
    env.BOARD_ITEMS_FILE = path.join(tempDir('sidecar-'), 'board-items.json');
  }
  // Read back the timeout that will actually be in force — `opts` may override
  // it, and a diagnostic assembled from the default would then name a budget
  // the run never had.
  const effectiveTimeoutMs = opts.timeout ?? SCRIPT_TIMEOUT_MS;
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: SCRIPT_TIMEOUT_MS,
    ...opts,
    env,
  });
  // A killed child comes back as `status: null` + `signal: 'SIGTERM'`, which
  // `?? 1` would quietly turn into "the script exited 1" — the same shape as
  // a genuine script failure. That is how this cost three runs to diagnose:
  // the assertion said "expected 0, received 1" and named neither the timeout
  // nor the budget. Say what actually happened instead.
  if (res.error?.code === 'ETIMEDOUT' || (res.status === null && res.signal)) {
    return {
      code: `KILLED after ${effectiveTimeoutMs}ms (${res.signal ?? res.error?.code}) — the script did not finish, it did not fail`,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      signal: res.signal,
      timedOut: true,
    };
  }
  return {
    code: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    signal: res.signal,
    timedOut: false,
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
# SHY-0074 v2: the items-map query is also 'api graphql' but needs its own
# response channel so it doesn't collide with mutation/lookup fixtures.
case "$*" in
  *"items(first: 100"*)
    if [ -f "${dir}/gh-responses-items-query" ]; then cat "${dir}/gh-responses-items-query"; fi
    exit 0
    ;;
esac
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
  // Default: an empty board — stories route down the create path.
  fs.writeFileSync(
    path.join(dir, 'gh-responses-items-query'),
    JSON.stringify({
      data: {
        organization: {
          projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } },
        },
      },
    }),
  );
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
      expect(stderr).toMatch(/specify --all, --story SHY-NNNN, or --rebuild/);
    });

    it('exits 2 when --story given without an argument', () => {
      const { code, stderr } = runScript(['--story']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--story requires/);
    });

    it('exits 2 when --rebuild is combined with --story (mutually exclusive)', () => {
      const { code, stderr } = runScript(['--rebuild', '--story', 'SHY-0001', '--dry-run']);
      expect(code).toBe(2);
      expect(stderr).toMatch(/--rebuild cannot combine with --story|cannot combine/);
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
      // Summary line (SHY-0081 v3 form: every story is a draft, no split).
      expect(stderr).toMatch(/Sync result: \d+ created, \d+ updated, \d+ skipped, \d+ failed/);
      // DRY-RUN tag visible.
      expect(stderr).toMatch(/DRY-RUN/);
    });
  });

  describe('mock-gh: create flow (no existing board item)', () => {
    it('SHY-0001 (type: infra) creates a typed GitHub issue (Task) on the board, not a draft', () => {
      const { ghPath, recording, dir } = makeMockGh();
      // Project lookup + bootstrap + createIssue + board-add share the graphql channel.
      fs.writeFileSync(
        path.join(dir, 'gh-responses-api-graphql'),
        JSON.stringify({
          data: {
            organization: { projectV2: { id: 'PVT_test', fields: { nodes: [] } } },
            repository: {
              id: 'REPO_1',
              issueTypes: {
                nodes: [
                  { id: 'IT_TASK', name: 'Task' },
                  { id: 'IT_BUG', name: 'Bug' },
                  { id: 'IT_FEATURE', name: 'Feature' },
                ],
              },
              label: { id: 'LBL_story' },
            },
            createIssue: { issue: { id: 'I_node_1', number: 1 } },
            addProjectV2ItemById: { item: { id: 'ITEM_1' } },
          },
        }),
      );

      const { code } = runScript(['--story', 'SHY-0001'], {
        env: {
          ...process.env,
          GH: ghPath,
          GH_PAT_PROJECT: 'fake-pat-for-test',
        },
      });
      expect(code).toBe(0);

      const calls = readRecording(recording);
      // Non-bug stories never touch the Issues tab…
      expect(calls.some((c) => c.startsWith('issue create'))).toBe(false);
      // …and the items map replaced per-story `issue list` lookups.
      expect(calls.some((c) => c.startsWith('issue list'))).toBe(false);
      // The issue create carries the constructed title.
      const issueCall = calls.find(
        (c) => c.includes('createIssue') && c.includes('title=SHY-0001:'),
      );
      expect(issueCall).toBeDefined();
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
      // SHY-0082 v4: SHY-0001 (type: infra, status: Done) is ISSUE-backed.
      // The items map carries the issue body whose footer stores the SAME
      // hash + the matching status marker → full skip.
      fs.writeFileSync(
        path.join(dir, 'gh-responses-items-query'),
        JSON.stringify({
          data: {
            organization: {
              projectV2: {
                items: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: 'PVTI_existing',
                      content: {
                        __typename: 'Issue',
                        id: 'I_node_1',
                        number: 1,
                        state: 'CLOSED',
                        title: 'SHY-0001: Establish agile workflow',
                        body: `Some body content\n\n_Status: Done_\n_Last synced: 2026-01-01T00:00:00Z from commit abc body-hash: ${hash}_\n`,
                      },
                      fieldValueByName: { text: 'SHY-0001' },
                    },
                  ],
                },
              },
            },
          },
        }),
      );

      // v4: sync_story bootstraps the repo (issue types + label) before sync_one,
      // so the api-graphql channel must answer the repository query.
      fs.writeFileSync(
        path.join(dir, 'gh-responses-api-graphql'),
        JSON.stringify({
          data: {
            organization: { projectV2: { id: 'PVT_test', fields: { nodes: [] } } },
            repository: {
              id: 'REPO_1',
              issueTypes: {
                nodes: [
                  { id: 'IT_TASK', name: 'Task' },
                  { id: 'IT_BUG', name: 'Bug' },
                  { id: 'IT_FEATURE', name: 'Feature' },
                ],
              },
              label: { id: 'LBL_story' },
            },
          },
        }),
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
      // No body refresh of either backing.
      expect(calls.some((c) => c.startsWith('issue edit'))).toBe(false);
      expect(calls.some((c) => c.includes('updateProjectV2DraftIssue'))).toBe(false);
      // Should mention skipping or unchanged.
      expect(stderr).toMatch(/unchanged|skipping|body-hash unchanged/);
    });
  });

  describe('the harness itself', () => {
    // Everything above is only as trustworthy as the runner underneath it,
    // and the runner is where the last three failures actually lived.

    it('scales the script timeout with the story corpus, not a constant', () => {
      // The whole point: adding stories must move the budget. If someone
      // replaces the derivation with a number again, this fails and says so.
      expect({
        countedStories: LIVE_STORY_COUNT > 50,
        budgetTracksCorpus: SCRIPT_TIMEOUT_MS >= LIVE_STORY_COUNT * PER_STORY_BUDGET_MS,
        hasFloor: SCRIPT_TIMEOUT_MS >= 60_000,
      }).toEqual({ countedStories: true, budgetTracksCorpus: true, hasFloor: true });
    });

    it('reports a killed script as a timeout, never as exit code 1', () => {
      // Drive the real failure: a script that cannot finish inside the
      // budget. `sleep` stands in for "slow", the kill path is identical.
      const res = runScript(['--all', '--dry-run'], { timeout: 250 });

      expect(res.timedOut).toBe(true);
      // The distinguishing bit — a genuine `exit 1` and a SIGTERM must not
      // arrive looking the same, which is what `status ?? 1` used to do.
      expect(res.code).not.toBe(1);
      expect(String(res.code)).toMatch(/KILLED after 250ms/);
    });

    it('reports a genuine non-zero exit as that exit code', () => {
      // The other half of the pair: the timeout branch must not swallow real
      // failures. Exit 2 is the script's documented usage error.
      const res = runScript(['--not-a-flag']);
      expect({ code: res.code, timedOut: res.timedOut }).toEqual({ code: 2, timedOut: false });
    });
  });
});

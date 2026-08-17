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
/**
 * A small FIXTURE corpus, so `--all` costs the same today as it will when
 * the real corpus is twice the size.
 *
 * Every `--all` test used to run against the live `.project/stories` tree.
 * That tree grew 10 -> 30 -> 221 files, the per-file bash+awk+jq overhead
 * grew with it, and the harness timeout was bumped 15s -> 60s to keep up.
 * It stopped keeping up: `--all --dry-run` now takes ~300s against the real
 * corpus, `spawnSync` killed it at 60s, and the test reported the kill as
 * the script exiting non-zero -- reading as "dry-run requires a token",
 * which is not what happened and not true (run by hand it exits 0).
 *
 * Bumping the timeout a third time would buy the same amount of time again.
 * The script already supports `STORIES_DIR` for exactly this -- a sibling
 * suite (sync-stories-to-issues-board-fields.test.js) has always used it --
 * so these tests point at a corpus they control. None of them asserts
 * anything about corpus SIZE: they are about argument handling and exit
 * codes, and three files exercise those as well as 221 do.
 */
/**
 * One VALID story. Not a lookalike.
 *
 * `scripts/check-story-frontmatter.sh` is a real gate the sync script runs
 * per file, and it wants ten `##` sections and eight `###` AC dimensions.
 * The first fixture here carried only frontmatter; the script rejected every
 * file and exited 40 -- the script being right and the fixture being wrong.
 * Building the fixture until the REAL validator accepts it is what makes
 * these tests exercise the same path a real story takes.
 */
const fixtureStory = (id, title, type) =>
  [
    '---',
    `id: ${id}`,
    'status: Draft',
    'owner: claude',
    'created: 2026-08-12',
    'priority: P2',
    'effort: M',
    `type: ${type}`,
    'roadmap_ids: []',
    'pr:',
    'mvp: false',
    '---',
    '',
    `# ${id}: ${title}`,
    '',
    '## User Story',
    'As a test, I want a valid story on disk, so that the sync script has something real to walk.',
    '',
    '## Why',
    'A fixture that only resembles a story tests the script against a file it will never be given.',
    '',
    '## Acceptance Criteria',
    '',
    '### Happy path',
    '- The story is listed by `--all`.',
    '',
    '### Error paths',
    '- A malformed story is reported, not skipped silently.',
    '',
    '### Edge cases',
    '- An empty corpus produces a summary with zero counts.',
    '',
    '### Performance',
    '- Walking the fixture corpus completes well inside the harness timeout.',
    '',
    '### Security',
    '- No token is required in dry-run.',
    '',
    '### UX',
    '- The summary names what would change.',
    '',
    '### i18n',
    '- Not applicable to a build-time script.',
    '',
    '### Observability',
    '- Every decision is emitted with the story id.',
    '',
    '## BDD Scenarios',
    '',
    '```gherkin',
    'Scenario: The sync lists a story it was given',
    '  Given a folder holding one story',
    '  When someone runs the sync in dry-run',
    '  Then the summary names that story',
    '```',
    '',
    '## Test Plan',
    'Covered by tests/scripts/sync-stories-to-issues.test.js.',
    '',
    '## Out of Scope',
    'Anything touching the live corpus.',
    '',
    '## Dependencies',
    'None.',
    '',
    '## Risks & Mitigations',
    'The fixture could drift from the real story shape; the validator is what stops that.',
    '',
    '## Definition of Done',
    'The validator accepts this file.',
    '',
    '## Notes',
    'Written as a fixture for the sync-script tests.',
    '',
  ].join('\n');

/**
 * A small FIXTURE corpus, so `--all` costs the same today as it will when
 * the real corpus is twice the size.
 *
 * Every `--all` test used to run against the live `.project/stories` tree.
 * That tree grew 10 -> 30 -> 221 files, the per-file bash+awk+jq overhead
 * grew with it, and the harness timeout was bumped 15s -> 60s to keep up.
 * It stopped keeping up: `--all --dry-run` took ~300s against the real
 * corpus, `spawnSync` killed it at 60s, and the test reported the kill as
 * the script exiting non-zero -- reading as "dry-run requires a token",
 * which is not what happened and not true (run by hand it exits 0).
 *
 * Bumping the timeout a third time would buy the same amount of time again.
 * The script already supports `STORIES_DIR` for exactly this -- a sibling
 * suite (sync-stories-to-issues-board-fields.test.js) has always used it.
 */
function fixtureStories() {
  const dir = tempDir('stories-');
  fs.writeFileSync(
    path.join(dir, 'SHY-9001-fixture-one.md'),
    fixtureStory('SHY-9001', 'Fixture one', 'bug'),
  );
  fs.writeFileSync(
    path.join(dir, 'SHY-9002-fixture-two.md'),
    fixtureStory('SHY-9002', 'Fixture two', 'infra'),
  );
  fs.writeFileSync(
    path.join(dir, 'SHY-9003-fixture-three.md'),
    fixtureStory('SHY-9003', 'Fixture three', 'chore'),
  );
  return dir;
}

function runScript(args, opts = {}) {
  // 60s is ample against the fixture corpus above; it was NOT against the
  // live tree, which is what these tests used to walk. See fixtureStories.
  // SHY-0079: isolate the board-items.json sidecar per run so no test reads
  // or clobbers the real repo file. Caller-supplied BOARD_ITEMS_FILE wins.
  const env = { ...(opts.env ?? process.env) };
  if (!env.BOARD_ITEMS_FILE) {
    env.BOARD_ITEMS_FILE = path.join(tempDir('sidecar-'), 'board-items.json');
  }
  const res = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    cwd: REPO_ROOT,
    timeout: 60_000,
    ...opts,
    env,
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
          STORIES_DIR: fixtureStories(),
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
          STORIES_DIR: fixtureStories(),
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

  describe('--all --dry-run over a stories directory', () => {
    // Was "against the live stories directory", asserting SHY-0001 and
    // SHY-0002 by name. That coupled a test about ARGUMENT HANDLING to the
    // contents of a corpus which has grown to 221 files -- it took ~300s,
    // blew the harness timeout, and reported the kill as the script failing.
    //
    // What it actually proves is corpus-independent: given a directory of
    // stories, --all visits EVERY one, says so, and prints a summary. Three
    // fixture files prove that as well as 221 do -- and the fixture's own
    // ids are asserted, so "visits every one" is checked rather than
    // assumed from a count.
    it('exits 0, lists every SHY-NNNN file, prints summary', () => {
      const { code, stderr } = runScript(['--all', '--dry-run'], {
        env: { ...process.env, STORIES_DIR: fixtureStories() },
      });
      expect(code).toBe(0);
      for (const id of ['SHY-9001', 'SHY-9002', 'SHY-9003']) {
        expect(stderr).toMatch(new RegExp(id));
      }
      // Summary line (SHY-0081 v3 form: every story is a draft, no split).
      expect(stderr).toMatch(/Sync result: \d+ created, \d+ updated, \d+ skipped, \d+ failed/);
      // DRY-RUN tag visible.
      expect(stderr).toMatch(/DRY-RUN/);
    });

    // …and the LIVE tree is still what it reaches for by default. Asserted
    // at the script, not by walking 221 files: the thing worth pinning is
    // the default path, and executing the walk to discover it is what made
    // this file slow in the first place.
    it('defaults STORIES_DIR to the live .project/stories tree', () => {
      const script = fs.readFileSync(SCRIPT, 'utf-8');
      expect(script).toMatch(/STORIES_DIR:?=.*\.project\/stories/);
      expect(fs.existsSync(path.join(REPO_ROOT, '.project', 'stories'))).toBe(true);
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
});

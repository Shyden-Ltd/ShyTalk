/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` binary with literal argv to execute the REAL
 * "Cap gh-pages history" shell block extracted from allure-report.yml. A
 * canned `gh` CLI shim is prepended to PATH (this is a UNIT test — the shim
 * is the one place a double is allowed; the block's branch logic is pure
 * text-in/text-out). No user-controlled command reaches the shell. */
/**
 * allure-report-gh-pages-cap-script.unit.test.js — SHY-0128 R1 Critical fix.
 *
 * The structural pins in allure-report-gh-pages-cap.test.js prove the cap
 * step EXISTS with the right shape; they cannot prove its decision logic
 * (R1 review: a `-le`→`-lt` threshold flip, a `[0-9][0-9]*`→`[0-9]` capture
 * narrowing, a deleted `${COUNT:-1}` default, or a wrong-variable
 * `-f tree=` binding all passed every structural pin). This file executes
 * the REAL extracted `run: |` block with bash under GitHub's own flags
 * against a canned `gh` CLI that returns synthetic API responses and logs
 * every invocation — mirroring the execution-harness precedent of
 * allure-report-metadata-count.test.js one file over.
 *
 * The WRITE path against the real GitHub API is deliberately not exercised
 * here (force-moving the live gh-pages ref is not safely inducible from a
 * test); the first post-merge deploy is that behavioral proof, per the
 * story's Test Plan. The READ path (Link-header count, tip/tree reads) was
 * additionally proven against the real API at pickup (COUNT=1771).
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/allure-report.yml');
const STEP_NAME = 'Cap gh-pages history (bounded, content-identical)';

/**
 * Extract the de-indented shell body of a named `run: |` step from a workflow.
 * GitHub strips the block's common leading indentation before executing, so we
 * strip the same 10-space `run: |` content indent to run byte-for-byte what CI
 * runs. (Same helper shape as allure-report-metadata-count.test.js.)
 */
function extractRunBlock(yaml, stepName) {
  const lines = yaml.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (nameIdx === -1) throw new Error(`step not found: ${stepName}`);
  let runIdx = -1;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    if (/^\s+run:\s*\|/.test(lines[i])) {
      runIdx = i;
      break;
    }
    if (/^\s{0,8}- name:/.test(lines[i])) break; // hit next step first
  }
  if (runIdx === -1) throw new Error(`run: | not found under "${stepName}"`);
  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') {
      body.push('');
      continue;
    }
    if (/^ {10}/.test(l)) {
      body.push(l.slice(10));
      continue;
    }
    break; // dedent below the run-block content indent → end of step
  }
  return body.join('\n');
}

/** A GitHub commits-API Link header whose rel="last" page number IS the
 * total commit count under per_page=1 (mirrors the real header shape). */
function linkHeader(count) {
  const base = 'https://api.github.com/repositories/1/commits?sha=gh-pages&per_page=1';
  return `<${base}&page=2>; rel="next", <${base}&page=${count}>; rel="last"`;
}

// The canned `gh` CLI. Dispatches on its full argv line; every invocation is
// appended to $GH_SHIM_CALLS so tests can assert exactly which API endpoints
// were (not) hit and with which fields. Tip reads are counted so the second
// read can simulate a racing writer having moved the ref.
const GH_SHIM = `#!/bin/bash
echo "$*" >> "$GH_SHIM_CALLS"
case "$*" in
  *"git/ref/heads/gh-pages"*)
    N=$(cat "$GH_SHIM_TIPCOUNT" 2>/dev/null || echo 0); N=$((N+1)); echo "$N" > "$GH_SHIM_TIPCOUNT"
    if [ "$N" -eq 1 ] && [ "$GH_SHIM_TIP_FAIL" = "404" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
    if [ "$N" -eq 1 ] && [ "$GH_SHIM_TIP_FAIL" = "500" ]; then echo "gh: Internal Server Error (HTTP 500)" >&2; exit 1; fi
    if [ "$N" -ge 2 ] && [ -n "$GH_SHIM_MOVED_TIP" ]; then echo "$GH_SHIM_MOVED_TIP"; else echo "$GH_SHIM_TIP"; fi
    ;;
  *"commits?sha=gh-pages&per_page=1"*)
    if [ -n "$GH_SHIM_LINK" ]; then
      printf 'HTTP/2.0 200 OK\\ncontent-type: application/json\\nlink: %s\\n\\n[{"sha":"x","commit":{"message":"page=999>; rel=\\"last\\" decoy in body"}}]\\n' "$GH_SHIM_LINK"
    else
      printf 'HTTP/2.0 200 OK\\ncontent-type: application/json\\n\\n[{"sha":"x"}]\\n'
    fi
    ;;
  *"git/commits/"*)
    if [ "$GH_SHIM_TREE_FAIL" = "1" ]; then echo "gh: Internal Server Error (HTTP 500)" >&2; exit 1; fi
    echo "$GH_SHIM_TREE"
    ;;
  *"git/commits"*)
    echo "$GH_SHIM_NEWSHA"
    ;;
  *"git/refs/heads/gh-pages"*)
    exit 0
    ;;
  *)
    echo "gh-shim: unexpected invocation: $*" >&2
    exit 64
    ;;
esac
`;

// The canned `git` CLI. SHY-0298 R3 replaced the cap's `gh api PATCH ...
// force=true` with `git push --force-with-lease`, because the API's force
// move is unconditional: the re-read before it was a check, not a
// compare-and-swap, and a publisher landing in that window was silently
// discarded. The lease makes the SERVER refuse unless gh-pages is still $TIP.
//
// The shim records every invocation and can simulate the three outcomes that
// matter: the lease holds, the lease is stale (someone published), or the push
// failed for an unrelated reason.
const GIT_SHIM = `#!/bin/bash
echo "$*" >> "$GIT_SHIM_CALLS"
case "$*" in
  *clone*)
    # Last argv is the destination; create it so the later -C succeeds.
    for a in "$@"; do DEST="$a"; done
    mkdir -p "$DEST"
    ;;
  *push*)
    case "$GIT_SHIM_PUSH" in
      stale)  echo "! [rejected] (stale info)" >&2; exit 1 ;;
      broken) echo "fatal: Authentication failed" >&2; exit 1 ;;
      *)      exit 0 ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac
`;

/** Run the REAL cap block under GitHub's default bash flags with the shims on
 * PATH. Returns exit status, combined output, and the recorded gh calls. */
function runCapStep(shimEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-cap-'));
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, GH_SHIM, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'git'), GIT_SHIM, { mode: 0o755 });
  const callsFile = path.join(dir, 'calls.log');
  fs.writeFileSync(callsFile, '');
  const gitCallsFile = path.join(dir, 'git-calls.log');
  fs.writeFileSync(gitCallsFile, '');
  const runnerTemp = path.join(dir, 'runner-temp');
  fs.mkdirSync(runnerTemp);

  const yaml = fs.readFileSync(WORKFLOW, 'utf8');
  // GitHub Actions runs `run:` bash steps with `--noprofile --norc -eo
  // pipefail`; the block's own first line adds -u. Reproduce faithfully.
  const script = 'set -eo pipefail\n' + extractRunBlock(yaml, STEP_NAME);

  let status = 0;
  let stdout;
  let stderr = '';
  try {
    stdout = execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: dir,
        RUNNER_TEMP: runnerTemp,
        REPO: 'Shyden-Ltd/ShyTalk',
        MAX_GH_PAGES_COMMITS: '25',
        GH_SHIM_CALLS: callsFile,
        GIT_SHIM_CALLS: gitCallsFile,
        GIT_SHIM_PUSH: '',
        GH_TOKEN: 'test-token',
        GH_SHIM_TIPCOUNT: path.join(dir, 'tipcount'),
        GH_SHIM_TIP: 'aaa1111111111111111111111111111111111111',
        GH_SHIM_TREE: 'T123tree456',
        GH_SHIM_NEWSHA: 'N456new789',
        GH_SHIM_LINK: '',
        GH_SHIM_MOVED_TIP: '',
        GH_SHIM_TIP_FAIL: '',
        GH_SHIM_TREE_FAIL: '',
        ...shimEnv,
      },
    });
  } catch (e) {
    status = e.status ?? 1;
    stdout = String(e.stdout || '');
    stderr = String(e.stderr || '');
  }
  const calls = fs.readFileSync(callsFile, 'utf8').split('\n').filter(Boolean);
  const gitCalls = fs.readFileSync(gitCallsFile, 'utf8').split('\n').filter(Boolean);
  return { status, stdout, stderr, calls, gitCalls };
}

const createCommitCalls = (calls) =>
  calls.filter((c) => c.includes('-X POST') && c.includes('git/commits'));
// SHY-0298 R3: the ref move is a `git push --force-with-lease`, not an API
// PATCH. Both helpers are kept — `apiForceMoveCalls` must stay EMPTY, because
// an unconditional force move creeping back is the regression that silently
// discards a publisher's report.
const apiForceMoveCalls = (calls) =>
  calls.filter((c) => c.includes('-X PATCH') && c.includes('git/refs/heads/gh-pages'));
const leasedPushCalls = (gitCalls) =>
  gitCalls.filter((c) => c.includes('push') && c.includes('--force-with-lease='));

describe('allure-report.yml "Cap gh-pages history" — executed block behavior (SHY-0128 R1)', () => {
  test('extraction sanity: the block contains the count, threshold and move lines', () => {
    const block = extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
    expect(block).toMatch(/per_page=1/);
    expect(block).toMatch(/MAX_GH_PAGES_COMMITS/);
    expect(block).toMatch(/refs\/heads\/gh-pages/);
  });

  test('multi-digit Link-header count (1771) is parsed exactly and the cap fires', () => {
    // Kills the `[0-9][0-9]*`→`[0-9]` capture-narrowing mutant: a single-digit
    // capture reads "1" and the cap silently never fires for the real-world
    // count that motivated the story.
    const { status, stdout, calls, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(1771) });
    expect(status).toBe(0);
    expect(stdout).toContain('gh-pages history: 1771 commit(s)');
    expect(stdout).toContain('capped gh-pages: 1771 commits -> 1');
    expect(createCommitCalls(calls)).toHaveLength(1);
    expect(leasedPushCalls(gitCalls)).toHaveLength(1);
    expect(apiForceMoveCalls(calls)).toHaveLength(0);
  });

  test('the JSON body cannot poison the count (header-slice guard)', () => {
    // The shim's canned body embeds a decoy `page=999>; rel="last"` string;
    // the parse must use the header's 1771, never the body's 999.
    const { stdout } = runCapStep({ GH_SHIM_LINK: linkHeader(1771) });
    expect(stdout).toContain('gh-pages history: 1771 commit(s)');
    expect(stdout).not.toContain('999');
  });

  test('exactly AT the threshold (25) the branch is left untouched', () => {
    // Kills the `-le`→`-lt` boundary mutant (story BDD: "Quiet branch stays
    // untouched"). 25 commits ≤ 25 → no rebuild, no ref move.
    const { status, stdout, calls, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(25) });
    expect(status).toBe(0);
    expect(stdout).toContain('gh-pages history: 25 commit(s)');
    expect(stdout).not.toContain('capped gh-pages:');
    expect(createCommitCalls(calls)).toHaveLength(0);
    expect(leasedPushCalls(gitCalls)).toHaveLength(0);
  });

  test('one past the threshold (26) caps to a single orphan commit', () => {
    // Together with the 25-case this kills any `-le`→`-ge`/`-gt` inversion.
    const { status, stdout, calls, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(26) });
    expect(status).toBe(0);
    expect(stdout).toContain('capped gh-pages: 26 commits -> 1');
    expect(createCommitCalls(calls)).toHaveLength(1);
    expect(leasedPushCalls(gitCalls)).toHaveLength(1);
  });

  test('the rebuild commit reuses the TIP TREE SHA verbatim and names the tip in its message', () => {
    // Kills the wrong-variable `-f tree=` mutant: content-identity rests on
    // the createCommit call binding the tree read from the CURRENT tip.
    const { calls, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(1771) });
    const create = createCommitCalls(calls)[0];
    expect(create).toContain('tree=T123tree456');
    expect(create).toContain('aaa1111111111111111111111111111111111111');

    // The move carries BOTH halves of the compare-and-swap: the new commit to
    // point at, and the tip it is allowed to replace. Dropping the lease turns
    // this back into an unconditional force move — the exact regression that
    // silently discarded a publisher's report.
    const push = leasedPushCalls(gitCalls)[0];
    expect(push).toContain(
      '--force-with-lease=refs/heads/gh-pages:aaa1111111111111111111111111111111111111',
    );
    expect(push).toContain('N456new789:refs/heads/gh-pages');
    expect(push).not.toContain('--force ');
  });

  test('no Link header (single-commit branch) defaults to COUNT=1 and stays untouched', () => {
    // Kills a deleted `\${COUNT:-1}` default: without it the threshold test
    // gets an empty operand, the guard misbehaves and the cap fires anyway.
    const { status, stdout, calls, gitCalls } = runCapStep({ GH_SHIM_LINK: '' });
    expect(status).toBe(0);
    expect(stdout).toContain('gh-pages history: 1 commit(s)');
    expect(createCommitCalls(calls)).toHaveLength(0);
    expect(leasedPushCalls(gitCalls)).toHaveLength(0);
  });

  test('a racing writer is detected by the SERVER and the cap skips, never clobbers', () => {
    // The race is no longer detected by re-reading the tip and hoping nothing
    // moves in the microseconds before the write — that window is what silently
    // discarded a publisher's report. The lease makes the server refuse, so
    // there is no window at all. Here the shim answers as the server does when
    // the lease is stale.
    const { status, stdout, gitCalls } = runCapStep({
      GH_SHIM_LINK: linkHeader(1771),
      GIT_SHIM_PUSH: 'stale',
    });
    expect(status).toBe(0);
    expect(stdout).toContain('tip moved');
    // It ATTEMPTED the leased push — a skip that never tried would also
    // "not clobber", and would be a cap that never runs.
    expect(leasedPushCalls(gitCalls)).toHaveLength(1);
  });

  test('a push failure that is NOT a lost race fails the step loudly', () => {
    // An auth or quota failure must not be reported as "tip moved" and
    // swallowed — that would hide a permanently broken cap behind a message
    // saying everything is fine.
    const { status, stdout, stderr } = runCapStep({
      GH_SHIM_LINK: linkHeader(1771),
      GIT_SHIM_PUSH: 'broken',
    });
    expect(status).not.toBe(0);
    expect(stdout + stderr).toContain('Authentication failed');
    expect(stdout + stderr).toContain('::error::');
    expect(stdout).not.toContain('tip moved');
  });

  test('missing gh-pages branch (HTTP 404) exits 0 with "nothing to cap"', () => {
    const { status, stdout, calls } = runCapStep({ GH_SHIM_TIP_FAIL: '404' });
    expect(status).toBe(0);
    expect(stdout).toContain('nothing to cap');
    expect(calls).toHaveLength(1); // the tip read only — no count, no writes
  });

  test('a non-404 failure on the first tip read fails loudly with ::error::', () => {
    const { status, stdout } = runCapStep({ GH_SHIM_TIP_FAIL: '500' });
    expect(status).not.toBe(0);
    expect(stdout).toContain('::error::failed to read the gh-pages tip');
  });

  test('a failure AFTER the first read (tree fetch) also aborts with a ::error:: annotation', () => {
    // R1 Important: the AC demands every API failure surface loudly, not just
    // the first tip read. set -e already aborts; the ERR trap must annotate.
    const { status, stdout } = runCapStep({
      GH_SHIM_LINK: linkHeader(1771),
      GH_SHIM_TREE_FAIL: '1',
    });
    expect(status).not.toBe(0);
    expect(stdout).toContain('::error::');
  });
});

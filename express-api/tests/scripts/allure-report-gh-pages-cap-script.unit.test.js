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

/**
 * The LITERAL `env:` entries of a named step, as GitHub would export them.
 *
 * The harness runs the extracted `run:` body directly, so anything the step
 * declares in `env:` has to be applied here or the block runs with a different
 * environment than CI gives it. Values containing a `${{ }}` expression are
 * skipped — the harness supplies those itself (token, repo, threshold).
 *
 * This exists because the cap's `git commit-tree` runs in a fresh clone with
 * no identity and the runner has no global one, so it died with `fatal: empty
 * ident name`. Reading the env from the workflow rather than hardcoding it
 * means DELETING the identity reddens these tests instead of shipping.
 */
const isEnvName = (k) =>
  k.length > 0 && [...k].every((c, i) => /[A-Za-z_]/.test(c) || (i > 0 && c >= '0' && c <= '9'));
const unquote = (v) =>
  (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))
    ? v.slice(1, -1)
    : v;

function extractStepEnv(yaml, stepName) {
  const lines = yaml.split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(`- name: ${stepName}`));
  if (nameIdx === -1) throw new Error(`step not found: ${stepName}`);
  const envIdx = lines.findIndex((l, i) => i > nameIdx && /^\s+env:\s*$/.test(l));
  if (envIdx === -1 || envIdx > nameIdx + 40) return {};
  const indent = lines[envIdx].length - lines[envIdx].trimStart().length + 2;
  const out = {};
  for (let i = envIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    if (l.length - l.trimStart().length < indent) break;
    // Split on the FIRST colon by hand rather than with a regex: a pattern
    // like /^\s*(\w+):\s*(.*)$/ is flagged sonarjs/slow-regex for
    // super-linear backtracking, and indexOf is both faster and clearer.
    const trimmed = l.trim();
    const colon = trimmed.indexOf(':');
    if (colon <= 0) break;
    const key = trimmed.slice(0, colon);
    if (!isEnvName(key)) break;
    const raw = trimmed.slice(colon + 1).trim();
    if (raw.includes('${{')) continue; // supplied by the harness
    out[key] = unquote(raw);
  }
  return out;
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
  *"git/commits/"*|*"git/commits"*|*"git/refs/heads/gh-pages"*)
    # SHY-0298: the orphan is built LOCALLY now, so the cap must never call
    # the Git Data API to read a tree, create a commit, or move a ref. Any
    # such call is the old design creeping back — fail the shim loudly rather
    # than answer it, so a regression cannot pass by being served politely.
    echo "gh-shim: the cap must not use the Git Data API: $*" >&2
    exit 65
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
  *commit-tree*)
    if [ "$GIT_SHIM_COMMIT_TREE" = "fail" ]; then echo "fatal: not a tree object" >&2; exit 128; fi
    if [ "$GIT_SHIM_COMMIT_TREE" = "empty" ]; then exit 0; fi   # succeeds, prints nothing
    echo "$GIT_SHIM_NEWSHA"
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
        // The step's own literal env first; every harness value below wins.
        ...extractStepEnv(yaml, STEP_NAME),
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: dir,
        RUNNER_TEMP: runnerTemp,
        REPO: 'Shyden-Ltd/ShyTalk',
        MAX_GH_PAGES_COMMITS: '25',
        GH_SHIM_CALLS: callsFile,
        GIT_SHIM_CALLS: gitCallsFile,
        GIT_SHIM_PUSH: '',
        GIT_SHIM_COMMIT_TREE: '',
        GIT_SHIM_NEWSHA: 'N456new789',
        GH_TOKEN: 'test-token',
        GH_SHIM_TIPCOUNT: path.join(dir, 'tipcount'),
        GH_SHIM_TIP: 'aaa1111111111111111111111111111111111111',
        GH_SHIM_LINK: '',
        GH_SHIM_MOVED_TIP: '',
        GH_SHIM_TIP_FAIL: '',
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

// SHY-0298 R4: the orphan is built by LOCAL `git commit-tree`, not by the Git
// Data API. An API-created commit is referenced by no ref and so is absent
// from the `--depth=1` clone that has to push it — reproduced against a real
// transport as `fatal: bad object` then `! [remote rejected] … (unpacker
// error)`, which does not match the lost-race pattern either, so the step
// would have failed loudly on every capped run while never capping.
const commitTreeCalls = (gitCalls) => gitCalls.filter((c) => c.includes('commit-tree'));
// Must stay EMPTY. The gh shim now refuses these outright; the helper exists
// so a test states the expectation rather than relying on the shim's exit 65
// to surface somewhere.
const gitDataApiCalls = (calls) =>
  calls.filter((c) => c.includes('git/commits') || c.includes('git/refs/'));
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
    expect(commitTreeCalls(gitCalls)).toHaveLength(1);
    expect(leasedPushCalls(gitCalls)).toHaveLength(1);
    expect(gitDataApiCalls(calls)).toHaveLength(0);
  });

  test('the step supplies a git author identity for commit-tree', () => {
    // `commit-tree` runs in a fresh clone under $RUNNER_TEMP with no local
    // identity, and a GitHub runner has no global one — so it died with
    // `fatal: empty ident name`, caught by the real-git test below. Asserted
    // here as well so a deletion fails with a sentence instead of with git's
    // error five hundred lines into a log.
    const env = extractStepEnv(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
    expect(env.GIT_AUTHOR_NAME).toBeTruthy();
    expect(env.GIT_AUTHOR_EMAIL).toContain('@');
    // COMMITTER too: git needs BOTH, and only the author one is the obvious
    // half to remember.
    expect(env.GIT_COMMITTER_NAME).toBeTruthy();
    expect(env.GIT_COMMITTER_EMAIL).toContain('@');
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
    expect(commitTreeCalls(gitCalls)).toHaveLength(0);
    expect(leasedPushCalls(gitCalls)).toHaveLength(0);
    // Nor may it CLONE. The count is an O(1) header read precisely so the
    // quiet path never drags the multi-GiB history down — a clone here would
    // spend on every single run the cost this step exists to avoid.
    expect(gitCalls.filter((c) => c.includes('clone'))).toHaveLength(0);
    expect(gitDataApiCalls(calls)).toHaveLength(0);
  });

  test('one past the threshold (26) caps to a single orphan commit', () => {
    // Together with the 25-case this kills any `-le`→`-ge`/`-gt` inversion.
    const { status, stdout, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(26) });
    expect(status).toBe(0);
    expect(stdout).toContain('capped gh-pages: 26 commits -> 1');
    expect(commitTreeCalls(gitCalls)).toHaveLength(1);
    expect(leasedPushCalls(gitCalls)).toHaveLength(1);
  });

  test('the rebuild names the CLONE HEAD tree and the tip it replaces', () => {
    // Content-identity now rests on git resolving `HEAD^{tree}` inside a clone
    // pinned to `--branch gh-pages --depth=1` — so the tree is the tip's tree
    // by construction rather than by a variable binding that could be wrong.
    // That resolution is git's, not the block's, so the proof that it really
    // yields a byte-identical tree is the real-git test at the bottom of this
    // file; here we pin the argv the block hands it.
    const { calls, gitCalls } = runCapStep({ GH_SHIM_LINK: linkHeader(1771) });
    const create = commitTreeCalls(gitCalls)[0];
    expect(create).toContain('HEAD^{tree}');
    // The clone is what makes HEAD the gh-pages tip; commit-tree in the wrong
    // directory would silently rebuild some other branch's content.
    expect(create).toMatch(/-C \S*gh-pages-cap /);
    expect(create).toContain('aaa1111111111111111111111111111111111111');
    // No parent: omitting it is what truncates the history. `-p` would chain.
    expect(create).not.toMatch(/(^| )-p( |$)/);
    expect(gitDataApiCalls(calls)).toHaveLength(0);

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
    const { status, stdout, gitCalls } = runCapStep({ GH_SHIM_LINK: '' });
    expect(status).toBe(0);
    expect(stdout).toContain('gh-pages history: 1 commit(s)');
    expect(commitTreeCalls(gitCalls)).toHaveLength(0);
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

  test('a failure AFTER the first read (commit-tree) also aborts with a ::error:: annotation', () => {
    // R1 Important: the AC demands every failure surface loudly, not just the
    // first tip read. set -e already aborts; the ERR trap must annotate.
    // (SHY-0298 R4: this used to induce the failure at the API tree fetch,
    // which no longer exists — commit-tree is the step that replaced it.)
    const { status, stdout, gitCalls } = runCapStep({
      GH_SHIM_LINK: linkHeader(1771),
      GIT_SHIM_COMMIT_TREE: 'fail',
    });
    expect(status).not.toBe(0);
    expect(stdout).toContain('::error::');
    // and it must not have gone on to push anything
    expect(leasedPushCalls(gitCalls)).toHaveLength(0);
  });

  test('a commit-tree that succeeds with no output never becomes a branch DELETE', () => {
    // `git push origin ":refs/heads/gh-pages"` is git's spelling of "delete
    // the branch". An empty $NEW produces exactly that refspec — from a step
    // whose purpose is to preserve the content it is compacting. set -e covers
    // a non-zero exit; this covers the one case it does not.
    const { status, stdout, gitCalls } = runCapStep({
      GH_SHIM_LINK: linkHeader(1771),
      GIT_SHIM_COMMIT_TREE: 'empty',
    });
    expect(status).not.toBe(0);
    expect(stdout).toContain('::error::commit-tree produced no SHA');
    expect(leasedPushCalls(gitCalls)).toHaveLength(0);
  });
});

/**
 * The content-identity claim, against REAL git.
 *
 * Everything above executes the real block against shims, which proves its
 * BRANCH logic. It cannot prove the one thing the story actually promises —
 * that the capped branch serves byte-identical content — because that rests
 * on git's own resolution of `HEAD^{tree}` in a shallow, blobless clone.
 *
 * So this block executes the SAME extracted block, against real repositories.
 * Only `gh` is shimmed (the tip and count reads are HTTP API calls with no
 * local equivalent); git is the real binary, and the remote is a real bare
 * repo — a bare repo over `file://` is a real git server, the way
 * `local/start.sh` is a real Firestore.
 *
 * The block hardcodes `https://…github.com/${REPO}.git`, so the redirect is
 * git's own `url.<base>.insteadOf` against a scratch HOME. Nothing about the
 * block is copied here; a drift between the workflow and this test is
 * impossible, which a hand-written mirror of the two commands could not
 * promise.
 */
describe('the capped branch serves byte-identical content (real git)', () => {
  const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

  /** A bare repo with `n` gh-pages commits, partial-clone enabled as GitHub's is. */
  function seedRemote(dir, n) {
    const bare = path.join(dir, 'remote.git');
    const work = path.join(dir, 'seed');
    git(['init', '--quiet', '--bare', '-b', 'gh-pages', bare], dir);
    // Without this the server refuses `--filter=blob:none` and silently gives
    // a full clone, so the test would not exercise the shape CI actually uses.
    git(['config', 'uploadpack.allowFilter', 'true'], bare);
    git(['init', '--quiet', '-b', 'gh-pages', work], dir);
    git(['config', 'user.email', 't@example.com'], work);
    git(['config', 'user.name', 'T'], work);
    for (let i = 0; i < n; i++) {
      fs.mkdirSync(path.join(work, 'reports', `run-${i}`), { recursive: true });
      fs.writeFileSync(path.join(work, 'reports', `run-${i}`, 'index.html'), `<h1>run ${i}</h1>`);
      git(['add', '-A'], work);
      git(['commit', '--quiet', '-m', `report ${i}`], work);
    }
    git(['remote', 'add', 'origin', bare], work);
    git(['push', '--quiet', 'origin', 'gh-pages'], work);
    return bare;
  }

  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-cap-real-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const CLONE_URL = 'https://x-access-token:test-token@github.com/Shyden-Ltd/ShyTalk.git';

  /**
   * Run the REAL extracted block with real git against `bare`.
   * `gh` is shimmed to answer the tip read and the commit count; everything
   * else — clone, commit-tree, the leased push — is the genuine article.
   */
  function runRealCap(bare, { tip, count }) {
    const home = path.join(dir, 'home');
    const binDir = path.join(home, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    // Redirect the block's hardcoded github.com URL at the local bare repo.
    fs.writeFileSync(
      path.join(home, '.gitconfig'),
      `[url "file://${bare}"]\n\tinsteadOf = ${CLONE_URL}\n`,
    );
    fs.writeFileSync(
      path.join(binDir, 'gh'),
      `#!/bin/bash
case "$*" in
  *"git/ref/heads/gh-pages"*) echo "${tip}" ;;
  *"commits?sha=gh-pages&per_page=1"*)
    printf 'HTTP/2.0 200 OK\\nlink: <https://api.github.com/x?page=${count}>; rel="last"\\n\\n[]\\n' ;;
  *) echo "unexpected: $*" >&2; exit 64 ;;
esac
`,
      { mode: 0o755 },
    );
    const runnerTemp = path.join(dir, 'runner-temp');
    fs.mkdirSync(runnerTemp, { recursive: true });
    const script =
      'set -eo pipefail\n' + extractRunBlock(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME);
    try {
      const stdout = execFileSync('bash', ['-c', script], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          PATH: `${binDir}:${process.env.PATH}`,
          HOME: home,
          RUNNER_TEMP: runnerTemp,
          // Whatever the STEP declares — notably the git author identity,
          // without which commit-tree dies in the identity-less fresh clone.
          // FIRST, so the harness's own values below win: the step also
          // declares MAX_GH_PAGES_COMMITS: 25, and letting that through would
          // silently disable the cap for a 5-commit fixture.
          ...extractStepEnv(fs.readFileSync(WORKFLOW, 'utf8'), STEP_NAME),
          REPO: 'Shyden-Ltd/ShyTalk',
          MAX_GH_PAGES_COMMITS: '3',
          GH_TOKEN: 'test-token',
        },
      });
      return { status: 0, out: stdout };
    } catch (e) {
      return { status: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
    }
  }

  test("the orphan has the tip's exact tree, no parents, and survives the push", () => {
    const bare = seedRemote(dir, 5);
    const tip = git(['rev-parse', 'gh-pages'], bare);
    const tipTree = git(['rev-parse', 'gh-pages^{tree}'], bare);

    const { status, out } = runRealCap(bare, { tip, count: 5 });
    expect({ status, out }).toEqual({
      status: 0,
      out: expect.stringContaining('capped gh-pages: 5 commits -> 1'),
    });

    // 1. history truncated to one commit...
    expect(git(['rev-list', '--count', 'gh-pages'], bare)).toBe('1');
    // 2. ...whose tree is the SAME OBJECT as before, so every published byte
    //    is still served. This is the claim; the shim tests cannot make it.
    expect(git(['rev-parse', 'gh-pages^{tree}'], bare)).toBe(tipTree);
    // 3. and it really is an orphan (rev-list --parents prints the commit
    //    followed by each parent, so one field means no parents).
    expect(git(['rev-list', '--parents', '-n', '1', 'gh-pages'], bare).split(' ')).toHaveLength(1);
    // 4. the files themselves, read back from the capped branch.
    expect(git(['show', 'gh-pages:reports/run-4/index.html'], bare)).toBe('<h1>run 4</h1>');
    expect(git(['show', 'gh-pages:reports/run-0/index.html'], bare)).toBe('<h1>run 0</h1>');
  });

  test('a publisher landing first makes the SERVER refuse the cap — the report survives', () => {
    const bare = seedRemote(dir, 5);
    // The tip the cap believes it is replacing. A publisher then lands, so by
    // the time the block pushes, its lease is stale — the exact race that used
    // to silently discard a report.
    const staleTip = git(['rev-parse', 'gh-pages'], bare);

    const other = path.join(dir, 'other');
    git(['clone', '--quiet', '--branch', 'gh-pages', bare, other], dir);
    git(['config', 'user.email', 'p@example.com'], other);
    git(['config', 'user.name', 'P'], other);
    fs.writeFileSync(path.join(other, 'LATEST.txt'), 'the report that must not be lost');
    git(['add', '-A'], other);
    git(['commit', '--quiet', '-m', 'a racing publish'], other);
    git(['push', '--quiet', 'origin', 'gh-pages'], other);

    const { status, out } = runRealCap(bare, { tip: staleTip, count: 6 });

    // Exit 0 — a lost race is not an error, a later run caps again — and the
    // quiet-skip message, not the loud one.
    expect({ status, out }).toEqual({ status: 0, out: expect.stringContaining('tip moved') });
    expect(out).not.toContain('::error::');
    // The publisher's commit is intact — nothing was discarded.
    expect(git(['show', 'gh-pages:LATEST.txt'], bare)).toBe('the report that must not be lost');
    expect(git(['rev-list', '--count', 'gh-pages'], bare)).toBe('6');
  });
});

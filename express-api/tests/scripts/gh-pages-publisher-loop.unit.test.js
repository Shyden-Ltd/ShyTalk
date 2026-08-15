/* eslint-disable sonarjs/no-os-command-from-path --
 * Spawns the hardcoded `bash` and `git` binaries with literal argv to execute
 * the REAL push loop extracted from publish-gh-pages/action.yml against REAL
 * local git repositories. No user-controlled command reaches the shell. */
/**
 * The publish action's retry loop, EXECUTED.
 *
 * `gh-pages-publisher.test.js` next door pins the loop's shape with regexes,
 * and a review made the cost of that plain: a loop that retries zero times,
 * resets to the wrong commit, or force-pushes on attempt three satisfies every
 * one of them. Not one line of the ~65-line loop was ever run.
 *
 * This runs it — real `git`, real refs, real races — with NOTHING stubbed.
 * The action clones `https://x-access-token:$GH_TOKEN@github.com/$REPO.git`,
 * which a test obviously cannot reach, so the one and only substitution is a
 * git `insteadOf` rewrite in a throwaway HOME pointing that URL at a local
 * bare repo. The script itself is byte-for-byte what CI runs, including its
 * `set -euo pipefail` and the `shell: bash` flags GitHub applies.
 *
 * The concurrent writer is a genuine second clone pushing between this loop's
 * clone and its push — which is the actual production race, not a simulation
 * of one.
 */
const { execFileSync, spawnSync } = require('node:child_process');

// A monotonic suffix for per-run scratch directories. `Math.random()` trips
// sonarjs/pseudo-random, and a counter is deterministic and easier to read in
// a failure message.
let scratchSeq = 0;
const scratch = (prefix) => `${prefix}-${(scratchSeq += 1)}`;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ACTION = path.join(REPO_ROOT, '.github/actions/publish-gh-pages/action.yml');
const REPO_SLUG = 'Shyden-Ltd/ShyTalk';
const CLONE_URL = `https://x-access-token:test-token@github.com/${REPO_SLUG}.git`;

/** Extract the de-indented shell body of the action's push step. */
function extractPushScript() {
  const lines = fs.readFileSync(ACTION, 'utf8').split('\n');

  // Every `run: |` body, de-indented exactly as GitHub does before executing.
  const blocks = [];
  lines.forEach((line, start) => {
    if (line.trim() !== 'run: |') return;
    const indent = line.length - line.trimStart().length + 2;
    const pad = ' '.repeat(indent);
    const body = [];
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') {
        body.push('');
        continue;
      }
      if (!l.startsWith(pad)) break;
      body.push(l.slice(indent));
    }
    blocks.push(body.join('\n'));
  });

  // Selected by the loop's OWN marker rather than by position, so adding a
  // step above it cannot silently point this harness at a different block and
  // leave the loop untested again. An earlier version searched a fixed
  // line-window from each `run:` and matched the NEXT step's body.
  const script = blocks.find((b) => b.includes('MAX_ATTEMPTS=') && b.includes('git push'));
  if (!script) throw new Error('the push loop run-block was not found');
  return script;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

/** A bare repo with a gh-pages branch carrying the SHY-0128 invariants. */
function makeOrigin(dir) {
  const bare = path.join(dir, 'origin.git');
  fs.mkdirSync(bare);
  git(bare, 'init', '--bare', '--initial-branch=gh-pages', '--quiet');

  const seed = path.join(dir, 'seed');
  fs.mkdirSync(seed);
  git(seed, 'init', '--initial-branch=gh-pages', '--quiet');
  git(seed, 'config', 'user.email', 'seed@test');
  git(seed, 'config', 'user.name', 'seed');
  // Root-level artefacts that must survive every publish, plus a SIBLING
  // suite whose survival is the SHY-0128 invariant `keep_files: false` used
  // to provide and the destination-scoped replacement must preserve.
  fs.writeFileSync(path.join(seed, 'CNAME'), 'reports.example');
  fs.writeFileSync(path.join(seed, '.nojekyll'), '');
  fs.writeFileSync(path.join(seed, 'index.html'), '<h1>landing</h1>');
  fs.mkdirSync(path.join(seed, 'other-suite/pr/latest'), { recursive: true });
  fs.writeFileSync(path.join(seed, 'other-suite/pr/latest/index.html'), '<h1>sibling</h1>');
  git(seed, 'add', '--all');
  git(seed, 'commit', '--quiet', '-m', 'seed');
  git(seed, 'push', '--quiet', bare, 'gh-pages');
  return bare;
}

/** Runs the REAL loop with `origin` rewritten to a local bare repo. */
function publish({ dir, bare, destination, files, beforePush }) {
  const home = path.join(dir, scratch('home'));
  fs.mkdirSync(home);
  // The ONE substitution: the hardcoded GitHub URL points at the local bare
  // repo. Everything else in the script is untouched.
  execFileSync('git', ['config', '--global', `url.file://${bare}.insteadOf`, CLONE_URL], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe',
  });
  execFileSync('git', ['config', '--global', 'user.email', 'runner@test'], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe',
  });
  execFileSync('git', ['config', '--global', 'user.name', 'runner'], {
    env: { ...process.env, HOME: home },
    stdio: 'pipe',
  });

  const src = path.join(dir, scratch('src'));
  fs.mkdirSync(src, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(src, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  const runnerTemp = path.join(dir, scratch('tmp'));
  fs.mkdirSync(runnerTemp);

  let script = 'set -eo pipefail\n' + extractPushScript();
  if (beforePush) {
    // Inject the concurrent writer AFTER the loop's clone and BEFORE its
    // push, which is exactly where the production race happens.
    script = script.replace(
      'git add --all -- "$DESTINATION_DIR"',
      `${beforePush}\ngit add --all -- "$DESTINATION_DIR"`,
    );
  }

  // spawnSync, not execFileSync: the latter discards stderr on SUCCESS, and
  // the loop's "another writer landed first" notice is on stderr while the run
  // still exits 0. Losing it would make the race indistinguishable from a
  // first-attempt win.
  const run = spawnSync('bash', ['-c', script], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      RUNNER_TEMP: runnerTemp,
      REPO: REPO_SLUG,
      GH_TOKEN: 'test-token',
      PUBLISH_DIR: src,
      DESTINATION_DIR: destination,
      RUN_URL: 'https://example/run/1',
      // The action writes its summary and outputs to these; give them real
      // files so a missing one cannot be mistaken for a loop failure.
      GITHUB_OUTPUT: path.join(runnerTemp, 'gh-output'),
      GITHUB_STEP_SUMMARY: path.join(runnerTemp, 'gh-summary'),
    },
  });
  return {
    status: run.status ?? 1,
    stdout: String(run.stdout || ''),
    stderr: String(run.stderr || ''),
  };
}

/** Reads a file from the bare repo's gh-pages tip. */
function published(bare, file) {
  try {
    return git(bare, 'show', `gh-pages:${file}`);
  } catch {
    return null;
  }
}

const commitCount = (bare) => Number(git(bare, 'rev-list', '--count', 'gh-pages').trim());

let dir;
let bare;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-loop-'));
  bare = makeOrigin(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the happy path', () => {
  test('a report is published and lands on gh-pages', () => {
    const { status, stdout } = publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>report</h1>' },
    });

    expect(status).toBe(0);
    expect(stdout).toContain('on attempt 1');
    expect(published(bare, 'kotlin/pr/latest/index.html')).toBe('<h1>report</h1>');
  });

  test('siblings, CNAME, .nojekyll and the landing page all survive', () => {
    // The SHY-0128 invariant `keep_files: false` used to provide. The
    // structural pin next door only checks that an `rm -rf` token exists.
    publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>report</h1>' },
    });

    expect(published(bare, 'CNAME')).toBe('reports.example');
    expect(published(bare, '.nojekyll')).toBe('');
    expect(published(bare, 'index.html')).toBe('<h1>landing</h1>');
    expect(published(bare, 'other-suite/pr/latest/index.html')).toBe('<h1>sibling</h1>');
  });

  test('a stale file inside the destination is REMOVED, not merged', () => {
    publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>v1</h1>', 'old-page.html': 'gone next time' },
    });
    expect(published(bare, 'kotlin/pr/latest/old-page.html')).toBe('gone next time');

    publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>v2</h1>' },
    });

    expect(published(bare, 'kotlin/pr/latest/index.html')).toBe('<h1>v2</h1>');
    expect(published(bare, 'kotlin/pr/latest/old-page.html')).toBeNull();
  });

  test('republishing identical content makes NO new commit', () => {
    publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>same</h1>' },
    });
    const before = commitCount(bare);

    const { status, stdout } = publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>same</h1>' },
    });

    expect(status).toBe(0);
    expect(stdout).toContain('byte-identical');
    expect(commitCount(bare)).toBe(before);
  });

  test('a destination that does not exist yet is created', () => {
    const { status } = publish({
      dir,
      bare,
      destination: 'brand/new/place',
      files: { 'index.html': '<h1>new</h1>' },
    });

    expect(status).toBe(0);
    expect(published(bare, 'brand/new/place/index.html')).toBe('<h1>new</h1>');
  });
});

describe('the race the loop exists for', () => {
  test('a writer that lands first is NOT clobbered, and both reports survive', () => {
    // A real second clone pushing between this loop's clone and its push.
    const rival = path.join(dir, 'rival.sh');
    fs.writeFileSync(
      rival,
      [
        'RIVAL="$RUNNER_TEMP/rival"',
        'rm -rf "$RIVAL"',
        `git clone --quiet --branch gh-pages "file://${bare}" "$RIVAL"`,
        'mkdir -p "$RIVAL/other-suite/pr/latest"',
        'echo "<h1>rival</h1>" > "$RIVAL/other-suite/pr/latest/index.html"',
        'git -C "$RIVAL" add --all',
        'git -C "$RIVAL" commit --quiet -m "rival publish"',
        'git -C "$RIVAL" push --quiet origin gh-pages',
      ].join('\n'),
    );

    const { status, stdout, stderr } = publish({
      dir,
      bare,
      destination: 'kotlin/pr/latest',
      files: { 'index.html': '<h1>mine</h1>' },
      beforePush: `bash ${rival}`,
    });

    expect(status).toBe(0);
    // The loser re-applied on the winner's tip rather than forcing over it.
    // The rejection notice is on stderr; the success line is on stdout.
    expect(stderr).toMatch(/another writer landed first/);
    expect(stdout).toContain('on attempt 2');
    expect(published(bare, 'kotlin/pr/latest/index.html')).toBe('<h1>mine</h1>');
    expect(published(bare, 'other-suite/pr/latest/index.html')).toBe('<h1>rival</h1>\n');
  });

  test('the push is never a force push', () => {
    // Belt-and-braces on the property the test above proves behaviourally:
    // a `--force` anywhere in the loop would make the winner's report
    // disappear instead of being re-applied onto.
    const script = extractPushScript();
    expect(script).toMatch(/git push/);
    expect(script).not.toMatch(/git push[^\n]*--force/);
    expect(script).not.toMatch(/git push[^\n]*\+refs/);
  });
});

describe('what this harness deliberately does not cover', () => {
  test('the publish-dir refusals live in an EARLIER step, not this loop', () => {
    // The empty-dir and missing-index.html guards are a separate `run:` block
    // that gates this one, so driving them through this harness would prove
    // nothing about either. `gh-pages-publisher.test.js` walks each `::error`
    // region to its own `fi` and asserts every one exits non-zero; that is the
    // right home for them. Stated here so the absence is a decision on the
    // record rather than a gap someone has to rediscover.
    const script = extractPushScript();
    expect(script).not.toContain('is empty');
    expect(script).toContain('MAX_ATTEMPTS');
  });
});

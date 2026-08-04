/**
 * local/serve-web.js — dynamic git-meta injection for LOCAL html responses
 * (SHY-0205).
 *
 * Locally there is no build step, so "build-time injection" means
 * serve-time: the static server stamps `<meta name="shytalk-git-*">` into
 * html responses from the LIVE working tree, letting the web preview
 * watermark name the exact code being served. Real-process tests: each
 * case spawns the actual server binary and drives it over real HTTP.
 */
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER = path.join(REPO_ROOT, 'local', 'serve-web.js');
// Absolute binaries — sonarjs/no-os-command-from-path (repo convention:
// spawned commands are never PATH-resolved).
const NODE = process.execPath;
const GIT = '/usr/bin/git';

/** GETs a path from localhost:port, resolving { status, headers, body }. */
function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

/** Spawns serve-web on an ephemeral port; resolves { proc, port }. */
function startServer(cwd, root) {
  return new Promise((resolve, reject) => {
    const proc = spawn(NODE, [SERVER, '--port', '0', '--root', root], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let banner = '';
    const onData = (chunk) => {
      banner += chunk.toString();
      const m = /localhost:(\d+)/.exec(banner);
      if (m) {
        proc.stdout.off('data', onData);
        resolve({ proc, port: parseInt(m[1], 10) });
      }
    };
    proc.stdout.on('data', onData);
    proc.on('error', reject);
    proc.on('exit', (code) => reject(new Error(`serve-web exited early (${code}): ${banner}`)));
    setTimeout(
      () => reject(new Error(`serve-web never printed its banner: ${banner}`)),
      8000,
    ).unref();
  });
}

/**
 * Builds a throwaway repository with a single commit, so the git-identity
 * assertions OWN their git state instead of inheriting the runner's checkout —
 * the convention jest-git-env-isolation.js (SHY-0097) already sets for every
 * other git-using test here: "git-using tests build their own repositories".
 *
 * SHY-0243: CI checks out a DETACHED HEAD, so a test that re-reads the ambient
 * branch is asserting a property of the runner, not of the product. Owning the
 * repo lets both sides of the contract — on a branch, and detached — be pinned.
 */
function makeScratchRepo(branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-git-'));
  const git = (...args) =>
    execFileSync(GIT, args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  git('init', '-q');
  // `git init --initial-branch` needs git 2.28+; symbolic-ref works everywhere
  // and does not depend on the runner's init.defaultBranch.
  git('symbolic-ref', 'HEAD', `refs/heads/${branch}`);
  git('config', 'user.email', 'fixture@shytalk.invalid');
  git('config', 'user.name', 'SHY-0243 fixture');
  git('config', 'commit.gpgsign', 'false'); // ambient signing config must not apply
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n');
  git('add', 'seed.txt');
  git('commit', '-q', '-m', 'seed');
  return { dir, git, sha: git('rev-parse', '--short', 'HEAD') };
}

function makeWebRoot(base) {
  fs.mkdirSync(path.join(base, 'web'), { recursive: true });
  fs.writeFileSync(
    path.join(base, 'web', 'index.html'),
    '<!doctype html><html><head><title>t</title></head><body>hello</body></html>',
  );
  fs.writeFileSync(path.join(base, 'web', 'app.js'), 'console.log("untouched")');
  return 'web';
}

describe('serve-web git-meta injection (SHY-0205)', () => {
  let proc;
  afterEach(() => {
    if (proc && !proc.killed) proc.kill('SIGTERM');
    proc = undefined;
  });

  test('html responses carry the live git identity of the serving repo', async () => {
    // Serve from a scratch web root INSIDE the real repo — the sha must match
    // what git reports for THIS repo right now. Deliberately asserts nothing
    // about the branch: CI serves from a detached HEAD, so branch presence is a
    // property of the checkout, not of the product (pinned by the scratch-repo
    // cases below instead).
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch);
      const started = await startServer(REPO_ROOT, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      const sha = execFileSync(GIT, ['rev-parse', '--short', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      expect(res.body).toContain(`name="shytalk-git-sha" content="${sha}"`);
      expect(res.body.indexOf('shytalk-git-sha')).toBeLessThan(res.body.indexOf('</head>'));
      // Content-Length must match the INJECTED body, not the disk file.
      expect(parseInt(res.headers['content-length'], 10)).toBe(Buffer.byteLength(res.body));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('on a branch, the page names that branch alongside sha and clean state', async () => {
    const repo = makeScratchRepo('probe-branch');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch); // web root lives OUTSIDE the repo, so dirty is deterministic
      const started = await startServer(repo.dir, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('name="shytalk-git-branch" content="probe-branch"');
      expect(res.body).toContain(`name="shytalk-git-sha" content="${repo.sha}"`);
      expect(res.body).toContain('name="shytalk-git-dirty" content="0"');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('a detached HEAD omits the branch meta rather than publishing "HEAD"', async () => {
    // Exactly the state actions/checkout leaves a CI runner in. build-meta.js
    // degrades the literal "HEAD" to null ("branch unknown"), so the watermark
    // renders "?" instead of naming a branch that does not exist.
    const repo = makeScratchRepo('probe-branch');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch);
      repo.git('checkout', '-q', '--detach');
      expect(repo.git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD'); // fixture is really detached
      const started = await startServer(repo.dir, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('shytalk-git-branch');
      // ...but the identity it DOES know is still published.
      expect(res.body).toContain(`name="shytalk-git-sha" content="${repo.sha}"`);
      expect(res.body).toContain('name="shytalk-git-dirty" content="0"');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('an attribute-hostile branch name is sanitised, never breaking out of the tag', async () => {
    // `"`, `<` and `&` are all legal in a git refname but would corrupt the
    // markup if they reached the attribute. sanitizeLabel collapses them first,
    // so the value degrades visibly instead of the page breaking silently.
    const repo = makeScratchRepo('feat/a"b<c&d');
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch);
      const started = await startServer(repo.dir, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('name="shytalk-git-branch" content="feat/a-b-c-d"');
      // Each hostile pair as it appears in the RAW refname — none may survive.
      expect(res.body).not.toContain('a"b');
      expect(res.body).not.toContain('b<c');
      expect(res.body).not.toContain('c&d');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('non-html assets stream through byte-identical', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch);
      const started = await startServer(REPO_ROOT, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/app.js');
      expect(res.status).toBe(200);
      expect(res.body).toBe('console.log("untouched")');
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('outside any git repo, html serves unmodified (fail-open, no metas)', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-nogit-'));
    try {
      makeWebRoot(bare);
      const started = await startServer(bare, 'web');
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      expect(res.body).toContain('hello');
      expect(res.body).not.toContain('shytalk-git-sha');
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  test('404 behaviour is unchanged', async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-test-'));
    try {
      makeWebRoot(scratch);
      const started = await startServer(REPO_ROOT, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/nope-does-not-exist');
      expect(res.status).toBe(404);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

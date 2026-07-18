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
    // Serve from a scratch web root INSIDE the real repo — the git values
    // must match what git reports for the repo right now.
    const scratch = fs.mkdtempSync(path.join(REPO_ROOT, '.serve-web-test-'));
    try {
      makeWebRoot(scratch);
      const started = await startServer(REPO_ROOT, path.join(scratch, 'web'));
      proc = started.proc;
      const res = await get(started.port, '/');
      expect(res.status).toBe(200);
      const branch = execFileSync(GIT, ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      const sha = execFileSync(GIT, ['rev-parse', '--short', 'HEAD'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      }).trim();
      expect(res.body).toContain(`name="shytalk-git-sha" content="${sha}"`);
      expect(res.body).toContain(`content="${branch}"`);
      expect(res.body.indexOf('shytalk-git-sha')).toBeLessThan(res.body.indexOf('</head>'));
      // Content-Length must match the INJECTED body, not the disk file.
      expect(parseInt(res.headers['content-length'], 10)).toBe(Buffer.byteLength(res.body));
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  test('non-html assets stream through byte-identical', async () => {
    const scratch = fs.mkdtempSync(path.join(REPO_ROOT, '.serve-web-test-'));
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
    const scratch = fs.mkdtempSync(path.join(REPO_ROOT, '.serve-web-test-'));
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

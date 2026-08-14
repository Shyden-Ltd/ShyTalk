/**
 * serve-web.test.js
 *
 * Tests local/serve-web.js — the zero-dependency static server that replaces
 * `npx serve` (SHY-0180). REAL server, REAL sockets, REAL temp files — no
 * doubles (the whole point of the change is a server that behaves like a real
 * server, so the tests exercise a real one).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const { parseArgs, contentType, resolveFile, createServer } = require('../../../local/serve-web');

jest.setTimeout(15000);

// ── pure helpers ──────────────────────────────────────────────────

describe('parseArgs', () => {
  test('defaults: port 8888, root public, not quiet', () => {
    expect(parseArgs([])).toEqual({ port: 8888, root: 'public', quiet: false });
  });

  test('--port and -l both set the port', () => {
    expect(parseArgs(['--port', '9999']).port).toBe(9999);
    expect(parseArgs(['-l', '8080']).port).toBe(8080);
  });

  test('--root sets the served directory', () => {
    expect(parseArgs(['--root', 'dist']).root).toBe('dist');
  });

  test("--quiet and serve's --no-clipboard alias both enable quiet", () => {
    expect(parseArgs(['--quiet']).quiet).toBe(true);
    expect(parseArgs(['--no-clipboard']).quiet).toBe(true);
  });

  test('a non-numeric --port yields NaN (surfaced, not silently defaulted)', () => {
    // parseInt('abc',10) === NaN — the real start.sh always passes a valid
    // port; pin the boundary so a bad value fails loud (a NaN listen throws)
    // rather than silently binding some default.
    expect(Number.isNaN(parseArgs(['--port', 'abc']).port)).toBe(true);
  });

  test('a value flag as the final token with no following value → undefined', () => {
    expect(parseArgs(['--root']).root).toBeUndefined();
    expect(Number.isNaN(parseArgs(['--port']).port)).toBe(true);
  });
});

describe('contentType', () => {
  test.each([
    ['x.html', 'text/html; charset=utf-8'],
    ['x.js', 'text/javascript; charset=utf-8'],
    ['x.mjs', 'text/javascript; charset=utf-8'],
    ['x.css', 'text/css; charset=utf-8'],
    ['x.json', 'application/json; charset=utf-8'],
    ['x.png', 'image/png'],
    ['x.svg', 'image/svg+xml'],
    ['x.woff2', 'font/woff2'],
  ])('%s → %s', (file, type) => {
    expect(contentType(file)).toBe(type);
  });

  test('unknown extension → octet-stream (never guesses)', () => {
    expect(contentType('x.wat')).toBe('application/octet-stream');
    expect(contentType('noext')).toBe('application/octet-stream');
  });

  test('extension match is case-insensitive', () => {
    expect(contentType('X.PNG')).toBe('image/png');
  });
});

describe('resolveFile — clean URLs, index, traversal', () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-root-'));
    fs.mkdirSync(path.join(root, 'admin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), 'home');
    fs.writeFileSync(path.join(root, 'roadmap.html'), 'roadmap');
    fs.mkdirSync(path.join(root, 'admin', 'js'), { recursive: true });
    fs.writeFileSync(path.join(root, 'admin', 'index.html'), 'admin-home');
    fs.writeFileSync(path.join(root, 'admin', 'reports.html'), 'reports');
    fs.writeFileSync(path.join(root, 'admin', 'js', 'app.js'), 'code');
  });

  test('/ → index.html', () => {
    expect(resolveFile(root, '/')).toBe(path.join(root, 'index.html'));
  });

  test('/admin/ → admin/index.html (directory index)', () => {
    expect(resolveFile(root, '/admin/')).toBe(path.join(root, 'admin', 'index.html'));
  });

  test('/roadmap.html → exact file', () => {
    expect(resolveFile(root, '/roadmap.html')).toBe(path.join(root, 'roadmap.html'));
  });

  test('/admin/reports → clean-URL .html', () => {
    expect(resolveFile(root, '/admin/reports')).toBe(path.join(root, 'admin', 'reports.html'));
  });

  test('/admin/js/app.js → exact asset', () => {
    expect(resolveFile(root, '/admin/js/app.js')).toBe(path.join(root, 'admin', 'js', 'app.js'));
  });

  test('query string and fragment are stripped before resolving', () => {
    expect(resolveFile(root, '/admin/reports?tab=x')).toBe(
      path.join(root, 'admin', 'reports.html'),
    );
    expect(resolveFile(root, '/roadmap.html#section')).toBe(path.join(root, 'roadmap.html'));
  });

  test('missing path → null (never throws)', () => {
    expect(resolveFile(root, '/does/not/exist')).toBeNull();
  });

  test('path traversal is refused (../ escaping the root → null)', () => {
    expect(resolveFile(root, '/../package.json')).toBeNull();
    expect(resolveFile(root, '/../../etc/passwd')).toBeNull();
  });

  test('URL-encoded traversal is refused', () => {
    expect(resolveFile(root, '/%2e%2e/package.json')).toBeNull();
  });

  test('malformed percent-encoding → null, never throws (would crash the request handler)', () => {
    expect(() => resolveFile(root, '/%')).not.toThrow();
    expect(resolveFile(root, '/%')).toBeNull();
    expect(resolveFile(root, '/%zz')).toBeNull();
  });

  test('a sibling dir sharing the root prefix is NOT treated as inside the root', () => {
    // `${root}-evil` starts with the root STRING but is not inside the root DIR.
    // Create a REAL file there so the guard is load-bearing: with the correct
    // `startsWith(absRoot + sep)` check it's rejected; if the guard were
    // weakened to bare `startsWith(absRoot)` it would resolve + this file would
    // be served — so this test goes red on that mutation (non-tautological).
    const evilDir = `${root}-evil`;
    fs.mkdirSync(evilDir, { recursive: true });
    fs.writeFileSync(path.join(evilDir, 'secret'), 'LEAKED');
    try {
      expect(resolveFile(root, '/../' + path.basename(root) + '-evil/secret')).toBeNull();
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  // SHY-0293 — CodeQL js/path-injection, 3 high alerts on PR #1652.
  //
  // The guard above validates `requested`, but the CANDIDATES are derived from
  // it AFTERWARDS: `${requested}.html`. When a URL resolves to the root itself
  // the guard passes (the root IS inside the root) and the clean-URL candidate
  // becomes `<root>.html` — a SIBLING of the web root, outside it.
  //
  // Non-tautological: a real `<root>.html` is created with real content, so a
  // resolver that returns it fails on the value, not merely on non-null.
  test.each([
    ['/.', 'the current dir'],
    ['/foo/..', 'a parent traversal that lands back on the root'],
    ['/%2e', 'a percent-encoded dot'],
    ['//.', 'a doubled leading slash'],
  ])('%s (%s) must not reach the sibling <root>.html', (urlPath) => {
    const sibling = `${root}.html`;
    fs.writeFileSync(sibling, 'SECRET-OUTSIDE-THE-ROOT');
    try {
      const resolved = resolveFile(root, urlPath);
      expect(resolved).not.toBe(sibling);
      // Whatever it resolves to must be inside the root — a stricter claim than
      // "not that one file", so a fix that merely renames the escape still reds.
      if (resolved !== null) {
        expect(resolved.startsWith(root + path.sep)).toBe(true);
      }
    } finally {
      fs.rmSync(sibling, { force: true });
    }
  });

  test('an extensionless request WITHOUT a trailing slash still falls back to dir index', () => {
    // Exercises the non-slash branch's third candidate (`<path>/index.html`),
    // distinct from the trailing-slash branch above.
    expect(resolveFile(root, '/admin')).toBe(path.join(root, 'admin', 'index.html'));
  });

  test('a real directory with no index.html → null (not a throw, not a stray file)', () => {
    // admin/js exists with only app.js inside — no index.html — so a dir
    // request must 404, not serve app.js or throw.
    expect(resolveFile(root, '/admin/js/')).toBeNull();
  });
});

// ── real server over a real socket ────────────────────────────────

describe('createServer — real HTTP behaviour', () => {
  let root;
  let server;
  let port;

  beforeAll((done) => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-live-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
    fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(root, 'empty.js'), ''); // 0-byte — must still 'open' → 200
    // A real, resolvable-but-unreadable file to induce a genuine open() error
    // (EACCES) over the wire — the failure class that must yield 500, not crash.
    fs.writeFileSync(path.join(root, 'locked.js'), 'secret');
    fs.chmodSync(path.join(root, 'locked.js'), 0o000);
    server = createServer({ root });
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http
        .get({ port, path: urlPath }, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () =>
            resolve({ status: res.statusCode, type: res.headers['content-type'], body }),
          );
        })
        .on('error', reject);
    });
  }

  test('serves index.html at / with 200 + html type', async () => {
    const r = await get('/');
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/html; charset=utf-8');
    expect(r.body).toContain('home');
  });

  test('serves a .js asset with 200 + javascript type', async () => {
    const r = await get('/app.js');
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/javascript; charset=utf-8');
  });

  test('unresolved path → 404, server stays up for the next request', async () => {
    const miss = await get('/nope');
    expect(miss.status).toBe(404);
    // still serving afterwards
    const hit = await get('/');
    expect(hit.status).toBe(200);
  });

  test('a traversal request over the wire → 404', async () => {
    const r = await get('/../../package.json');
    expect(r.status).toBe(404);
  });

  test('a 0-byte file still opens → 200 with empty body (no hang under the open-event logic)', async () => {
    // The C2 fix writes headers on stream 'open'; an empty file still emits
    // 'open' (then immediate 'end'), so it must 200 with a 0-length body,
    // never hang waiting for data that never comes.
    const r = await get('/empty.js');
    expect(r.status).toBe(200);
    expect(r.type).toBe('text/javascript; charset=utf-8');
    expect(r.body).toBe('');
  });

  // Skips when the test runs as root (chmod 000 doesn't block root reads).
  // GitHub Actions' default `runner` user + local dev are non-root, so this
  // exercises the real open()-error path in CI.
  const rootUser = typeof process.getuid === 'function' && process.getuid() === 0;
  (rootUser ? test.skip : test)(
    'a real open() error (EACCES) yields 500, NOT a misleading 200, and the server stays up',
    async () => {
      const r = await get('/locked.js');
      // The deferred-writeHead fix: headers are NOT sent until the stream
      // opens, so a failed open still owns the response → real 500. Before the
      // fix this shipped 200 + empty body (the 'if (!headersSent)' was dead).
      expect(r.status).toBe(500);
      // process survived — the next request still serves.
      expect((await get('/')).status).toBe(200);
    },
  );

  test('survives many rapid requests without dying (no unhandled error crash)', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => get('/app.js')));
    expect(results.every((r) => r.status === 200)).toBe(true);
    // and still alive
    expect((await get('/')).status).toBe(200);
  });
});

// ── main() / CLI entry + signal shutdown (real spawned process) ────

describe('serve-web.js CLI — clean SIGINT/SIGTERM shutdown', () => {
  const { spawn } = require('child_process');
  const SCRIPT = path.resolve(__dirname, '../../../local/serve-web.js');

  function spawnServer() {
    // --port 0 → ephemeral; wait for the startup banner, then we own the pid.
    // process.execPath = absolute path to THIS node (avoids a PATH lookup —
    // sonarjs/no-os-command-from-path — and runs the same runtime as the suite).
    const child = spawn(process.execPath, [SCRIPT, '--port', '0', '--root', os.tmpdir()], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let out = '';
      const fail = (e) => {
        clearTimeout(t);
        child.kill('SIGKILL'); // don't leak the child if startup never confirmed
        reject(e);
      };
      const t = setTimeout(() => fail(new Error('server did not start in 5s')), 5000);
      child.stdout.on('data', (c) => {
        out += c;
        if (out.includes('[serve-web] serving')) {
          clearTimeout(t);
          resolve(child);
        }
      });
      child.on('error', fail);
    });
  }

  function exitOf(child) {
    return new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  }

  test.each(['SIGINT', 'SIGTERM'])('%s → the process exits 0 (clean shutdown)', async (sig) => {
    const child = await spawnServer();
    const exited = exitOf(child);
    child.kill(sig);
    const { code } = await exited;
    expect(code).toBe(0);
  });
});

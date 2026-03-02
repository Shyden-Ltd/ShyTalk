/**
 * Smoke test: spawns the worker locally via `wrangler dev` and verifies
 * it starts up, registers routes, and returns a healthy response.
 *
 * This catches startup crashes (bad imports, syntax errors, missing modules)
 * that would cause the deployed worker to return error 1027.
 */

const { spawn } = require('child_process');
const http = require('http');

const WORKER_PORT = 18787; // Non-standard port to avoid collisions
const STARTUP_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 5000;

function fetch(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${WORKER_PORT}${path}`, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

describe('Worker smoke test', () => {
  let workerProcess;

  beforeAll((done) => {
    workerProcess = spawn('npx', [
      'wrangler', 'dev', '--port', String(WORKER_PORT), '--local',
    ], {
      cwd: require('path').resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let started = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes('Ready on') && !started) {
        started = true;
        done();
      }
    };

    workerProcess.stdout.on('data', onData);
    workerProcess.stderr.on('data', onData);

    setTimeout(() => {
      if (!started) {
        done(new Error('Worker did not start within timeout'));
      }
    }, STARTUP_TIMEOUT_MS);
  }, STARTUP_TIMEOUT_MS + 5000);

  afterAll(() => {
    if (workerProcess && workerProcess.pid) {
      if (process.platform === 'win32') {
        // Kill process tree on Windows (shell:true creates a wrapper process)
        try {
          const { execFileSync } = require('child_process');
          execFileSync('taskkill', ['/pid', String(workerProcess.pid), '/T', '/F'], { stdio: 'ignore' });
        } catch {}
      } else {
        workerProcess.kill('SIGTERM');
      }
    }
  });

  test('GET /api/health returns 200 with status ok', async () => {
    const res = await fetch('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  test('GET /api/nonexistent returns 401 (auth required before 404)', async () => {
    const res = await fetch('/api/nonexistent');
    // Without auth token, the middleware returns 401 before route matching
    expect(res.status).toBe(401);
  });

  test('worker responds to requests (not crashed)', async () => {
    // Multiple rapid requests to verify the worker stays alive
    const results = await Promise.all([
      fetch('/api/health'),
      fetch('/api/health'),
      fetch('/api/health'),
    ]);
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});

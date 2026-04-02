const express = require('express');
const request = require('supertest');

// ─── Tests ───────────────────────────────────────────────────────

// Save the original env so we can restore after each test
const savedAllowedOrigins = process.env.ALLOWED_ORIGINS;
const savedNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  // Restore original env
  if (savedAllowedOrigins !== undefined) {
    process.env.ALLOWED_ORIGINS = savedAllowedOrigins;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }
  if (savedNodeEnv !== undefined) {
    process.env.NODE_ENV = savedNodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }
});

/**
 * Helper: create a fresh Express app with the CORS middleware.
 * Sets env BEFORE requiring the module so the top-level evaluation picks it up.
 * Uses jest.resetModules() (in beforeEach) to ensure a fresh module each time.
 */
function createApp(envOrigins, nodeEnv) {
  if (envOrigins !== undefined) {
    process.env.ALLOWED_ORIGINS = envOrigins;
  } else {
    delete process.env.ALLOWED_ORIGINS;
  }

  if (nodeEnv !== undefined) {
    process.env.NODE_ENV = nodeEnv;
  } else {
    delete process.env.NODE_ENV;
  }

  const corsMiddleware = require('../../src/middleware/cors');

  const app = express();
  app.use(corsMiddleware);
  app.get('/test', (req, res) => res.json({ success: true }));
  return app;
}

describe('CORS middleware', () => {
  test('allows requests with no Origin header (mobile apps, curl)', async () => {
    const app = createApp();
    const res = await request(app).get('/test').expect(200);
    expect(res.body.success).toBe(true);
  });

  test('allows default origin https://shytalk.shyden.co.uk', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://shytalk.shyden.co.uk')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://shytalk.shyden.co.uk');
    expect(res.body.success).toBe(true);
  });

  test('allows default origin https://api.shytalk.shyden.co.uk', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://api.shytalk.shyden.co.uk')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://api.shytalk.shyden.co.uk');
  });

  test('allows Cloudflare Pages preview deployments (shytalk-site.pages.dev)', async () => {
    const app = createApp();
    const origin = 'https://abc123.shytalk-site.pages.dev';
    const res = await request(app).get('/test').set('Origin', origin).expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  test('allows Cloudflare Pages dev preview deployments (shytalk-site-dev.pages.dev)', async () => {
    const app = createApp();
    const origin = 'https://preview-xyz.shytalk-site-dev.pages.dev';
    const res = await request(app).get('/test').set('Origin', origin).expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  test('blocks disallowed origins', async () => {
    const app = createApp();
    const res = await request(app).get('/test').set('Origin', 'https://evil-site.com').expect(500); // Express default error handler returns 500 for CORS rejection

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('blocks origins that partially match but are not subdomains', async () => {
    const app = createApp();
    // Should not match — not a subdomain of pages.dev
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://fake.shytalk-site.pages.dev.evil.com')
      .expect(500);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('respects ALLOWED_ORIGINS env variable', async () => {
    const app = createApp('https://custom-origin.example.com,https://another.example.com');
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://custom-origin.example.com')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://custom-origin.example.com');
  });

  test('ALLOWED_ORIGINS env trims whitespace', async () => {
    const app = createApp('  https://trimmed.example.com  , https://another.example.com  ');
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://trimmed.example.com')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://trimmed.example.com');
  });

  test('preflight OPTIONS returns correct methods and headers', async () => {
    const app = createApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://shytalk.shyden.co.uk')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Authorization,Content-Type');

    expect(res.headers['access-control-allow-methods']).toMatch(/GET/);
    expect(res.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(res.headers['access-control-allow-methods']).toMatch(/PUT/);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(res.headers['access-control-allow-methods']).toMatch(/DELETE/);
    expect(res.headers['access-control-allow-methods']).toMatch(/OPTIONS/);

    expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/);
    expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/);
    expect(res.headers['access-control-allow-headers']).toMatch(/x-session-trace-id/);
  });

  test('default origins do not include custom env origins when env is not set', async () => {
    const app = createApp(); // No env var
    // Default should only allow shytalk.shyden.co.uk and api.shytalk.shyden.co.uk
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://custom-origin.example.com')
      .expect(500);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('x-device-id appears in Access-Control-Allow-Headers', async () => {
    const app = createApp();
    const res = await request(app)
      .options('/test')
      .set('Origin', 'https://shytalk.shyden.co.uk')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-device-id');

    expect(res.headers['access-control-allow-headers']).toMatch(/x-device-id/);
  });
});

describe('CORS localhost in local mode', () => {
  test('NODE_ENV=local allows http://localhost:5500', async () => {
    const app = createApp(undefined, 'local');
    const res = await request(app).get('/test').set('Origin', 'http://localhost:5500').expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5500');
    expect(res.body.success).toBe(true);
  });

  test('NODE_ENV=local allows http://localhost (no port)', async () => {
    const app = createApp(undefined, 'local');
    const res = await request(app).get('/test').set('Origin', 'http://localhost').expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost');
  });

  test('NODE_ENV=local allows http://localhost:4000 (Firebase UI)', async () => {
    const app = createApp(undefined, 'local');
    const res = await request(app).get('/test').set('Origin', 'http://localhost:4000').expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4000');
  });

  test('NODE_ENV=production blocks http://localhost:5500', async () => {
    const app = createApp(undefined, 'production');
    const res = await request(app).get('/test').set('Origin', 'http://localhost:5500').expect(500);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('NODE_ENV not set (undefined) blocks http://localhost:5500', async () => {
    const app = createApp(undefined, undefined);
    const res = await request(app).get('/test').set('Origin', 'http://localhost:5500').expect(500);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('NODE_ENV=local still allows default origins', async () => {
    const app = createApp(undefined, 'local');
    const res = await request(app)
      .get('/test')
      .set('Origin', 'https://shytalk.shyden.co.uk')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('https://shytalk.shyden.co.uk');
  });

  test('NODE_ENV=local still blocks non-localhost disallowed origins', async () => {
    const app = createApp(undefined, 'local');
    const res = await request(app).get('/test').set('Origin', 'https://evil-site.com').expect(500);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

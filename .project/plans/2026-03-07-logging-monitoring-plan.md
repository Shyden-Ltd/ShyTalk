# Logging, Monitoring & Device Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive logging, monitoring, device management, banning, alerting, and admin panel features across the entire ShyTalk stack.

**Architecture:** Unified log ingestion via Express API `POST /api/logs`. Firestore for live logs + R2 for 90-day archival. Client-generated `sessionTraceId` + server-generated `requestTraceId` for end-to-end tracing. Admin panel Logs tab with filters, live streaming, and trace timeline view.

**Tech Stack:** Express.js, Firebase Admin SDK, Cloudflare R2, Kotlin Multiplatform (expect/actual), Ktor, Compose Multiplatform, Jest/Supertest, JUnit/MockK.

**Design doc:** `docs/plans/2026-03-07-logging-monitoring-design.md`

---

## Task 1: Express Logger Utility (`logger.js`)

The central logging module — everything else depends on this.

**Files:**
- Create: `express-api/src/utils/logger.js`
- Create: `express-api/tests/utils/logger.test.js`

**Step 1: Write the failing tests**

```javascript
// express-api/tests/utils/logger.test.js
const { createLogger } = require('../../src/utils/logger');

describe('logger', () => {
  let logger;
  let mockDb;
  let mockCollection;
  let mockDoc;

  beforeEach(() => {
    mockDoc = { set: jest.fn().mockResolvedValue(undefined) };
    mockCollection = { doc: jest.fn(() => mockDoc) };
    mockDb = { collection: jest.fn(() => mockCollection) };
    logger = createLogger(mockDb);
    logger._resetDailyCount();
  });

  test('writes INFO log to Firestore', async () => {
    await logger.log({
      level: 'INFO',
      source: 'express-api',
      message: 'Test message',
      context: {}
    });

    expect(mockDb.collection).toHaveBeenCalledWith('logs');
    expect(mockDoc.set).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        source: 'express-api',
        message: 'Test message'
      })
    );
  });

  test('rejects invalid log level', async () => {
    await logger.log({ level: 'INVALID', source: 'express-api', message: 'Test' });
    expect(mockDoc.set).not.toHaveBeenCalled();
  });

  test('rejects missing required fields', async () => {
    await logger.log({ level: 'INFO' });
    expect(mockDoc.set).not.toHaveBeenCalled();
  });

  test('never throws — swallows Firestore errors', async () => {
    mockDoc.set.mockRejectedValue(new Error('Firestore down'));
    await expect(
      logger.log({ level: 'ERROR', source: 'express-api', message: 'Test' })
    ).resolves.not.toThrow();
  });

  test('throttles at hard cap — only allows ERROR/FATAL', async () => {
    logger._setDailyCount(15000);
    logger._setHardCap(15000);

    await logger.log({ level: 'INFO', source: 'express-api', message: 'Dropped' });
    expect(mockDoc.set).not.toHaveBeenCalled();

    await logger.log({ level: 'ERROR', source: 'express-api', message: 'Allowed' });
    expect(mockDoc.set).toHaveBeenCalled();
  });

  test('smart throttle drops DEBUG when approaching cap', async () => {
    logger._setDailyCount(12000);
    logger._setHardCap(15000);

    await logger.log({ level: 'DEBUG', source: 'express-api', message: 'Dropped' });
    expect(mockDoc.set).not.toHaveBeenCalled();

    await logger.log({ level: 'WARN', source: 'express-api', message: 'Allowed' });
    expect(mockDoc.set).toHaveBeenCalled();
  });

  test('sanitizes sensitive fields from context', async () => {
    await logger.log({
      level: 'INFO',
      source: 'express-api',
      message: 'Login',
      context: { password: 'secret', token: 'abc', idToken: 'xyz', route: '/api/auth' }
    });

    const logged = mockDoc.set.mock.calls[0][0];
    expect(logged.context.password).toBeUndefined();
    expect(logged.context.token).toBeUndefined();
    expect(logged.context.idToken).toBeUndefined();
    expect(logged.context.route).toBe('/api/auth');
  });

  test('includes timestamp and id in log entry', async () => {
    await logger.log({ level: 'INFO', source: 'express-api', message: 'Test' });

    const logged = mockDoc.set.mock.calls[0][0];
    expect(logged.id).toBeDefined();
    expect(logged.timestamp).toBeDefined();
  });

  test('getDailyStats returns count and cap', () => {
    logger._setDailyCount(500);
    logger._setHardCap(15000);
    const stats = logger.getDailyStats();
    expect(stats).toEqual({ count: 500, hardCap: 15000 });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/utils/logger.test.js --verbose`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// express-api/src/utils/logger.js
const crypto = require('crypto');

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const LEVEL_PRIORITY = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const SENSITIVE_KEYS = ['password', 'token', 'idToken', 'accessToken', 'refreshToken', 'secret', 'credential'];

function createLogger(db) {
  let dailyCount = 0;
  let hardCap = 15000;
  let lastResetDate = new Date().toISOString().slice(0, 10);

  function resetIfNewDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastResetDate) {
      dailyCount = 0;
      lastResetDate = today;
    }
  }

  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEYS.includes(key)) continue;
      clean[key] = typeof value === 'object' && value !== null ? sanitize(value) : value;
    }
    return clean;
  }

  function shouldLog(level) {
    resetIfNewDay();
    const priority = LEVEL_PRIORITY[level];
    if (dailyCount >= hardCap) return priority >= LEVEL_PRIORITY.ERROR;
    if (dailyCount >= hardCap * 0.8) return priority >= LEVEL_PRIORITY.WARN;
    if (dailyCount >= hardCap * 0.6) return priority >= LEVEL_PRIORITY.INFO;
    return true;
  }

  async function log(entry) {
    try {
      if (!entry || !VALID_LEVELS.includes(entry.level)) return;
      if (!entry.source || !entry.message) return;
      if (!shouldLog(entry.level)) return;

      const id = crypto.randomBytes(16).toString('hex');
      const doc = {
        id,
        timestamp: new Date().toISOString(),
        level: entry.level,
        source: entry.source,
        sessionTraceId: entry.sessionTraceId || null,
        requestTraceId: entry.requestTraceId || null,
        userId: entry.userId || null,
        deviceId: entry.deviceId || null,
        message: entry.message,
        context: sanitize(entry.context || {}),
        appVersion: entry.appVersion || null,
        platform: entry.platform || null,
        osVersion: entry.osVersion || null
      };

      await db.collection('logs').doc(id).set(doc);
      dailyCount++;
    } catch (err) {
      console.error('[Logger] Failed to write log:', err.message);
    }
  }

  function getDailyStats() {
    resetIfNewDay();
    return { count: dailyCount, hardCap };
  }

  // Test helpers — only used in tests
  function _resetDailyCount() { dailyCount = 0; }
  function _setDailyCount(n) { dailyCount = n; }
  function _setHardCap(n) { hardCap = n; }

  return { log, getDailyStats, _resetDailyCount, _setDailyCount, _setHardCap };
}

module.exports = { createLogger };
```

**Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/utils/logger.test.js --verbose`
Expected: All tests PASS

**Step 5: Create the singleton logger instance**

Create `express-api/src/utils/loggerInstance.js`:

```javascript
// express-api/src/utils/loggerInstance.js
const { db } = require('./firebase');
const { createLogger } = require('./logger');

const logger = createLogger(db);

module.exports = logger;
```

**Step 6: Commit**

```bash
cd express-api && git add src/utils/logger.js src/utils/loggerInstance.js tests/utils/logger.test.js
git commit -m "feat: add central logger utility with quota protection and sanitization"
```

---

## Task 2: Request Logger Middleware

Auto-logs every HTTP request/response with trace IDs.

**Files:**
- Create: `express-api/src/middleware/requestLogger.js`
- Create: `express-api/tests/middleware/requestLogger.test.js`
- Modify: `express-api/src/index.js` (mount middleware)

**Step 1: Write the failing tests**

```javascript
// express-api/tests/middleware/requestLogger.test.js
const { createRequestLogger } = require('../../src/middleware/requestLogger');

describe('requestLogger middleware', () => {
  let middleware;
  let mockLogger;
  let req;
  let res;
  let next;

  beforeEach(() => {
    mockLogger = { log: jest.fn().mockResolvedValue(undefined) };
    middleware = createRequestLogger(mockLogger);
    req = {
      method: 'POST',
      originalUrl: '/api/rooms/join',
      headers: { 'x-session-trace-id': 'session-abc' },
      body: { roomId: 'room1' },
      auth: { uid: 'user1' }
    };
    res = {
      statusCode: 200,
      _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      getHeader(k) { return this._headers[k]; },
      on: jest.fn(),
      json: jest.fn()
    };
    next = jest.fn();
  });

  test('calls next() immediately', () => {
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('sets x-request-trace-id response header', () => {
    middleware(req, res, next);
    expect(res._headers['x-request-trace-id']).toBeDefined();
    expect(res._headers['x-request-trace-id']).toHaveLength(32);
  });

  test('attaches traceIds to req object', () => {
    middleware(req, res, next);
    expect(req.sessionTraceId).toBe('session-abc');
    expect(req.requestTraceId).toBeDefined();
  });

  test('logs on response finish', () => {
    middleware(req, res, next);
    // Simulate the 'finish' event
    const finishCallback = res.on.mock.calls.find(c => c[0] === 'finish')[1];
    finishCallback();

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'INFO',
        source: 'express-api',
        message: expect.stringContaining('POST /api/rooms/join'),
        context: expect.objectContaining({
          method: 'POST',
          path: '/api/rooms/join',
          statusCode: 200
        })
      })
    );
  });

  test('logs ERROR level for 5xx responses', () => {
    res.statusCode = 500;
    middleware(req, res, next);
    const finishCallback = res.on.mock.calls.find(c => c[0] === 'finish')[1];
    finishCallback();

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ERROR' })
    );
  });

  test('logs WARN level for 4xx responses', () => {
    res.statusCode = 403;
    middleware(req, res, next);
    const finishCallback = res.on.mock.calls.find(c => c[0] === 'finish')[1];
    finishCallback();

    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'WARN' })
    );
  });

  test('sanitizes request body — strips password and token', () => {
    req.body = { password: 'secret', token: 'abc', roomId: 'room1' };
    middleware(req, res, next);
    const finishCallback = res.on.mock.calls.find(c => c[0] === 'finish')[1];
    finishCallback();

    const logged = mockLogger.log.mock.calls[0][0];
    expect(logged.context.requestBody.password).toBeUndefined();
    expect(logged.context.requestBody.token).toBeUndefined();
    expect(logged.context.requestBody.roomId).toBe('room1');
  });

  test('never throws if logger fails', () => {
    mockLogger.log.mockRejectedValue(new Error('Logger down'));
    middleware(req, res, next);
    const finishCallback = res.on.mock.calls.find(c => c[0] === 'finish')[1];
    expect(() => finishCallback()).not.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/middleware/requestLogger.test.js --verbose`
Expected: FAIL

**Step 3: Write the implementation**

```javascript
// express-api/src/middleware/requestLogger.js
const crypto = require('crypto');

const SENSITIVE_KEYS = ['password', 'token', 'idToken', 'accessToken', 'refreshToken', 'secret', 'credential'];

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const clean = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_KEYS.includes(key)) continue;
    clean[key] = value;
  }
  return clean;
}

function createRequestLogger(logger) {
  return function requestLogger(req, res, next) {
    const startTime = Date.now();
    const requestTraceId = crypto.randomBytes(16).toString('hex');
    const sessionTraceId = req.headers['x-session-trace-id'] || null;

    req.requestTraceId = requestTraceId;
    req.sessionTraceId = sessionTraceId;

    res.setHeader('x-request-trace-id', requestTraceId);

    res.on('finish', () => {
      try {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;
        let level = 'INFO';
        if (statusCode >= 500) level = 'ERROR';
        else if (statusCode >= 400) level = 'WARN';

        logger.log({
          level,
          source: 'express-api',
          sessionTraceId,
          requestTraceId,
          userId: req.auth?.uid || null,
          message: `${req.method} ${req.originalUrl} ${statusCode} ${durationMs}ms`,
          context: {
            method: req.method,
            path: req.originalUrl,
            statusCode,
            durationMs,
            requestBody: sanitizeBody(req.body),
            userAgent: req.headers['user-agent'] || null
          }
        });
      } catch (err) {
        console.error('[RequestLogger] Error:', err.message);
      }
    });

    next();
  };
}

module.exports = { createRequestLogger };
```

**Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/middleware/requestLogger.test.js --verbose`
Expected: All tests PASS

**Step 5: Mount middleware in index.js**

Modify `express-api/src/index.js` — add after `app.use(express.json(...))`:

```javascript
const logger = require('./utils/loggerInstance');
const { createRequestLogger } = require('./middleware/requestLogger');
app.use(createRequestLogger(logger));
```

**Step 6: Commit**

```bash
git add express-api/src/middleware/requestLogger.js express-api/tests/middleware/requestLogger.test.js express-api/src/index.js
git commit -m "feat: add request/response logging middleware with trace IDs"
```

---

## Task 3: Log Ingestion Endpoint (`POST /api/logs`)

Accepts logs from Android, iOS, and web clients.

**Files:**
- Create: `express-api/src/routes/logs.js`
- Create: `express-api/tests/routes/logs.test.js`
- Modify: `express-api/src/index.js` (mount route)

**Step 1: Write the failing tests**

```javascript
// express-api/tests/routes/logs.test.js
const express = require('express');
const request = require('supertest');

// Mock logger
const mockLogger = { log: jest.fn().mockResolvedValue(undefined), getDailyStats: jest.fn(() => ({ count: 100, hardCap: 15000 })) };

// Mock auth
jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: (req, res, next) => { req.auth = { uid: 'user1' }; next(); },
  requireAdmin: (req, res) => {
    if (!req.auth?.isAdmin) { res.status(403).json({ error: 'Admin required' }); return true; }
    return false;
  }
}));

const { createLogsRouter } = require('../../src/routes/logs');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.auth = { uid: 'user1' }; next(); });
  app.use('/api', createLogsRouter(mockLogger));
  return app;
}

describe('POST /api/logs', () => {
  let app;

  beforeEach(() => {
    mockLogger.log.mockClear();
    app = createApp();
  });

  test('accepts valid log entry', async () => {
    const res = await request(app).post('/api/logs').send({
      level: 'INFO',
      source: 'android',
      message: 'App launched',
      sessionTraceId: 'session-1',
      context: {}
    });

    expect(res.status).toBe(202);
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'INFO', source: 'android', userId: 'user1' })
    );
  });

  test('accepts batch of log entries', async () => {
    const res = await request(app).post('/api/logs').send({
      batch: [
        { level: 'INFO', source: 'android', message: 'Event 1' },
        { level: 'WARN', source: 'android', message: 'Event 2' }
      ]
    });

    expect(res.status).toBe(202);
    expect(mockLogger.log).toHaveBeenCalledTimes(2);
  });

  test('rejects invalid level', async () => {
    const res = await request(app).post('/api/logs').send({
      level: 'INVALID',
      source: 'android',
      message: 'Test'
    });

    expect(res.status).toBe(400);
  });

  test('rejects missing source', async () => {
    const res = await request(app).post('/api/logs').send({
      level: 'INFO',
      message: 'Test'
    });

    expect(res.status).toBe(400);
  });

  test('rejects oversized batch (>50)', async () => {
    const batch = Array.from({ length: 51 }, (_, i) => ({
      level: 'INFO', source: 'android', message: `Event ${i}`
    }));
    const res = await request(app).post('/api/logs').send({ batch });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/logs', () => {
  let app;
  let mockDb;

  beforeEach(() => {
    mockLogger.log.mockClear();
    app = createApp();
  });

  test('returns 202 for valid log stats request', async () => {
    const res = await request(app).get('/api/logs/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 100, hardCap: 15000 });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/routes/logs.test.js --verbose`
Expected: FAIL

**Step 3: Write the implementation**

```javascript
// express-api/src/routes/logs.js
const router = require('express').Router();

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const VALID_SOURCES = ['express-api', 'android', 'ios', 'admin-panel', 'landing-page'];
const MAX_BATCH_SIZE = 50;

function createLogsRouter(logger) {
  // POST /api/logs — accept log entries from clients
  router.post('/logs', async (req, res) => {
    try {
      const entries = req.body.batch || [req.body];

      if (entries.length > MAX_BATCH_SIZE) {
        return res.status(400).json({ error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE}` });
      }

      for (const entry of entries) {
        if (!VALID_LEVELS.includes(entry.level)) {
          return res.status(400).json({ error: `Invalid level: ${entry.level}` });
        }
        if (!entry.source || !entry.message) {
          return res.status(400).json({ error: 'Missing required fields: source, message' });
        }
      }

      for (const entry of entries) {
        await logger.log({
          ...entry,
          userId: req.auth?.uid || entry.userId || null,
          requestTraceId: req.requestTraceId || null
        });
      }

      res.status(202).json({ accepted: entries.length });
    } catch (err) {
      console.error('POST /api/logs error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/logs/stats — quota widget data
  router.get('/logs/stats', (req, res) => {
    try {
      res.json(logger.getDailyStats());
    } catch (err) {
      console.error('GET /api/logs/stats error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createLogsRouter };
```

**Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/routes/logs.test.js --verbose`
Expected: All tests PASS

**Step 5: Mount route in index.js**

Add to `express-api/src/index.js` after other route mounts:

```javascript
const { createLogsRouter } = require('./routes/logs');
app.use('/api', createLogsRouter(logger));
```

**Step 6: Commit**

```bash
git add express-api/src/routes/logs.js express-api/tests/routes/logs.test.js express-api/src/index.js
git commit -m "feat: add POST /api/logs endpoint for client log ingestion"
```

---

## Task 4: Admin Log Query Endpoint

The admin panel needs to query, filter, and export logs.

**Files:**
- Create: `express-api/src/routes/admin-logs.js`
- Create: `express-api/tests/routes/admin-logs.test.js`
- Modify: `express-api/src/index.js` (mount route)

**Step 1: Write the failing tests**

```javascript
// express-api/tests/routes/admin-logs.test.js
const express = require('express');
const request = require('supertest');

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: (req, res) => {
    if (!req.auth?.isAdmin) { res.status(403).json({ error: 'Admin required' }); return true; }
    return false;
  }
}));

const { db } = require('../../src/utils/firebase');

jest.mock('../../src/utils/firebase', () => {
  const mockDocs = [
    { id: '1', data: () => ({ level: 'ERROR', source: 'express-api', message: 'Fail', timestamp: '2026-03-07T14:00:00Z', userId: 'u1', sessionTraceId: 's1' }) },
    { id: '2', data: () => ({ level: 'INFO', source: 'android', message: 'OK', timestamp: '2026-03-07T14:01:00Z', userId: 'u2', sessionTraceId: 's2' }) }
  ];
  const mockQuery = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    startAfter: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: mockDocs, empty: false })
  };
  return {
    db: {
      collection: jest.fn(() => mockQuery)
    }
  };
});

const adminLogsRouter = require('../../src/routes/admin-logs');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.auth = { uid: 'admin1', isAdmin: true }; next(); });
  app.use('/api', adminLogsRouter);
  return app;
}

describe('GET /api/admin/logs', () => {
  test('returns logs with default filters', async () => {
    const app = createApp();
    const res = await request(app).get('/api/admin/logs');
    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
  });

  test('rejects non-admin', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.auth = { uid: 'user1', isAdmin: false }; next(); });
    app.use('/api', adminLogsRouter);

    const res = await request(app).get('/api/admin/logs');
    expect(res.status).toBe(403);
  });
});
```

**Step 2: Run tests — FAIL**

**Step 3: Write the implementation**

```javascript
// express-api/src/routes/admin-logs.js
const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');

// GET /api/admin/logs — query logs with filters
router.get('/admin/logs', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const {
      level, source, userId, sessionTraceId, requestTraceId,
      route, keyword, startTime, endTime,
      limit: limitParam = '50', cursor
    } = req.query;

    const pageSize = Math.min(parseInt(limitParam, 10) || 50, 200);
    let query = db.collection('logs').orderBy('timestamp', 'desc');

    if (level) query = query.where('level', '==', level);
    if (source) query = query.where('source', '==', source);
    if (userId) query = query.where('userId', '==', userId);
    if (sessionTraceId) query = query.where('sessionTraceId', '==', sessionTraceId);
    if (requestTraceId) query = query.where('requestTraceId', '==', requestTraceId);
    if (startTime) query = query.where('timestamp', '>=', startTime);
    if (endTime) query = query.where('timestamp', '<=', endTime);

    if (cursor) query = query.startAfter(cursor);
    query = query.limit(pageSize + 1);

    const snapshot = await query.get();
    const logs = [];
    let nextCursor = null;

    snapshot.docs.forEach((doc, i) => {
      if (i < pageSize) {
        const data = doc.data();
        // Client-side filters for fields Firestore can't compound-query
        if (route && data.context?.route !== route) return;
        if (keyword && !data.message?.toLowerCase().includes(keyword.toLowerCase())) return;
        logs.push({ id: doc.id, ...data });
      } else {
        nextCursor = doc.data().timestamp;
      }
    });

    res.json({ logs, nextCursor });
  } catch (err) {
    console.error('GET /api/admin/logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/logs/trace/:traceId — get all logs for a session trace
router.get('/admin/logs/trace/:traceId', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const snapshot = await db.collection('logs')
      .where('sessionTraceId', '==', req.params.traceId)
      .orderBy('timestamp', 'asc')
      .limit(500)
      .get();

    const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ logs });
  } catch (err) {
    console.error('GET /api/admin/logs/trace error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

**Step 4: Run tests — PASS**

**Step 5: Mount in index.js**

```javascript
app.use('/api', require('./routes/admin-logs'));
```

**Step 6: Commit**

```bash
git add express-api/src/routes/admin-logs.js express-api/tests/routes/admin-logs.test.js express-api/src/index.js
git commit -m "feat: add admin log query endpoint with filters and trace view"
```

---

## Task 5: Log Config Endpoint

Admin-configurable log settings (retention, levels, exclusions, mobile batching).

**Files:**
- Create: `express-api/src/routes/admin-log-config.js`
- Create: `express-api/tests/routes/admin-log-config.test.js`
- Modify: `express-api/src/index.js`

**Step 1: Write tests**

Test GET (returns config doc), PATCH (updates config), GET /api/log-config (public — for mobile clients to read settings).

**Step 2: Write implementation**

```javascript
// express-api/src/routes/admin-log-config.js
const router = require('express').Router();
const { db } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');

const CONFIG_DOC = 'logConfig/settings';

const DEFAULT_CONFIG = {
  retentionHours: 48,
  levelPerSource: {
    'express-api': 'INFO',
    'android': 'INFO',
    'ios': 'INFO',
    'admin-panel': 'INFO',
    'landing-page': 'WARN'
  },
  excludedRoutes: [],
  hardCapDaily: 15000,
  batchSettings: { intervalSeconds: 30, wifiOnly: false }
};

// GET /api/log-config — public, for mobile clients
router.get('/log-config', async (req, res) => {
  try {
    const snap = await db.doc(CONFIG_DOC).get();
    res.json(snap.exists ? snap.data() : DEFAULT_CONFIG);
  } catch (err) {
    console.error('GET /api/log-config error:', err);
    res.json(DEFAULT_CONFIG);
  }
});

// GET /api/admin/log-config — admin view
router.get('/admin/log-config', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const snap = await db.doc(CONFIG_DOC).get();
    res.json(snap.exists ? snap.data() : DEFAULT_CONFIG);
  } catch (err) {
    console.error('GET /api/admin/log-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/log-config — update settings
router.patch('/admin/log-config', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;
    const allowed = ['retentionHours', 'levelPerSource', 'excludedRoutes', 'hardCapDaily', 'batchSettings'];
    const updates = {};
    for (const key of allowed) {
      if (key in req.body) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    await db.doc(CONFIG_DOC).set(updates, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/admin/log-config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

**Step 3: Run tests — PASS**

**Step 4: Mount and commit**

```bash
git commit -m "feat: add log config endpoints (admin + public)"
```

---

## Task 6: Log Rotation Cron (Firestore -> R2)

**Files:**
- Create: `express-api/src/cron/rotateLogs.js`
- Create: `express-api/tests/cron/rotateLogs.test.js`
- Modify: `express-api/src/cron/index.js` (schedule)

**Step 1: Write tests**

Test: queries logs older than retention, writes NDJSON to R2, deletes from Firestore, prunes R2 files older than 90 days.

**Step 2: Write implementation**

```javascript
// express-api/src/cron/rotateLogs.js
const { db } = require('../utils/firebase');
const r2 = require('../utils/r2');

async function rotateLogs() {
  // Read config
  const configSnap = await db.doc('logConfig/settings').get();
  const retentionHours = configSnap.exists ? (configSnap.data().retentionHours || 48) : 48;

  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString();
  const snapshot = await db.collection('logs')
    .where('timestamp', '<', cutoff)
    .orderBy('timestamp')
    .limit(500)
    .get();

  if (snapshot.empty) return;

  // Build NDJSON
  const lines = snapshot.docs.map(doc => JSON.stringify({ id: doc.id, ...doc.data() }));
  const ndjson = lines.join('\n') + '\n';

  // Write to R2
  const now = new Date();
  const key = `logs/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCHours()).padStart(2, '0')}-${Date.now()}.ndjson`;
  await r2.putObject(key, Buffer.from(ndjson), 'application/x-ndjson');

  // Delete from Firestore (batch delete, 500 max per batch)
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  console.log(`[CRON] rotateLogs: archived ${snapshot.docs.length} logs to ${key}`);

  // Prune R2 logs older than 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const allKeys = await r2.listObjects('logs/');
  for (const objKey of allKeys) {
    // Parse date from key: logs/YYYY/MM/DD/...
    const parts = objKey.split('/');
    if (parts.length >= 4) {
      const dateStr = `${parts[1]}-${parts[2]}-${parts[3]}`;
      const logDate = new Date(dateStr + 'T00:00:00Z');
      if (!isNaN(logDate.getTime()) && logDate < ninetyDaysAgo) {
        await r2.deleteObject(objKey);
      }
    }
  }
}

module.exports = rotateLogs;
```

**Step 3: Add to cron schedule in `express-api/src/cron/index.js`:**

```javascript
const rotateLogs = require('./rotateLogs');

// Inside startCronJobs():
// Rotate logs from Firestore to R2 — every hour
cron.schedule('0 * * * *', () => {
  console.log('[CRON] rotateLogs');
  rotateLogs().catch(err => console.error('[CRON] rotateLogs error:', err));
});
```

**Step 4: Test and commit**

```bash
git commit -m "feat: add log rotation cron (Firestore -> R2, 90-day retention)"
```

---

## Task 7: Device Info Endpoint & Enrichment

**Files:**
- Create: `express-api/src/routes/device-info.js`
- Create: `express-api/tests/routes/device-info.test.js`
- Modify: `express-api/src/index.js`

**Step 1: Write tests**

Test: accepts device info, enriches with IP geolocation, stores in Firestore `deviceBindings/{deviceId}`, returns ban status.

**Step 2: Write implementation**

```javascript
// express-api/src/routes/device-info.js
const router = require('express').Router();
const { db } = require('../utils/firebase');

async function enrichWithGeo(ip) {
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=isp,as,country,regionName`);
    if (!res.ok) return {};
    const data = await res.json();
    return {
      isp: data.isp || null,
      asn: data.as ? data.as.split(' ')[0] : null,
      country: data.country || null,
      region: data.regionName || null
    };
  } catch {
    return {};
  }
}

router.post('/device-info', async (req, res) => {
  try {
    const userId = req.auth.uid;
    const {
      deviceId, manufacturer, model, osVersion,
      screenResolution, screenDensity, totalRamMb,
      appVersion, buildNumber, locale, networkType,
      carrierName, firebaseInstallationId
    } = req.body;

    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const geo = await enrichWithGeo(ip);

    const now = new Date().toISOString();
    const docRef = db.doc(`deviceBindings/${deviceId}`);
    const existing = await docRef.get();

    const deviceDoc = {
      deviceId,
      userId,
      manufacturer: manufacturer || null,
      model: model || null,
      osVersion: osVersion || null,
      screenResolution: screenResolution || null,
      screenDensity: screenDensity || null,
      totalRamMb: totalRamMb || null,
      appVersion: appVersion || null,
      buildNumber: buildNumber || null,
      locale: locale || null,
      networkType: networkType || null,
      carrierName: carrierName || null,
      lastIp: ip,
      isp: geo.isp || null,
      asn: geo.asn || null,
      country: geo.country || null,
      region: geo.region || null,
      firebaseInstallationId: firebaseInstallationId || null,
      lastSeen: now,
      ...(existing.exists ? {} : { firstSeen: now, boundAt: now })
    };

    await docRef.set(deviceDoc, { merge: true });

    // Check bans
    const [deviceBan, networkBans] = await Promise.all([
      db.doc(`deviceBans/${deviceId}`).get(),
      checkNetworkBans(db, ip, geo.asn)
    ]);

    const banStatus = {
      isBanned: false,
      banType: null,
      reason: null,
      expiresAt: null
    };

    if (deviceBan.exists) {
      const ban = deviceBan.data();
      if (!ban.expiresAt || new Date(ban.expiresAt) > new Date()) {
        banStatus.isBanned = true;
        banStatus.banType = 'device';
        banStatus.reason = ban.reason;
        banStatus.expiresAt = ban.expiresAt;
      }
    }

    if (!banStatus.isBanned && networkBans) {
      banStatus.isBanned = true;
      banStatus.banType = 'network';
      banStatus.reason = networkBans.reason;
      banStatus.expiresAt = networkBans.expiresAt;
    }

    res.json({ success: true, banStatus });
  } catch (err) {
    console.error('POST /api/device-info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function checkNetworkBans(db, ip, asn) {
  const snapshot = await db.collection('networkBans').get();
  for (const doc of snapshot.docs) {
    const ban = doc.data();
    if (ban.expiresAt && new Date(ban.expiresAt) <= new Date()) continue;

    if (ban.type === 'ip' && ban.value === ip) return ban;
    if (ban.type === 'subnet' && isIpInSubnet(ip, ban.value)) return ban;
    if (ban.type === 'asn' && ban.value === asn) return ban;
  }
  return null;
}

function isIpInSubnet(ip, cidr) {
  try {
    const [subnet, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    const subNum = subnet.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0);
    return (ipNum & mask) === (subNum & mask);
  } catch {
    return false;
  }
}

module.exports = router;
```

**Step 3: Mount and commit**

```bash
git commit -m "feat: add device info endpoint with IP enrichment and ban checking"
```

---

## Task 8: Banning System (CRUD + Auto-apply)

**Files:**
- Create: `express-api/src/routes/admin-bans.js`
- Create: `express-api/tests/routes/admin-bans.test.js`
- Create: `express-api/src/cron/expireBans.js`
- Modify: `express-api/src/routes/admin-users.js` (auto-ban on suspend)
- Modify: `express-api/src/cron/index.js`

**Step 1: Write tests** for ban CRUD, auto-apply on suspension, auto-expiry.

**Step 2: Write implementation**

`admin-bans.js` endpoints:
- `GET /api/admin/bans` — list all active bans (device + network)
- `POST /api/admin/bans/device` — ban a device (deviceId, reason, duration)
- `POST /api/admin/bans/network` — ban network (type, value, reason, duration)
- `DELETE /api/admin/bans/device/:deviceId` — unban device
- `DELETE /api/admin/bans/network/:banId` — unban network
- `POST /api/admin/bans/unban-all/:userId` — remove all bans linked to user
- `GET /api/admin/bans/user/:userId` — get all bans for a user (active + history)

`expireBans.js` cron:
- Runs hourly, queries `deviceBans` and `networkBans` where `expiresAt < now`
- Deletes expired bans
- Sends FCM notification to configured admin users
- Logs expiry events

`admin-users.js` modification:
- In the suspend-user handler, after setting `isSuspended=true`:
  - Query `deviceBindings` where `userId == uid` → create `deviceBan` for each
  - Get user's `lastIp` from most recent device binding → create `networkBan` (type: ip)
  - Log auto-ban actions

**Step 3: Commit**

```bash
git commit -m "feat: add device/network banning system with auto-apply and auto-expiry"
```

---

## Task 9: Alerting System

**Files:**
- Create: `express-api/src/utils/alertManager.js`
- Create: `express-api/tests/utils/alertManager.test.js`
- Create: `express-api/src/routes/admin-alerts.js`
- Create: `express-api/src/cron/serverHealth.js`
- Modify: `express-api/src/utils/logger.js` (integrate alert triggers)
- Modify: `express-api/src/cron/index.js`

**Step 1: Write tests** for alert creation, error spike detection, FCM dispatch, acknowledge/resolve.

**Step 2: Write implementation**

`alertManager.js`:
- `createAlert(type, severity, title, message, context)` — writes to `alerts` collection, sends FCM
- `trackError(route)` — tracks errors in rolling window, fires alert on spike
- `trackSlowEndpoint(route, durationMs)` — fires alert if repeated slow responses
- Config loaded from `alertConfig/settings` (cached, refreshed every 60s)

`admin-alerts.js` endpoints:
- `GET /api/admin/alerts` — list alerts with filters (type, severity, status)
- `PATCH /api/admin/alerts/:alertId` — acknowledge or resolve
- `GET /api/admin/alert-config` — get thresholds
- `PATCH /api/admin/alert-config` — update thresholds

`serverHealth.js` cron (every 5 min):
- Check `process.memoryUsage()` vs configured threshold
- Check PM2 restart count via `pm2 jlist` child process
- Fire alerts if thresholds exceeded

Integration in `logger.js`:
- After writing ERROR/FATAL log → call `alertManager.trackError()`
- After writing FATAL → call `alertManager.createAlert('crash', 'critical', ...)`

Integration in `requestLogger.js`:
- After logging slow endpoint → call `alertManager.trackSlowEndpoint()`

**Step 3: Commit**

```bash
git commit -m "feat: add alerting system with error spike detection and server health monitoring"
```

---

## Task 10: Full Database Backup Cron

**Files:**
- Modify: `express-api/src/cron/backups.js` (expand to all collections)
- Create: `express-api/tests/cron/backups.test.js`
- Modify: `express-api/src/routes/admin-backup.js` (add collection restore, full restore)

**Step 1: Write tests** for backing up all collections + subcollections, manifest generation, restore modes.

**Step 2: Modify `backups.js`**

- Change from single `users` backup to iterating over all collections list
- For subcollections (`rooms/{id}/messages`, etc.): iterate parent docs, query subcollection, aggregate
- Write each collection as separate JSON file under `backups/full/YYYY-MM-DD/`
- Write `manifest.json` with doc counts, total size, timestamp
- Keep 7-day retention for full backups

**Step 3: Modify `admin-backup.js`**

- `GET /api/admin/backups` — list full backup dates (read R2 `backups/full/` prefixes)
- `POST /api/admin/backups/trigger` — trigger manual full backup
- `GET /api/admin/backups/:date` — download a specific collection's backup
- `POST /api/admin/backups/restore/:date` — with `mode` param: `full`, `collection`, `missing-only`
- Auto-backup before restore

**Step 4: Commit**

```bash
git commit -m "feat: expand backup cron to all collections with manifest and full restore"
```

---

## Task 11: Webpage Logger Library (`public/js/logger.js`)

**Files:**
- Create: `public/js/logger.js`
- Modify: `public/admin/index.html` (add script tag + init)
- Modify: `public/index.html` (add script tag + init)

**Step 1: Write implementation**

```javascript
// public/js/logger.js
(function() {
  'use strict';

  const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

  const ShyTalkLogger = {
    _config: { source: 'unknown', endpoint: '/api/logs' },
    _sessionTraceId: null,
    _getToken: null,

    init(config) {
      this._config = { ...this._config, ...config };
      this._sessionTraceId = this._generateUUID();
      sessionStorage.setItem('sessionTraceId', this._sessionTraceId);
      this._getToken = config.getToken || (() => Promise.resolve(null));
      this._setupErrorHandlers();
      this._setupFetchInterceptor();
      this._setupClickTracking();
      this._logPerformance();
      this.info('Page loaded', { url: location.href });
    },

    _generateUUID() {
      return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    },

    async _send(entry) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        const token = await this._getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        headers['x-session-trace-id'] = this._sessionTraceId;

        fetch(this._config.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...entry,
            source: this._config.source,
            sessionTraceId: this._sessionTraceId,
            platform: 'web',
            appVersion: this._config.appVersion || null
          })
        }).catch(() => {}); // Fire and forget
      } catch {} // Never throw
    },

    debug(message, context) { this._send({ level: 'DEBUG', message, context }); },
    info(message, context) { this._send({ level: 'INFO', message, context }); },
    warn(message, context) { this._send({ level: 'WARN', message, context }); },
    error(message, context) { this._send({ level: 'ERROR', message, context }); },
    fatal(message, context) { this._send({ level: 'FATAL', message, context }); },

    _setupErrorHandlers() {
      window.addEventListener('error', (e) => {
        this.error('Uncaught error', {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          stack: e.error?.stack
        });
      });
      window.addEventListener('unhandledrejection', (e) => {
        this.error('Unhandled promise rejection', {
          reason: String(e.reason),
          stack: e.reason?.stack
        });
      });
    },

    _setupFetchInterceptor() {
      const originalFetch = window.fetch;
      const self = this;
      window.fetch = async function(url, options = {}) {
        const start = performance.now();
        options.headers = options.headers || {};
        if (typeof options.headers.set === 'function') {
          options.headers.set('x-session-trace-id', self._sessionTraceId);
        } else {
          options.headers['x-session-trace-id'] = self._sessionTraceId;
        }

        try {
          const response = await originalFetch.call(this, url, options);
          const durationMs = Math.round(performance.now() - start);
          // Don't log calls to the log endpoint itself
          const urlStr = typeof url === 'string' ? url : url.toString();
          if (!urlStr.includes('/api/logs')) {
            self.info('Fetch completed', {
              url: urlStr,
              method: options.method || 'GET',
              status: response.status,
              durationMs
            });
          }
          return response;
        } catch (err) {
          const durationMs = Math.round(performance.now() - start);
          const urlStr = typeof url === 'string' ? url : url.toString();
          if (!urlStr.includes('/api/logs')) {
            self.error('Fetch failed', {
              url: urlStr,
              method: options.method || 'GET',
              error: err.message,
              durationMs
            });
          }
          throw err;
        }
      };
    },

    _setupClickTracking() {
      document.addEventListener('click', (e) => {
        const el = e.target.closest('[data-log]');
        if (el) {
          this.info(`User clicked: ${el.dataset.log}`, {
            element: el.tagName,
            text: el.textContent?.slice(0, 50)
          });
        }
      });
    },

    _logPerformance() {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const nav = performance.getEntriesByType('navigation')[0];
          if (nav) {
            this.info('Page performance', {
              domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
              loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
              ttfb: Math.round(nav.responseStart - nav.startTime)
            });
          }
        }, 0);
      });
    }
  };

  window.ShyTalkLogger = ShyTalkLogger;
})();
```

**Step 2: Add to admin panel** — at end of `<head>` in `public/admin/index.html`:

```html
<script src="/js/logger.js"></script>
```

In the JS init section (after Firebase auth is ready):

```javascript
ShyTalkLogger.init({
  source: 'admin-panel',
  endpoint: `${API_BASE}/api/logs`,
  getToken: () => currentUser?.getIdToken()
});
```

**Step 3: Add to landing page** — same pattern for `public/index.html`

**Step 4: Add `data-log` attributes** to key admin panel buttons

**Step 5: Commit**

```bash
git commit -m "feat: add webpage logging library with error/fetch/click/performance tracking"
```

---

## Task 12: Admin Panel — Logs Tab

**Files:**
- Modify: `public/admin/index.html` (add Logs tab HTML + CSS + JS)

**Step 1: Add tab navigation** — add "Logs" tab to existing tab bar

**Step 2: Build the Logs tab HTML**

Sections:
1. **Alerts panel** (collapsible) — unresolved alerts table
2. **Quota widget** — writes used / hard cap
3. **Filters bar** — dropdowns for level, source + text inputs for userId, traceId, keyword, route + date pickers + Search button + Live toggle
4. **Log table** — sortable columns (timestamp, level, source, user, message, traceId), click to expand
5. **Trace view** — waterfall timeline (hidden by default, shown when clicking traceId)
6. **Export buttons** — JSON, CSV
7. **Log settings panel** (collapsible) — retention, levels per source, excluded routes, hard cap, batch settings
8. **Pagination** — prev/next with cursor

**Step 3: Build the JS**

- `loadLogs(filters)` — calls `GET /api/admin/logs` with query params
- `loadTrace(sessionTraceId)` — calls `GET /api/admin/logs/trace/:traceId`, renders timeline
- `startLiveMode()` — Firestore `onSnapshot` listener on `logs` collection with filter query
- `stopLiveMode()` — unsubscribe listener
- `exportLogs(format)` — download current filtered results as JSON or CSV
- `loadAlerts()` — calls `GET /api/admin/alerts`
- `acknowledgeAlert(id)` / `resolveAlert(id)` — PATCH calls
- `loadLogConfig()` / `saveLogConfig()` — GET/PATCH calls
- `loadQuotaStats()` — calls `GET /api/logs/stats`

**Step 4: Add alert bell** to admin panel header (next to user info), shows unresolved count badge

**Step 5: Commit**

```bash
git commit -m "feat: add Logs tab to admin panel with filters, trace view, live mode, and alerts"
```

---

## Task 13: Admin Panel — Device Bindings Tab

**Files:**
- Create: `express-api/src/routes/admin-devices.js`
- Modify: `public/admin/index.html` (add Device Bindings tab)
- Modify: `express-api/src/index.js`

**Step 1: Write API endpoints**

```javascript
// express-api/src/routes/admin-devices.js
// GET /api/admin/devices — list all device bindings (paginated, searchable)
// GET /api/admin/devices/:deviceId — get single device binding
// DELETE /api/admin/devices/:deviceId — unbind device
// GET /api/admin/devices/user/:userId — get all devices for a user
```

**Step 2: Build admin panel tab**

- Searchable table: search by deviceId, userId, manufacturer, model, IP, ISP
- Columns: Device ID, User, Model, OS, Last IP, ISP/ASN, Country, Last Seen, Status
- Row expand: full device details
- Actions: Unbind, Ban Device, Ban Network, View Log History

**Step 3: Enhance Users tab**

- Add "Devices" section to user detail view
- Add "Bans & Restrictions" panel with:
  - Account status, device bans, network bans, ban history
  - Quick actions: Suspend, Ban Device, Ban Network, Unban All, View Logs

**Step 4: Commit**

```bash
git commit -m "feat: add Device Bindings tab and enhance Users tab with bans panel"
```

---

## Task 14: KMP TraceManager & Logger Upgrade

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/Logger.kt`
- Modify: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/Logger.android.kt`
- Modify: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/Logger.ios.kt`
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/TraceManager.kt`
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/remote/LogService.kt`
- Create: `app/src/test/java/com/shyden/shytalk/core/util/TraceManagerTest.kt`
- Create: `app/src/test/java/com/shyden/shytalk/core/util/LoggerTest.kt`

**Step 1: Write tests**

```kotlin
// TraceManagerTest.kt
@Test
fun `generates non-empty sessionTraceId`() {
    val traceId = TraceManager.sessionTraceId
    assertNotNull(traceId)
    assertTrue(traceId.isNotEmpty())
}

@Test
fun `returns same traceId within session`() {
    val id1 = TraceManager.sessionTraceId
    val id2 = TraceManager.sessionTraceId
    assertEquals(id1, id2)
}
```

**Step 2: Implement TraceManager**

```kotlin
// shared/src/commonMain/kotlin/.../core/util/TraceManager.kt
package com.shyden.shytalk.core.util

import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

object TraceManager {
    @OptIn(ExperimentalUuidApi::class)
    val sessionTraceId: String = Uuid.random().toString()
}
```

**Step 3: Expand Logger.kt** to include `logI` (INFO) and `logF` (FATAL), plus a `LogShipper` interface for sending to server.

```kotlin
// Logger.kt
package com.shyden.shytalk.core.util

enum class LogLevel { DEBUG, INFO, WARN, ERROR, FATAL }

expect fun logD(tag: String, message: String)
expect fun logI(tag: String, message: String)
expect fun logW(tag: String, message: String, throwable: Throwable? = null)
expect fun logE(tag: String, message: String, throwable: Throwable? = null)
expect fun logF(tag: String, message: String, throwable: Throwable? = null)
```

**Step 4: Update platform actuals** to implement `logI` and `logF`

**Step 5: Implement LogService** — HTTP client that batches and ships logs to `POST /api/logs`

```kotlin
// shared/src/commonMain/kotlin/.../data/remote/LogService.kt
package com.shyden.shytalk.data.remote

interface LogService {
    suspend fun shipLogs(entries: List<LogEntry>)
    suspend fun sendDeviceInfo(info: DeviceInfo)
    suspend fun fetchLogConfig(): LogConfig
}

data class LogEntry(
    val level: String,
    val source: String,
    val message: String,
    val sessionTraceId: String,
    val userId: String?,
    val deviceId: String?,
    val context: Map<String, Any?> = emptyMap(),
    val appVersion: String? = null,
    val platform: String? = null,
    val osVersion: String? = null
)

data class LogConfig(
    val levelPerSource: Map<String, String> = emptyMap(),
    val batchSettings: BatchSettings = BatchSettings()
)

data class BatchSettings(
    val intervalSeconds: Int = 30,
    val wifiOnly: Boolean = false
)
```

**Step 6: Commit**

```bash
git commit -m "feat: add TraceManager, expand Logger with all levels, add LogService interface"
```

---

## Task 15: KMP DeviceInfoCollector (expect/actual)

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/DeviceInfoCollector.kt`
- Create: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/DeviceInfoCollector.android.kt`
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/DeviceInfoCollector.ios.kt`
- Create: `app/src/test/java/com/shyden/shytalk/core/util/DeviceInfoCollectorTest.kt`

**Step 1: Write expect declaration**

```kotlin
// commonMain/.../DeviceInfoCollector.kt
package com.shyden.shytalk.core.util

data class DeviceInfo(
    val deviceId: String,
    val manufacturer: String?,
    val model: String?,
    val osVersion: String?,
    val screenResolution: String?,
    val screenDensity: Float?,
    val totalRamMb: Long?,
    val appVersion: String?,
    val buildNumber: Int?,
    val locale: String?,
    val networkType: String?,
    val carrierName: String?,
    val firebaseInstallationId: String?
)

expect class DeviceInfoCollector {
    fun collect(): DeviceInfo
}
```

**Step 2: Android actual** — uses `Build`, `DisplayMetrics`, `ActivityManager`, `ConnectivityManager`, `TelephonyManager`

**Step 3: iOS actual** — uses `UIDevice`, `ProcessInfo`, `UIScreen`

**Step 4: Tests** (MockK for Android platform APIs)

**Step 5: Commit**

```bash
git commit -m "feat: add DeviceInfoCollector expect/actual for device info gathering"
```

---

## Task 16: Ktor Trace ID Interceptor

**Files:**
- Modify: `app/src/main/java/com/shyden/shytalk/data/remote/WorkerApiClient.kt` (add trace header)
- Create: `app/src/test/java/com/shyden/shytalk/data/remote/WorkerApiClientTraceTest.kt`

**Step 1: Write test** — verify `x-session-trace-id` header is attached to every request

**Step 2: Modify WorkerApiClient**

In the request builder methods (`get`, `post`, `patch`, `delete`), add:

```kotlin
.header("x-session-trace-id", TraceManager.sessionTraceId)
```

**Step 3: Commit**

```bash
git commit -m "feat: attach sessionTraceId header to all API requests"
```

---

## Task 17: Ban Screen in Android App

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/AuthViewModel.kt` (add ban state)
- Modify: existing suspension screen (adapt for device/network ban types)
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt` (wire new services)
- Create: `app/src/test/java/com/shyden/shytalk/feature/auth/AuthViewModelBanTest.kt`

**Step 1: Add ban states to AuthUiState**

```kotlin
data class AuthUiState(
    // ... existing fields ...
    val isDeviceBanned: Boolean = false,
    val isNetworkBanned: Boolean = false,
    val banReason: String? = null,
    val banExpiresAt: String? = null
)
```

**Step 2: After device info POST**, check `banStatus` in response and update UI state

**Step 3: In the navigation/screen logic**, show appropriate ban screen:
- Reuse suspension screen composable with dynamic title/message based on ban type

**Step 4: Write tests** — verify correct UI state for device ban, network ban, no ban

**Step 5: Commit**

```bash
git commit -m "feat: add device/network ban screen reusing suspension UI"
```

---

## Task 18: Add Logging Throughout Android App

**Files:**
- Modify various ViewModels and repositories to add `logI`/`logE`/`logW` calls

**Step 1: Add logging to auth flows** (`AuthViewModel`, `AuthRepositoryImpl`)

**Step 2: Add logging to room operations** (`RoomViewModel`, `RoomRepositoryImpl`)

**Step 3: Add logging to messaging** (`PrivateChatViewModel`, `ConversationListViewModel`)

**Step 4: Add logging to profile operations** (`ProfileViewModel`)

**Step 5: Add logging to voice** (`LiveKitVoiceService`)

**Step 6: Add logging to storage** (`StorageRepositoryImpl`)

**Step 7: Add logging to gifts/economy** (`GiftingViewModel`, `GachaViewModel`)

**Step 8: Commit**

```bash
git commit -m "feat: add structured logging throughout Android app"
```

---

## Task 19: Firestore Security Rules

**Files:**
- Modify: `firestore.rules`

**Step 1: Add rules for new collections**

```javascript
// Logs — only server writes, admin reads
match /logs/{logId} {
  allow read: if request.auth.token.admin == true;
  allow write: if false;
}

// Log config — admin only
match /logConfig/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}

// Device bans — server only
match /deviceBans/{deviceId} {
  allow read: if request.auth.token.admin == true;
  allow write: if false;
}

// Network bans — server only
match /networkBans/{banId} {
  allow read: if request.auth.token.admin == true;
  allow write: if false;
}

// Alerts — server writes, admin reads/updates
match /alerts/{alertId} {
  allow read: if request.auth.token.admin == true;
  allow write: if false;
}

// Alert config — admin only
match /alertConfig/{docId} {
  allow read: if request.auth.token.admin == true;
  allow write: if false;
}

// Log stats
match /logStats/{docId} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

**Step 2: Deploy rules**

Run: `npx firebase deploy --only firestore:rules`

**Step 3: Commit**

```bash
git commit -m "feat: add Firestore security rules for logging and banning collections"
```

---

## Task 20: Install Dependencies & Setup

**Files:**
- Modify: `express-api/package.json` (add jest, supertest as devDependencies)

**Step 1: Install test dependencies**

```bash
cd express-api && npm install --save-dev jest supertest
```

**Step 2: Add test script to package.json**

```json
"scripts": {
  "test": "jest --verbose",
  "test:watch": "jest --watch"
}
```

**Step 3: Commit**

```bash
git commit -m "chore: add jest and supertest for Express API testing"
```

> **Note:** This task should be done FIRST before running any Express tests.

---

## Task 21: Documentation — README.md

**Files:**
- Modify: `README.md`
- Create: `LICENSE`
- Create: `CONTRIBUTING.md`

**Step 1: Write Apache 2.0 LICENSE file**

**Step 2: Rewrite README.md**

Sections:
1. Project name + badges (license, build status)
2. Description — open-source social chat app with voice rooms
3. Features list
4. Architecture overview (KMP + Express + Firebase + LiveKit)
5. Prerequisites — accounts: Firebase (Spark), LiveKit Cloud (free), Cloudflare (free), Oracle Cloud (free tier)
6. Environment variables table (all env vars with descriptions)
7. Getting Started — clone, setup Express API, setup Android app
8. Running tests
9. Deployment — Express API to Oracle Cloud, Android to Google Play
10. Contributing — link to CONTRIBUTING.md
11. License — Apache 2.0

**Step 3: Write CONTRIBUTING.md** — fork, branch naming, commit style, PR process, test requirements

**Step 4: Commit**

```bash
git commit -m "docs: rewrite README as open-source guide, add LICENSE and CONTRIBUTING"
```

---

## Task 22: Legal Pages Update

**Files:**
- Modify: `public/cyber-bullying.html` (or create privacy/terms pages if they don't exist)
- May need to create: `public/privacy.html`, `public/terms.html`

**Step 1: Update privacy policy** — add sections for:
- Device information collected (manufacturer, model, OS, RAM, screen)
- Network information (IP, ISP, ASN, geolocation)
- Usage logs (app actions, page views, errors)
- Data retention (Firestore: configurable, R2: 90 days)
- Device/network banning

**Step 2: Update terms of service** — add sections for:
- Device and network banning
- Multi-account policy
- Data collection consent

**Step 3: Commit**

```bash
git commit -m "docs: update privacy policy and terms for logging and device management"
```

---

## Task 23: Run All Tests & Fix Bugs

**Step 1: Run Express API tests**

```bash
cd express-api && npm test
```

Fix any failures.

**Step 2: Run Android/KMP tests**

```bash
./gradlew test
```

Fix any failures.

**Step 3: Run E2E tests if available**

```bash
./gradlew connectedDebugAndroidTest
```

Fix any failures.

**Step 4: Commit fixes**

```bash
git commit -m "fix: resolve test failures from logging and monitoring integration"
```

---

## Task 24: Final Integration Test & Commit

**Step 1: Manual smoke test checklist**

- [ ] Express API starts without errors
- [ ] `POST /api/logs` accepts a log entry
- [ ] `POST /api/device-info` enriches and stores device data
- [ ] Admin panel Logs tab loads and filters work
- [ ] Live mode streams new logs
- [ ] Trace view shows session timeline
- [ ] Device Bindings tab lists devices
- [ ] Ban/unban works from admin panel
- [ ] Alert bell shows unresolved alerts
- [ ] Webpage logger captures errors and fetch calls
- [ ] Log rotation cron runs and archives to R2
- [ ] Full backup cron exports all collections

**Step 2: Deploy Firestore rules**

```bash
npx firebase deploy --only firestore:rules
```

**Step 3: Final commit**

```bash
git commit -m "feat: complete logging, monitoring, and device management system"
```

---

## Execution Order

> **Critical dependency:** Task 20 (install jest/supertest) must run before any Express tests.

```
Task 20 (dependencies)
  -> Task 1 (logger utility)
    -> Task 2 (request logger middleware)
    -> Task 3 (log ingestion endpoint)
    -> Task 9 (alerting - depends on logger)
  -> Task 4 (admin log query)
  -> Task 5 (log config)
  -> Task 6 (log rotation cron)
  -> Task 7 (device info endpoint)
    -> Task 8 (banning system)
  -> Task 10 (full database backup)
  -> Task 11 (webpage logger)
  -> Task 12 (admin Logs tab - depends on tasks 3-5, 9)
  -> Task 13 (admin Device Bindings tab - depends on 7-8)
  -> Task 14 (KMP TraceManager + Logger)
    -> Task 15 (DeviceInfoCollector)
    -> Task 16 (Ktor trace interceptor)
    -> Task 17 (ban screen)
    -> Task 18 (add logging throughout app)
  -> Task 19 (Firestore rules)
  -> Task 21 (README)
  -> Task 22 (legal pages)
  -> Task 23 (run all tests)
  -> Task 24 (integration test)
```

Tasks at the same indent level can run in parallel if using subagent-driven development.

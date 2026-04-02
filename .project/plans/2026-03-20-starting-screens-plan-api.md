# Starting Screens — API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image compression utility, starting screens config endpoints (GET/PUT), auth middleware exemption, and contract tests to the Express API.

**Architecture:** New `utils/imageCompressor.js` for all image uploads. Dedicated `GET/PUT /api/config/startingScreens` routes in `config.js` (registered BEFORE generic `:key` routes). Content hash (SHA-256) per screen. Allowlist checking via `X-Device-Id` header and request IP. Auth middleware exemption for the GET endpoint.

**Tech Stack:** Express.js, sharp (image compression), crypto (SHA-256), Firestore, Jest + Supertest

**Spec:** `.project/plans/2026-03-20-starting-screens-design.md`

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `express-api/package.json` | Modify | Add `sharp` dependency (pinned, `--save-exact`) |
| `express-api/src/utils/imageCompressor.js` | Create | Image compression utility (sharp-based) |
| `express-api/src/routes/storage.js` | Modify | Integrate compression, add HEIC/HEIF to ALLOWED_MIME_TYPES, add `starting-screens` to ALLOWED_UPLOAD_PATHS, add `originalSize`/`compressedSize` to response |
| `express-api/src/routes/config.js` | Modify | Add dedicated GET/PUT startingScreens routes BEFORE generic `:key` routes, add `router.all` 405 catch-all |
| `express-api/src/index.js` | Modify | Add `/config/startingScreens` to auth middleware exemption |
| `express-api/tests/utils/imageCompressor.test.js` | Create | Image compression tests |
| `express-api/tests/routes/starting-screens.test.js` | Create | Starting screens GET/PUT tests (separate file from config.test.js for clarity) |
| `express-api/tests/contracts/starting-screens-contract.test.js` | Create | Frozen response shape contract tests |

---

## Chunk 1: Image Compression

### Task 1: Install sharp and create image compressor utility

**Files:**
- Modify: `express-api/package.json`
- Create: `express-api/src/utils/imageCompressor.js`
- Create: `express-api/tests/utils/imageCompressor.test.js`

- [ ] **Step 1: Install sharp**

```bash
cd express-api && npm install sharp@0.34.2 --save-exact
```

Verify `package.json` has `"sharp": "0.34.2"` (no `^`).

- [ ] **Step 2: Write failing tests for image compressor**

Create `express-api/tests/utils/imageCompressor.test.js`:

```javascript
// Mock log to prevent real logger side effects (consistent with all other test files)
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { compressImage } = require('../../src/utils/imageCompressor');

describe('imageCompressor', () => {
  test('compresses JPEG — output smaller than input', async () => {
    // Create a minimal valid JPEG buffer using sharp
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await compressImage(input, 'image/jpeg');

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeLessThan(input.length);
    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(result.buffer.length);
    expect(result.mimeType).toBe('image/jpeg');
  });

  test('compresses PNG losslessly — output smaller or equal', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer();

    const result = await compressImage(input, 'image/png');

    expect(result.buffer.length).toBeLessThanOrEqual(input.length);
    expect(result.mimeType).toBe('image/png');
  });

  test('compresses WebP', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } } })
      .webp({ quality: 100 })
      .toBuffer();

    const result = await compressImage(input, 'image/webp');

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.mimeType).toBe('image/webp');
  });

  test('passes through GIF unchanged', async () => {
    const gifBuffer = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;');

    const result = await compressImage(gifBuffer, 'image/gif');

    expect(result.buffer).toEqual(gifBuffer);
    expect(result.mimeType).toBe('image/gif');
  });

  test('preserves PNG transparency', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer();

    const result = await compressImage(input, 'image/png');
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.channels).toBe(4); // Alpha preserved
  });

  test('preserves original dimensions', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 300, height: 500, channels: 3, background: { r: 100, g: 100, b: 100 } } })
      .jpeg()
      .toBuffer();

    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(500);
  });

  test('strips EXIF metadata from JPEG', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'Test' } } })
      .toBuffer();

    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();

    expect(metadata.exif).toBeUndefined();
  });

  test('rejects corrupted image buffer', async () => {
    await expect(compressImage(Buffer.from('not an image'), 'image/jpeg'))
      .rejects.toThrow();
  });

  test('rejects empty buffer', async () => {
    await expect(compressImage(Buffer.alloc(0), 'image/jpeg'))
      .rejects.toThrow();
  });

  test('rejects SVG (XSS risk)', async () => {
    const svgBuffer = Buffer.from('<svg><script>alert(1)</script></svg>');

    await expect(compressImage(svgBuffer, 'image/svg+xml'))
      .rejects.toThrow(/SVG.*not supported/i);
  });

  test('rejects image exceeding 4096x4096', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 4097, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .jpeg()
      .toBuffer();

    await expect(compressImage(input, 'image/jpeg'))
      .rejects.toThrow(/dimensions/i);
  });

  test('rejects image smaller than 100x100', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 99, height: 99, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .jpeg()
      .toBuffer();

    await expect(compressImage(input, 'image/jpeg'))
      .rejects.toThrow(/dimensions/i);
  });

  test('returns originalSize and compressedSize', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await compressImage(input, 'image/jpeg');

    expect(result.originalSize).toBe(input.length);
    expect(result.compressedSize).toBe(result.buffer.length);
    expect(typeof result.originalSize).toBe('number');
    expect(typeof result.compressedSize).toBe('number');
  });

  test('compression is idempotent — already compressed image not degraded', async () => {
    const sharp = require('sharp');
    const input = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 50, b: 50 } } })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();

    const result = await compressImage(input, 'image/jpeg');

    // Output should not be significantly larger than input
    expect(result.buffer.length).toBeLessThanOrEqual(input.length * 1.1);
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
cd express-api && npx jest tests/utils/imageCompressor.test.js --verbose
```

Expected: FAIL — `Cannot find module '../../src/utils/imageCompressor'`

- [ ] **Step 4: Implement imageCompressor.js**

Create `express-api/src/utils/imageCompressor.js`:

```javascript
/**
 * Image compression utility using sharp.
 *
 * Compresses images before R2 storage. Lossless/near-lossless by format.
 * Strips EXIF metadata, auto-rotates, preserves dimensions and transparency.
 */

const sharp = require('sharp');
const log = require('./log');

const MAX_DIMENSION = 4096;
const MIN_DIMENSION = 100;
const COMPRESSION_TIMEOUT_MS = 10000;

/**
 * Compress an image buffer.
 * @param {Buffer} buffer — raw image bytes
 * @param {string} mimeType — e.g. 'image/jpeg'
 * @returns {{ buffer: Buffer, mimeType: string, originalSize: number, compressedSize: number }}
 */
async function compressImage(buffer, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty image buffer');
  }

  if (mimeType === 'image/svg+xml') {
    throw new Error('SVG format not supported — XSS risk');
  }

  // GIF and animated formats: pass through
  if (mimeType === 'image/gif') {
    return {
      buffer,
      mimeType,
      originalSize: buffer.length,
      compressedSize: buffer.length,
    };
  }

  const originalSize = buffer.length;

  // Validate dimensions
  const metadata = await sharp(buffer).metadata();
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new Error(
      `Image dimensions ${metadata.width}x${metadata.height} exceed maximum ${MAX_DIMENSION}x${MAX_DIMENSION}`,
    );
  }
  if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    throw new Error(
      `Image dimensions ${metadata.width}x${metadata.height} below minimum ${MIN_DIMENSION}x${MIN_DIMENSION}`,
    );
  }

  let pipeline = sharp(buffer, { failOn: 'error' }).rotate(); // auto-rotate from EXIF

  let outputMime = mimeType;

  // HEIC/HEIF: convert to JPEG
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
    outputMime = 'image/jpeg';
  } else if (mimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  } else if (mimeType === 'image/png') {
    pipeline = pipeline.png({ effort: 10, compressionLevel: 9 });
  } else if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 95, nearLossless: true });
  } else {
    // Unknown format: pass through
    return { buffer, mimeType, originalSize, compressedSize: originalSize };
  }

  // Convert CMYK → sRGB, 16-bit → 8-bit
  // NOTE: Do NOT call withMetadata() — sharp strips EXIF by default.
  // Calling withMetadata({}) would PRESERVE metadata, defeating the purpose.
  pipeline = pipeline.toColorspace('srgb');

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Image compression timed out')), COMPRESSION_TIMEOUT_MS),
  );

  const compressed = await Promise.race([pipeline.toBuffer(), timeoutPromise]);

  log.info('imageCompressor', 'Image compressed', {
    originalSize,
    compressedSize: compressed.length,
    format: outputMime,
    ratio: `${((1 - compressed.length / originalSize) * 100).toFixed(1)}%`,
  });

  return {
    buffer: compressed,
    mimeType: outputMime,
    originalSize,
    compressedSize: compressed.length,
  };
}

module.exports = { compressImage };
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd express-api && npx jest tests/utils/imageCompressor.test.js --verbose
```

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd express-api && git add src/utils/imageCompressor.js tests/utils/imageCompressor.test.js package.json package-lock.json
git commit -m "feat: add image compression utility (sharp-based, lossless/near-lossless)"
```

### Task 2: Integrate compression into storage upload

**Files:**
- Modify: `express-api/src/routes/storage.js:17-65`
- Modify: `express-api/tests/routes/storage.test.js`

- [ ] **Step 1: Write failing test for compression integration**

Add to `express-api/tests/routes/storage.test.js`:

```javascript
// Mock compressImage to avoid needing real image buffers (consistent with mocking external deps)
jest.mock('../../src/utils/imageCompressor', () => ({
  compressImage: jest.fn().mockResolvedValue({
    buffer: Buffer.from('compressed'),
    mimeType: 'image/jpeg',
    originalSize: 100,
    compressedSize: 50,
  }),
}));

test('upload response includes originalSize and compressedSize', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/storage/upload')
    .field('path', 'profiles')
    .attach('file', Buffer.from('fake-jpeg-data'), {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });

  expect(res.body).toHaveProperty('originalSize');
  expect(res.body).toHaveProperty('compressedSize');
});
```

- [ ] **Step 2: Update storage.js — add HEIC/HEIF to ALLOWED_MIME_TYPES, add `starting-screens` to ALLOWED_UPLOAD_PATHS, integrate compression**

In `express-api/src/routes/storage.js`:

1. Add to `ALLOWED_UPLOAD_PATHS`:
```javascript
const ALLOWED_UPLOAD_PATHS = [
  'profiles', 'covers', 'messages', 'groups', 'evidence', 'stickers', 'banners',
  'starting-screens',  // NEW — background images for starting screens
];
```

2. Add HEIC/HEIF to `ALLOWED_MIME_TYPES` (line 47):
```javascript
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
```

3. Add compression to upload handler (after MIME check, before R2 upload):
```javascript
const { compressImage } = require('../utils/imageCompressor');

// Inside the upload handler, after MIME validation:
let uploadBuffer = file.buffer;
let uploadMime = contentType;
let originalSize = file.buffer.length;
let compressedSize = file.buffer.length;

try {
  const compressed = await compressImage(file.buffer, contentType);
  uploadBuffer = compressed.buffer;
  uploadMime = compressed.mimeType;
  originalSize = compressed.originalSize;
  compressedSize = compressed.compressedSize;
} catch (compressionErr) {
  log.warn('storage', 'Compression failed, storing original', { error: compressionErr.message });
  // Fallback: store uncompressed
}

// IMPORTANT: Recompute extension and key AFTER compression — HEIC→JPEG conversion
// changes the MIME type, so the key extension must match the output format.
const extension = getExtension(uploadMime);  // use post-compression MIME, not original
const key = `${path}/${uniqueId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

const url = await r2.putObject(key, uploadBuffer, uploadMime);
res.json({ url, originalSize, compressedSize });
```

- [ ] **Step 3: Run all storage tests**

```bash
cd express-api && npx jest tests/routes/storage.test.js tests/routes/storage-delete.test.js --verbose
```

Expected: ALL PASS (existing tests should still pass since `originalSize`/`compressedSize` are additive)

- [ ] **Step 4: Commit**

```bash
git add src/routes/storage.js tests/routes/storage.test.js
git commit -m "feat: integrate image compression into storage upload, add HEIC/starting-screens support"
```

---

## Chunk 2: Starting Screens Config Endpoint

### Task 3: Auth middleware exemption

**Files:**
- Modify: `express-api/src/index.js:42-51`

- [ ] **Step 1: Add exemption**

In `express-api/src/index.js`, add to the auth middleware exemption (after line 47). **Must be method-scoped to GET only** — PUT must remain behind auth:

```javascript
(req.method === 'GET' && req.path === '/config/startingScreens') ||
```

Method-scoped to GET only. PUT remains behind auth middleware so that:
- Unauthenticated PUT → 401 from auth middleware
- Authenticated non-admin PUT → 403 from `requireAdmin`

This matches the spec: "Only GET needs to be exempt. PUT remains behind auth middleware (admin-only)."

Note: `requireAdmin` does handle `req.auth === undefined` gracefully (returns 403 via `!req.auth` check), but keeping PUT behind auth middleware is correct for consistent 401/403 responses and matches the spec's intent.

The full block becomes:
```javascript
app.use('/api', (req, res, next) => {
  if (
    req.path === '/health' ||
    req.path === '/log-config' ||
    req.path.startsWith('/auth/') ||
    (req.method === 'GET' && req.path === '/config/startingScreens') ||
    (req.path.startsWith('/test/') && process.env.NODE_ENV !== 'production')
  )
    return next();
  authMiddleware(req, res, next);
});
```

- [ ] **Step 2: Write failing test for auth exemption (TDD)**

Add a test verifying GET succeeds without auth token while PUT returns 401:

```javascript
// In starting-screens.test.js
test('GET /api/config/startingScreens is accessible without auth token', async () => {
  // Use app mounted with real auth middleware to verify exemption
  // This test should pass only after the exemption is added
});

test('PUT /api/config/startingScreens returns 401 without auth token', async () => {
  // Verify PUT is NOT exempt
});
```

- [ ] **Step 3: Run test — verify GET fails (401) before exemption**

- [ ] **Step 4: Commit**

```bash
git add src/index.js tests/routes/starting-screens.test.js
git commit -m "feat: exempt GET /config/startingScreens from auth middleware (pre-auth endpoint)"
```

### Task 4: Starting screens GET endpoint

**Files:**
- Modify: `express-api/src/routes/config.js` (add routes BEFORE line 21)
- Create: `express-api/tests/routes/starting-screens.test.js`

- [ ] **Step 1: Write failing tests for GET endpoint**

Create `express-api/tests/routes/starting-screens.test.js` with core GET tests. This file will be large — start with core functionality, date filtering, and allowlist tests. See spec section 6 for the full test listing. Key tests:

```javascript
const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

// --- Mocks ---
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({ get: mockDocGet, set: mockDocSet })),
  },
}));

// Match existing config.test.js mock pattern — default allows admin, use mockImplementationOnce for non-admin tests
jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
}));

const { requireAdmin } = require('../../src/middleware/auth');

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const configRouter = require('../../src/routes/config');

function createApp(isAdmin = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = isAdmin
      ? { uid: 'admin1', uniqueId: 'admin-1', isAdmin: true, token: { admin: true } }
      : { uid: 'user1', uniqueId: 'user-1', isAdmin: false, token: {} };
    next();
  });
  app.use('/api', configRouter);
  return app;
}

function makeScreen(overrides = {}) {
  return {
    enabled: true,
    dismissable: false,
    frequency: 'every_launch',
    template: 'warning',
    title: 'Test Title Here',
    message: 'Test message that is long enough to pass validation.',
    imageType: 'police_duck',
    backgroundImage: null,
    startDate: null,
    endDate: null,
    allowlist: { deviceIds: [], networks: [] },
    lastModifiedBy: 'admin-1',
    lastModifiedAt: '2026-03-20T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/config/startingScreens', () => {
  test('returns active screens with contentHash', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ preLaunchGate: makeScreen() }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body.preLaunchGate).toBeDefined();
    expect(res.body.preLaunchGate.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.preLaunchGate.title).toBe('Test Title Here');
  });

  test('returns empty object when no screens configured', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('does NOT include allowlist in response', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ screen1: makeScreen({ allowlist: { deviceIds: ['dev1'], networks: [] } }) }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.screen1.allowlist).toBeUndefined();
  });

  test('omits disabled screens', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        active: makeScreen({ enabled: true }),
        disabled: makeScreen({ enabled: false }),
      }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body.active).toBeDefined();
    expect(res.body.disabled).toBeUndefined();
  });

  test('allowlist device ID match overrides dismissable to true', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        gate: makeScreen({
          dismissable: false,
          allowlist: { deviceIds: ['my-device'], networks: [] },
        }),
      }),
    });

    const app = createApp();
    const res = await request(app)
      .get('/api/config/startingScreens')
      .set('X-Device-Id', 'my-device');

    expect(res.body.gate.dismissable).toBe(true);
  });
});
```

Continue adding tests per the spec's full test listing (date filtering, content hash, multi-screen, ETag, absence, security, HTTP correctness, idempotency, logging).

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd express-api && npx jest tests/routes/starting-screens.test.js --verbose
```

Expected: FAIL — routes not implemented yet

- [ ] **Step 3: Implement GET endpoint in config.js**

Add the following **BEFORE line 21** — this means at the TOP of the route definitions, before `router.get('/config/:key', ...)`. Both the dedicated GET and PUT for startingScreens must be above line 21 (the generic GET), not between the generic GET and generic PUT:

```javascript
const crypto = require('crypto');

// --- Starting Screens (must be BEFORE generic /config/:key) ---

function computeContentHash(screen) {
  const hashFields = {
    title: screen.title,
    message: screen.message,
    template: screen.template,
    imageType: screen.imageType || null,
    backgroundImage: screen.backgroundImage || null,
    dismissable: screen.dismissable,
    frequency: screen.frequency,
  };
  return crypto.createHash('sha256').update(JSON.stringify(hashFields, Object.keys(hashFields).sort())).digest('hex');
}

function isScreenActive(screen, now) {
  if (!screen.enabled) return false;
  if (screen.startDate && new Date(screen.startDate).getTime() > now) return false;
  if (screen.endDate && new Date(screen.endDate).getTime() <= now) return false;
  return true;
}

function isAllowlisted(screen, deviceId, ip) {
  if (!screen.allowlist) return false;
  const { deviceIds = [], networks = [] } = screen.allowlist;
  if (deviceId && deviceIds.includes(deviceId)) return true;
  if (ip) {
    for (const network of networks) {
      if (network.includes('/')) {
        if (cidrMatch(ip, network)) return true;
      } else if (ip === network) return true;
    }
  }
  return false;
}

function cidrMatch(ip, cidr) {
  // Simple CIDR matching for IPv4
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1) >>> 0;
  const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
  const rangeNum = range.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

router.get('/config/startingScreens', async (req, res) => {
  try {
    const snap = await db.doc('config/startingScreens').get();
    if (!snap.exists) return res.json({});

    const allScreens = snap.data();
    const now = Date.now();
    const deviceId = req.headers['x-device-id'];
    const ip = req.ip;
    const result = {};

    const sortedIds = Object.keys(allScreens).sort();
    for (const id of sortedIds) {
      const screen = allScreens[id];
      if (!isScreenActive(screen, now)) continue;

      const dismissable = screen.dismissable === false && isAllowlisted(screen, deviceId, ip)
        ? true
        : screen.dismissable;

      result[id] = {
        enabled: screen.enabled,
        dismissable,
        frequency: screen.frequency,
        template: screen.template,
        title: screen.title,
        message: screen.message,
        imageType: screen.imageType || null,
        backgroundImage: screen.backgroundImage || null,
        startDate: screen.startDate || null,
        endDate: screen.endDate || null,
        contentHash: computeContentHash(screen),
        lastModifiedAt: screen.lastModifiedAt || null,
      };
    }

    log.info('config', 'Starting screens fetched', {
      screenCount: Object.keys(result).length,
      deviceId: deviceId ? '(present)' : '(absent)',
    });

    res.json(result);
  } catch (err) {
    log.error('config', 'Error fetching starting screens', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd express-api && npx jest tests/routes/starting-screens.test.js --verbose
```

Expected: ALL PASS

- [ ] **Step 5: Run full test suite — verify no regression**

```bash
cd express-api && npm test
```

Expected: ALL PASS (existing config.test.js tests unaffected)

- [ ] **Step 6: Commit**

```bash
git add src/routes/config.js tests/routes/starting-screens.test.js
git commit -m "feat: add GET /api/config/startingScreens endpoint with allowlist and date filtering"
```

### Task 5: Starting screens PUT endpoint

**Files:**
- Modify: `express-api/src/routes/config.js`
- Add to: `express-api/tests/routes/starting-screens.test.js`

- [ ] **Step 1: Write failing tests for PUT validation**

Add to `starting-screens.test.js` — a `describe('PUT /api/config/startingScreens', ...)` block covering all validation cases from the spec (title length, message length, frequency/template/imageType enums, date validation, blocking constraint, screen ID validation, allowlist validation). See spec section 6 "Starting Screens PUT" for the full listing.

**Important:** For the non-admin 403 test, the global `requireAdmin` mock defaults to `() => false` (allow). To test the 403 case, use `mockImplementationOnce` matching the existing `config.test.js` pattern:

```javascript
test('PUT returns 403 for non-admin', async () => {
  requireAdmin.mockImplementationOnce((req, res) => {
    res.status(403).json({ error: 'Admin access required' });
    return true;
  });

  const app = createApp();
  const res = await request(app)
    .put('/api/config/startingScreens')
    .send({ testScreen: makeScreen() });

  expect(res.status).toBe(403);
});
```

- [ ] **Step 2: Implement PUT endpoint**

Add the following AFTER the GET route but BEFORE the generic routes:

```javascript
// Content sanitisation helpers
function sanitiseTitle(title) {
  if (typeof title !== 'string') return null;
  // Strip zero-width chars except ZWJ (U+200D)
  let cleaned = title.replace(/[\u200B\u200C\u200E\u200F\uFEFF]/g, '');
  cleaned = cleaned.trim();
  // NFC normalise
  cleaned = cleaned.normalize('NFC');
  return cleaned;
}

function sanitiseMessage(message) {
  if (typeof message !== 'string') return null;
  let cleaned = message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // strip control chars except \n \r \t
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // collapse excessive newlines
  cleaned = cleaned.trim();
  cleaned = cleaned.normalize('NFC');
  return cleaned;
}

const VALID_FREQUENCIES = ['every_launch', 'once'];
const VALID_TEMPLATES = ['warning', 'promotional', 'announcement', 'info'];
const VALID_IMAGE_TYPES = ['police_duck']; // null/undefined handled by guard clause before this check
const SCREEN_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

router.put('/config/startingScreens', async (req, res) => {
  try {
    if (requireAdmin(req, res)) return;

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // Get existing config for blocking constraint check
    const existingSnap = await db.doc('config/startingScreens').get();
    const existing = existingSnap.exists ? existingSnap.data() : {};

    const updates = {};

    for (const [screenId, screen] of Object.entries(body)) {
      // Validate screen ID
      if (!SCREEN_ID_REGEX.test(screenId)) {
        return res.status(400).json({ error: `Invalid screen ID: ${screenId}. Must be alphanumeric, hyphens, underscores only.`, field: 'screenId' });
      }

      // Required fields
      if (typeof screen.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean', field: 'enabled' });
      if (typeof screen.dismissable !== 'boolean') return res.status(400).json({ error: 'dismissable must be a boolean', field: 'dismissable' });

      if (!VALID_FREQUENCIES.includes(screen.frequency)) {
        return res.status(400).json({ error: `frequency must be 'every_launch' or 'once' (got '${screen.frequency}')`, field: 'frequency' });
      }
      if (!VALID_TEMPLATES.includes(screen.template)) {
        return res.status(400).json({ error: `template must be one of: ${VALID_TEMPLATES.join(', ')} (got '${screen.template}')`, field: 'template' });
      }

      // Title validation
      const title = sanitiseTitle(screen.title);
      if (!title || title.length < 3 || title.length > 100) {
        return res.status(400).json({ error: `title must be between 3 and 100 characters (got ${title ? title.length : 0})`, field: 'title' });
      }

      // Message validation
      const message = sanitiseMessage(screen.message);
      if (!message || message.length < 10 || message.length > 500) {
        return res.status(400).json({ error: `message must be between 10 and 500 characters (got ${message ? message.length : 0})`, field: 'message' });
      }

      // Optional fields
      if (screen.imageType !== undefined && screen.imageType !== null && !VALID_IMAGE_TYPES.includes(screen.imageType)) {
        return res.status(400).json({ error: `Unknown imageType: ${screen.imageType}`, field: 'imageType' });
      }

      if (screen.backgroundImage !== undefined && screen.backgroundImage !== null) {
        if (typeof screen.backgroundImage !== 'string' || screen.backgroundImage === '') {
          return res.status(400).json({ error: 'backgroundImage must be a valid R2 key or null', field: 'backgroundImage' });
        }
      }

      // Date validation
      if (screen.startDate != null) {
        if (typeof screen.startDate !== 'string' || isNaN(Date.parse(screen.startDate)) || !screen.startDate.includes('T')) {
          return res.status(400).json({ error: 'startDate must be a valid ISO 8601 datetime', field: 'startDate' });
        }
      }
      if (screen.endDate != null) {
        if (typeof screen.endDate !== 'string' || isNaN(Date.parse(screen.endDate)) || !screen.endDate.includes('T')) {
          return res.status(400).json({ error: 'endDate must be a valid ISO 8601 datetime', field: 'endDate' });
        }
        if (new Date(screen.endDate).getTime() <= Date.now()) {
          return res.status(400).json({ error: 'endDate must be in the future', field: 'endDate' });
        }
      }
      if (screen.startDate && screen.endDate) {
        if (new Date(screen.startDate).getTime() >= new Date(screen.endDate).getTime()) {
          return res.status(400).json({ error: 'startDate must be before endDate', field: 'startDate' });
        }
      }

      // Allowlist validation
      const allowlist = screen.allowlist || { deviceIds: [], networks: [] };
      if (allowlist.deviceIds && !Array.isArray(allowlist.deviceIds)) {
        return res.status(400).json({ error: 'allowlist.deviceIds must be an array', field: 'allowlist.deviceIds' });
      }
      if (allowlist.networks && !Array.isArray(allowlist.networks)) {
        return res.status(400).json({ error: 'allowlist.networks must be an array', field: 'allowlist.networks' });
      }
      if (allowlist.networks) {
        for (const net of allowlist.networks) {
          if (net.endsWith('/0')) {
            return res.status(400).json({ error: 'CIDR /0 not allowed in allowlist (matches all IPs)', field: 'allowlist.networks' });
          }
        }
      }

      // Blocking constraint: max 1 non-dismissable screen
      if (screen.enabled && !screen.dismissable) {
        const allScreens = { ...existing, ...updates };
        for (const [otherId, other] of Object.entries(allScreens)) {
          if (otherId !== screenId && other.enabled && !other.dismissable) {
            return res.status(409).json({
              error: `Only one non-dismissable screen allowed; '${otherId}' is already non-dismissable`,
              existingBlocker: otherId,
            });
          }
        }
      }

      updates[screenId] = {
        enabled: screen.enabled,
        dismissable: screen.dismissable,
        frequency: screen.frequency,
        template: screen.template,
        title,
        message,
        imageType: screen.imageType || null,
        backgroundImage: screen.backgroundImage || null,
        startDate: screen.startDate || null,
        endDate: screen.endDate || null,
        allowlist,
        lastModifiedBy: req.auth.uniqueId,
        lastModifiedAt: new Date().toISOString(),
      };
    }

    // Merge with existing
    const merged = { ...existing, ...updates };
    await db.doc('config/startingScreens').set(merged);

    log.info('config', 'Starting screens updated', {
      adminUniqueId: req.auth.uniqueId,
      screenIds: Object.keys(updates),
    });

    return res.json({ success: true });
  } catch (err) {
    log.error('config', 'Error updating starting screens', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 405 catch-all for unsupported methods
router.all('/config/startingScreens', (req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});
```

- [ ] **Step 3: Run tests**

```bash
cd express-api && npx jest tests/routes/starting-screens.test.js --verbose
```

Expected: ALL PASS

- [ ] **Step 4: Run full test suite**

```bash
cd express-api && npm test
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/config.js tests/routes/starting-screens.test.js
git commit -m "feat: add PUT /api/config/startingScreens with full validation and blocking constraint"
```

### Task 6: Contract tests

**Files:**
- Create: `express-api/tests/contracts/starting-screens-contract.test.js`

- [ ] **Step 1: Write contract tests**

```javascript
const express = require('express');
const request = require('supertest');

// --- Full mock setup (same as starting-screens.test.js) ---
const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({ get: mockDocGet, set: mockDocSet })),
  },
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const configRouter = require('../../src/routes/config');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { uid: 'u1', uniqueId: 'user-1' }; next(); });
  app.use('/api', configRouter);
  return app;
}

function makeScreen(overrides = {}) {
  return {
    enabled: true, dismissable: false, frequency: 'every_launch', template: 'warning',
    title: 'Test Title Here', message: 'Test message that is long enough to pass validation.',
    imageType: 'police_duck', backgroundImage: null, startDate: null, endDate: null,
    allowlist: { deviceIds: [], networks: [] },
    lastModifiedBy: 'admin-1', lastModifiedAt: '2026-03-20T12:00:00Z',
    ...overrides,
  };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('Starting Screens API Contract', () => {
  test('GET response shape matches frozen contract', async () => {
    // Setup mock with a complete screen
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        testScreen: {
          enabled: true, dismissable: false, frequency: 'every_launch',
          template: 'warning', title: 'Test', message: 'Test message here.',
          imageType: 'police_duck', backgroundImage: null,
          startDate: null, endDate: null,
          allowlist: { deviceIds: [], networks: [] },
          lastModifiedBy: 'admin-1', lastModifiedAt: '2026-03-20T12:00:00Z',
        },
      }),
    });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    const screen = res.body.testScreen;

    // Verify every expected field exists with correct type
    expect(typeof screen.enabled).toBe('boolean');
    expect(typeof screen.dismissable).toBe('boolean');
    expect(typeof screen.frequency).toBe('string');
    expect(typeof screen.template).toBe('string');
    expect(typeof screen.title).toBe('string');
    expect(typeof screen.message).toBe('string');
    expect(typeof screen.contentHash).toBe('string');
    expect(screen.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(screen.lastModifiedAt).toBeDefined();

    // Verify fields that must NOT be present
    expect(screen.allowlist).toBeUndefined();
    expect(screen.lastModifiedBy).toBeUndefined();
  });

  test('empty config returns empty object, not null or array', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const app = createApp();
    const res = await request(app).get('/api/config/startingScreens');

    expect(res.body).toEqual({});
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run contract tests**

```bash
cd express-api && npx jest tests/contracts/starting-screens-contract.test.js --verbose
```

Expected: ALL PASS

- [ ] **Step 3: Run full suite**

```bash
cd express-api && npm test
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/contracts/starting-screens-contract.test.js
git commit -m "feat: add starting screens API contract tests"
```

### Task 7: Expand test coverage to spec depth

**Files:**
- Modify: `express-api/tests/routes/starting-screens.test.js`
- Modify: `express-api/tests/utils/imageCompressor.test.js`

- [ ] **Step 1: Add all remaining tests from spec section 6**

Systematically add every test case listed in the spec for:
- Date filtering (all boundary tests with `jest.useFakeTimers()`)
- Allowlist (CIDR, IPv6, case-sensitivity, loopback)
- Content hash (determinism, field changes, exclusions)
- Multi-screen scenarios
- ETag/conditional requests
- Absence tests
- HTTP correctness (405, headers)
- PUT validation (all field validations, blocking constraint, sanitisation)
- Combinatorial decision table (15 pairwise rows)
- Idempotency
- Logging verification

See spec `.project/plans/2026-03-20-starting-screens-design.md` section 6 for the complete test listing.

- [ ] **Step 2: Run full suite**

```bash
cd express-api && npm test
```

Expected: ALL PASS

- [ ] **Step 3: Run coverage**

```bash
cd express-api && npm run test:coverage
```

Verify ≥90% line coverage and ≥85% branch coverage for `imageCompressor.js` and the new starting screens routes in `config.js`.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: exhaustive starting screens API test coverage per spec"
```

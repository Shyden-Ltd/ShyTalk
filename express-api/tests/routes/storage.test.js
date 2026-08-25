const express = require('express');
const request = require('supertest');

// ─── Mocks ──────────────────────────────────────────────────────

jest.mock('../../src/utils/r2', () => ({
  putObject: jest.fn().mockResolvedValue('https://images.shytalk.shyden.co.uk/test-key'),
  deleteObject: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/imageCompressor', () => {
  // Provide a real subclass so route's `instanceof ImagePolicyError` works
  class ImagePolicyError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ImagePolicyError';
    }
  }
  return {
    compressImage: jest.fn().mockResolvedValue({
      buffer: Buffer.from('compressed'),
      mimeType: 'image/jpeg',
      originalSize: 100,
      compressedSize: 50,
    }),
    ImagePolicyError,
  };
});

jest.mock('../../src/utils/helpers', () => ({
  getExtension: jest.fn((mime) => {
    const map = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
    };
    return map[mime] || 'bin';
  }),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const r2 = require('../../src/utils/r2');

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── App setup ──────────────────────────────────────────────────

const storageRouter = require('../../src/routes/storage');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'firebase-uid', uniqueId: 12345 };
    next();
  });
  app.use('/api', storageRouter);
  return app;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/storage/upload', () => {
  test('allows image/jpeg uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-image'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
    expect(r2.putObject).toHaveBeenCalled();
  });

  test('allows image/png uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-png'), { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
  });

  test('allows image/webp uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'messages')
      .attach('file', Buffer.from('fake-webp'), {
        filename: 'photo.webp',
        contentType: 'image/webp',
      });

    expect(res.status).toBe(200);
  });

  test('rejects non-image MIME types (text/html)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'evil.html',
        contentType: 'text/html',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only image uploads/);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('rejects SVG uploads (XSS vector)', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('<svg onload="alert(1)">'), {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only image uploads/);
  });

  test('rejects application/pdf uploads', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-pdf'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
  });

  test('rejects disallowed upload paths', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'admin-data')
      .attach('file', Buffer.from('img'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid upload path/);
  });

  test('returns 400 when file is missing', async () => {
    const app = createApp();
    const res = await request(app).post('/api/storage/upload').field('path', 'profiles');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing file or path/);
  });

  test('upload response includes originalSize and compressedSize', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-jpeg'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('originalSize');
    expect(res.body).toHaveProperty('compressedSize');
  });

  test('starting-screens is an allowed upload path', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'starting-screens')
      .attach('file', Buffer.from('fake'), { filename: 'bg.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
  });

  test('HEIC upload is allowed', async () => {
    const { compressImage } = require('../../src/utils/imageCompressor');
    compressImage.mockResolvedValueOnce({
      buffer: Buffer.from('converted-jpeg'),
      mimeType: 'image/jpeg',
      originalSize: 200,
      compressedSize: 100,
    });
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-heic'), {
        filename: 'photo.heic',
        contentType: 'image/heic',
      });
    expect(res.status).toBe(200);
  });

  test('compressed buffer is stored to R2, not original', async () => {
    const { compressImage } = require('../../src/utils/imageCompressor');
    const compressedBuf = Buffer.from('compressed-data');
    compressImage.mockResolvedValueOnce({
      buffer: compressedBuf,
      mimeType: 'image/jpeg',
      originalSize: 100,
      compressedSize: compressedBuf.length,
    });
    const app = createApp();
    await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('original'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(r2.putObject).toHaveBeenCalledWith(expect.any(String), compressedBuf, 'image/jpeg');
  });

  test('compression engine failure falls back to storing original', async () => {
    const { compressImage } = require('../../src/utils/imageCompressor');
    compressImage.mockRejectedValueOnce(new Error('sharp failed'));
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('original-data'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(200);
    expect(r2.putObject).toHaveBeenCalled();
  });

  test('policy violation (oversized image) returns 400 — does NOT silently store original', async () => {
    const { compressImage, ImagePolicyError } = require('../../src/utils/imageCompressor');
    compressImage.mockRejectedValueOnce(
      new ImagePolicyError('Image dimensions 9999x9999 exceed maximum 4096x4096'),
    );
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('oversized-data'), {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceed maximum/);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('a file over the 10 MB multer limit returns 413 JSON — not a 500 HTML page', async () => {
    // SHY-0368. multer was wired as BARE middleware here, so LIMIT_FILE_SIZE
    // propagated to Express's default error handler: a 500 with an HTML body.
    // banners.js already wrapped multer and mapped this to 413; storage.js did
    // not. Real multer, real supertest — no mock decides this.
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 0x61), {
        filename: 'too-big.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(413);
    // The body must be JSON an API client can read, not an HTML error page.
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toMatch(/too large/i);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('a multer error that is NOT a size limit returns 400 JSON, not 500', async () => {
    // The other half of the same wiring: any upload error must be answered by
    // the route, never fall through to Express's default handler. Sending the
    // file under an unexpected field name trips LIMIT_UNEXPECTED_FILE.
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('wrongFieldName', Buffer.from('small'), {
        filename: 'x.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('policy violation (SVG) returns 400 — does NOT silently store original', async () => {
    // MIME-type allowlist already rejects SVG before compressImage is called,
    // but verify the layered defence: even if a future change loosens the
    // allowlist, ImagePolicyError thrown by compressImage still produces 400.
    const { compressImage, ImagePolicyError } = require('../../src/utils/imageCompressor');
    compressImage.mockRejectedValueOnce(
      new ImagePolicyError('SVG format not supported — XSS risk'),
    );
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('<svg></svg>'), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SVG format/);
    expect(r2.putObject).not.toHaveBeenCalled();
  });

  test('HEIC upload key uses post-compression extension (.jpg not .heic)', async () => {
    const { compressImage } = require('../../src/utils/imageCompressor');
    compressImage.mockResolvedValueOnce({
      buffer: Buffer.from('converted-jpeg'),
      mimeType: 'image/jpeg',
      originalSize: 200,
      compressedSize: 100,
    });
    const app = createApp();
    await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('fake-heic'), {
        filename: 'photo.heic',
        contentType: 'image/heic',
      });

    expect(r2.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/\.jpg$/),
      expect.any(Buffer),
      'image/jpeg',
    );
  });
});

// ─── The path the report flow actually sends ────────────────────

describe('report evidence reaches the same route the client posts to', () => {
  /**
   * `submitUserReport` uploads with `path = "report_evidence"`.
   *
   * Every test covering that flow mocks `StorageRepository` and asserts the
   * path STRING, against a fake that always succeeds. None of them reach this
   * router, which is the only thing that decides whether the path is allowed —
   * so the two halves could disagree indefinitely and every suite stayed green.
   *
   * The consequence is not a missing attachment. `submitUserReport` returns
   * `EvidenceUploadFailed` and never calls `reportUser`, so a person reporting
   * harassment WITH a screenshot files nothing at all.
   */
  test('the path the report flow sends is accepted', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('fake-image'), {
        filename: 'evidence.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(200);
  });

  test('a path nobody uses is still refused', async () => {
    // The allowlist is still an allowlist -- this must not have been widened
    // into "anything goes".
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'somewhere-nobody-declared')
      .attach('file', Buffer.from('x'), { filename: 'x.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid upload path');
  });
});

// ─── SHY-0420's rules, on the evidence path too ─────────────────

describe('a file somebody hands us is scanned before staff open it', () => {
  const scan = require('../../src/utils/attachment-scan');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('report evidence is scanned', async () => {
    const spy = jest.spyOn(scan, 'scanAttachment');
    const app = createApp();
    await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('x'), { filename: 'e.png', contentType: 'image/png' });

    expect(spy).toHaveBeenCalled();
  });

  test('a file the scanner refuses is not returned to the caller', async () => {
    jest
      .spyOn(scan, 'scanAttachment')
      .mockResolvedValue({ scanned: true, clean: false, reason: 'Eicar-Test-Signature' });
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('x'), { filename: 'e.png', contentType: 'image/png' });

    expect(res.status).toBe(400);
    expect(res.body.url).toBeUndefined();
  });

  test('a file the scanner refuses is deleted rather than left in the bucket', async () => {
    // Storing it and simply not returning the URL leaves the object behind,
    // reachable by anybody who can guess or later obtain the key.
    jest
      .spyOn(scan, 'scanAttachment')
      .mockResolvedValue({ scanned: true, clean: false, reason: 'Eicar-Test-Signature' });
    const app = createApp();
    await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('x'), { filename: 'e.png', contentType: 'image/png' });

    expect(r2.deleteObject).toHaveBeenCalled();
  });

  test('the refusal says what happened without quoting the scanner at the person', async () => {
    jest
      .spyOn(scan, 'scanAttachment')
      .mockResolvedValue({ scanned: true, clean: false, reason: 'Eicar-Test-Signature' });
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('x'), { filename: 'e.png', contentType: 'image/png' });

    expect(res.body.error).toMatch(/could not be accepted/i);
  });

  test('a profile photo goes through the same check', async () => {
    // Not only evidence. Every one of these files was uploaded by somebody we
    // do not know, and staff open all of them.
    const spy = jest.spyOn(scan, 'scanAttachment');
    const app = createApp();
    await request(app)
      .post('/api/storage/upload')
      .field('path', 'profiles')
      .attach('file', Buffer.from('x'), { filename: 'p.png', contentType: 'image/png' });

    expect(spy).toHaveBeenCalled();
  });

  test('a clean file is returned as normal', async () => {
    jest
      .spyOn(scan, 'scanAttachment')
      .mockResolvedValue({ scanned: true, clean: true, reason: null });
    const app = createApp();
    const res = await request(app)
      .post('/api/storage/upload')
      .field('path', 'report_evidence')
      .attach('file', Buffer.from('x'), { filename: 'e.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });
});

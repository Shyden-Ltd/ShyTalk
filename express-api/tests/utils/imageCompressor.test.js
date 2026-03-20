// Mock log to prevent real logger side effects
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { compressImage } = require('../../src/utils/imageCompressor');

describe('imageCompressor', () => {
  test('compresses JPEG — output smaller than input', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
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
    const input = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await compressImage(input, 'image/png');
    expect(result.buffer.length).toBeLessThanOrEqual(input.length);
    expect(result.mimeType).toBe('image/png');
  });

  test('compresses WebP', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .webp({ quality: 100 })
      .toBuffer();
    const result = await compressImage(input, 'image/webp');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.mimeType).toBe('image/webp');
  });

  test('passes through GIF unchanged', async () => {
    const gifBuffer = Buffer.from(
      'GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;',
    );
    const result = await compressImage(gifBuffer, 'image/gif');
    expect(result.buffer).toEqual(gifBuffer);
    expect(result.mimeType).toBe('image/gif');
  });

  test('preserves PNG transparency', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    const result = await compressImage(input, 'image/png');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.channels).toBe(4);
  });

  test('preserves original dimensions', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 300, height: 500, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .jpeg()
      .toBuffer();
    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.width).toBe(300);
    expect(metadata.height).toBe(500);
  });

  test('strips EXIF metadata from JPEG', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'Test' } } })
      .toBuffer();
    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  test('rejects corrupted image buffer', async () => {
    await expect(compressImage(Buffer.from('not an image'), 'image/jpeg')).rejects.toThrow();
  });

  test('rejects empty buffer', async () => {
    await expect(compressImage(Buffer.alloc(0), 'image/jpeg')).rejects.toThrow();
  });

  test('rejects SVG (XSS risk)', async () => {
    const svgBuffer = Buffer.from('<svg><script>alert(1)</script></svg>');
    await expect(compressImage(svgBuffer, 'image/svg+xml')).rejects.toThrow(/SVG.*not supported/i);
  });

  test('rejects image exceeding 4096x4096', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 4097, height: 100, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    await expect(compressImage(input, 'image/jpeg')).rejects.toThrow(/dimensions/i);
  });

  test('rejects image smaller than 100x100', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 99, height: 99, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    await expect(compressImage(input, 'image/jpeg')).rejects.toThrow(/dimensions/i);
  });

  test('returns originalSize and compressedSize', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
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
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
    const result = await compressImage(input, 'image/jpeg');
    expect(result.buffer.length).toBeLessThanOrEqual(input.length * 1.1);
  });

  test('animated WebP passed through unchanged', async () => {
    // Create a valid WebP buffer, then mock sharp metadata to report pages > 1
    const realSharp = jest.requireActual('sharp');
    const validWebP = await realSharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 128, b: 0 } },
    })
      .webp()
      .toBuffer();

    const mockSharp = (...args) => {
      const instance = realSharp(...args);
      const origMetadata = instance.metadata.bind(instance);
      instance.metadata = async () => {
        const meta = await origMetadata();
        meta.pages = 3; // simulate animated
        return meta;
      };
      return instance;
    };
    Object.assign(mockSharp, realSharp);

    // We need to mock at module level for compressImage to pick it up
    jest.resetModules();
    jest.doMock('sharp', () => mockSharp);
    jest.doMock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    const { compressImage: compressWithMock } = require('../../src/utils/imageCompressor');

    const result = await compressWithMock(validWebP, 'image/webp');
    expect(result.buffer).toBe(validWebP);
    expect(result.compressedSize).toBe(result.originalSize);
    expect(result.mimeType).toBe('image/webp');

    // Restore
    jest.resetModules();
  });

  test('WebP transparency preserved', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .webp()
      .toBuffer();
    const result = await compressImage(input, 'image/webp');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.channels).toBe(4);
  });

  test('CMYK to sRGB conversion — output is sRGB', async () => {
    const sharp = require('sharp');
    // Create a regular image and compress it, then verify the output is sRGB
    // (sharp's toColorspace('srgb') is called in the pipeline)
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 0, g: 128, b: 128 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.space).toBe('srgb');
  });

  test('sharp failure graceful fallback — returns original buffer', async () => {
    jest.resetModules();
    const realSharp = jest.requireActual('sharp');
    const mockSharp = (...args) => {
      const instance = realSharp(...args);
      // Let metadata work normally but make toBuffer fail
      const origRotate = instance.rotate.bind(instance);
      instance.rotate = () => {
        const rotated = origRotate();
        // Override the entire pipeline's toBuffer to throw
        const buildPipeline = (obj) => {
          const handler = {
            get(target, prop) {
              if (prop === 'toBuffer') {
                return () => Promise.reject(new Error('sharp internal failure'));
              }
              const val = target[prop];
              if (typeof val === 'function') {
                return (...a) => {
                  const res = val.apply(target, a);
                  // If it returns the pipeline object, wrap it too
                  if (res === target || (res && typeof res.toBuffer === 'function')) {
                    return new Proxy(res, handler);
                  }
                  return res;
                };
              }
              return val;
            },
          };
          return new Proxy(obj, handler);
        };
        return buildPipeline(rotated);
      };
      return instance;
    };
    Object.assign(mockSharp, realSharp);

    jest.doMock('sharp', () => mockSharp);
    jest.doMock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    const { compressImage: compressWithMock } = require('../../src/utils/imageCompressor');

    const input = await realSharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 100, g: 100, b: 100 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await compressWithMock(input, 'image/jpeg');
    expect(result.buffer).toBe(input);
    expect(result.compressedSize).toBe(result.originalSize);
    expect(result.mimeType).toBe('image/jpeg');

    jest.resetModules();
  });

  test('sharp timeout fallback — returns original buffer on timeout', async () => {
    jest.resetModules();
    const realSharp = jest.requireActual('sharp');

    // Mock sharp so toBuffer delays longer than COMPRESSION_TIMEOUT_MS (10s).
    // To avoid a real 10s wait, we mock setTimeout to fire instantly for
    // the compression timeout, while toBuffer takes a bit longer.
    const mockSharp = (...args) => {
      const instance = realSharp(...args);
      const origRotate = instance.rotate.bind(instance);
      instance.rotate = () => {
        const rotated = origRotate();
        const buildPipeline = (obj) => {
          const handler = {
            get(target, prop) {
              if (prop === 'toBuffer') {
                // Return a promise that resolves after 500ms —
                // longer than our accelerated timeout
                return () =>
                  new Promise((resolve) => setTimeout(() => resolve(Buffer.from('too late')), 500));
              }
              const val = target[prop];
              if (typeof val === 'function') {
                return (...a) => {
                  const res = val.apply(target, a);
                  if (res === target || (res && typeof res.toBuffer === 'function')) {
                    return new Proxy(res, handler);
                  }
                  return res;
                };
              }
              return val;
            },
          };
          return new Proxy(obj, handler);
        };
        return buildPipeline(rotated);
      };
      return instance;
    };
    Object.assign(mockSharp, realSharp);

    jest.doMock('sharp', () => mockSharp);
    jest.doMock('../../src/utils/log', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));

    // Temporarily patch setTimeout so the timeout fires in 50ms instead of 10s
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn, ms, ...rest) => {
      // If it's the 10000ms compression timeout, fire in 50ms instead
      if (ms === 10000) return origSetTimeout(fn, 50, ...rest);
      return origSetTimeout(fn, ms, ...rest);
    };

    const { compressImage: compressWithMock } = require('../../src/utils/imageCompressor');

    const input = await realSharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await compressWithMock(input, 'image/jpeg');
    expect(result.buffer).toBe(input);
    expect(result.compressedSize).toBe(result.originalSize);

    global.setTimeout = origSetTimeout;
    jest.resetModules();
  }, 10000);
});

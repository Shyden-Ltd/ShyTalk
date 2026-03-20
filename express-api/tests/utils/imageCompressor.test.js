// Mock log to prevent real logger side effects
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const { compressImage } = require('../../src/utils/imageCompressor');

describe('imageCompressor', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

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
    const sharp = require('sharp');
    const gifBuffer = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .gif()
      .toBuffer();
    const result = await compressImage(gifBuffer, 'image/gif');
    expect(result.buffer).toBe(gifBuffer);
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

  test('HEIC converted to JPEG', async () => {
    const sharp = require('sharp');
    // HEIC decoding depends on libvips build; use a valid JPEG as input since
    // the HEIC branch simply calls .jpeg() on the pipeline.
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 64, b: 32 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const result = await compressImage(input, 'image/heic');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.compressedSize).toBe(result.buffer.length);
  });

  test('HEIF converted to JPEG', async () => {
    const sharp = require('sharp');
    const input = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 32, g: 64, b: 128 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const result = await compressImage(input, 'image/heif');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.compressedSize).toBe(result.buffer.length);
  });

  test('GIF passthrough — GIFs returned unchanged after dimension validation', async () => {
    // GIF passthrough happens after metadata read + dimension validation,
    // so valid GIFs are passed through unchanged but invalid dimensions are rejected.
    const sharp = require('sharp');
    const gifBuffer = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .gif()
      .toBuffer();
    const result = await compressImage(gifBuffer, 'image/gif');
    expect(result.buffer).toBe(gifBuffer);
    expect(result.mimeType).toBe('image/gif');
    expect(result.originalSize).toBe(gifBuffer.length);
    expect(result.compressedSize).toBe(gifBuffer.length);
  });

  test('auto-rotation from EXIF orientation', async () => {
    const sharp = require('sharp');
    // Create a 100x200 JPEG with EXIF orientation 6 (90° CW rotation).
    // After .rotate() in the pipeline, output should be 200x100.
    const input = await sharp({
      create: { width: 100, height: 200, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await compressImage(input, 'image/jpeg');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });

  test('16-bit PNG converted to 8-bit output', async () => {
    const sharp = require('sharp');
    // Create a true 16-bit PNG via raw 16-bit buffer
    const width = 100,
      height = 100,
      channels = 3;
    const rawBuf = Buffer.alloc(width * height * channels * 2);
    for (let i = 0; i < rawBuf.length; i += 2) {
      rawBuf.writeUInt16LE(32768, i);
    }
    const input = await sharp(rawBuf, { raw: { width, height, channels, depth: 'ushort' } })
      .toColourspace('rgb16')
      .png({ depth: 16 })
      .toBuffer();
    // Verify input is actually 16-bit
    const inputMeta = await sharp(input).metadata();
    expect(inputMeta.depth).toBe('ushort'); // 16-bit
    // Compress and verify output is 8-bit
    const result = await compressImage(input, 'image/png');
    const outputMeta = await sharp(result.buffer).metadata();
    expect(outputMeta.depth).toBe('uchar'); // 8-bit
  });

  test('sharp timeout fallback — returns original buffer on timeout', async () => {
    jest.resetModules();
    const realSharp = jest.requireActual('sharp');

    // Create input buffer before mocking (needs real sharp)
    const input = await realSharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 50, g: 50, b: 50 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    // Pre-compute metadata so the mock can return it synchronously
    const inputMetadata = await realSharp(input).metadata();

    // Mock sharp so metadata resolves instantly and toBuffer never resolves
    const mockSharp = (...args) => {
      const instance = realSharp(...args);
      // Override metadata to return pre-computed result (avoids needing real timers)
      instance.metadata = () => Promise.resolve(inputMetadata);
      const origRotate = instance.rotate.bind(instance);
      instance.rotate = () => {
        const rotated = origRotate();
        const buildPipeline = (obj) => {
          const handler = {
            get(target, prop) {
              if (prop === 'toBuffer') {
                return () => new Promise(() => {}); // never resolves
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

    const { compressImage: compressWithMock } = require('../../src/utils/imageCompressor');

    // Enable fake timers only for the compression race
    jest.useFakeTimers();

    const resultPromise = compressWithMock(input, 'image/jpeg');

    // Flush microtask queue (awaits inside compressImage) then advance timers
    await Promise.resolve(); // let metadata() resolve
    await Promise.resolve(); // let pipeline setup complete
    jest.advanceTimersByTime(10001);

    const result = await resultPromise;
    expect(result.buffer).toBe(input);
    expect(result.compressedSize).toBe(result.originalSize);

    jest.useRealTimers();
  });
});

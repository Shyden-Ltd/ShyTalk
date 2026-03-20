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
});

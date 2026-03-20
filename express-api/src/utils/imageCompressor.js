/**
 * Image compression utility using sharp.
 * Compresses images before R2 storage. Lossless/near-lossless by format.
 * Strips EXIF metadata, auto-rotates, preserves dimensions and transparency.
 */

const sharp = require('sharp');
const log = require('./log');

const MAX_DIMENSION = 4096;
const MIN_DIMENSION = 100;
const COMPRESSION_TIMEOUT_MS = 10000;

async function compressImage(buffer, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty image buffer');
  }

  if (mimeType === 'image/svg+xml') {
    throw new Error('SVG format not supported — XSS risk');
  }

  const originalSize = buffer.length;

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

  // Animated images: pass through (can't optimise without losing frames)
  if (metadata.pages && metadata.pages > 1) {
    return { buffer, mimeType, originalSize, compressedSize: originalSize };
  }

  // GIF passthrough (after dimension validation)
  if (mimeType === 'image/gif') {
    return { buffer, mimeType, originalSize, compressedSize: originalSize };
  }

  let pipeline = sharp(buffer, { failOn: 'error' }).rotate();

  let outputMime = mimeType;

  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
    outputMime = 'image/jpeg';
  } else if (mimeType === 'image/jpeg') {
    pipeline = pipeline.jpeg({ quality: 95, mozjpeg: true });
  } else if (mimeType === 'image/png') {
    pipeline = pipeline.png({ effort: 10, compressionLevel: 9, depth: 8 });
  } else if (mimeType === 'image/webp') {
    pipeline = pipeline.webp({ quality: 95, nearLossless: true });
  } else {
    log.warn('imageCompressor', 'Unsupported MIME type, returning original', {
      mimeType,
      originalSize,
    });
    return { buffer, mimeType, originalSize, compressedSize: originalSize };
  }

  // Do NOT call withMetadata() — sharp strips EXIF by default.
  pipeline = pipeline.toColorspace('srgb');

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Image compression timed out')),
      COMPRESSION_TIMEOUT_MS,
    );
  });

  let compressed;
  try {
    compressed = await Promise.race([pipeline.toBuffer(), timeoutPromise]);
  } catch (err) {
    log.warn('imageCompressor', 'Compression failed, returning original', {
      error: err.message,
      format: outputMime,
      originalSize,
    });
    return { buffer, mimeType, originalSize, compressedSize: originalSize };
  } finally {
    clearTimeout(timer);
  }

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

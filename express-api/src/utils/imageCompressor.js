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

/**
 * Distinguishes policy rejections (oversized image, SVG XSS risk, empty
 * buffer) from compression-engine failures (sharp threw, timeout). Callers
 * MUST re-throw ImagePolicyError as a 4xx client error rather than
 * silently storing the original buffer — that would defeat the dimension
 * check and let an oversized image become a permanent R2 object.
 */
class ImagePolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ImagePolicyError';
  }
}

async function compressImage(buffer, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new ImagePolicyError('Empty image buffer');
  }

  if (mimeType === 'image/svg+xml') {
    throw new ImagePolicyError('SVG format not supported — XSS risk');
  }

  const originalSize = buffer.length;

  const metadata = await sharp(buffer).metadata();
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new ImagePolicyError(
      `Image dimensions ${metadata.width}x${metadata.height} exceed maximum ${MAX_DIMENSION}x${MAX_DIMENSION}`,
    );
  }
  if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    throw new ImagePolicyError(
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
  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Image compression timed out'));
    }, COMPRESSION_TIMEOUT_MS);
  });

  // Hold a reference to the in-flight sharp promise so we can attach a
  // tail .catch() for the post-timeout case. Without this, when the
  // timeout fires first, the sharp promise's eventual rejection becomes
  // an unhandled rejection with no context back to this request.
  const sharpPromise = pipeline.toBuffer();
  sharpPromise.catch((tailErr) => {
    if (timedOut) {
      log.warn('imageCompressor', 'Sharp pipeline rejected after timeout (post-mortem)', {
        error: tailErr.message,
        format: outputMime,
        originalSize,
      });
    }
  });

  let compressed;
  try {
    compressed = await Promise.race([sharpPromise, timeoutPromise]);
  } catch (err) {
    log.warn('imageCompressor', 'Compression failed, returning original', {
      error: err.message,
      timedOut,
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

module.exports = { compressImage, ImagePolicyError };

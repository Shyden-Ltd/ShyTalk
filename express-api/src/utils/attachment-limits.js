/**
 * The rules for a file somebody hands us (SHY-0420).
 *
 * Attachments existed before the rules did. The client bounded them — images
 * by size, video by duration, refused before any upload starts — and the
 * SERVER checked only that the key belonged to the caller. A client-side limit
 * is a courtesy to honest callers; it is not a bound.
 *
 * The same rules apply on support tickets, reports and appeals: they are the
 * three places a person hands us a file and there is no reason for them to
 * differ.
 *
 * It matters more than a feature gap. A minor cohort is present, and the files
 * attached to safety reports can include images of real people and of abuse.
 * Those files are then opened by staff.
 *
 * Pure, so every boundary is pinned without R2.
 */

'use strict';

const MB = 1024 * 1024;

/** Per submission, on all three surfaces. */
const MAX_ATTACHMENTS = 10;

/** An image is bounded by SIZE. */
const MAX_IMAGE_BYTES = 10 * MB;

/**
 * A video is bounded by DURATION, not size — a short high-bitrate clip must
 * not be refused for its bytes alone, nor a long low-bitrate one accepted.
 * Duration is measured on the client, where the media is; this byte number is
 * only a backstop against something absurd being stored, and sits far above
 * any honest thirty-second clip.
 */
const MAX_VIDEO_DURATION_MS = 30_000;
const MAX_VIDEO_BYTES_BACKSTOP = 200 * MB;

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

/** `image/jpeg; charset=binary` → `image/jpeg`. */
function normaliseType(contentType) {
  if (typeof contentType !== 'string') return null;
  const bare = contentType.split(';')[0].trim().toLowerCase();
  return bare || null;
}

/**
 * Why this stored object cannot be attached, in plain language, or null.
 *
 * FAILS CLOSED. An object we could not measure is refused: "we could not
 * check" must never mean "it is fine" for a file a stranger uploaded and a
 * member of staff will open.
 *
 * @param {{contentType?: string, size?: number}|null} object as R2 reports it
 * @returns {string|null} a sentence for the caller, or null to accept
 */
function refusalForStoredObject(object) {
  const type = normaliseType(object && object.contentType);
  const size = object && object.size;

  if (!type || !Number.isFinite(size)) {
    return 'That file could not be checked, so it was not attached.';
  }

  if (ALLOWED_IMAGE_TYPES.includes(type)) {
    return size > MAX_IMAGE_BYTES ? 'Images can be up to 10 MB.' : null;
  }

  if (ALLOWED_VIDEO_TYPES.includes(type)) {
    return size > MAX_VIDEO_BYTES_BACKSTOP ? 'That video is too large to attach.' : null;
  }

  return 'You can attach an image or a video.';
}

module.exports = {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_DURATION_MS,
  MAX_VIDEO_BYTES_BACKSTOP,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  normaliseType,
  refusalForStoredObject,
};

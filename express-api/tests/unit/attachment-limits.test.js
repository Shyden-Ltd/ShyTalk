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
 * Why it matters more than a feature gap: a minor cohort is present, and the
 * files attached to safety reports can include images of real people and of
 * abuse.
 */

const {
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES_BACKSTOP,
  MAX_VIDEO_DURATION_MS,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  refusalForStoredObject,
} = require('../../src/utils/attachment-limits');

const image = (over) => ({ contentType: 'image/png', size: 1024, ...over });
const video = (over) => ({ contentType: 'video/mp4', size: 5 * 1024 * 1024, ...over });

describe('the limits themselves', () => {
  test('ten files, images to 10 MB, video to 30 seconds', () => {
    expect(MAX_ATTACHMENTS).toBe(10);
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_VIDEO_DURATION_MS).toBe(30_000);
  });

  test('the video byte backstop is generous enough not to bound by size', () => {
    // The AC is explicit: a video is bounded by DURATION, so a short
    // high-bitrate clip must not be refused for its size alone. The byte
    // number here exists only to stop something absurd being stored, and has
    // to sit far above any honest 30-second clip.
    expect(MAX_VIDEO_BYTES_BACKSTOP).toBeGreaterThanOrEqual(100 * 1024 * 1024);
  });
});

describe('refusalForStoredObject', () => {
  test('an ordinary image is accepted', () => {
    expect(refusalForStoredObject(image())).toBeNull();
  });

  test('an ordinary video is accepted', () => {
    expect(refusalForStoredObject(video())).toBeNull();
  });

  test('an oversized image is refused, naming the limit in plain language', () => {
    const refusal = refusalForStoredObject(image({ size: MAX_IMAGE_BYTES + 1 }));
    expect(refusal).toMatch(/10 MB/);
    expect(refusal).not.toMatch(/bytes|MAX_/);
  });

  test('an image exactly at the limit is accepted', () => {
    expect(refusalForStoredObject(image({ size: MAX_IMAGE_BYTES }))).toBeNull();
  });

  test('a high-bitrate video is NOT refused for its size', () => {
    // The whole point of bounding video by duration. A 30-second clip at high
    // bitrate is a legitimate file.
    expect(refusalForStoredObject(video({ size: 60 * 1024 * 1024 }))).toBeNull();
  });

  test('an absurd video is still refused by the backstop', () => {
    expect(refusalForStoredObject(video({ size: MAX_VIDEO_BYTES_BACKSTOP + 1 }))).toMatch(/video/i);
  });

  test('a type nobody asked for is refused', () => {
    // Files uploaded by strangers are opened by staff. An executable or a PDF
    // reaching a moderator's machine is the delivery path this exists to close.
    ['application/pdf', 'application/x-msdownload', 'text/html', 'application/zip'].forEach((t) => {
      expect({ t, refusal: refusalForStoredObject(image({ contentType: t })) }).toEqual({
        t,
        refusal: expect.stringMatching(/image or a video/i),
      });
    });
  });

  test('every allowed type is actually allowed', () => {
    ALLOWED_IMAGE_TYPES.forEach((t) =>
      expect(refusalForStoredObject({ contentType: t, size: 10 })).toBeNull(),
    );
    ALLOWED_VIDEO_TYPES.forEach((t) =>
      expect(refusalForStoredObject({ contentType: t, size: 10 })).toBeNull(),
    );
  });

  test('an object we could not measure is refused, not waved through', () => {
    // FAILS CLOSED. "We could not check" must never mean "it is fine" for a
    // file a stranger uploaded and a member of staff will open.
    expect(refusalForStoredObject(null)).toMatch(/could not/i);
    expect(refusalForStoredObject({ contentType: 'image/png', size: undefined })).toMatch(
      /could not/i,
    );
    expect(refusalForStoredObject({ contentType: undefined, size: 10 })).toMatch(/could not/i);
  });

  test('a content type with parameters is understood', () => {
    // Browsers and SDKs append things like `; charset=utf-8`.
    expect(
      refusalForStoredObject({ contentType: 'image/jpeg; charset=binary', size: 10 }),
    ).toBeNull();
  });

  test('type matching is case-insensitive', () => {
    expect(refusalForStoredObject({ contentType: 'IMAGE/PNG', size: 10 })).toBeNull();
  });
});

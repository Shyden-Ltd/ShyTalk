/**
 * The attachment limits, and the seams they depend on — SHY-0387, corrected by
 * the operator on 2026-08-22.
 *
 * | Limit | Value |
 * | --- | --- |
 * | files per ticket | 10 |
 * | image size | 10 MB |
 * | video length | 30 seconds, by DURATION |
 * | file types offered | photos and video only |
 *
 * Three things can each break these independently, and a unit test on the
 * ViewModel sees none of them:
 *
 *   1. the COPY can drift from the code, so somebody is told "under 10 MB" while
 *      the check allows 25
 *   2. the PICKER can be widened to any file, so the type rule stops being a
 *      rule at all
 *   3. the DURATION can stop being read, and a video the app cannot measure is
 *      one the 30-second rule silently stops applying to
 *
 * Number 3 is the one that shipped: nothing anywhere read a video's duration,
 * so the limit the operator asked for did not exist in any form.
 *
 * See [[feedback-assert-the-seam-not-the-sides]].
 */

const fs = require('node:fs');
const path = require('node:path');
const { ALL_LOCALE_DIRS, readLocaleStrings } = require('../_helpers/compose-locales');

const repoRoot = path.resolve(__dirname, '../../..');
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  expect(fs.existsSync(p)).toBe(true);
  return fs.readFileSync(p, 'utf8');
};

/** Code only — a comment naming a limit is not a limit. */
const codeOf = (rel) =>
  read(rel)
    .split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

const VIEW_MODEL =
  'shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportFormViewModel.kt';
const ANDROID_PICKER =
  'shared/src/androidMain/kotlin/com/shyden/shytalk/core/platform/PlatformMediaPicker.android.kt';
const IOS_PICKER = 'shared/src/iosMain/kotlin/com/shyden/shytalk/util/IosMediaPicker.kt';
const PICKED_MEDIA =
  'shared/src/commonMain/kotlin/com/shyden/shytalk/core/platform/PlatformMediaPicker.kt';
const SERVER = 'express-api/src/routes/support-tickets.js';

describe('attachment limits — the numbers', () => {
  const vm = codeOf(VIEW_MODEL);

  test('an image is bounded at 10 MB', () => {
    // SHY-0420 set the number. It is ENFORCED server-side in
    // utils/attachment-limits.js; this constant exists so somebody is told
    // before their data allowance is spent, not so the limit depends on the
    // client honouring it.
    expect(vm).toMatch(/MAX_IMAGE_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
  });

  test('a video is bounded at 30 seconds', () => {
    expect(vm).toMatch(/MAX_VIDEO_DURATION_MS\s*=\s*30_000/);
  });

  /**
   * 1,000 characters — operator 2026-08-22, down from 2,000. Pinned on BOTH
   * sides: if they drift, somebody is refused by a server bound the app never
   * warned them about, after writing the whole thing.
   */
  test('the message bound is 1,000, agreed by client and server', () => {
    expect(vm).toMatch(/SUPPORT_MESSAGE_MAX_LENGTH\s*=\s*1000\b/);
    expect(codeOf(SERVER)).toMatch(/MAX_MESSAGE_LENGTH\s*=\s*1000\b/);
  });

  test('the count is live, and reads from the field rather than the trimmed text', () => {
    // A count that disagreed with what is on screen would be worse than none.
    expect(vm).toMatch(/characterCount[\s\S]{0,80}message\.length/);
    expect(vm).toMatch(/isOverCharacterLimit/);
  });

  test('ten files per ticket, agreed by client and server', () => {
    expect(vm).toMatch(/MAX_ATTACHMENTS\s*=\s*10\b/);
    expect(codeOf(SERVER)).toMatch(/MAX_ATTACHMENTS\s*=\s*10\b/);
  });

  /**
   * The blanket cap the operator replaced. Pinned OUT, not merely unused: a
   * single byte limit over images and video is the shape that was wrong, and it
   * would be an easy thing to reintroduce as "simpler".
   */
  test('the old flat 25 MB cap is gone', () => {
    expect(vm).not.toMatch(/MAX_ATTACHMENT_BYTES/);
    expect(vm).not.toMatch(/25\s*\*\s*1024\s*\*\s*1024/);
  });
});

describe('attachment limits — the copy says what the code does', () => {
  const en = (() => {
    const map = new Map();
    for (const { name, value } of readLocaleStrings('values').entries) map.set(name, value);
    return map;
  })();

  // Somebody told "under 25 MB" by a check that allows 5 has been given a
  // number they cannot act on. The copy and the constant must agree.
  test('the image refusal names 10 MB', () => {
    expect(en.get('support_form_error_image_too_large')).toMatch(/\b10\s*MB\b/);
  });

  test('the video refusal names 30 seconds', () => {
    expect(en.get('support_form_error_video_too_long')).toMatch(/\b30\s*seconds?\b/);
  });

  test('the too-many refusal names 10 files', () => {
    expect(en.get('support_form_error_attachment_too_many')).toMatch(/\b10\b/);
  });

  test('the limits are stated up front, with all three numbers', () => {
    const hint = en.get('support_attachment_limits') ?? '';
    expect(hint).toMatch(/\b10\s*files?\b/);
    expect(hint).toMatch(/\b10\s*MB\b/);
    expect(hint).toMatch(/\b30\s*seconds?\b/);
  });

  test('the 25 MB sentence is gone', () => {
    expect(en.has('support_form_error_attachment_too_large')).toBe(false);
  });

  describe.each(ALL_LOCALE_DIRS)('%s', (dir) => {
    const strings = new Map(readLocaleStrings(dir).entries.map((e) => [e.name, e.value]));
    test.each([
      'support_form_error_image_too_large',
      'support_form_error_video_too_long',
      'support_form_error_video_unreadable',
      'support_attachment_limits',
    ])('%s is present and says something', (key) => {
      expect(strings.has(key)).toBe(true);
      expect((strings.get(key) ?? '').trim()).not.toBe('');
    });
  });
});

describe('attachment limits — the picker offers photos and video, and nothing else', () => {
  test('Android uses the system photo picker in image-and-video mode', () => {
    const code = codeOf(ANDROID_PICKER);
    expect(code).toContain('PickVisualMedia.ImageAndVideo');
    // A generic chooser would put every file on the device in reach, which is
    // the rule dissolving rather than widening.
    expect(code).not.toMatch(/GetContent|OpenDocument|\*\/\*/);
  });

  test('iOS filters the photo picker to images and videos', () => {
    const code = codeOf(IOS_PICKER);
    expect(code).toContain('PHPickerFilter.imagesFilter');
    expect(code).toContain('PHPickerFilter.videosFilter');
    expect(code).not.toMatch(/UIDocumentPickerViewController/);
  });
});

describe('attachment limits — a video is actually measured', () => {
  /**
   * The limit that did not exist. Nothing read a duration anywhere, so the
   * 30-second rule had nothing to apply to — and a unit test with a hand-passed
   * duration is green either way, because it supplies the number the app never
   * obtains.
   */
  test('the picked-media type can carry a duration', () => {
    expect(codeOf(PICKED_MEDIA)).toMatch(/durationMs\s*:\s*Long\?/);
  });

  test('Android reads it from the file it just picked', () => {
    const code = codeOf(ANDROID_PICKER);
    expect(code).toContain('MediaMetadataRetriever');
    expect(code).toContain('METADATA_KEY_DURATION');
    // Bound to the READER, not merely to the field name. `durationMs =` alone
    // is satisfied by `durationMs = null`, so the first version of this
    // assertion SURVIVED a mutation that stopped reading the duration
    // altogether — which is precisely the defect that shipped.
    expect(code).toMatch(/durationMs\s*=\s*[^,]{0,140}videoDurationMs\(/);
    // A native handle per pick, ten on a ten-file selection.
    expect(code).toContain('.release()');
  });

  test('iOS reads it from the file it just picked', () => {
    const code = codeOf(IOS_PICKER);
    expect(code).toContain('AVURLAsset');
    expect(code).toContain('CMTimeGetSeconds');
    // Same trap as Android: bound to the reader, not the field name.
    expect(code).toMatch(/durationMs\s*=\s*[^,]{0,140}videoDurationMs\(/);
    // The measurement writes a temp file; leaving it behind means one copy of
    // every video picked, in the app container.
    expect(code).toContain('removeItemAtPath');
  });

  test('the ViewModel refuses a video it could not measure', () => {
    // Not "assumes it is fine". The rule cannot be honoured on a guess.
    expect(codeOf(VIEW_MODEL)).toMatch(
      /durationMs\s*==\s*null\s*->\s*UiText\.res\(Res\.string\.support_form_error_video_unreadable\)/,
    );
  });
});

describe('the admin can actually PLAY what somebody attached', () => {
  const ADMIN_HTML = 'public/admin/index.html';
  const SUPPORT_TAB = 'public/admin/js/tabs/support.js';

  /**
   * Video evidence was unplayable on EVERY admin tab, and had been all along.
   *
   * The page's CSP names `img-src 'self' https: data: blob: http://localhost:*`
   * but had no `media-src` at all — so media fell back to `default-src 'self'`
   * and every `<video>` was blocked before a request was made. Images loaded,
   * video did not, and the failure looked like a broken file: the lightbox's
   * own error handler swapped in "This video could not be played."
   *
   * That covers harassment-report evidence too, not just support attachments.
   */
  test('the CSP allows media, not only images', () => {
    const html = read(ADMIN_HTML);
    const csp = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? '';
    // Reported as an object so a failure NAMES what was missing. Jest's
    // `expect` takes ONE argument — a second is a Vitest habit and throws.
    expect({ found: csp !== '' }).toEqual({ found: true });
    expect(csp).toMatch(/media-src[^;]+/);

    // Media has to be at least as reachable as images, or the same class of
    // bug returns the next time an origin is added to one and not the other.
    const imgSrc = /img-src([^;]*)/.exec(csp)?.[1] ?? '';
    const mediaSrc = /media-src([^;]*)/.exec(csp)?.[1] ?? '';
    // `http:` is needed because attachments come from MinIO on this machine's
    // LAN address locally — a phone cannot reach `localhost`, so pinning the
    // CSP to `http://localhost:*` blocked every local image and video the
    // moment device testing started working. It costs nothing in production,
    // where the page is https and the browser blocks http subresources as
    // mixed content whatever the CSP permits.
    for (const origin of ['https:', 'http:', 'blob:']) {
      expect({
        origin,
        inImgSrc: imgSrc.includes(origin),
        inMediaSrc: mediaSrc.includes(origin),
      }).toEqual({ origin, inImgSrc: true, inMediaSrc: true });
    }
  });

  /**
   * `renderEvidence` produces the markup; the CLICK is separate, and the
   * Support tab never wired it. An admin saw a video thumbnail with a play
   * badge on it, clicked, and nothing happened — invisible in a screenshot,
   * and invisible to a test that only asks whether the thumbnail appeared.
   */
  test('support thumbnails open the lightbox, like appeals', () => {
    const tab = codeOf(SUPPORT_TAB);
    expect(tab).toContain('openEvidenceLightbox');
    expect(tab).toMatch(/evidence-thumb:not\(\[data-wired\]\)/);
    // Bound to the CALL, not the import: an import declares availability, not
    // use, and this file has already been caught by that distinction once.
    expect(tab).toMatch(/openEvidenceLightbox\(\s*thumb\.dataset\.evidenceUrl/);
  });
});

/**
 * The attachment limits, and the seams they depend on — SHY-0387, corrected by
 * the operator on 2026-08-22.
 *
 * | Limit | Value |
 * | --- | --- |
 * | files per ticket | 10 |
 * | image size | 5 MB |
 * | video length | 30 seconds, by DURATION |
 * | file types offered | photos and video only |
 *
 * Three things can each break these independently, and a unit test on the
 * ViewModel sees none of them:
 *
 *   1. the COPY can drift from the code, so somebody is told "under 5 MB" while
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

  test('an image is bounded at 5 MB', () => {
    expect(vm).toMatch(/MAX_IMAGE_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/);
  });

  test('a video is bounded at 30 seconds', () => {
    expect(vm).toMatch(/MAX_VIDEO_DURATION_MS\s*=\s*30_000/);
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
  test('the image refusal names 5 MB', () => {
    expect(en.get('support_form_error_image_too_large')).toMatch(/\b5\s*MB\b/);
  });

  test('the video refusal names 30 seconds', () => {
    expect(en.get('support_form_error_video_too_long')).toMatch(/\b30\s*seconds?\b/);
  });

  test('the too-many refusal names 10 files', () => {
    expect(en.get('support_form_error_attachment_too_many')).toMatch(/\b10\b/);
  });

  test('the limits are stated up front, with all three numbers', () => {
    const hint = en.get('support_attachment_limits') ?? '';
    expect(hint).toMatch(/\b10\b/);
    expect(hint).toMatch(/\b5\s*MB\b/);
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
    expect(code).toMatch(/durationMs\s*=/);
    // A native handle per pick, ten on a ten-file selection.
    expect(code).toContain('.release()');
  });

  test('iOS reads it from the file it just picked', () => {
    const code = codeOf(IOS_PICKER);
    expect(code).toContain('AVURLAsset');
    expect(code).toContain('CMTimeGetSeconds');
    expect(code).toMatch(/durationMs\s*=/);
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

/**
 * Clicking Android controls as ELEMENTS, not coordinates (SHY-0448).
 *
 * Operator, 2026-08-23: *"click via coordinates isn't the right way, it should
 * be elements with tags, like playwright works with browsers."*
 *
 * iOS has clicked elements through WebDriverAgent since SHY-0441. Android
 * could not: the adb backend's only gesture is `input tap x y`, so every tap
 * was a coordinate read off a dump a moment earlier. `tapResolved` re-reads the
 * tree first to narrow that window, but a window is all it can do — between
 * resolving a point and touching it, a list can scroll, a dialog can present,
 * and the finger lands on whatever moved into those pixels.
 *
 * The warm UiAutomator2 session added for reading (SHY-0447) also serves
 * `/element` and `/element/{id}/click`, so the point disappears entirely:
 * Appium resolves the control and clicks it server-side, in one operation.
 *
 * Measured on the real OnePlus: find 27ms, find+click 92ms, and the screen
 * demonstrably changed afterwards.
 *
 * ## Why UiSelector and not `id`
 *
 * Appium's `id` strategy wants a fully-qualified `package:id/name`. Compose
 * testTags are not that — they surface as a bare `resource-id` like
 * `support_back`, and both `id` and `accessibility id` return "An element
 * could not be located". `-android uiautomator` with
 * `new UiSelector().resourceId("support_back")` matches the raw string, which
 * is exactly what `byId` matches in the journeys.
 */

const {
  androidResourceIdSelector,
  androidTextSelector,
} = require('../../../scripts/drivers/android-source-session');

describe('androidResourceIdSelector', () => {
  test('builds the selector that actually matches a Compose testTag', () => {
    expect(androidResourceIdSelector('support_back')).toBe(
      'new UiSelector().resourceId("support_back")',
    );
  });

  test('a tag containing a quote cannot break out of the selector', () => {
    // The selector is a Java expression evaluated on the device. An unescaped
    // quote would either fail to parse or, worse, select something else.
    expect(androidResourceIdSelector('we"ird')).toBe(
      String.raw`new UiSelector().resourceId("we\"ird")`,
    );
  });

  test('a backslash is escaped before the quotes are', () => {
    // Order matters: escaping quotes first and backslashes second would
    // double-escape the backslash inserted by the first pass.
    expect(androidResourceIdSelector('a\\b')).toBe(String.raw`new UiSelector().resourceId("a\\b")`);
  });

  test('an empty tag is refused rather than matching everything', () => {
    // `resourceId("")` is a selector that matches nothing useful and reads in
    // a failure as "the element is absent", which is a different problem.
    expect(() => androidResourceIdSelector('')).toThrow(/tag/i);
    expect(() => androidResourceIdSelector(null)).toThrow(/tag/i);
  });
});

describe('androidTextSelector', () => {
  test('matches on exact text, the way byText does', () => {
    expect(androidTextSelector('Sign Out')).toBe('new UiSelector().text("Sign Out")');
  });

  test('escapes exactly as the resource-id selector does', () => {
    expect(androidTextSelector('say "hi"')).toBe(String.raw`new UiSelector().text("say \"hi\"")`);
  });

  test('empty text is refused', () => {
    expect(() => androidTextSelector('')).toThrow(/text/i);
  });
});

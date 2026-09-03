'use strict';

/**
 * SHY-0500 — the iOS keyboard was never dismissed, because the driver asked
 * Appium for a route Appium does not expose.
 *
 * `POST /session/:id/wda/keyboard/dismiss` is a WebDriverAgent endpoint the
 * xcuitest driver proxies INTERNALLY; a client posting it gets Appium's own
 * "No route found" 404, every time, on every iOS version. The driver's
 * best-effort tolerance then swallowed that 404 as "WDA would not dismiss the
 * keyboard", so J07 on the iPhone tapped a keyboard where the send button
 * should have been (2026-09-04, iOS 27.0's taller keyboard made it visible).
 *
 * The client-facing command is `mobile: hideKeyboard` through execute/sync.
 */

const { createIosJourneyDevice } = require('../../../scripts/drivers/ios-journey-device');

const TEST_HARDWARE_UDID = '00008150-000954D90A20401C';

const device = () =>
  createIosJourneyDevice({
    udid: 'A'.repeat(36),
    hardwareUdid: TEST_HARDWARE_UDID,
    bundleId: 'com.example',
    warn: () => {},
  });

describe('hideKeyboard speaks the command Appium actually routes', () => {
  test('posts mobile: hideKeyboard through execute/sync, naming the keys that close a keyboard', async () => {
    const d = device();
    const posts = [];
    d._post = async (p, body) => {
      posts.push([p, body]);
      return {};
    };
    await expect(d.hideKeyboard()).resolves.toBe(true);
    expect(posts).toHaveLength(1);
    const [route, body] = posts[0];
    expect(route).toBe('/execute/sync');
    expect(body.script).toBe('mobile: hideKeyboard');
    expect(body.args).toHaveLength(1);
    expect(body.args[0].keys).toEqual(expect.arrayContaining(['done', 'return']));
  });

  test('never asks for the raw WebDriverAgent route, which Appium answers with 404', async () => {
    const d = device();
    const routes = [];
    d._post = async (p) => {
      routes.push(p);
      return {};
    };
    await d.hideKeyboard();
    expect(routes.some((r) => r.includes('/wda/keyboard/dismiss'))).toBe(false);
  });
});

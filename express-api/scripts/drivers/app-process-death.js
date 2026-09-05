'use strict';

/**
 * The app under test is no longer running — a finding, not a transport error.
 *
 * Raised by both journey backends (`assertAppAlive` on the iOS driver and the
 * Android `Device`) so shared journey code, and the session-recovery paths that
 * would otherwise bring the app back in silence, can tell a dead app from a
 * dead WebDriverAgent or a flaky adb (SHY-0500 J40 step 8 / SHY-0523).
 */
class AppProcessDiedError extends Error {
  /**
   * @param {string} label what was being done when the death was noticed
   * @param {string} detail what died, what runs now, and the crash evidence
   * @param {ErrorOptions} [options] `cause`: the transport error that led here
   */
  constructor(label, detail, options) {
    super(`${label}: ${detail}`, options);
    this.name = 'AppProcessDiedError';
    this.label = label;
    this.detail = detail;
  }
}

module.exports = { AppProcessDiedError };

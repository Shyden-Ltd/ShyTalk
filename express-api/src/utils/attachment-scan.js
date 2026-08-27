/**
 * Scanning a file a stranger uploaded, before a member of staff opens it
 * (SHY-0420).
 *
 * ## The state of this, stated plainly
 *
 * **No scanning engine is wired.** Choosing one is a decision for the operator,
 * not for this file, because the trade-off is not technical:
 *
 * | Option | Cost | Latency | Where the file goes |
 * | --- | --- | --- | --- |
 * | Self-hosted ClamAV | a box and its upkeep; free software | a second or two, ours to tune | never leaves our infrastructure |
 * | Hosted scanning API | per-scan fee | a network round trip | **the file leaves our infrastructure** |
 *
 * The last column is the whole decision. The files here can include images of
 * real people, of minors, and of abuse — sending those to a third party is a
 * data-protection and safeguarding judgement that belongs to the operator.
 * Recommendation on record: **self-hosted ClamAV**, precisely because the
 * files never leave.
 *
 * ## What this file does in the meantime
 *
 * It is the SEAM, so wiring an engine is a configuration change rather than a
 * refactor — and it is LOUD about being unconfigured. `scanningIsConfigured()`
 * answers honestly, the startup log says so once, and nothing anywhere claims
 * a file was scanned when it was not.
 *
 * It deliberately does NOT refuse everything while unconfigured: that would
 * take support attachments away entirely, which is a worse outcome than the
 * status quo it is meant to improve. The exposure is unchanged from today and
 * now visible, rather than unchanged and invisible.
 */

'use strict';

const log = require('./log');

/** Set to the engine's endpoint to turn scanning on. */
const SCANNER_URL = process.env.ATTACHMENT_SCANNER_URL || '';

let announced = false;

function scanningIsConfigured() {
  return SCANNER_URL.length > 0;
}

/**
 * Say once, at the first attachment, whether files are being scanned.
 *
 * A silent unconfigured scanner is how somebody comes to believe they have
 * scanning. This makes the absence appear in the logs of every environment
 * that handles a file.
 */
function announceScanningState() {
  if (announced) return;
  announced = true;
  if (scanningIsConfigured()) {
    log.info('attachment-scan', 'Attachment scanning is ON', { scanner: SCANNER_URL });
  } else {
    log.warn(
      'attachment-scan',
      'Attachment scanning is NOT configured — files uploaded by strangers are ' +
        'stored and shown to staff unscanned. Set ATTACHMENT_SCANNER_URL to enable it (SHY-0420).',
    );
  }
}

/**
 * @returns {Promise<{scanned: boolean, clean: boolean, reason: string|null}>}
 *   `scanned:false` means no engine ran — never conflate that with a pass.
 */
async function scanAttachment(key) {
  announceScanningState();
  if (!scanningIsConfigured()) {
    return { scanned: false, clean: true, reason: 'scanner not configured' };
  }
  try {
    const res = await fetch(`${SCANNER_URL}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) throw new Error(`scanner answered ${res.status}`);
    const body = await res.json();
    return { scanned: true, clean: body.clean === true, reason: body.reason ?? null };
  } catch (err) {
    // FAILS CLOSED once an engine is configured. Having chosen to scan, a
    // scanner that cannot answer must not become a way past it.
    log.error('attachment-scan', 'Scan failed; refusing the attachment', { error: err.message });
    return { scanned: true, clean: false, reason: 'the file could not be checked' };
  }
}

module.exports = {
  scanAttachment,
  scanningIsConfigured,
  announceScanningState,
  _resetAnnouncedForTests: () => {
    announced = false;
  },
};

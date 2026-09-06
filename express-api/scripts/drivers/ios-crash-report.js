'use strict';

/**
 * What the iPhone says about the app's PROCESS, as opposed to its screen.
 *
 * WebDriverAgent sees a screen. When the app under test dies, the next WDA
 * call fails with the same "session lost" shape a WDA restart produces, and
 * the driver's recovery path used to answer both the same way: open a new
 * session — which, on XCUITest, LAUNCHES the app again. The journey then
 * judged the second launch's first frame and reported a pass over a crash
 * (SHY-0523: J40 step 8 on the iPhone, 2026-09-05).
 *
 * These helpers make the two cases distinguishable from the process side:
 * the pid `devicectl device process launch --json-output` reports, the
 * `devicectl device info processes --json-output` listing, and the `.ips`
 * crash reports `idevicecrashreport -k` copies off the device (they land
 * under `Retired/`). They are pure — every I/O boundary is a JSON document or
 * a directory — so the device driver stays the only place that shells out.
 */

const fs = require('node:fs');
const path = require('node:path');

const KOTLIN_FRAME_RE = /^kfun:/;
const IPS_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)? ([+-]\d{2})(\d{2})$/;
const MAX_TOP_FRAMES = 4;
const MAX_KOTLIN_FRAMES = 6;
const QUOTE_LIMIT = 300;

const quote = (value) => JSON.stringify(value ?? null).slice(0, QUOTE_LIMIT);

const devicectlFailureReason = (json) => {
  const info = json?.error?.userInfo;
  return info?.NSLocalizedFailureReason?.string || info?.NSLocalizedDescription?.string || null;
};

/**
 * The pid `xcrun devicectl device process launch --json-output` reports.
 * A launch that reports none did not launch: the error carries devicectl's
 * own reason (for example "is not installed") so the run says why.
 */
function launchedProcessId(launchJson) {
  const pid = launchJson?.result?.process?.processIdentifier;
  if (Number.isInteger(pid) && pid > 0) return pid;
  const reason = devicectlFailureReason(launchJson);
  throw new Error(
    `devicectl launch reported no process identifier${reason ? `: ${reason}` : ''} (got ${quote(launchJson)})`,
  );
}

const executableBasename = (fileUrl) => {
  const raw = path.posix.basename(String(fileUrl ?? ''));
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * The running process whose executable is `executableName`, from
 * `xcrun devicectl device info processes --json-output`, or null when the app
 * is not running. A listing without `result.runningProcesses` is refused
 * rather than read as "not running": a malformed answer must never pass for a
 * dead app.
 */
function findRunningProcess(processesJson, executableName) {
  const list = processesJson?.result?.runningProcesses;
  if (!Array.isArray(list)) {
    throw new Error(
      `devicectl process listing has no result.runningProcesses (got ${quote(processesJson)})`,
    );
  }
  for (const entry of list) {
    if (executableBasename(entry.executable) !== executableName) continue;
    return { pid: entry.processIdentifier, executable: String(entry.executable) };
  }
  return null;
}

/** Split a `.ips` report into its header line and JSON body. */
function parseCrashReport(text) {
  const source = String(text ?? '');
  const newline = source.indexOf('\n');
  if (newline < 0) {
    throw new Error('not a .ips crash report: expected a JSON header line followed by a JSON body');
  }
  let header;
  let body;
  try {
    header = JSON.parse(source.slice(0, newline));
    body = JSON.parse(source.slice(newline + 1));
  } catch (e) {
    throw new Error(`not a .ips crash report: ${e.message}`, { cause: e });
  }
  if (!header || typeof header !== 'object' || !body || typeof body !== 'object') {
    throw new Error('not a .ips crash report: the header and the body must both be JSON objects');
  }
  return { header, body };
}

/** The header's `timestamp` ("2026-09-05 10:27:48.00 +0700") as epoch milliseconds. */
function crashReportTimestampMs(header) {
  const match = IPS_TIMESTAMP_RE.exec(String(header?.timestamp ?? ''));
  let ms = Number.NaN;
  if (match) {
    const [, date, time, fraction, zoneHours, zoneMinutes] = match;
    const millis = fraction ? `.${`${fraction.slice(1)}00`.slice(0, 3)}` : '';
    ms = Date.parse(`${date}T${time}${millis}${zoneHours}:${zoneMinutes}`);
  }
  if (!Number.isFinite(ms)) {
    throw new Error(
      `crash report header has no parsable timestamp (got ${quote(header?.timestamp)})`,
    );
  }
  return ms;
}

/**
 * The facts a failing step needs from a crash report: who died, of what, and
 * the faulting thread's frames — with the Kotlin (`kfun:`) frames singled out,
 * because on a Kotlin/Native app they are the ones that name our code.
 */
function summarizeCrashReport(text) {
  const { header, body } = parseCrashReport(text);
  const thread = Array.isArray(body.threads) ? body.threads[body.faultingThread ?? 0] : undefined;
  const images = Array.isArray(body.usedImages) ? body.usedImages : [];
  const frames = (thread?.frames ?? []).map(
    (frame) =>
      frame.symbol ||
      `${images[frame.imageIndex]?.name ?? 'image'}+0x${Number(frame.imageOffset ?? 0).toString(16)}`,
  );
  const asi =
    body.asi && typeof body.asi === 'object'
      ? Object.entries(body.asi)
          .map(([library, lines]) => `${library}: ${[].concat(lines).join(' / ')}`)
          .join('; ')
      : null;
  return {
    app: header.app_name ?? header.name ?? null,
    bundleId: header.bundleID ?? null,
    pid: body.pid ?? null,
    timestampMs: crashReportTimestampMs(header),
    signal: body.exception?.signal ?? null,
    exceptionType: body.exception?.type ?? null,
    terminationIndicator: body.termination?.indicator ?? null,
    asi,
    frames,
    kotlinFrames: frames.filter((frame) => KOTLIN_FRAME_RE.test(frame)),
  };
}

/** One line: the signal, the abort reason, the top frames and the Kotlin frames. */
function formatCrashSummary(summary) {
  const detail = [summary.exceptionType, summary.terminationIndicator].filter(Boolean).join(', ');
  const parts = [`${summary.signal ?? 'unknown signal'}${detail ? ` (${detail})` : ''}`];
  if (summary.asi) parts.push(summary.asi);
  if (summary.frames.length)
    parts.push(`top frames: ${summary.frames.slice(0, MAX_TOP_FRAMES).join(' <- ')}`);
  if (summary.kotlinFrames.length) {
    parts.push(`Kotlin frames: ${summary.kotlinFrames.slice(0, MAX_KOTLIN_FRAMES).join(' <- ')}`);
  }
  return parts.join(' | ').replace(/\s*\n\s*/g, ' ');
}

const listIpsFiles = (dir, appName, into) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listIpsFiles(full, appName, into);
    else if (entry.isFile() && entry.name.startsWith(`${appName}-`) && entry.name.endsWith('.ips'))
      into.push(full);
  }
  return into;
};

/**
 * The app's `.ips` reports under `dir` (recursively — idevicecrashreport files
 * them under `Retired/`) written at or after `sinceMs`, newest first. A
 * directory that was never written to yields nothing; an unreadable report
 * throws, because a corrupt report for THIS app is itself a finding.
 */
function findCrashReportsSince(dir, appName, sinceMs) {
  if (!fs.existsSync(dir)) return [];
  const reports = [];
  for (const file of listIpsFiles(dir, appName, [])) {
    const { header, body } = parseCrashReport(fs.readFileSync(file, 'utf8'));
    if (header.app_name && header.app_name !== appName) continue;
    const timestampMs = crashReportTimestampMs(header);
    if (timestampMs < sinceMs) continue;
    reports.push({ path: file, timestampMs, pid: body.pid ?? null });
  }
  return reports.sort((a, b) => b.timestampMs - a.timestampMs);
}

/**
 * The detail an `AppProcessDiedError` carries when the app process is gone;
 * the caller prefixes what it was doing.
 *
 * @param {object} death
 * @param {number|null} death.launchedPid the pid recorded at launch, if any
 * @param {number|null} death.launchedAt epoch ms of that launch
 * @param {{pid:number}|null} death.running the iosApp process running NOW, if any
 * @param {{path:string, summary:object}|null} death.report the newest crash report since the launch
 */
function describeAppDeath({ launchedPid, launchedAt, running, report }) {
  const launched = launchedPid
    ? `pid ${launchedPid}${launchedAt ? ` (launched ${new Date(launchedAt).toISOString()})` : ''} is gone`
    : 'the launch pid was not recorded (the app was brought up by activate_app)';
  const now = running
    ? `a different iosApp process (pid ${running.pid}) is running now: something relaunched the app after it died, ` +
      'so the next screen read belongs to a SECOND launch'
    : 'no iosApp process is running';
  const cause = report
    ? `Crash report ${report.path}: ${formatCrashSummary(report.summary)}`
    : 'No iosApp crash report newer than the launch was found on the device (idevicecrashreport -k): ' +
      'the process may have been killed by the system or have exited on its own.';
  return (
    `the app process died. ${launched} and ${now}. ` +
    'Any WebDriverAgent error here means it lost its session because the app crashed, not because WebDriverAgent restarted. ' +
    cause
  );
}

module.exports = {
  launchedProcessId,
  findRunningProcess,
  parseCrashReport,
  crashReportTimestampMs,
  summarizeCrashReport,
  formatCrashSummary,
  findCrashReportsSince,
  describeAppDeath,
};

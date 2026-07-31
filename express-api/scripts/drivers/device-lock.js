/**
 * Cross-process mutual exclusion for one physical device.
 *
 * Operator 2026-08-01: "make sure this cannot happen again."
 *
 * The gauntlet wedged with two of these live against the same phone:
 *
 *   adb -s 3b402284 shell uiautomator dump --compressed /sdcard/dump.xml
 *   adb -s 3b402284 shell uiautomator dump --compressed /sdcard/dump.xml
 *
 * `uiautomator dump` needs an exclusive UiAutomation connection. The second
 * one cannot get it, and the pair deadlocked — three matrix cells parked at 58
 * scenarios for eight minutes with the phone visibly thrashing.
 *
 * The root cause was that `--driver=all` attaches an Android driver to EVERY
 * cell while matrix-dispatch groups cells by browser slug and runs them in
 * parallel, believing they touch different hardware. That is fixed separately.
 * This file is the guarantee that does not depend on anyone remembering: even
 * if two holders appear again, they take turns instead of deadlocking.
 *
 * It must be a FILE lock, not a mutex — matrix cells are separate OS processes
 * (matrix-cell-dispatch spawns each one), so no in-process primitive can see a
 * sibling.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// A held lock older than this is assumed abandoned. Generous, because a real
// UI dump on a cold-starting app can legitimately take a while; the pid-liveness
// check below is what reclaims the common case (a SIGKILLed cell) promptly.
const DEFAULT_STALE_MS = 120000;
// How long to wait for a live holder before giving up. Longer than any single
// device operation should take, so a timeout means something is genuinely wrong.
const DEFAULT_TIMEOUT_MS = 180000;
const POLL_MS = 50;

/**
 * Lock file path for a device serial.
 *
 * The serial is device-reported, so it is reduced to a safe basename rather
 * than trusted: `../../etc/passwd` must not escape tmpdir. A blank serial is
 * rejected outright — silently collapsing it to one shared key would make every
 * device contend on the same lock and look like a mysterious global stall.
 */
function lockPathFor(serial) {
  const s = String(serial ?? '').trim();
  if (!s) throw new Error('device-lock: a device serial is required');
  const safe = s.replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(os.tmpdir(), `shytalk-device-${safe}.lock`);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    // Signal 0 tests for existence + permission without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to another user — still alive.
    return e.code === 'EPERM';
  }
}

function readHolder(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    // Unreadable or corrupt: treat as an abandoned lock rather than blocking on
    // it forever. A garbled file cannot tell us who holds the device.
    return null;
  }
}

/** True if this lock file no longer represents a live holder. */
function isStale(holder, staleMs) {
  if (!holder || typeof holder !== 'object') return true;
  if (!isPidAlive(holder.pid)) return true;
  // pid numbers are recycled over a long run, so age is the backstop.
  return !(typeof holder.at === 'number') || Date.now() - holder.at > staleMs;
}

/** Attempts one atomic acquire. Returns the token on success, null if held. */
function tryAcquire(lockPath, staleMs) {
  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, token, at: Date.now() });
  try {
    // 'wx' fails if the file exists — the atomicity this whole module rests on.
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
    return token;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  if (isStale(readHolder(lockPath), staleMs)) {
    // Reclaim, then re-race: another waiter may reclaim at the same moment, and
    // only one of us can win the exclusive create that follows.
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* someone else reclaimed it first */
    }
    try {
      fs.writeFileSync(lockPath, payload, { flag: 'wx' });
      return token;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  return null;
}

/**
 * Runs `fn` with exclusive access to `serial`, releasing on success or throw.
 *
 * Throws rather than proceeding when the device cannot be acquired: running
 * unguarded is exactly the deadlock this exists to prevent, so a timeout must
 * be loud and name the holder.
 */
async function withDeviceLock(serial, fn, { timeoutMs, staleMs } = {}) {
  const lockPath = lockPathFor(serial);
  const budget = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const stale = Number.isFinite(staleMs) ? staleMs : DEFAULT_STALE_MS;
  const deadline = Date.now() + budget;

  let token = tryAcquire(lockPath, stale);
  while (token === null) {
    if (Date.now() >= deadline) {
      const holder = readHolder(lockPath);
      throw new Error(
        `device-lock: device ${serial} is held by pid ${holder?.pid ?? 'unknown'} ` +
          `(since ${holder?.at ? new Date(holder.at).toISOString() : 'unknown'}); ` +
          `gave up after ${budget}ms. Refusing to drive it concurrently — two ` +
          `uiautomator dumps on one device deadlock.`,
      );
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    token = tryAcquire(lockPath, stale);
  }

  try {
    return await fn();
  } finally {
    // Release ONLY if the lock is still ours. If we were declared stale and
    // someone else took over, deleting their lock would leave them running
    // unguarded on a device that now looks free — the bug this check prevents.
    const holder = readHolder(lockPath);
    if (holder && holder.token === token) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  }
}

module.exports = { withDeviceLock, lockPathFor, isPidAlive, isStale, DEFAULT_STALE_MS };

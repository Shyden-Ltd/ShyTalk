#!/usr/bin/env node
/* eslint-disable no-console -- developer-facing CLI; console output is the interface. */
/**
 * SHY-0263 — test preflight: reclaim abandoned memory tenants, then refuse to
 * start a full run the host cannot actually support.
 *
 * Why this exists: the suite is the mechanism by which every other defect is
 * caught, so a run whose verdict depends on how much memory happened to be free
 * is not evidence about the code. On 2026-07-31 the same commit produced 432/432
 * in 366s, 432/432 in 3382s, and a 140-timeout collapse — with no code change.
 *
 * Usage:
 *   node scripts/preflight/index.js            # measure, reclaim, verdict
 *   node scripts/preflight/index.js --report   # measure only, never kill, never fail
 */
const { execFileSync } = require('child_process');
const path = require('path');

const { summariseHostMemory } = require('./host-memory');
const { STACK_PORTS, parseProcessSnapshot, findReclaimableTenants } = require('./tenant-reclaim');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/**
 * Pure verdict logic, kept separate from the I/O so it can be tested directly.
 *
 * ⚠️ ADVISORY BY DEFAULT (corrected 2026-07-31 after measurement).
 *
 * The first cut refused whenever free memory was low. That threshold is wrong
 * on macOS: the OS deliberately keeps `unused` near zero, spending spare RAM on
 * cache and the compressor, because free RAM is wasted RAM. Proof from this
 * machine — reclaiming 1.74 GB from Docker's VM moved swap 3133 MB → 1681 MB
 * (real, large improvement) while `unused` stayed at ~100 MB throughout. A gate
 * on `unused` would therefore refuse essentially every run forever.
 *
 * Until there is a measured HEALTHY baseline to calibrate against, this
 * reclaims and reports but does not block. `PREFLIGHT_STRICT=1` opts in to
 * blocking. Shipping an uncalibrated gate that stops all local testing is worse
 * than the bug it was meant to prevent.
 */
function decidePreflight({ platform, ci, starvedBefore, starvedAfter, reclaimed, strict = false }) {
  if (platform !== 'darwin') {
    return { action: 'skip', ok: true, why: `no macOS memory probes on ${platform}` };
  }
  if (ci) {
    return {
      action: 'skip',
      ok: true,
      why: 'CI runners are provisioned per-job; no orphans to reclaim',
    };
  }
  if (!starvedBefore) {
    return { action: 'proceed', ok: true, why: 'host has headroom' };
  }
  if (!starvedAfter) {
    return {
      action: 'reclaimed',
      ok: true,
      why: `reclaimed ${reclaimed.length} tenant(s); host now has headroom`,
    };
  }
  if (!strict) {
    return {
      action: 'warn',
      ok: true,
      why: 'host memory looks tight — reporting, not blocking (set PREFLIGHT_STRICT=1 to block)',
    };
  }
  return { action: 'refuse', ok: false, why: 'host still short of memory after reclamation' };
}

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

const censusCmd = () =>
  sh('top', ['-l', '1', '-o', 'mem', '-n', '25', '-stats', 'pid,mem,cmprs,command']);
const physMemCmd = () => sh('top', ['-l', '1', '-n', '0']);
const psCmd = () => sh('ps', ['-Ao', 'pid=,ppid=,rss=,etime=,command=']);

/** Every pid holding a stack port. Iterate the FULL list — a port can have several holders. */
function portHolderPids() {
  const pids = new Set();
  for (const port of STACK_PORTS) {
    for (const line of sh('lsof', ['-ti', `tcp:${port}`]).split('\n')) {
      if (line.trim()) pids.add(Number(line.trim()));
    }
  }
  return pids;
}

/** Real cwd per candidate pid, so another project's `node src/index.js` is never touched. */
function cwdsFor(pids) {
  const map = new Map();
  for (const pid of pids) {
    const out = sh('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
    const line = out.split('\n').find((l) => l.startsWith('n'));
    if (line) map.set(pid, line.slice(1));
  }
  return map;
}

/** True while the pid still exists. Signal 0 tests existence without delivering. */
function stillAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Block until every pid has exited, or the deadline passes. Polls the real
 * condition rather than sleeping a guessed interval; bounded so a process that
 * ignores SIGTERM cannot hang the preflight.
 */
function waitForExit(pids, timeoutMs = 10000) {
  if (pids.length === 0) return;
  const deadline = Date.now() + timeoutMs;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    if (!pids.some(stillAlive)) return;
    // Blocks this thread for 200ms without spawning anything and without a
    // busy loop. Atomics.wait on a value that never changes always times out.
    Atomics.wait(pause, 0, 0, 200);
  }
}

function describe(mem) {
  if (!mem) return 'unknown';
  return `${Math.round(mem.unusedMb)} MB free, ${Math.round(mem.compressorMb)} MB compressed`;
}

function main() {
  const reportOnly = process.argv.includes('--report');
  const platform = process.platform;
  const ci = Boolean(process.env.CI);
  const strict = Boolean(process.env.PREFLIGHT_STRICT);

  if (platform !== 'darwin' || ci) {
    const verdict = decidePreflight({
      platform,
      ci,
      starvedBefore: false,
      starvedAfter: false,
      reclaimed: [],
    });
    console.log(`[preflight] skipped — ${verdict.why}`);
    return 0;
  }

  const before = summariseHostMemory({ census: censusCmd(), physMem: physMemCmd() });
  console.log(`[preflight] host: ${describe(before.mem)}`);

  // Candidates are found first, then their cwds resolved — resolving cwd for
  // every process on the machine would be hundreds of lsof calls.
  const procs = parseProcessSnapshot(psCmd());
  const holders = portHolderPids();
  const candidates = findReclaimableTenants(procs, { portHolderPids: holders });
  const cwdByPid = cwdsFor(candidates.map((c) => c.pid));
  const targets = findReclaimableTenants(procs, {
    portHolderPids: holders,
    cwdByPid,
    repoRoot: REPO_ROOT,
  });

  if (targets.length === 0) {
    console.log('[preflight] no reclaimable tenants found');
  }

  const reclaimed = [];
  for (const t of targets) {
    if (reportOnly) {
      console.log(`[preflight] would reclaim ${t.kind} pid=${t.pid} (${t.reason})`);
      continue;
    }
    try {
      process.kill(t.pid, 'SIGTERM');
      reclaimed.push(t);
      console.log(`[preflight] reclaimed ${t.kind} pid=${t.pid} (${t.reason})`);
    } catch (err) {
      // Never fail the run because a tenant could not be reclaimed — it may
      // simply have exited between the census and the signal.
      console.log(`[preflight] could not reclaim pid=${t.pid}: ${err.message}`);
    }
  }

  // Wait for the signalled processes to actually exit before re-measuring.
  // Condition-based, never a fixed sleep: SIGTERM returns immediately, so a
  // census taken straight afterwards measures processes that are still dying
  // and reports that reclamation achieved nothing.
  waitForExit(reclaimed.map((t) => t.pid));

  const after = summariseHostMemory({ census: censusCmd(), physMem: physMemCmd() });
  const verdict = decidePreflight({
    platform,
    ci,
    starvedBefore: before.starved,
    starvedAfter: after.starved,
    reclaimed,
    strict,
  });

  if (verdict.ok) {
    console.log(`[preflight] OK — ${verdict.why} (${describe(after.mem)})`);
    if (verdict.action === 'warn' || after.degraded) {
      // Warn, never refuse: this threshold has no healthy baseline yet.
      console.log(
        `[preflight] note: ${Math.round(after.mem.compressorMb)} MB compressed — the host is ` +
          'holding more than it comfortably fits. If this run is unusually slow, that is why.',
      );
    }
    return 0;
  }

  if (reportOnly) {
    console.log(`[preflight] would REFUSE — ${verdict.why} (${describe(after.mem)})`);
    console.log('[preflight] largest tenants by real footprint (NOT rss):');
    for (const t of after.topTenants) {
      console.log(
        `[preflight]   ${String(Math.round(t.footprintMb)).padStart(5)} MB  ${t.command}`,
      );
    }
    return 0;
  }

  // One message per run, naming what is holding the memory. A bare refusal
  // sends the next person hunting through the suite for a bug that is not there.
  console.error('');
  console.error(`[preflight] REFUSING TO RUN — ${verdict.why}`);
  console.error(`[preflight] ${describe(after.mem)}`);
  console.error('[preflight] largest tenants by real footprint (NOT rss):');
  for (const t of after.topTenants) {
    console.error(
      `[preflight]   ${String(Math.round(t.footprintMb)).padStart(5)} MB  ${t.command}`,
    );
  }
  console.error('');
  console.error('[preflight] A run started now would either collapse into timeouts or pass');
  console.error('[preflight] 9x slower than normal, and neither outcome is evidence about');
  console.error('[preflight] the code. Free memory and re-run. See SHY-0263.');
  console.error('[preflight] Set PREFLIGHT_SKIP=1 to override deliberately.');
  return 1;
}

if (require.main === module) {
  const code = process.env.PREFLIGHT_SKIP ? 0 : main();
  process.exit(code);
}

module.exports = { decidePreflight, REPO_ROOT };

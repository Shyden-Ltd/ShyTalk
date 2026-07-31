/**
 * SHY-0263 — find memory tenants that can be safely reclaimed before a full run.
 *
 * `local/start.sh` manufactures its own poison: step 8/8 installs the Android app,
 * which spawns Gradle + Kotlin compile daemons that detach to ppid=1 and outlive
 * the stack. Measured 2026-07-31 they held 1298 MB and 942 MB while reporting
 * ~53 MB and ~12 MB RSS, so they sat unnoticed in every process listing taken that
 * day. Between them they starved the emulator the same script had just started.
 *
 * DESIGN: default-deny. A process is reclaimed only when it matches a positive
 * orphan signature AND survives every exclusion. Getting this wrong in the other
 * direction — killing the live emulator — would "free memory" and destroy the run,
 * presenting as exactly the capacity failure this preflight exists to prevent.
 */

/** Every port local/start.sh binds. A holder of any of these is in use, full stop. */
const STACK_PORTS = [3000, 4000, 4400, 4500, 5001, 7880, 8080, 8888, 9000, 9099, 9150, 9199];

/** Below this age a detached node process is far more likely live than abandoned. */
const STALE_NODE_SECONDS = 4 * 60 * 60;

/**
 * Never reclaimed, whatever else matches. Defence in depth: the ppid and port
 * checks should already protect these, but a live process that gets reparented
 * to init must not become eligible just because its parent died.
 */
const LIVE_STACK_SIGNATURES = [
  /cloud-firestore-emulator.*\.jar/,
  /database-emulator.*\.jar/,
  /firebase-database-emulator/,
  /ui-v\d.*\.jar|firebase.*emulator-ui/,
  /firebase\s+emulators:start/,
  /npm exec firebase/,
  /local\/serve-web\.js/,
];

/**
 * Positive orphan signatures. Deliberately narrow.
 *
 * Note what is NOT here: a generic "old node process" rule. `appium` runs as
 * ppid=1 for days at a time and is exactly what iOS device journeys need, so a
 * rule that broad would break device testing to save memory.
 */
const RECLAIMABLE = [
  { kind: 'gradle-daemon', match: /GradleDaemon/, requiresOrphaned: true },
  {
    kind: 'kotlin-daemon',
    match: /kotlin-build-tools-compat|KotlinCompileDaemon/,
    requiresOrphaned: true,
  },
  // The two node rules match on a relative path that any project could produce,
  // so they additionally require the process to be rooted in this repo. The two
  // daemon rules above do NOT: `GradleDaemon` in argv is unambiguous, and a
  // Gradle daemon's cwd is legitimately ~/.gradle/daemon/<version>, outside the
  // repo entirely — requiring a repo cwd there would shield the exact orphan
  // this ticket exists to reclaim.
  {
    kind: 'stale-express-api',
    match: /node\s+(--env-file=\S+\s+)?src\/index\.js/,
    requiresOrphaned: true,
    requiresRepoCwd: true,
    minAgeSeconds: STALE_NODE_SECONDS,
  },
  {
    kind: 'stale-web-server',
    match: /node_modules\/\.bin\/serve|npm exec serve/,
    requiresOrphaned: true,
    requiresRepoCwd: true,
    minAgeSeconds: STALE_NODE_SECONDS,
  },
];

/**
 * ps renders elapsed time as MM:SS, HH:MM:SS or D-HH:MM:SS. A parser that assumes
 * one shape reads a 2-day-old orphan as 2 seconds old, or the reverse — and the
 * age check is the only thing separating a live Express API from an abandoned one.
 */
function parseEtimeSeconds(etime) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(etime).trim());
  if (!match) return NaN;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days || 0) * 86400 + Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds)
  );
}

/** Parse `ps -Ao pid=,ppid=,rss=,etime=,command=`. */
function parseProcessSnapshot(text) {
  return String(text)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      // Split on whitespace rather than one pattern ending in `(.*)$`: argv is
      // arbitrarily long and that shape backtracks super-linearly.
      const parts = line.trim().split(/\s+/);
      const [pidRaw, ppidRaw, rssRaw, etime, ...commandParts] = parts;
      if (parts.length < 4 || !/^\d+$/.test(pidRaw) || !/^\d+$/.test(ppidRaw)) {
        return { pid: NaN, ppid: NaN, rssKb: NaN, etime: '', etimeSeconds: NaN, command: line };
      }
      return {
        pid: Number(pidRaw),
        ppid: Number(ppidRaw),
        rssKb: Number(rssRaw),
        etime,
        etimeSeconds: parseEtimeSeconds(etime),
        // Full argv, never truncated: both the emulator JVM and the Gradle
        // daemon are just "java" at argv[0], so identity lives in the arguments.
        command: commandParts.join(' '),
      };
    });
}

/**
 * Every reason a process must be left alone, in one place so each can be tested
 * on its own. Returns the protecting reason, or null when nothing protects it.
 *
 * Exported because the guards are the safety-critical part: a test that asserts
 * "this pid was not reclaimed" can pass because a DIFFERENT guard caught it,
 * leaving the intended one untested. Asking each guard directly avoids that.
 */
function isProtected(proc, { portHolderPids = new Set() } = {}) {
  if (!Number.isInteger(proc.pid) || proc.pid <= 1) return 'reserved pid';
  if (proc.pid === process.pid || proc.pid === process.ppid) return 'self or parent';
  if (portHolderPids.has(proc.pid)) return 'holds a stack port';
  if (LIVE_STACK_SIGNATURES.some((re) => re.test(proc.command))) return 'live stack process';
  return null;
}

/**
 * argv alone cannot tell ShyTalk's `node src/index.js` from any other project's.
 * Rules that match on such a path require the process to be rooted in this repo.
 * Fails closed: an unreadable cwd is not permission to kill.
 */
function isOutsideRepo(proc, { cwdByPid, repoRoot }) {
  if (!cwdByPid || !repoRoot) return false;
  const cwd = cwdByPid.get(proc.pid);
  return !cwd || !cwd.startsWith(repoRoot);
}

/**
 * @param {Array} procs            Output of parseProcessSnapshot.
 * @param {object} options
 * @param {Set<number>} options.portHolderPids  pids currently holding a stack port.
 * @param {Map<number,string>} [options.cwdByPid] Real cwds, when the caller has them.
 * @param {string} [options.repoRoot]             Absolute path this repo lives at.
 * @returns {Array<{pid:number, kind:string, reason:string, rssKb:number, command:string}>}
 */
function findReclaimableTenants(procs, options = {}) {
  const { portHolderPids = new Set(), cwdByPid = null, repoRoot = null } = options;
  const found = [];

  for (const proc of procs) {
    if (isProtected(proc, { portHolderPids })) continue;

    for (const rule of RECLAIMABLE) {
      if (!rule.match.test(proc.command)) continue;
      if (rule.requiresOrphaned && proc.ppid !== 1) continue;
      if (rule.minAgeSeconds && !(proc.etimeSeconds >= rule.minAgeSeconds)) continue;
      if (rule.requiresRepoCwd && isOutsideRepo(proc, { cwdByPid, repoRoot })) continue;

      const age = rule.minAgeSeconds ? `, ${Math.round(proc.etimeSeconds / 3600)}h old` : '';
      found.push({
        pid: proc.pid,
        kind: rule.kind,
        reason: `orphaned (ppid=1)${age}`,
        // Recorded for the log only. Never used as a threshold — see
        // feedback-measure-footprint-not-rss-under-memory-pressure.
        rssKb: proc.rssKb,
        command: proc.command,
      });
      break;
    }
  }

  return found;
}

module.exports = {
  STACK_PORTS,
  STALE_NODE_SECONDS,
  LIVE_STACK_SIGNATURES,
  parseEtimeSeconds,
  parseProcessSnapshot,
  isProtected,
  findReclaimableTenants,
};

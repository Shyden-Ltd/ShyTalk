/**
 * SHY-0263 — the reclaimer must free memory without ever touching the live stack.
 *
 * This is the highest-risk part of the fix. Killing the running emulator "frees
 * memory" and destroys the run, and it would present as exactly the capacity
 * failure the preflight exists to prevent. So the exclusion assertions here
 * matter more than the detection ones.
 *
 * Fixtures are real captured `ps` output from the machine the bug was diagnosed
 * on — see tests/fixtures/preflight/README.md for provenance. Pure logic over
 * real data; no process is spawned or signalled by this file.
 */
const fs = require('fs');
const path = require('path');

const {
  parseProcessSnapshot,
  findReclaimableTenants,
  isProtected,
  STACK_PORTS,
} = require('../../scripts/preflight/tenant-reclaim');

const FIXTURE = path.join(__dirname, '../fixtures/preflight/ps-snapshot-2026-07-31.txt');
const snapshot = fs.readFileSync(FIXTURE, 'utf8');

// Recorded at capture time — see the fixture README.
const LIVE_STACK = {
  npmExecFirebase: 93796,
  firebaseEmulators: 93884,
  firestoreJvm: 94261,
  expressApi: 94328,
  serveWeb: 94457,
};
const ORPHANED_GRADLE_DAEMON = 94478;

describe('parseProcessSnapshot', () => {
  const procs = parseProcessSnapshot(snapshot);

  it('parses every line of the real snapshot into a structured record', () => {
    const nonEmptyLines = snapshot.split('\n').filter((l) => l.trim()).length;
    expect(procs).toHaveLength(nonEmptyLines);
  });

  it('keeps the full argv, because identity lives in the arguments not the binary', () => {
    // Both the emulator JVM and the Gradle daemon are just "java" at argv[0].
    // Truncating the command would make them indistinguishable.
    const jvm = procs.find((p) => p.pid === LIVE_STACK.firestoreJvm);
    expect(jvm.command).toContain('cloud-firestore-emulator');
  });

  it('parses elapsed time into seconds across all four ps formats', () => {
    // ps emits MM:SS, HH:MM:SS, D-HH:MM:SS. A parser that assumes one shape
    // silently treats a 2-day-old orphan as 2 seconds old, or vice versa.
    expect(parseProcessSnapshot('1 0 100 07:52 x').at(0).etimeSeconds).toBe(472);
    expect(parseProcessSnapshot('1 0 100 01:47:04 x').at(0).etimeSeconds).toBe(6424);
    expect(parseProcessSnapshot('1 0 100 01-19:50:53 x').at(0).etimeSeconds).toBe(157853);
  });
});

describe('findReclaimableTenants — detection', () => {
  const procs = parseProcessSnapshot(snapshot);
  const found = findReclaimableTenants(procs, { portHolderPids: new Set() });
  const pids = found.map((t) => t.pid);

  it('finds the orphaned Gradle daemon that start.sh left at ppid=1', () => {
    expect(pids).toContain(ORPHANED_GRADLE_DAEMON);
  });

  it('explains what it found and why, so the log is diagnosable after the fact', () => {
    const gradle = found.find((t) => t.pid === ORPHANED_GRADLE_DAEMON);
    expect(gradle.kind).toBe('gradle-daemon');
    expect(gradle.reason).toMatch(/ppid=1|orphan/i);
  });

  it('does not rely on RSS to decide what is worth reclaiming', () => {
    // In this very fixture the Gradle daemon reads 53 MB RSS against a real
    // 464 MB+ footprint. Any threshold applied to RSS would skip it.
    const gradle = found.find((t) => t.pid === ORPHANED_GRADLE_DAEMON);
    expect(gradle).toBeDefined();
    expect(gradle.rssKb).toBeLessThan(100 * 1024); // ~53 MB — deliberately small
  });
});

describe('findReclaimableTenants — exclusion (the clause that must never regress)', () => {
  const procs = parseProcessSnapshot(snapshot);

  it.each(Object.entries(LIVE_STACK))(
    'never reclaims the live stack process %s (pid %i)',
    (role, pid) => {
      const found = findReclaimableTenants(procs, { portHolderPids: new Set() });
      expect(found.map((t) => t.pid)).not.toContain(pid);
    },
  );

  it('never reclaims a process that holds a stack port, whatever it looks like', () => {
    // Defence in depth: even if a process matches an orphan signature, holding
    // a port the stack needs means something is depending on it right now.
    const found = findReclaimableTenants(procs, {
      portHolderPids: new Set([ORPHANED_GRADLE_DAEMON]),
    });
    expect(found.map((t) => t.pid)).not.toContain(ORPHANED_GRADLE_DAEMON);
  });

  it('never reclaims pid 0 or pid 1 even if a signature somehow matches', () => {
    const hostile = parseProcessSnapshot(
      [
        '0 0 100 10:00 java --add-opens=java.base/java.lang=ALL-UNNAMED',
        '1 0 100 10:00 java --add-opens=java.base/java.lang=ALL-UNNAMED',
      ].join('\n'),
    );
    expect(findReclaimableTenants(hostile, { portHolderPids: new Set() })).toEqual([]);
  });

  it('never reclaims the process doing the reclaiming, or its parent', () => {
    const self = parseProcessSnapshot(
      `${process.pid} ${process.ppid} 100 10:00 node scripts/preflight/index.js`,
    );
    expect(findReclaimableTenants(self, { portHolderPids: new Set() })).toEqual([]);
  });

  it('protects a young Express API — age is what separates orphan from live', () => {
    // The live Express in the fixture is 7m56s old. An age-blind rule that
    // matched on argv alone would kill the API the suite is about to test.
    const young = parseProcessSnapshot('55501 55500 19808 07:56 node src/index.js');
    expect(findReclaimableTenants(young, { portHolderPids: new Set() })).toEqual([]);
  });

  it('reclaims a genuinely stale Express API from a previous session', () => {
    // The real orphans found on 2026-07-31 were 20h08m and 18h41m old.
    const stale = parseProcessSnapshot(
      '60258 1 8240 20:08:50 node --env-file=.env.local src/index.js',
    );
    expect(findReclaimableTenants(stale, { portHolderPids: new Set() }).map((t) => t.pid)).toEqual([
      60258,
    ]);
  });

  it('is idempotent — reclaiming an already-clean snapshot finds nothing', () => {
    const clean = parseProcessSnapshot(
      Object.values(LIVE_STACK)
        .map((pid) => procs.find((p) => p.pid === pid))
        .map((p) => `${p.pid} ${p.ppid} ${p.rssKb} 07:56 ${p.command}`)
        .join('\n'),
    );
    expect(findReclaimableTenants(clean, { portHolderPids: new Set() })).toEqual([]);
  });
});

/**
 * Each guard, asked directly.
 *
 * The suite above originally passed with the live-stack protection deleted AND
 * with the ppid=1 requirement deleted, because every process it called
 * "protected" was protected by some OTHER guard as well. Asserting "pid X was
 * not reclaimed" cannot tell you WHICH guard caught it. These do.
 */
describe('isProtected — each guard isolated', () => {
  const proc = (over) => ({
    pid: 50000,
    ppid: 1,
    rssKb: 1000,
    etimeSeconds: 999999,
    command: 'x',
    ...over,
  });

  it('protects reserved pids', () => {
    expect(isProtected(proc({ pid: 0 }), {})).toBe('reserved pid');
    expect(isProtected(proc({ pid: 1 }), {})).toBe('reserved pid');
  });

  it('protects the reclaiming process itself and its parent', () => {
    expect(isProtected(proc({ pid: process.pid }), {})).toBe('self or parent');
    expect(isProtected(proc({ pid: process.ppid }), {})).toBe('self or parent');
  });

  it('protects any holder of a stack port', () => {
    expect(isProtected(proc({ pid: 4242 }), { portHolderPids: new Set([4242]) })).toBe(
      'holds a stack port',
    );
  });

  it.each([
    [
      'firestore emulator JVM',
      '/usr/bin/java -jar /x/cloud-firestore-emulator-v1.20.4.jar --port 8080',
    ],
    [
      'firebase emulator launcher',
      'node /opt/homebrew/bin/firebase emulators:start --project=demo-shytalk',
    ],
    ['local web server', 'node /Users/x/ShyTalk/local/serve-web.js --port 8888'],
  ])('protects the %s by identity even when orphaned and old', (_label, command) => {
    // ppid=1 and ~11 days old: every other guard would wave this through.
    expect(isProtected(proc({ command }), {})).toBe('live stack process');
  });

  it('lets an ordinary orphan through when nothing protects it', () => {
    expect(isProtected(proc({}), {})).toBeNull();
  });
});

describe('the repo-cwd requirement applies only to ambiguously-named processes', () => {
  const line = (s) => parseProcessSnapshot(s);
  const REPO = '/Users/shyden/Developer/Repos/ShyTalk';

  it('still reclaims a Gradle daemon even though its cwd is outside the repo', () => {
    // REGRESSION: a blanket cwd guard silently shielded the exact orphan this
    // ticket exists to reclaim. A Gradle daemon's cwd is legitimately
    // ~/.gradle/daemon/<version>, and `GradleDaemon` in argv already identifies
    // it unambiguously — it needs no cwd corroboration. Caught by running the
    // preflight for real; no hand-supplied fixture would have shown it.
    const gradle = line('94478 1 54368 20:21 /opt/homebrew/.../java -cp x GradleDaemon 9.6.1');
    const cwdByPid = new Map([[94478, '/Users/shyden/.gradle/daemon/9.6.1']]);
    expect(findReclaimableTenants(gradle, { cwdByPid, repoRoot: REPO }).map((t) => t.pid)).toEqual([
      94478,
    ]);
  });

  it('still reclaims a Kotlin compile daemon from outside the repo', () => {
    const kotlin = line('94479 1 12000 20:21 java -cp /x/kotlin-build-tools-compat/2.4.0/y.jar');
    const cwdByPid = new Map([[94479, '/tmp']]);
    expect(findReclaimableTenants(kotlin, { cwdByPid, repoRoot: REPO }).map((t) => t.pid)).toEqual([
      94479,
    ]);
  });

  it('still refuses an Express API rooted outside the repo', () => {
    const stranger = line('55501 1 8240 20:08:50 node --env-file=.env.local src/index.js');
    const cwdByPid = new Map([[55501, '/Users/someone/OtherProject']]);
    expect(findReclaimableTenants(stranger, { cwdByPid, repoRoot: REPO })).toEqual([]);
  });

  it('fails closed when an Express API’s cwd cannot be read', () => {
    const unknown = line('55501 1 8240 20:08:50 node --env-file=.env.local src/index.js');
    expect(findReclaimableTenants(unknown, { cwdByPid: new Map(), repoRoot: REPO })).toEqual([]);
  });

  it('reclaims an Express API that IS rooted in this repo', () => {
    const ours = line('55501 1 8240 20:08:50 node --env-file=.env.local src/index.js');
    const cwdByPid = new Map([[55501, `${REPO}/express-api`]]);
    expect(findReclaimableTenants(ours, { cwdByPid, repoRoot: REPO }).map((t) => t.pid)).toEqual([
      55501,
    ]);
  });
});

describe('findReclaimableTenants — each guard isolated end to end', () => {
  const line = (s) => parseProcessSnapshot(s);

  it('spares an OLD Express API that still has a living parent', () => {
    // Isolates the ppid=1 rule: age alone would make this eligible.
    const old = line('55501 55500 8240 20:08:50 node --env-file=.env.local src/index.js');
    expect(findReclaimableTenants(old, {})).toEqual([]);
  });

  it('spares an ORPHANED Express API that is still young', () => {
    // Isolates the age rule: ppid=1 alone would make this eligible.
    const young = line('55501 1 8240 00:09:12 node --env-file=.env.local src/index.js');
    expect(findReclaimableTenants(young, {})).toEqual([]);
  });

  it('reclaims only when orphaned AND stale AND unprotected', () => {
    const both = line('55501 1 8240 20:08:50 node --env-file=.env.local src/index.js');
    expect(findReclaimableTenants(both, {}).map((t) => t.pid)).toEqual([55501]);
  });

  it('spares another project’s server that looks identical in ps', () => {
    const stranger = line('55501 1 8240 20:08:50 node --env-file=.env.local src/index.js');
    const cwdByPid = new Map([[55501, '/Users/someone/OtherProject']]);
    expect(findReclaimableTenants(stranger, { cwdByPid, repoRoot: '/Users/x/ShyTalk' })).toEqual(
      [],
    );
  });

  it('spares appium, which runs orphaned for days and is needed for iOS journeys', () => {
    // A generic "old orphaned node process" rule would kill this.
    const appium = line('53177 1 4000 01-03:21:00 node /opt/homebrew/bin/appium');
    expect(findReclaimableTenants(appium, {})).toEqual([]);
  });
});

describe('STACK_PORTS', () => {
  it('covers every port local/start.sh binds, so no live service is missed', () => {
    // Firestore, Auth, emulator UI, RTDB, Storage, Express, web, LiveKit, hub.
    for (const port of [8080, 9099, 4000, 9000, 9199, 3000, 8888, 7880, 4400]) {
      expect(STACK_PORTS).toContain(port);
    }
  });
});

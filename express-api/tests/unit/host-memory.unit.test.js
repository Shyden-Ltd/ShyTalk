/**
 * SHY-0263 — measure phys_footprint, never RSS.
 *
 * macOS compresses inactive pages, so a starved process's RSS FALLS as memory
 * pressure RISES. In the captured fixture the Firestore emulator reads 16 MB RSS
 * while holding a 765 MB footprint, and the orphaned Gradle daemon reads 53 MB
 * against 464 MB. Sorted by RSS, the two biggest tenants on the machine rank near
 * the bottom — an RSS-based check reports the starving process as the healthiest.
 *
 * These tests exist to make that mistake impossible to reintroduce.
 * Fixtures: real captured output, see tests/fixtures/preflight/README.md.
 */
const fs = require('fs');
const path = require('path');

const {
  parseFootprintCensus,
  parsePhysMem,
  summariseHostMemory,
} = require('../../scripts/preflight/host-memory');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '../fixtures/preflight', name), 'utf8');
const CENSUS = fixture('top-mem-2026-07-31.txt');
const PHYSMEM = fixture('physmem-2026-07-31.txt');

const FIRESTORE_JVM = 94261;
const GRADLE_DAEMON = 94478;
const DOCKER_VM = 66810;

describe('parseFootprintCensus', () => {
  const rows = parseFootprintCensus(CENSUS);
  const byPid = (pid) => rows.find((r) => r.pid === pid);

  it('reads the footprint column, not RSS — the whole point of the helper', () => {
    // ps would report 16 MB for this pid. Anything under 700 means the
    // implementation went back to RSS.
    expect(byPid(FIRESTORE_JVM).footprintMb).toBe(765);
    expect(byPid(GRADLE_DAEMON).footprintMb).toBe(464);
  });

  it('captures the compressed portion, which is itself the pressure signal', () => {
    // 759 of the emulator's 765 MB is compressed: it is being squeezed out.
    expect(byPid(FIRESTORE_JVM).compressedMb).toBe(759);
  });

  it('sees the Docker VM, which is invisible to any RSS-based census', () => {
    // Its host RSS is ~102 MB. It is in fact the largest tenant on the machine.
    expect(byPid(DOCKER_VM).footprintMb).toBe(2870);
  });

  it('ranks tenants so the real memory hogs come out on top', () => {
    const top3 = rows.slice(0, 3).map((r) => r.pid);
    expect(top3).toContain(DOCKER_VM);
    expect(top3).toContain(FIRESTORE_JVM);
  });

  it('handles every size suffix top emits', () => {
    const parsed = parseFootprintCensus(
      ['PID    MEM   CMPRS COMMAND', '1 512K 0B a', '2 64M 8M b', '3 2G 1G c'].join('\n'),
    );
    expect(parsed.map((r) => r.footprintMb)).toEqual([2048, 64, 0.5]);
  });

  it('skips top’s preamble rather than parsing it as processes', () => {
    // The fixture has 11 lines of header before the PID row. A parser that
    // does not anchor on the header will invent processes out of "Disks:".
    expect(rows.every((r) => Number.isInteger(r.pid))).toBe(true);
    expect(rows.some((r) => Number.isNaN(r.footprintMb))).toBe(false);
  });
});

describe('parsePhysMem', () => {
  const mem = parsePhysMem(PHYSMEM);

  it('extracts the host memory breakdown from the real PhysMem line', () => {
    expect(mem).toMatchObject({ usedMb: 7644, wiredMb: 2353, compressorMb: 2230, unusedMb: 94 });
  });

  it('treats a large compressor as the pressure signal, not "used"', () => {
    // 2230 MB compressed on an 8 GB box is the machine telling you it cannot
    // hold its working set. "used" alone looks the same on a healthy machine.
    expect(mem.compressorMb).toBeGreaterThan(2000);
  });
});

describe('summariseHostMemory', () => {
  it('classifies the captured state as starved', () => {
    // 94 MB unused and 2230 MB compressed is the state that produced a 3382s run.
    const summary = summariseHostMemory({ census: CENSUS, physMem: PHYSMEM });
    expect(summary.starved).toBe(true);
  });

  it('names the largest tenants so the message is actionable, not just a refusal', () => {
    const summary = summariseHostMemory({ census: CENSUS, physMem: PHYSMEM });
    const names = summary.topTenants.map((t) => t.command).join(' ');
    expect(names).toMatch(/Virtua/);
    expect(summary.topTenants.length).toBeGreaterThanOrEqual(3);
  });

  it('separates "starved" from "degraded" — only free memory refuses a run', () => {
    // A large compressor correlated with the 3382s run, but there is no healthy
    // baseline to calibrate it against yet. Refusing on an uncalibrated
    // threshold would block legitimate local work, which is worse than the bug.
    const busyButFree = ['PhysMem: 5000M used (1500M wired, 2500M compressor), 3000M unused.'].join(
      '\n',
    );
    const summary = summariseHostMemory({ census: CENSUS, physMem: busyButFree });
    expect(summary.starved).toBe(false);
    expect(summary.degraded).toBe(true);
  });

  it('calls a host with almost no free memory starved regardless of compressor', () => {
    const noFreeMemory = ['PhysMem: 7900M used (2000M wired, 100M compressor), 90M unused.'].join(
      '\n',
    );
    expect(summariseHostMemory({ census: CENSUS, physMem: noFreeMemory }).starved).toBe(true);
  });

  it('does not call a healthy machine starved', () => {
    const healthy = [
      'Load Avg: 1.0, 1.0, 1.0',
      'PhysMem: 3000M used (1500M wired, 200M compressor), 5000M unused.',
    ].join('\n');
    expect(summariseHostMemory({ census: CENSUS, physMem: healthy }).starved).toBe(false);
  });
});

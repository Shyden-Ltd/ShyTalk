/**
 * SHY-0263 — host memory measurement for the test preflight.
 *
 * Reads phys_footprint, NEVER RSS. Under macOS memory pressure the kernel
 * compresses inactive pages, so a starved process's RSS falls as pressure rises.
 * Measured 2026-07-31: the Firestore emulator held a 765 MB footprint while
 * reporting 16 MB RSS, and two ~1 GB orphaned build daemons sat in every process
 * listing taken that day without ever being noticed, because sorting by RSS put
 * them below a WhatsApp helper.
 *
 * RSS answers "how much is resident right now", which under pressure is close to
 * the inverse of "how much does this process need".
 */

/** Free memory below this means the run cannot expect the emulator to stay resident. */
const MIN_UNUSED_MB = 512;

/** A compressor this large means the machine cannot hold its working set. */
const MAX_COMPRESSOR_MB = 1536;

const SIZE_UNITS = { B: 1 / (1024 * 1024), K: 1 / 1024, M: 1, G: 1024, T: 1024 * 1024 };

/**
 * `top` renders sizes as `0B` / `512K` / `64M` / `2G`. Returns MB.
 * A bare number is assumed to be bytes, matching top's own behaviour.
 */
function toMb(raw) {
  const match = /^([\d.]+)\s*([BKMGT])?$/i.exec(String(raw).trim());
  if (!match) return NaN;
  const unit = (match[2] || 'B').toUpperCase();
  return Number(match[1]) * SIZE_UNITS[unit];
}

/**
 * Parse `top -l 1 -o mem -stats pid,mem,cmprs,command`.
 *
 * Anchors on the column header rather than guessing where the preamble ends —
 * top emits ~11 lines of `Processes:` / `PhysMem:` / `Disks:` first, and a
 * parser that skips a fixed count invents processes out of them.
 *
 * Returned rows are sorted by footprint descending, so callers naming "the
 * largest tenants" get the real ones rather than whatever top happened to list.
 */
function parseFootprintCensus(text) {
  const lines = String(text).split('\n');
  const headerIndex = lines.findIndex((l) => /^\s*PID\s+MEM\s+CMPRS/i.test(l));
  if (headerIndex === -1) return [];

  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    // Split on whitespace rather than matching a single pattern with a trailing
    // `(.*\S)` — that shape backtracks super-linearly on long lines, and top's
    // command column is arbitrarily long.
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [pidRaw, memRaw, cmprsRaw, ...commandParts] = parts;
    if (!/^\d+$/.test(pidRaw)) continue;
    const footprintMb = toMb(memRaw);
    if (Number.isNaN(footprintMb)) continue;
    rows.push({
      pid: Number(pidRaw),
      footprintMb,
      compressedMb: toMb(cmprsRaw),
      command: commandParts.join(' '),
    });
  }
  return rows.sort((a, b) => b.footprintMb - a.footprintMb);
}

/**
 * Parse top's `PhysMem: 7644M used (2353M wired, 2230M compressor), 94M unused.`
 *
 * `compressor` is the number that matters: it is how much physical RAM is being
 * spent holding compressed pages, i.e. the working set that does not fit.
 */
function parsePhysMem(text) {
  const line = String(text)
    .split('\n')
    .find((l) => l.includes('PhysMem:'));
  if (!line) return null;

  // Tokenised rather than pattern-matched: `([\d.]+[BKMGT]?)\s+<word>` repeated
  // four times backtracks super-linearly, and the value always sits immediately
  // before its label ("7644M used", "2230M compressor").
  const tokens = line.split(/[\s(),]+/).filter(Boolean);
  const valueBefore = (label) => {
    const index = tokens.findIndex((t) => t.replace(/\.$/, '').toLowerCase() === label);
    return index > 0 ? toMb(tokens[index - 1]) : null;
  };

  const usedMb = valueBefore('used');
  const unusedMb = valueBefore('unused');
  if (usedMb === null || unusedMb === null) return null;

  return {
    usedMb,
    wiredMb: valueBefore('wired') ?? 0,
    compressorMb: valueBefore('compressor') ?? 0,
    unusedMb,
  };
}

/**
 * Decide whether the host can host a full suite run, and name what is in the way.
 *
 * Naming the tenants is not decoration — a bare refusal sends the next person
 * hunting through the test suite for a bug that is not there. Both times this
 * was diagnosed, the wasted effort came from not knowing what was holding memory.
 */
function summariseHostMemory({ census, physMem, topN = 6 } = {}) {
  const mem = parsePhysMem(physMem);
  const tenants = parseFootprintCensus(census).slice(0, topN);

  if (!mem) {
    return { starved: false, measured: false, mem: null, topTenants: tenants };
  }

  // Two distinct signals, deliberately NOT merged.
  //
  // `starved` — free memory this low on an 8 GB host is unambiguous: the
  // emulator cannot stay resident and the run's verdict will be about the
  // machine. This is the only condition that refuses a run.
  //
  // `degraded` — a large compressor means the host is working hard to hold its
  // working set. It correlated with the 3382s run, but there is no measurement
  // of a HEALTHY run's compressor to calibrate against yet, so it only warns.
  // Refusing on an uncalibrated threshold would block legitimate work, which is
  // worse than the bug. Promote it to a refusal once a healthy baseline exists.
  const starved = mem.unusedMb < MIN_UNUSED_MB;
  const degraded = mem.compressorMb > MAX_COMPRESSOR_MB;
  return { starved, degraded, measured: true, mem, topTenants: tenants };
}

module.exports = {
  MIN_UNUSED_MB,
  MAX_COMPRESSOR_MB,
  toMb,
  parseFootprintCensus,
  parsePhysMem,
  summariseHostMemory,
};

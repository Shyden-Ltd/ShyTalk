/**
 * The dashboard's three lists, and the environment badge.
 *
 * Operator 2026-08-01, on seeing app scenarios rendered under browser columns:
 *
 *   "scenarios for 'app' have icons in columns named chrome·A 🤖 samsung·A 🤖
 *    edge·A 🤖 firefox·A which doesn't make sense. scenarios should be split up
 *    into 3 separate lists. showing only the icons appropriate to the type of
 *    scenarios in that list. first list, only - show only the apps. second list,
 *    web only, show only the browsers. third list, cross over, show the browsers
 *    used and device used for the app side."
 *
 * And: "we also need to be able to see the environment under test. I.E. local or
 * dev."
 *
 * The four browser columns were not a rendering mistake — the matrix really did
 * attach the Android app driver to all four `mobile-*-android` browser cells, so
 * the display was honest about a broken arrangement. Splitting the lists is only
 * possible because the cells were split first.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '../../scripts/gauntlet/progress-server.js');

/** A run directory with just enough on disk for `snapshot()` to read it. */
function makeRunDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gauntlet-phase-'));
  fs.writeFileSync(path.join(dir, 'log'), '[matrix] starting\n');
  fs.mkdirSync(path.join(dir, 'report'), { recursive: true });
  return dir;
}

function loadSnapshot(env = {}) {
  jest.resetModules();
  const prior = {};
  for (const [k, v] of Object.entries(env)) {
    prior[k] = process.env[k];
    process.env[k] = v;
  }
  const { snapshot } = require(SERVER);
  return {
    snapshot,
    restore: () => {
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

let runDir;
beforeAll(() => {
  runDir = makeRunDir();
});
afterAll(() => {
  fs.rmSync(runDir, { recursive: true, force: true });
});

describe('three lists, each with only its own columns', () => {
  let s;
  let restore;
  beforeAll(() => {
    const loaded = loadSnapshot({ GAUNTLET_TARGET: 'local' });
    restore = loaded.restore;
    s = loaded.snapshot(runDir);
  });
  afterAll(() => restore());

  it('reports exactly three phases, app first', () => {
    expect(s.phases.map((p) => p.phase)).toEqual(['app', 'web', 'cross']);
  });

  it('the APP list shows only the devices — no browser columns at all', () => {
    // The literal complaint: `chrome·A 🤖 samsung·A 🤖 edge·A 🤖 firefox·A` for
    // scenarios that run on one phone.
    const app = s.phases.find((p) => p.phase === 'app');
    expect(app.cells).toEqual(['app-android', 'app-ios']);
    expect(app.cells.some((c) => c.includes('mobile-'))).toBe(false);
    expect(app.cells).not.toContain('chromium');
  });

  it('the WEB list shows only browsers — and no app cell', () => {
    const web = s.phases.find((p) => p.phase === 'web');
    expect(web.cells).toContain('chromium');
    expect(web.cells).toContain('mobile-chrome-android');
    expect(web.cells).not.toContain('app-android');
    expect(web.cells).not.toContain('cross-android');
  });

  it('the CROSS-OVER list shows the browser used AND the device used', () => {
    // "show the browsers used and device used for the app side" — one cell that
    // holds both, which is the only arrangement in which the handoff can run.
    const cross = s.phases.find((p) => p.phase === 'cross');
    // Three: one per device, plus the tri-platform cell that holds both and is
    // the only thing able to run the 67 android+ios+web scenarios.
    expect(cross.cells).toEqual(['cross-android', 'cross-ios', 'cross-all']);
  });

  it('every planned cell appears in exactly one list', () => {
    const seen = s.phases.flatMap((p) => p.cells);
    expect(seen.slice().sort()).toEqual(s.cellNames.slice().sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('each list carries its own scenario count', () => {
    for (const p of s.phases) {
      expect(typeof p.scenarios).toBe('number');
    }
    // The corpus splits across the three; every scenario lands in one list.
    const total = s.phases.reduce((n, p) => n + p.scenarios, 0);
    expect(total).toBe(s.matrix.length);
  });

  it('each list carries a status the operator can read at a glance', () => {
    for (const p of s.phases) {
      expect(['green', 'red', 'running', 'pending']).toContain(p.status);
    }
  });

  it('a phase status counts only ITS OWN cells', () => {
    /**
     * THE BUG THIS CAUGHT (2026-08-01, on the first dispatch of the new
     * matrix): with only the APP phase running, the board read
     *
     *     app    pending
     *     web    red        ← nothing in the web phase had been touched
     *     cross  running    ← nor the cross phase
     *
     * The status was derived from `row.summary`, which is the whole-matrix
     * tally for that scenario across all 16 cells. So a phase's verdict was
     * being read off other cells' results — a tally over the wrong set.
     *
     * With nothing dispatched, every phase must be `pending`. Anything else is
     * a verdict about work that has not happened.
     */
    for (const p of s.phases) {
      expect(p.status).toBe('pending');
      expect(p.totals).toEqual({ pass: 0, fail: 0, skipped: 0, pending: expect.any(Number) });
    }
  });

  it("a phase's pending count never exceeds its own scenarios × its own cells", () => {
    // The arithmetic ceiling. Summing `row.summary.pending` across 16 cells
    // blew straight past this, which is what made the wrong-set bug visible.
    for (const p of s.phases) {
      expect(p.totals.pending).toBeLessThanOrEqual(p.scenarios * p.cells.length);
    }
  });

  it('a phase with no results yet is pending, not green', () => {
    // Reporting an un-run phase as green is the failure mode that makes the
    // whole board untrustworthy.
    for (const p of s.phases) {
      if (p.totals.pass + p.totals.fail + p.totals.skipped === 0) {
        expect(p.status).toBe('pending');
      }
    }
  });
});

describe('the environment under test is on the payload', () => {
  it('reports local', () => {
    const { snapshot, restore } = loadSnapshot({ GAUNTLET_TARGET: 'local' });
    try {
      expect(snapshot(runDir).target).toBe('local');
    } finally {
      restore();
    }
  });

  it('reports dev', () => {
    const { snapshot, restore } = loadSnapshot({ GAUNTLET_TARGET: 'dev' });
    try {
      expect(snapshot(runDir).target).toBe('dev');
    } finally {
      restore();
    }
  });

  it('defaults to local when unset, rather than omitting it', () => {
    // A missing field renders as a blank badge, which leaves the operator
    // guessing — the exact situation the badge was added to end.
    const { snapshot, restore } = loadSnapshot({});
    try {
      delete process.env.GAUNTLET_TARGET;
      expect(snapshot(runDir).target).toBe('local');
    } finally {
      restore();
    }
  });

  it('dev keeps both devices — the lists do not collapse to browsers', () => {
    // Under the old browser-keyed matrix, narrowing dev to Chrome silently
    // dropped every device cell, because the device rode on a browser slug.
    const { snapshot, restore } = loadSnapshot({ GAUNTLET_TARGET: 'dev' });
    try {
      const s = snapshot(runDir);
      expect(s.phases.find((p) => p.phase === 'app').cells).toEqual(['app-android', 'app-ios']);
      expect(s.phases.find((p) => p.phase === 'cross').cells).toEqual([
        'cross-android',
        'cross-ios',
        'cross-all',
      ]);
    } finally {
      restore();
    }
  });
});

describe('the dashboard page renders what the payload provides', () => {
  const HTML = fs.readFileSync(
    path.join(__dirname, '../../scripts/gauntlet/progress-dashboard.html'),
    'utf8',
  );

  it('has a container for the phase lists', () => {
    expect(HTML).toMatch(/id="phaseLists"/);
  });

  it('has an environment badge', () => {
    expect(HTML).toMatch(/id="env"/);
  });

  it('reads the phase order from the payload, not a local copy', () => {
    // A hard-coded ['app','web','cross'] here would be a second home for the
    // app-first rule, and therefore a second place for it to drift.
    expect(HTML).toMatch(/s\.phases \|\| \[\]/);
    expect(HTML).not.toMatch(/\[\s*'app'\s*,\s*'web'\s*,\s*'cross'\s*\]/);
  });

  it('gives the new cells their own icons and labels', () => {
    for (const cell of ['app-android', 'app-ios', 'cross-android', 'cross-ios']) {
      expect(HTML).toContain(cell);
    }
  });

  it('every counter states its UNIT', () => {
    /**
     * Operator 2026-08-01: "i still see many red crosses (failures? but with a
     * figure of 0 failures in the summary???)"
     *
     * Both numbers were correct. The header counters count CELLS — how many of
     * the matrix's cells have finished — and the grid counts SCENARIO × CELL
     * results. On the killed run that read "0 failed" beside 112 visible
     * crosses: no cell had finished failing (2 stalled, 6 pending) while 112
     * individual scenario results were already red.
     *
     * A bare "failed" lets the reader supply whichever unit they had in mind,
     * so the label carries the unit now.
     */
    expect(HTML).toMatch(/cells&nbsp;failed/);
    expect(HTML).toMatch(/scenario&nbsp;results&nbsp;failed/);
    // The ambiguous bare labels must not come back.
    expect(HTML).not.toMatch(/<span>failed<\/span>/);
    expect(HTML).not.toMatch(/<span>passed<\/span>/);
  });

  it('derives the scenario tally from the SAME grid it renders', () => {
    // Counted from `s.matrix` rather than served as a separate field, so the
    // number and the crosses beneath it cannot drift apart — which is how the
    // original discrepancy became possible.
    expect(HTML).toMatch(/sum\.fail \|\| 0/);
    expect(HTML).toMatch(/id="rFail"/);
  });

  it('no longer renders a per-row kind badge', () => {
    // Every row in a phase list has that phase's kind by construction, so the
    // badge was noise repeated 226 times.
    expect(HTML).not.toMatch(/function kindBadge/);
  });
});

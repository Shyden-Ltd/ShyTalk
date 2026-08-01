/**
 * THE BUG THIS FILE EXISTS TO PREVENT (operator, 2026-08-01):
 *
 *   "why is the browser cell carrying the android app driver? that doesn't
 *    sound correct. maybe that's been the problem all this time?"
 *
 * It was. The matrix was keyed entirely by BROWSER slug, so the native app had
 * no cell of its own — app-driving was bolted onto whichever cells happened to
 * own the phone, via `defaultResourceKey('mobile-chrome-android') === 'android'`.
 *
 * That one expression was answering two different questions with one answer:
 *
 *   "which hardware does this cell contend for?"  → the phone. TRUE: Chrome for
 *      Android runs ON the device over CDP-over-adb, so the cell does own it.
 *   "whose native app does this cell drive?"       → the phone. FALSE. A browser
 *      cell drives a browser. Nothing about owning the device implies it should
 *      also be launching the APK.
 *
 * Measured cost on the one connected phone:
 *
 *   android browser cells        : 4
 *   app scenarios                : 24
 *   cross-over scenarios         : 101
 *   device-scenario runs NEEDED  : 125   (each once)
 *   device-scenario runs ACTUAL  : 500   (×4 browser cells)
 *   wasted                       : 375
 *
 * 375 duplicate `uiautomator dump` runs on one phone, each contending with the
 * other three cells for the same binary. No test could catch it, because every
 * existing test asked a per-cell question ("does THIS cell attach the driver it
 * was configured to?") and the defect is a whole-matrix property: the phone is
 * asked to do the same work four times. Only a test that counts across ALL
 * cells at once can see it — the same shape of blind spot as the per-driver I/O
 * bound tests that each passed while geckodriver had no bound at all.
 */
const path = require('path');
const {
  MATRIX_CELLS,
  CELL_SLUGS,
  PHASES,
  cellSpec,
  capsFor,
  resourceKeyFor,
  browserFor,
  appDeviceFor,
  phaseOf,
  cellsInPhase,
  isKnownCell,
} = require('../../scripts/matrix-cells');
const { readCorpus } = require('../../scripts/scenario-progress');
const { requiredPlatforms, GATING_PLATFORMS } = require('../../scripts/scenario-surface');

const JOURNEY_DIR = path.resolve(__dirname, '../../../journey-tests');

describe('the two questions that were conflated', () => {
  it('a phone-browser cell contends for the phone but drives NO native app', () => {
    // Both halves matter. Dropping the hardware claim would let two cells drive
    // the phone at once; keeping the app claim is the original bug.
    for (const cell of ['mobile-chrome-android', 'mobile-samsung-android']) {
      expect(resourceKeyFor(cell)).toBe('android');
      expect(appDeviceFor(cell)).toBeNull();
    }
  });

  it('an iOS-browser cell likewise owns the iPhone without driving the app', () => {
    expect(resourceKeyFor('mobile-safari-ios')).toBe('iphone');
    expect(appDeviceFor('mobile-safari-ios')).toBeNull();
  });

  it('an app cell drives the app and has NO browser', () => {
    expect(appDeviceFor('app-android')).toBe('android');
    expect(browserFor('app-android')).toBeNull();
    expect(resourceKeyFor('app-android')).toBe('android');
  });

  it('a cross-over cell holds BOTH surfaces at once', () => {
    // The whole point of the phase: one cell that can send a gift on the phone
    // and read it on the web. Split across two cells it cannot be tested at all.
    expect(browserFor('cross-android')).toBe('chromium');
    expect(appDeviceFor('cross-android')).toBe('android');
  });

  it('cross-over pairs the app with a DESKTOP browser, never the same phone', () => {
    // Pairing mobile-chrome-android with the Android app makes one device play
    // both actors — it drives the same hardware twice and tests a handoff that
    // no real pair of users performs.
    for (const cell of cellsInPhase('cross')) {
      const browser = browserFor(cell.cell);
      expect(browser).not.toMatch(/-(android|ios)$/);
    }
  });
});

describe('the whole-matrix property no per-cell test could see', () => {
  it('exactly TWO cells drive each device: one app, one cross-over', () => {
    for (const device of ['android', 'ios']) {
      const drivers = MATRIX_CELLS.filter((c) => c.appDevice === device).map((c) => c.cell);
      expect(drivers).toEqual([`app-${device}`, `cross-${device}`]);
    }
  });

  it('no browser-only cell attaches an app driver', () => {
    const offenders = MATRIX_CELLS.filter(
      (c) => c.browser !== null && c.appDevice !== null && phaseOf(c.cell) !== 'cross',
    ).map((c) => c.cell);
    // Named in the failure so the regression points at the cell that regrew.
    expect(offenders).toEqual([]);
  });

  it('the phone runs each app-driven scenario ONCE, not once per browser', () => {
    // The honest measurement, as a test. Reads the real corpus rather than a
    // fixture: a fixture would have agreed with whatever the code did.
    const corpus = readCorpus(JOURNEY_DIR);
    expect(corpus.length).toBeGreaterThan(100);

    for (const device of ['android', 'ios']) {
      const needsDevice = corpus.filter((s) => {
        const required = requiredPlatforms(s.steps);
        return required.has(device) && GATING_PLATFORMS.has(device);
      }).length;
      expect(needsDevice).toBeGreaterThan(0);

      const cellsDriving = MATRIX_CELLS.filter((c) => c.appDevice === device).length;
      const runs = needsDevice * cellsDriving;

      // Two cells drive the device, but they run DISJOINT halves of the corpus:
      // app-* takes the app-only scenarios, cross-* takes the cross-over ones.
      // So the honest bound is one pass over the device-needing corpus, not
      // `needsDevice * cellsDriving`. Assert the disjointness directly.
      const appOnly = corpus.filter((s) => {
        const r = requiredPlatforms(s.steps);
        return r.has(device) && !r.has('web');
      }).length;
      const crossOver = corpus.filter((s) => {
        const r = requiredPlatforms(s.steps);
        return r.has(device) && r.has('web');
      }).length;

      expect(appOnly + crossOver).toBe(needsDevice);
      // The pre-fix matrix ran `needsDevice` on EVERY android browser cell.
      expect(runs).toBeLessThanOrEqual(needsDevice * 2);
    }
  });

  it('the four phone-browser cells add ZERO app-driver load', () => {
    // The 375 wasted runs, stated as the property that removed them.
    const phoneBrowserCells = MATRIX_CELLS.filter(
      (c) => c.resource === 'android' && c.browser !== null && c.appDevice === null,
    );
    expect(phoneBrowserCells.length).toBe(4);
    for (const c of phoneBrowserCells) {
      expect(capsFor(c.cell)).toEqual(['web']);
    }
  });
});

describe('capabilities drive the surface gate', () => {
  it.each([
    ['chromium', ['web']],
    ['mobile-chrome-android', ['web']],
    ['mobile-safari-ios', ['web']],
    ['app-android', ['android']],
    ['app-ios', ['ios']],
    ['cross-android', ['web', 'android']],
    ['cross-ios', ['web', 'ios']],
  ])('%s drives %p', (cell, caps) => {
    expect(capsFor(cell)).toEqual(caps);
  });

  it('every cell drives at least one surface', () => {
    // A cell with no capability would walk the corpus skipping everything and
    // report a green column having tested nothing — the stub-loop failure mode.
    for (const c of MATRIX_CELLS) {
      expect(capsFor(c.cell).length).toBeGreaterThan(0);
    }
  });
});

describe('phases', () => {
  it('run app first, then web, then cross-over', () => {
    // Operator: "the app testing should come first before the web. once app
    // testing is complete and successfull, move on to web only, if that comes
    // back all green, then you can perform the cross over testing."
    expect(PHASES).toEqual(['app', 'web', 'cross']);
  });

  it('every cell belongs to exactly one phase', () => {
    const seen = new Map();
    for (const phase of PHASES) {
      for (const c of cellsInPhase(phase)) {
        expect(seen.has(c.cell)).toBe(false);
        seen.set(c.cell, phase);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...CELL_SLUGS].sort());
  });

  it('phase is DERIVED from the surfaces, never stored separately', () => {
    // Two sources of truth for "what kind of cell is this" is how the dashboard
    // and the runner disagreed in the first place.
    for (const c of MATRIX_CELLS) {
      const expected =
        c.browser && c.appDevice ? 'cross' : c.appDevice ? 'app' : c.browser ? 'web' : null;
      expect(phaseOf(c.cell)).toBe(expected);
    }
  });
});

describe('unknown cells fail loudly', () => {
  it.each([['nonsense'], ['mobile-opera-android'], [''], [null], [undefined]])(
    'cellSpec(%p) throws rather than guessing',
    (cell) => {
      // The old string-suffix rule GUESSED: anything ending `-android` drove the
      // phone. A typo therefore silently produced a cell that ran the app.
      expect(() => cellSpec(cell)).toThrow(/not a matrix cell/);
    },
  );

  it('isKnownCell reports without throwing, for callers that must not', () => {
    expect(isKnownCell('chromium')).toBe(true);
    expect(isKnownCell('nonsense')).toBe(false);
  });

  it('resourceKeyFor rejects an unknown cell too', () => {
    // The old defaultResourceKey answered 'mac' for literally any string,
    // including a typo — so a misspelt cell quietly joined the desktop queue.
    expect(() => resourceKeyFor('chormium')).toThrow(/not a matrix cell/);
  });
});

describe('per-target cell allowlist', () => {
  const { allowedCellsFor } = require('../../scripts/matrix-cells');

  afterEach(() => {
    delete process.env.GAUNTLET_DEVICES;
    delete process.env.GAUNTLET_CELLS;
    delete process.env.GAUNTLET_BROWSERS;
  });

  it('local runs the whole matrix — all three phases', () => {
    const cells = allowedCellsFor('local');
    expect(cells).toEqual(CELL_SLUGS);
    for (const phase of PHASES) {
      expect(cells.some((c) => phaseOf(c) === phase)).toBe(true);
    }
  });

  it('dev keeps both real devices but collapses the browser fan-out to Chrome', () => {
    // CLAUDE.md: "dev now runs real-iOS app journeys too; only the web-browser
    // fan-out collapses to Chrome." App + cross cells are how that survives —
    // under the old browser-only matrix, dropping browsers dropped the devices.
    const cells = allowedCellsFor('dev');
    expect(cells).toContain('app-android');
    expect(cells).toContain('app-ios');
    expect(cells).toContain('cross-android');
    expect(cells).toContain('cross-ios');
    expect(cells).not.toContain('firefox');
    expect(cells).not.toContain('webkit');
  });

  it('prod is a read-only web check — no device cells at all', () => {
    expect(allowedCellsFor('prod')).toEqual(['chromium']);
  });

  it('an unknown target allows nothing rather than defaulting to everything', () => {
    expect(allowedCellsFor('staging')).toEqual([]);
  });

  describe('GAUNTLET_DEVICES — the knob that says what is plugged in', () => {
    it('drops every cell belonging to an absent device', () => {
      // The operator's actual sentence on 2026-08-01: "the iPhone will be out
      // of action, but the android devuice will be available."
      process.env.GAUNTLET_DEVICES = 'mac,android';
      const cells = allowedCellsFor('local');
      expect(cells).toContain('app-android');
      expect(cells).toContain('chromium');
      expect(cells.filter((c) => resourceKeyFor(c) === 'iphone')).toEqual([]);
    });

    it('keeps the phone-browser cells when the phone is present', () => {
      process.env.GAUNTLET_DEVICES = 'android';
      expect(allowedCellsFor('local')).toEqual([
        'app-android',
        'mobile-chrome-android',
        'mobile-samsung-android',
        'mobile-edge-android',
        'mobile-firefox-android',
        'cross-android',
      ]);
    });

    it('throws on an unknown device rather than silently running nothing', () => {
      // A typo that returns [] exits 0 having tested nothing — the failure mode
      // that makes a green run meaningless.
      process.env.GAUNTLET_DEVICES = 'andriod';
      expect(() => allowedCellsFor('local')).toThrow(/andriod/);
    });

    it('is inert when unset', () => {
      expect(allowedCellsFor('local')).toEqual(CELL_SLUGS);
    });
  });

  describe('GAUNTLET_CELLS — naming exact cells', () => {
    it('narrows to precisely the named cells, in matrix order', () => {
      process.env.GAUNTLET_CELLS = 'cross-android,app-android';
      // Matrix order, NOT the order given: cell order drives resource grouping,
      // so honouring the caller's order would change what runs in parallel.
      expect(allowedCellsFor('local')).toEqual(['app-android', 'cross-android']);
    });

    it('throws when a named cell is not allowed for the target', () => {
      process.env.GAUNTLET_CELLS = 'webkit';
      expect(() => allowedCellsFor('dev')).toThrow(/webkit/);
    });
  });

  it('GAUNTLET_BROWSERS still scopes the browser side for existing scripts', () => {
    // 50-matrix.sh has passed this since before cells existed. Breaking it
    // silently would scope nothing and quietly run the iPhone cells anyway.
    process.env.GAUNTLET_BROWSERS = 'chromium';
    const cells = allowedCellsFor('local');
    expect(cells).toContain('chromium');
    expect(cells).not.toContain('firefox');
    expect(cells).not.toContain('mobile-safari-ios');
  });

  it('an app cell survives GAUNTLET_BROWSERS — it has no browser to scope', () => {
    // The subtle one. Scoping by browser must not silently delete the app
    // phase, or "test only Chrome" would stop testing the product entirely.
    process.env.GAUNTLET_BROWSERS = 'chromium';
    expect(allowedCellsFor('local')).toContain('app-android');
  });
});

describe('the registry is internally consistent', () => {
  it('slugs are unique', () => {
    expect(new Set(CELL_SLUGS).size).toBe(CELL_SLUGS.length);
  });

  it('every cell names a real resource', () => {
    for (const c of MATRIX_CELLS) {
      expect(['mac', 'android', 'iphone']).toContain(c.resource);
    }
  });

  it('a cell driving an app contends for THAT device', () => {
    // An app cell keyed to the Mac would run concurrently with the browser cell
    // already using the phone — the deadlock this whole exercise removed.
    const expected = { android: 'android', ios: 'iphone' };
    for (const c of MATRIX_CELLS.filter((x) => x.appDevice)) {
      expect(c.resource).toBe(expected[c.appDevice]);
    }
  });

  it('every browser named by a cell is a supported browser', () => {
    const { SUPPORTED_BROWSERS } = require('../../scripts/browser-allowlist');
    for (const c of MATRIX_CELLS.filter((x) => x.browser)) {
      expect(SUPPORTED_BROWSERS).toContain(c.browser);
    }
  });
});

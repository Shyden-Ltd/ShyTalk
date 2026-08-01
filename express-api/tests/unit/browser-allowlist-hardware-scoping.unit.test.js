/**
 * The matrix must be scopeable to the hardware actually present.
 *
 * THE GAP THIS FILLS: devices come and go. On 2026-08-01 the iPhone became
 * unavailable mid-session while the Android device stayed. There was no way to
 * say so, so the run had two choices — spend driver-init time on five iOS
 * cells that cannot possibly work, or hand-edit the allowlist.
 *
 * Neither is acceptable for an unattended run. An absent device is a normal
 * operating condition, not an error.
 *
 * The filter is POSITIVE (name what to run) rather than negative (name what to
 * skip): a typo in an exclusion list silently runs everything, whereas a typo
 * in an inclusion list runs too little and is immediately obvious.
 */
const { allowedBrowsersFor, scopeToHardware } = require('../../scripts/browser-allowlist');

describe('scopeToHardware', () => {
  const LOCAL = allowedBrowsersFor('local');

  it('returns the full list when no scope is given', () => {
    // The default must never quietly narrow the matrix — a run that tests
    // less than it claims is the failure mode this whole story is about.
    expect(scopeToHardware(LOCAL, undefined)).toEqual(LOCAL);
    expect(scopeToHardware(LOCAL, '')).toEqual(LOCAL);
    expect(scopeToHardware(LOCAL, '   ')).toEqual(LOCAL);
  });

  it('keeps only the named browsers', () => {
    expect(scopeToHardware(LOCAL, 'chromium,mobile-chrome-android')).toEqual([
      'chromium',
      'mobile-chrome-android',
    ]);
  });

  it('preserves the allowlist ORDER, not the order given', () => {
    // Cell order drives resource grouping in matrix-dispatch. Letting the
    // caller reorder it would change which cells run in parallel.
    const scoped = scopeToHardware(LOCAL, 'mobile-chrome-android,chromium');
    expect(scoped).toEqual(['chromium', 'mobile-chrome-android']);
  });

  it('tolerates whitespace and blank entries', () => {
    expect(scopeToHardware(LOCAL, ' chromium , , firefox ')).toEqual(['chromium', 'firefox']);
  });

  it('THROWS on a name that is not in the allowlist', () => {
    // Silently dropping an unknown name is how a run ends up testing nothing:
    // one typo and the scope is empty. Fail loudly at configuration time.
    expect(() => scopeToHardware(LOCAL, 'chromium,mobile-chrome-androd')).toThrow(
      /mobile-chrome-androd/,
    );
  });

  it('names what IS available when it rejects', () => {
    expect(() => scopeToHardware(LOCAL, 'nonsense')).toThrow(/chromium/);
  });

  it('THROWS rather than returning an empty matrix', () => {
    // An empty run exits 0 and reports nothing wrong — the worst outcome.
    expect(() => scopeToHardware([], 'chromium')).toThrow();
  });

  it('drops every iOS cell when only Android hardware is present', () => {
    // The actual 2026-08-01 case: iPhone out, Android device available.
    const androidOnly = scopeToHardware(
      LOCAL,
      'chromium,firefox,webkit,edge,mobile-chrome-android,mobile-samsung-android,mobile-edge-android,mobile-firefox-android',
    );
    expect(androidOnly.some((b) => b.endsWith('-ios'))).toBe(false);
    // …and keeps everything that can still run: four desktop + four Android.
    expect(androidOnly).toHaveLength(8);
  });
});

describe('the env hook', () => {
  const PRIOR = process.env.GAUNTLET_BROWSERS;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.GAUNTLET_BROWSERS;
    else process.env.GAUNTLET_BROWSERS = PRIOR;
  });

  it('reads GAUNTLET_BROWSERS when no explicit scope is passed', () => {
    process.env.GAUNTLET_BROWSERS = 'chromium';
    expect(allowedBrowsersFor('local')).toEqual(['chromium']);
  });

  it('is inert when unset — the full matrix still runs', () => {
    delete process.env.GAUNTLET_BROWSERS;
    expect(allowedBrowsersFor('local').length).toBeGreaterThan(8);
  });

  it('applies to dev and prod targets too', () => {
    process.env.GAUNTLET_BROWSERS = 'chromium';
    expect(allowedBrowsersFor('dev')).toEqual(['chromium']);
    expect(allowedBrowsersFor('prod')).toEqual(['chromium']);
  });

  it('still returns [] for an unknown target', () => {
    process.env.GAUNTLET_BROWSERS = 'chromium';
    expect(allowedBrowsersFor('nope')).toEqual([]);
  });

  it('throws when the env names a browser the target does not allow', () => {
    // dev allows only chromium + mobile-chrome-android. Asking for webkit
    // there is a configuration error, not a silent no-op.
    process.env.GAUNTLET_BROWSERS = 'webkit';
    expect(() => allowedBrowsersFor('dev')).toThrow(/webkit/);
  });
});

/**
 * SHY-0263 — the preflight's verdict logic.
 *
 * Kept pure and separate from the I/O so the decisions can be asserted without
 * spawning anything. The refusal path is the one that matters: it stops a run
 * that would produce a verdict about the machine rather than about the code.
 */
const { decidePreflight } = require('../../scripts/preflight/index');

const decide = (over) =>
  decidePreflight({
    platform: 'darwin',
    ci: false,
    starvedBefore: false,
    starvedAfter: false,
    reclaimed: [],
    ...over,
  });

describe('decidePreflight', () => {
  it('proceeds when the host already has headroom', () => {
    expect(decide({})).toMatchObject({ action: 'proceed', ok: true });
  });

  it('proceeds after reclamation freed enough', () => {
    const verdict = decide({
      starvedBefore: true,
      starvedAfter: false,
      reclaimed: [{ pid: 1 }, { pid: 2 }],
    });
    expect(verdict).toMatchObject({ action: 'reclaimed', ok: true });
    expect(verdict.why).toMatch(/2 tenant/);
  });

  it('WARNS rather than blocking when the host still looks tight — advisory by default', () => {
    // Corrected 2026-07-31 after measurement. The refusal keyed on free memory,
    // and macOS keeps `unused` near zero on purpose (spare RAM goes to cache and
    // the compressor). Reclaiming 1.74 GB from Docker moved swap 3133 → 1681 MB
    // while `unused` never left ~100 MB — so the gate would refuse every run,
    // forever. An uncalibrated gate that blocks all local testing is worse than
    // the bug it prevents.
    expect(decide({ starvedBefore: true, starvedAfter: true })).toMatchObject({
      action: 'warn',
      ok: true,
    });
  });

  it('REFUSES only when explicitly asked to be strict', () => {
    expect(decide({ starvedBefore: true, starvedAfter: true, strict: true })).toMatchObject({
      action: 'refuse',
      ok: false,
    });
  });

  it('tells the operator how to opt in to blocking', () => {
    expect(decide({ starvedBefore: true, starvedAfter: true }).why).toMatch(/PREFLIGHT_STRICT/);
  });

  it('strict mode still never blocks CI', () => {
    expect(
      decide({ ci: true, strict: true, starvedBefore: true, starvedAfter: true }),
    ).toMatchObject({ action: 'skip', ok: true });
  });

  it('never refuses on CI, where runners are provisioned per job', () => {
    // A preflight that redded builds over local orphan daemons would be worse
    // than the bug it fixes.
    expect(decide({ ci: true, starvedBefore: true, starvedAfter: true })).toMatchObject({
      action: 'skip',
      ok: true,
    });
  });

  it.each(['linux', 'win32'])('skips on %s, where the macOS probes do not exist', (platform) => {
    expect(decide({ platform, starvedBefore: true, starvedAfter: true })).toMatchObject({
      action: 'skip',
      ok: true,
    });
  });

  it('always explains itself, so the log is actionable without re-running', () => {
    for (const scenario of [
      {},
      { ci: true },
      { platform: 'linux' },
      { starvedBefore: true, starvedAfter: false },
      { starvedBefore: true, starvedAfter: true },
    ]) {
      expect(decide(scenario).why).toEqual(expect.any(String));
      expect(decide(scenario).why.length).toBeGreaterThan(10);
    }
  });
});

/**
 * SHY-0457 — a device journey that never touches the device must not pass.
 *
 * J07 was green while its own screenshots showed twenty-odd frames of the same
 * empty room list. Its eleven steps signed in and then minted tokens, called
 * the API and read Firestore; the phone was never touched again. Four
 * consecutive frames were byte-identical. J08, J04, J11 and J12 had the same
 * shape — J11 walked "report → suspend → appeal → unsuspend" without a person
 * reporting anybody.
 *
 * Every assertion those journeys made was TRUE. That is what makes this
 * dangerous: nothing was lying, the suite simply never asked the product to do
 * anything, and a completely broken UI would have reported 15/15.
 *
 * The guard is structural rather than per-journey: the runner counts real UI
 * operations (taps, typing, swipes) per step, and a journey that declares
 * itself a UI journey and performs NONE outside its sign-in preamble fails —
 * whatever its own assertions said.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  journeyTouchedTheUi,
  assertJourneyTouchedTheUi,
  JOURNEY_KINDS,
  buildJourneys,
} = require('../../scripts/device-journey-runner');

const RUNNER_SRC = path.join(__dirname, '..', '..', 'scripts', 'device-journey-runner.js');

/** A step record as the reporter writes it. */
const step = (name, uiOps, preamble = false) => ({ name, status: 'pass', uiOps, preamble });

describe('journeyTouchedTheUi', () => {
  test('false when every non-preamble step performed zero UI operations', () => {
    // This is J07 exactly: sign in, then talk to the API.
    const j = {
      id: 'J07',
      kind: 'ui',
      steps: [
        step('Reach SignIn', 3, true),
        step('Pick persona', 2, true),
        step('Land on Home', 1, true),
        step('Mint Alice + Lena tokens', 0),
        step('API: Alice follows Lena', 0),
        step('DB: conversation holds both messages', 0),
      ],
    };
    expect(journeyTouchedTheUi(j)).toBe(false);
  });

  test('true when at least one non-preamble step performed a UI operation', () => {
    const j = {
      id: 'J07',
      kind: 'ui',
      steps: [step('Reach SignIn', 3, true), step('Open Messages and read the reply', 4)],
    };
    expect(journeyTouchedTheUi(j)).toBe(true);
  });

  test('the sign-in preamble does not count, however many taps it makes', () => {
    // Signing in is not evidence that the FEATURE works. Without this, every
    // API-only journey passes on the strength of its own login.
    const j = {
      id: 'J08',
      kind: 'ui',
      steps: [step('Reach SignIn', 12, true), step('API: 404', 0)],
    };
    expect(journeyTouchedTheUi(j)).toBe(false);
  });

  test('a step that failed does not count as touching the UI', () => {
    const j = {
      id: 'J07',
      kind: 'ui',
      steps: [{ name: 'Open Messages', status: 'fail', uiOps: 3, preamble: false }],
    };
    expect(journeyTouchedTheUi(j)).toBe(false);
  });

  test('missing uiOps is treated as zero, not as unknown-and-therefore-fine', () => {
    // An older report, or a step the counter never reached, must not be given
    // the benefit of the doubt — that is how the guard would quietly stop
    // guarding anything.
    const j = { id: 'J07', kind: 'ui', steps: [{ name: 'something', status: 'pass' }] };
    expect(journeyTouchedTheUi(j)).toBe(false);
  });
});

describe('assertJourneyTouchedTheUi', () => {
  const apiOnly = {
    id: 'J07',
    kind: 'ui',
    steps: [step('Reach SignIn', 3, true), step('API: follow', 0)],
  };

  test('throws for a ui journey that never touched the device', () => {
    expect(() => assertJourneyTouchedTheUi(apiOnly)).toThrow(/never touched the (device|UI)/i);
  });

  test('the message names the journey, so a red run says which one', () => {
    expect(() => assertJourneyTouchedTheUi(apiOnly)).toThrow(/J07/);
  });

  test('does not throw for an api-contract journey', () => {
    // J04's feature has no app UI at all — cohort override is a back-office
    // operation. Such a journey is honest ONLY if it says so.
    expect(() => assertJourneyTouchedTheUi({ ...apiOnly, kind: 'api-contract' })).not.toThrow();
  });

  test('does not throw for a ui journey that did touch the device', () => {
    const ok = {
      id: 'J09',
      kind: 'ui',
      steps: [step('Reach SignIn', 3, true), step('Tap create', 2)],
    };
    expect(() => assertJourneyTouchedTheUi(ok)).not.toThrow();
  });
});

describe('every journey declares an honest kind', () => {
  const built = buildJourneys({ reset: false, pkg: 'com.shyden.shytalk.local' });

  test('JOURNEY_KINDS is the closed set', () => {
    expect([...JOURNEY_KINDS].sort()).toEqual(['api-contract', 'ui']);
  });

  test('every journey declares a kind from that set', () => {
    for (const j of built) {
      expect(JOURNEY_KINDS).toContain(j.kind);
    }
  });

  test('an api-contract journey says so in its title, so a reader is not misled', () => {
    // A journey called "moderation cycle" that never opens a screen is a
    // claim about the product it cannot support. If it cannot drive the UI,
    // the title must not imply it did.
    const contracts = built.filter((x) => x.kind === 'api-contract');
    // Asserted FIRST: without this the loop below is vacuous, and a suite with
    // zero api-contract journeys would pass this test while proving nothing —
    // the same empty-collection trap that let J07 look green.
    expect(contracts.length).toBeGreaterThan(0);
    for (const j of contracts) {
      expect(j.title.toLowerCase()).toMatch(/api|contract|server-side|back-office/);
    }
  });
});

describe('source anchors — the counter cannot be bypassed', () => {
  const src = fs.readFileSync(RUNNER_SRC, 'utf8');

  test('the tap path increments the UI counter', () => {
    expect(src).toMatch(/uiOps\.count\s*\+=/);
  });

  test('the reporter records uiOps on every step', () => {
    expect(src).toMatch(/rec\.uiOps\s*=/);
  });

  test('the runner asserts it after each journey', () => {
    expect(src).toMatch(/assertJourneyTouchedTheUi\s*\(/);
  });
});

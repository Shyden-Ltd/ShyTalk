/**
 * device-journey-parallel-isolation.test.js
 *
 * The operator runs the Android and iOS walks AT THE SAME TIME, one agent per
 * device, against ONE Firebase emulator (2026-08-22 standing rule). That makes
 * account sharing between the two platforms a correctness problem, not a
 * tidiness one.
 *
 * J38 asserts on how many support requests a person has OPEN. Run the same
 * journey as the same persona on two phones at once and each run's ticket
 * lands in the other's count: the warning names a number neither expects.
 * Nothing fails cleanly — the two walks simply disagree, intermittently, and
 * the obvious reading is "the feature is flaky" rather than "the test setup
 * is".
 *
 * A test asserting the two platforms merely *have* a persona would pass with
 * both set to the same string, so every assertion here is about the accounts
 * being DIFFERENT and about them staying comparable.
 */

const fs = require('node:fs');
const path = require('node:path');

const { SUPPORT_PERSONA_BY_PLATFORM } = require('../../scripts/device-journey-runner');

const REGISTRY = fs.readFileSync(
  path.resolve(__dirname, '../../scripts/provision-test-personas.js'),
  'utf8',
);

/** The persona block for one email, from the real registry. */
function personaBlockFor(email) {
  const at = REGISTRY.indexOf(`email: '${email}'`);
  if (at === -1) return null;
  const start = REGISTRY.lastIndexOf('{', at);
  const end = REGISTRY.indexOf('\n  },', at);
  return REGISTRY.slice(start, end);
}

const field = (block, key) => block.match(new RegExp(`${key}: '([^']+)'`))?.[1];

describe('parallel device runs cannot share a support account', () => {
  const platforms = Object.keys(SUPPORT_PERSONA_BY_PLATFORM);

  test('both platforms are covered', () => {
    expect(platforms.sort()).toEqual(['android', 'ios']);
  });

  test('the two platforms use DIFFERENT accounts', () => {
    // The whole point. Equal values here restore the interference.
    const emails = Object.values(SUPPORT_PERSONA_BY_PLATFORM);
    expect({ distinct: new Set(emails).size }).toEqual({ distinct: emails.length });
  });

  test.each(platforms)('%s uses a persona that really exists in the registry', (p) => {
    // A typo'd email authenticates as nobody and the journey dies at sign-in
    // with a message about the picker, not about the address.
    expect({
      platform: p,
      found: personaBlockFor(SUPPORT_PERSONA_BY_PLATFORM[p]) !== null,
    }).toEqual({ platform: p, found: true });
  });

  test.each(platforms)('%s uses an adult, en-locale MEMBER', (p) => {
    // The two walks must exercise the SAME code path and read the SAME
    // strings. A minor hits age-segregated behaviour; a zh persona renders
    // the UI in Chinese and every English text assertion fails for a reason
    // that has nothing to do with support.
    const block = personaBlockFor(SUPPORT_PERSONA_BY_PLATFORM[p]);
    expect({
      cohort: field(block, 'cohort'),
      locale: field(block, 'locale'),
      userType: field(block, 'userType'),
    }).toEqual({ cohort: 'adult', locale: 'en', userType: 'MEMBER' });
  });

  test('the iOS persona is not signed in by any other journey', () => {
    // Isolation across JOURNEYS as well as platforms: if a voice journey also
    // signs in as this account, running it beside a support walk reintroduces
    // the collision by another route.
    const runner = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/device-journey-runner.js'),
      'utf8',
    );
    const iosPersona = SUPPORT_PERSONA_BY_PLATFORM.ios;
    // Literal occurrences only — the parameterised uses read `ctx.supportPersona`.
    const literalUses = runner.split(`'${iosPersona}'`).length - 1;
    expect({ persona: iosPersona, literalUses }).toEqual({
      persona: iosPersona,
      // Exactly one: the entry in SUPPORT_PERSONA_BY_PLATFORM itself.
      literalUses: 1,
    });
  });
});

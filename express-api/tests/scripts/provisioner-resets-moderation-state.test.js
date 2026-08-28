/**
 * SHY-0489 — a re-seed must RESTORE the persona fixture, including moderation.
 *
 * `provision-test-personas.js` upserts with `set(..., { merge: true })`, so any
 * field the document omits SURVIVES. Moderation state was omitted, which meant a
 * persona warned or suspended by a journey stayed that way through every later
 * re-seed: seeding looked like it restored the fixture and did not.
 *
 * 2026-08-28 — `host@shytalk.dev` carried a warning from an old moderation walk.
 * The app persists the session and the nav graph routes a warned user to the
 * warning screen on launch, so that ONE persona's leftover state put the warning
 * screen in front of EVERY journey's persona picker and blocked the whole dev
 * matrix.
 *
 * Nothing is mocked: this builds the real document with the real function.
 */

const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'provision-test-personas.js');
const { personas, buildUserDoc } = require(SCRIPT);

const MODERATION_FIELDS = ['hasActiveWarning', 'warningReason', 'isSuspended', 'suspensionEndDate'];

describe('the seeded persona document', () => {
  test('there are personas to seed, and the builder is exported', () => {
    // Non-vacuous: an empty registry would make every assertion below pass.
    expect(Array.isArray(personas)).toBe(true);
    expect(personas.length).toBeGreaterThan(0);
    expect(typeof buildUserDoc).toBe('function');
  });

  test('every persona is written with moderation state CLEARED', () => {
    // A merge-upsert leaves omitted fields alone, so "not set" means "whatever
    // a test left there". Each of these has to be written explicitly.
    for (const p of personas) {
      const doc = buildUserDoc(p, `fb-${p.uniqueId}`, { existingCreatedAt: null });
      expect(doc.hasActiveWarning).toBe(false);
      expect(doc.warningReason).toBeNull();
      expect(doc.isSuspended).toBe(false);
      expect(doc.suspensionEndDate).toBeNull();
    }
  });

  test('the moderation fields are PRESENT, not merely falsy by absence', () => {
    // `undefined` reads as falsy in the assertion above but writes nothing
    // through a merge — which is the exact bug. Presence is the property.
    const doc = buildUserDoc(personas[0], 'fb-x', { existingCreatedAt: null });
    for (const field of MODERATION_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(doc, field)).toBe(true);
    }
  });

  test('a persona may still override its own state via `extra`', () => {
    // The reset is a DEFAULT, not a ceiling: if a persona is ever deliberately
    // seeded into a moderation state, its own definition must win. `extra` is
    // spread after the defaults, so it does.
    const [first] = personas;
    const deliberate = { ...first, extra: { ...(first.extra || {}), isSuspended: true } };
    const doc = buildUserDoc(deliberate, 'fb-x', { existingCreatedAt: null });
    expect(doc.isSuspended).toBe(true);
  });

  test('no persona is currently seeded INTO a moderation state', () => {
    // Checked rather than assumed, and the reason the blanket reset is safe:
    // the suspension journeys create the state themselves through
    // /api/admin/users/:id/suspend and lift it afterwards.
    const seededWithState = personas
      .filter((p) => p.extra && MODERATION_FIELDS.some((f) => f in p.extra))
      .map((p) => p.email);
    expect({ seededWithState }).toEqual({ seededWithState: [] });
  });
});

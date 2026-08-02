/**
 * The door every phantom field came through, and the lock now on it.
 *
 * A generic state-seed matcher — `<Name> exists with a=1, b=2` — wrote
 * whatever the step named, unchecked. That is how `suspendedUntil`,
 * `isAgeVerified`, `isUnblockable`, `micStates`, `ownerUniqueId` and
 * `privacyVersion` all reached Firestore: each made a scenario look tested
 * while it asserted nothing, and several were SAFETY gates (an 18+ feature
 * gate; a suspension; whether a minor can block the account that delivers
 * safety notices).
 *
 * Fixing each one individually would leave the door open. These tests pin the
 * lock — and, just as importantly, pin that it does not over-lock: a guard
 * that rejects real fields would be abandoned within a week.
 */
const registry = require('../../scripts/product-field-registry');
const { isKnownProductField, rejectUnknownField, productIdentifiers, WRONG_FOR_COLLECTION } =
  registry;

describe('the scan is real', () => {
  it('reads a large body of product identifiers', () => {
    // A vacuous scan would make every "allow" below meaningless.
    expect(productIdentifiers().size).toBeGreaterThan(10000);
  });

  it('caches, so the cost is paid once and not per field', () => {
    const first = productIdentifiers();
    expect(productIdentifiers()).toBe(first);
  });

  it('re-scans after resetCache', () => {
    const first = productIdentifiers();
    registry.resetCache();
    const second = productIdentifiers();
    expect(second).not.toBe(first);
    expect(second.size).toBe(first.size);
  });
});

describe('real fields are allowed', () => {
  it.each([
    ['ageVerified', 'users', 'the 18+ gate in safety/feature-access.js'],
    ['isSuspended', 'users', 'read by the auth middleware'],
    ['suspensionEndDate', 'users', 'written by the suspend route'],
    ['acceptedLegalVersion', 'users', 'an allowed user-update field'],
    ['shyCoins', 'users', 'the wallet'],
    ['blockedUserIds', 'users', 'read by block-check'],
    ['ownerId', 'rooms', 'read by routes/rooms.js'],
    ['participantIds', 'rooms', 'the room roster'],
    // Written by /events/roster/add and READ by /events/mine, which returns it
    // so the scheduling form pre-fills from the host's standing team. It was on
    // the phantom list until 2026-08-02 because nothing used it.
    ['teamRoster', 'users', "the host's standing team"],
  ])('%s on %s (%s)', (field, collection) => {
    expect(rejectUnknownField(field, { collection })).toBeNull();
  });
});

describe('phantom fields are rejected', () => {
  it.each([
    ['isUnblockable', 'users'],
    ['definitelyNotAFieldXyz', 'users'],
  ])('%s on %s', (field, collection) => {
    expect(rejectUnknownField(field, { collection })).toMatch(/appears nowhere in the product/);
  });

  it('micStates on rooms is rejected with the BETTER message', () => {
    // It appears nowhere in the product AND has a per-collection entry, so
    // the more useful message wins — it names the replacement rather than
    // only stating the absence.
    const msg = rejectUnknownField('micStates', { collection: 'rooms' });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/isMuted/);
  });

  it('names the field, so the error points at the fix', () => {
    expect(rejectUnknownField('nonsenseField', { collection: 'users' })).toMatch(/nonsenseField/);
  });

  it('explains the CONSEQUENCE, not just the rule', () => {
    // "unknown field" invites someone to add it to an allowlist. Saying what
    // it costs invites them to use the right name.
    expect(rejectUnknownField('nonsenseField', { collection: 'users' })).toMatch(
      /establishes nothing/,
    );
  });

  it('includes the step context so the offending step is findable', () => {
    const msg = rejectUnknownField('nonsenseField', {
      collection: 'users',
      context: '"Vexa exists with …"',
    });
    expect(msg).toMatch(/Vexa exists with/);
  });
});

describe('the blind spot the coarse rule alone cannot see', () => {
  /**
   * `suspendedUntil` IS in the product — as `ident.suspendedUntil` in the
   * admin identity-graph table. Real somewhere, fiction on a user doc. A
   * "does this name exist anywhere" rule allows it, which is exactly how the
   * original bug survived, so the per-collection list has to cover it.
   */
  it('suspendedUntil exists in product source', () => {
    expect(productIdentifiers().has('suspendedUntil')).toBe(true);
  });

  it('…and is still REJECTED on a user doc', () => {
    expect(rejectUnknownField('suspendedUntil', { collection: 'users' })).toMatch(/isSuspended/);
  });

  it('names what the product uses instead', () => {
    expect(rejectUnknownField('isAgeVerified', { collection: 'users' })).toMatch(/ageVerified/);
    expect(rejectUnknownField('micStates', { collection: 'rooms' })).toMatch(/isMuted/);
  });

  it('only applies to the collection it is wrong for', () => {
    // `micStates` is wrong on rooms. On a collection with no entry, the coarse
    // rule decides — and it is still absent from the product, so still wrong.
    expect(rejectUnknownField('micStates', { collection: 'somethingElse' })).toMatch(
      /appears nowhere/,
    );
  });

  it('every WRONG_FOR_COLLECTION entry names a real replacement', () => {
    // An entry pointing at another phantom would be worse than no entry.
    for (const fields of Object.values(WRONG_FOR_COLLECTION)) {
      for (const replacement of Object.values(fields)) {
        const names = String(replacement)
          .split(/[^A-Za-z0-9_.<>]+/)
          .filter(Boolean);
        const head = names[0].split('.')[0];
        expect(productIdentifiers().has(head)).toBe(true);
      }
    }
  });
});

describe('harness-owned fields', () => {
  it('dobOnId is allowed — it is read back by the harness, never by the product', () => {
    expect(isKnownProductField('dobOnId')).toBe(true);
  });

  it('the harness-owned list stays short', () => {
    // Every entry is a field the product cannot see. A growing list means the
    // harness is drifting away from the product again.
    expect(registry.HARNESS_OWNED_FIELDS.size).toBeLessThanOrEqual(3);
  });
});

describe('input handling', () => {
  it.each([[''], [null], [undefined]])('rejects %p rather than silently allowing it', (field) => {
    expect(rejectUnknownField(field, { collection: 'users' })).toBeTruthy();
  });

  it('accepts a bare context string for callers that have no collection', () => {
    expect(rejectUnknownField('ageVerified', 'some-context')).toBeNull();
  });
});

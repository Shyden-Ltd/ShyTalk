/**
 * Unit tests for the custom-claim merge helper (UK OSA #17 PR 2).
 *
 * Firebase Admin's `setCustomUserClaims` is a REPLACE operation, not
 * a merge. Three of our route call sites mint a partial set of claims
 * (e.g. `{ uniqueId }` on sign-in, `{ cohort }` on age-up); without a
 * helper that explicitly fetches the existing claims and spreads them
 * in, each call silently wipes any unrelated claim (the most painful
 * latent bug being a sign-in stamping over `admin: true`).
 *
 * `mintClaimsMerging(uid, partial)` is the single chokepoint. Every
 * test below pins one invariant of the merge — present + absent
 * existing claims, skipFetch optimisation for new-user paths, and
 * graceful behaviour when `auth.getUser` throws (user not yet
 * provisioned in Firebase Auth).
 *
 * `effectiveCohort(userData)` resolves the override precedence rule
 * (`cohortOverride` wins when non-null) and the legacy/missing-field
 * default (`'minor'` — most-restrictive per the OSA "fail closed"
 * posture in the design doc).
 */

const mockSetCustomUserClaims = jest.fn().mockResolvedValue();
const mockGetUser = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  auth: {
    setCustomUserClaims: (...args) => mockSetCustomUserClaims(...args),
    getUser: (...args) => mockGetUser(...args),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

const {
  mintClaimsMerging,
  effectiveCohort,
  deriveCohortFromUser,
  isAtLeast18FromDob,
  cohortFromClaim,
  VALID_COHORTS,
} = require('../../src/utils/firebase-claims');

describe('mintClaimsMerging', () => {
  test('merges partial claims with existing claims', async () => {
    // Existing claims have admin: true; we mint `{ cohort: 'adult' }`.
    // The set call must preserve admin AND include the new cohort —
    // proving the helper isn't silently dropping the admin grant.
    mockGetUser.mockResolvedValue({
      uid: 'fb-uid',
      customClaims: { uniqueId: 10000050, admin: true },
    });

    await mintClaimsMerging('fb-uid', { cohort: 'adult' });

    expect(mockGetUser).toHaveBeenCalledWith('fb-uid');
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 10000050,
      admin: true,
      cohort: 'adult',
    });
  });

  test('partial overrides existing field with same key', async () => {
    // Existing has cohort: 'minor'; partial mints cohort: 'adult'.
    // The newer value must win — this is the age-up flip path.
    mockGetUser.mockResolvedValue({
      uid: 'fb-uid',
      customClaims: { uniqueId: 10000050, cohort: 'minor' },
    });

    await mintClaimsMerging('fb-uid', { cohort: 'adult' });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 10000050,
      cohort: 'adult',
    });
  });

  test('handles user with no existing customClaims (undefined)', async () => {
    // A user who has never had claims minted: getUser returns a
    // record where customClaims is undefined. The spread must default
    // to {} so we don't throw "Cannot spread undefined".
    mockGetUser.mockResolvedValue({ uid: 'fb-uid' });

    await mintClaimsMerging('fb-uid', { uniqueId: 10000050, cohort: 'adult' });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 10000050,
      cohort: 'adult',
    });
  });

  test('handles getUser failure by treating existing as empty', async () => {
    // The user may not exist in Firebase Auth yet (race between
    // sign-up and identity creation; or admin DOB-modify on a user
    // whose Firebase record was reaped). Helper must not propagate
    // — empty existing + partial is still a safe mint.
    mockGetUser.mockRejectedValue(new Error('auth/user-not-found'));

    await mintClaimsMerging('fb-uid', { uniqueId: 10000050, cohort: 'minor' });

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 10000050,
      cohort: 'minor',
    });
  });

  test('skipFetch: true bypasses getUser (signup optimisation)', async () => {
    // Signup mints into a brand-new Firebase Auth record; there are
    // no existing claims to preserve. Skipping the getUser round-trip
    // saves ~150ms on the signup critical path. The helper still
    // hits setCustomUserClaims with just the partial.
    await mintClaimsMerging('fb-uid', { uniqueId: 99999999, cohort: 'adult' }, { skipFetch: true });

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('fb-uid', {
      uniqueId: 99999999,
      cohort: 'adult',
    });
  });

  test('propagates setCustomUserClaims failure to caller', async () => {
    // The route layer is responsible for deciding the partial-failure
    // contract (log warning, surface a flag, etc.). The helper must
    // not swallow the rejection — otherwise the route can't tell a
    // failed mint from a successful one.
    mockGetUser.mockResolvedValue({ customClaims: {} });
    mockSetCustomUserClaims.mockRejectedValueOnce(new Error('auth/internal'));

    await expect(mintClaimsMerging('fb-uid', { cohort: 'adult' })).rejects.toThrow('auth/internal');
  });
});

describe('effectiveCohort', () => {
  test('returns cohortOverride when present and non-empty', async () => {
    // Override takes precedence — admin-set, audit-logged, used to
    // pin moderators/staff/test-accounts to a specific cohort
    // regardless of DOB.
    expect(effectiveCohort({ cohort: 'minor', cohortOverride: 'adult' })).toBe('adult');
    expect(effectiveCohort({ cohort: 'adult', cohortOverride: 'minor' })).toBe('minor');
  });

  test('falls through to cohort when cohortOverride is null', async () => {
    expect(effectiveCohort({ cohort: 'adult', cohortOverride: null })).toBe('adult');
    expect(effectiveCohort({ cohort: 'minor' })).toBe('minor');
  });

  test('treats empty-string cohortOverride as absent', async () => {
    // Defensive — Firestore can return '' for a string field that
    // was set then cleared without explicit FieldValue.delete().
    expect(effectiveCohort({ cohort: 'adult', cohortOverride: '' })).toBe('adult');
  });

  test('defaults to "minor" for missing/non-string cohort (most-restrictive)', async () => {
    // OSA posture: when the field is missing (legacy account), fail
    // closed to the minor cohort. The first sign-in pm-lock-check
    // will write the correct value.
    expect(effectiveCohort({})).toBe('minor');
    expect(effectiveCohort({ cohort: null })).toBe('minor');
    expect(effectiveCohort({ cohort: 42 })).toBe('minor');
    expect(effectiveCohort(undefined)).toBe('minor');
  });

  test('rejects non-allow-listed cohortOverride values (security review HIGH #2)', async () => {
    // A future admin-panel bug or migration could write a typo
    // like 'super-admin' or a legacy value 'verified-adult'. The
    // allow-list must reject the bogus string and fall through to
    // the next priority (cohort field, then 'minor').
    expect(effectiveCohort({ cohortOverride: 'super-admin', cohort: 'minor' })).toBe('minor');
    expect(effectiveCohort({ cohortOverride: 'verified-adult', cohort: 'adult' })).toBe('adult');
    expect(effectiveCohort({ cohortOverride: 'ADULT', cohort: 'minor' })).toBe('minor'); // case-sensitive
  });

  test('rejects non-allow-listed cohort field values', async () => {
    expect(effectiveCohort({ cohort: 'bogus' })).toBe('minor');
    expect(effectiveCohort({ cohort: 'ADULT' })).toBe('minor'); // case-sensitive
  });
});

describe('deriveCohortFromUser', () => {
  function dobYearsAgo(years, nowMs = Date.now()) {
    const d = new Date(nowMs);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d.getTime();
  }
  const NOW = Date.UTC(2026, 4, 13); // fixed for determinism

  test('derives "adult" from DOB ≥18 years ago', async () => {
    expect(deriveCohortFromUser({ dateOfBirth: dobYearsAgo(18, NOW) }, NOW)).toBe('adult');
    expect(deriveCohortFromUser({ dateOfBirth: dobYearsAgo(25, NOW) }, NOW)).toBe('adult');
  });

  test('derives "minor" from DOB <18 years ago', async () => {
    expect(deriveCohortFromUser({ dateOfBirth: dobYearsAgo(17, NOW) }, NOW)).toBe('minor');
    expect(deriveCohortFromUser({ dateOfBirth: dobYearsAgo(16, NOW) }, NOW)).toBe('minor');
  });

  test('cohortOverride wins over DOB-derived cohort', async () => {
    // 16-y/o moderator with admin override → adult claim.
    expect(
      deriveCohortFromUser({ dateOfBirth: dobYearsAgo(16, NOW), cohortOverride: 'adult' }, NOW),
    ).toBe('adult');
    // 25-y/o admin with restrictive override → minor claim.
    expect(
      deriveCohortFromUser({ dateOfBirth: dobYearsAgo(25, NOW), cohortOverride: 'minor' }, NOW),
    ).toBe('minor');
  });

  test('IGNORES stale cached cohort field when DOB is present (security defense)', async () => {
    // Cached field says 'adult', DOB says 17. DOB wins. This is
    // the entire point of the security review HIGH #1 fix.
    expect(deriveCohortFromUser({ cohort: 'adult', dateOfBirth: dobYearsAgo(17, NOW) }, NOW)).toBe(
      'minor',
    );
    expect(deriveCohortFromUser({ cohort: 'minor', dateOfBirth: dobYearsAgo(20, NOW) }, NOW)).toBe(
      'adult',
    );
  });

  test('defaults to "minor" when no DOB and no override', async () => {
    expect(deriveCohortFromUser({}, NOW)).toBe('minor');
    expect(deriveCohortFromUser(null, NOW)).toBe('minor');
    expect(deriveCohortFromUser({ cohort: 'adult' }, NOW)).toBe('minor'); // no DOB = minor
    expect(deriveCohortFromUser({ dateOfBirth: 'not-a-number' }, NOW)).toBe('minor');
  });

  test('rejects non-allow-listed cohortOverride values (falls through to DOB)', async () => {
    // 25-y/o user with bogus override → DOB-derive → 'adult'
    expect(
      deriveCohortFromUser(
        { dateOfBirth: dobYearsAgo(25, NOW), cohortOverride: 'super-admin' },
        NOW,
      ),
    ).toBe('adult');
    // 16-y/o user with bogus override → DOB-derive → 'minor'
    expect(
      deriveCohortFromUser({ dateOfBirth: dobYearsAgo(16, NOW), cohortOverride: 'staff' }, NOW),
    ).toBe('minor');
  });
});

describe('isAtLeast18FromDob (leap-year + boundary edge cases)', () => {
  test('exactly 18 years ago today is adult', async () => {
    const now = Date.UTC(2026, 4, 13);
    const dob = Date.UTC(2008, 4, 13);
    expect(isAtLeast18FromDob(dob, now)).toBe(true);
  });

  test('18th birthday tomorrow is still minor', async () => {
    const now = Date.UTC(2026, 4, 13);
    const dobTomorrow = Date.UTC(2008, 4, 14);
    expect(isAtLeast18FromDob(dobTomorrow, now)).toBe(false);
  });

  test('rejects non-finite DOB inputs (NaN, Infinity, string)', async () => {
    const now = Date.UTC(2026, 4, 13);
    expect(isAtLeast18FromDob(NaN, now)).toBe(false);
    expect(isAtLeast18FromDob(Infinity, now)).toBe(false);
    expect(isAtLeast18FromDob('1000000', now)).toBe(false);
    expect(isAtLeast18FromDob(null, now)).toBe(false);
    expect(isAtLeast18FromDob(undefined, now)).toBe(false);
  });
});

describe('VALID_COHORTS allow-list', () => {
  test('exposes the cohort allow-list for use elsewhere', async () => {
    expect(VALID_COHORTS.has('adult')).toBe(true);
    expect(VALID_COHORTS.has('minor')).toBe(true);
    expect(VALID_COHORTS.has('Adult')).toBe(false);
    expect(VALID_COHORTS.has('verified-adult')).toBe(false);
  });
});

describe('cohortFromClaim', () => {
  test('returns claim when it is an allow-listed cohort', () => {
    expect(cohortFromClaim({ auth: { token: { cohort: 'adult' } } })).toBe('adult');
    expect(cohortFromClaim({ auth: { token: { cohort: 'minor' } } })).toBe('minor');
  });

  test('fail-closed to "minor" when claim is missing', () => {
    expect(cohortFromClaim({ auth: { token: {} } })).toBe('minor');
    expect(cohortFromClaim({ auth: {} })).toBe('minor');
    expect(cohortFromClaim({})).toBe('minor');
    expect(cohortFromClaim(null)).toBe('minor');
    expect(cohortFromClaim(undefined)).toBe('minor');
  });

  test('fail-closed to "minor" for non-string / invalid claim values', () => {
    expect(cohortFromClaim({ auth: { token: { cohort: null } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: 42 } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: true } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: '' } } })).toBe('minor');
  });

  test('fail-closed to "minor" for strings not in the allow-list (case-sensitive)', () => {
    expect(cohortFromClaim({ auth: { token: { cohort: 'Adult' } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: 'ADULT' } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: 'verified-adult' } } })).toBe('minor');
    expect(cohortFromClaim({ auth: { token: { cohort: 'staff' } } })).toBe('minor');
  });
});

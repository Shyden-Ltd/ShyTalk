/**
 * Locks the contract for seeded test users in `local/seed.js`.
 *
 * Backstory: during the 2026-05-12 manual-QA cycle on PR #651, B3 room-message
 * reporting failed end-to-end on local because every seeded test user was
 * missing `dateOfBirth` + `age`, which forced the C8 age-verification flow on
 * first sign-in and blocked downstream QA. These tests pin the DOB shape so a
 * future refactor that drops the fields gets caught before manual-QA does.
 *
 * Static-source assertions because the seed module is a Firebase-Admin-coupled
 * side-effect script that's awkward to exec under Jest.
 */
const fs = require('fs');
const path = require('path');

const seedPath = path.resolve(__dirname, '../../../local/seed.js');
const seedSrc = fs.readFileSync(seedPath, 'utf8');

/**
 * Run the user-invariant battery against a seeded user block. Sharing the
 * assertions through one helper keeps the admin / regular-user coverage
 * symmetric and stops duplicated-test-block growth (3% SonarCloud gate).
 */
function describeSeededUserInvariants(label, uniqueId, firebaseVar) {
  describe(`${label} (${uniqueId})`, () => {
    const block = seedSrc.match(
      new RegExp(`seedIfMissing\\("users\\/${uniqueId}",\\s*\\{([\\s\\S]*?)\\}\\s*\\)\\s*;`),
    );

    it('user block is present', () => {
      expect(block).not.toBeNull();
    });

    it('does NOT carry a uid field (mirrors production users.js which never writes uid)', () => {
      // Production user creation in express-api/src/routes/users.js writes
      // `uniqueId` + `firebaseUid` to `users/<uniqueId>` and never writes a
      // `uid` field. The seed should match — adding `uid: ...` here would
      // diverge from prod and risk masking field-handling bugs.
      expect(block[1]).not.toMatch(/\buid:\s*/);
    });

    it(`firebaseUid is set to ${firebaseVar} (sanity)`, () => {
      expect(block[1]).toMatch(new RegExp(`\\bfirebaseUid:\\s*${firebaseVar}\\b`));
    });

    it('has dateOfBirth + age + ageVerified to bypass the C8 gate', () => {
      // Without these the first sign-in hits "One More Step — Select Date
      // of Birth" and blocks every downstream QA flow.
      expect(block[1]).toMatch(/\bdateOfBirth:\s*"\d{4}-\d{2}-\d{2}"/);
      expect(block[1]).toMatch(/\bage:\s*\d+/);
      expect(block[1]).toMatch(/\bageVerified:\s*true/);
    });

    it('age is high enough to clear every per-feature gate', () => {
      // C8 max gate is 18 (adults-only DMs / voice rooms). Seeded age must
      // be >= 18 so the seeded user can reach every feature surface without
      // bumping into age restrictions mid-QA.
      const ageMatch = block[1].match(/\bage:\s*(\d+)/);
      expect(ageMatch).not.toBeNull();
      expect(Number(ageMatch[1])).toBeGreaterThanOrEqual(18);
    });

    it('has cohort: "adult" so segregation gates pass on first sign-in (UK OSA #17)', () => {
      // PR 1 of the age-segregation initiative adds a `cohort` field to
      // every user doc. Seeded test users are 18+ (see test above), so
      // their cohort MUST be "adult" — otherwise the first sign-in
      // pm-lock-check would have to flip them, and any downstream test
      // that runs BEFORE the flip would see a stale `minor` cohort and
      // hit the wrong discovery filter / 404 path.
      expect(block[1]).toMatch(/\bcohort:\s*"adult"/);
    });
  });
}

describe('local/seed.js — user doc invariants', () => {
  describeSeededUserInvariants('admin user', '100000001', 'adminFirebaseUid');
  describeSeededUserInvariants('regular user', '100000002', 'userFirebaseUid');

  describe('identityMap entries (cross-check)', () => {
    it('identityMap entry for claude-test@shytalk.dev maps to uniqueId 100000001', () => {
      expect(seedSrc).toMatch(
        /seedIfMissing\("identityMap\/email:claude-test@shytalk\.dev"[\s\S]{0,400}uniqueId:\s*100000001/,
      );
    });

    it('identityMap entry for user@test.com maps to uniqueId 100000002', () => {
      expect(seedSrc).toMatch(
        /seedIfMissing\("identityMap\/email:user@test\.com"[\s\S]{0,400}uniqueId:\s*100000002/,
      );
    });
  });
});

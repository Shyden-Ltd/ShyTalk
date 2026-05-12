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

describe('local/seed.js — user doc invariants', () => {
  describe('admin user (100000001)', () => {
    const adminBlock = seedSrc.match(
      /seedIfMissing\("users\/100000001",\s*\{([\s\S]*?)\}\s*\)\s*;/,
    );

    it('admin user block is present', () => {
      expect(adminBlock).not.toBeNull();
    });

    it('admin user does NOT carry a uid field (mirrors production users.js which never writes uid)', () => {
      // Production user creation in express-api/src/routes/users.js writes
      // `uniqueId` + `firebaseUid` to `users/<uniqueId>` and never writes a
      // `uid` field. The seed should match — adding `uid: ...` here would
      // diverge from prod and risk masking field-handling bugs.
      expect(adminBlock[1]).not.toMatch(/\buid:\s*/);
    });

    it('admin firebaseUid is set to adminFirebaseUid (sanity)', () => {
      expect(adminBlock[1]).toMatch(/\bfirebaseUid:\s*adminFirebaseUid\b/);
    });

    it('admin has dateOfBirth + age + ageVerified to bypass the C8 gate', () => {
      // Without these the first sign-in hits "One More Step — Select Date
      // of Birth" and blocks every downstream QA flow.
      expect(adminBlock[1]).toMatch(/\bdateOfBirth:\s*"\d{4}-\d{2}-\d{2}"/);
      expect(adminBlock[1]).toMatch(/\bage:\s*\d+/);
      expect(adminBlock[1]).toMatch(/\bageVerified:\s*true/);
    });

    it('admin age is high enough to clear every per-feature gate', () => {
      // C8 max gate is 18 (adults-only DMs / voice rooms). Seeded
      // age must be >= 18 so the seeded admin can join every feature
      // surface without bumping into age restrictions mid-QA.
      const ageMatch = adminBlock[1].match(/\bage:\s*(\d+)/);
      expect(ageMatch).not.toBeNull();
      expect(Number(ageMatch[1])).toBeGreaterThanOrEqual(18);
    });
  });

  describe('regular user (100000002)', () => {
    const userBlock = seedSrc.match(/seedIfMissing\("users\/100000002",\s*\{([\s\S]*?)\}\s*\)\s*;/);

    it('regular-user block is present', () => {
      expect(userBlock).not.toBeNull();
    });

    it('regular user does NOT carry a uid field (matches production users.js)', () => {
      expect(userBlock[1]).not.toMatch(/\buid:\s*/);
    });

    it('regular-user firebaseUid is userFirebaseUid (sanity)', () => {
      expect(userBlock[1]).toMatch(/\bfirebaseUid:\s*userFirebaseUid\b/);
    });

    it('regular-user has dateOfBirth + age + ageVerified', () => {
      expect(userBlock[1]).toMatch(/\bdateOfBirth:\s*"\d{4}-\d{2}-\d{2}"/);
      expect(userBlock[1]).toMatch(/\bage:\s*\d+/);
      expect(userBlock[1]).toMatch(/\bageVerified:\s*true/);
    });

    it('regular-user age is high enough to clear every per-feature gate', () => {
      const ageMatch = userBlock[1].match(/\bage:\s*(\d+)/);
      expect(ageMatch).not.toBeNull();
      expect(Number(ageMatch[1])).toBeGreaterThanOrEqual(18);
    });
  });

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

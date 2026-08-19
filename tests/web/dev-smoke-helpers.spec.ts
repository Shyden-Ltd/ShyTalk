import { test, expect } from '@playwright/test';
import { deriveOwnerFirebaseUid, buildRoomsCreateFailureHint } from './helpers/dev-smoke';

/**
 * Pure-logic coverage for the dev-smoke helpers (SHY-0178). Unlike
 * dev-smoke.spec.ts (which self-skips without the smoke secret
 * bundle and only ever runs in deploy-dev.yml), these tests need no
 * environment at all, so they run in the LOCAL suites — the one part
 * of the dev-smoke apparatus the local gauntlet can prove.
 */

test.describe('deriveOwnerFirebaseUid — uid claim extraction', () => {
  test('prefers user_id when both user_id and sub are present', () => {
    expect(deriveOwnerFirebaseUid({ user_id: 'uid-primary', sub: 'uid-standard' })).toBe(
      'uid-primary',
    );
  });

  test('falls back to sub when user_id is absent', () => {
    expect(deriveOwnerFirebaseUid({ sub: 'uid-standard' })).toBe('uid-standard');
  });

  test('falls back to sub when user_id is an empty string', () => {
    expect(deriveOwnerFirebaseUid({ user_id: '', sub: 'uid-standard' })).toBe('uid-standard');
  });

  test('returns undefined when both claims are absent', () => {
    expect(deriveOwnerFirebaseUid({})).toBeUndefined();
  });

  test('returns undefined when both claims are empty strings', () => {
    expect(deriveOwnerFirebaseUid({ user_id: '', sub: '' })).toBeUndefined();
  });

  test('skips a non-string user_id and uses a string sub', () => {
    // A numeric/object claim must never be stamped into a Firestore
    // REST `stringValue` — the helper only ever returns strings.
    expect(deriveOwnerFirebaseUid({ user_id: 12345, sub: 'uid-standard' })).toBe('uid-standard');
  });

  test('returns undefined when both claims are non-string values', () => {
    expect(deriveOwnerFirebaseUid({ user_id: 12345, sub: { nested: true } })).toBeUndefined();
  });

  test('pins whitespace-only user_id as returned verbatim (no trimming)', () => {
    // Firebase uids never contain whitespace; the helper deliberately
    // does not second-guess the token by trimming. A whitespace-only
    // claim is a non-empty string and is returned as-is — the caller's
    // rule-level comparison against request.auth.uid is the arbiter.
    expect(deriveOwnerFirebaseUid({ user_id: '   ', sub: 'uid-standard' })).toBe('   ');
  });
});

test.describe('buildRoomsCreateFailureHint — denial diagnostic', () => {
  test('names the failing write, the response, and every rooms-create precondition', () => {
    expect(
      buildRoomsCreateFailureHint({
        roomName: 'smoke-livekit-1751000000000',
        status: 403,
        bodyText: '{"error":{"status":"PERMISSION_DENIED"}}',
        projectId: 'shytalk-dev',
      }),
    ).toBe(
      'Firestore REST write to rooms/smoke-livekit-1751000000000 failed ' +
        '(403): {"error":{"status":"PERMISSION_DENIED"}}. ' +
        'Verify FIREBASE_PROJECT_ID="shytalk-dev" matches the dev Firebase ' +
        'project, that the smoke account has `uniqueId` + `cohort` custom ' +
        'claims minted (run pm-lock-check or re-sign-in as the smoke user), ' +
        'that the smoke account is signed in and not banned (SHY-0150 ' +
        'isBanned() gate), and that the rooms-create rule still permits ' +
        'owner=self + ownerFirebaseUid=auth-uid + cohort=claim writes.',
    );
  });

  test('interpolates a different status, body, project and room verbatim', () => {
    const hint = buildRoomsCreateFailureHint({
      roomName: 'smoke-negctl-42',
      status: 500,
      bodyText: 'upstream unavailable',
      projectId: 'shytalk-7ba69',
    });
    expect(hint).toContain(
      'Firestore REST write to rooms/smoke-negctl-42 failed (500): upstream unavailable.',
    );
    expect(hint).toContain('FIREBASE_PROJECT_ID="shytalk-7ba69"');
  });
});

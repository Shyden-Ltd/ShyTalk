import { test, expect } from './fixtures/admin';

/**
 * E2E coverage for the suspension-cascade and warning-no-cascade behaviour
 * matrix from the admin surface.
 *
 * Strategy:
 *   - Seed an ephemeral room via /api/test/write/rooms with the test user
 *     plugged into a specific role (owner / host / attendee / visitor).
 *   - Trigger suspend or warn via the admin Bearer-token API (the same
 *     endpoint the admin UI button hits — UI-button coverage already lives
 *     in admin-users-moderation.spec.ts).
 *   - Read the room back via /api/test/verify and check the resulting state.
 *
 * Mirrors the unit + integration coverage:
 *   - tests/utils/evict-suspended-user.test.js (Express util-level matrix)
 *   - tests/routes/admin-users-warn-room-cascade.test.js (warning-preserves)
 *   - shared/src/jvmTest/.../ChatRoomPermissionsTest.kt (host action policy)
 *
 * Behaviour spec being verified end-to-end:
 *   - Suspending the room owner    → state=CLOSED, participantIds + hostIds wiped
 *   - Suspending a host            → removed from hostIds AND participantIds; seat cleared
 *   - Suspending a seated attendee → seat cleared; removed from participantIds
 *   - Suspending a visitor         → only participantIds touched
 *   - Issuing a warning            → NO room change for any role
 */

const SUSPEND_END_DATE = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

test.describe('Admin Users — Suspension Cascade & Warning Preservation', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Seed a fully-occupied 8-seat room. Returns the room id.
   *   seat 0 = owner, seats 1+2 = hosts, seats 3..7 = attendees.
   * The user fixture (testData.user) plugs into whichever role the test
   * exercises by passing its uniqueId in the corresponding slot.
   */
  async function seedFullRoom(
    api: any,
    testRunId: string,
    overrides: { ownerId: string; hostIds: string[]; attendeeIds: string[] },
  ): Promise<string> {
    const { ownerId, hostIds, attendeeIds } = overrides;
    const allParticipants = [ownerId, ...hostIds, ...attendeeIds];
    const seats: Record<string, any> = {};
    seats['0'] = { userId: ownerId, state: 'OCCUPIED', isMuted: false };
    hostIds.forEach((id, i) => {
      seats[String(i + 1)] = { userId: id, state: 'OCCUPIED', isMuted: false };
    });
    attendeeIds.forEach((id, i) => {
      seats[String(i + 1 + hostIds.length)] = { userId: id, state: 'OCCUPIED', isMuted: false };
    });

    const result = await api.testWrite('rooms', {
      _testRun: testRunId,
      ownerId,
      name: 'Cascade Test Room',
      state: 'ACTIVE',
      participantIds: allParticipants,
      hostIds,
      seats,
      voiceRoomName: 'cascade-test',
      createdAt: Date.now(),
      requireApproval: false,
    });
    return result.id;
  }

  // ── Suspension cascade ────────────────────────────────────────

  test('suspending the room owner closes the room', async ({ testData }) => {
    const ownerId = String(testData.user.uniqueId);
    const roomId = await seedFullRoom(testData.api, testData.testRunId, {
      ownerId,
      hostIds: [`${testData.prefix}_host1`, `${testData.prefix}_host2`],
      attendeeIds: [
        `${testData.prefix}_att1`,
        `${testData.prefix}_att2`,
        `${testData.prefix}_att3`,
        `${testData.prefix}_att4`,
        `${testData.prefix}_att5`,
      ],
    });

    await testData.api.post(`/api/user/${ownerId}/suspend`, {
      reason: 'Cascade test — owner',
      endDate: SUSPEND_END_DATE(),
      canAppeal: true,
    });

    // Cascade is fire-and-forget — poll until it settles
    await expect
      .poll(async () => (await testData.api.testVerify('rooms', roomId)).state, {
        timeout: 15_000,
      })
      .toBe('CLOSED');
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.closedAt).toBeGreaterThan(0);
    expect(room.participantIds).toEqual([]);
    expect(room.hostIds).toEqual([]);

    // Cleanup so subsequent tests start with an unsuspended user
    await testData.api.post(`/api/user/${ownerId}/unsuspend`);
    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });

  test('suspending a seated host clears seat + removes from hostIds', async ({ testData }) => {
    const targetId = String(testData.user.uniqueId);
    const ownerStub = `${testData.prefix}_owner`;
    const otherHost = `${testData.prefix}_host2`;
    const roomId = await seedFullRoom(testData.api, testData.testRunId, {
      ownerId: ownerStub,
      hostIds: [targetId, otherHost], // user is host in seat 1
      attendeeIds: [
        `${testData.prefix}_att1`,
        `${testData.prefix}_att2`,
        `${testData.prefix}_att3`,
        `${testData.prefix}_att4`,
        `${testData.prefix}_att5`,
      ],
    });

    await testData.api.post(`/api/user/${targetId}/suspend`, {
      reason: 'Cascade test — host',
      endDate: SUSPEND_END_DATE(),
      canAppeal: true,
    });

    // Cascade is fire-and-forget — poll until hostIds + seat are cleared
    await expect
      .poll(async () => (await testData.api.testVerify('rooms', roomId)).hostIds, {
        timeout: 15_000,
      })
      .not.toContain(targetId);
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE'); // room stays open
    expect(room.hostIds).toContain(otherHost);
    expect(room.participantIds).not.toContain(targetId);
    expect(room.seats[1]).toEqual({
      userId: null,
      state: 'EMPTY',
      isMuted: false,
    });
    // Other seats untouched
    expect(room.seats[0].userId).toBe(ownerStub);
    expect(room.seats[2].userId).toBe(otherHost);

    await testData.api.post(`/api/user/${targetId}/unsuspend`);
    await testData.api.post(`/api/user/${targetId}/reset-gcs`);
  });

  test('suspending a seated non-host clears seat + leaves hostIds untouched', async ({
    testData,
  }) => {
    const targetId = String(testData.user.uniqueId);
    const host1 = `${testData.prefix}_host1`;
    const host2 = `${testData.prefix}_host2`;
    const roomId = await seedFullRoom(testData.api, testData.testRunId, {
      ownerId: `${testData.prefix}_owner`,
      hostIds: [host1, host2],
      attendeeIds: [
        targetId, // seat 3
        `${testData.prefix}_att2`,
        `${testData.prefix}_att3`,
        `${testData.prefix}_att4`,
        `${testData.prefix}_att5`,
      ],
    });

    await testData.api.post(`/api/user/${targetId}/suspend`, {
      reason: 'Cascade test — attendee',
      endDate: SUSPEND_END_DATE(),
      canAppeal: true,
    });

    // Cascade is fire-and-forget — poll until participant is removed
    await expect
      .poll(
        async () => (await testData.api.testVerify('rooms', roomId)).participantIds,
        { timeout: 15_000 },
      )
      .not.toContain(targetId);
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE');
    expect(room.hostIds).toEqual([host1, host2]);
    expect(room.seats[3]).toEqual({
      userId: null,
      state: 'EMPTY',
      isMuted: false,
    });

    await testData.api.post(`/api/user/${targetId}/unsuspend`);
    await testData.api.post(`/api/user/${targetId}/reset-gcs`);
  });

  test('suspending a visitor only removes them from participantIds', async ({ testData }) => {
    const visitorId = String(testData.user.uniqueId);
    const ownerId = `${testData.prefix}_owner`;
    // Build room with visitor in participantIds but NOT in any seat or hostIds
    const result = await testData.api.testWrite('rooms', {
      _testRun: testData.testRunId,
      ownerId,
      name: 'Cascade Visitor Test',
      state: 'ACTIVE',
      participantIds: [ownerId, visitorId],
      hostIds: [],
      seats: {
        '0': { userId: ownerId, state: 'OCCUPIED', isMuted: false },
        '1': { userId: null, state: 'EMPTY', isMuted: false },
      },
      voiceRoomName: 'cascade-visitor',
      createdAt: Date.now(),
      requireApproval: false,
    });
    const roomId = result.id;

    await testData.api.post(`/api/user/${visitorId}/suspend`, {
      reason: 'Cascade test — visitor',
      endDate: SUSPEND_END_DATE(),
      canAppeal: true,
    });

    // Cascade is fire-and-forget — poll until visitor is removed from participants
    await expect
      .poll(
        async () => (await testData.api.testVerify('rooms', roomId)).participantIds,
        { timeout: 15_000 },
      )
      .not.toContain(visitorId);
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE');
    expect(room.participantIds).toContain(ownerId);
    expect(room.hostIds).toEqual([]);
    expect(room.seats[0].userId).toBe(ownerId); // owner seat preserved
    expect(room.seats[1].userId).toBeNull();

    await testData.api.post(`/api/user/${visitorId}/unsuspend`);
    await testData.api.post(`/api/user/${visitorId}/reset-gcs`);
  });

  test('suspending the owner of an abandoned room still closes it', async ({ testData }) => {
    const ownerId = String(testData.user.uniqueId);
    // Owner is NOT in participantIds — they have abandoned the room
    const result = await testData.api.testWrite('rooms', {
      _testRun: testData.testRunId,
      ownerId,
      name: 'Abandoned Room',
      state: 'ACTIVE',
      participantIds: [`${testData.prefix}_other`],
      hostIds: [],
      seats: {},
      voiceRoomName: 'abandoned',
      createdAt: Date.now(),
      requireApproval: false,
    });
    const roomId = result.id;

    await testData.api.post(`/api/user/${ownerId}/suspend`, {
      reason: 'Cascade test — abandoned owner',
      endDate: SUSPEND_END_DATE(),
      canAppeal: true,
    });

    // The owner-query path catches this case even when the participants-only
    // query would miss it. Poll until the cascade settles.
    await expect
      .poll(async () => (await testData.api.testVerify('rooms', roomId)).state, {
        timeout: 15_000,
      })
      .toBe('CLOSED');

    await testData.api.post(`/api/user/${ownerId}/unsuspend`);
    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });

  // ── Warning preservation ──────────────────────────────────────

  test('warning a seated user does NOT touch the room', async ({ testData }) => {
    const targetId = String(testData.user.uniqueId);
    const ownerId = `${testData.prefix}_owner`;
    // User is in seat 3 as an attendee
    const result = await testData.api.testWrite('rooms', {
      _testRun: testData.testRunId,
      ownerId,
      name: 'Warning Preservation Test',
      state: 'ACTIVE',
      participantIds: [ownerId, targetId],
      hostIds: [],
      seats: {
        '0': { userId: ownerId, state: 'OCCUPIED', isMuted: false },
        '3': { userId: targetId, state: 'OCCUPIED', isMuted: false },
      },
      voiceRoomName: 'warn-test',
      createdAt: Date.now(),
      requireApproval: false,
    });
    const roomId = result.id;

    // Snapshot the room BEFORE the warning
    const before = await testData.api.testVerify('rooms', roomId);

    await testData.api.post(`/api/user/${targetId}/warn`, {
      reason: 'Spam',
      severity: 3,
      adminNote: null,
    });

    // Room must be byte-for-byte unchanged
    const after = await testData.api.testVerify('rooms', roomId);
    expect(after.state).toBe(before.state);
    expect(after.participantIds).toEqual(before.participantIds);
    expect(after.hostIds).toEqual(before.hostIds);
    expect(after.seats).toEqual(before.seats);
    expect(after.closedAt).toEqual(before.closedAt);

    // User doc reflects the warning even though room didn't change
    const adminData = await testData.api.get(`/api/user/${targetId}`);
    expect(adminData.hasActiveWarning).toBe(true);
    expect(adminData.warningCount).toBeGreaterThanOrEqual(1);
    expect(adminData.gcsScore).toBeLessThan(100);

    // Cleanup GCS
    await testData.api.post(`/api/user/${targetId}/reset-gcs`);
  });

  test('warning the room owner does NOT close the room', async ({ testData }) => {
    const ownerId = String(testData.user.uniqueId);
    const result = await testData.api.testWrite('rooms', {
      _testRun: testData.testRunId,
      ownerId,
      name: 'Owner Warning Test',
      state: 'ACTIVE',
      participantIds: [ownerId, `${testData.prefix}_guest`],
      hostIds: [],
      seats: {
        '0': { userId: ownerId, state: 'OCCUPIED', isMuted: false },
      },
      voiceRoomName: 'owner-warn',
      createdAt: Date.now(),
      requireApproval: false,
    });
    const roomId = result.id;

    await testData.api.post(`/api/user/${ownerId}/warn`, {
      reason: 'Other',
      severity: 3,
      adminNote: null,
    });

    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE'); // NOT closed
    expect(room.closedAt).toBeFalsy();
    expect(room.participantIds).toContain(ownerId);
    expect(room.seats[0].userId).toBe(ownerId);

    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });
});

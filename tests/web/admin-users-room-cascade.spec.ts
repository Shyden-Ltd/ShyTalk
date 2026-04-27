import { test, expect } from './fixtures/admin';
import { adminLogin, navigateToTab, searchUser, switchUserSubtab } from './helpers/admin-auth';

/**
 * Verifies the full suspension-cascade and warning-no-cascade behaviour matrix
 * by seeding ephemeral rooms via /api/test/write/rooms, then driving suspension
 * + warning through the admin UI and checking room state via /api/test/verify.
 *
 * Mirrors:
 *   - tests/utils/evict-suspended-user.test.js (Express util-level matrix)
 *   - tests/routes/admin-users-warn-room-cascade.test.js (warning-preserves)
 *   - shared/src/jvmTest/.../ChatRoomPermissionsTest.kt (host action policy)
 *
 * Behaviour spec being tested:
 *   - Suspending the room owner    → state=CLOSED, participantIds + hostIds wiped
 *   - Suspending a host            → removed from hostIds AND participantIds; seat cleared
 *   - Suspending a seated attendee → seat cleared; removed from participantIds
 *   - Suspending a visitor         → only participantIds touched
 *   - Issuing a warning            → NO room change for any role
 */

test.describe('Admin Users — Suspension Cascade & Warning Preservation', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('E2E cascade test');
      } else {
        await dialog.accept();
      }
    });
    await adminLogin(page);
  });

  /**
   * Seed a fully-occupied 8-seat room. Returns the room id.
   *   seat 0 = owner, seats 1+2 = hosts, seats 3..7 = attendees.
   * The user fixture (testData.user) is plugged into whichever role the test
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

  test('suspending the room owner closes the room', async ({ page, testData }) => {
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

    // Suspend via admin UI
    await navigateToTab(page, 'Users');
    await searchUser(page, ownerId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#suspend-reason').fill('Cascade test — owner');
    await page.locator('.duration-presets button[data-days="7"]').click();
    await page.locator('#suspend-can-appeal').check();
    await page.locator('#suspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });

    // Verify cascade
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('CLOSED');
    expect(room.closedAt).toBeGreaterThan(0);
    expect(room.participantIds).toEqual([]);
    expect(room.hostIds).toEqual([]);

    // Cleanup: unsuspend + reset GCS so this test isn't sticky
    await page.locator('#unsuspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });

  test('suspending a seated host clears seat + removes from hostIds', async ({ page, testData }) => {
    const targetId = String(testData.user.uniqueId);
    const roomId = await seedFullRoom(testData.api, testData.testRunId, {
      ownerId: `${testData.prefix}_owner`,
      hostIds: [targetId, `${testData.prefix}_host2`], // user is host in seat 1
      attendeeIds: [
        `${testData.prefix}_att1`,
        `${testData.prefix}_att2`,
        `${testData.prefix}_att3`,
        `${testData.prefix}_att4`,
        `${testData.prefix}_att5`,
      ],
    });

    await navigateToTab(page, 'Users');
    await searchUser(page, targetId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#suspend-reason').fill('Cascade test — host');
    await page.locator('.duration-presets button[data-days="7"]').click();
    await page.locator('#suspend-can-appeal').check();
    await page.locator('#suspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });

    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE'); // room stays open
    expect(room.hostIds).not.toContain(targetId);
    expect(room.hostIds).toContain(`${testData.prefix}_host2`);
    expect(room.participantIds).not.toContain(targetId);
    expect(room.seats[1]).toEqual({
      userId: null,
      state: 'EMPTY',
      isMuted: false,
    });
    // Other seats untouched
    expect(room.seats[0].userId).toBe(`${testData.prefix}_owner`);
    expect(room.seats[2].userId).toBe(`${testData.prefix}_host2`);

    await page.locator('#unsuspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await testData.api.post(`/api/user/${targetId}/reset-gcs`);
  });

  test('suspending a seated non-host clears seat + leaves hostIds untouched', async ({
    page,
    testData,
  }) => {
    const targetId = String(testData.user.uniqueId);
    const roomId = await seedFullRoom(testData.api, testData.testRunId, {
      ownerId: `${testData.prefix}_owner`,
      hostIds: [`${testData.prefix}_host1`, `${testData.prefix}_host2`],
      attendeeIds: [
        targetId, // seat 3
        `${testData.prefix}_att2`,
        `${testData.prefix}_att3`,
        `${testData.prefix}_att4`,
        `${testData.prefix}_att5`,
      ],
    });

    await navigateToTab(page, 'Users');
    await searchUser(page, targetId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#suspend-reason').fill('Cascade test — attendee');
    await page.locator('.duration-presets button[data-days="7"]').click();
    await page.locator('#suspend-can-appeal').check();
    await page.locator('#suspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });

    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE');
    expect(room.hostIds).toEqual([
      `${testData.prefix}_host1`,
      `${testData.prefix}_host2`,
    ]);
    expect(room.participantIds).not.toContain(targetId);
    expect(room.seats[3]).toEqual({
      userId: null,
      state: 'EMPTY',
      isMuted: false,
    });

    await page.locator('#unsuspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await testData.api.post(`/api/user/${targetId}/reset-gcs`);
  });

  test('suspending a visitor only removes them from participantIds', async ({ page, testData }) => {
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

    await navigateToTab(page, 'Users');
    await searchUser(page, visitorId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#suspend-reason').fill('Cascade test — visitor');
    await page.locator('.duration-presets button[data-days="7"]').click();
    await page.locator('#suspend-can-appeal').check();
    await page.locator('#suspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });

    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE');
    expect(room.participantIds).not.toContain(visitorId);
    expect(room.participantIds).toContain(ownerId);
    expect(room.hostIds).toEqual([]);
    expect(room.seats[0].userId).toBe(ownerId); // owner seat preserved
    expect(room.seats[1].userId).toBeNull();

    await page.locator('#unsuspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await testData.api.post(`/api/user/${visitorId}/reset-gcs`);
  });

  test('suspending the owner of an abandoned room still closes it', async ({
    page,
    testData,
  }) => {
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

    await navigateToTab(page, 'Users');
    await searchUser(page, ownerId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#suspend-reason').fill('Cascade test — abandoned owner');
    await page.locator('.duration-presets button[data-days="7"]').click();
    await page.locator('#suspend-can-appeal').check();
    await page.locator('#suspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeVisible({ timeout: 15_000 });

    // The owner-query path catches this case even when the participants-only
    // query would miss it
    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('CLOSED');

    await page.locator('#unsuspend-btn').click();
    await expect(page.locator('#suspended-banner')).toBeHidden({ timeout: 15_000 });
    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });

  // ── Warning preservation ──────────────────────────────────────

  test('warning a seated user does NOT touch the room', async ({ page, testData }) => {
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

    // Issue warning via admin UI
    await navigateToTab(page, 'Users');
    await searchUser(page, targetId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#direct-warn-reason').selectOption('Spam');
    await page.locator('input[name="direct-warn-severity"][value="3"]').click();
    await page.locator('#direct-warn-btn').click();
    await expect(page.locator('#warning-history-list .warning-item').first()).toBeVisible({
      timeout: 15_000,
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

  test('warning the room owner does NOT close the room', async ({ page, testData }) => {
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

    await navigateToTab(page, 'Users');
    await searchUser(page, ownerId);
    await switchUserSubtab(page, 'moderation');
    await page.locator('#direct-warn-reason').selectOption('Other');
    await page.locator('input[name="direct-warn-severity"][value="3"]').click();
    await page.locator('#direct-warn-btn').click();
    await expect(page.locator('#warning-history-list .warning-item').first()).toBeVisible({
      timeout: 15_000,
    });

    const room = await testData.api.testVerify('rooms', roomId);
    expect(room.state).toBe('ACTIVE'); // NOT closed
    expect(room.closedAt).toBeFalsy();
    expect(room.participantIds).toContain(ownerId);
    expect(room.seats[0].userId).toBe(ownerId);

    await testData.api.post(`/api/user/${ownerId}/reset-gcs`);
  });
});

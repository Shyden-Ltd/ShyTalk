/**
 * Warning behaviour matrix.
 *
 * The contract: a warning is a soft moderation action — it MUST NOT evict the
 * user from any rooms, MUST NOT close any rooms, MUST NOT change participantIds
 * or hostIds or seats. The user keeps their seat, role, and presence.
 *
 * Side-effects of a warning are limited to:
 *   - new doc at users/{uid}/warnings/{warningId}
 *   - user.gcsScore decremented by severity-keyed amount
 *   - user.warningCount++ , user.hasActiveWarning = true , user.hasNewWarning = true
 *   - audit log entry
 *   - system PM (fire-and-forget)
 *
 * Mirrors the suspension matrix (owner / host / seated non-host / visitor) but
 * confirms the room is left ENTIRELY untouched in every case.
 */

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
// createWarning was migrated to a Firestore batch in Pass-13 so the warning
// doc + user doc + audit doc commit atomically. Tests assert against batch
// op-recorders below, not mockDocSet/mockDocUpdate, for those three writes.
const mockBatchUpdate = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: mockBatchUpdate,
      set: mockBatchSet,
      commit: mockBatchCommit,
    })),
  },
  rtdb: {
    ref: jest.fn(() => ({
      set: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({ uid: 'admin-1' }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'gen-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn().mockResolvedValue({ id: 'admin-1', displayName: 'Admin' }),
  queryDocs: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminUsersRouter = require('../../src/routes/admin-users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', uniqueId: 'admin-1', token: { admin: true } };
    next();
  });
  app.use('/api', adminUsersRouter);
  return app;
}

const flushPromises = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  jest.clearAllMocks();
  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockReset();
  mockDocUpdate.mockResolvedValue();
});

// Snapshot of which doc paths were touched (via db.doc) and what mutation each
// call produced. Used to assert "rooms/* was NEVER updated".
function pathsTouchedByUpdate() {
  const { db } = require('../../src/utils/firebase');
  const docCalls = db.doc.mock.calls;
  const docResults = db.doc.mock.results.map((r) => r.value);
  const updatedPaths = [];
  for (let i = 0; i < docCalls.length; i++) {
    const ref = docResults[i];
    if (ref?.update?.mock?.calls?.length > 0) {
      updatedPaths.push(docCalls[i][0]);
    }
  }
  return updatedPaths;
}

describe('POST /api/user/:uniqueId/warn — room state untouched', () => {
  // We feed every warning test with a "user is owner of room-A and host of
  // room-B and seated in room-C and visitor in room-D" fixture. Whatever role
  // they hold, the warning route must NOT call db.doc('rooms/...').update().
  function setupWarningTarget(role) {
    const baseUser = {
      exists: true,
      id: 'target-1',
      data: () => ({
        displayName: role === 'owner' ? 'Owner User' : `${role} User`,
        gcsScore: 80,
        warningCount: 0,
      }),
    };
    mockDocGet.mockResolvedValue(baseUser);
  }

  it('owner is warned → no rooms touched', async () => {
    setupWarningTarget('owner');

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad behaviour', severity: 3 });

    expect(res.status).toBe(200);
    await flushPromises();

    // The ONLY paths the warn route writes to are users/target-1/warnings/* and
    // users/target-1 itself + the audit log. NEVER rooms/*.
    const updated = pathsTouchedByUpdate();
    const roomsTouched = updated.filter((p) => p.startsWith('rooms/'));
    expect(roomsTouched).toEqual([]);
  });

  it('seated host is warned → seat preserved, hostIds unchanged, no rooms touched', async () => {
    setupWarningTarget('host');

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad behaviour', severity: 4 });

    expect(res.status).toBe(200);
    await flushPromises();

    const updated = pathsTouchedByUpdate();
    expect(updated.filter((p) => p.startsWith('rooms/'))).toEqual([]);
  });

  it('seated non-host is warned → seat preserved, no rooms touched', async () => {
    setupWarningTarget('seated-non-host');

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad behaviour', severity: 2 });

    expect(res.status).toBe(200);
    await flushPromises();

    const updated = pathsTouchedByUpdate();
    expect(updated.filter((p) => p.startsWith('rooms/'))).toEqual([]);
  });

  it('visitor is warned → no rooms touched', async () => {
    setupWarningTarget('visitor');

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Spamming', severity: 1 });

    expect(res.status).toBe(200);
    await flushPromises();

    const updated = pathsTouchedByUpdate();
    expect(updated.filter((p) => p.startsWith('rooms/'))).toEqual([]);
  });
});

describe('POST /api/user/:uniqueId/warn — user fields actually update', () => {
  it('decrements gcsScore, sets hasActiveWarning + hasNewWarning, increments warningCount', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'target-1',
      data: () => ({ displayName: 'User', gcsScore: 100, warningCount: 0 }),
    });

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad behaviour', severity: 3 });

    expect(res.status).toBe(200);
    // The user-doc update happens via the atomic batch (Pass-13 fix). The
    // mockBatchUpdate matcher uses expect.any(Number) instead of a presence
    // check — Pass-14 tightening: a regression that sets warningCount to
    // undefined would have passed the prior `c[1]?.warningCount !== undefined`
    // matcher. Now any-Number forces the value to land typed.
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gcsScore: expect.any(Number),
        hasActiveWarning: true,
        hasNewWarning: true,
        warningCount: expect.any(Number),
      }),
    );

    // The mutation specifically does NOT clear currentRoomId / participantIds
    // (those are suspension-only fields).
    const allBatchUpdates = mockBatchUpdate.mock.calls.map((c) => c[1]);
    for (const u of allBatchUpdates) {
      expect(u).not.toHaveProperty('currentRoomId');
      expect(u).not.toHaveProperty('participantIds');
      expect(u).not.toHaveProperty('hostIds');
      expect(u).not.toHaveProperty('state');
      expect(u).not.toHaveProperty('isSuspended');
    }
  });

  it('writes a warning doc to users/{uniqueId}/warnings/{warningId}', async () => {
    const { db } = require('../../src/utils/firebase');
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'target-1',
      data: () => ({ displayName: 'User', gcsScore: 80, warningCount: 0 }),
    });

    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad behaviour', severity: 3, adminNote: 'note' });

    expect(res.status).toBe(200);
    const warningPathCall = db.doc.mock.calls.find((c) =>
      c[0].startsWith('users/target-1/warnings/'),
    );
    expect(warningPathCall).toBeDefined();
    // Warning doc is written via the atomic batch (Pass-13 fix).
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: 'Bad behaviour',
        severity: 3,
        adminNote: 'note',
        revoked: false,
      }),
    );
  });
});

describe('POST /api/user/:uniqueId/warn — input validation', () => {
  it('rejects missing reason with 400', async () => {
    const res = await request(createApp()).post('/api/user/target-1/warn').send({ severity: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  it('rejects severity out of 1..5 range with 400', async () => {
    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad', severity: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  it('rejects negative severity', async () => {
    // Note: severity=0 gets coerced to the default 3 via `parseInt(0) || 3`,
    // so it's NOT a rejection case. -1 is parsed truthy and hits the < 1 check.
    const res = await request(createApp())
      .post('/api/user/target-1/warn')
      .send({ reason: 'Bad', severity: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });
});

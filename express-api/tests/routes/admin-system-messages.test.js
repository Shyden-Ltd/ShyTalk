const express = require('express');
const request = require('supertest');

// ─── Shared mocks ───────────────────────────────────────────────

const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();
const mockCollectionGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
      update: mockDocUpdate,
      set: mockDocSet,
      delete: mockDocDelete,
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        get: mockCollectionGet,
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'user-1',
      email: null,
      phoneNumber: null,
      providerData: [],
    }),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

const mockSendSystemPm = jest.fn().mockResolvedValue();
jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: mockSendSystemPm,
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false),
  clearSuspensionCache: jest.fn(),
}));

// ─── App factories ─────────────────────────────────────────────

function withAuth(app) {
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uid: 'admin-1', token: { admin: true } };
    next();
  });
  return app;
}

function createAdminUsersApp() {
  const app = withAuth(express());
  app.use('/api', require('../../src/routes/admin-users'));
  return app;
}

function createAdminEconomyApp() {
  const app = withAuth(express());
  app.use('/api', require('../../src/routes/admin-economy'));
  return app;
}

function createAdminBansApp() {
  const app = withAuth(express());
  app.use('/api', require('../../src/routes/admin-bans'));
  return app;
}

function createAdminDevicesApp() {
  const app = withAuth(express());
  app.use('/api', require('../../src/routes/admin-devices'));
  return app;
}

// ═════════════════════════════════════════════════════════════════
// PATCH /api/user/:uid — system messages for user-visible changes
// ═════════════════════════════════════════════════════════════════

describe('PATCH /api/user/:uid — system messages', () => {
  let app;

  beforeEach(() => {
    app = createAdminUsersApp();
    jest.clearAllMocks();
  });

  it('should send system PM when displayName is updated', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ displayName: 'NewName' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your display name was updated by a moderator.'
    );
  });

  it('should send system PM when profilePhotoUrl is cleared', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ profilePhotoUrl: '' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your profile photo was removed by a moderator.'
    );
  });

  it('should send system PM when profilePhotoUrl is set to null', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ profilePhotoUrl: null });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your profile photo was removed by a moderator.'
    );
  });

  it('should send system PM when coverPhotoUrl is cleared', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ coverPhotoUrl: '' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your cover photo was removed by a moderator.'
    );
  });

  it('should send system PM when description is cleared', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ description: '' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your profile description was cleared by a moderator.'
    );
  });

  it('should send system PM when isSuperShy is activated', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ isSuperShy: true });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Super Shy has been activated on your account.'
    );
  });

  it('should send system PM when isSuperShy is deactivated', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ isSuperShy: false });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Super Shy has been removed from your account.'
    );
  });

  it('should send system PM when superShyExpiry is updated', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ superShyExpiry: 1800000000000 });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your Super Shy expiry date has been updated.'
    );
  });

  it('should send multiple PMs when multiple fields change', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ displayName: 'X', profilePhotoUrl: null });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledTimes(2);
  });

  it('should not send PM for non-user-visible fields like gender', async () => {
    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ gender: 'other' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });

  it('should not fail the PATCH if sendSystemPm throws', async () => {
    mockSendSystemPm.mockRejectedValue(new Error('PM service down'));

    const res = await request(app)
      .patch('/api/user/user-1')
      .send({ displayName: 'CrashTest' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/user/:uid/suspend — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/user/:uid/suspend — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminUsersApp();
    jest.clearAllMocks();
    // Suspend needs user doc + device bindings query
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-1',
      data: () => ({ displayName: 'TestUser', profilePhotoUrl: null, coverPhotoUrl: null }),
    });
    mockCollectionGet.mockResolvedValue({ empty: true, docs: [] });
  });

  it('should send suspension system PM with reason', async () => {
    const res = await request(app)
      .post('/api/user/user-1/suspend')
      .send({ reason: 'Spamming', canAppeal: true, endDate: new Date(Date.now() + 86400000).toISOString() });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your account has been suspended. Reason: Spamming'
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/user/:uid/unsuspend — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/user/:uid/unsuspend — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminUsersApp();
    jest.clearAllMocks();
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'user-1',
      data: () => ({ isSuspended: true, preSuspensionDisplayName: 'OldName' }),
    });
  });

  it('should send unsuspension system PM', async () => {
    const res = await request(app)
      .post('/api/user/user-1/unsuspend')
      .send({});

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your account suspension has been lifted.'
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/users/:uid/adjust-balance — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/users/:uid/adjust-balance — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminEconomyApp();
    jest.clearAllMocks();
  });

  it('should send PM when coins are added', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 50 });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      '50 Shy Coins were added to your account.'
    );
  });

  it('should send PM when beans are deducted', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyBeans: 200 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'beans', amount: -80 });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      '80 Shy Beans were deducted from your account.'
    );
  });

  it('should send PM with correct message for operation=deduct', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 500 }),
    });

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 100, operation: 'deduct' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      '100 Shy Coins were deducted from your account.'
    );
  });

  it('should not fail adjust-balance if sendSystemPm throws', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ shyCoins: 100 }),
    });
    mockSendSystemPm.mockRejectedValue(new Error('PM service down'));

    const res = await request(app)
      .post('/api/users/user-1/adjust-balance')
      .send({ currency: 'coins', amount: 25 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/bans/device — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/bans/device — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminBansApp();
    jest.clearAllMocks();
  });

  it('should send restriction PM when device is banned with linkedUserId', async () => {
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-1', reason: 'Abuse', linkedUserId: 'user-1' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'A restriction has been placed on your account.'
    );
  });

  it('should not send PM when no linkedUserId', async () => {
    const res = await request(app)
      .post('/api/admin/bans/device')
      .send({ deviceId: 'dev-1', reason: 'Abuse' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/bans/network — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/bans/network — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminBansApp();
    jest.clearAllMocks();
  });

  it('should send restriction PM when network is banned with linkedUserId', async () => {
    const res = await request(app)
      .post('/api/admin/bans/network')
      .send({ type: 'ip', value: '1.2.3.4', reason: 'VPN abuse', linkedUserId: 'user-1' });

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'A restriction has been placed on your account.'
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/admin/bans/unban-all/:userId — system message
// ═════════════════════════════════════════════════════════════════

describe('POST /api/admin/bans/unban-all/:userId — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminBansApp();
    jest.clearAllMocks();
    mockCollectionGet.mockResolvedValue({ docs: [] });
  });

  it('should send restriction lifted PM', async () => {
    const mockDoc = { ref: { delete: jest.fn().mockResolvedValue() } };
    mockCollectionGet.mockResolvedValue({ docs: [mockDoc] });

    const res = await request(app)
      .post('/api/admin/bans/unban-all/user-1')
      .send({});

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'A restriction on your account has been lifted.'
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// DELETE /api/admin/devices/:deviceId — system message
// ═════════════════════════════════════════════════════════════════

describe('DELETE /api/admin/devices/:deviceId — system message', () => {
  let app;

  beforeEach(() => {
    app = createAdminDevicesApp();
    jest.clearAllMocks();
  });

  it('should send device unbind PM to the bound user', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userId: 'user-1', manufacturer: 'Samsung' }),
    });

    const res = await request(app)
      .delete('/api/admin/devices/dev-123');

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).toHaveBeenCalledWith(
      'user-1',
      'Your device binding has been reset by a moderator.'
    );
  });

  it('should not fail unbind if sendSystemPm throws', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userId: 'user-1' }),
    });
    mockSendSystemPm.mockRejectedValue(new Error('PM down'));

    const res = await request(app)
      .delete('/api/admin/devices/dev-123');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should not send PM if device binding has no userId', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ manufacturer: 'Samsung' }),
    });

    const res = await request(app)
      .delete('/api/admin/devices/dev-123');

    expect(res.status).toBe(200);
    expect(mockSendSystemPm).not.toHaveBeenCalled();
  });
});

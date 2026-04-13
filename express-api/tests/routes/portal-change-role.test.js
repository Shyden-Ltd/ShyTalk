const express = require('express');
const request = require('supertest');

// ─── Firebase mock ──────────────────────────────────────────────
const mockDocGet = jest.fn();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      _path: path,
      get: (...args) => mockDocGet(path, ...args),
      update: (...args) => mockDocUpdate(path, ...args),
      set: (...args) => mockDocSet(path, ...args),
    })),
    collection: jest.fn(() => {
      const chain = {
        where: jest.fn().mockImplementation(() => chain),
        orderBy: jest.fn().mockImplementation(() => chain),
        limit: jest.fn().mockImplementation(() => chain),
        select: jest.fn().mockImplementation(() => chain),
        get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      };
      return chain;
    }),
    batch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(),
    })),
  },
  auth: {
    getUser: jest.fn().mockResolvedValue({
      uid: 'user-1',
      email: null,
      providerData: [],
    }),
    revokeRefreshTokens: jest.fn().mockResolvedValue(),
    setCustomUserClaims: jest.fn().mockResolvedValue(),
  },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => 'test-id'),
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/gcs', () => ({
  computeDisplayScore: jest.fn((score) => score),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

jest.mock('../../src/utils/system-pm', () => ({
  sendSystemPm: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/email-templates', () => ({
  buildDeletionScheduledEmail: jest.fn(() => ({ subject: 's', html: 'h' })),
}));

jest.mock('../../src/utils/fcm', () => ({
  sendFcmToTokens: jest.fn().mockResolvedValue(),
}));

jest.mock('../../src/utils/firestore-helpers', () => ({
  getDoc: jest.fn(),
}));

const { requireAdmin } = require('../../src/middleware/auth');

jest.mock('../../src/middleware/auth', () => ({
  requireAdmin: jest.fn(() => false), // Allow all requests by default
  clearSuspensionCache: jest.fn(),
}));

const { auth } = require('../../src/utils/firebase');
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

describe('POST /api/user/:uniqueId/change-role', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('should change role from MEMBER to MC_SINGER — 200', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            firebaseUid: 'fb-uid-1',
            userType: 'MEMBER',
            isAdmin: false,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'MC_SINGER' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      'users/12345678',
      expect.objectContaining({
        userType: 'MC_SINGER',
        roleChanged: 'SERVER_TIMESTAMP',
      }),
    );
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('fb-uid-1');
  });

  it('should return 400 for invalid userType value', async () => {
    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'INVALID' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userType/i);
  });

  it('should return 400 for missing userType field', async () => {
    const res = await request(app).post('/api/user/12345678/change-role').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userType/i);
  });

  it('should return 403 for non-admin caller', async () => {
    requireAdmin.mockImplementationOnce((req, res) => {
      res.status(403).json({ error: 'Admin access required' });
      return true;
    });

    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'MC_SINGER' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('should return 404 for user not found', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    const res = await request(app)
      .post('/api/user/99999999/change-role')
      .send({ userType: 'MC_SINGER' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('should demote admin — call setCustomUserClaims with admin: false', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            firebaseUid: 'fb-uid-admin',
            userType: 'SHYTALK_OFFICIAL',
            isAdmin: true,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'MEMBER' });

    expect(res.status).toBe(200);
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith('fb-uid-admin', { admin: false });
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('fb-uid-admin');
  });

  it('should NOT call setCustomUserClaims when promoting non-admin to MC_SINGER', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            firebaseUid: 'fb-uid-2',
            userType: 'MEMBER',
            isAdmin: false,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'MC_SINGER' });

    expect(res.status).toBe(200);
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('should still call revokeRefreshTokens when changing to same role', async () => {
    mockDocGet.mockImplementation((path) => {
      if (path.startsWith('users/')) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            firebaseUid: 'fb-uid-3',
            userType: 'MEMBER',
            isAdmin: false,
          }),
        });
      }
      return Promise.resolve({ exists: false });
    });

    const res = await request(app)
      .post('/api/user/12345678/change-role')
      .send({ userType: 'MEMBER' });

    expect(res.status).toBe(200);
    expect(auth.revokeRefreshTokens).toHaveBeenCalledWith('fb-uid-3');
  });
});

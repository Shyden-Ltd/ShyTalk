/**
 * EPIC-0006 — reading notification settings server-side.
 *
 * `PATCH /notifications/settings` already existed; the matching read did not,
 * so `NotificationRepositoryImpl.getPmNotificationsEnabled` went straight to
 * Firestore for `users/{userId}.pmNotificationsEnabled`. The setter was behind
 * the API and the getter was not — the half-migration shape that hid the
 * private-messaging outage in SHY-0458.
 *
 * The read is deliberately about the CALLER and takes no user id. The client
 * method accepts one, and passing it through would have let anybody read
 * anybody's settings. The token already says who is asking.
 */

const express = require('express');
const request = require('supertest');

const mockUsers = {};

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn((path) => ({
      get: async () => {
        const id = path.split('/')[1];
        const data = mockUsers[id];
        return { exists: data !== undefined, data: () => data };
      },
      update: jest.fn().mockResolvedValue(),
    })),
    collection: jest.fn(),
  },
  rtdb: { ref: jest.fn(() => ({ set: jest.fn().mockResolvedValue() })) },
  FieldValue: {},
}));

const buildApp = (uniqueId = 50000010) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { uniqueId };
    next();
  });
  app.use('/api', require('../../src/routes/notifications'));
  return app;
};

beforeEach(() => {
  for (const k of Object.keys(mockUsers)) delete mockUsers[k];
});

describe('GET /api/notifications/settings', () => {
  test('returns the settings stored on the caller', async () => {
    mockUsers['50000010'] = { pmNotificationsEnabled: false, pmSoundEnabled: true };
    const res = await request(buildApp()).get('/api/notifications/settings');
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(false);
    expect(res.body.pmSoundEnabled).toBe(true);
  });

  test('defaults to enabled when a setting was never stored', async () => {
    // The client defaulted to `true` when the field was absent. Moving the read
    // server-side must not quietly change what a person experiences.
    mockUsers['50000010'] = {};
    const res = await request(buildApp()).get('/api/notifications/settings');
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(true);
  });

  test('a user document that does not exist still yields defaults, not an error', async () => {
    const res = await request(buildApp()).get('/api/notifications/settings');
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(true);
  });

  test('returns every field the PATCH accepts, so the two cannot drift apart', async () => {
    mockUsers['50000010'] = {};
    const res = await request(buildApp()).get('/api/notifications/settings');
    for (const key of [
      'pmNotificationsEnabled',
      'pmSoundEnabled',
      'pmShowTimestamps',
      'pmShowDateSeparators',
      'pmNotificationPreview',
    ]) {
      expect(res.body).toHaveProperty(key);
    }
  });

  test('reads the CALLER, never a user named in the request', async () => {
    // The client method takes a userId. If the route honoured one, anybody
    // could read anybody's settings — so it must be ignored entirely.
    mockUsers['50000010'] = { pmNotificationsEnabled: true };
    mockUsers['99999999'] = { pmNotificationsEnabled: false };
    const res = await request(buildApp(50000010)).get(
      '/api/notifications/settings?userId=99999999',
    );
    expect(res.status).toBe(200);
    expect(res.body.pmNotificationsEnabled).toBe(true);
  });

  test('coerces stored non-booleans, so a bad write cannot reach the client', async () => {
    mockUsers['50000010'] = { pmNotificationsEnabled: 'yes' };
    const res = await request(buildApp()).get('/api/notifications/settings');
    expect(typeof res.body.pmNotificationsEnabled).toBe('boolean');
  });
});

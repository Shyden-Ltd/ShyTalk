/**
 * UK OSA #17 PR 8 — unit tests for `src/utils/segregation-audit.js`.
 *
 * Direct coverage of the audit helper's branches: surface resolution
 * (route.path vs path fallback), missing auth/req fields (optional-
 * chain defensives), fire-and-forget failure swallowing. Without
 * these tests the new-code coverage drops below SonarCloud's 80%
 * gate because each optional-chain branch counts as an uncovered
 * condition.
 */

const mockAdd = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    collection: jest.fn(() => ({ add: (...args) => mockAdd(...args) })),
  },
}));

const { auditAdminFlagBypass } = require('../../src/utils/segregation-audit');

beforeEach(() => {
  jest.clearAllMocks();
  mockAdd.mockResolvedValue({ id: 'evt_1' });
});

describe('auditAdminFlagBypass', () => {
  test('writes a segregationEvents row with happy-path req fields', () => {
    const req = {
      auth: {
        uniqueId: '12345',
        token: { cohort: 'adult' },
      },
      baseUrl: '/api',
      route: { path: '/conversations/:id/messages' },
      id: 'req-abc',
    };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: '12345',
      sourceCohort: 'adult',
      targetUniqueId: 'conv-1',
      targetConversationId: 'conv-1',
      targetCohort: 'mixed',
      surface: '/api/conversations/:id/messages',
      action: 'admin_flag_bypass',
      requestId: 'req-abc',
    });
    expect(typeof mockAdd.mock.calls[0][0].timestamp).toBe('number');
  });

  test('falls back to req.path when req.route is absent', () => {
    const req = {
      auth: { uniqueId: '12345', token: { cohort: 'adult' } },
      baseUrl: '/api',
      path: '/conversations/abc/messages',
    };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd.mock.calls[0][0].surface).toBe('/api/conversations/abc/messages');
  });

  test('handles missing baseUrl (defaults to empty string)', () => {
    const req = {
      auth: { uniqueId: '12345', token: { cohort: 'adult' } },
      route: { path: '/conversations/:id' },
    };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd.mock.calls[0][0].surface).toBe('/conversations/:id');
  });

  test('handles missing req.auth (sourceUniqueId becomes empty string)', () => {
    const req = { baseUrl: '/api', route: { path: '/x' } };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd.mock.calls[0][0].sourceUniqueId).toBe('');
  });

  test('handles missing req.auth.token.cohort (sourceCohort defaults to "unknown")', () => {
    const req = {
      auth: { uniqueId: '12345' },
      baseUrl: '/api',
      route: { path: '/x' },
    };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd.mock.calls[0][0].sourceCohort).toBe('unknown');
  });

  test('handles missing req.id (requestId becomes null)', () => {
    const req = {
      auth: { uniqueId: '12345', token: { cohort: 'adult' } },
      baseUrl: '/api',
      route: { path: '/x' },
    };
    auditAdminFlagBypass(req, 'conv-1');

    expect(mockAdd.mock.calls[0][0].requestId).toBe(null);
  });

  test('swallows db.collection().add() failure (fire-and-forget)', async () => {
    mockAdd.mockRejectedValueOnce(new Error('quota exhausted'));
    const req = {
      auth: { uniqueId: '12345', token: { cohort: 'adult' } },
      baseUrl: '/api',
      route: { path: '/x' },
    };
    // Must not throw despite the rejected add().
    expect(() => auditAdminFlagBypass(req, 'conv-1')).not.toThrow();
    // Allow the rejected promise's .catch to settle.
    await new Promise((r) => setImmediate(r));
  });

  test('handles entirely empty req (no auth, no route, no path)', () => {
    auditAdminFlagBypass({}, 'conv-empty');

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0]).toMatchObject({
      sourceUniqueId: '',
      sourceCohort: 'unknown',
      targetUniqueId: 'conv-empty',
      targetConversationId: 'conv-empty',
      targetCohort: 'mixed',
      surface: '',
      action: 'admin_flag_bypass',
      requestId: null,
    });
  });
});

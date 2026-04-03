const { createAlertManager } = require('../../src/utils/alertManager');

function createMockDb(_configData = null, _userData = null) {
  const setFn = jest.fn().mockResolvedValue(undefined);
  const getFn = jest.fn().mockImplementation(() => {
    // Default: return config doc
    return Promise.resolve({ exists: false });
  });

  const docFn = jest.fn().mockImplementation((_docId) => ({
    set: setFn,
    get: getFn,
  }));

  const collectionFn = jest.fn().mockImplementation((_name) => ({
    doc: docFn,
  }));

  // Configure get responses based on collection/doc
  const getResponses = [];
  getFn.mockImplementation(() => {
    if (getResponses.length > 0) return Promise.resolve(getResponses.shift());
    return Promise.resolve({ exists: false });
  });

  return {
    db: { collection: collectionFn },
    setFn,
    getFn,
    docFn,
    collectionFn,
    getResponses,
  };
}

function createMockMessaging() {
  return {
    send: jest.fn().mockResolvedValue('messageId'),
  };
}

describe('alertManager', () => {
  let db, messaging, setFn, _getFn, collectionFn, _docFn, getResponses;

  beforeEach(() => {
    const mocks = createMockDb();
    db = mocks.db;
    setFn = mocks.setFn;
    _getFn = mocks.getFn;
    collectionFn = mocks.collectionFn;
    _docFn = mocks.docFn;
    getResponses = mocks.getResponses;
    messaging = createMockMessaging();
  });

  describe('createAlert', () => {
    test('writes alert to Firestore and sends FCM', async () => {
      // Config with one recipient
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['admin1'] }),
      });
      // User doc with FCM token
      getResponses.push({
        exists: true,
        data: () => ({ fcmToken: 'token123' }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('error_spike', 'critical', 'Test Alert', 'Something broke', {
        route: '/api/test',
      });

      // Should write alert doc
      expect(collectionFn).toHaveBeenCalledWith('alerts');
      expect(setFn).toHaveBeenCalledTimes(1);
      const alertDoc = setFn.mock.calls[0][0];
      expect(alertDoc).toMatchObject({
        type: 'error_spike',
        severity: 'critical',
        title: 'Test Alert',
        message: 'Something broke',
        status: 'unresolved',
        acknowledgedBy: null,
        resolvedBy: null,
        resolvedAt: null,
      });
      expect(alertDoc.id).toBeDefined();
      expect(alertDoc.createdAt).toBeDefined();
      expect(alertDoc.context).toEqual({ route: '/api/test' });

      // Should send FCM
      expect(messaging.send).toHaveBeenCalledWith({
        notification: { title: 'Test Alert', body: 'Something broke' },
        token: 'token123',
      });
    });

    test('never throws on FCM failure', async () => {
      // Config with recipient
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['admin1'] }),
      });
      // User doc
      getResponses.push({
        exists: true,
        data: () => ({ fcmToken: 'badtoken' }),
      });

      messaging.send.mockRejectedValue(new Error('FCM error'));

      const manager = createAlertManager(db, messaging);

      // Should not throw
      await expect(manager.createAlert('test', 'info', 'Title', 'Body')).resolves.toBeUndefined();

      // Alert doc should still be written
      expect(setFn).toHaveBeenCalledTimes(1);
    });

    test('handles fcmTokens array', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['admin1'] }),
      });
      getResponses.push({
        exists: true,
        data: () => ({ fcmTokens: ['token1', 'token2'] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      expect(messaging.send).toHaveBeenCalledTimes(2);
      expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'token1' }));
      expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'token2' }));
    });
  });

  describe('trackError', () => {
    test('fires alert when threshold exceeded', async () => {
      // Config: threshold=3 for easier testing
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 3,
          errorSpikeWindowMinutes: 5,
          fcmRecipientUserIds: [],
        }),
      });
      // Need config for each subsequent call too (cached after first)

      const manager = createAlertManager(db, messaging);

      await manager.trackError('/api/test');
      await manager.trackError('/api/test');
      expect(setFn).not.toHaveBeenCalled();

      await manager.trackError('/api/test');
      // Should have created an alert
      expect(setFn).toHaveBeenCalledTimes(1);
      const alertDoc = setFn.mock.calls[0][0];
      expect(alertDoc.type).toBe('error_spike');
      expect(alertDoc.severity).toBe('critical');
      expect(alertDoc.context.route).toBe('/api/test');
    });

    test('deduplicates within window', async () => {
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 2,
          errorSpikeWindowMinutes: 5,
          fcmRecipientUserIds: [],
        }),
      });

      const manager = createAlertManager(db, messaging);

      // Trigger first alert
      await manager.trackError('/api/test');
      await manager.trackError('/api/test');
      expect(setFn).toHaveBeenCalledTimes(1);

      // Additional errors should not trigger another alert within window
      await manager.trackError('/api/test');
      await manager.trackError('/api/test');
      expect(setFn).toHaveBeenCalledTimes(1); // Still only 1
    });
  });

  describe('trackSlowEndpoint', () => {
    test('fires alert for slow requests', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 2000, fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.trackSlowEndpoint('/api/rooms', 5000);

      expect(setFn).toHaveBeenCalledTimes(1);
      const alertDoc = setFn.mock.calls[0][0];
      expect(alertDoc.type).toBe('slow_endpoint');
      expect(alertDoc.severity).toBe('warning');
      expect(alertDoc.context.route).toBe('/api/rooms');
      expect(alertDoc.context.durationMs).toBe(5000);
    });

    test('does not fire for fast requests', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 3000, fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.trackSlowEndpoint('/api/rooms', 1000);

      expect(setFn).not.toHaveBeenCalled();
    });

    test('deduplicates within 5 minutes', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 1000, fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.trackSlowEndpoint('/api/rooms', 5000);
      expect(setFn).toHaveBeenCalledTimes(1);

      // Second call within 5 min should be deduped
      await manager.trackSlowEndpoint('/api/rooms', 6000);
      expect(setFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConfig', () => {
    test('returns defaults when no config loaded', () => {
      const manager = createAlertManager(db, messaging);
      const config = manager.getConfig();
      expect(config.errorSpikeThreshold).toBe(10);
      expect(config.slowEndpointThresholdMs).toBe(3000);
      expect(config.serverMemoryWarningPercent).toBe(85);
    });
  });

  // ─── Additional coverage ─────────────────────────────────────

  describe('createAlert — additional coverage', () => {
    test('skips non-existing user when sending FCM', async () => {
      // Config with two recipients, first doesn't exist
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['ghost', 'admin1'] }),
      });
      // Ghost user does not exist
      getResponses.push({ exists: false });
      // Admin1 user with token
      getResponses.push({
        exists: true,
        data: () => ({ fcmToken: 'real-token' }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      // Should still have written the alert doc
      expect(setFn).toHaveBeenCalledTimes(1);
      // Should have sent to the second (existing) user only
      expect(messaging.send).toHaveBeenCalledTimes(1);
      expect(messaging.send).toHaveBeenCalledWith(expect.objectContaining({ token: 'real-token' }));
    });

    test('handles user with no tokens (neither fcmTokens nor fcmToken)', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['admin1'] }),
      });
      getResponses.push({
        exists: true,
        data: () => ({ name: 'Admin' }), // no token fields
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      expect(setFn).toHaveBeenCalledTimes(1);
      expect(messaging.send).not.toHaveBeenCalled();
    });

    test('handles empty fcmRecipientUserIds', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      expect(setFn).toHaveBeenCalledTimes(1);
      expect(messaging.send).not.toHaveBeenCalled();
    });

    test('handles missing fcmRecipientUserIds in config', async () => {
      getResponses.push({
        exists: true,
        data: () => ({}), // no fcmRecipientUserIds key
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      expect(setFn).toHaveBeenCalledTimes(1);
      expect(messaging.send).not.toHaveBeenCalled();
    });

    test('never throws when alert doc write fails', async () => {
      setFn.mockRejectedValueOnce(new Error('Firestore write failed'));

      const manager = createAlertManager(db, messaging);

      await expect(manager.createAlert('test', 'info', 'Title', 'Body')).resolves.toBeUndefined();
    });

    test('never throws when user lookup fails', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: ['admin1'] }),
      });
      // User lookup throws
      _getFn.mockRejectedValueOnce(new Error('Firestore read error'));

      const manager = createAlertManager(db, messaging);

      await expect(manager.createAlert('test', 'info', 'Title', 'Body')).resolves.toBeUndefined();
    });

    test('default context is empty object', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.createAlert('test', 'info', 'Title', 'Body');

      const alertDoc = setFn.mock.calls[0][0];
      expect(alertDoc.context).toEqual({});
    });
  });

  describe('loadConfig — additional coverage', () => {
    test('uses cached config within TTL', async () => {
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 5,
          fcmRecipientUserIds: [],
        }),
      });

      const manager = createAlertManager(db, messaging);

      // First call loads config from Firestore
      await manager.trackError('/api/test');
      const firstCallCount = _getFn.mock.calls.length;

      // Second call should use cache
      await manager.trackError('/api/test');
      const secondCallCount = _getFn.mock.calls.length;

      // No additional Firestore get calls for config
      expect(secondCallCount).toBe(firstCallCount);
    });

    test('falls back to defaults when Firestore is unavailable and no cache exists', async () => {
      _getFn.mockRejectedValue(new Error('Firestore unavailable'));

      const manager = createAlertManager(db, messaging);
      const config = manager.getConfig();

      // Before any async call, getConfig returns defaults
      expect(config.errorSpikeThreshold).toBe(10);
    });

    test('uses defaults when config doc does not exist', async () => {
      getResponses.push({ exists: false });

      const manager = createAlertManager(db, messaging);
      // Trigger loadConfig via trackError
      await manager.trackError('/api/test');

      const config = manager.getConfig();
      expect(config.errorSpikeThreshold).toBe(10);
    });
  });

  describe('trackError — additional coverage', () => {
    test('tracks errors independently per route', async () => {
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 2,
          errorSpikeWindowMinutes: 5,
          fcmRecipientUserIds: [],
        }),
      });

      const manager = createAlertManager(db, messaging);

      await manager.trackError('/api/route-a');
      await manager.trackError('/api/route-b');

      // Neither should trigger alert (only 1 error each, threshold is 2)
      expect(setFn).not.toHaveBeenCalled();

      // Second error on route-a triggers alert
      await manager.trackError('/api/route-a');
      expect(setFn).toHaveBeenCalledTimes(1);
      expect(setFn.mock.calls[0][0].context.route).toBe('/api/route-a');
    });

    test('never throws even when internal error occurs', async () => {
      _getFn.mockRejectedValue(new Error('Firestore unavailable'));

      const manager = createAlertManager(db, messaging);

      // Should not throw
      await expect(manager.trackError('/api/test')).resolves.toBeUndefined();
    });
  });

  describe('trackSlowEndpoint — additional coverage', () => {
    test('does not alert when duration equals threshold exactly', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 3000, fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.trackSlowEndpoint('/api/rooms', 3000);

      expect(setFn).not.toHaveBeenCalled();
    });

    test('tracks different routes independently', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 1000, fcmRecipientUserIds: [] }),
      });

      const manager = createAlertManager(db, messaging);
      await manager.trackSlowEndpoint('/api/route-a', 5000);
      await manager.trackSlowEndpoint('/api/route-b', 5000);

      // Both routes should trigger (different dedup keys)
      expect(setFn).toHaveBeenCalledTimes(2);
    });

    test('never throws even when createAlert fails internally', async () => {
      getResponses.push({
        exists: true,
        data: () => ({ slowEndpointThresholdMs: 1000, fcmRecipientUserIds: [] }),
      });
      setFn.mockRejectedValue(new Error('Write failed'));

      const manager = createAlertManager(db, messaging);

      await expect(manager.trackSlowEndpoint('/api/test', 5000)).resolves.toBeUndefined();
    });
  });

  describe('_clearState', () => {
    test('resets all internal state and error windows', async () => {
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 2,
          errorSpikeWindowMinutes: 5,
          fcmRecipientUserIds: [],
        }),
      });

      const manager = createAlertManager(db, messaging);

      // Accumulate state — 2 errors triggers alert
      await manager.trackError('/api/test');
      await manager.trackError('/api/test');
      expect(setFn).toHaveBeenCalledTimes(1);

      // Clear all internal state
      manager._clearState();

      // After clear, getConfig returns defaults (cachedConfig is null)
      const config = manager.getConfig();
      expect(config.errorSpikeThreshold).toBe(10);

      // After clear, config cache is null so next trackError reloads config
      getResponses.push({
        exists: true,
        data: () => ({
          errorSpikeThreshold: 2,
          errorSpikeWindowMinutes: 5,
          fcmRecipientUserIds: [],
        }),
      });

      setFn.mockClear();
      // Only 1 error after clear — error windows were reset, so no alert
      await manager.trackError('/api/test');
      expect(setFn).not.toHaveBeenCalled();
    });
  });
});

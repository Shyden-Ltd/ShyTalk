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
});

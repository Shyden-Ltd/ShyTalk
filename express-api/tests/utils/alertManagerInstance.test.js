/**
 * Tests for src/utils/alertManagerInstance.js — singleton alert manager wrapper.
 *
 * This module requires firebase (db, messaging) and passes them to createAlertManager().
 * We mock the dependencies and verify it exports the correct interface.
 */

jest.mock('../../src/utils/firebase', () => ({
  db: { collection: jest.fn() },
  messaging: { send: jest.fn() },
}));

const alertManager = require('../../src/utils/alertManagerInstance');

describe('alertManagerInstance', () => {
  test('exports an object (not null or undefined)', () => {
    expect(alertManager).toBeDefined();
    expect(typeof alertManager).toBe('object');
  });

  test('exposes createAlert method', () => {
    expect(typeof alertManager.createAlert).toBe('function');
  });

  test('exposes trackError method', () => {
    expect(typeof alertManager.trackError).toBe('function');
  });

  test('exposes trackSlowEndpoint method', () => {
    expect(typeof alertManager.trackSlowEndpoint).toBe('function');
  });

  test('exposes getConfig method', () => {
    expect(typeof alertManager.getConfig).toBe('function');
  });

  test('exposes _clearState test helper', () => {
    expect(typeof alertManager._clearState).toBe('function');
  });

  test('is a singleton (same reference on repeated require)', () => {
    const alertManager2 = require('../../src/utils/alertManagerInstance');
    expect(alertManager2).toBe(alertManager);
  });

  test('getConfig returns default config shape', () => {
    const config = alertManager.getConfig();
    expect(config).toMatchObject({
      errorSpikeThreshold: expect.any(Number),
      slowEndpointThresholdMs: expect.any(Number),
      fcmRecipientUserIds: expect.any(Array),
    });
  });
});

const mockGetAccessToken = jest.fn().mockResolvedValue({ token: 'mock-access-token' });
const mockGetClient = jest.fn().mockResolvedValue({ getAccessToken: mockGetAccessToken });

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getClient: mockGetClient,
  })),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  verifyProductPurchase,
  verifySubscription,
  _resetAuthClient,
} = require('../../src/utils/playStore');
const log = require('../../src/utils/log');

beforeEach(() => {
  jest.clearAllMocks();
  _resetAuthClient();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

// ─── verifyProductPurchase ──────────────────────────────────────

describe('verifyProductPurchase', () => {
  const pkg = 'com.shyden.shytalk';
  const productId = 'coin_pack_500';
  const token = 'purchase-token-abc';

  test('returns purchase data on valid token', async () => {
    const purchaseData = {
      purchaseState: 0,
      consumptionState: 0,
      orderId: 'GPA.1234-5678',
      purchaseTimeMillis: '1709913600000',
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(purchaseData),
    });

    const result = await verifyProductPurchase(pkg, productId, token);

    expect(result).toEqual(purchaseData);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/products/${productId}/tokens/${token}`,
      { headers: { Authorization: 'Bearer mock-access-token' } },
    );
  });

  test('throws on non-OK response (e.g. 404)', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    });

    await expect(verifyProductPurchase(pkg, productId, token)).rejects.toThrow(
      'Google Play API returned 404',
    );

    expect(log.warn).toHaveBeenCalledWith(
      'playStore',
      'Product purchase verification failed',
      expect.objectContaining({ status: 404 }),
    );
  });

  test('throws on already-consumed purchase (consumptionState === 1)', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          purchaseState: 0,
          consumptionState: 1,
          orderId: 'GPA.1234-5678',
        }),
    });

    await expect(verifyProductPurchase(pkg, productId, token)).rejects.toThrow(
      'Purchase already consumed',
    );

    expect(log.warn).toHaveBeenCalledWith(
      'playStore',
      'Purchase already consumed',
      expect.objectContaining({ productId }),
    );
  });

  test('throws on non-purchased state (purchaseState !== 0)', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          purchaseState: 1,
          consumptionState: 0,
        }),
    });

    await expect(verifyProductPurchase(pkg, productId, token)).rejects.toThrow(
      'Purchase not in purchased state',
    );

    expect(log.warn).toHaveBeenCalledWith(
      'playStore',
      'Purchase not in purchased state',
      expect.objectContaining({ purchaseState: 1 }),
    );
  });
});

// ─── verifySubscription ─────────────────────────────────────────

describe('verifySubscription', () => {
  const pkg = 'com.shyden.shytalk';
  const subscriptionId = 'super_shy_monthly';
  const token = 'sub-token-xyz';

  test('returns subscription data on valid token', async () => {
    const subData = {
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
      latestOrderId: 'GPA.SUB-9999',
      lineItems: [{ productId: 'super_shy_monthly' }],
    };

    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(subData),
    });

    const result = await verifySubscription(pkg, subscriptionId, token);

    expect(result).toEqual(subData);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${token}`,
      { headers: { Authorization: 'Bearer mock-access-token' } },
    );
  });

  test('throws on non-active subscription state', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
        lineItems: [{ productId: 'super_shy_monthly' }],
      }),
    });

    await expect(verifySubscription(pkg, subscriptionId, token)).rejects.toThrow(
      'Subscription not active',
    );
  });

  test('throws on non-OK response', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(verifySubscription(pkg, subscriptionId, token)).rejects.toThrow(
      'Google Play API returned 401',
    );

    expect(log.warn).toHaveBeenCalledWith(
      'playStore',
      'Subscription verification failed',
      expect.objectContaining({ status: 401 }),
    );
  });
});

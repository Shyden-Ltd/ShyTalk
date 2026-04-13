const { createAuthStateHandler } = require('../../../public/js/core/auth');

describe('createAuthStateHandler', () => {
  test('calls onReady(null) when user is null', async () => {
    const onReady = jest.fn();
    const handler = createAuthStateHandler({ onReady });
    await handler(null);
    expect(onReady).toHaveBeenCalledWith(null);
  });

  test('calls onReady(user, tokenResult) when no claim required', async () => {
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: {} }) };
    const handler = createAuthStateHandler({ onReady });
    await handler(user);
    expect(onReady).toHaveBeenCalledWith(user, { claims: {} });
  });

  test('calls onReady when required claim is present', async () => {
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: { admin: true } }) };
    const handler = createAuthStateHandler({ requireClaim: 'admin', onReady });
    await handler(user);
    expect(onReady).toHaveBeenCalledWith(user, { claims: { admin: true } });
  });

  test('calls onAccessDenied when required claim is missing', async () => {
    const onAccessDenied = jest.fn();
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: {} }) };
    const handler = createAuthStateHandler({ requireClaim: 'admin', onAccessDenied, onReady });
    await handler(user);
    expect(onAccessDenied).toHaveBeenCalledWith({ reason: 'missing_claim', claim: 'admin' });
    expect(onReady).not.toHaveBeenCalled();
  });

  test('calls onAccessDenied when claim is false', async () => {
    const onAccessDenied = jest.fn();
    const onReady = jest.fn();
    const user = { getIdTokenResult: () => Promise.resolve({ claims: { admin: false } }) };
    const handler = createAuthStateHandler({ requireClaim: 'admin', onAccessDenied, onReady });
    await handler(user);
    expect(onAccessDenied).toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
  });
});

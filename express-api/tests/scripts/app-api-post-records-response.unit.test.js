/**
 * `<Name> on the app POSTs /api/…` must RECORD what came back.
 *
 * The handler did:
 *
 *     await appMethod(ctx, 'ApiPost')(endpoint, rest);
 *     return { ok: true };
 *
 * The call really is made — `androidApiPost` runs `curl` ON THE DEVICE and
 * returns the HTTP status — and the runner discarded it. `ctx.lastResponse` was
 * never set, so the very next line of the scenario,
 *
 *     Then the response status is 400
 *
 * failed with "no prior request — When step missing?", blaming the corpus for a
 * step that is sitting right above it. Four findings a run wore that message,
 * and it points the reader at the feature file instead of the handler.
 *
 * A status of 0 is NOT a response. `deviceCurl` returns 0 when the adb call
 * itself fails, and recording that would let `the response status is 0` pass
 * while nothing reached the server — a fabricated result, which is worse than
 * the failure it replaces.
 */
const { executeStep } = require('../../scripts/manual-qa-runner');

/** A ctx whose app driver answers ApiPost with `status`. */
function ctxWithApiPost(status, { record = [] } = {}) {
  return {
    uiDriver: {
      androidApiPost: async (pathname, body) => {
        record.push({ pathname, body });
        return status;
      },
    },
    sessions: new Map([['Alice', { idToken: 'token' }]]),
    apiBase: 'http://localhost:3000',
  };
}

describe('the POST step records its response', () => {
  it('makes the status readable by the next assertion', async () => {
    const ctx = ctxWithApiPost(400);
    const post = await executeStep(
      { kind: 'When', text: 'Alice on the app POSTs /api/economy/purchase' },
      ctx,
    );
    expect(post.ok).toBe(true);
    const then = await executeStep({ kind: 'Then', text: 'the response status is 400' }, ctx);
    expect(then).toEqual({ ok: true });
  });

  it('still fails the assertion when the status is genuinely different', async () => {
    // Recording the response must not turn the assertion into a rubber stamp.
    const ctx = ctxWithApiPost(200);
    await executeStep({ kind: 'When', text: 'Alice on the app POSTs /api/economy/purchase' }, ctx);
    const then = await executeStep({ kind: 'Then', text: 'the response status is 400' }, ctx);
    expect(then.ok).toBe(false);
  });

  it('records the endpoint and the persona, not just the number', async () => {
    const ctx = ctxWithApiPost(404);
    await executeStep({ kind: 'When', text: 'Alice on the app POSTs /api/conversations' }, ctx);
    expect(ctx.lastResponse).toMatchObject({
      status: 404,
      persona: 'Alice',
      path: '/api/conversations',
    });
  });

  it('passes the trailing arguments through to the driver', async () => {
    // `POSTs /api/economy/purchase with productId="coins-1000"` — the params are
    // the whole point of j06's negative cases, and dropping them would make
    // every variant post the same empty body.
    const record = [];
    const ctx = ctxWithApiPost(400, { record });
    await executeStep(
      { kind: 'When', text: 'Alice on the app POSTs /api/economy/purchase productId="coins-1000"' },
      ctx,
    );
    expect(record).toHaveLength(1);
    expect(record[0].pathname).toBe('/api/economy/purchase');
    expect(String(record[0].body)).toContain('coins-1000');
  });
});

describe('a failed device call is not a response', () => {
  it('FAILS the step when the driver reports status 0', async () => {
    // `deviceCurl` returns 0 when adb itself fails. Recording it would let
    // `the response status is 0` pass while nothing reached the server.
    const ctx = ctxWithApiPost(0);
    const post = await executeStep(
      { kind: 'When', text: 'Alice on the app POSTs /api/economy/purchase' },
      ctx,
    );
    expect(post.ok).toBe(false);
    expect(post.error).toMatch(/did not reach|no status|device/i);
    expect(ctx.lastResponse).toBeFalsy();
  });

  it('does not leave a STALE response behind after a failed call', async () => {
    // A previous scenario's 200 must not answer this scenario's assertion.
    const ctx = ctxWithApiPost(200);
    await executeStep({ kind: 'When', text: 'Alice on the app POSTs /api/a' }, ctx);
    expect(ctx.lastResponse.status).toBe(200);

    ctx.uiDriver.androidApiPost = async () => 0;
    const second = await executeStep({ kind: 'When', text: 'Alice on the app POSTs /api/b' }, ctx);
    expect(second.ok).toBe(false);
    expect(ctx.lastResponse).toBeFalsy();
  });
});

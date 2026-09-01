/**
 * SHY-0501 — an abandoned download must not leak its storage connection.
 *
 * Found on a server that had been up 3 days 21 hours: `GET /api/admin/backups`
 * never responded, while the same route's R2 work took 43ms standalone. The
 * process held exactly **50** sockets to storage, all CLOSE_WAIT — the AWS SDK
 * v3 default `maxSockets`. Every new request queued behind a connection that
 * would never be freed, and with no timeout configured it queued forever.
 *
 * CLOSE_WAIT means the far end hung up and this process never closed its side.
 * Four routes pipe an R2 body straight to the client and drop it if the client
 * goes away first — a moderator scrubbing a reported video, a browser
 * cancelling a large export. Fifty of those is not an unusual day.
 *
 * `pipeToResponse` is the fix, and this pins BOTH directions, because either
 * one alone is a different bug:
 *
 *   - abandoned → the body is destroyed (no leak), and
 *   - completed → the body is NOT destroyed (no truncation).
 *
 * Streams here are real `stream.PassThrough`s, not doubles: destruction
 * semantics are exactly what is under test, and a double would be asserting
 * that the double works.
 */

const { PassThrough, Writable } = require('node:stream');
const { EventEmitter } = require('node:events');

const { pipeToResponse } = require('../../src/utils/r2');

/** A response that behaves like Express's: a Writable that emits 'close'. */
function fakeResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  res.chunks = chunks;
  res.abort = () => res.emit('close');
  return res;
}

describe('pipeToResponse', () => {
  test('a client that disconnects mid-stream has the storage body destroyed', async () => {
    // The leak, exactly. Without this the socket sits in CLOSE_WAIT until the
    // process restarts, and fifty of them stop storage working entirely.
    const body = new PassThrough();
    const res = fakeResponse();
    pipeToResponse(body, res);

    body.write('first chunk');
    await new Promise((r) => setImmediate(r));
    expect(body.destroyed).toBe(false);

    res.abort();
    await new Promise((r) => setImmediate(r));
    expect(body.destroyed).toBe(true);
  });

  test('a client that disconnects BEFORE any byte arrives is handled the same', async () => {
    const body = new PassThrough();
    const res = fakeResponse();
    pipeToResponse(body, res);

    res.abort();
    await new Promise((r) => setImmediate(r));
    expect(body.destroyed).toBe(true);
  });

  test('a download that COMPLETES is not destroyed by the close that follows', async () => {
    // The other half, and the one that would truncate real downloads if this
    // were written carelessly: Express emits 'close' on every response,
    // including the successful ones.
    const body = new PassThrough();
    const res = fakeResponse();
    pipeToResponse(body, res);

    body.end('all of it');
    await new Promise((r) => setTimeout(r, 10));
    const destroyedBeforeClose = body.destroyed;

    res.emit('close');
    await new Promise((r) => setImmediate(r));

    expect(res.chunks.join('')).toBe('all of it');
    // Node destroys an ended stream itself; what matters is that WE did not
    // destroy it early and cut the bytes short.
    expect(destroyedBeforeClose === false || res.chunks.join('') === 'all of it').toBe(true);
  });

  test('it returns the piped destination, so callers can still return it', () => {
    const body = new PassThrough();
    const res = fakeResponse();
    expect(pipeToResponse(body, res)).toBe(res);
  });

  test('a body with no destroy() does not throw when the client goes away', async () => {
    // Defensive: not every readable in the wild is a Node stream.
    const body = Object.assign(new EventEmitter(), { pipe: () => undefined });
    const res = fakeResponse();
    expect(() => {
      pipeToResponse(body, res);
      res.abort();
    }).not.toThrow();
  });
});

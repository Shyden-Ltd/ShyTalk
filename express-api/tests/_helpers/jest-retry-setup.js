/**
 * Global jest setup: enable per-test retry on transient infrastructure errors.
 *
 * Why this exists:
 *   The 4225-test express-api suite runs all tests in two jest worker
 *   processes. Each worker handles ~70 test files sequentially, and many
 *   tests use `supertest(app)` which creates a fresh `http.Server` bound
 *   to a fresh ephemeral TCP port per request. Over 6000+ such requests
 *   per worker, macOS's ephemeral port range (default ~16k slots, each
 *   spending 30+ seconds in TIME_WAIT after close) gets close enough to
 *   exhaustion that a small fraction of requests fail with `ECONNRESET`
 *   or `socket hang up`. The TESTS THEMSELVES are correct — they pass
 *   in isolation in <100ms — but their TCP connection dies in flight.
 *
 * Why retry is the right fix here:
 *   The proper architectural fix is to share a single http.Server per
 *   test file (and have all tests use the same port via a top-level
 *   server reference). That requires changing the `request(app)` pattern
 *   in 100+ test files. Jest's `retryTimes` lets us absorb the transient
 *   socket churn at zero refactor cost — failing tests are re-run, real
 *   bugs still surface (they fail every retry).
 *
 * The retry is bounded: 3 retries max. A test that fails 4 times in a
 * row almost certainly has a real bug, not socket churn.
 */
jest.retryTimes(3, { logErrorsBeforeRetry: true });

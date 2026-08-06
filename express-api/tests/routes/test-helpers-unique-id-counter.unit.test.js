/**
 * Type-safety of the uniqueId counter (POST /api/test/setup allocation tx +
 * the cleanup counter-restore).
 *
 * Root cause pinned here (2026-07-10): the restore path reads the top doc of
 * `orderBy('uniqueId','desc')` — Firestore type-orders strings AFTER numbers,
 * so one string-typed uniqueId doc anywhere poisons the counter with a string;
 * the allocation tx then CONCATENATES ("33331" + 1 === "333311") and every
 * user it creates carries a string uniqueId that the admin search
 * (`where('uniqueId','==', Number)`) can never find → 404 cascade across the
 * whole admin web suite.
 *
 * Contract: both sites are type-immune — allocation always yields a finite
 * number no matter what the counter doc holds; restore never writes a
 * non-numeric value into the counter.
 */

const express = require('express');
const request = require('supertest');

// ─── Firebase mock (path-capturing, per create-user harness) ─────

const mockDocGet = jest.fn();
const mockDocSet = jest.fn().mockResolvedValue();
const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocDelete = jest.fn().mockResolvedValue();

const mockDoc = jest.fn((path) => ({
  _path: path,
  get: () => mockDocGet(path),
  set: (...args) => mockDocSet(path, ...args),
  update: (...args) => mockDocUpdate(path, ...args),
  delete: (...args) => mockDocDelete(path, ...args),
}));

const mockBatchDelete = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatch = jest.fn(() => ({
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));

const mockQueryGet = jest.fn();
const mockWhere = jest.fn(() => ({ get: mockQueryGet }));
const mockOrderByLimitGet = jest.fn();
const mockOrderByLimit = jest.fn(() => ({ get: mockOrderByLimitGet }));
const mockOrderBy = jest.fn(() => ({ limit: mockOrderByLimit }));
const mockCollection = jest.fn(() => ({ where: mockWhere, orderBy: mockOrderBy }));

const mockTransactionGet = jest.fn();
const mockTransactionSet = jest.fn();
const mockRunTransaction = jest.fn(async (callback) =>
  callback({ get: mockTransactionGet, set: mockTransactionSet }),
);

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    batch: (...args) => mockBatch(...args),
    collection: (...args) => mockCollection(...args),
    runTransaction: (...args) => mockRunTransaction(...args),
  },
}));

let mockIdCounter = 0;
jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => `id${++mockIdCounter}`),
}));

jest.mock('../../src/utils/bans', () => ({
  clearBanCache: jest.fn(),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const testHelpersRouter = require('../../src/routes/test-helpers');

const VALID_API_KEY = 'test-secret-key-123';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', testHelpersRouter);
  return app;
}

// counterValue: what the tx reads from counters/uniqueId
function armCounter(counterValue) {
  mockTransactionGet.mockResolvedValue({
    exists: counterValue !== undefined,
    data: () => ({ value: counterValue }),
  });
}

function counterTxWrites() {
  return mockTransactionSet.mock.calls.map(([, data]) => data);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIdCounter = 0;
  process.env.TEST_API_KEY = VALID_API_KEY;

  mockDocGet.mockReset();
  mockDocSet.mockReset();
  mockDocUpdate.mockReset();
  mockDocDelete.mockReset();
  mockQueryGet.mockReset();
  mockTransactionGet.mockReset();
  mockTransactionSet.mockReset();
  mockOrderByLimitGet.mockReset();

  mockDocGet.mockResolvedValue({ exists: false });
  mockDocSet.mockResolvedValue();
  mockDocUpdate.mockResolvedValue();
  mockDocDelete.mockResolvedValue();
  mockQueryGet.mockResolvedValue({ empty: true, docs: [], size: 0 });
  mockOrderByLimitGet.mockResolvedValue({ empty: true, docs: [] });
});

afterEach(() => {
  delete process.env.TEST_API_KEY;
});

async function setupOneUser() {
  const res = await request(createApp())
    .post('/api/test/setup')
    .set('X-Test-Api-Key', VALID_API_KEY)
    .send({ users: [{ name: 'counter-probe' }] });
  expect(res.status).toBe(200);
  return res.body;
}

describe('uniqueId allocation transaction — type immunity', () => {
  test('string counter value "33331" allocates NUMBER 33332, not "333311"', async () => {
    armCounter('33331');

    const body = await setupOneUser();

    expect(body.users[0].uniqueId).toBe(33332);
    const writes = counterTxWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ value: 33332 });
  });

  test('string counter write-back is a number (no re-poisoning)', async () => {
    armCounter('33331');

    await setupOneUser();

    expect(typeof counterTxWrites()[0].value).toBe('number');
  });

  test('numeric counter still increments exactly (500 → 501)', async () => {
    armCounter(500);

    const body = await setupOneUser();

    expect(body.users[0].uniqueId).toBe(501);
    expect(counterTxWrites()[0]).toEqual({ value: 501 });
  });

  test('missing counter doc cold-starts at 100000001', async () => {
    armCounter(undefined);

    const body = await setupOneUser();

    expect(body.users[0].uniqueId).toBe(100000001);
    expect(counterTxWrites()[0]).toEqual({ value: 100000001 });
  });

  test('non-numeric garbage counter value falls back to the numeric base', async () => {
    armCounter('not-a-number');

    const body = await setupOneUser();

    expect(body.users[0].uniqueId).toBe(100000001);
    expect(counterTxWrites()[0]).toEqual({ value: 100000001 });
  });

  test('user doc is written with the numeric uniqueId field', async () => {
    armCounter('33331');

    await setupOneUser();

    const userWrite = mockDocSet.mock.calls.find(([path]) => path === 'users/33332');
    expect(userWrite).toBeDefined();
    expect(userWrite[1].uniqueId).toBe(33332);
  });

  // Coercion tightness: Number() alone would accept these — the contract is
  // "genuine positive safe integer, or a digit-only string of one"; everything
  // else restarts at the base rather than minting a nonsense id.
  test.each([
    ['boolean true (Number(true) === 1)', true],
    ['boolean false', false],
    ['zero', 0],
    ['negative number', -5],
    ['null (Number(null) === 0)', null],
    ['fractional numeric string', '100.5'],
    ['exponent-notation string', '1e3'],
    ['NaN value', NaN],
    ['Infinity value', Infinity],
    ['unsafe-integer numeric string', '9007199254740993'],
    ['doc exists but value field missing', undefined],
  ])('untrusted counter value (%s) falls back to the base', async (_label, value) => {
    armCounter(value);
    // armCounter(undefined) arms exists:false; re-arm as exists:true with a
    // missing value field for the "field missing" case.
    if (value === undefined) {
      mockTransactionGet.mockResolvedValue({ exists: true, data: () => ({}) });
    }

    const body = await setupOneUser();

    expect(body.users[0].uniqueId).toBe(100000001);
    expect(counterTxWrites()[0]).toEqual({ value: 100000001 });
  });
});

describe('cleanup counter restore — type immunity + raise-only repair', () => {
  // Drives POST /api/test/teardown with one deletable test user so
  // userUniqueIds is non-empty and the restore block runs.
  // topDocUniqueId: uniqueId of the orderBy('uniqueId','desc') top doc
  //   (or the sentinel EMPTY / MISSING_FIELD).
  // liveCounter: what the restore transaction reads from counters/uniqueId.
  const EMPTY = Symbol('empty snapshot');
  const MISSING_FIELD = Symbol('doc without uniqueId field');

  async function cleanupWith({ topDocUniqueId, liveCounter }) {
    const userDocRef = {
      collection: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ size: 0, docs: [] }) })),
      delete: jest.fn().mockResolvedValue(),
    };
    // First where().get() is the users-by-_testRun query; later queries empty.
    mockQueryGet
      .mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [{ id: '33331', data: () => ({ uniqueId: '33331' }), ref: userDocRef }],
      })
      .mockResolvedValue({ empty: true, docs: [], size: 0 });

    if (topDocUniqueId === EMPTY) {
      mockOrderByLimitGet.mockResolvedValue({ empty: true, docs: [] });
    } else if (topDocUniqueId === MISSING_FIELD) {
      mockOrderByLimitGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({}) }] });
    } else {
      mockOrderByLimitGet.mockResolvedValue({
        empty: false,
        docs: [{ data: () => ({ uniqueId: topDocUniqueId }) }],
      });
    }

    // The restore runs its write inside a doc-only transaction that first
    // reads the live counter (raise-only guard against concurrent setups).
    mockTransactionGet.mockResolvedValue({
      exists: liveCounter !== undefined,
      data: () => ({ value: liveCounter }),
    });

    const res = await request(createApp())
      .post('/api/test/teardown')
      .set('X-Test-Api-Key', VALID_API_KEY)
      .send({ testRunId: 'test_run_probe' });
    expect(res.status).toBe(200);
  }

  function counterRestoreWrite() {
    const call = mockTransactionSet.mock.calls.find(([ref]) => ref._path === 'counters/uniqueId');
    return call ? call[1] : undefined;
  }

  test('string-typed top doc must NOT be written into the counter — numeric base instead', async () => {
    await cleanupWith({ topDocUniqueId: '999888777', liveCounter: undefined });

    expect(counterRestoreWrite()).toEqual({ value: 100000000 });
    expect(typeof counterRestoreWrite().value).toBe('number');
  });

  test('numeric top doc restores that exact number', async () => {
    await cleanupWith({ topDocUniqueId: 100000777, liveCounter: undefined });

    expect(counterRestoreWrite()).toEqual({ value: 100000777 });
  });

  test('empty users collection restores the numeric base', async () => {
    await cleanupWith({ topDocUniqueId: EMPTY, liveCounter: undefined });

    expect(counterRestoreWrite()).toEqual({ value: 100000000 });
  });

  test('top doc without a uniqueId field restores the numeric base', async () => {
    await cleanupWith({ topDocUniqueId: MISSING_FIELD, liveCounter: undefined });

    expect(counterRestoreWrite()).toEqual({ value: 100000000 });
  });

  // typeof NaN === 'number' — deleting the safe-integer guard must go red here.
  test.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
    ['negative', -42],
    ['fractional', 100.5],
  ])('non-safe-integer numeric top doc (%s) restores the numeric base', async (_label, v) => {
    await cleanupWith({ topDocUniqueId: v, liveCounter: undefined });

    expect(counterRestoreWrite()).toEqual({ value: 100000000 });
  });

  test('raise-only: a live counter ABOVE the candidate is kept (concurrent-allocation race guard)', async () => {
    await cleanupWith({ topDocUniqueId: 100000500, liveCounter: 100000600 });

    expect(counterRestoreWrite()).toEqual({ value: 100000600 });
  });

  test('a live counter BELOW the candidate is raised to the candidate (repair)', async () => {
    await cleanupWith({ topDocUniqueId: 100000500, liveCounter: 100000400 });

    expect(counterRestoreWrite()).toEqual({ value: 100000500 });
  });

  // A digit-string live counter is coerced, not discarded: a poisoned run
  // wrote REAL doc paths (users/333311), so the counter must stay above the
  // coerced value or a later allocation reissues a colliding id.
  test('a digit-string live counter is coerced and still wins raise-only', async () => {
    await cleanupWith({ topDocUniqueId: 100000500, liveCounter: '999999999999' });

    expect(counterRestoreWrite()).toEqual({ value: 999999999999 });
  });

  test('a garbage live counter is not trusted — candidate wins', async () => {
    await cleanupWith({ topDocUniqueId: 100000500, liveCounter: 'banana' });

    expect(counterRestoreWrite()).toEqual({ value: 100000500 });
  });
});

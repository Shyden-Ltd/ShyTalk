const mockDocGet = jest.fn();
const mockQueryGet = jest.fn();

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: jest.fn(() => ({
      get: mockDocGet,
    })),
  },
}));

const { getDoc, queryDocs } = require('../../src/utils/firestore-helpers');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getDoc', () => {
  test('returns { id, ...data } when document exists', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'doc-1',
      data: () => ({ name: 'Test', value: 42 }),
    });

    const result = await getDoc('collection/doc-1');
    expect(result).toEqual({ id: 'doc-1', name: 'Test', value: 42 });
  });

  test('returns null when document does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false });

    const result = await getDoc('collection/nonexistent');
    expect(result).toBeNull();
  });
});

describe('queryDocs', () => {
  test('returns array of { id, ...data } from query results', async () => {
    const mockRef = {
      get: mockQueryGet,
    };
    mockQueryGet.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ name: 'Alice' }) },
        { id: 'b', data: () => ({ name: 'Bob' }) },
      ],
    });

    const results = await queryDocs(mockRef);
    expect(results).toEqual([
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
    ]);
  });

  test('returns empty array when query has no results', async () => {
    const mockRef = {
      get: mockQueryGet,
    };
    mockQueryGet.mockResolvedValue({ docs: [] });

    const results = await queryDocs(mockRef);
    expect(results).toEqual([]);
  });
});

// The Firestore doc reference's `.id` is the authoritative storage-layer key.
// The payload (`snap.data()`) is untrusted because user-writable Firestore
// rules can let an `id` field be persisted on the doc body (legacy schema,
// migration drift, adversarial write). If the helper ever lets the payload's
// `id` win over the doc's own `id`, every caller of getDoc/queryDocs is
// silently mis-attributing records — IDs flowing into authorization checks,
// admin UIs, exports, and analytics would be wrong-but-plausible.
//
// Pins the spread-order contract: `{ ...snap.data(), id: snap.id }`.
describe('spread-order safety (privacy invariant)', () => {
  test('getDoc: trusted snap.id wins over payload.id', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'real-doc-id',
      data: () => ({ id: 'rogue-payload-id', name: 'spoofed' }),
    });

    const result = await getDoc('collection/real-doc-id');
    expect(result.id).toBe('real-doc-id');
    expect(result.name).toBe('spoofed');
  });

  test('queryDocs: trusted d.id wins over payload.id for every result', async () => {
    const mockRef = { get: mockQueryGet };
    mockQueryGet.mockResolvedValue({
      docs: [
        { id: 'real-a', data: () => ({ id: 'rogue-a', name: 'Alice' }) },
        { id: 'real-b', data: () => ({ id: 'rogue-b', name: 'Bob' }) },
      ],
    });

    const results = await queryDocs(mockRef);
    expect(results.map((r) => r.id)).toEqual(['real-a', 'real-b']);
    expect(results.map((r) => r.name)).toEqual(['Alice', 'Bob']);
  });

  // ECMAScript spread of `undefined` produces `{}` silently. A mocked or
  // legacy-tier Firestore snap that reports `exists: true` but whose `data()`
  // returns `undefined` would therefore pass through the helper as
  // `{ id: snap.id }` — the trusted id still wins, no crash, payload is empty.
  // Pinning this avoids a future "defensive" refactor (e.g. wrapping
  // `snap.data() ?? {}` then changing spread order again) silently regressing
  // the contract or introducing a TypeError on the spread.
  test('getDoc: data() returning undefined on an existing doc yields { id } (no crash)', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      id: 'doc-undef',
      data: () => undefined,
    });

    const result = await getDoc('collection/doc-undef');
    expect(result).toEqual({ id: 'doc-undef' });
  });

  // Same `{ ...undefined } -> {}` invariant for queryDocs: a single
  // undefined-payload doc must not poison the entire result array nor crash
  // the spread; neighbouring well-formed docs must still pass through. Pins
  // the queryDocs side of the contract symmetrically with the getDoc case
  // above so a future spread-shape refactor can't regress one without
  // failing both.
  test('queryDocs: data() returning undefined on one doc yields { id } only, others unaffected', async () => {
    const mockRef = { get: mockQueryGet };
    mockQueryGet.mockResolvedValue({
      docs: [
        { id: 'normal', data: () => ({ name: 'Alice' }) },
        { id: 'undef', data: () => undefined },
      ],
    });

    const results = await queryDocs(mockRef);
    expect(results).toEqual([{ id: 'normal', name: 'Alice' }, { id: 'undef' }]);
  });
});

// The helpers do not try/catch — they let Firestore rejections propagate to
// the caller, which is the documented contract every consumer depends on for
// upstream error handling. Pin both rejection paths so a future "defensive"
// wrapper (e.g. swallowing errors and returning null/[]) cannot silently
// turn every consumer's catch block into dead code.
describe('error propagation', () => {
  test('getDoc: rejects unmodified when snap.get() rejects', async () => {
    mockDocGet.mockRejectedValue(new Error('DEADLINE_EXCEEDED'));
    await expect(getDoc('collection/anything')).rejects.toThrow('DEADLINE_EXCEEDED');
  });

  test('queryDocs: rejects unmodified when ref.get() rejects', async () => {
    const mockRef = { get: mockQueryGet };
    mockQueryGet.mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(queryDocs(mockRef)).rejects.toThrow('PERMISSION_DENIED');
  });
});

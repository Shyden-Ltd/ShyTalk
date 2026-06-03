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
});

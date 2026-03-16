const { migrateParticipantIds } = require('../../scripts/migrate-participant-ids');

describe('migrateParticipantIds', () => {
  let mockDb;
  let mockBatch;
  let mockDocs;

  function createMockDoc(id, data) {
    return {
      ref: { path: `conversations/${id}` },
      data: () => data,
    };
  }

  beforeEach(() => {
    mockBatch = {
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    mockDocs = [];
    mockDb = {
      collection: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({
          docs: mockDocs,
          size: mockDocs.length,
        }),
      })),
      batch: jest.fn(() => mockBatch),
    };
  });

  test('converts string participantIds to numbers', async () => {
    mockDocs.push(createMockDoc('conv-1', { participantIds: ['10000001', '10000002'] }));
    // Re-mock collection().get() with updated docs
    mockDb.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length }),
    });

    const result = await migrateParticipantIds(mockDb);

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockBatch.update).toHaveBeenCalledWith(mockDocs[0].ref, {
      participantIds: [10000001, 10000002],
    });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  test('skips docs with already-numeric participantIds', async () => {
    mockDocs.push(createMockDoc('conv-2', { participantIds: [10000001, 10000002] }));
    mockDb.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length }),
    });

    const result = await migrateParticipantIds(mockDb);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockBatch.update).not.toHaveBeenCalled();
  });

  test('skips docs without participantIds array', async () => {
    mockDocs.push(createMockDoc('conv-3', { isGroup: true }));
    mockDb.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length }),
    });

    const result = await migrateParticipantIds(mockDb);

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('handles mixed string and numeric ids', async () => {
    mockDocs.push(createMockDoc('conv-4', { participantIds: ['10000001', 10000002] }));
    mockDb.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length }),
    });

    const result = await migrateParticipantIds(mockDb);

    expect(result.migrated).toBe(1);
    expect(mockBatch.update).toHaveBeenCalledWith(mockDocs[0].ref, {
      participantIds: [10000001, 10000002],
    });
  });

  test('returns correct total count', async () => {
    mockDocs.push(
      createMockDoc('conv-a', { participantIds: ['1', '2'] }),
      createMockDoc('conv-b', { participantIds: [3, 4] }),
      createMockDoc('conv-c', { participantIds: ['5', '6'] }),
    );
    mockDb.collection.mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: mockDocs, size: mockDocs.length }),
    });

    const result = await migrateParticipantIds(mockDb);

    expect(result.total).toBe(3);
    expect(result.migrated).toBe(2);
    expect(result.skipped).toBe(1);
  });
});

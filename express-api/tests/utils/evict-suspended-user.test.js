/**
 * Suspension cascade matrix for evictSuspendedUser.
 *
 * Behaviour spec (per manual QA requirement):
 *
 *   ┌──────────────────────┬─────────────────────────────────────────────────┐
 *   │ Suspended user role  │ Expected effect on the room                     │
 *   ├──────────────────────┼─────────────────────────────────────────────────┤
 *   │ Owner                │ Room CLOSED immediately (state=CLOSED).         │
 *   │                      │ participantIds + hostIds wiped. closedAt set.   │
 *   │                      │ RTDB room_closed event + RTDB node removed.    │
 *   ├──────────────────────┼─────────────────────────────────────────────────┤
 *   │ Host (in seat)       │ Removed from hostIds AND participantIds.        │
 *   │                      │ Their seat cleared (userId=null, state=EMPTY). │
 *   │                      │ Room state unchanged. RTDB room_updated event. │
 *   ├──────────────────────┼─────────────────────────────────────────────────┤
 *   │ Host (not seated)    │ Removed from hostIds AND participantIds.        │
 *   │                      │ No seat changes. Room stays open.               │
 *   ├──────────────────────┼─────────────────────────────────────────────────┤
 *   │ Seated non-host      │ Removed from participantIds. Seat cleared.      │
 *   │                      │ hostIds unchanged. Room stays open.             │
 *   ├──────────────────────┼─────────────────────────────────────────────────┤
 *   │ Visitor (not seated) │ Removed from participantIds. No other changes.  │
 *   └──────────────────────┴─────────────────────────────────────────────────┘
 *
 * The util is also exercised against a fully-occupied 8-seat room with a
 * mixture of hosts + non-hosts to confirm the right seats clear and the
 * other six stay untouched.
 */

const mockDocUpdate = jest.fn().mockResolvedValue();
const mockDocSet = jest.fn().mockResolvedValue();
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue();
const mockBatch = jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }));
const mockDoc = jest.fn(() => ({ update: mockDocUpdate, set: mockDocSet }));
// Collection chain returns a self-referential proxy so .where().where().get() etc.
// all resolve. queryDocs is mocked separately so the actual return is irrelevant.
const mockCollection = jest.fn(() => {
  const chain = {
    where: jest.fn(() => chain),
    orderBy: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
  };
  return chain;
});
const mockRtdbSet = jest.fn().mockResolvedValue();
const mockRtdbRemove = jest.fn().mockResolvedValue();
const mockRtdbRef = jest.fn(() => ({ set: mockRtdbSet, remove: mockRtdbRemove }));

jest.mock('../../src/utils/firebase', () => ({
  db: {
    doc: (...args) => mockDoc(...args),
    collection: (...args) => mockCollection(...args),
    batch: () => mockBatch(),
  },
  rtdb: {
    ref: (...args) => mockRtdbRef(...args),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  now: jest.fn(() => 1700000000000),
}));

jest.mock('../../src/utils/log', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));

const mockQueryDocs = jest.fn();
jest.mock('../../src/utils/firestore-helpers', () => ({
  queryDocs: (...args) => mockQueryDocs(...args),
}));

const { evictSuspendedUser } = require('../../src/utils/evict-suspended-user');

beforeEach(() => {
  jest.clearAllMocks();
  mockDocUpdate.mockReset();
  mockDocUpdate.mockResolvedValue();
  mockDocSet.mockReset();
  mockDocSet.mockResolvedValue();
  mockBatchSet.mockReset();
  mockBatchCommit.mockReset();
  mockBatchCommit.mockResolvedValue();
  mockRtdbSet.mockReset();
  mockRtdbSet.mockResolvedValue();
  mockRtdbRemove.mockReset();
  mockRtdbRemove.mockResolvedValue();
  mockQueryDocs.mockReset();
  // Default: no rooms — so individual tests just override what they need.
  mockQueryDocs.mockResolvedValue([]);
});

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Build a fully-occupied 8-seat room for cascade testing.
 *  - seat 0: owner
 *  - seats 1, 2: hosts
 *  - seats 3-7: non-host participants
 */
function makeFullRoom({ ownerId, host1Id, host2Id, attendees, roomId = 'room-full' }) {
  return {
    id: roomId,
    ownerId,
    state: 'ACTIVE',
    participantIds: [ownerId, host1Id, host2Id, ...attendees],
    hostIds: [host1Id, host2Id],
    seats: {
      0: { userId: ownerId, state: 'OCCUPIED', isMuted: false },
      1: { userId: host1Id, state: 'OCCUPIED', isMuted: false },
      2: { userId: host2Id, state: 'OCCUPIED', isMuted: false },
      3: { userId: attendees[0], state: 'OCCUPIED', isMuted: false },
      4: { userId: attendees[1], state: 'OCCUPIED', isMuted: false },
      5: { userId: attendees[2], state: 'OCCUPIED', isMuted: false },
      6: { userId: attendees[3], state: 'OCCUPIED', isMuted: false },
      7: { userId: attendees[4], state: 'OCCUPIED', isMuted: false },
    },
  };
}

/**
 * Configure the queryDocs mock so the first call (participantIds match) returns
 * `participantRooms` and the second (ownerId match) returns `ownerRooms`.
 */
function mockRoomsQueries({ participantRooms = [], ownerRooms = [] } = {}) {
  mockQueryDocs.mockReset();
  mockQueryDocs.mockResolvedValueOnce(participantRooms);
  mockQueryDocs.mockResolvedValueOnce(ownerRooms);
}

/** Locate the data payload for a given doc path in batch.set() calls. */
function findWrittenData(path) {
  // Each batch.set(ref, data, opts) call: ref is whatever db.doc(path) returned.
  // Track which ref came from which path via mockDoc.mock.calls.
  const docCalls = mockDoc.mock.calls;
  const docResults = mockDoc.mock.results.map((r) => r.value);
  const targetIndices = docCalls.map((c, i) => (c[0] === path ? i : -1)).filter((i) => i >= 0);
  for (const i of targetIndices) {
    const ref = docResults[i];
    const setCall = mockBatchSet.mock.calls.find((c) => c[0] === ref);
    if (setCall) return setCall[1];
  }
  return null;
}

// ── Owner suspension ─────────────────────────────────────────────

describe('evictSuspendedUser — owner role', () => {
  it('closes the room when the owner is suspended', async () => {
    const room = makeFullRoom({
      ownerId: 'owner-1',
      host1Id: 'host-1',
      host2Id: 'host-2',
      attendees: ['att-1', 'att-2', 'att-3', 'att-4', 'att-5'],
    });
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [room] });

    const result = await evictSuspendedUser('owner-1');

    const written = findWrittenData('rooms/room-full');
    expect(written).toBeDefined();
    expect(written.state).toBe('CLOSED');
    expect(written.closedAt).toBe(1700000000000);
    expect(written.participantIds).toEqual([]);
    expect(written.hostIds).toEqual([]);
    expect(result.roomsClosed).toBe(1);
    expect(result.roomsUpdated).toBe(0);
  });

  it('closes a room owned by user even when they have already left (not in participantIds)', async () => {
    // Owner abandoned their room before suspension — the participants-only query
    // would miss it. The dedicated owner query catches it.
    const room = {
      id: 'room-abandoned',
      ownerId: 'owner-2',
      state: 'ACTIVE',
      participantIds: ['someone-else'], // owner-2 not here
      hostIds: [],
      seats: {},
    };
    mockRoomsQueries({ participantRooms: [], ownerRooms: [room] });

    await evictSuspendedUser('owner-2');

    const written = findWrittenData('rooms/room-abandoned');
    expect(written).toBeDefined();
    expect(written.state).toBe('CLOSED');
  });

  it('fires room_closed RTDB event AND removes the RTDB room node when owner closure happens', async () => {
    const room = {
      id: 'room-1',
      ownerId: 'owner-3',
      state: 'ACTIVE',
      participantIds: ['owner-3', 'guest'],
      hostIds: [],
      seats: {},
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [room] });

    await evictSuspendedUser('owner-3');

    expect(mockRtdbRef).toHaveBeenCalledWith('rooms/room-1/events/lastEvent');
    expect(mockRtdbSet).toHaveBeenCalledWith(expect.objectContaining({ type: 'room_closed' }));
    expect(mockRtdbRef).toHaveBeenCalledWith('rooms/room-1');
    expect(mockRtdbRemove).toHaveBeenCalled();
  });
});

// ── Host suspension (in seat) ────────────────────────────────────

describe('evictSuspendedUser — host role (seated)', () => {
  it('removes from hostIds AND participantIds, clears their seat, leaves other seats untouched', async () => {
    const room = makeFullRoom({
      ownerId: 'owner-1',
      host1Id: 'host-1',
      host2Id: 'host-2',
      attendees: ['att-1', 'att-2', 'att-3', 'att-4', 'att-5'],
    });
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('host-1');

    const written = findWrittenData('rooms/room-full');
    expect(written).toBeDefined();
    expect(written.participantIds).not.toContain('host-1');
    expect(written.participantIds).toContain('owner-1');
    expect(written.participantIds).toContain('host-2');
    expect(written.participantIds.length).toBe(7); // 8 - host-1
    expect(written.hostIds).toEqual(['host-2']);
    expect(written.seats[1]).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
    // Other seats untouched
    expect(written.seats[0].userId).toBe('owner-1');
    expect(written.seats[2].userId).toBe('host-2');
    expect(written.seats[3].userId).toBe('att-1');
    expect(written.state).toBeUndefined(); // room not closed
  });

  it('fires room_updated (NOT room_closed) RTDB event for non-owner suspension', async () => {
    const room = makeFullRoom({
      ownerId: 'owner-1',
      host1Id: 'host-1',
      host2Id: 'host-2',
      attendees: ['att-1', 'att-2', 'att-3', 'att-4', 'att-5'],
    });
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('host-1');

    expect(mockRtdbSet).toHaveBeenCalledWith(expect.objectContaining({ type: 'room_updated' }));
    expect(mockRtdbRemove).not.toHaveBeenCalled();
  });
});

// ── Host suspension (not seated) ─────────────────────────────────

describe('evictSuspendedUser — host role (not seated)', () => {
  it('removes from hostIds + participantIds without touching any seats', async () => {
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1', 'walking-host', 'someone-else'],
      hostIds: ['walking-host'],
      seats: {
        0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
        1: { userId: 'someone-else', state: 'OCCUPIED', isMuted: false },
        2: { userId: null, state: 'EMPTY', isMuted: false },
      },
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('walking-host');

    const written = findWrittenData('rooms/room-1');
    expect(written.hostIds).toEqual([]);
    expect(written.participantIds).not.toContain('walking-host');
    // Seats unchanged — none were occupied by walking-host
    expect(written.seats[0].userId).toBe('owner-1');
    expect(written.seats[1].userId).toBe('someone-else');
    expect(written.seats[2].state).toBe('EMPTY');
  });
});

// ── Seated non-host suspension ───────────────────────────────────

describe('evictSuspendedUser — seated non-host role', () => {
  it('clears seat + removes from participantIds; hostIds untouched', async () => {
    const room = makeFullRoom({
      ownerId: 'owner-1',
      host1Id: 'host-1',
      host2Id: 'host-2',
      attendees: ['att-1', 'att-2', 'att-3', 'att-4', 'att-5'],
    });
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('att-3');

    const written = findWrittenData('rooms/room-full');
    expect(written.participantIds).not.toContain('att-3');
    expect(written.hostIds).toEqual(['host-1', 'host-2']); // untouched
    expect(written.seats[5]).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
    // Other seats untouched
    expect(written.seats[0].userId).toBe('owner-1');
    expect(written.seats[1].userId).toBe('host-1');
    expect(written.seats[3].userId).toBe('att-1');
    expect(written.state).toBeUndefined();
  });
});

// ── Visitor (not seated) suspension ──────────────────────────────

describe('evictSuspendedUser — visitor role (not seated)', () => {
  it('removes from participantIds; hostIds and all seats untouched', async () => {
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1', 'visitor-1', 'host-1'],
      hostIds: ['host-1'],
      seats: {
        0: { userId: 'owner-1', state: 'OCCUPIED', isMuted: false },
        1: { userId: 'host-1', state: 'OCCUPIED', isMuted: false },
        2: { userId: null, state: 'EMPTY', isMuted: false },
      },
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('visitor-1');

    const written = findWrittenData('rooms/room-1');
    expect(written.participantIds).toEqual(['owner-1', 'host-1']);
    expect(written.hostIds).toEqual(['host-1']);
    expect(written.seats[0].userId).toBe('owner-1');
    expect(written.seats[1].userId).toBe('host-1');
    expect(written.seats[2].state).toBe('EMPTY');
    expect(written.state).toBeUndefined();
  });
});

// ── Multiple rooms / mixed ──────────────────────────────────────

describe('evictSuspendedUser — multi-room cascade', () => {
  it('handles a user who is owner of one room AND a host in another simultaneously', async () => {
    const ownedRoom = {
      id: 'room-owned',
      ownerId: 'multi-1',
      state: 'ACTIVE',
      participantIds: ['multi-1'],
      hostIds: [],
      seats: {},
    };
    const hostedRoom = {
      id: 'room-hosted',
      ownerId: 'someone-else',
      state: 'ACTIVE',
      participantIds: ['someone-else', 'multi-1'],
      hostIds: ['multi-1'],
      seats: {
        2: { userId: 'multi-1', state: 'OCCUPIED', isMuted: false },
      },
    };
    mockRoomsQueries({
      participantRooms: [ownedRoom, hostedRoom],
      ownerRooms: [ownedRoom],
    });

    const result = await evictSuspendedUser('multi-1');

    expect(result.roomsClosed).toBe(1);
    expect(result.roomsUpdated).toBe(1);

    const owned = findWrittenData('rooms/room-owned');
    const hosted = findWrittenData('rooms/room-hosted');
    expect(owned.state).toBe('CLOSED');
    expect(hosted.state).toBeUndefined();
    expect(hosted.hostIds).toEqual([]);
    expect(hosted.participantIds).toEqual(['someone-else']);
    expect(hosted.seats[2]).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
  });

  it('clears currentRoomId on the user even when they are not in any rooms', async () => {
    mockRoomsQueries({ participantRooms: [], ownerRooms: [] });
    await evictSuspendedUser('lonely-user');
    expect(mockDoc).toHaveBeenCalledWith('users/lonely-user');
    // set+merge instead of update — the user doc may have been deleted between
    // the suspension lookup and cascade run, and update() throws on missing docs.
    expect(mockDocSet).toHaveBeenCalledWith({ currentRoomId: null }, { merge: true });
  });

  it('skips RTDB room_node removal for non-owner cascade (only events fire)', async () => {
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1', 'visitor'],
      hostIds: [],
      seats: {},
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('visitor');

    expect(mockRtdbSet).toHaveBeenCalled(); // event fires
    expect(mockRtdbRemove).not.toHaveBeenCalled(); // node not removed
  });
});

// ── Snake_case backwards-compat (legacy seat data) ──────────────

describe('evictSuspendedUser — legacy snake_case seat fields', () => {
  it('clears seat with user_id (snake_case) just like userId', async () => {
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1', 'snake-user'],
      hostIds: [],
      seats: {
        0: { user_id: 'snake-user', state: 'OCCUPIED', isMuted: false },
      },
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });

    await evictSuspendedUser('snake-user');

    const written = findWrittenData('rooms/room-1');
    expect(written.seats[0]).toEqual({ userId: null, state: 'EMPTY', isMuted: false });
  });
});

// ── RTDB error tolerance ────────────────────────────────────────

describe('evictSuspendedUser — RTDB failure tolerance', () => {
  it('completes the Firestore eviction even if the RTDB event write fails', async () => {
    const log = require('../../src/utils/log');
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1', 'visitor'],
      hostIds: [],
      seats: {},
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [] });
    mockRtdbSet.mockRejectedValueOnce(new Error('RTDB down'));

    await evictSuspendedUser('visitor');

    expect(mockBatchCommit).toHaveBeenCalled(); // Firestore batch ran
    expect(log.warn).toHaveBeenCalledWith(
      'evict-suspended-user',
      expect.stringContaining('Failed to write'),
      expect.any(Object),
    );
  });

  it('completes the closure even if the RTDB room-node remove fails', async () => {
    const log = require('../../src/utils/log');
    const room = {
      id: 'room-1',
      ownerId: 'owner-1',
      state: 'ACTIVE',
      participantIds: ['owner-1'],
      hostIds: [],
      seats: {},
    };
    mockRoomsQueries({ participantRooms: [room], ownerRooms: [room] });
    mockRtdbRemove.mockRejectedValueOnce(new Error('RTDB down'));

    await evictSuspendedUser('owner-1');

    expect(mockBatchCommit).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'evict-suspended-user',
      expect.stringContaining('Failed to remove'),
      expect.any(Object),
    );
  });

  // ─── Partial-failure tests (T1, T5) ────────────────────────────
  // The route layer surfaces `partial`/`failedRoomIds` from the cascade so an
  // admin sees that some rooms still need manual cleanup. These tests pin the
  // cascade's contract so a refactor that drops the failed-room tracking
  // shows up immediately.

  describe('partial failure surfacing', () => {
    it('reports partial=true with failedRoomIds when a batch.commit() rejects', async () => {
      const ownerRoom = {
        id: 'room-1',
        ownerId: 'banned',
        state: 'ACTIVE',
        participantIds: ['banned', 'a'],
        hostIds: [],
        seats: {},
      };
      const hostRoom = {
        id: 'room-2',
        ownerId: 'someone-else',
        state: 'ACTIVE',
        participantIds: ['someone-else', 'banned'],
        hostIds: ['banned'],
        seats: {},
      };
      mockRoomsQueries({ participantRooms: [ownerRoom, hostRoom], ownerRooms: [ownerRoom] });
      // Single chunk (rooms+user-doc < 500 ops) — first commit rejects so both
      // rooms end up in failedRoomIds; RTDB events for those rooms must NOT fire.
      mockBatchCommit.mockRejectedValueOnce(new Error('Firestore RESOURCE_EXHAUSTED'));

      const result = await evictSuspendedUser('banned');

      expect(result.partial).toBe(true);
      expect(result.failedRoomIds).toEqual(expect.arrayContaining(['room-1', 'room-2']));
      // RTDB writes must be skipped for failed rooms — emitting room_closed/updated
      // for a room whose Firestore write rolled back would lie to live clients.
      expect(mockRtdbSet).not.toHaveBeenCalled();
      expect(mockRtdbRemove).not.toHaveBeenCalled();
    });

    it('returns partial=false when zero-rooms branch succeeds via set+merge (not update)', async () => {
      mockRoomsQueries({ participantRooms: [], ownerRooms: [] });

      const result = await evictSuspendedUser('lonely');

      expect(result).toEqual({
        roomsClosed: 0,
        roomsUpdated: 0,
        partial: false,
        failedRoomIds: [],
        userDocFailed: false,
        rtdbEventsFailed: 0,
        error: null,
      });
      // Reverted from update() → set+merge so a deleted user doc doesn't throw.
      expect(mockDocSet).toHaveBeenCalledWith({ currentRoomId: null }, { merge: true });
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });

    it('reports userDocFailed=true when only the user-doc op chunk rejects', async () => {
      // Single room, single chunk includes both ops — but to exercise the user-doc-only
      // failure mode we mock rooms.length to be exactly 500 so user-doc lands alone in
      // chunk 2. Easier: a single room + a forced two-chunk split via mockBatchCommit.
      const room = {
        id: 'room-only',
        ownerId: 'banned',
        state: 'ACTIVE',
        participantIds: ['banned', 'a'],
        hostIds: [],
        seats: {},
      };
      mockRoomsQueries({ participantRooms: [room], ownerRooms: [room] });
      // First chunk (rooms+user-doc combined since 2 ops < 500) rejects: BOTH the room
      // op AND the user-doc op are in failedSet, so cascade reports userDocFailed=true
      // and the room id appears in failedRoomIds.
      mockBatchCommit.mockRejectedValueOnce(new Error('Firestore down'));

      const result = await evictSuspendedUser('banned');

      expect(result.userDocFailed).toBe(true);
      expect(result.failedRoomIds).toEqual(['room-only']);
      expect(result.partial).toBe(true);
    });

    it('propagates set+merge rejection from the zero-rooms branch to the caller', async () => {
      mockRoomsQueries({ participantRooms: [], ownerRooms: [] });
      mockDocSet.mockRejectedValueOnce(new Error('Firestore unavailable'));

      await expect(evictSuspendedUser('lonely')).rejects.toThrow('Firestore unavailable');
    });

    // ─── Phase-tag contract (HIGH-1 from pass 4-6) ─────────────────
    // The route catch blocks branch on `err.phase === 'user_doc'` to set
    // `userDocFailed` accurately. Reverting the phase tag would silently
    // regress every cascade response from "userDoc actually failed" to
    // "userDoc fine, only rooms failed" — admin retries get wrong signal.

    it('tags zero-rooms set+merge failures with err.phase === user_doc', async () => {
      mockRoomsQueries({ participantRooms: [], ownerRooms: [] });
      mockDocSet.mockRejectedValueOnce(new Error('Firestore unavailable'));

      let caught;
      try {
        await evictSuspendedUser('lonely');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.message).toBe('Firestore unavailable');
      expect(caught.phase).toBe('user_doc');
    });

    it('leaves err.phase undefined when the initial queryDocs throws (rooms cascade only)', async () => {
      mockQueryDocs.mockReset();
      mockQueryDocs.mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED on participantIds'));

      let caught;
      try {
        await evictSuspendedUser('any-uid');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.phase).toBeUndefined();
    });

    it('does not crash when the thrown value is a non-extensible object (defensive guard)', async () => {
      mockRoomsQueries({ participantRooms: [], ownerRooms: [] });
      const frozenErr = Object.freeze(new Error('frozen'));
      mockDocSet.mockRejectedValueOnce(frozenErr);

      let caught;
      try {
        await evictSuspendedUser('lonely');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBe(frozenErr);
      // Freezing prevents the phase tag, but the function must still re-throw.
      expect(caught.phase).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Pass-13 fix L2: rtdbEventsFailed counter
  // ───────────────────────────────────────────────────────────────────────
  describe('rtdbEventsFailed counter (Pass-13 L2)', () => {
    it('increments rtdbEventsFailed when room_updated RTDB write rejects', async () => {
      // Set up a single visitor room so rooms.length=1, owner !== uid, → updates path.
      mockQueryDocs
        .mockResolvedValueOnce([
          {
            id: 'roomA',
            ownerId: 'someone-else',
            participantIds: ['suspended-uid', 'someone-else'],
            hostIds: [],
            seats: {},
          },
        ])
        .mockResolvedValueOnce([]);
      mockBatchCommit.mockResolvedValueOnce();
      mockRtdbSet.mockRejectedValueOnce(new Error('RTDB write failed'));

      const result = await evictSuspendedUser('suspended-uid');
      expect(result.rtdbEventsFailed).toBe(1);
      // partial covers Firestore truth; RTDB-only failures don't flip partial.
      expect(result.partial).toBe(false);
      expect(result.roomsUpdated).toBe(1);
    });

    it('rtdbEventsFailed=0 on full success', async () => {
      mockQueryDocs
        .mockResolvedValueOnce([
          {
            id: 'roomA',
            ownerId: 'someone-else',
            participantIds: ['suspended-uid'],
            hostIds: [],
            seats: {},
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await evictSuspendedUser('suspended-uid');
      expect(result.rtdbEventsFailed).toBe(0);
    });

    it('counts owner-closure room with both RTDB ops failing as ONE failed room', async () => {
      // Owner branch fires: ref(.../events/lastEvent).set + ref(...).remove.
      // Both reject → rtdbEventsFailed should be 1 (one room failed),
      // not 2 (number of RTDB ops). The admin-facing counter means
      // "rooms whose RTDB sync failed", not "RTDB ops attempted".
      mockQueryDocs.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'ownedRoom',
          ownerId: 'suspended-uid',
          participantIds: ['suspended-uid'],
          hostIds: ['suspended-uid'],
          seats: {},
        },
      ]);
      mockBatchCommit.mockResolvedValueOnce();
      mockRtdbSet.mockRejectedValueOnce(new Error('rtdb set fail'));
      mockRtdbRemove.mockRejectedValueOnce(new Error('rtdb remove fail'));

      const result = await evictSuspendedUser('suspended-uid');
      expect(result.rtdbEventsFailed).toBe(1);
      expect(result.roomsClosed).toBe(1);
    });
  });
});

/**
 * Tests for src/utils/system-pm.js — System Private Message utility.
 *
 * sendSystemPm(recipientUid, text):
 * - Ensures SHYTALK_SYSTEM user exists in Firestore.
 * - Creates or merges a conversation doc between the recipient and system user.
 * - Writes a SYSTEM-type message to the conversation's messages subcollection.
 * - Increments the recipient's unread count via FieldValue.increment.
 * - Writes a real-time event to RTDB (non-fatal on failure).
 *
 * systemConversationId(recipientUid):
 * - Returns a deterministic conversation ID by sorting [recipientUid, SYSTEM_UID].
 *
 * SYSTEM_UID:
 * - The constant 'SHYTALK_SYSTEM'.
 */

const MOCK_ID = 'generatedId123';
const MOCK_NOW = 1700000000000;

// ─── Mocks ────────────────────────────────────────────────────────

const mockSet = jest.fn().mockResolvedValue(undefined);
const mockGet = jest.fn();
const mockDocFn = jest.fn().mockImplementation(() => ({
  set: mockSet,
  get: mockGet,
}));

jest.mock('../../src/utils/firebase', () => ({
  db: { doc: mockDocFn },
  rtdb: {
    ref: jest.fn().mockReturnValue({
      set: jest.fn().mockResolvedValue(undefined),
    }),
  },
  FieldValue: {
    increment: jest.fn((n) => `increment(${n})`),
  },
}));

jest.mock('../../src/utils/helpers', () => ({
  generateId: jest.fn(() => MOCK_ID),
  now: jest.fn(() => MOCK_NOW),
}));

jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

const { sendSystemPm, SYSTEM_UID, systemConversationId } = require('../../src/utils/system-pm');
const { db: _db, rtdb, FieldValue } = require('../../src/utils/firebase');

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Default: system user does not exist, conversation does not exist
  mockGet.mockResolvedValue({ exists: false });
});

describe('SYSTEM_UID', () => {
  test('is the string "SHYTALK_SYSTEM"', () => {
    expect(SYSTEM_UID).toBe('SHYTALK_SYSTEM');
  });
});

describe('systemConversationId()', () => {
  test('returns sorted concatenation of recipientUid and SYSTEM_UID', () => {
    // 'alice' < 'SHYTALK_SYSTEM' lexicographically (uppercase S < lowercase a in ASCII? No — uppercase comes first)
    // 'S' (83) < 'a' (97), so SHYTALK_SYSTEM sorts before alice
    const result = systemConversationId('alice');
    expect(result).toBe(
      ['alice', SYSTEM_UID].sort((a, b) => String(a).localeCompare(String(b))).join('_'),
    );
  });

  test('returns the same ID regardless of argument order conceptually', () => {
    const id1 = systemConversationId('userA');
    const id2 = systemConversationId('userA');
    expect(id1).toBe(id2);
  });

  test('produces different IDs for different recipients', () => {
    const id1 = systemConversationId('user1');
    const id2 = systemConversationId('user2');
    expect(id1).not.toBe(id2);
  });

  test('includes SYSTEM_UID in the result', () => {
    const result = systemConversationId('bob');
    expect(result).toContain(SYSTEM_UID);
  });
});

describe('sendSystemPm()', () => {
  test('ensures system user exists — creates if missing', async () => {
    // First get: system user doc does not exist
    mockGet
      .mockResolvedValueOnce({ exists: false }) // users/SHYTALK_SYSTEM
      .mockResolvedValueOnce({ exists: false }); // conversations/convId

    await sendSystemPm('recipient1', 'Hello!');

    // Should check system user
    expect(mockDocFn).toHaveBeenCalledWith(`users/${SYSTEM_UID}`);

    // Should create the system user
    const systemUserSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].id === SYSTEM_UID && call[0].userType === 'SYSTEM',
    );
    expect(systemUserSetCall).toBeDefined();
    expect(systemUserSetCall[0]).toMatchObject({
      id: SYSTEM_UID,
      displayName: 'ShyTalk System',
      userType: 'SYSTEM',
      createdAt: MOCK_NOW,
      lastSeenAt: MOCK_NOW,
    });
  });

  test('skips system user creation if already exists', async () => {
    mockGet
      .mockResolvedValueOnce({ exists: true }) // users/SHYTALK_SYSTEM exists
      .mockResolvedValueOnce({ exists: false }); // conversations/convId

    await sendSystemPm('recipient1', 'Hello!');

    // Should NOT write the system user doc (only conversation, message, settings)
    const systemUserSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].id === SYSTEM_UID && call[0].userType === 'SYSTEM',
    );
    expect(systemUserSetCall).toBeUndefined();
  });

  test('creates conversation doc with correct fields for new conversation', async () => {
    const convId = systemConversationId('recipient1');
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({ exists: false }); // conversation does not exist

    await sendSystemPm('recipient1', 'Welcome!');

    // Find the conversation set call
    expect(mockDocFn).toHaveBeenCalledWith(`conversations/${convId}`);
    const convSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].id === convId && call[0].isGroup === false,
    );
    expect(convSetCall).toBeDefined();
    expect(convSetCall[0]).toMatchObject({
      id: convId,
      isGroup: false,
      participantIds: ['recipient1', SYSTEM_UID],
      lastMessage: {
        text: 'Welcome!',
        senderId: SYSTEM_UID,
        senderName: 'ShyTalk System',
        type: 'SYSTEM',
        createdAt: MOCK_NOW,
      },
      lastMessageAt: MOCK_NOW,
      createdAt: MOCK_NOW, // Only set when conversation is new
    });
    // Should be called with merge: true
    expect(convSetCall[1]).toEqual({ merge: true });
  });

  test('merges conversation doc without createdAt for existing conversation', async () => {
    const convId = systemConversationId('recipient1');
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ participantIds: ['recipient1', SYSTEM_UID] }),
      }); // conversation exists

    await sendSystemPm('recipient1', 'Another message');

    const convSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].id === convId && call[0].isGroup === false,
    );
    expect(convSetCall).toBeDefined();
    // Should NOT have createdAt because the conversation already exists
    expect(convSetCall[0].createdAt).toBeUndefined();
    expect(convSetCall[0].participantIds).toEqual(['recipient1', SYSTEM_UID]);
  });

  test('writes message to conversation messages subcollection', async () => {
    const convId = systemConversationId('recipient1');
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({ exists: false }); // conversation

    await sendSystemPm('recipient1', 'Test message');

    expect(mockDocFn).toHaveBeenCalledWith(`conversations/${convId}/messages/${MOCK_ID}`);
    const msgSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].id === MOCK_ID && call[0].type === 'SYSTEM',
    );
    expect(msgSetCall).toBeDefined();
    expect(msgSetCall[0]).toMatchObject({
      id: MOCK_ID,
      conversationId: convId,
      senderId: SYSTEM_UID,
      senderName: 'ShyTalk System',
      text: 'Test message',
      type: 'SYSTEM',
      createdAt: MOCK_NOW,
    });
  });

  test('increments unread count for recipient in userSettings', async () => {
    const convId = systemConversationId('recipient1');
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({ exists: false }); // conversation

    await sendSystemPm('recipient1', 'Notification');

    const settingsPath = `conversations/${convId}/userSettings/recipient1`;
    expect(mockDocFn).toHaveBeenCalledWith(settingsPath);
    expect(FieldValue.increment).toHaveBeenCalledWith(1);

    const settingsSetCall = mockSet.mock.calls.find(
      (call) => call[0] && call[0].userId === 'recipient1' && call[0].conversationId === convId,
    );
    expect(settingsSetCall).toBeDefined();
    expect(settingsSetCall[0]).toMatchObject({
      userId: 'recipient1',
      conversationId: convId,
      unreadCount: 'increment(1)',
      isHidden: false,
    });
    expect(settingsSetCall[1]).toEqual({ merge: true });
  });

  test('writes RTDB event for new message', async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({ exists: false }); // conversation

    const convId = systemConversationId('recipient1');

    await sendSystemPm('recipient1', 'Hello');

    expect(rtdb.ref).toHaveBeenCalledWith(`conversations/${convId}/events/lastEvent`);
    const refSetFn = rtdb.ref.mock.results[0].value.set;
    expect(refSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'new_message',
      }),
    );
  });

  test('does not throw when RTDB write fails', async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false }) // system user
      .mockResolvedValueOnce({ exists: false }); // conversation

    // Make RTDB ref.set fail
    rtdb.ref.mockReturnValue({
      set: jest.fn().mockRejectedValue(new Error('RTDB down')),
    });

    await expect(sendSystemPm('recipient1', 'Hello')).resolves.toBeUndefined();

    // Should log a warning
    const log = require('../../src/utils/log');
    expect(log.warn).toHaveBeenCalledWith(
      'system-pm',
      'Failed to write RTDB event',
      expect.objectContaining({ error: 'RTDB down' }),
    );
  });
});

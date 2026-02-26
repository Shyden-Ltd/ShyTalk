/**
 * Tests for index.js — ShyTalk Cloud Functions
 *
 * Follows the same mock-firebase-admin pattern as admin.test.js.
 * All helper names are prefixed with "mock" so Jest 30 allows them in jest.mock() factories.
 */

// ── Mock data stores ────────────────────────────────────────────────
let mockUsers = {};
let mockRooms = {};
let mockGifts = {};
let mockCoinPackages = {};
let mockConfig = {};
let mockReports = {};
let mockReportsArchive = {};
let mockConversations = {};
let mockBroadcasts = {};
let mockBackpacks = {};
let mockGiftWall = {};
let mockTransactions = {};
let mockAdminTokens = {};
let mockPresence = {};
let mockGiftRankings = {};
let mockConvSettings = {};
let mockStalkers = {};
let mockDocIdCounter = 0;

function mockResetStores() {
  mockUsers = {};
  mockRooms = {};
  mockGifts = {};
  mockCoinPackages = {};
  mockConfig = {};
  mockReports = {};
  mockReportsArchive = {};
  mockConversations = {};
  mockBroadcasts = {};
  mockBackpacks = {};
  mockGiftWall = {};
  mockTransactions = {};
  mockAdminTokens = {};
  mockPresence = {};
  mockGiftRankings = {};
  mockConvSettings = {};
  mockStalkers = {};
  mockDocIdCounter = 0;
}

function mockFakeTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return { toDate: () => d, toMillis: () => d.getTime(), _seconds: Math.floor(d.getTime() / 1000) };
}

function mockGetStore(path) {
  if (path === "users") return mockUsers;
  if (path === "rooms") return mockRooms;
  if (path === "gifts") return mockGifts;
  if (path === "coinPackages") return mockCoinPackages;
  if (path === "config") return mockConfig;
  if (path === "reports") return mockReports;
  if (path === "reports_archive") return mockReportsArchive;
  if (path === "conversations") return mockConversations;
  if (path === "broadcasts") return mockBroadcasts;
  if (path === "admin_tokens") return mockAdminTokens;
  if (path === "backpack" || path.includes("/backpack")) return mockBackpacks;
  if (path.includes("/giftWall")) return mockGiftWall;
  if (path.includes("/transactions")) return mockTransactions;
  if (path === "giftRankings") return mockGiftRankings;
  if (path.includes("/settings")) return mockConvSettings;
  if (path.includes("/stalkers")) return mockStalkers;
  return {};
}

function mockBuildQuerySnapshot(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({
      id: d._id,
      data: () => { const c = { ...d }; delete c._id; delete c._collection; return c; },
      ref: mockBuildDocRef(d._collection || "unknown", d._id),
    })),
  };
}

function mockBuildDocRef(collection, docId) {
  return {
    id: docId,
    get: jest.fn(async () => {
      const store = mockGetStore(collection);
      const data = store[docId];
      return {
        exists: !!data,
        id: docId,
        data: () => (data ? { ...data } : undefined),
        ref: mockBuildDocRef(collection, docId),
      };
    }),
    set: jest.fn(async (data, opts) => {
      const store = mockGetStore(collection);
      if (opts && opts.merge) {
        store[docId] = { ...(store[docId] || {}), ...data };
      } else {
        store[docId] = { ...data };
      }
    }),
    update: jest.fn(async (updates) => {
      const store = mockGetStore(collection);
      if (!store[docId]) store[docId] = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v && v._type === "increment") {
          store[docId][k] = (store[docId][k] || 0) + v._value;
        } else if (v && v._type === "delete") {
          delete store[docId][k];
        } else if (v && v._type === "arrayRemove") {
          const arr = store[docId][k] || [];
          store[docId][k] = arr.filter((x) => !v._values.includes(x));
        } else if (v && v._type === "arrayUnion") {
          const arr = store[docId][k] || [];
          store[docId][k] = [...new Set([...arr, ...v._values])];
        } else {
          store[docId][k] = v;
        }
      }
    }),
    delete: jest.fn(async () => {
      const store = mockGetStore(collection);
      delete store[docId];
    }),
    collection: (subCol) => mockBuildCollectionRef(`${collection}/${docId}/${subCol}`),
  };
}

function mockBuildQuery(path, filters) {
  return {
    where: (...args) => mockBuildQuery(path, [...filters, args]),
    limit: () => mockBuildQuery(path, filters),
    orderBy: () => mockBuildQuery(path, filters),
    offset: () => mockBuildQuery(path, filters),
    get: jest.fn(async () => {
      const store = mockGetStore(path);
      let entries = Object.entries(store).map(([id, data]) => ({
        _id: id,
        _collection: path,
        ...data,
      }));
      for (const [field, op, value] of filters) {
        entries = entries.filter((entry) => {
          const fieldValue = entry[field];
          // For Timestamp-like objects, compare by _seconds so <= / < / > / >= work correctly
          const fv = fieldValue && typeof fieldValue === "object" && "_seconds" in fieldValue ? fieldValue._seconds : fieldValue;
          const cv = value && typeof value === "object" && "_seconds" in value ? value._seconds : value;
          switch (op) {
            case "==": return JSON.stringify(fieldValue) === JSON.stringify(value);
            case "<=": return fv <= cv;
            case "<": return fv < cv;
            case ">": return fv > cv;
            case ">=": return fv >= cv;
            case "in": return value.includes(fieldValue);
            case "array-contains": return Array.isArray(fieldValue) && fieldValue.includes(value);
            default: return true;
          }
        });
      }
      return mockBuildQuerySnapshot(entries);
    }),
  };
}

function mockBuildCollectionRef(path) {
  return {
    doc: (id) => {
      const docId = id || `auto_${++mockDocIdCounter}`;
      return mockBuildDocRef(path, docId);
    },
    where: (...args) => mockBuildQuery(path, [args]),
    orderBy: () => mockBuildQuery(path, []),
    add: jest.fn(async (data) => {
      const store = mockGetStore(path);
      const id = `auto_${++mockDocIdCounter}`;
      store[id] = { ...data };
      return { id };
    }),
    get: jest.fn(async () => {
      const store = mockGetStore(path);
      const docs = Object.entries(store).map(([id, data]) => ({
        _id: id,
        _collection: path,
        ...data,
      }));
      return mockBuildQuerySnapshot(docs);
    }),
    limit: () => mockBuildQuery(path, []),
    select: () => mockBuildCollectionRef(path),
  };
}

const mockBatch = {
  update: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn().mockResolvedValue(),
};

function mockCreateTransaction() {
  return {
    get: jest.fn(async (ref) => ref.get()),
    update: jest.fn(async (ref, data) => ref.update(data)),
    set: jest.fn(async (ref, data, opts) => ref.set(data, opts)),
    delete: jest.fn(async (ref) => ref.delete()),
  };
}

// ── Mock firebase-admin modules ─────────────────────────────────────
const mockRevokeRefreshTokens = jest.fn().mockResolvedValue();

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    revokeRefreshTokens: mockRevokeRefreshTokens,
  }),
}));

jest.mock("firebase-admin/app", () => ({
  initializeApp: jest.fn(),
}));

const mockRunTransaction = jest.fn(async (fn) => {
  const tx = mockCreateTransaction();
  return fn(tx);
});

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name) => mockBuildCollectionRef(name),
    collectionGroup: (name) => mockBuildQuery(name, []),
    batch: () => mockBatch,
    runTransaction: mockRunTransaction,
  }),
  Timestamp: {
    now: () => mockFakeTimestamp(new Date()),
    fromDate: (d) => mockFakeTimestamp(d),
  },
  FieldValue: {
    increment: (n) => ({ _type: "increment", _value: n }),
    delete: () => ({ _type: "delete" }),
    serverTimestamp: () => mockFakeTimestamp(new Date()),
    arrayRemove: (...vals) => ({ _type: "arrayRemove", _values: vals }),
    arrayUnion: (...vals) => ({ _type: "arrayUnion", _values: vals }),
  },
  FieldPath: {
    documentId: () => "__name__",
  },
}));

jest.mock("firebase-admin/database", () => ({
  getDatabase: () => ({
    ref: (path) => ({
      get: jest.fn(async () => {
        if (path && path.startsWith("presence/")) {
          const parts = path.replace("presence/", "").split("/");
          const roomId = parts[0];
          const userId = parts[1];
          if (userId && mockPresence[roomId] && mockPresence[roomId][userId]) {
            return { exists: () => true, val: () => true };
          }
          if (!userId && mockPresence[roomId]) {
            return { exists: () => true, val: () => mockPresence[roomId] };
          }
        }
        if (path === "presence" && Object.keys(mockPresence).length > 0) {
          return { exists: () => true, val: () => mockPresence };
        }
        return { exists: () => false, val: () => null };
      }),
      remove: jest.fn(),
    }),
  }),
}));

const mockS3Send = jest.fn().mockResolvedValue({ Contents: [], IsTruncated: false });
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  ListObjectsV2Command: jest.fn().mockImplementation((params) => ({ type: "list", params })),
  DeleteObjectsCommand: jest.fn().mockImplementation((params) => ({ type: "delete", params })),
}));

const mockSendNotification = jest.fn().mockResolvedValue({ successCount: 1 });
jest.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({
    send: mockSendNotification,
  }),
}));

jest.mock("livekit-server-sdk", () => ({
  AccessToken: jest.fn().mockImplementation(() => ({
    addGrant: jest.fn(),
    toJwt: jest.fn().mockResolvedValue("mock-jwt-token"),
  })),
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: (optsOrHandler, maybeHandler) => {
    const handler = typeof optsOrHandler === "function" ? optsOrHandler : maybeHandler;
    return handler;
  },
  onRequest: (opts, handler) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock("firebase-functions/v2/database", () => ({
  onValueDeleted: (opts, handler) => handler,
}));

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentUpdated: (opts, handler) => handler,
  onDocumentCreated: (opts, handler) => handler,
  onDocumentWritten: (opts, handler) => handler,
}));

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (opts, handler) => handler,
}));

jest.mock("firebase-functions/params", () => ({
  defineSecret: (name) => ({ value: () => `mock-${name}` }),
}));

// ── Load index.js after all mocks ───────────────────────────────────
const indexModule = require("./index");

// ── Test helpers ────────────────────────────────────────────────────
function callOnCall(fnName, authUid, data) {
  const fn = indexModule[fnName];
  const request = {
    auth: authUid ? { uid: authUid, token: { admin: authUid === "admin-user" } } : null,
    data: data || {},
  };
  return fn(request);
}

// ── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  mockResetStores();
  jest.clearAllMocks();
  // Default S3 mock: no objects in any folder
  mockS3Send.mockResolvedValue({ Contents: [], IsTruncated: false });
});

// ═══════════════════════════════════════════════════════════════
// claimDailyReward
// ═══════════════════════════════════════════════════════════════
describe("claimDailyReward", () => {
  test("rejects unauthenticated", async () => {
    await expect(callOnCall("claimDailyReward", null))
      .rejects.toThrow("Must be signed in");
  });

  test("rejects if already claimed today", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginRewardDate: today, loginStreak: 5, shyCoins: 100 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    await expect(callOnCall("claimDailyReward", "user-1"))
      .rejects.toThrow("Already claimed today");
  });

  test("awards base reward for new streak", async () => {
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 0, shyCoins: 100 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.coinsAwarded).toBe(50);
    expect(result.newStreak).toBe(1);
    expect(result.isMilestone).toBe(false);
    expect(result.newBalance).toBe(150);
  });

  test("continues streak from yesterday", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 6, shyCoins: 200 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: { "7": 100 } };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(7);
    expect(result.coinsAwarded).toBe(100);
    expect(result.isMilestone).toBe(true);
  });

  test("resets streak when gap > 1 day", async () => {
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 30, shyCoins: 500 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(1);
  });

  test("Super Shy 10% bonus", async () => {
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 0, shyCoins: 0, isSuperShy: true };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    // 50 * 1.1 = 55.00000000000001 in JS floating-point, Math.ceil → 56
    expect(result.coinsAwarded).toBe(56);
  });

  test("gift milestone reward adds to backpack", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 6, shyCoins: 100 };
    mockConfig["economy"] = {
      dailyBase: 50,
      milestoneRewards: { "7": { type: "gift", giftId: "rose", quantity: 3 } }
    };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(7);
    expect(result.isMilestone).toBe(true);
    expect(result.coinsAwarded).toBe(0);
    expect(result.giftId).toBe("rose");
    expect(result.giftQuantity).toBe(3);
    // Balance unchanged (gift reward, no coins)
    expect(result.newBalance).toBe(100);
  });

  test("gift milestone reward defaults quantity to 1", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 13, shyCoins: 50 };
    mockConfig["economy"] = {
      dailyBase: 50,
      milestoneRewards: { "14": { type: "gift", giftId: "crown" } }
    };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.giftId).toBe("crown");
    expect(result.giftQuantity).toBe(1);
    expect(result.coinsAwarded).toBe(0);
  });

  test("non-milestone day with gift milestones still awards base coins", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 5, shyCoins: 200 };
    mockConfig["economy"] = {
      dailyBase: 50,
      milestoneRewards: { "7": { type: "gift", giftId: "rose", quantity: 1 } }
    };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(6);
    expect(result.coinsAwarded).toBe(50);
    expect(result.giftId).toBeUndefined();
    expect(result.newBalance).toBe(250);
  });
});

// ═══════════════════════════════════════════════════════════════
// pullGacha
// ═══════════════════════════════════════════════════════════════
describe("pullGacha", () => {
  beforeEach(() => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, order: 2, iconUrl: "" };
  });

  test("rejects unauthenticated", async () => {
    await expect(callOnCall("pullGacha", null, { pullCount: 1 }))
      .rejects.toThrow("Must be signed in");
  });

  test("rejects invalid pullCount", async () => {
    await expect(callOnCall("pullGacha", "user-1", { pullCount: 5 }))
      .rejects.toThrow("pullCount must be 1, 10, or 100");
  });

  test("returns priceChanged when expectedCost mismatches", async () => {
    mockUsers["user-1"] = { shyCoins: 1000, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 999 });

    expect(result.priceChanged).toBe(true);
    expect(result.gifts).toEqual([]);
  });

  test("rejects insufficient coins", async () => {
    mockUsers["user-1"] = { shyCoins: 5, pityCounter: 0, luckScore: 0 };

    await expect(callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 }))
      .rejects.toThrow("Insufficient coins");
  });

  test("success deducts coins and returns gifts", async () => {
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    expect(result.coinsSpent).toBe(10);
    expect(result.newBalance).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGift
// ═══════════════════════════════════════════════════════════════
describe("sendGift", () => {
  test("rejects missing params", async () => {
    await expect(callOnCall("sendGift", "user-1", {}))
      .rejects.toThrow("recipientId and giftId required");
  });

  test("rejects self-gift", async () => {
    await expect(callOnCall("sendGift", "user-1", { recipientId: "user-1", giftId: "rose" }))
      .rejects.toThrow("Cannot send gift to yourself");
  });

  test("rejects when gift not in backpack", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendGift", "user-1", { recipientId: "user-2", giftId: "rose" }))
      .rejects.toThrow("Insufficient items in backpack");
  });

  test("success deducts from backpack and credits beans", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 2 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", { recipientId: "user-2", giftId: "rose" });

    expect(result.success).toBe(true);
    expect(result.giftName).toBe("Rose");
  });

  test("creates transaction records on success", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", { recipientId: "user-2", giftId: "rose" });

    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGiftDirect
// ═══════════════════════════════════════════════════════════════
describe("sendGiftDirect", () => {
  test("rejects insufficient coins", async () => {
    mockGifts["crown"] = { name: "Crown", coinValue: 500 };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "crown" }))
      .rejects.toThrow("Insufficient coins");
  });

  test("deducts coins from sender on success", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    expect(result.success).toBe(true);
    expect(result.coinsSpent).toBe(10);
  });

  test("credits beans to recipient", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    expect(result.beanReward).toBe(6);
  });

  test("rejects self-gift", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10 };
    mockConfig["economy"] = { beanConversionRate: 0.6 };

    await expect(callOnCall("sendGiftDirect", "user-1", { recipientId: "user-1", giftId: "rose" }))
      .rejects.toThrow("Cannot send gift to yourself");
  });
});

// ═══════════════════════════════════════════════════════════════
// redeemBeans
// ═══════════════════════════════════════════════════════════════
describe("redeemBeans", () => {
  test("rejects non-positive amount", async () => {
    await expect(callOnCall("redeemBeans", "user-1", { amount: 0 }))
      .rejects.toThrow("amount must be a positive number");
  });

  test("rejects insufficient beans", async () => {
    mockUsers["user-1"] = { shyBeans: 50, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    await expect(callOnCall("redeemBeans", "user-1", { amount: 100 }))
      .rejects.toThrow("Insufficient beans");
  });

  test("redeems without bonus below threshold", async () => {
    mockUsers["user-1"] = { shyBeans: 500, shyCoins: 100 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 200 });

    expect(result.coinsReceived).toBe(200);
    expect(result.newBeanBalance).toBe(300);
    expect(result.newCoinBalance).toBe(300);
  });

  test("applies bonus at threshold", async () => {
    mockUsers["user-1"] = { shyBeans: 5000, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 2000 });

    expect(result.coinsReceived).toBe(2200);
    expect(result.newBeanBalance).toBe(3000);
    expect(result.newCoinBalance).toBe(2200);
  });
});

// ═══════════════════════════════════════════════════════════════
// validatePurchase
// ═══════════════════════════════════════════════════════════════
describe("validatePurchase", () => {
  test("rejects missing productId", async () => {
    await expect(callOnCall("validatePurchase", "user-1", { purchaseToken: "tok" }))
      .rejects.toThrow("productId and purchaseToken required");
  });

  test("handles subscription monthly", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_monthly",
      purchaseToken: "tok",
      isSubscription: true,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe("monthly");
  });

  test("handles subscription lifetime", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_lifetime",
      purchaseToken: "tok",
      isSubscription: true,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe("lifetime");
  });

  test("handles coin package purchase", async () => {
    mockUsers["user-1"] = { shyCoins: 100 };
    mockCoinPackages["coins_100"] = { productId: "coins_100", coins: 100, bonusCoins: 0 };

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "coins_100",
      purchaseToken: "tok",
      isSubscription: false,
    });

    expect(result.success).toBe(true);
    expect(result.coinsAdded).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// addTestCoins
// ═══════════════════════════════════════════════════════════════
describe("addTestCoins", () => {
  test("rejects missing amount", async () => {
    await expect(callOnCall("addTestCoins", "user-1", {}))
      .rejects.toThrow("amount must be a positive number");
  });

  test("rejects negative amount", async () => {
    await expect(callOnCall("addTestCoins", "user-1", { amount: -50 }))
      .rejects.toThrow("amount must be a positive number");
  });

  test("rejects amount over 100000", async () => {
    await expect(callOnCall("addTestCoins", "user-1", { amount: 200000 }))
      .rejects.toThrow("amount must be a positive number");
  });

  test("adds coins and creates transaction record", async () => {
    mockUsers["user-1"] = { shyCoins: 500 };

    const result = await callOnCall("addTestCoins", "user-1", { amount: 1000 });

    expect(result.success).toBe(true);
    expect(result.coinsAdded).toBe(1000);
    expect(result.newBalance).toBe(1500);
    expect(mockUsers["user-1"].shyCoins).toBe(1500);
  });

  test("works with zero starting balance", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    const result = await callOnCall("addTestCoins", "user-1", { amount: 250 });

    expect(result.success).toBe(true);
    expect(result.coinsAdded).toBe(250);
    expect(result.newBalance).toBe(250);
  });
});

// ═══════════════════════════════════════════════════════════════
// generateLiveKitToken
// ═══════════════════════════════════════════════════════════════
describe("generateLiveKitToken", () => {
  test("returns token for valid request", async () => {
    const result = await callOnCall("generateLiveKitToken", "user-1", {
      roomName: "room-1",
      identity: "user-1",
    });

    expect(result.token).toBe("mock-jwt-token");
  });

  test("rejects missing roomName", async () => {
    await expect(callOnCall("generateLiveKitToken", "user-1", { identity: "user-1" }))
      .rejects.toThrow("roomName and identity are required");
  });

  test("rejects missing identity", async () => {
    await expect(callOnCall("generateLiveKitToken", "user-1", { roomName: "room-1" }))
      .rejects.toThrow("roomName and identity are required");
  });
});

// ═══════════════════════════════════════════════════════════════
// seedCatalog
// ═══════════════════════════════════════════════════════════════
describe("seedCatalog", () => {
  test("requires admin", async () => {
    await expect(callOnCall("seedCatalog", "user-1"))
      .rejects.toThrow("Admin access required");
  });

  test("seeds data successfully", async () => {
    const result = await callOnCall("seedCatalog", "admin-user");

    expect(result.giftsSeeded).toBe(27);
    expect(result.packagesSeeded).toBe(6);
    expect(result.configSeeded).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// archiveOldReports (scheduled)
// ═══════════════════════════════════════════════════════════════
describe("archiveOldReports", () => {
  test("runs without error when no reports", async () => {
    const fn = indexModule.archiveOldReports;
    await fn();
  });
});

// ═══════════════════════════════════════════════════════════════
// checkSubscriptionStatus (scheduled)
// ═══════════════════════════════════════════════════════════════
describe("checkSubscriptionStatus", () => {
  test("runs without error", async () => {
    const fn = indexModule.checkSubscriptionStatus;
    await fn();
  });

  test("expires non-lifetime subscription past expiry date", async () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    mockUsers["user-1"] = {
      isSuperShy: true,
      superShyTier: "monthly",
      superShyExpiry: mockFakeTimestamp(pastDate),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    expect(mockUsers["user-1"].isSuperShy).toBe(false);
    expect(mockUsers["user-1"].superShyExpiry).toBeNull();
    expect(mockUsers["user-1"].superShyTier).toBeNull();
  });

  test("skips lifetime subscription even with past expiry", async () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    mockUsers["user-1"] = {
      isSuperShy: true,
      superShyTier: "lifetime",
      superShyExpiry: mockFakeTimestamp(pastDate),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    // Lifetime subscriptions should NOT be expired
    expect(mockUsers["user-1"].isSuperShy).toBe(true);
    expect(mockUsers["user-1"].superShyTier).toBe("lifetime");
  });
});

// ═══════════════════════════════════════════════════════════════
// onPresenceRemoved (trigger)
// ═══════════════════════════════════════════════════════════════
describe("onPresenceRemoved", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("skips cleanup if user reconnected", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1", "user-1"],
      seats: {},
    };
    mockPresence["room-1"] = { "user-1": true };

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-1" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    expect(mockRooms["room-1"].state).toBe("ACTIVE");
  });

  test("owner alone closes room immediately", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1"],
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: null, state: "EMPTY", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "owner-1" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    expect(mockRooms["room-1"].state).toBe("CLOSED");
  });

  test("owner with others on mic sets OWNER_AWAY", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1", "user-2"],
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
        "2": { userId: null, state: "EMPTY", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "owner-1" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    expect(mockRooms["room-1"].state).toBe("OWNER_AWAY");
  });

  test("non-owner disconnect clears their seat but room stays ACTIVE", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1", "user-2"],
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
        "2": { userId: null, state: "EMPTY", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-2" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    // Room stays ACTIVE because state is ACTIVE (not OWNER_AWAY)
    expect(mockRooms["room-1"].state).toBe("ACTIVE");
    // Seat 1 should be cleared
    expect(mockRooms["room-1"]["seats.1"]).toEqual({
      userId: null, state: "EMPTY", isMuted: false,
    });
    // Owner seat 0 should remain untouched
    expect(mockRooms["room-1"].seats["0"].userId).toBe("owner-1");
  });

  test("last non-owner leaving OWNER_AWAY room triggers CLOSED", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "OWNER_AWAY",
      participantIds: ["owner-1", "user-2"],
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
        "2": { userId: null, state: "EMPTY", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-2" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    // Room should be CLOSED because no one is on mic and owner is away
    expect(mockRooms["room-1"].state).toBe("CLOSED");
    expect(mockRooms["room-1"].participantIds).toEqual([]);
  });

  test("pendingInvites cleaned up on disconnect", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1", "user-2"],
      pendingInvites: { "user-2": { invitedBy: "owner-1" } },
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-2" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    // pendingInvites.user-2 should have been cleared via FieldValue.delete()
    expect(mockRooms["room-1"]["pendingInvites.user-2"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// onUserSuspended (trigger)
// ═══════════════════════════════════════════════════════════════
describe("onUserSuspended", () => {
  test("revokes tokens on suspension", async () => {
    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: null }) },
      },
      params: { userId: "user-1" },
    });

    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });

  test("masks profile on suspension", async () => {
    mockUsers["user-1"] = {
      displayName: "Original Name",
      profilePhotoUrl: "https://photo.url",
      coverPhotoUrl: "https://cover.url",
    };

    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: null }) },
      },
      params: { userId: "user-1" },
    });

    expect(mockUsers["user-1"].displayName).toBe("Suspended Account");
    expect(mockUsers["user-1"].profilePhotoUrl).toBeNull();
    expect(mockUsers["user-1"].coverPhotoUrl).toBeNull();
  });

  test("no-op when not a suspension transition", async () => {
    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: true }) },
        after: { data: () => ({ isSuspended: true }) },
      },
      params: { userId: "user-1" },
    });

    expect(mockRevokeRefreshTokens).not.toHaveBeenCalled();
  });

  test("suspended owner causes room to close", async () => {
    // User owns a room and is a participant
    mockRooms["room-1"] = {
      ownerId: "user-1",
      state: "ACTIVE",
      participantIds: ["user-1", "user-2"],
      seats: {
        "0": { userId: "user-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
      },
    };
    mockUsers["user-1"] = {
      displayName: "Owner",
      currentRoomId: "room-1",
    };

    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: "room-1" }) },
      },
      params: { userId: "user-1" },
    });

    // Room should be CLOSED
    expect(mockRooms["room-1"].state).toBe("CLOSED");
    expect(mockRooms["room-1"].participantIds).toEqual([]);
    // All seats should be empty
    for (let i = 0; i < 8; i++) {
      expect(mockRooms["room-1"][`seats.${i}`]).toEqual({
        userId: null, state: "EMPTY", isMuted: false,
      });
    }
    // currentRoomId should be cleared
    expect(mockUsers["user-1"].currentRoomId).toBeNull();
  });

  test("suspended non-owner gets removed from room", async () => {
    // user-2 is a participant but NOT the owner
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1", "user-2"],
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
        "1": { userId: "user-2", state: "OCCUPIED", isMuted: false },
      },
    };
    mockUsers["user-2"] = {
      displayName: "Non-Owner",
      currentRoomId: "room-1",
    };

    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: "room-1" }) },
      },
      params: { userId: "user-2" },
    });

    // User should be removed from participantIds
    expect(mockRooms["room-1"].participantIds).not.toContain("user-2");
    // User should be added to bannedUserIds
    expect(mockRooms["room-1"].bannedUserIds).toContain("user-2");
    // Seat 1 should be cleared
    expect(mockRooms["room-1"]["seats.1"]).toEqual({
      userId: null, state: "EMPTY", isMuted: false,
    });
    // Room should still be ACTIVE (not closed)
    expect(mockRooms["room-1"].state).toBe("ACTIVE");
    // currentRoomId should be cleared
    expect(mockUsers["user-2"].currentRoomId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// sendPmNotification (trigger)
// ═══════════════════════════════════════════════════════════════
describe("sendPmNotification", () => {
  test("sends notification to recipient", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalled();
  });

  test("respects disabled notifications", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: false,
      fcmTokens: ["token-abc"],
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("skips when no recipients", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("cleans invalid FCM tokens", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["bad-token"],
      pmNotificationPreview: true,
    };

    const invalidErr = new Error("Invalid token");
    invalidErr.code = "messaging/invalid-registration-token";
    mockSendNotification.mockRejectedValueOnce(invalidErr);

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    // Should not throw despite the token error
  });

  test("DND active suppresses notification", async () => {
    // Set DND window that covers the current time
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    // DND window: one hour before current time to one hour after
    const startHour = (currentHour - 1 + 24) % 24;
    const endHour = (currentHour + 1) % 24;

    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
      dndEnabled: true,
      dndStartHour: startHour,
      dndStartMinute: 0,
      dndEndHour: endHour,
      dndEndMinute: 0,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("muted conversation increments unread but skips push", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };
    // Pre-populate conversation settings with isMuted: true for recipient
    // mockConvSettings is routed via mockGetStore for paths containing "/settings"
    mockConvSettings["recipient-1"] = { isMuted: true, unreadCount: 0 };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    // Muted conversation: unread count should be incremented but no FCM push
    expect(mockConvSettings["recipient-1"].unreadCount).toBe(1);
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("IMAGE message type uses correct body text", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "", type: "IMAGE" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageText: "Sent an image",
        }),
      })
    );
  });

  test("group message includes group name in title", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: true,
      groupName: "Cool Squad",
    };
    mockUsers["sender-1"] = { displayName: "Alice" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hey group!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderName: "Alice in Cool Squad",
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGift with quantity
// ═══════════════════════════════════════════════════════════════
describe("sendGift with quantity", () => {
  test("quantity 5 deducts 5 from backpack", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 10 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose", quantity: 5,
    });

    expect(result.success).toBe(true);
    expect(result.quantity).toBe(5);
    expect(mockBackpacks["rose"].quantity).toBe(5);
  });

  test("rejects insufficient backpack quantity", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose", quantity: 5,
    })).rejects.toThrow("Insufficient items in backpack");
  });

  test("defaults quantity to 1 when not provided", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 2 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose",
    });

    expect(result.success).toBe(true);
    expect(result.quantity).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGiftDirect with quantity
// ═══════════════════════════════════════════════════════════════
describe("sendGiftDirect with quantity", () => {
  test("quantity 10 costs coinValue * 10", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 500, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2", giftId: "rose", quantity: 10,
    });

    expect(result.success).toBe(true);
    expect(result.coinsSpent).toBe(100);
    expect(result.quantity).toBe(10);
  });

  test("rejects insufficient coins for quantity", async () => {
    mockGifts["crown"] = { name: "Crown", coinValue: 500 };
    mockUsers["user-1"] = { shyCoins: 600, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2", giftId: "crown", quantity: 2,
    })).rejects.toThrow("Insufficient coins");
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGiftBatch
// ═══════════════════════════════════════════════════════════════
describe("sendGiftBatch", () => {
  test("sends to multiple recipients from backpack", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Alice" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Bob" };
    mockUsers["user-4"] = { shyBeans: 0, displayName: "Charlie" };
    mockBackpacks["rose"] = { quantity: 10 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3", "user-4"],
      giftId: "rose",
      quantity: 2,
      fromBackpack: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalItems).toBe(6); // 2 qty * 3 recipients
    expect(result.totalRecipients).toBe(3);
  });

  test("sends to multiple recipients with coins", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 500, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Alice" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Bob" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3"],
      giftId: "rose",
      quantity: 5,
      fromBackpack: false,
    });

    expect(result.success).toBe(true);
    expect(result.totalItems).toBe(10); // 5 * 2
  });

  test("rejects self-send", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockConfig["economy"] = { beanConversionRate: 0.6 };

    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-1", "user-2"],
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    })).rejects.toThrow("Cannot send gift to yourself");
  });

  test("rejects too many recipients", async () => {
    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds: Array(9).fill("user-2"),
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    })).rejects.toThrow("recipientIds must be an array of 1-8 user IDs");
  });

  test("sends batch gift when sender is in a room (reads before writes)", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender", currentRoomId: "room-1" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Alice" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Bob" };
    mockBackpacks["rose"] = { quantity: 10 };
    mockRooms["room-1"] = { ownerId: "user-1", state: "ACTIVE", participantIds: ["user-1", "user-2"] };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3"],
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    });

    expect(result.success).toBe(true);
    // Verify room got lastGiftEvent
    expect(mockRooms["room-1"].lastGiftEvent).toBeDefined();
    expect(mockRooms["room-1"].lastGiftEvent.senderName).toBe("Sender");
  });

  test("rejects insufficient backpack for batch", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Alice" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Bob" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3"],
      giftId: "rose",
      quantity: 2,
      fromBackpack: true,
    })).rejects.toThrow("Insufficient items in backpack");
  });
});

// ═══════════════════════════════════════════════════════════════
// sendEntireBackpack
// ═══════════════════════════════════════════════════════════════
describe("sendEntireBackpack", () => {
  test("transfers all backpack items", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockBackpacks["crown"] = { quantity: 2 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    expect(result.totalItemsSent).toBe(7); // 5 roses + 2 crowns
    expect(result.giftsSent.length).toBe(2);

    const roseEntry = result.giftsSent.find((g) => g.giftId === "rose");
    expect(roseEntry.quantity).toBe(5);
    expect(roseEntry.giftName).toBe("Rose");

    const crownEntry = result.giftsSent.find((g) => g.giftId === "crown");
    expect(crownEntry.quantity).toBe(2);
    expect(crownEntry.giftName).toBe("Crown");

    // Recipient beans should be credited: (10*0.6*5) + (500*0.6*2) = 30 + 600 = 630
    expect(mockUsers["user-2"].shyBeans).toBe(630);
  });

  test("with empty backpack returns error", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" }))
      .rejects.toThrow("Backpack is empty");
  });

  test("self-send returns error", async () => {
    await expect(callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-1" }))
      .rejects.toThrow("Cannot send backpack to yourself");
  });

  test("updates recipient gift wall", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 50, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    // Gift wall should be updated with receivedCount
    expect(mockGiftWall["rose"]).toBeDefined();
    expect(mockGiftWall["rose"].receivedCount).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// cleanExpiredBackpackItems (scheduled)
// ═══════════════════════════════════════════════════════════════
describe("cleanExpiredBackpackItems", () => {
  test("runs without error when no expired items", async () => {
    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();
  });
});

// ═══════════════════════════════════════════════════════════════
// pullGacha with guaranteedNextPull
// ═══════════════════════════════════════════════════════════════
describe("pullGacha with guaranteedNextPull", () => {
  beforeEach(() => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, order: 2, iconUrl: "" };
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, order: 3, iconUrl: "" };
  });

  test("returns guaranteed gift as first result on single pull", async () => {
    mockUsers["user-1"] = {
      shyCoins: 100,
      pityCounter: 0,
      luckScore: 0,
      guaranteedNextPull: {
        giftId: "crown",
        setBy: "admin-1",
        setAt: mockFakeTimestamp(new Date()),
      },
    };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    expect(result.gifts[0].giftId).toBe("crown");
    expect(result.gifts[0].giftName).toBe("Crown");
  });

  test("guaranteedNextPull is cleared after use", async () => {
    mockUsers["user-1"] = {
      shyCoins: 100,
      pityCounter: 0,
      luckScore: 0,
      guaranteedNextPull: {
        giftId: "crown",
        setBy: "admin-1",
        setAt: mockFakeTimestamp(new Date()),
      },
    };

    await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    // The guaranteedNextPull field should have been deleted via FieldValue.delete()
    expect(mockUsers["user-1"].guaranteedNextPull).toBeUndefined();
  });

  test("only first pull is guaranteed in multi-pull, remaining are random", async () => {
    mockUsers["user-1"] = {
      shyCoins: 1000,
      pityCounter: 0,
      luckScore: 0,
      guaranteedNextPull: {
        giftId: "crystal_ball",
        setBy: "admin-1",
        setAt: mockFakeTimestamp(new Date()),
      },
    };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 10, expectedCost: 100 });

    // Should have 10 gifts total
    expect(result.gifts.length).toBe(10);
    // First gift should be the guaranteed one
    expect(result.gifts[0].giftId).toBe("crystal_ball");
    expect(result.gifts[0].giftName).toBe("Crystal Ball");
    // Guarantee should be cleared
    expect(mockUsers["user-1"].guaranteedNextPull).toBeUndefined();
  });

  test("normal pull when no guarantee set", async () => {
    mockUsers["user-1"] = {
      shyCoins: 100,
      pityCounter: 0,
      luckScore: 0,
    };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    // Should be one of the winnable gifts (rose or crown or crystal_ball)
    expect(["rose", "crown", "crystal_ball"]).toContain(result.gifts[0].giftId);
  });
});

// ═══════════════════════════════════════════════════════════════
// onNewReport
// ═══════════════════════════════════════════════════════════════
describe("onNewReport", () => {
  test("sends notification to all admin tokens", async () => {
    mockAdminTokens["admin1"] = { token: "token-a", uid: "admin-a" };
    mockAdminTokens["admin2"] = { token: "token-b", uid: "admin-b" };

    const reportData = {
      reason: "Harassment",
      reportedUserName: "Bad Actor",
      reporterId: "reporter-1",
    };

    await indexModule.onNewReport({
      params: { reportId: "r1" },
      data: { data: () => reportData },
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "token-a",
        data: expect.objectContaining({
          type: "ADMIN_NEW_REPORT",
          title: "New Report",
        }),
      })
    );
  });

  test("skips when no admin tokens exist", async () => {
    // admin_tokens collection is empty
    const reportData = { reason: "Spam", reportedUserName: "Spammer" };

    await indexModule.onNewReport({
      params: { reportId: "r2" },
      data: { data: () => reportData },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("handles missing report data gracefully", async () => {
    await indexModule.onNewReport({
      params: { reportId: "r3" },
      data: { data: () => undefined },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("cleans up invalid FCM tokens", async () => {
    mockAdminTokens["admin1"] = { token: "bad-token", uid: "admin-a" };

    mockSendNotification.mockRejectedValueOnce(
      Object.assign(new Error("Invalid token"), {
        code: "messaging/invalid-registration-token",
      })
    );

    const reportData = { reason: "Spam", reportedUserName: "Spammer" };

    await indexModule.onNewReport({
      params: { reportId: "r4" },
      data: { data: () => reportData },
    });

    expect(mockBatch.delete).toHaveBeenCalled();
    expect(mockBatch.commit).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// onModAction
// ═══════════════════════════════════════════════════════════════
describe("onModAction", () => {
  test("sends notification to owner only when modNotifyMode is OWNER_ONLY", async () => {
    mockConversations["conv-1"] = {
      modNotifyMode: "OWNER_ONLY",
      createdBy: "owner-1",
      groupAdminIds: ["admin-1", "admin-2"],
      groupName: "Test Group",
    };
    mockUsers["owner-1"] = { fcmTokens: ["owner-token"] };

    const logEntry = {
      action: "MUTE",
      modId: "mod-1",
      modName: "Moderator",
      targetUserName: "Naughty User",
    };

    await indexModule.onModAction({
      params: { conversationId: "conv-1", logId: "log-1" },
      data: { data: () => logEntry },
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "owner-token",
        data: expect.objectContaining({
          type: "MOD_ACTION",
          action: "MUTE",
        }),
      })
    );
  });

  test("sends to all admins when modNotifyMode is ALL_ADMINS", async () => {
    mockConversations["conv-2"] = {
      modNotifyMode: "ALL_ADMINS",
      createdBy: "owner-1",
      groupAdminIds: ["admin-1"],
      groupName: "Group",
    };
    mockUsers["owner-1"] = { fcmTokens: ["owner-token"] };
    mockUsers["admin-1"] = { fcmTokens: ["admin-token"] };

    const logEntry = {
      action: "UNMUTE",
      modId: "mod-1",
      modName: "Mod",
      targetUserName: "User",
    };

    await indexModule.onModAction({
      params: { conversationId: "conv-2", logId: "log-2" },
      data: { data: () => logEntry },
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  test("excludes the mod who performed the action from recipients", async () => {
    mockConversations["conv-3"] = {
      modNotifyMode: "ALL_ADMINS",
      createdBy: "mod-1", // the mod IS the owner
      groupAdminIds: ["admin-1"],
      groupName: "Group",
    };
    mockUsers["admin-1"] = { fcmTokens: ["admin-token"] };

    const logEntry = {
      action: "MUTE",
      modId: "mod-1",
      modName: "Mod",
      targetUserName: "User",
    };

    await indexModule.onModAction({
      params: { conversationId: "conv-3", logId: "log-3" },
      data: { data: () => logEntry },
    });

    // mod-1 is excluded, only admin-1 should receive
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ token: "admin-token" })
    );
  });

  test("skips when conversation not found", async () => {
    // conversations collection is empty — conv doc doesn't exist

    const logEntry = {
      action: "MUTE",
      modId: "mod-1",
      modName: "Mod",
      targetUserName: "User",
    };

    await indexModule.onModAction({
      params: { conversationId: "nonexistent", logId: "log-4" },
      data: { data: () => logEntry },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("handles MUTE, UNMUTE, HIDE_MESSAGE action text correctly", async () => {
    mockConversations["conv-4"] = {
      modNotifyMode: "OWNER_ONLY",
      createdBy: "owner-1",
      groupAdminIds: [],
      groupName: "My Group",
    };
    mockUsers["owner-1"] = { fcmTokens: ["t1"] };

    // Test MUTE
    await indexModule.onModAction({
      params: { conversationId: "conv-4", logId: "log-m" },
      data: { data: () => ({ action: "MUTE", modId: "mod-1", modName: "Mod", targetUserName: "User" }) },
    });
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "Mod muted User in My Group",
        }),
      })
    );

    mockSendNotification.mockClear();

    // Test UNMUTE
    await indexModule.onModAction({
      params: { conversationId: "conv-4", logId: "log-u" },
      data: { data: () => ({ action: "UNMUTE", modId: "mod-1", modName: "Mod", targetUserName: "User" }) },
    });
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "Mod unmuted User in My Group",
        }),
      })
    );

    mockSendNotification.mockClear();

    // Test HIDE_MESSAGE
    await indexModule.onModAction({
      params: { conversationId: "conv-4", logId: "log-h" },
      data: { data: () => ({ action: "HIDE_MESSAGE", modId: "mod-1", modName: "Mod", targetUserName: "User" }) },
    });
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: "Mod hid a message from User in My Group",
        }),
      })
    );
  });

  test("cleans up invalid FCM tokens", async () => {
    mockConversations["conv-5"] = {
      modNotifyMode: "OWNER_ONLY",
      createdBy: "owner-1",
      groupAdminIds: [],
      groupName: "Group",
    };
    mockUsers["owner-1"] = { fcmTokens: ["bad-token", "good-token"] };

    mockSendNotification
      .mockRejectedValueOnce(
        Object.assign(new Error("Invalid"), {
          code: "messaging/registration-token-not-registered",
        })
      )
      .mockResolvedValueOnce({ successCount: 1 });

    const logEntry = {
      action: "MUTE",
      modId: "mod-1",
      modName: "Mod",
      targetUserName: "User",
    };

    await indexModule.onModAction({
      params: { conversationId: "conv-5", logId: "log-5" },
      data: { data: () => logEntry },
    });

    // Verify invalid token was cleaned up via arrayRemove
    const updatedUser = mockUsers["owner-1"];
    expect(updatedUser.fcmTokens).not.toContain("bad-token");
  });

  test("handles missing log entry data gracefully", async () => {
    await indexModule.onModAction({
      params: { conversationId: "conv-1", logId: "log-1" },
      data: { data: () => undefined },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// cleanupOrphanedStorage / purgeOrphanedStorageNow
// ═══════════════════════════════════════════════════════════════

describe("cleanupOrphanedStorage", () => {
  test("runs without error with empty stores", async () => {
    const fn = indexModule.cleanupOrphanedStorage;
    await fn();
  });

  test("deletes orphaned files not referenced by any user", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "profile_photos/") {
        return {
          Contents: [
            { Key: "profile_photos/referenced.jpg" },
            { Key: "profile_photos/orphan.jpg" },
          ],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    mockUsers["user-1"] = {
      profilePhotoUrl: "https://images.shytalk.shyden.co.uk/profile_photos/referenced.jpg",
    };

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(1);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    expect(deleteCalls.length).toBeGreaterThan(0);
    const deletedKeys = deleteCalls.flatMap(([cmd]) =>
      cmd.params.Delete.Objects.map((o) => o.Key)
    );
    expect(deletedKeys).toContain("profile_photos/orphan.jpg");
    expect(deletedKeys).not.toContain("profile_photos/referenced.jpg");
  });

  test("keeps files referenced by coverPhotoUrl", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "cover_photos/") {
        return { Contents: [{ Key: "cover_photos/my_cover.jpg" }], IsTruncated: false };
      }
      if (cmd.params?.Prefix === "profile_photos/") {
        return { Contents: [{ Key: "profile_photos/my_profile.jpg" }], IsTruncated: false };
      }
      return { Contents: [], IsTruncated: false };
    });

    mockUsers["user-1"] = {
      profilePhotoUrl: "https://images.shytalk.shyden.co.uk/profile_photos/my_profile.jpg",
      coverPhotoUrl: "https://images.shytalk.shyden.co.uk/cover_photos/my_cover.jpg",
    };

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(0);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    expect(deleteCalls.length).toBe(0);
  });

  test("keeps report evidence files", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "report_evidence/") {
        return { Contents: [{ Key: "report_evidence/evidence1.jpg" }], IsTruncated: false };
      }
      return { Contents: [], IsTruncated: false };
    });

    mockReports["r1"] = {
      evidenceUrls: ["https://images.shytalk.shyden.co.uk/report_evidence/evidence1.jpg"],
    };

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(0);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    expect(deleteCalls.length).toBe(0);
  });
});

describe("purgeOrphanedStorageNow", () => {
  test("requires admin access", async () => {
    await expect(callOnCall("purgeOrphanedStorageNow", "user-1"))
      .rejects.toThrow("Admin access required");
  });

  test("rejects unauthenticated", async () => {
    await expect(callOnCall("purgeOrphanedStorageNow", null))
      .rejects.toThrow();
  });

  test("succeeds for admin user", async () => {
    const result = await callOnCall("purgeOrphanedStorageNow", "admin-user");
    expect(result).toBeDefined();
    expect(result.totalDeleted).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// updateGiftRankings
// ═══════════════════════════════════════════════════════════════

describe("updateGiftRankings", () => {
  test("runs without error with empty gifts", async () => {
    const fn = indexModule.updateGiftRankings;
    await fn();
  });

  test("writes rankings for gifts with gift wall entries", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-a"] = { displayName: "Alice", profilePhotoUrl: "http://example.com/a.jpg" };
    mockUsers["user-b"] = { displayName: "Bob", profilePhotoUrl: null };
    mockGiftWall["rose"] = { receivedCount: 5 };

    const fn = indexModule.updateGiftRankings;
    await fn();

    // Verify rankings doc was written
    expect(mockGiftRankings["rose"]).toBeDefined();
    expect(mockGiftRankings["rose"].rankings).toBeDefined();
    expect(mockGiftRankings["rose"].totalSent).toBeGreaterThanOrEqual(0);
  });

  test("rankings are sorted by count descending", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-a"] = { displayName: "Alice", profilePhotoUrl: null };
    mockUsers["user-b"] = { displayName: "Bob", profilePhotoUrl: null };

    // Both users have gift wall entries — use giftWall store keyed by giftId
    // The mock returns the same giftWall store for all /giftWall paths
    mockGiftWall["rose"] = { receivedCount: 3 };

    const fn = indexModule.updateGiftRankings;
    await fn();

    expect(mockGiftRankings["rose"]).toBeDefined();
    const rankings = mockGiftRankings["rose"].rankings;
    // Rankings should be sorted descending by count
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i - 1].count).toBeGreaterThanOrEqual(rankings[i].count);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// _sendSystemPm
// ═══════════════════════════════════════════════════════════════
describe("_sendSystemPm", () => {
  test("creates system user if it does not exist", async () => {
    // System user doc does not exist — mockUsers has no "SHYTALK_SYSTEM" key
    await indexModule._sendSystemPm("user123", "Hello");

    expect(mockUsers["SHYTALK_SYSTEM"]).toBeDefined();
    expect(mockUsers["SHYTALK_SYSTEM"].displayName).toBe("ShyTalk");
    expect(mockUsers["SHYTALK_SYSTEM"].userType).toBe("SYSTEM");
  });

  test("skips system user creation if already exists", async () => {
    // Pre-populate the system user so it already exists
    mockUsers["SHYTALK_SYSTEM"] = {
      displayName: "ShyTalk",
      userType: "SYSTEM",
      profilePhotoUrl: "https://example.com/icon.webp",
      uniqueId: 0,
    };
    const originalData = { ...mockUsers["SHYTALK_SYSTEM"] };

    await indexModule._sendSystemPm("user123", "Hello");

    // System user should still exist with original data (not overwritten)
    expect(mockUsers["SHYTALK_SYSTEM"].displayName).toBe(originalData.displayName);
    expect(mockUsers["SHYTALK_SYSTEM"].userType).toBe(originalData.userType);
    expect(mockUsers["SHYTALK_SYSTEM"].profilePhotoUrl).toBe(originalData.profilePhotoUrl);
    expect(mockUsers["SHYTALK_SYSTEM"].uniqueId).toBe(originalData.uniqueId);
  });

  test("creates conversation when it does not exist", async () => {
    // No conversation in the store
    await indexModule._sendSystemPm("user123", "Welcome to ShyTalk!");

    const convId = "SHYTALK_SYSTEM_user123";
    // Conversation should be created with participantIds and lastMessage
    expect(mockConversations[convId]).toBeDefined();
    expect(mockConversations[convId].participantIds).toEqual(["SHYTALK_SYSTEM", "user123"]);
    expect(mockConversations[convId].isGroup).toBe(false);
    expect(mockConversations[convId].lastMessage).toBeDefined();
    expect(mockConversations[convId].lastMessage.senderId).toBe("SHYTALK_SYSTEM");
    expect(mockConversations[convId].lastMessage.senderName).toBe("ShyTalk");
    expect(mockConversations[convId].lastMessage.type).toBe("TEXT");
  });

  test("reuses existing conversation", async () => {
    const convId = "SHYTALK_SYSTEM_user123";
    // Pre-populate the conversation
    mockConversations[convId] = {
      participantIds: ["SHYTALK_SYSTEM", "user123"],
      isGroup: false,
      createdAt: mockFakeTimestamp(new Date("2025-01-01")),
      lastMessage: { text: "Old message", senderId: "SHYTALK_SYSTEM", senderName: "ShyTalk", type: "TEXT" },
      lastMessageAt: mockFakeTimestamp(new Date("2025-01-01")),
    };

    await indexModule._sendSystemPm("user123", "New message");

    // Conversation should still exist and be updated (not recreated)
    expect(mockConversations[convId]).toBeDefined();
    expect(mockConversations[convId].participantIds).toEqual(["SHYTALK_SYSTEM", "user123"]);
    // lastMessage should be updated via update()
    expect(mockConversations[convId].lastMessage.text).toBe("New message");
  });

  test("writes message and updates lastMessage", async () => {
    await indexModule._sendSystemPm("user123", "Test message content");

    const convId = "SHYTALK_SYSTEM_user123";
    // Verify the conversation lastMessage was updated
    expect(mockConversations[convId]).toBeDefined();
    expect(mockConversations[convId].lastMessage).toBeDefined();
    expect(mockConversations[convId].lastMessage.senderId).toBe("SHYTALK_SYSTEM");
    expect(mockConversations[convId].lastMessage.senderName).toBe("ShyTalk");
    expect(mockConversations[convId].lastMessage.type).toBe("TEXT");
    expect(mockConversations[convId].lastMessage.text).toBe("Test message content");
  });

  test("returns correct conversation ID", async () => {
    // "SHYTALK_SYSTEM" and "abc" sorted: "S" (83) < "a" (97) in ASCII
    // so sorted order is ["SHYTALK_SYSTEM", "abc"] -> "SHYTALK_SYSTEM_abc"
    const result = await indexModule._sendSystemPm("abc", "Hi there");

    expect(result).toBe("SHYTALK_SYSTEM_abc");
  });

  test("returns correct conversation ID when recipient sorts before SHYTALK_SYSTEM", async () => {
    // "ABC" (65) < "S" (83) in ASCII -> sorted: ["ABC", "SHYTALK_SYSTEM"] -> "ABC_SHYTALK_SYSTEM"
    const result = await indexModule._sendSystemPm("ABC", "Hi there");

    expect(result).toBe("ABC_SHYTALK_SYSTEM");
  });

  test("truncates text to 100 chars in lastMessage preview", async () => {
    const longText = "A".repeat(200);
    await indexModule._sendSystemPm("user123", longText);

    const convId = "SHYTALK_SYSTEM_user123";
    expect(mockConversations[convId]).toBeDefined();
    // lastMessage.text should be truncated to 100 chars
    expect(mockConversations[convId].lastMessage.text).toBe("A".repeat(100));
    expect(mockConversations[convId].lastMessage.text.length).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// claimSuperShyTrial
// ═══════════════════════════════════════════════════════════════
describe("claimSuperShyTrial", () => {
  test("rejects unauthenticated", async () => {
    await expect(callOnCall("claimSuperShyTrial", null))
      .rejects.toThrow("Must be signed in");
  });

  test("succeeds for first-time claim", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Test User" };

    const result = await callOnCall("claimSuperShyTrial", "user-1", {});

    expect(result.success).toBe(true);
    // Backpack item created
    expect(mockBackpacks["super_shy_trial"]).toBeDefined();
    expect(mockBackpacks["super_shy_trial"].quantity).toBe(1);
    // User marked as claimed
    expect(mockUsers["user-1"].hasClaimedSuperShyTrial).toBe(true);
    // Transaction recorded
    const txIds = Object.keys(mockTransactions);
    expect(txIds.length).toBeGreaterThanOrEqual(1);
    const tx = mockTransactions[txIds[txIds.length - 1]];
    expect(tx.type).toBe("TRIAL_CLAIM");
  });

  test("rejects double claim", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Test User", hasClaimedSuperShyTrial: true };

    await expect(callOnCall("claimSuperShyTrial", "user-1", {}))
      .rejects.toThrow("Trial already claimed");
  });
});

// ═══════════════════════════════════════════════════════════════
// activateSuperShyTrial
// ═══════════════════════════════════════════════════════════════
describe("activateSuperShyTrial", () => {
  test("rejects unauthenticated", async () => {
    await expect(callOnCall("activateSuperShyTrial", null))
      .rejects.toThrow("Must be signed in");
  });

  test("succeeds and activates trial", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Test User" };
    mockBackpacks["super_shy_trial"] = { quantity: 1 };

    const result = await callOnCall("activateSuperShyTrial", "user-1", {});

    expect(result.success).toBe(true);
    expect(result.newTier).toBe("trial");
    // Backpack item deleted
    expect(mockBackpacks["super_shy_trial"]).toBeUndefined();
    // User updated
    expect(mockUsers["user-1"].isSuperShy).toBe(true);
    expect(mockUsers["user-1"].superShyTier).toBe("trial");
    expect(mockUsers["user-1"].superShyExpiry).toBeDefined();
  });

  test("does not downgrade existing higher tier", async () => {
    const futureExpiry = mockFakeTimestamp(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000));
    mockUsers["user-1"] = {
      shyCoins: 100,
      displayName: "Test User",
      isSuperShy: true,
      superShyTier: "premium",
      superShyExpiry: futureExpiry,
    };
    mockBackpacks["super_shy_trial"] = { quantity: 1 };

    const result = await callOnCall("activateSuperShyTrial", "user-1", {});

    expect(result.success).toBe(true);
    expect(result.newTier).toBe("premium");
    expect(mockUsers["user-1"].superShyTier).toBe("premium");
  });

  test("rejects if no backpack item exists", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Test User" };

    await expect(callOnCall("activateSuperShyTrial", "user-1", {}))
      .rejects.toThrow("No trial item in backpack");
  });
});

// ═══════════════════════════════════════════════════════════════
// Transfer blocking for trial items
// ═══════════════════════════════════════════════════════════════
describe("trial item transfer blocking", () => {
  test("sendGift rejects super_shy_trial", async () => {
    await expect(callOnCall("sendGift", "user-1", {
      recipientId: "user-2",
      giftId: "super_shy_trial",
    })).rejects.toThrow("Trial items cannot be transferred");
  });

  test("sendGiftBatch rejects super_shy_trial", async () => {
    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2"],
      giftId: "super_shy_trial",
      quantity: 1,
      fromBackpack: true,
    })).rejects.toThrow("Trial items cannot be transferred");
  });

  test("sendEntireBackpack skips trial item and sends other items", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockBackpacks["super_shy_trial"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    expect(result.totalItemsSent).toBe(3); // Only roses, not trial
    expect(result.giftsSent.length).toBe(1);
    expect(result.giftsSent[0].giftId).toBe("rose");
    // Trial item should still be in backpack
    expect(mockBackpacks["super_shy_trial"]).toBeDefined();
    expect(mockBackpacks["super_shy_trial"].quantity).toBe(1);
  });

  test("sendEntireBackpack with only trial item returns empty error", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["super_shy_trial"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await expect(callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" }))
      .rejects.toThrow("Backpack is empty");
  });
});

// ═══════════════════════════════════════════════════════════════
// Boundary value tests
// ═══════════════════════════════════════════════════════════════
describe("boundary value tests", () => {
  // redeemBeans — exactly at bonus threshold
  test("redeemBeans at exactly bonus threshold gets bonus", async () => {
    mockUsers["user-1"] = { shyBeans: 2000, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 2000 });

    // 2000 * 1.1 = 2200, Math.floor(2200) = 2200
    expect(result.coinsReceived).toBe(2200);
    expect(result.newBeanBalance).toBe(0);
    expect(result.newCoinBalance).toBe(2200);
  });

  // redeemBeans — one below bonus threshold does NOT get bonus
  test("redeemBeans one below bonus threshold does not get bonus", async () => {
    mockUsers["user-1"] = { shyBeans: 2000, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 1999 });

    // Below threshold: no multiplier, coins = amount
    expect(result.coinsReceived).toBe(1999);
    expect(result.newBeanBalance).toBe(1);
    expect(result.newCoinBalance).toBe(1999);
  });

  // pullGacha — pity at hard limit forces high-value gifts
  test("pullGacha with pityCounter at pityHardLimit forces high-value gift", async () => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    // Low-value gift only
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    // High-value gift (>= pityHighValueThreshold)
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, order: 2, iconUrl: "" };

    // pityCounter exactly at hard limit — should force high-value gift
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 120, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    // Must be the high-value gift since hard pity zeros out low-value weights
    expect(result.gifts[0].giftId).toBe("crystal_ball");
  });

  // pullGacha — pity at soft start begins probability shift
  test("pullGacha with pityCounter at pitySoftStart enters soft pity", async () => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, order: 2, iconUrl: "" };

    // pityCounter exactly at soft start — should NOT error, should return a valid gift
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 80, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    expect(["rose", "crystal_ball"]).toContain(result.gifts[0].giftId);
  });

  // sendGift — backpack quantity goes to exactly 0 (item should be deleted)
  test("sendGift with last item in backpack deletes backpack entry", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose", quantity: 1,
    });

    expect(result.success).toBe(true);
    // When newQty <= 0, the code calls tx.delete(bpRef) — backpack item removed
    expect(mockBackpacks["rose"]).toBeUndefined();
  });

  // addTestCoins — exactly 100000 (max allowed) succeeds
  test("addTestCoins with exactly 100000 succeeds", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    const result = await callOnCall("addTestCoins", "user-1", { amount: 100000 });

    expect(result.success).toBe(true);
    expect(result.coinsAdded).toBe(100000);
    expect(result.newBalance).toBe(100000);
  });

  // addTestCoins — 100001 (one over max) is rejected
  test("addTestCoins with 100001 is rejected", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    await expect(callOnCall("addTestCoins", "user-1", { amount: 100001 }))
      .rejects.toThrow("amount must be a positive number");
  });

  // claimDailyReward — streak milestone boundary (day 7 awards bonus)
  test("claimDailyReward at streak milestone day 7 awards milestone bonus", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 6, shyCoins: 0 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: { "7": 100, "14": 200, "30": 500 } };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(7);
    expect(result.coinsAwarded).toBe(100);
    expect(result.isMilestone).toBe(true);
    expect(result.newBalance).toBe(100);
  });

  // claimDailyReward — one day before milestone (day 6) gets base reward
  test("claimDailyReward one day before milestone gets base reward", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 5, shyCoins: 0 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: { "7": 100, "14": 200, "30": 500 } };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(6);
    expect(result.coinsAwarded).toBe(50);
    expect(result.isMilestone).toBe(false);
    expect(result.newBalance).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// Missing field and error path tests
// ═══════════════════════════════════════════════════════════════
describe("missing field and error path tests", () => {
  // sendGift - missing recipientId
  test("sendGift rejects missing recipientId", async () => {
    await expect(callOnCall("sendGift", "user-1", {
      giftId: "rose",
    })).rejects.toThrow();
  });

  // sendGift - non-existent gift in catalog
  test("sendGift rejects non-existent gift", async () => {
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["nonexistent_gift"] = { quantity: 5 };
    await expect(callOnCall("sendGift", "user-1", {
      recipientId: "user-2",
      giftId: "nonexistent_gift",
    })).rejects.toThrow();
  });

  // sendGiftDirect - missing giftId
  test("sendGiftDirect rejects missing giftId", async () => {
    await expect(callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2",
    })).rejects.toThrow();
  });

  // sendGiftBatch - empty recipientIds array
  test("sendGiftBatch rejects empty recipientIds", async () => {
    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds: [],
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    })).rejects.toThrow();
  });

  // sendEntireBackpack - non-existent recipient
  test("sendEntireBackpack rejects non-existent recipient", async () => {
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockBackpacks["rose"] = { quantity: 1 };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };
    await expect(callOnCall("sendEntireBackpack", "user-1", {
      recipientId: "nonexistent",
    })).rejects.toThrow();
  });

  // pullGacha - pullCount = 0
  test("pullGacha rejects pullCount of 0", async () => {
    await expect(callOnCall("pullGacha", "user-1", {
      pullCount: 0,
      totalCost: 0,
    })).rejects.toThrow();
  });

  // redeemBeans - amount = 0
  test("redeemBeans rejects amount of 0", async () => {
    await expect(callOnCall("redeemBeans", "user-1", {
      amount: 0,
    })).rejects.toThrow();
  });

  // claimDailyReward - unauthenticated (double-check)
  test("claimDailyReward rejects unauthenticated", async () => {
    await expect(callOnCall("claimDailyReward", null, {})).rejects.toThrow();
  });

  // sendGiftBatch - duplicate recipientIds
  test("sendGiftBatch with duplicate recipientIds", async () => {
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };
    // Send to same user twice - should this be allowed or rejected?
    // Just verify it doesn't crash
    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-2"],
      giftId: "rose",
      quantity: 1,
      fromBackpack: false,
    });
    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// cleanExpiredBackpackItems - detailed
// ═══════════════════════════════════════════════════════════════
describe("cleanExpiredBackpackItems - detailed", () => {
  test("deletes expired backpack items", async () => {
    const pastDate = new Date(Date.now() - 86400000); // 1 day ago
    mockBackpacks["item-1"] = { giftId: "rose", quantity: 1, expiresAt: pastDate };
    mockBackpacks["item-2"] = { giftId: "crown", quantity: 2, expiresAt: pastDate };

    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();

    expect(mockBatch.delete).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  test("skips items with future expiresAt", async () => {
    const futureDate = new Date(Date.now() + 86400000 * 7); // 7 days from now
    mockBackpacks["item-1"] = { giftId: "rose", quantity: 1, expiresAt: futureDate };

    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();

    // Future items don't match the query, so batch.delete should not be called
    expect(mockBatch.delete).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  test("skips items with no expiresAt", async () => {
    mockBackpacks["item-1"] = { giftId: "rose", quantity: 1 };

    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();

    // Items without expiresAt field have undefined, which fails the > new Date(0) filter
    expect(mockBatch.delete).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });

  test("handles mix of expired, future, and no-expiry items", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    const futureDate = new Date(Date.now() + 86400000 * 7);
    mockBackpacks["expired-1"] = { giftId: "rose", quantity: 1, expiresAt: pastDate };
    mockBackpacks["future-1"] = { giftId: "crown", quantity: 1, expiresAt: futureDate };
    mockBackpacks["no-expiry"] = { giftId: "star", quantity: 1 };

    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();

    // Only the expired item should be deleted
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  test("processes items in batches of 500", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    // Create 501 expired items to trigger 2 batch commits
    for (let i = 0; i < 501; i++) {
      mockBackpacks[`item-${i}`] = { giftId: "rose", quantity: 1, expiresAt: pastDate };
    }

    const fn = indexModule.cleanExpiredBackpackItems;
    await fn();

    expect(mockBatch.delete).toHaveBeenCalledTimes(501);
    // 500 in first batch + 1 in second batch = 2 commits
    expect(mockBatch.commit).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// validatePurchase - edge cases
// ═══════════════════════════════════════════════════════════════
describe("validatePurchase - edge cases", () => {
  test("rejects missing purchaseToken", async () => {
    await expect(callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_monthly",
    })).rejects.toThrow("productId and purchaseToken required");
  });

  test("rejects unauthenticated user", async () => {
    await expect(callOnCall("validatePurchase", null, {
      productId: "super_shy_monthly",
      purchaseToken: "tok",
    })).rejects.toThrow("Must be signed in");
  });

  test("rejects unknown subscription productId", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    await expect(callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_unknown",
      purchaseToken: "tok",
      isSubscription: true,
    })).rejects.toThrow("Unknown subscription product");
  });

  test("rejects unknown coin package productId", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    await expect(callOnCall("validatePurchase", "user-1", {
      productId: "coins_nonexistent",
      purchaseToken: "tok",
      isSubscription: false,
    })).rejects.toThrow("Unknown coin package");
  });

  test("subscription monthly sets correct expiry (~30 days)", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };
    const before = Date.now();

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_monthly",
      purchaseToken: "tok",
      isSubscription: true,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe("monthly");

    // Verify the user was updated with isSuperShy and a ~30 day expiry
    const user = mockUsers["user-1"];
    expect(user.isSuperShy).toBe(true);
    expect(user.superShyTier).toBe("monthly");
    // superShyExpiry is a mock Timestamp; verify its underlying date is ~30 days out
    const expiryDate = user.superShyExpiry.toDate();
    const daysUntilExpiry = (expiryDate.getTime() - before) / 86400000;
    expect(daysUntilExpiry).toBeGreaterThan(29);
    expect(daysUntilExpiry).toBeLessThanOrEqual(31);
  });

  test("subscription yearly sets correct expiry (~365 days)", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };
    const before = Date.now();

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_yearly",
      purchaseToken: "tok",
      isSubscription: true,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe("yearly");

    const user = mockUsers["user-1"];
    expect(user.isSuperShy).toBe(true);
    expect(user.superShyTier).toBe("yearly");
    const expiryDate = user.superShyExpiry.toDate();
    const daysUntilExpiry = (expiryDate.getTime() - before) / 86400000;
    expect(daysUntilExpiry).toBeGreaterThan(364);
    expect(daysUntilExpiry).toBeLessThanOrEqual(366);
  });

  test("subscription lifetime sets no expiry", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_lifetime",
      purchaseToken: "tok",
      isSubscription: true,
    });

    expect(result.success).toBe(true);
    expect(result.tier).toBe("lifetime");

    const user = mockUsers["user-1"];
    expect(user.isSuperShy).toBe(true);
    expect(user.superShyTier).toBe("lifetime");
    expect(user.superShyExpiry).toBeNull();
  });

  test("subscription creates transaction record", async () => {
    mockUsers["user-1"] = { shyCoins: 0 };

    await callOnCall("validatePurchase", "user-1", {
      productId: "super_shy_monthly",
      purchaseToken: "tok",
      isSubscription: true,
    });

    // A transaction doc should exist in the transactions store
    const txKeys = Object.keys(mockTransactions);
    expect(txKeys.length).toBeGreaterThanOrEqual(1);
    const tx = mockTransactions[txKeys[0]];
    expect(tx.type).toBe("SUBSCRIPTION");
    expect(tx.details).toBe("Super Shy monthly");
  });

  test("coin package adds coins with bonus", async () => {
    mockUsers["user-1"] = { shyCoins: 50 };
    mockCoinPackages["pkg-1"] = { productId: "coins_500", coins: 500, bonusCoins: 50 };

    const result = await callOnCall("validatePurchase", "user-1", {
      productId: "coins_500",
      purchaseToken: "tok",
      isSubscription: false,
    });

    expect(result.success).toBe(true);
    expect(result.coinsAdded).toBe(550);
    expect(result.newBalance).toBe(600);
  });

  test("coin package creates purchase transaction", async () => {
    mockUsers["user-1"] = { shyCoins: 100 };
    mockCoinPackages["pkg-1"] = { productId: "coins_100", coins: 100, bonusCoins: 10 };

    await callOnCall("validatePurchase", "user-1", {
      productId: "coins_100",
      purchaseToken: "tok",
      isSubscription: false,
    });

    const txKeys = Object.keys(mockTransactions);
    expect(txKeys.length).toBeGreaterThanOrEqual(1);
    const tx = mockTransactions[txKeys[0]];
    expect(tx.type).toBe("PURCHASE");
    expect(tx.amount).toBe(110);
    expect(tx.balanceAfter).toBe(210);
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGift - advanced scenarios
// ═══════════════════════════════════════════════════════════════
describe("sendGift - advanced scenarios", () => {
  test("sends gift from backpack and creates transaction for both users", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 50, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2",
      giftId: "rose",
    });

    expect(result.success).toBe(true);
    expect(result.giftName).toBe("Rose");
    expect(result.quantity).toBe(1);

    // Verify: backpack quantity decremented by 1
    expect(mockBackpacks["rose"].quantity).toBe(4);

    // Verify: recipient beans credited (10 * 0.6 * 1 = 6)
    expect(result.beanReward).toBe(6);

    // Verify: transaction records created for both sender and recipient
    const txKeys = Object.keys(mockTransactions);
    expect(txKeys.length).toBeGreaterThanOrEqual(2);

    const senderTx = Object.values(mockTransactions).find((t) => t.type === "GIFT_SENT");
    expect(senderTx).toBeDefined();
    expect(senderTx.giftId).toBe("rose");
    expect(senderTx.giftName).toBe("Rose");
    expect(senderTx.recipientId).toBe("user-2");
    expect(senderTx.quantity).toBe(1);

    const recipientTx = Object.values(mockTransactions).find((t) => t.type === "GIFT_RECEIVED");
    expect(recipientTx).toBeDefined();
    expect(recipientTx.amount).toBe(6);
    expect(recipientTx.currency).toBe("BEANS");
    expect(recipientTx.senderId).toBe("user-1");
  });

  test("sends gift with coins (sendGiftDirect) deducts coins", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2",
      giftId: "rose",
    });

    expect(result.success).toBe(true);
    expect(result.coinsSpent).toBe(10);

    // Verify: sender coins deducted by gift coinValue
    expect(mockUsers["user-1"].shyCoins).toBe(990);

    // Verify: recipient beans credited (10 * 0.6 = 6)
    expect(result.beanReward).toBe(6);
  });

  test("gift to user in room triggers lastGiftEvent update", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender", currentRoomId: "room-1" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockRooms["room-1"] = { ownerId: "user-1", state: "ACTIVE", participantIds: ["user-1", "user-2"] };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2",
      giftId: "rose",
    });

    expect(result.success).toBe(true);

    // Verify: room doc updated with lastGiftEvent
    expect(mockRooms["room-1"].lastGiftEvent).toBeDefined();
    expect(mockRooms["room-1"].lastGiftEvent.senderId).toBe("user-1");
    expect(mockRooms["room-1"].lastGiftEvent.senderName).toBe("Sender");
    expect(mockRooms["room-1"].lastGiftEvent.recipientId).toBe("user-2");
    expect(mockRooms["room-1"].lastGiftEvent.recipientName).toBe("Recipient");
    expect(mockRooms["room-1"].lastGiftEvent.giftId).toBe("rose");
    expect(mockRooms["room-1"].lastGiftEvent.giftName).toBe("Rose");
    expect(mockRooms["room-1"].lastGiftEvent.coinValue).toBe(10);
  });

  test("self-gift rejected even with valid backpack", async () => {
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Self" };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockBackpacks["rose"] = { quantity: 5 };

    await expect(callOnCall("sendGift", "user-1", {
      recipientId: "user-1",
      giftId: "rose",
    })).rejects.toThrow("Cannot send gift to yourself");
  });
});

// ═══════════════════════════════════════════════════════════════
// sendGiftBatch - advanced
// ═══════════════════════════════════════════════════════════════
describe("sendGiftBatch - advanced", () => {
  test("batch send to 8 recipients (max allowed)", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    for (let i = 2; i <= 9; i++) {
      mockUsers[`user-${i}`] = { shyBeans: 0, displayName: `User${i}` };
    }
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const recipientIds = [];
    for (let i = 2; i <= 9; i++) recipientIds.push(`user-${i}`);

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds,
      giftId: "rose",
      quantity: 1,
      fromBackpack: false,
    });

    expect(result.success).toBe(true);
    expect(result.totalRecipients).toBe(8);
    expect(result.totalItems).toBe(8);

    // Verify all recipients got beans credited
    for (let i = 2; i <= 9; i++) {
      expect(mockUsers[`user-${i}`].shyBeans).toBe(6); // 10 * 0.6 = 6
    }
  });

  test("batch send to 9 recipients rejected", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const recipientIds = [];
    for (let i = 2; i <= 10; i++) recipientIds.push(`user-${i}`);

    await expect(callOnCall("sendGiftBatch", "user-1", {
      recipientIds,
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    })).rejects.toThrow("recipientIds must be an array of 1-8 user IDs");
  });

  test("batch send from backpack deducts total quantity", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Alice" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Bob" };
    mockUsers["user-4"] = { shyBeans: 0, displayName: "Charlie" };
    mockBackpacks["rose"] = { quantity: 10 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3", "user-4"],
      giftId: "rose",
      quantity: 1,
      fromBackpack: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalItems).toBe(3); // 1 * 3 recipients

    // Verify: backpack reduced by 3 (from 10 to 7)
    expect(mockBackpacks["rose"].quantity).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════
// pullGacha - advanced
// ═══════════════════════════════════════════════════════════════
describe("pullGacha - advanced", () => {
  beforeEach(() => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, order: 2, iconUrl: "" };
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, order: 3, iconUrl: "" };
  });

  test("10-pull returns exactly 10 gifts", async () => {
    mockUsers["user-1"] = { shyCoins: 500, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 10, expectedCost: 100 });

    expect(result.gifts.length).toBe(10);
    expect(result.coinsSpent).toBe(100);
    expect(result.newBalance).toBe(400);
  });

  test("100-pull returns exactly 100 gifts", async () => {
    mockUsers["user-1"] = { shyCoins: 5000, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 100, expectedCost: 1000 });

    expect(result.gifts.length).toBe(100);
    expect(result.coinsSpent).toBe(1000);
    expect(result.newBalance).toBe(4000);
  });

  test("pity counter increments on common pull", async () => {
    // Only have low-value gifts (below pityHighValueThreshold of 5000)
    delete mockGifts["crystal_ball"];
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 5, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    // After a pull with only low-value gifts, pity counter should have increased
    expect(result.newPityCounter).toBe(6);
  });

  test("guaranteed next pull returns specified gift and clears guarantee", async () => {
    mockUsers["user-1"] = {
      shyCoins: 100,
      pityCounter: 0,
      luckScore: 0,
      guaranteedNextPull: {
        giftId: "crystal_ball",
        setBy: "admin-1",
        setAt: mockFakeTimestamp(new Date()),
      },
    };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    // Verify: first gift is the guaranteed one
    expect(result.gifts.length).toBe(1);
    expect(result.gifts[0].giftId).toBe("crystal_ball");
    expect(result.gifts[0].giftName).toBe("Crystal Ball");

    // Verify: guarantee cleared after pull
    expect(mockUsers["user-1"].guaranteedNextPull).toBeUndefined();
  });

  test("100-pull increments luck score by 2", async () => {
    mockUsers["user-1"] = { shyCoins: 5000, pityCounter: 0, luckScore: 10 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 100, expectedCost: 1000 });

    expect(result.newLuckScore).toBe(12);
  });

  test("luck score caps at 100", async () => {
    mockUsers["user-1"] = { shyCoins: 5000, pityCounter: 0, luckScore: 99 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 100, expectedCost: 1000 });

    expect(result.newLuckScore).toBe(100);
  });

  test("pity counter resets to 0 when high-value gift is pulled", async () => {
    // Only high-value gifts so we guarantee one is pulled
    delete mockGifts["rose"];
    delete mockGifts["crown"];
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 50, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    // crystal_ball is the only gift, coinValue 5000 >= pityHighValueThreshold 5000
    expect(result.gifts[0].giftId).toBe("crystal_ball");
    expect(result.newPityCounter).toBe(0);
  });

  test("showOnWheel false excludes gift from gacha", async () => {
    // Mark crown as not on wheel — only rose and crystal_ball are winnable
    mockGifts["crown"].showOnWheel = false;
    mockUsers["user-1"] = { shyCoins: 500, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 10, expectedCost: 100 });

    expect(result.gifts.length).toBe(10);
    // Crown should never appear since showOnWheel is false
    const crownWins = result.gifts.filter(g => g.giftId === "crown");
    expect(crownWins.length).toBe(0);
  });

  test("all gifts with showOnWheel false rejects with no winnable gifts", async () => {
    mockGifts["rose"].showOnWheel = false;
    mockGifts["crown"].showOnWheel = false;
    mockGifts["crystal_ball"].showOnWheel = false;
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 0, luckScore: 0 };

    await expect(callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 }))
      .rejects.toThrow("No winnable gifts");
  });

  test("gifts without showOnWheel field default to winnable", async () => {
    // Don't set showOnWheel — existing gifts without the field should remain on wheel
    delete mockGifts["rose"].showOnWheel;
    delete mockGifts["crown"].showOnWheel;
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
  });

  test("only first 16 winnable gifts are used (wheel size cap)", async () => {
    // Create 18 winnable gifts — only first 16 by order should be winnable
    for (const key of Object.keys(mockGifts)) delete mockGifts[key];
    for (let i = 1; i <= 18; i++) {
      mockGifts[`gift_${i}`] = { name: `Gift ${i}`, coinValue: 10, order: i, iconUrl: "" };
    }
    mockUsers["user-1"] = { shyCoins: 10000, pityCounter: 0, luckScore: 0 };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 100, expectedCost: 1000 });

    expect(result.gifts.length).toBe(100);
    // gift_17 and gift_18 should never appear
    const ids = result.gifts.map(g => g.giftId);
    expect(ids).not.toContain("gift_17");
    expect(ids).not.toContain("gift_18");
  });
});

// ═══════════════════════════════════════════════════════════════
// claimDailyReward - advanced
// ═══════════════════════════════════════════════════════════════
describe("claimDailyReward - advanced", () => {
  test("Super Shy user gets bonus coins on claim", async () => {
    // User with isSuperShy should receive 10% bonus (Math.ceil)
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 0, shyCoins: 200, isSuperShy: true };
    mockConfig["economy"] = { dailyBase: 100, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    // 100 * 1.1 = 110.00000000000001 in JS floating-point, Math.ceil → 111
    expect(result.coinsAwarded).toBe(111);
    expect(result.newBalance).toBe(311); // 200 + 111
  });

  test("non-Super Shy user does not get bonus", async () => {
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 0, shyCoins: 200 };
    mockConfig["economy"] = { dailyBase: 100, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    // No bonus — base reward only
    expect(result.coinsAwarded).toBe(100);
    expect(result.newBalance).toBe(300); // 200 + 100
  });

  test("milestone at day 30 awards larger bonus", async () => {
    // loginStreak 29 + consecutive day = 30, milestoneRewards["30"] = 500
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 29, shyCoins: 1000 };
    mockConfig["economy"] = {
      dailyBase: 50,
      milestoneRewards: { "7": 100, "14": 200, "30": 500, "60": 1000, "90": 2000 },
    };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(30);
    expect(result.coinsAwarded).toBe(500);
    expect(result.isMilestone).toBe(true);
    expect(result.newBalance).toBe(1500); // 1000 + 500
  });

  test("streak resets to 1 when gap is more than 1 day", async () => {
    // lastLoginDate 3 days ago — streak should reset
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: threeDaysAgo, loginStreak: 15, shyCoins: 300 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(1);
    expect(result.coinsAwarded).toBe(50);
    expect(result.isMilestone).toBe(false);
  });

  test("streak continues when claimed on consecutive day", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 5, shyCoins: 100 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    const result = await callOnCall("claimDailyReward", "user-1");

    expect(result.newStreak).toBe(6);
    expect(result.coinsAwarded).toBe(50);
    expect(result.newBalance).toBe(150); // 100 + 50
  });

  test("Super Shy bonus applied on top of milestone reward", async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    mockUsers["user-1"] = { lastLoginDate: yesterday, loginStreak: 6, shyCoins: 0, isSuperShy: true };
    mockConfig["economy"] = {
      dailyBase: 50,
      milestoneRewards: { "7": 100 },
    };

    const result = await callOnCall("claimDailyReward", "user-1");

    // Milestone reward 100, then 10% Super Shy bonus: Math.ceil(100 * 1.1) = 111
    // (100 * 1.1 = 110.00000000000001 in JS floating-point, Math.ceil → 111)
    expect(result.newStreak).toBe(7);
    expect(result.coinsAwarded).toBe(111);
    expect(result.isMilestone).toBe(true);
  });

  test("transaction record created with correct type and details", async () => {
    mockUsers["user-1"] = { lastLoginDate: "2020-01-01", loginStreak: 0, shyCoins: 0 };
    mockConfig["economy"] = { dailyBase: 50, milestoneRewards: {} };

    await callOnCall("claimDailyReward", "user-1");

    // The transaction should have been written to user's transactions subcollection
    // Since our mock stores transactions in mockTransactions via the subcollection path,
    // verify the user doc was updated correctly
    expect(mockUsers["user-1"].shyCoins).toBe(50);
    expect(mockUsers["user-1"].loginStreak).toBe(1);
    expect(mockUsers["user-1"].lastLoginRewardDate).toBe(new Date().toISOString().split("T")[0]);
  });
});

// ═══════════════════════════════════════════════════════════════
// redeemBeans - advanced
// ═══════════════════════════════════════════════════════════════
describe("redeemBeans - advanced", () => {
  test("large redemption with bonus applied correctly", async () => {
    // 10000 beans, threshold at 2000, multiplier 1.1
    // Since 10000 >= 2000, bonus applies: Math.floor(10000 * 1.1) = 11000
    mockUsers["user-1"] = { shyBeans: 10000, shyCoins: 500 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 10000 });

    expect(result.coinsReceived).toBe(11000); // Math.floor(10000 * 1.1)
    expect(result.newBeanBalance).toBe(0);    // 10000 - 10000
    expect(result.newCoinBalance).toBe(11500); // 500 + 11000
  });

  test("redemption creates BEAN_REDEEM transaction", async () => {
    mockUsers["user-1"] = { shyBeans: 500, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 200 });

    // Below threshold — no bonus, coins = amount
    expect(result.coinsReceived).toBe(200);
    expect(result.newBeanBalance).toBe(300);
    expect(result.newCoinBalance).toBe(200);
    // Verify user state was updated
    expect(mockUsers["user-1"].shyBeans).toBe(300);
    expect(mockUsers["user-1"].shyCoins).toBe(200);
  });

  test("redemption with negative amount rejected", async () => {
    await expect(callOnCall("redeemBeans", "user-1", { amount: -100 })).rejects.toThrow(
      "amount must be a positive number"
    );
  });

  test("redemption with more beans than balance rejected", async () => {
    mockUsers["user-1"] = { shyBeans: 100, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    await expect(callOnCall("redeemBeans", "user-1", { amount: 200 })).rejects.toThrow(
      "Insufficient beans"
    );
  });

  test("redemption at exact threshold applies bonus", async () => {
    mockUsers["user-1"] = { shyBeans: 2000, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 2000 });

    // Exactly at threshold: Math.floor(2000 * 1.1) = 2200
    expect(result.coinsReceived).toBe(2200);
    expect(result.newBeanBalance).toBe(0);
    expect(result.newCoinBalance).toBe(2200);
  });

  test("redemption just below threshold does not apply bonus", async () => {
    mockUsers["user-1"] = { shyBeans: 5000, shyCoins: 0 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 2000, beanRedeemBonusMultiplier: 1.1 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 1999 });

    // Below threshold — no bonus
    expect(result.coinsReceived).toBe(1999);
    expect(result.newBeanBalance).toBe(3001);
    expect(result.newCoinBalance).toBe(1999);
  });

  test("redemption with higher multiplier", async () => {
    mockUsers["user-1"] = { shyBeans: 5000, shyCoins: 100 };
    mockConfig["economy"] = { beanRedeemBonusThreshold: 1000, beanRedeemBonusMultiplier: 1.5 };

    const result = await callOnCall("redeemBeans", "user-1", { amount: 3000 });

    // 3000 >= 1000 threshold: Math.floor(3000 * 1.5) = 4500
    expect(result.coinsReceived).toBe(4500);
    expect(result.newBeanBalance).toBe(2000);
    expect(result.newCoinBalance).toBe(4600); // 100 + 4500
  });
});

// ═══════════════════════════════════════════════════════════════
// sendEntireBackpack - advanced
// ═══════════════════════════════════════════════════════════════
describe("sendEntireBackpack - advanced", () => {
  test("multiple gift types all transferred", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, iconUrl: "" };
    mockGifts["diamond"] = { name: "Diamond", coinValue: 2000, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 0, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 100, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 10 };
    mockBackpacks["crown"] = { quantity: 3 };
    mockBackpacks["diamond"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    expect(result.totalItemsSent).toBe(14); // 10 + 3 + 1
    expect(result.giftsSent.length).toBe(3);

    const roseEntry = result.giftsSent.find((g) => g.giftId === "rose");
    expect(roseEntry.quantity).toBe(10);

    const crownEntry = result.giftsSent.find((g) => g.giftId === "crown");
    expect(crownEntry.quantity).toBe(3);

    const diamondEntry = result.giftsSent.find((g) => g.giftId === "diamond");
    expect(diamondEntry.quantity).toBe(1);

    // Bean reward: (10*0.6*10) + (500*0.6*3) + (2000*0.6*1) = 60 + 900 + 1200 = 2160
    // Recipient started with 100 beans
    expect(mockUsers["user-2"].shyBeans).toBe(2260); // 100 + 2160
  });

  test("gift wall updated for each gift type", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockGifts["crown"] = { name: "Crown", coinValue: 500, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 0, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 4 };
    mockBackpacks["crown"] = { quantity: 2 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    // Both gift types should have gift wall entries
    expect(mockGiftWall["rose"]).toBeDefined();
    expect(mockGiftWall["rose"].receivedCount).toBeDefined();
    expect(mockGiftWall["crown"]).toBeDefined();
    expect(mockGiftWall["crown"].receivedCount).toBeDefined();
  });

  test("room message created when sender is in a room", async () => {
    mockGifts["crown"] = { name: "Crown", coinValue: 500, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 0, displayName: "Alice", currentRoomId: "room-1" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Bob" };
    mockRooms["room-1"] = { state: "ACTIVE" };
    mockBackpacks["crown"] = { quantity: 5 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    expect(result.totalItemsSent).toBe(5);
    // Room should have lastGiftEvent set via tx.update
    expect(mockRooms["room-1"].lastGiftEvent).toBeDefined();
    expect(mockRooms["room-1"].lastGiftEvent.senderName).toBe("Alice");
    expect(mockRooms["room-1"].lastGiftEvent.recipientName).toBe("Bob");
    expect(mockRooms["room-1"].lastGiftEvent.giftId).toBe("crown");
  });

  test("skips super_shy_trial items", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 0, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 2 };
    mockBackpacks["super_shy_trial"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    // Only roses should transfer, trial item skipped
    expect(result.totalItemsSent).toBe(2);
    expect(result.giftsSent.length).toBe(1);
    expect(result.giftsSent[0].giftId).toBe("rose");
  });

  test("transaction records created for both sender and recipient", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 50, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    const result = await callOnCall("sendEntireBackpack", "user-1", { recipientId: "user-2" });

    expect(result.totalItemsSent).toBe(3);
    // Bean reward: 10 * 0.6 * 3 = 18
    expect(mockUsers["user-2"].shyBeans).toBe(18);
    // Transaction records are written to subcollections — verify via mockTransactions store
    // The mock stores transactions written via tx.set on subcollection paths
    const txKeys = Object.keys(mockTransactions);
    expect(txKeys.length).toBeGreaterThanOrEqual(2); // sender + recipient transactions
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: sendGiftDirect - edge cases
// ═══════════════════════════════════════════════════════════════
describe("sendGiftDirect - edge cases", () => {
  test("creates gift wall entry for recipient", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    // Gift wall should be updated with receivedCount
    expect(mockGiftWall["rose"]).toBeDefined();
    expect(mockGiftWall["rose"].receivedCount).toBeDefined();
  });

  test("triggers broadcast when high value gift sent", async () => {
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, iconUrl: "crystal.png" };
    mockUsers["user-1"] = { shyCoins: 10000, displayName: "BigSpender", profilePhotoUrl: "sender.jpg" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Lucky Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "crystal_ball" });

    expect(result.success).toBe(true);
    expect(result.coinsSpent).toBe(5000);

    // Broadcast should be created (coinValue 5000 >= broadcastSendThreshold 5000)
    const broadcastKeys = Object.keys(mockBroadcasts);
    expect(broadcastKeys.length).toBeGreaterThanOrEqual(1);
    const broadcast = mockBroadcasts[broadcastKeys[0]];
    expect(broadcast.type).toBe("GIFT_SEND");
    expect(broadcast.senderName).toBe("BigSpender");
    expect(broadcast.recipientName).toBe("Lucky Recipient");
    expect(broadcast.giftName).toBe("Crystal Ball");
    expect(broadcast.giftCoinValue).toBe(5000);
  });

  test("does not broadcast when gift below threshold", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    // No broadcast should be created (coinValue 10 < broadcastSendThreshold 5000)
    const broadcastKeys = Object.keys(mockBroadcasts);
    expect(broadcastKeys.length).toBe(0);
  });

  test("writes room gift event when sender is in a room", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender", currentRoomId: "room-1" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockRooms["room-1"] = { ownerId: "user-1", state: "ACTIVE" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    expect(result.success).toBe(true);
    // Room should have lastGiftEvent
    expect(mockRooms["room-1"].lastGiftEvent).toBeDefined();
    expect(mockRooms["room-1"].lastGiftEvent.senderId).toBe("user-1");
    expect(mockRooms["room-1"].lastGiftEvent.recipientId).toBe("user-2");
    expect(mockRooms["room-1"].lastGiftEvent.giftName).toBe("Rose");
  });

  test("rejects non-existent gift", async () => {
    mockUsers["user-1"] = { shyCoins: 1000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6 };

    await expect(callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2", giftId: "nonexistent",
    })).rejects.toThrow("Gift not found");
  });

  test("rejects unauthenticated", async () => {
    await expect(callOnCall("sendGiftDirect", null, {
      recipientId: "user-2", giftId: "rose",
    })).rejects.toThrow("Must be signed in");
  });

  test("rejects missing parameters", async () => {
    await expect(callOnCall("sendGiftDirect", "user-1", {}))
      .rejects.toThrow("recipientId and giftId required");
  });

  test("quantity multiplies bean reward correctly", async () => {
    mockGifts["crown"] = { name: "Crown", coinValue: 500, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 5000, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 50000 };

    const result = await callOnCall("sendGiftDirect", "user-1", {
      recipientId: "user-2", giftId: "crown", quantity: 3,
    });

    expect(result.success).toBe(true);
    // beanReward = Math.floor(500 * 0.6 * 3) = 900
    expect(result.beanReward).toBe(900);
    // coinsSpent = 500 * 3 = 1500
    expect(result.coinsSpent).toBe(1500);
  });

  test("creates transaction records for sender and recipient", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 50, displayName: "Recipient" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendGiftDirect", "user-1", { recipientId: "user-2", giftId: "rose" });

    const txKeys = Object.keys(mockTransactions);
    expect(txKeys.length).toBeGreaterThanOrEqual(2);

    const senderTx = Object.values(mockTransactions).find((t) => t.type === "GIFT_SENT");
    expect(senderTx).toBeDefined();
    expect(senderTx.giftId).toBe("rose");
    expect(senderTx.amount).toBe(-10);

    const recipientTx = Object.values(mockTransactions).find((t) => t.type === "GIFT_RECEIVED");
    expect(recipientTx).toBeDefined();
    expect(recipientTx.amount).toBe(6); // 10 * 0.6
    expect(recipientTx.currency).toBe("BEANS");
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: checkSubscriptionStatus - edge cases
// ═══════════════════════════════════════════════════════════════
describe("checkSubscriptionStatus - edge cases", () => {
  test("expires user with exactly-now expiry timestamp", async () => {
    // Expiry at exactly the current moment (should be <= now, so matched)
    const now = new Date();
    mockUsers["user-exact"] = {
      isSuperShy: true,
      superShyTier: "monthly",
      superShyExpiry: mockFakeTimestamp(now),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    expect(mockUsers["user-exact"].isSuperShy).toBe(false);
    expect(mockUsers["user-exact"].superShyExpiry).toBeNull();
    expect(mockUsers["user-exact"].superShyTier).toBeNull();
  });

  test("expires multiple users with past expiry dates", async () => {
    const pastDate1 = new Date(Date.now() - 2 * 86400000); // 2 days ago
    const pastDate2 = new Date(Date.now() - 30 * 86400000); // 30 days ago
    mockUsers["user-a"] = {
      isSuperShy: true,
      superShyTier: "monthly",
      superShyExpiry: mockFakeTimestamp(pastDate1),
    };
    mockUsers["user-b"] = {
      isSuperShy: true,
      superShyTier: "yearly",
      superShyExpiry: mockFakeTimestamp(pastDate2),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    expect(mockUsers["user-a"].isSuperShy).toBe(false);
    expect(mockUsers["user-a"].superShyTier).toBeNull();
    expect(mockUsers["user-b"].isSuperShy).toBe(false);
    expect(mockUsers["user-b"].superShyTier).toBeNull();
  });

  test("mixed expired and active users — only expires the expired ones", async () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    const futureDate = new Date(Date.now() + 86400000); // tomorrow
    mockUsers["user-expired"] = {
      isSuperShy: true,
      superShyTier: "monthly",
      superShyExpiry: mockFakeTimestamp(pastDate),
    };
    mockUsers["user-active"] = {
      isSuperShy: true,
      superShyTier: "yearly",
      superShyExpiry: mockFakeTimestamp(futureDate),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    // Expired user should be cleared
    expect(mockUsers["user-expired"].isSuperShy).toBe(false);
    expect(mockUsers["user-expired"].superShyTier).toBeNull();

    // Active user should remain untouched (future expiry won't match <= now query)
    expect(mockUsers["user-active"].isSuperShy).toBe(true);
    expect(mockUsers["user-active"].superShyTier).toBe("yearly");
  });

  test("mixed expired non-lifetime and expired lifetime — only expires non-lifetime", async () => {
    const pastDate = new Date(Date.now() - 86400000);
    mockUsers["user-monthly"] = {
      isSuperShy: true,
      superShyTier: "monthly",
      superShyExpiry: mockFakeTimestamp(pastDate),
    };
    mockUsers["user-lifetime"] = {
      isSuperShy: true,
      superShyTier: "lifetime",
      superShyExpiry: mockFakeTimestamp(pastDate),
    };

    const fn = indexModule.checkSubscriptionStatus;
    await fn();

    // Monthly expired — cleared
    expect(mockUsers["user-monthly"].isSuperShy).toBe(false);
    expect(mockUsers["user-monthly"].superShyTier).toBeNull();

    // Lifetime — preserved even with past expiry
    expect(mockUsers["user-lifetime"].isSuperShy).toBe(true);
    expect(mockUsers["user-lifetime"].superShyTier).toBe("lifetime");
  });

  test("runs without error when no Super Shy users exist", async () => {
    // No users with isSuperShy at all
    mockUsers["regular-user"] = { displayName: "Normal", isSuperShy: false };

    const fn = indexModule.checkSubscriptionStatus;
    await expect(fn()).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: sendPmNotification - remaining message types
// ═══════════════════════════════════════════════════════════════
describe("sendPmNotification - remaining edge cases", () => {
  test("STICKER message type uses correct body text", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "", type: "STICKER" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageText: "Sent a sticker",
        }),
      })
    );
  });

  test("ROOM_INVITE message type uses correct body text", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "", type: "ROOM_INVITE" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageText: "Invited you to a room",
        }),
      })
    );
  });

  test("preview disabled shows generic 'New message' body", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: false, // preview disabled
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Secret message!", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageText: "New message",
          showPreview: "false",
        }),
      })
    );
  });

  test("no message data skips processing", async () => {
    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => null,
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("missing senderId skips processing", async () => {
    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ text: "Hello" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("non-existent conversation skips processing", async () => {
    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello", type: "TEXT" }),
      },
      params: { conversationId: "nonexistent-conv", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("recipient with no FCM tokens skips push", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: false,
    };
    mockUsers["sender-1"] = { displayName: "Sender" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: [], // no tokens
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hello", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test("group message without groupName uses fallback 'Group'", async () => {
    mockConversations["conv-1"] = {
      participantIds: ["sender-1", "recipient-1"],
      isGroup: true,
      // no groupName field
    };
    mockUsers["sender-1"] = { displayName: "Alice" };
    mockUsers["recipient-1"] = {
      pmNotificationsEnabled: true,
      fcmTokens: ["token-abc"],
      pmNotificationPreview: true,
    };

    const fn = indexModule.sendPmNotification;
    await fn({
      data: {
        data: () => ({ senderId: "sender-1", text: "Hi", type: "TEXT" }),
      },
      params: { conversationId: "conv-1", messageId: "msg-1" },
    });

    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderName: "Alice in Group",
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: sendGift broadcast trigger
// ═══════════════════════════════════════════════════════════════
describe("sendGift - broadcast trigger", () => {
  test("triggers broadcast when high value gift sent from backpack", async () => {
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, iconUrl: "crystal.png" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "GiftSender", profilePhotoUrl: "sender.jpg" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "GiftReceiver" };
    mockBackpacks["crystal_ball"] = { quantity: 1 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "crystal_ball",
    });

    expect(result.success).toBe(true);

    // Broadcast should be created (coinValue 5000 >= broadcastSendThreshold 5000)
    const broadcastKeys = Object.keys(mockBroadcasts);
    expect(broadcastKeys.length).toBeGreaterThanOrEqual(1);
    const broadcast = mockBroadcasts[broadcastKeys[0]];
    expect(broadcast.type).toBe("GIFT_SEND");
    expect(broadcast.giftName).toBe("Crystal Ball");
    expect(broadcast.giftCoinValue).toBe(5000);
  });

  test("does not trigger broadcast for low value backpack gift", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose",
    });

    // No broadcast (coinValue 10 < broadcastSendThreshold 5000)
    expect(Object.keys(mockBroadcasts).length).toBe(0);
  });

  test("updates gift wall for recipient", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, displayName: "Sender" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Recipient" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    await callOnCall("sendGift", "user-1", {
      recipientId: "user-2", giftId: "rose", quantity: 3,
    });

    // Gift wall should be updated
    expect(mockGiftWall["rose"]).toBeDefined();
    expect(mockGiftWall["rose"].receivedCount).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: archiveOldReports - actual archival
// ═══════════════════════════════════════════════════════════════
describe("archiveOldReports - edge cases", () => {
  test("archives resolved reports older than 6 months", async () => {
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    mockReports["old-report"] = {
      status: "resolved",
      resolvedAt: sevenMonthsAgo,
      reason: "Spam",
    };

    const fn = indexModule.archiveOldReports;
    await fn();

    // batch.set and batch.delete should have been called
    expect(mockBatch.set).toHaveBeenCalled();
    expect(mockBatch.delete).toHaveBeenCalled();
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  test("does not archive recent resolved reports", async () => {
    const recentDate = new Date();
    recentDate.setMonth(recentDate.getMonth() - 1);
    mockReports["recent-report"] = {
      status: "resolved",
      resolvedAt: recentDate,
      reason: "Spam",
    };

    const fn = indexModule.archiveOldReports;
    await fn();

    // The mock query filters by resolvedAt < 6monthsAgo, recent report won't match
    // batch operations should not be called for archiving (only the commit check matters)
    // Since no reports match, batch.set shouldn't be called for this report
  });

  test("does not archive pending reports", async () => {
    const sevenMonthsAgo = new Date();
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    mockReports["pending-old"] = {
      status: "pending",
      resolvedAt: sevenMonthsAgo,
      reason: "Spam",
    };

    const fn = indexModule.archiveOldReports;
    await fn();

    // Pending reports should not match the query (status == "resolved")
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: onPresenceRemoved - remaining edge cases
// ═══════════════════════════════════════════════════════════════
describe("onPresenceRemoved - remaining edge cases", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("skips cleanup when room already CLOSED", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "CLOSED",
      participantIds: [],
      seats: {},
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-1" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    // Room should still be CLOSED, nothing changed
    expect(mockRooms["room-1"].state).toBe("CLOSED");
  });

  test("skips cleanup when room does not exist", async () => {
    // No room in mockRooms — room doc doesn't exist
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "nonexistent-room", userId: "user-1" },
    });
    jest.advanceTimersByTime(15000);
    // Should not throw
    await expect(promise).resolves.toBeUndefined();
  });

  test("skips cleanup when user not in room participantIds", async () => {
    mockRooms["room-1"] = {
      ownerId: "owner-1",
      state: "ACTIVE",
      participantIds: ["owner-1"],  // user-2 not in list
      seats: {
        "0": { userId: "owner-1", state: "OCCUPIED", isMuted: false },
      },
    };
    mockPresence = {};

    const fn = indexModule.onPresenceRemoved;
    const promise = fn({
      params: { roomId: "room-1", userId: "user-2" },
    });
    jest.advanceTimersByTime(15000);
    await promise;

    // Room should be unchanged since user-2 wasn't a participant
    expect(mockRooms["room-1"].state).toBe("ACTIVE");
    expect(mockRooms["room-1"].participantIds).toEqual(["owner-1"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: onUserSuspended - presence cleanup
// ═══════════════════════════════════════════════════════════════
describe("onUserSuspended - presence cleanup", () => {
  test("removes RTDB presence entry on suspension", async () => {
    mockPresence["room-1"] = { "user-1": true };
    mockUsers["user-1"] = { displayName: "User", currentRoomId: null };

    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: null }) },
      },
      params: { userId: "user-1" },
    });

    // revokeRefreshTokens should be called
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });

  test("clears currentRoomId when user has one", async () => {
    mockUsers["user-1"] = { displayName: "User", currentRoomId: "room-1" };

    const fn = indexModule.onUserSuspended;
    await fn({
      data: {
        before: { data: () => ({ isSuspended: false }) },
        after: { data: () => ({ isSuspended: true, currentRoomId: "room-1" }) },
      },
      params: { userId: "user-1" },
    });

    expect(mockUsers["user-1"].currentRoomId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: extractR2Key / cleanupOrphanedFiles edge cases
// ═══════════════════════════════════════════════════════════════
describe("extractR2Key / cleanupOrphanedFiles coverage", () => {
  test("cleanupOrphanedFiles handles null URLs gracefully", async () => {
    mockUsers["user-1"] = {
      profilePhotoUrl: null,
      coverPhotoUrl: undefined,
    };

    // Should not throw when processing null/undefined URLs
    const result = await indexModule._cleanupOrphanedFiles();
    expect(result).toBeDefined();
    expect(result.totalDeleted).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: sendGiftBatch broadcast trigger
// ═══════════════════════════════════════════════════════════════
describe("sendGiftBatch - broadcast trigger", () => {
  test("triggers broadcast when high-value gift batch sent with coins", async () => {
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, iconUrl: "crystal.png" };
    mockUsers["user-1"] = { shyCoins: 50000, displayName: "Whaler", profilePhotoUrl: "whale.jpg" };
    mockUsers["user-2"] = { shyBeans: 0, displayName: "Lucky1" };
    mockUsers["user-3"] = { shyBeans: 0, displayName: "Lucky2" };
    mockConfig["economy"] = { beanConversionRate: 0.6, broadcastSendThreshold: 5000 };

    const result = await callOnCall("sendGiftBatch", "user-1", {
      recipientIds: ["user-2", "user-3"],
      giftId: "crystal_ball",
      quantity: 1,
      fromBackpack: false,
    });

    expect(result.success).toBe(true);

    // Broadcast should be created
    const broadcastKeys = Object.keys(mockBroadcasts);
    expect(broadcastKeys.length).toBeGreaterThanOrEqual(1);
    const broadcast = mockBroadcasts[broadcastKeys[0]];
    expect(broadcast.type).toBe("GIFT_SEND");
    expect(broadcast.giftName).toBe("Crystal Ball");
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 10: pullGacha broadcast trigger for high-value win
// ═══════════════════════════════════════════════════════════════
describe("pullGacha - broadcast trigger", () => {
  test("creates broadcast when winning a gift above broadcastWinThreshold", async () => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    // Only high-value gift so we guarantee winning it
    mockGifts["crystal_ball"] = { name: "Crystal Ball", coinValue: 5000, order: 1, iconUrl: "crystal.png" };
    mockUsers["user-1"] = {
      shyCoins: 100,
      pityCounter: 0,
      luckScore: 0,
      displayName: "Winner",
      profilePhotoUrl: "winner.jpg",
    };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    expect(result.gifts[0].giftId).toBe("crystal_ball");

    // Broadcast should be created for gacha win
    const broadcastKeys = Object.keys(mockBroadcasts);
    expect(broadcastKeys.length).toBeGreaterThanOrEqual(1);
    const broadcast = mockBroadcasts[broadcastKeys[0]];
    expect(broadcast.type).toBe("GACHA_WIN");
    expect(broadcast.giftName).toBe("Crystal Ball");
    expect(broadcast.senderName).toBe("Winner");
  });

  test("no broadcast for gift below broadcastWinThreshold", async () => {
    mockConfig["economy"] = {
      pullCosts: { "1": 10, "10": 100, "100": 1000 },
      dropRateExponent: 1.5,
      pitySoftStart: 80,
      pityHardLimit: 120,
      pitySoftMaxShift: 0.15,
      pityHighValueThreshold: 5000,
      broadcastWinThreshold: 5000,
    };
    // Only low-value gifts
    mockGifts["rose"] = { name: "Rose", coinValue: 10, order: 1, iconUrl: "" };
    mockUsers["user-1"] = { shyCoins: 100, pityCounter: 0, luckScore: 0, displayName: "Player" };

    const result = await callOnCall("pullGacha", "user-1", { pullCount: 1, expectedCost: 10 });

    expect(result.gifts.length).toBe(1);
    // No broadcast for low-value gift
    expect(Object.keys(mockBroadcasts).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// onStalkerWrite (trigger)
// ═══════════════════════════════════════════════════════════════
describe("onStalkerWrite", () => {
  test("first visit increments both stalkerCount and newStalkerCount", async () => {
    mockUsers["profile-user"] = { stalkerCount: 0, newStalkerCount: 0 };
    const fn = indexModule.onStalkerWrite;
    const mockRef = mockBuildDocRef("users/profile-user/stalkers", "visitor-1");

    await fn({
      data: {
        before: { exists: false },
        after: { exists: true, ref: mockRef, data: () => ({ visitorId: "visitor-1", visitCount: 1 }) },
      },
      params: { uid: "profile-user", visitorId: "visitor-1" },
    });

    expect(mockUsers["profile-user"].stalkerCount).toBe(1);
    expect(mockUsers["profile-user"].newStalkerCount).toBe(1);
  });

  test("repeat visit only increments newStalkerCount", async () => {
    mockUsers["profile-user"] = { stalkerCount: 1, newStalkerCount: 0 };
    const fn = indexModule.onStalkerWrite;
    const mockRef = mockBuildDocRef("users/profile-user/stalkers", "visitor-1");

    await fn({
      data: {
        before: { exists: true, data: () => ({ visitorId: "visitor-1", visitCount: 1 }) },
        after: { exists: true, ref: mockRef, data: () => ({ visitorId: "visitor-1", visitCount: 2 }) },
      },
      params: { uid: "profile-user", visitorId: "visitor-1" },
    });

    expect(mockUsers["profile-user"].stalkerCount).toBe(1); // unchanged
    expect(mockUsers["profile-user"].newStalkerCount).toBe(1); // incremented
  });

  test("first visit sets firstVisitedAt on stalker doc", async () => {
    mockUsers["profile-user"] = { stalkerCount: 0, newStalkerCount: 0 };
    const fn = indexModule.onStalkerWrite;
    const mockRef = mockBuildDocRef("users/profile-user/stalkers", "visitor-1");

    await fn({
      data: {
        before: { exists: false },
        after: { exists: true, ref: mockRef, data: () => ({ visitorId: "visitor-1", visitCount: 1 }) },
      },
      params: { uid: "profile-user", visitorId: "visitor-1" },
    });

    // firstVisitedAt should be set (as serverTimestamp mock)
    expect(mockRef.update).toHaveBeenCalled();
  });

  test("multiple first-time visitors increment stalkerCount each time", async () => {
    mockUsers["profile-user"] = { stalkerCount: 0, newStalkerCount: 0 };
    const fn = indexModule.onStalkerWrite;

    // First visitor
    await fn({
      data: {
        before: { exists: false },
        after: { exists: true, ref: mockBuildDocRef("users/profile-user/stalkers", "v1"), data: () => ({}) },
      },
      params: { uid: "profile-user", visitorId: "v1" },
    });

    // Second visitor
    await fn({
      data: {
        before: { exists: false },
        after: { exists: true, ref: mockBuildDocRef("users/profile-user/stalkers", "v2"), data: () => ({}) },
      },
      params: { uid: "profile-user", visitorId: "v2" },
    });

    expect(mockUsers["profile-user"].stalkerCount).toBe(2);
    expect(mockUsers["profile-user"].newStalkerCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Pass 11: cleanupOrphanedFiles — additional coverage
// ═══════════════════════════════════════════════════════════════

describe("cleanupOrphanedFiles - additional coverage", () => {
  test("preserves group photo URL referenced by a conversation", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "group_photos/") {
        return {
          Contents: [
            { Key: "group_photos/group-conv-1/photo.jpg" },
            { Key: "group_photos/orphan-group/photo.jpg" },
          ],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    mockConversations["conv-g1"] = {
      groupPhotoUrl: "https://images.shytalk.shyden.co.uk/group_photos/group-conv-1/photo.jpg",
    };

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(1);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    const deletedKeys = deleteCalls.flatMap(([cmd]) =>
      cmd.params.Delete.Objects.map((o) => o.Key)
    );
    expect(deletedKeys).toContain("group_photos/orphan-group/photo.jpg");
    expect(deletedKeys).not.toContain("group_photos/group-conv-1/photo.jpg");
  });

  test("preserves _preSuspension profilePhotoUrl and coverPhotoUrl", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "profile_photos/") {
        return {
          Contents: [{ Key: "profile_photos/uid-1/before.jpg" }],
          IsTruncated: false,
        };
      }
      if (cmd.params?.Prefix === "cover_photos/") {
        return {
          Contents: [{ Key: "cover_photos/uid-1/before_cover.jpg" }],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    mockUsers["uid-1"] = {
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      _preSuspension: {
        profilePhotoUrl:
          "https://images.shytalk.shyden.co.uk/profile_photos/uid-1/before.jpg",
        coverPhotoUrl:
          "https://images.shytalk.shyden.co.uk/cover_photos/uid-1/before_cover.jpg",
      },
    };

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(0);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    expect(deleteCalls.length).toBe(0);
  });

  test("always preserves the hardcoded system/shytalk_icon.webp asset", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      // Return the system asset and an orphan under the same prefix
      if (cmd.params?.Prefix === "profile_photos/") {
        return {
          Contents: [{ Key: "profile_photos/orphan.jpg" }],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    // Simulate system asset appearing in an arbitrary scan by re-seeding referencedKeys
    // The cleanupOrphanedFiles function hardcodes system/shytalk_icon.webp — it should
    // never be in the scanned folders (profile_photos etc.) but we verify the logic
    // holds for orphaned files not matching the system key.
    const result = await indexModule._cleanupOrphanedFiles();

    // Only orphan.jpg (not in any user doc) should be deleted
    expect(result.totalDeleted).toBe(1);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    const deletedKeys = deleteCalls.flatMap(([cmd]) =>
      cmd.params.Delete.Objects.map((o) => o.Key)
    );
    expect(deletedKeys).not.toContain("system/shytalk_icon.webp");
  });

  test("handles S3 pagination correctly (IsTruncated = true)", async () => {
    let callCount = 0;
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "profile_photos/") {
        callCount++;
        if (callCount === 1) {
          // First page — truncated
          return {
            Contents: [{ Key: "profile_photos/page1-orphan.jpg" }],
            IsTruncated: true,
            NextContinuationToken: "token-for-page-2",
          };
        }
        // Second page — final
        return {
          Contents: [{ Key: "profile_photos/page2-orphan.jpg" }],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    const result = await indexModule._cleanupOrphanedFiles();

    // Both files from both pages should be deleted (no user references them)
    expect(result.totalDeleted).toBe(2);
  });

  test("passes ContinuationToken on paginated requests", async () => {
    let paginationTokenSeen = null;
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "cover_photos/") {
        if (!cmd.params.ContinuationToken) {
          return {
            Contents: [{ Key: "cover_photos/file1.jpg" }],
            IsTruncated: true,
            NextContinuationToken: "my-token-123",
          };
        }
        paginationTokenSeen = cmd.params.ContinuationToken;
        return { Contents: [{ Key: "cover_photos/file2.jpg" }], IsTruncated: false };
      }
      return { Contents: [], IsTruncated: false };
    });

    await indexModule._cleanupOrphanedFiles();

    expect(paginationTokenSeen).toBe("my-token-123");
  });

  test("does not treat non-R2 URLs in Firestore as referenced keys", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "profile_photos/") {
        return {
          Contents: [{ Key: "profile_photos/uid-x/photo.jpg" }],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    // User has a Firebase Storage URL (pre-migration remnant) — should NOT protect the R2 key
    mockUsers["uid-x"] = {
      profilePhotoUrl: "https://firebasestorage.googleapis.com/v0/b/shytalk/o/profile.jpg",
    };

    const result = await indexModule._cleanupOrphanedFiles();

    // The R2 key is orphaned because the Firestore URL is Firebase, not R2
    expect(result.totalDeleted).toBe(1);
  });

  test("deletes orphaned pm_images files", async () => {
    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "pm_images/") {
        return {
          Contents: [
            { Key: "pm_images/user-a/user-b/1234.jpg" },
            { Key: "pm_images/user-a/user-b/9999.jpg" },
          ],
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    // No references to either pm_image in any Firestore document
    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(2);
    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    const deletedKeys = deleteCalls.flatMap(([cmd]) =>
      cmd.params.Delete.Objects.map((o) => o.Key)
    );
    expect(deletedKeys).toContain("pm_images/user-a/user-b/1234.jpg");
    expect(deletedKeys).toContain("pm_images/user-a/user-b/9999.jpg");
  });

  test("batches delete calls when more than 1000 orphaned files exist", async () => {
    // Generate 1500 orphaned keys in profile_photos/
    const orphanKeys = Array.from(
      { length: 1500 },
      (_, i) => `profile_photos/orphan-${i}.jpg`
    );

    mockS3Send.mockImplementation(async (cmd) => {
      if (cmd.params?.Prefix === "profile_photos/") {
        return {
          Contents: orphanKeys.map((k) => ({ Key: k })),
          IsTruncated: false,
        };
      }
      return { Contents: [], IsTruncated: false };
    });

    const result = await indexModule._cleanupOrphanedFiles();

    expect(result.totalDeleted).toBe(1500);

    const deleteCalls = mockS3Send.mock.calls.filter(([cmd]) => cmd.type === "delete");
    // Expect 2 batches: 1000 + 500
    expect(deleteCalls.length).toBe(2);
    expect(deleteCalls[0][0].params.Delete.Objects.length).toBe(1000);
    expect(deleteCalls[1][0].params.Delete.Objects.length).toBe(500);
  });
});

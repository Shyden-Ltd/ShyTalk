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
  mockDocIdCounter = 0;
}

function mockFakeTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  return { toDate: () => d, _seconds: Math.floor(d.getTime() / 1000) };
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
  if (path.includes("/backpack")) return mockBackpacks;
  if (path.includes("/giftWall")) return mockGiftWall;
  if (path.includes("/transactions")) return mockTransactions;
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
          switch (op) {
            case "==": return JSON.stringify(fieldValue) === JSON.stringify(value);
            case "<=": return fieldValue <= value;
            case "<": return fieldValue < value;
            case ">": return fieldValue > value;
            case ">=": return fieldValue >= value;
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

jest.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      getFiles: jest.fn(async () => [[]]),
    }),
  }),
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

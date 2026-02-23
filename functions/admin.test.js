/**
 * Tests for admin.js — ShyTalk Admin API
 *
 * Mocks firebase-admin so tests run without a real project.
 */

// ── Mock data stores (must be prefixed with "mock") ─────────────────
let mockUsers = {};
let mockReports = {};
let mockReportsArchive = {};
let mockConversations = {};
let mockMessages = {};
let mockAuditLog = {};
let mockReportLocks = {};
let mockAdminTokens = {};
let mockSuspensionAppeals = {};
let mockStorageFiles = {};
let mockGifts = {};
let mockConfig = {};
let mockBackpacks = {};
let mockTransactionsStore = {};
let mockDocIdCounter = 0;

// Helper to build Firestore Timestamp-like object
function mockFakeTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return { toDate: () => d, _seconds: Math.floor(d.getTime() / 1000) };
}

function mockGetStore(path) {
  if (path === "users") return mockUsers;
  if (path === "reports") return mockReports;
  if (path === "reports_archive") return mockReportsArchive;
  if (path === "conversations") return mockConversations;
  if (path === "admin_audit_log") return mockAuditLog;
  if (path === "report_locks") return mockReportLocks;
  if (path === "admin_tokens") return mockAdminTokens;
  if (path === "suspensionAppeals") return mockSuspensionAppeals;
  if (path === "gifts") return mockGifts;
  if (path === "config") return mockConfig;
  if (path.includes("/backpack")) return mockBackpacks;
  if (path.includes("/transactions")) return mockTransactionsStore;
  if (path.includes("/messages")) return mockMessages;
  if (path.includes("/settings")) return {};
  if (path.includes("/giftWall")) return {};
  return {};
}

function mockBuildQuerySnapshot(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({
      id: d._id,
      data: () => {
        const copy = { ...d };
        delete copy._id;
        delete copy._collection;
        return copy;
      },
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
      if (!store[docId]) throw new Error(`Doc ${collection}/${docId} not found`);
      for (const [k, v] of Object.entries(updates)) {
        if (v && v._type === "increment") {
          store[docId][k] = (store[docId][k] || 0) + v._value;
        } else if (v && v._type === "delete") {
          delete store[docId][k];
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
            case ">=": return fieldValue >= value;
            case "<=": return fieldValue <= value;
            case "<": return fieldValue < value;
            case ">": return fieldValue > value;
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
    orderBy: () => mockBuildQuery(path, []),
    select: () => mockBuildCollectionRef(path),
  };
}

const mockBatch = {
  update: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  commit: jest.fn().mockResolvedValue(),
};

// ── Mock firebase-admin/auth ────────────────────────────────────────
const mockVerifyIdToken = jest.fn();
const mockRevokeRefreshTokens = jest.fn().mockResolvedValue();

jest.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
    revokeRefreshTokens: mockRevokeRefreshTokens,
  }),
}));

// ── Mock firebase-admin/firestore ───────────────────────────────────
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name) => mockBuildCollectionRef(name),
    batch: () => mockBatch,
    getAll: jest.fn(async (...refs) => {
      return refs.map((ref) => {
        const data = mockUsers[ref.id];
        return {
          exists: !!data,
          id: ref.id,
          data: () => (data ? { ...data } : undefined),
        };
      });
    }),
  }),
  Timestamp: {
    now: () => mockFakeTimestamp(new Date()),
    fromDate: (d) => mockFakeTimestamp(d),
  },
  FieldValue: {
    increment: (n) => ({ _type: "increment", _value: n }),
    delete: () => ({ _type: "delete" }),
    serverTimestamp: () => mockFakeTimestamp(new Date()),
  },
}));

// ── Mock firebase-admin/storage ─────────────────────────────────────
jest.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({
      getFiles: jest.fn(async ({ prefix }) => {
        const files = Object.entries(mockStorageFiles)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k]) => ({
            name: k,
            delete: jest.fn(async () => { delete mockStorageFiles[k]; }),
            getMetadata: jest.fn(async () => [{ size: "1024" }]),
          }));
        return [files];
      }),
      file: (path) => ({
        delete: jest.fn(async () => { delete mockStorageFiles[path]; }),
      }),
    }),
  }),
}));

// ── Load admin app after mocks ──────────────────────────────────────
const http = require("http");
let app;
let server;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Setup / Teardown ────────────────────────────────────────────────
beforeAll((done) => {
  app = require("./admin");
  server = http.createServer(app);
  server.listen(0, "127.0.0.1", done);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  mockUsers = {};
  mockReports = {};
  mockReportsArchive = {};
  mockConversations = {};
  mockMessages = {};
  mockAuditLog = {};
  mockReportLocks = {};
  mockAdminTokens = {};
  mockSuspensionAppeals = {};
  mockStorageFiles = {};
  mockGifts = {};
  mockConfig = {};
  mockBackpacks = {};
  mockTransactionsStore = {};
  mockDocIdCounter = 0;

  mockVerifyIdToken.mockResolvedValue({ uid: "admin-1", admin: true, name: "Admin One", email: "admin@test.com" });
  mockRevokeRefreshTokens.mockResolvedValue();
  mockBatch.commit.mockResolvedValue();
  mockBatch.update.mockReset();
  mockBatch.set.mockReset();
  mockBatch.delete.mockReset();
});

// ── Auth Middleware Tests ────────────────────────────────────────────
describe("Auth Middleware", () => {
  test("returns 401 when no Authorization header", async () => {
    const res = await request("GET", "/api/user/test-uid", null, null);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing/i);
  });

  test("returns 401 when invalid token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("invalid token"));
    const res = await request("GET", "/api/user/test-uid", null, "bad-token");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  test("returns 403 when not admin", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: "user-1", admin: false });
    const res = await request("GET", "/api/user/test-uid", null, "valid-non-admin");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Not an admin/i);
  });
});

// ── GCS Reset ───────────────────────────────────────────────────────
describe("POST /api/user/:uid/reset-gcs", () => {
  test("sets score to 100 and clears warning count", async () => {
    mockUsers["user-1"] = {
      displayName: "Bad User",
      goodCharacterScore: 40,
      goodCharacterLastDeductionAt: mockFakeTimestamp(new Date()),
      warningCount: 3,
    };

    const res = await request("POST", "/api/user/user-1/reset-gcs", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(100);
    expect(mockUsers["user-1"].goodCharacterLastDeductionAt).toBeNull();
    expect(mockUsers["user-1"].warningCount).toBe(0);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/user/no-one/reset-gcs", {}, "valid");
    expect(res.status).toBe(404);
  });
});

// ── GET /api/reports ────────────────────────────────────────────────
describe("GET /api/reports", () => {
  test("returns empty list when no reports", async () => {
    const res = await request("GET", "/api/reports?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });

  test("groups reports by reportedUserId", async () => {
    mockReports["r1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Spam",
      status: "pending",
    };
    mockReports["r2"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Bad User",
      uniqueId: 42,
      goodCharacterScore: 80,
      warningCount: 1,
    };

    const res = await request("GET", "/api/reports?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(1);
    expect(res.body.users[0].uid).toBe("user-1");
    expect(res.body.users[0].reportCount).toBe(2);
    expect(res.body.users[0].warningCount).toBe(1);
  });

  test("rejects invalid status", async () => {
    const res = await request("GET", "/api/reports?status=invalid", null, "valid");
    expect(res.status).toBe(400);
  });
});

// ── POST /api/reports/:id/resolve ───────────────────────────────────
describe("POST /api/reports/:id/resolve", () => {
  beforeEach(() => {
    mockReports["report-1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Offender",
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 0,
    };
  });

  test("rejects invalid action", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "ban" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  test("rejects missing severity for warn", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "warn" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  test("rejects severity out of range", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "warn", severity: 6 }, "valid");
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent report", async () => {
    const res = await request("POST", "/api/reports/fake/resolve", { action: "dismiss" }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects already resolved report", async () => {
    mockReports["report-1"].status = "resolved";
    const res = await request("POST", "/api/reports/report-1/resolve", { action: "dismiss" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already resolved/i);
  });

  test("dismiss resolves report without GCS deduction", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "dismiss",
      adminNote: "False report",
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockReports["report-1"].status).toBe("resolved");
    expect(mockReports["report-1"].resolvedAction).toBe("dismiss");
    expect(mockUsers["user-1"].goodCharacterScore).toBe(100);
  });

  test("warn deducts GCS, sets warning fields, revokes tokens", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 3,
      adminNote: "Warned for harassment",
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(mockReports["report-1"].status).toBe("resolved");
    expect(mockReports["report-1"].resolvedAction).toBe("warn");
    expect(mockReports["report-1"].severity).toBe(3);

    // GCS: 100 - (3*5) = 85
    expect(mockUsers["user-1"].goodCharacterScore).toBe(85);
    expect(mockUsers["user-1"].hasActiveWarning).toBe(true);
    expect(mockUsers["user-1"].warningReason).toBe("Harassment");
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });

  test("warn severity 5 deducts 25 points", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 5,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(75);
  });

  test("GCS does not go below 0", async () => {
    mockUsers["user-1"].goodCharacterScore = 10;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 5,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(0);
  });

  test("auto-escalation suggested when warningCount reaches 5", async () => {
    mockUsers["user-1"].warningCount = 4;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(true);
  });

  test("no auto-escalation when warningCount below 5", async () => {
    mockUsers["user-1"].warningCount = 2;
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(false);
  });

  test("suspend triggers suspension and GCS deduction", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "suspend",
      severity: 4,
      suspensionDays: 7,
      canAppeal: true,
    }, "valid");

    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(80);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionCanAppeal).toBe(true);
  });

  test("dismiss does not require severity", async () => {
    const res = await request("POST", "/api/reports/report-1/resolve", {
      action: "dismiss",
    }, "valid");
    expect(res.status).toBe(200);
  });
});

// ── POST /api/reports/resolve-all/:reportedUserId ───────────────────
describe("POST /api/reports/resolve-all/:reportedUserId", () => {
  beforeEach(() => {
    mockReports["r1"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-1",
      reason: "Spam",
      status: "pending",
    };
    mockReports["r2"] = {
      reportedUserId: "user-1",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-1"] = {
      displayName: "Offender",
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 0,
    };
  });

  test("returns 404 when no pending reports", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-999", {
      action: "dismiss",
    }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects invalid action", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-1", {
      action: "nuke",
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("bulk warn applies single GCS deduction", async () => {
    const res = await request("POST", "/api/reports/resolve-all/user-1", {
      action: "warn",
      severity: 2,
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.resolvedCount).toBe(2);
    // Single deduction: 100 - (2*5) = 90
    expect(mockUsers["user-1"].goodCharacterScore).toBe(90);
    expect(mockUsers["user-1"].hasActiveWarning).toBe(true);
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith("user-1");
  });
});

// ── Review Lock Endpoints ───────────────────────────────────────────
describe("Review Lock Endpoints", () => {
  test("POST lock creates a new lock", async () => {
    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("POST lock returns locked=true when another admin holds it", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-2",
      displayName: "Other Admin",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.lockedBy).toBe("Other Admin");
  });

  test("POST lock allows same admin to re-acquire", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-1",
      displayName: "Admin One",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("POST lock allows acquisition after expired lock", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    mockReportLocks["user-1"] = {
      adminUid: "admin-2",
      displayName: "Other",
      timestamp: mockFakeTimestamp(tenMinAgo),
    };

    const res = await request("POST", "/api/report-locks/user-1/lock", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.locked).toBe(false);
  });

  test("DELETE lock removes it", async () => {
    mockReportLocks["user-1"] = {
      adminUid: "admin-1",
      displayName: "Admin One",
      timestamp: mockFakeTimestamp(new Date()),
    };

    const res = await request("DELETE", "/api/report-locks/user-1", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── GET /api/reports/export ─────────────────────────────────────────
describe("GET /api/reports/export", () => {
  test("returns 400 when from/to missing", async () => {
    const res = await request("GET", "/api/reports/export", null, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from and to/i);
  });

  test("returns 400 for invalid date format", async () => {
    const res = await request("GET", "/api/reports/export?from=bad&to=worse", null, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid date/i);
  });

  test("returns CSV with correct headers", async () => {
    const ts = mockFakeTimestamp(new Date("2025-06-01"));
    mockReports["r1"] = {
      status: "resolved",
      resolvedAt: ts,
      timestamp: ts,
      reporterName: "Reporter",
      reportedUserName: "Offender",
      type: "message",
      reason: "Spam",
      resolvedAction: "warn",
      severity: 2,
      adminNote: "Warned",
    };

    const from = "2025-01-01";
    const to = "2025-12-31";
    const res = await request("GET", `/api/reports/export?from=${from}&to=${to}`, null, "valid");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);

    const lines = res.body.split("\n");
    expect(lines[0]).toBe("Report ID,Reporter,Reported User,Type,Reason,Action Taken,Severity,Admin Note,Created At,Resolved At");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// ── GET /api/reports/stats ──────────────────────────────────────────
describe("GET /api/reports/stats", () => {
  test("returns stats with default period", async () => {
    mockReports["r1"] = { status: "pending" };
    mockReports["r2"] = { status: "pending" };

    const res = await request("GET", "/api/reports/stats", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(2);
    expect(typeof res.body.resolvedToday).toBe("number");
    expect(typeof res.body.activeReviewers).toBe("number");
  });

  test("returns zero stats when empty", async () => {
    const res = await request("GET", "/api/reports/stats?period=30d", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.pendingCount).toBe(0);
    expect(res.body.resolvedToday).toBe(0);
    expect(res.body.activeReviewers).toBe(0);
  });
});

// ── Existing Endpoints (regression) ─────────────────────────────────
describe("Existing Endpoints Regression", () => {
  test("GET /api/user/:uid returns user data", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 123 };
    const res = await request("GET", "/api/user/user-1", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Alice");
    expect(res.body.uid).toBe("user-1");
  });

  test("GET /api/user/:uid returns 404 for missing user", async () => {
    const res = await request("GET", "/api/user/nobody", null, "valid");
    expect(res.status).toBe(404);
  });

  test("PATCH /api/user/:uid updates user fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 123 };
    const res = await request("PATCH", "/api/user/user-1", { displayName: "Bob" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-1"].displayName).toBe("Bob");
  });

  test("PATCH /api/user/:uid rejects unknown fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", { badField: "value" }, "valid");
    expect(res.status).toBe(400);
  });

  test("PATCH /api/user/:uid rejects uid mutation", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", { uid: "new-id" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid is immutable/i);
  });

  test("POST /api/user/:uid/suspend sets suspension fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice", profilePhotoUrl: "url", coverPhotoUrl: "cover" };
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();

    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Bad behavior",
      endDate: futureDate,
      canAppeal: true,
    }, "valid");

    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionReason).toBe("Bad behavior");
    expect(mockUsers["user-1"].suspensionCanAppeal).toBe(true);
  });

  test("POST /api/user/:uid/suspend rejects missing reason", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/user/user-1/suspend", { canAppeal: true }, "valid");
    expect(res.status).toBe(400);
  });

  test("POST /api/user/:uid/unsuspend restores profile", async () => {
    mockUsers["user-1"] = {
      displayName: "Suspended Account",
      isSuspended: true,
      _preSuspension: { displayName: "Alice", profilePhotoUrl: "url", coverPhotoUrl: "cover" },
    };

    const res = await request("POST", "/api/user/user-1/unsuspend", {}, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(false);
    expect(mockUsers["user-1"].displayName).toBe("Alice");
  });

  test("GET /api/search/uniqueId/:id finds user", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };
    const res = await request("GET", "/api/search/uniqueId/42", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Alice");
  });
});

// ── Direct Warning (POST /api/user/:uid/warn) ──────────────────────
describe("POST /api/user/:uid/warn", () => {
  beforeEach(() => {
    mockUsers["target-1"] = {
      displayName: "TargetUser",
      uniqueId: 42,
      goodCharacterScore: 100,
      warningCount: 0,
    };
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/user/ghost/warn", { reason: "Spam", severity: 2 }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects missing reason", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { severity: 2 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test("rejects invalid severity", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 0 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  test("warns user, deducts GCS, sets warning fields", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Harassment", severity: 3, adminNote: "test" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newGCS).toBe(85); // 100 - 15
    expect(res.body.warningCount).toBe(1);
    expect(mockUsers["target-1"].hasActiveWarning).toBe(true);
    expect(mockUsers["target-1"].warningReason).toBe("Harassment");
    expect(mockUsers["target-1"].goodCharacterScore).toBe(85);
  });

  test("auto-escalation suggested at 5 warnings", async () => {
    mockUsers["target-1"].warningCount = 4;
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.autoEscalateSuggested).toBe(true);
  });

  test("GCS does not go below 0", async () => {
    mockUsers["target-1"].goodCharacterScore = 10;
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Spam", severity: 5 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newGCS).toBe(0);
  });

  test("filters 'other' reason to 'a policy violation'", async () => {
    const res = await request("POST", "/api/user/target-1/warn", { reason: "Other", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["target-1"].warningReason).toBe("a policy violation");
  });
});

// ── Field Validation ────────────────────────────────────────────────
describe("Field Validation", () => {
  beforeEach(() => {
    mockUsers["user-1"] = { displayName: "Test", uniqueId: 1 };
  });

  test("rejects non-boolean for boolean fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { hideFollowing: "yes" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hideFollowing must be a boolean/);
  });

  test("rejects invalid userType enum", async () => {
    const res = await request("PATCH", "/api/user/user-1", { userType: "HACKER" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userType must be one of/);
  });

  test("accepts valid userType enum", async () => {
    const res = await request("PATCH", "/api/user/user-1", { userType: "MC_SINGER" }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].userType).toBe("MC_SINGER");
  });

  test("rejects non-string for string fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { displayName: 123 }, "valid");
    expect(res.status).toBe(400);
  });

  test("accepts null for nullable fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { profilePhotoUrl: null }, "valid");
    expect(res.status).toBe(200);
  });

  test("rejects null for non-nullable fields", async () => {
    const res = await request("PATCH", "/api/user/user-1", { displayName: null }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot be null/);
  });

  test("validates timestamp fields as ISO-8601", async () => {
    const res = await request("PATCH", "/api/user/user-1", { createdAt: "not-a-date" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid date/);
  });

  test("accepts valid ISO-8601 timestamp", async () => {
    const res = await request("PATCH", "/api/user/user-1", { createdAt: "2025-01-15T10:00:00Z" }, "valid");
    expect(res.status).toBe(200);
  });
});

// ── Storage Cleanup ─────────────────────────────────────────────────
describe("Storage Cleanup", () => {
  test("cleanup all-reports also deletes report_evidence storage", async () => {
    mockReports["r1"] = { status: "pending", reportedUserId: "u1" };
    mockStorageFiles["report_evidence/u1/screenshot.png"] = true;
    mockStorageFiles["report_evidence/u2/video.mp4"] = true;

    const res = await request("POST", "/api/cleanup/all-reports", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storageFilesDeleted).toBe(2);
    expect(mockStorageFiles["report_evidence/u1/screenshot.png"]).toBeUndefined();
    expect(mockStorageFiles["report_evidence/u2/video.mp4"]).toBeUndefined();
  });

  test("cleanup all-system-conversations deletes PM images from storage", async () => {
    const imgUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/pm_images%2Fuser1%2Fimg.jpg?alt=media&token=abc";
    mockConversations["SHYTALK_SYSTEM_user1"] = {
      participantIds: ["SHYTALK_SYSTEM", "user1"],
    };
    mockMessages["msg1"] = {
      senderId: "user1",
      text: "",
      imageUrls: [imgUrl],
    };
    mockStorageFiles["pm_images/user1/img.jpg"] = true;

    const res = await request("POST", "/api/cleanup/all-system-conversations", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.storageFilesDeleted).toBe(1);
  });

  test("GET /api/storage/audit returns folder stats", async () => {
    mockStorageFiles["pm_images/u1/img.jpg"] = true;
    mockStorageFiles["pm_images/u2/img2.jpg"] = true;
    mockStorageFiles["stickers/u1/sticker.webp"] = true;

    const res = await request("GET", "/api/storage/audit", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pm_images.files).toBe(2);
    expect(res.body.pm_images.bytes).toBe(2048);
    expect(res.body.stickers.files).toBe(1);
    expect(res.body.stickers.bytes).toBe(1024);
    expect(res.body.report_evidence.files).toBe(0);
    expect(res.body.profile_photos.files).toBe(0);
    expect(res.body.cover_photos.files).toBe(0);
  });

  test("orphaned-storage deletes only unreferenced files", async () => {
    // Referenced: user profile photo
    const profileUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/profile_photos%2Fu1%2Fphoto.jpg?alt=media&token=abc";
    mockUsers["u1"] = { displayName: "User", profilePhotoUrl: profileUrl };
    mockStorageFiles["profile_photos/u1/photo.jpg"] = true;

    // Orphaned files (no Firestore reference)
    mockStorageFiles["pm_images/u2/old.jpg"] = true;
    mockStorageFiles["stickers/u3/stale.webp"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Referenced file preserved
    expect(mockStorageFiles["profile_photos/u1/photo.jpg"]).toBe(true);
    // Orphaned files deleted
    expect(mockStorageFiles["pm_images/u2/old.jpg"]).toBeUndefined();
    expect(mockStorageFiles["stickers/u3/stale.webp"]).toBeUndefined();
    expect(res.body.totalDeleted).toBe(2);
  });

  test("orphaned-storage preserves files still referenced in Firestore", async () => {
    // IMAGE message reference
    const imgUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/pm_images%2Fu1%2Fimg.jpg?alt=media&token=abc";
    mockConversations["conv1"] = { participantIds: ["u1", "u2"] };
    mockMessages["msg1"] = { senderId: "u1", type: "IMAGE", imageUrls: [imgUrl] };
    mockStorageFiles["pm_images/u1/img.jpg"] = true;

    // STICKER message reference
    const stickerUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/stickers%2Fu1%2Fsticker.webp?alt=media&token=def";
    mockMessages["msg2"] = { senderId: "u1", type: "STICKER", stickerUrl };
    mockStorageFiles["stickers/u1/sticker.webp"] = true;

    // Report evidence reference
    const evUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/report_evidence%2Fu1%2Fev.png?alt=media&token=xyz";
    mockReports["r1"] = { status: "pending", evidenceUrls: [evUrl] };
    mockStorageFiles["report_evidence/u1/ev.png"] = true;

    // Cover photo in _preSuspension
    const coverUrl = "https://firebasestorage.googleapis.com/v0/b/shytalk-7ba69.firebasestorage.app/o/cover_photos%2Fu1%2Fcover.jpg?alt=media&token=ghi";
    mockUsers["u1"] = { displayName: "User", _preSuspension: { coverPhotoUrl: coverUrl } };
    mockStorageFiles["cover_photos/u1/cover.jpg"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.totalDeleted).toBe(0);
    expect(mockStorageFiles["pm_images/u1/img.jpg"]).toBe(true);
    expect(mockStorageFiles["stickers/u1/sticker.webp"]).toBe(true);
    expect(mockStorageFiles["report_evidence/u1/ev.png"]).toBe(true);
    expect(mockStorageFiles["cover_photos/u1/cover.jpg"]).toBe(true);
  });

  test("orphaned-storage deletes unreferenced files from all folders", async () => {
    mockStorageFiles["pm_images/orphan1.jpg"] = true;
    mockStorageFiles["stickers/orphan2.webp"] = true;
    mockStorageFiles["report_evidence/orphan3.png"] = true;
    mockStorageFiles["profile_photos/orphan4.jpg"] = true;
    mockStorageFiles["cover_photos/orphan5.jpg"] = true;
    mockStorageFiles["group_photos/orphan6.jpg"] = true;

    const res = await request("POST", "/api/cleanup/orphaned-storage", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.totalDeleted).toBe(6);
    expect(Object.keys(mockStorageFiles).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Resolve Endpoints
// ═══════════════════════════════════════════════════════════════

describe("POST /api/resolve/uids-to-uniqueIds", () => {
  test("returns mapping for known users", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };
    mockUsers["user-2"] = { displayName: "Bob", uniqueId: 99 };

    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", { uids: ["user-1", "user-2"] }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping["user-1"].uniqueId).toBe(42);
    expect(res.body.mapping["user-2"].displayName).toBe("Bob");
  });

  test("returns empty mapping for empty array", async () => {
    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", { uids: [] }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping).toEqual({});
  });

  test("rejects non-array input", async () => {
    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", { uids: "bad" }, "valid");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/resolve/uniqueIds-to-uids", () => {
  test("returns mapping for known uniqueIds", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };

    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", { uniqueIds: [42] }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping["42"]).toBe("user-1");
  });

  test("returns empty for empty array", async () => {
    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", { uniqueIds: [] }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping).toEqual({});
  });

  test("rejects non-array input", async () => {
    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", { uniqueIds: "bad" }, "valid");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// Batch Cleanup Operations
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-backpacks", () => {
  test("clears backpack items for all users", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockBackpacks["rose"] = { quantity: 5 };

    const res = await request("POST", "/api/cleanup/all-backpacks", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("succeeds with no users", async () => {
    const res = await request("POST", "/api/cleanup/all-backpacks", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/cleanup/all-giftwalls", () => {
  test("succeeds and returns result", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };

    const res = await request("POST", "/api/cleanup/all-giftwalls", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/cleanup/all-coins", () => {
  test("resets coins for users with positive balance", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 500 };
    mockUsers["user-2"] = { displayName: "Bob", shyCoins: 100 };

    const res = await request("POST", "/api/cleanup/all-coins", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("succeeds with no users having coins", async () => {
    const res = await request("POST", "/api/cleanup/all-coins", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/cleanup/all-beans", () => {
  test("resets beans for users with positive balance", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyBeans: 200 };

    const res = await request("POST", "/api/cleanup/all-beans", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/cleanup/all-warnings", () => {
  test("clears warnings for warned users", async () => {
    mockUsers["user-1"] = { displayName: "Alice", warningCount: 3, hasActiveWarning: true, goodCharacterScore: 50 };

    const res = await request("POST", "/api/cleanup/all-warnings", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("POST /api/cleanup/all-spin-history", () => {
  test("succeeds and returns result", async () => {
    mockUsers["user-1"] = { displayName: "Alice", pityCounter: 10 };

    const res = await request("POST", "/api/cleanup/all-spin-history", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Conversations
// ═══════════════════════════════════════════════════════════════

describe("GET /api/conversations/:id/messages", () => {
  test("returns messages for a conversation", async () => {
    mockMessages["msg-1"] = { text: "Hello", senderId: "user-1", timestamp: mockFakeTimestamp(new Date()) };

    const res = await request("GET", "/api/conversations/conv-1/messages", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.messages).toBeDefined();
  });

  test("returns empty array when no messages", async () => {
    const res = await request("GET", "/api/conversations/conv-1/messages", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Appeals
// ═══════════════════════════════════════════════════════════════

describe("GET /api/appeals", () => {
  test("returns pending appeals", async () => {
    mockSuspensionAppeals["a1"] = {
      userId: "user-1",
      status: "pending",
      reason: "I was wrongly suspended",
      submittedAt: mockFakeTimestamp(new Date()),
    };
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };

    const res = await request("GET", "/api/appeals?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.appeals.length).toBe(1);
    expect(res.body.appeals[0].userId).toBe("user-1");
  });

  test("rejects invalid status", async () => {
    const res = await request("GET", "/api/appeals?status=invalid", null, "valid");
    expect(res.status).toBe(400);
  });

  test("returns empty list when no appeals", async () => {
    const res = await request("GET", "/api/appeals?status=pending", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.appeals).toEqual([]);
  });
});

describe("PATCH /api/appeals/:id", () => {
  beforeEach(() => {
    mockSuspensionAppeals["a1"] = {
      userId: "user-1",
      status: "pending",
      reason: "Wrongly suspended",
    };
    mockUsers["user-1"] = {
      displayName: "Suspended Account",
      isSuspended: true,
      _preSuspension: { displayName: "Alice", profilePhotoUrl: "url", coverPhotoUrl: "cover" },
    };
  });

  test("approves appeal and lifts suspension", async () => {
    const res = await request("PATCH", "/api/appeals/a1", { status: "approved" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockSuspensionAppeals["a1"].status).toBe("approved");
    expect(mockUsers["user-1"].isSuspended).toBe(false);
    expect(mockUsers["user-1"].displayName).toBe("Alice");
  });

  test("rejects appeal without lifting suspension", async () => {
    const res = await request("PATCH", "/api/appeals/a1", { status: "rejected", adminNote: "Nope" }, "valid");
    expect(res.status).toBe(200);
    expect(mockSuspensionAppeals["a1"].status).toBe("rejected");
    expect(mockUsers["user-1"].isSuspended).toBe(true);
  });

  test("returns 404 for non-existent appeal", async () => {
    const res = await request("PATCH", "/api/appeals/fake", { status: "approved" }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects invalid status", async () => {
    const res = await request("PATCH", "/api/appeals/a1", { status: "maybe" }, "valid");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// Economy Config
// ═══════════════════════════════════════════════════════════════

describe("GET /api/config/economy", () => {
  test("returns economy config", async () => {
    mockConfig["economy"] = { beanConversionRate: 0.6, gachaCost: 50 };

    const res = await request("GET", "/api/config/economy", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.config.beanConversionRate).toBe(0.6);
  });

  test("returns empty config when not set", async () => {
    const res = await request("GET", "/api/config/economy", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.config).toEqual({});
  });
});

describe("PUT /api/config/economy", () => {
  test("updates economy config", async () => {
    mockConfig["economy"] = { beanConversionRate: 0.6 };

    const res = await request("PUT", "/api/config/economy", { beanConversionRate: 0.8 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("rejects non-object body", async () => {
    const res = await request("PUT", "/api/config/economy", "bad", "valid");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// Gift Catalog CRUD
// ═══════════════════════════════════════════════════════════════

describe("GET /api/gifts", () => {
  test("returns all gifts", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, order: 1 };
    mockGifts["heart"] = { name: "Heart", coinValue: 10, order: 2 };

    const res = await request("GET", "/api/gifts", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.gifts.length).toBe(2);
  });

  test("returns empty list when no gifts", async () => {
    const res = await request("GET", "/api/gifts", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.gifts).toEqual([]);
  });
});

describe("POST /api/gifts", () => {
  test("creates a new gift", async () => {
    const res = await request("POST", "/api/gifts", { name: "Diamond", coinValue: 100 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBe("diamond");
    expect(res.body.gift.showInStore).toBe(true);
  });

  test("rejects missing name", async () => {
    const res = await request("POST", "/api/gifts", { coinValue: 100 }, "valid");
    expect(res.status).toBe(400);
  });

  test("rejects duplicate gift", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };
    const res = await request("POST", "/api/gifts", { name: "Rose", coinValue: 8 }, "valid");
    expect(res.status).toBe(409);
  });
});

describe("POST /api/gifts/seed", () => {
  test("seeds gift catalog", async () => {
    const res = await request("POST", "/api/gifts/seed", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(27);
  });
});

describe("PUT /api/gifts/:id", () => {
  test("updates an existing gift", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, order: 1 };

    const res = await request("PUT", "/api/gifts/rose", { coinValue: 15 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("returns 404 for non-existent gift", async () => {
    const res = await request("PUT", "/api/gifts/fake", { coinValue: 10 }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects empty update", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };
    const res = await request("PUT", "/api/gifts/rose", {}, "valid");
    expect(res.status).toBe(400);
  });

  test("updates showInStore to false", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, showInStore: true };
    const res = await request("PUT", "/api/gifts/rose", { showInStore: false }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"].showInStore).toBe(false);
  });

  test("updates showInStore to true", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, showInStore: false };
    const res = await request("PUT", "/api/gifts/rose", { showInStore: true }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"].showInStore).toBe(true);
  });

  test("updates showOnWheel to false", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, showOnWheel: true };
    const res = await request("PUT", "/api/gifts/rose", { showOnWheel: false }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"].showOnWheel).toBe(false);
  });

  test("updates showOnWheel to true", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8, showOnWheel: false };
    const res = await request("PUT", "/api/gifts/rose", { showOnWheel: true }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"].showOnWheel).toBe(true);
  });
});

describe("DELETE /api/gifts/:id", () => {
  test("deletes an existing gift", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };

    const res = await request("DELETE", "/api/gifts/rose", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"]).toBeUndefined();
  });

  test("returns 404 for non-existent gift", async () => {
    const res = await request("DELETE", "/api/gifts/fake", null, "valid");
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// User Economy Endpoints
// ═══════════════════════════════════════════════════════════════

describe("GET /api/users/:uid/economy", () => {
  test("returns user economy data", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 500, shyBeans: 200, luckScore: 10, pityCounter: 5 };

    const res = await request("GET", "/api/users/user-1/economy", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.shyCoins).toBe(500);
    expect(res.body.shyBeans).toBe(200);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("GET", "/api/users/fake/economy", null, "valid");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/users/:uid/backpack", () => {
  test("returns backpack items", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockBackpacks["rose"] = { quantity: 3 };
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };

    const res = await request("GET", "/api/users/user-1/backpack", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
  });
});

describe("POST /api/users/:uid/backpack", () => {
  test("adds item to backpack", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };

    const res = await request("POST", "/api/users/user-1/backpack", { giftId: "rose", quantity: 5 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("rejects missing giftId", async () => {
    const res = await request("POST", "/api/users/user-1/backpack", { quantity: 5 }, "valid");
    expect(res.status).toBe(400);
  });

  test("rejects missing quantity", async () => {
    const res = await request("POST", "/api/users/user-1/backpack", { giftId: "rose" }, "valid");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/users/:uid/luck", () => {
  test("returns luck score", async () => {
    mockUsers["user-1"] = { displayName: "Alice", luckScore: 15, pityCounter: 3 };

    const res = await request("GET", "/api/users/user-1/luck", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.luckScore).toBe(15);
    expect(res.body.pityCounter).toBe(3);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("GET", "/api/users/fake/luck", null, "valid");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/users/:uid/luck", () => {
  test("updates luck score", async () => {
    mockUsers["user-1"] = { displayName: "Alice", luckScore: 0, pityCounter: 0 };

    const res = await request("POST", "/api/users/user-1/luck", { luckScore: 50, pityCounter: 10 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("rejects out-of-range luckScore", async () => {
    mockUsers["user-1"] = { displayName: "Alice", luckScore: 0 };
    const res = await request("POST", "/api/users/user-1/luck", { luckScore: 200 }, "valid");
    expect(res.status).toBe(400);
  });

  test("rejects out-of-range pityCounter", async () => {
    mockUsers["user-1"] = { displayName: "Alice", pityCounter: 0 };
    const res = await request("POST", "/api/users/user-1/luck", { pityCounter: 100 }, "valid");
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/users/fake/luck", { luckScore: 10 }, "valid");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/users/:uid/adjust-balance", () => {
  test("adds coins to user", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 100 };

    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "COINS", amount: 50, operation: "add",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newBalance).toBe(150);
  });

  test("deducts beans from user", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyBeans: 100 };

    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "BEANS", amount: 30, operation: "deduct",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(70);
  });

  test("balance does not go below 0", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 10 };

    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "COINS", amount: 100, operation: "deduct",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(0);
  });

  test("rejects invalid currency", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "GOLD", amount: 10, operation: "add",
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("rejects invalid operation", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "COINS", amount: 10, operation: "multiply",
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/users/fake/adjust-balance", {
      currency: "COINS", amount: 10, operation: "add",
    }, "valid");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/users/:uid/transactions", () => {
  test("returns transaction history", async () => {
    mockTransactionsStore["tx-1"] = { type: "GIFT_SENT", amount: -10, timestamp: mockFakeTimestamp(new Date()) };

    const res = await request("GET", "/api/users/user-1/transactions", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.transactions).toBeDefined();
  });

  test("returns empty list when no transactions", async () => {
    const res = await request("GET", "/api/users/user-1/transactions", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// Guarantee Next Pull
// ═══════════════════════════════════════════════════════════════

describe("POST /api/users/:uid/guarantee-next-pull", () => {
  test("sets guarantee for valid gift", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };

    const res = await request("POST", "/api/users/user-1/guarantee-next-pull", { giftId: "rose" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.giftName).toBe("Rose");
  });

  test("returns 404 for non-existent gift", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/users/user-1/guarantee-next-pull", { giftId: "fake" }, "valid");
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent user", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };
    const res = await request("POST", "/api/users/fake/guarantee-next-pull", { giftId: "rose" }, "valid");
    expect(res.status).toBe(404);
  });

  test("rejects missing giftId", async () => {
    const res = await request("POST", "/api/users/user-1/guarantee-next-pull", {}, "valid");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/users/:uid/guarantee-next-pull", () => {
  test("returns active guarantee", async () => {
    mockUsers["user-1"] = {
      displayName: "Alice",
      guaranteedNextPull: { giftId: "rose", setBy: "admin-1", setAt: mockFakeTimestamp(new Date()) },
    };
    mockGifts["rose"] = { name: "Rose", coinValue: 8 };

    const res = await request("GET", "/api/users/user-1/guarantee-next-pull", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body.giftName).toBe("Rose");
  });

  test("returns inactive when no guarantee", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };

    const res = await request("GET", "/api/users/user-1/guarantee-next-pull", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("GET", "/api/users/fake/guarantee-next-pull", null, "valid");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/users/:uid/guarantee-next-pull", () => {
  test("clears guarantee", async () => {
    mockUsers["user-1"] = {
      displayName: "Alice",
      guaranteedNextPull: { giftId: "rose", setBy: "admin-1" },
    };

    const res = await request("DELETE", "/api/users/user-1/guarantee-next-pull", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("returns 404 for non-existent user", async () => {
    const res = await request("DELETE", "/api/users/fake/guarantee-next-pull", null, "valid");
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════
// Cleanup All Super Shy
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-supershy", () => {
  test("removes Super Shy from all users", async () => {
    // Setup: 2 users with isSuperShy: true
    mockUsers["user-1"] = { displayName: "A", isSuperShy: true, superShyExpiry: "2025-12-31", superShyTier: "monthly" };
    mockUsers["user-2"] = { displayName: "B", isSuperShy: true, superShyExpiry: "2025-11-30", superShyTier: "lifetime" };

    const res = await request("POST", "/api/cleanup/all-supershy", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(2);
  });

  test("returns 0 when no Super Shy users exist", async () => {
    // No users with isSuperShy: true
    const res = await request("POST", "/api/cleanup/all-supershy", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.usersCleared).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Cleanup System Conversations
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/system-conversations", () => {
  test("deletes duplicate system conversations with auto-generated IDs", async () => {
    // Setup: a system conversation with a non-deterministic ID (wrong doc ID)
    // Expected ID for SHYTALK_SYSTEM + user1 is "SHYTALK_SYSTEM_user1" (sorted)
    // Use a doc ID that doesn't match the expected sorted join
    mockConversations["auto_12345"] = {
      participantIds: ["SHYTALK_SYSTEM", "user1"],
    };

    const res = await request("POST", "/api/cleanup/system-conversations", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.deleted).toContain("auto_12345");
  });

  test("keeps correctly-IDed system conversations with messages", async () => {
    // This conversation has the correct deterministic ID
    mockConversations["SHYTALK_SYSTEM_user1"] = {
      participantIds: ["SHYTALK_SYSTEM", "user1"],
    };
    // Add a message so it's not deleted as empty
    mockMessages["msg-1"] = { text: "Welcome!", senderId: "SHYTALK_SYSTEM" };

    const res = await request("POST", "/api/cleanup/system-conversations", {}, "valid");
    expect(res.status).toBe(200);
    // The correctly-IDed conversation should not be in the deleted list
    const deletedWithoutEmpty = res.body.deleted.filter(id => !id.includes("(empty)"));
    expect(deletedWithoutEmpty).not.toContain("SHYTALK_SYSTEM_user1");
  });

  test("returns 200 with empty list when no system conversations exist", async () => {
    const res = await request("POST", "/api/cleanup/system-conversations", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.deleted).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/user/:uid - edge cases
// ═══════════════════════════════════════════════════════════════

describe("PATCH /api/user/:uid - edge cases", () => {
  test("rejects update to non-existent user", async () => {
    const res = await request("PATCH", "/api/user/nonexistent", { displayName: "New" }, "valid");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("updates multiple fields at once", async () => {
    mockUsers["user-1"] = { displayName: "Old", description: "old bio", uniqueId: 1 };
    const res = await request("PATCH", "/api/user/user-1", {
      displayName: "New Name",
      description: "new bio",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain("displayName");
    expect(res.body.updatedFields).toContain("description");
    expect(mockUsers["user-1"].displayName).toBe("New Name");
    expect(mockUsers["user-1"].description).toBe("new bio");
  });

  test("rejects empty update body", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", {}, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/i);
  });

  test("rejects non-object body", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", "not-an-object", "valid");
    expect(res.status).toBe(400);
  });

  test("rejects mix of valid and invalid fields", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("PATCH", "/api/user/user-1", {
      displayName: "Bob",
      unknownField: "bad",
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown field/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/user/:uid/suspend - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/user/:uid/suspend - edge cases", () => {
  test("suspends with reason, duration, and stores suspendedBy", async () => {
    mockUsers["user-1"] = { displayName: "User", isSuspended: false, profilePhotoUrl: "pic" };
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Spam",
      endDate: futureDate,
      canAppeal: true,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionReason).toBe("Spam");
    expect(mockUsers["user-1"].suspensionCanAppeal).toBe(true);
    expect(mockUsers["user-1"].suspendedBy).toBe("admin-1");
    expect(mockUsers["user-1"].suspensionEndDate).toBeDefined();
  });

  test("rejects suspension of non-existent user", async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const res = await request("POST", "/api/user/nonexistent/suspend", {
      reason: "Spam",
      endDate: futureDate,
      canAppeal: false,
    }, "valid");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("rejects suspension without canAppeal boolean", async () => {
    mockUsers["user-1"] = { displayName: "User" };
    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Spam",
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/canAppeal/i);
  });

  test("rejects suspension with endDate in the past", async () => {
    mockUsers["user-1"] = { displayName: "User" };
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Spam",
      endDate: pastDate,
      canAppeal: false,
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/future/i);
  });

  test("suspends indefinitely when endDate is null", async () => {
    mockUsers["user-1"] = { displayName: "User", profilePhotoUrl: "pic" };
    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Severe violation",
      endDate: null,
      canAppeal: false,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(true);
    expect(mockUsers["user-1"].suspensionEndDate).toBeNull();
  });

  test("stores pre-suspension profile data", async () => {
    mockUsers["user-1"] = {
      displayName: "Original Name",
      profilePhotoUrl: "photo.jpg",
      coverPhotoUrl: "cover.jpg",
    };
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const res = await request("POST", "/api/user/user-1/suspend", {
      reason: "Bad behavior",
      endDate: futureDate,
      canAppeal: true,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"]._preSuspension).toBeDefined();
    expect(mockUsers["user-1"]._preSuspension.displayName).toBe("Original Name");
    expect(mockUsers["user-1"]._preSuspension.profilePhotoUrl).toBe("photo.jpg");
    expect(mockUsers["user-1"]._preSuspension.coverPhotoUrl).toBe("cover.jpg");
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reports/:id/resolve - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/reports/:id/resolve - edge cases", () => {
  beforeEach(() => {
    mockReports["report-edge"] = {
      reportedUserId: "user-edge",
      reporterId: "reporter-edge",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-edge"] = {
      displayName: "Offender",
      goodCharacterScore: 100,
      goodCharacterLastDeductionAt: null,
      warningCount: 2,
    };
  });

  test("warn action increments warningCount", async () => {
    const res = await request("POST", "/api/reports/report-edge/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // warningCount was 2, incremented by 1 via FieldValue.increment
    expect(mockUsers["user-edge"].warningCount).toBe(3);
    expect(mockUsers["user-edge"].hasActiveWarning).toBe(true);
    expect(mockUsers["user-edge"].warningReason).toBe("Harassment");
  });

  test("suspend action sets isSuspended and stores pre-suspension data", async () => {
    mockUsers["user-edge"].profilePhotoUrl = "photo.jpg";
    mockUsers["user-edge"].coverPhotoUrl = "cover.jpg";

    const res = await request("POST", "/api/reports/report-edge/resolve", {
      action: "suspend",
      severity: 3,
      suspensionDays: 14,
      canAppeal: false,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUsers["user-edge"].isSuspended).toBe(true);
    expect(mockUsers["user-edge"].suspensionCanAppeal).toBe(false);
    expect(mockUsers["user-edge"]._preSuspension).toBeDefined();
    expect(mockUsers["user-edge"]._preSuspension.displayName).toBe("Offender");
  });

  test("warn with severity 1 deducts 5 GCS points", async () => {
    const res = await request("POST", "/api/reports/report-edge/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    // 100 - (1*5) = 95
    expect(mockUsers["user-edge"].goodCharacterScore).toBe(95);
  });

  test("warn filters 'Other' reason to 'a policy violation'", async () => {
    mockReports["report-edge"].reason = "Other";
    const res = await request("POST", "/api/reports/report-edge/resolve", {
      action: "warn",
      severity: 1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-edge"].warningReason).toBe("a policy violation");
  });

  test("dismiss does not increment warningCount or change GCS", async () => {
    const res = await request("POST", "/api/reports/report-edge/resolve", {
      action: "dismiss",
    }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-edge"].warningCount).toBe(2); // unchanged
    expect(mockUsers["user-edge"].goodCharacterScore).toBe(100); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════
// Gift Management - edge cases
// ═══════════════════════════════════════════════════════════════

describe("Gift management - edge cases", () => {
  test("PUT /api/gifts/:id updates name only", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10, iconUrl: "icon.png", order: 1 };
    const res = await request("PUT", "/api/gifts/rose", { name: "Red Rose" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGifts["rose"].name).toBe("Red Rose");
    // Other fields remain unchanged
    expect(mockGifts["rose"].coinValue).toBe(10);
  });

  test("PUT /api/gifts/:id updates multiple allowed fields", async () => {
    mockGifts["heart"] = { name: "Heart", coinValue: 10, iconUrl: "", order: 1, showInStore: true };
    const res = await request("PUT", "/api/gifts/heart", {
      coinValue: 20,
      order: 5,
      iconUrl: "new_icon.png",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.updatedFields).toContain("coinValue");
    expect(res.body.updatedFields).toContain("order");
    expect(res.body.updatedFields).toContain("iconUrl");
    expect(mockGifts["heart"].coinValue).toBe(20);
    expect(mockGifts["heart"].order).toBe(5);
  });

  test("PUT /api/gifts/:id rejects negative coinValue", async () => {
    mockGifts["rose"] = { name: "Rose", coinValue: 10 };
    const res = await request("PUT", "/api/gifts/rose", { coinValue: -5 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative/i);
  });

  test("POST /api/gifts rejects missing coinValue", async () => {
    const res = await request("POST", "/api/gifts", { name: "Star" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/coinValue/i);
  });

  test("POST /api/gifts normalises ID from name", async () => {
    const res = await request("POST", "/api/gifts", { name: "Lucky Clover", coinValue: 30 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("lucky_clover");
  });

  test("POST /api/gifts ignores unknown fields in body", async () => {
    const res = await request("POST", "/api/gifts", {
      name: "Gem",
      coinValue: 50,
      fakeField: "ignored",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.gift.fakeField).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/user/:uid/unsuspend - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/user/:uid/unsuspend - edge cases", () => {
  test("returns 404 for non-existent user", async () => {
    const res = await request("POST", "/api/user/nonexistent/unsuspend", {}, "valid");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  test("unsuspend without pre-suspension data keeps current profile", async () => {
    mockUsers["user-1"] = {
      displayName: "Suspended Account",
      isSuspended: true,
    };

    const res = await request("POST", "/api/user/user-1/unsuspend", {}, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-1"].isSuspended).toBe(false);
    expect(mockUsers["user-1"].displayName).toBe("Suspended Account");
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/user/:uid/warn - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/user/:uid/warn - edge cases", () => {
  test("rejects severity above 5", async () => {
    mockUsers["user-1"] = { displayName: "User", goodCharacterScore: 100, warningCount: 0 };
    const res = await request("POST", "/api/user/user-1/warn", { reason: "Spam", severity: 6 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/severity/i);
  });

  test("rejects empty reason string", async () => {
    mockUsers["user-1"] = { displayName: "User", goodCharacterScore: 100, warningCount: 0 };
    const res = await request("POST", "/api/user/user-1/warn", { reason: "", severity: 2 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  test("severity 1 deducts exactly 5 GCS", async () => {
    mockUsers["user-1"] = { displayName: "User", goodCharacterScore: 100, warningCount: 0 };
    const res = await request("POST", "/api/user/user-1/warn", { reason: "Spam", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newGCS).toBe(95);
    expect(mockUsers["user-1"].goodCharacterScore).toBe(95);
  });

  test("increments warningCount correctly from existing value", async () => {
    mockUsers["user-1"] = { displayName: "User", goodCharacterScore: 100, warningCount: 3 };
    const res = await request("POST", "/api/user/user-1/warn", { reason: "Spam", severity: 1 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.warningCount).toBe(4);
    expect(mockUsers["user-1"].warningCount).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/users/:uid/adjust-balance - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/users/:uid/adjust-balance - edge cases", () => {
  test("rejects non-positive amount", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 100 };
    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "COINS", amount: 0, operation: "add",
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("adds beans correctly", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyBeans: 50 };
    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "BEANS", amount: 100, operation: "add",
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.newBalance).toBe(150);
  });

  test("rejects missing amount", async () => {
    mockUsers["user-1"] = { displayName: "Alice", shyCoins: 100 };
    const res = await request("POST", "/api/users/user-1/adjust-balance", {
      currency: "COINS", operation: "add",
    }, "valid");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/users/:uid/backpack - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/users/:uid/backpack - edge cases", () => {
  test("zero quantity deletes backpack item", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockBackpacks["rose"] = { quantity: 5 };
    const res = await request("POST", "/api/users/user-1/backpack", {
      giftId: "rose", quantity: 0,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("negative quantity deletes backpack item", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockBackpacks["rose"] = { quantity: 3 };
    const res = await request("POST", "/api/users/user-1/backpack", {
      giftId: "rose", quantity: -1,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("rejects non-number quantity", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    const res = await request("POST", "/api/users/user-1/backpack", {
      giftId: "rose", quantity: "five",
    }, "valid");
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/reports/export - edge cases
// ═══════════════════════════════════════════════════════════════

describe("GET /api/reports/export - edge cases", () => {
  test("exports CSV with correct headers and data row", async () => {
    const ts = mockFakeTimestamp(new Date("2025-06-15"));
    mockReports["r-export-1"] = {
      status: "resolved",
      resolvedAt: ts,
      timestamp: ts,
      reporterName: "Reporter One",
      reportedUserName: "Offender One",
      type: "message",
      reason: "Spam",
      resolvedAction: "warn",
      severity: 3,
      adminNote: "Warned for spamming",
    };
    mockReports["r-export-2"] = {
      status: "resolved",
      resolvedAt: ts,
      timestamp: ts,
      reporterName: "Reporter Two",
      reportedUserName: "Offender Two",
      type: "profile",
      reason: "Inappropriate content",
      resolvedAction: "dismiss",
      severity: null,
      adminNote: "False alarm",
    };

    const res = await request("GET", "/api/reports/export?from=2025-01-01&to=2025-12-31", null, "valid");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);

    const lines = res.body.split("\n");
    expect(lines[0]).toBe("Report ID,Reporter,Reported User,Type,Reason,Action Taken,Severity,Admin Note,Created At,Resolved At");
    // Two data rows
    expect(lines.length).toBe(3);
  });

  test("exports headers-only CSV when no resolved reports in range", async () => {
    // No reports at all
    const res = await request("GET", "/api/reports/export?from=2025-01-01&to=2025-12-31", null, "valid");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);

    const lines = res.body.split("\n");
    // Only the header row
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/Report ID,Reporter/);
  });

  test("escapes CSV special characters in fields", async () => {
    const ts = mockFakeTimestamp(new Date("2025-06-15"));
    mockReports["r-csv-escape"] = {
      status: "resolved",
      resolvedAt: ts,
      timestamp: ts,
      reporterName: 'Reporter "Quoted"',
      reportedUserName: "Offender, With Comma",
      type: "message",
      reason: "Spam",
      resolvedAction: "warn",
      severity: 2,
      adminNote: "Note with \"quotes\"",
    };

    const res = await request("GET", "/api/reports/export?from=2025-01-01&to=2025-12-31", null, "valid");
    expect(res.status).toBe(200);

    const lines = res.body.split("\n");
    expect(lines.length).toBe(2);
    // Verify quotes are escaped (doubled) in CSV
    expect(lines[1]).toContain('""Quoted""');
    expect(lines[1]).toContain('""quotes""');
  });
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/appeals/:id - edge cases
// ═══════════════════════════════════════════════════════════════

describe("PATCH /api/appeals/:id - edge cases", () => {
  beforeEach(() => {
    mockSuspensionAppeals["appeal-edge"] = {
      userId: "user-appeal",
      status: "pending",
      reason: "I was wrongly suspended",
      submittedAt: mockFakeTimestamp(new Date()),
    };
    mockUsers["user-appeal"] = {
      displayName: "Suspended Account",
      isSuspended: true,
      suspensionReason: "Harassment",
      _preSuspension: { displayName: "Original Name", profilePhotoUrl: "photo.jpg", coverPhotoUrl: "cover.jpg" },
    };
  });

  test("approve appeal unsuspends user and restores profile", async () => {
    const res = await request("PATCH", "/api/appeals/appeal-edge", { status: "approved" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Appeal updated
    expect(mockSuspensionAppeals["appeal-edge"].status).toBe("approved");
    expect(mockSuspensionAppeals["appeal-edge"].reviewedBy).toBe("admin-1");

    // User unsuspended and profile restored
    expect(mockUsers["user-appeal"].isSuspended).toBe(false);
    expect(mockUsers["user-appeal"].suspensionAppealStatus).toBe("approved");
    expect(mockUsers["user-appeal"].displayName).toBe("Original Name");
    expect(mockUsers["user-appeal"].profilePhotoUrl).toBe("photo.jpg");
    expect(mockUsers["user-appeal"].coverPhotoUrl).toBe("cover.jpg");
  });

  test("reject appeal keeps user suspended", async () => {
    const res = await request("PATCH", "/api/appeals/appeal-edge", { status: "rejected", adminNote: "Denial reason" }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Appeal updated
    expect(mockSuspensionAppeals["appeal-edge"].status).toBe("rejected");
    expect(mockSuspensionAppeals["appeal-edge"].adminNote).toBe("Denial reason");

    // User stays suspended
    expect(mockUsers["user-appeal"].isSuspended).toBe(true);
    expect(mockUsers["user-appeal"].suspensionAppealStatus).toBe("rejected");
  });

  test("rejects invalid status value", async () => {
    const res = await request("PATCH", "/api/appeals/appeal-edge", { status: "pending" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status must be approved or rejected/);
  });

  test("rejects non-existent appeal", async () => {
    const res = await request("PATCH", "/api/appeals/nonexistent-appeal", { status: "approved" }, "valid");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Appeal not found/);
  });

  test("approve appeal without _preSuspension keeps current profile", async () => {
    // User without _preSuspension data
    mockUsers["user-appeal"] = {
      displayName: "Current Name",
      isSuspended: true,
    };

    const res = await request("PATCH", "/api/appeals/appeal-edge", { status: "approved" }, "valid");
    expect(res.status).toBe(200);
    expect(mockUsers["user-appeal"].isSuspended).toBe(false);
    expect(mockUsers["user-appeal"].displayName).toBe("Current Name");
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/search/uniqueId/:id - edge cases
// ═══════════════════════════════════════════════════════════════

describe("GET /api/search/uniqueId/:id - edge cases", () => {
  test("returns 404 for non-existent uniqueId", async () => {
    const res = await request("GET", "/api/search/uniqueId/99999", null, "valid");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No user found/i);
  });

  test("returns user data for valid uniqueId", async () => {
    mockUsers["user-search"] = {
      displayName: "SearchUser",
      uniqueId: 12345,
      description: "A test user",
      createdAt: mockFakeTimestamp(new Date("2025-01-01")),
    };

    const res = await request("GET", "/api/search/uniqueId/12345", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe("user-search");
    expect(res.body.displayName).toBe("SearchUser");
    expect(res.body.uniqueId).toBe(12345);
    // Timestamps should be converted to ISO strings
    expect(typeof res.body.createdAt).toBe("string");
  });

  test("returns 400 for non-numeric uniqueId", async () => {
    const res = await request("GET", "/api/search/uniqueId/abc", null, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be a number/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/reports/resolve-all/:reportedUserId - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/reports/resolve-all/:reportedUserId - edge cases", () => {
  test("resolves all pending reports for a user via dismiss", async () => {
    mockReports["ra1"] = {
      reportedUserId: "user-batch",
      reporterId: "reporter-1",
      reason: "Spam",
      status: "pending",
    };
    mockReports["ra2"] = {
      reportedUserId: "user-batch",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockReports["ra3"] = {
      reportedUserId: "user-batch",
      reporterId: "reporter-3",
      reason: "Inappropriate content",
      status: "pending",
    };
    mockUsers["user-batch"] = {
      displayName: "BatchUser",
      goodCharacterScore: 100,
      warningCount: 0,
    };

    const res = await request("POST", "/api/reports/resolve-all/user-batch", {
      action: "dismiss",
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.resolvedCount).toBe(3);
    // Dismiss should not change GCS
    expect(mockUsers["user-batch"].goodCharacterScore).toBe(100);
    expect(mockUsers["user-batch"].warningCount).toBe(0);
  });

  test("returns 404 when no pending reports exist for user", async () => {
    // User exists but has no pending reports
    mockUsers["user-clean"] = { displayName: "Clean User", goodCharacterScore: 100 };

    const res = await request("POST", "/api/reports/resolve-all/user-clean", {
      action: "dismiss",
    }, "valid");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No pending reports/i);
  });

  test("bulk suspend sets isSuspended and stores pre-suspension data", async () => {
    mockReports["rs1"] = {
      reportedUserId: "user-suspend-batch",
      reporterId: "reporter-1",
      reason: "Severe abuse",
      status: "pending",
    };
    mockReports["rs2"] = {
      reportedUserId: "user-suspend-batch",
      reporterId: "reporter-2",
      reason: "Harassment",
      status: "pending",
    };
    mockUsers["user-suspend-batch"] = {
      displayName: "SuspendMe",
      profilePhotoUrl: "profile.jpg",
      coverPhotoUrl: "cover.jpg",
      goodCharacterScore: 80,
      warningCount: 1,
    };

    const res = await request("POST", "/api/reports/resolve-all/user-suspend-batch", {
      action: "suspend",
      severity: 4,
      suspensionDays: 30,
      canAppeal: true,
    }, "valid");

    expect(res.status).toBe(200);
    expect(res.body.resolvedCount).toBe(2);
    expect(mockUsers["user-suspend-batch"].isSuspended).toBe(true);
    expect(mockUsers["user-suspend-batch"].suspensionCanAppeal).toBe(true);
    expect(mockUsers["user-suspend-batch"]._preSuspension).toBeDefined();
    expect(mockUsers["user-suspend-batch"]._preSuspension.displayName).toBe("SuspendMe");
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/storage/audit - edge cases
// ═══════════════════════════════════════════════════════════════

describe("GET /api/storage/audit - edge cases", () => {
  test("returns audit data with all zeroes when storage is empty", async () => {
    const res = await request("GET", "/api/storage/audit", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pm_images.files).toBe(0);
    expect(res.body.pm_images.bytes).toBe(0);
    expect(res.body.stickers.files).toBe(0);
    expect(res.body.stickers.bytes).toBe(0);
    expect(res.body.report_evidence.files).toBe(0);
    expect(res.body.profile_photos.files).toBe(0);
    expect(res.body.cover_photos.files).toBe(0);
  });

  test("returns correct counts across multiple folders", async () => {
    mockStorageFiles["pm_images/u1/a.jpg"] = true;
    mockStorageFiles["pm_images/u1/b.jpg"] = true;
    mockStorageFiles["pm_images/u2/c.jpg"] = true;
    mockStorageFiles["profile_photos/u1/photo.jpg"] = true;
    mockStorageFiles["cover_photos/u1/cover.jpg"] = true;
    mockStorageFiles["report_evidence/r1/ev.png"] = true;

    const res = await request("GET", "/api/storage/audit", null, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pm_images.files).toBe(3);
    expect(res.body.pm_images.bytes).toBe(3072); // 3 * 1024
    expect(res.body.profile_photos.files).toBe(1);
    expect(res.body.profile_photos.bytes).toBe(1024);
    expect(res.body.cover_photos.files).toBe(1);
    expect(res.body.report_evidence.files).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/config/economy - edge cases
// ═══════════════════════════════════════════════════════════════

describe("PUT /api/config/economy - edge cases", () => {
  test("updates partial config fields via merge", async () => {
    mockConfig["economy"] = { maxRoomDurationMinutes: 360, pullCosts: { single: 10, multi: 100 } };
    const res = await request("PUT", "/api/config/economy", { maxRoomDurationMinutes: 720 }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain("maxRoomDurationMinutes");
    // Original field should still exist because of merge
    expect(mockConfig["economy"].maxRoomDurationMinutes).toBe(720);
  });

  test("rejects negative values for number fields", async () => {
    mockConfig["economy"] = { beanConversionRate: 0.6 };
    const res = await request("PUT", "/api/config/economy", { beanConversionRate: -5 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non-negative/i);
  });

  test("rejects unknown config fields", async () => {
    const res = await request("PUT", "/api/config/economy", { unknownField: 42 }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown field/i);
  });

  test("rejects empty body", async () => {
    const res = await request("PUT", "/api/config/economy", {}, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No valid fields/i);
  });

  test("rejects non-finite number values", async () => {
    const res = await request("PUT", "/api/config/economy", { dailyBase: "not-a-number" }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finite number/i);
  });

  test("accepts valid object fields like pullCosts", async () => {
    const res = await request("PUT", "/api/config/economy", {
      pullCosts: { single: 50, multi: 400 },
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toContain("pullCosts");
  });

  test("rejects object field with non-number values", async () => {
    const res = await request("PUT", "/api/config/economy", {
      pullCosts: { single: "fifty" },
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/finite number/i);
  });

  test("rejects array as object field", async () => {
    const res = await request("PUT", "/api/config/economy", {
      milestoneRewards: [10, 20, 30],
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be an object/i);
  });

  test("rejects null as object field", async () => {
    const res = await request("PUT", "/api/config/economy", {
      pullCosts: null,
    }, "valid");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must be an object/i);
  });

  test("updates multiple config fields at once", async () => {
    const res = await request("PUT", "/api/config/economy", {
      beanConversionRate: 0.8,
      dailyBase: 50,
      normalSeatCount: 8,
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.updatedFields).toEqual(
      expect.arrayContaining(["beanConversionRate", "dailyBase", "normalSeatCount"])
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-backpacks - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-backpacks - edge cases", () => {
  test("returns usersCleared and itemsDeleted counts", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockBackpacks["rose"] = { quantity: 5 };
    mockBackpacks["heart"] = { quantity: 3 };

    const res = await request("POST", "/api/cleanup/all-backpacks", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.usersCleared).toBe("number");
    expect(typeof res.body.itemsDeleted).toBe("number");
  });

  test("handles multiple users with backpack items", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };
    mockUsers["user-2"] = { displayName: "Bob" };
    mockBackpacks["rose"] = { quantity: 5 };

    const res = await request("POST", "/api/cleanup/all-backpacks", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-giftwalls - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-giftwalls - edge cases", () => {
  test("returns usersCleared and itemsDeleted counts", async () => {
    mockUsers["user-1"] = { displayName: "Alice" };

    const res = await request("POST", "/api/cleanup/all-giftwalls", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.usersCleared).toBe("number");
    expect(typeof res.body.itemsDeleted).toBe("number");
  });

  test("succeeds with no users in system", async () => {
    const res = await request("POST", "/api/cleanup/all-giftwalls", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(0);
    expect(res.body.itemsDeleted).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-coins - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-coins - edge cases", () => {
  test("returns usersCleared count", async () => {
    mockUsers["user-1"] = { displayName: "A", shyCoins: 5000 };
    mockUsers["user-2"] = { displayName: "B", shyCoins: 3000 };

    const res = await request("POST", "/api/cleanup/all-coins", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(2);
  });

  test("skips users with zero coins", async () => {
    mockUsers["user-1"] = { displayName: "A", shyCoins: 0 };
    mockUsers["user-2"] = { displayName: "B", shyCoins: 500 };

    const res = await request("POST", "/api/cleanup/all-coins", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Only user-2 has positive coins
    expect(res.body.usersCleared).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-beans - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-beans - edge cases", () => {
  test("returns usersCleared count", async () => {
    mockUsers["user-1"] = { displayName: "A", shyBeans: 5000 };
    mockUsers["user-2"] = { displayName: "B", shyBeans: 100 };

    const res = await request("POST", "/api/cleanup/all-beans", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(2);
  });

  test("succeeds with no users having beans", async () => {
    const res = await request("POST", "/api/cleanup/all-beans", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(0);
  });

  test("skips users with zero beans", async () => {
    mockUsers["user-1"] = { displayName: "A", shyBeans: 0 };

    const res = await request("POST", "/api/cleanup/all-beans", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.usersCleared).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-spin-history - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-spin-history - edge cases", () => {
  test("returns usersCleared, txDeleted, and pityReset counts", async () => {
    mockUsers["user-1"] = { displayName: "Alice", pityCounter: 10 };

    const res = await request("POST", "/api/cleanup/all-spin-history", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.usersCleared).toBe("number");
    expect(typeof res.body.txDeleted).toBe("number");
    expect(typeof res.body.pityReset).toBe("number");
  });

  test("succeeds with no users in system", async () => {
    const res = await request("POST", "/api/cleanup/all-spin-history", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.usersCleared).toBe(0);
    expect(res.body.txDeleted).toBe(0);
    expect(res.body.pityReset).toBe(0);
  });

  test("resets pity counter for users with positive value", async () => {
    mockUsers["user-1"] = { displayName: "Alice", pityCounter: 15 };
    mockUsers["user-2"] = { displayName: "Bob", pityCounter: 0 };

    const res = await request("POST", "/api/cleanup/all-spin-history", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pityReset).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/cleanup/all-warnings - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/cleanup/all-warnings - edge cases", () => {
  test("returns cleared count", async () => {
    mockUsers["user-1"] = { displayName: "A", warningCount: 3, hasActiveWarning: true, goodCharacterScore: 50 };
    mockUsers["user-2"] = { displayName: "B", warningCount: 1, hasActiveWarning: true, goodCharacterScore: 75 };

    const res = await request("POST", "/api/cleanup/all-warnings", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.cleared).toBe("number");
    expect(res.body.cleared).toBeGreaterThanOrEqual(2);
  });

  test("succeeds with no warned users", async () => {
    mockUsers["user-1"] = { displayName: "A", warningCount: 0, hasActiveWarning: false };

    const res = await request("POST", "/api/cleanup/all-warnings", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("also clears users with hasActiveWarning but warningCount 0", async () => {
    // Edge case: user has active warning flag but count is already 0
    mockUsers["user-1"] = { displayName: "A", warningCount: 0, hasActiveWarning: true };

    const res = await request("POST", "/api/cleanup/all-warnings", {}, "valid");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The endpoint clears hasActiveWarning users separately
    expect(res.body.cleared).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/resolve/uids-to-uniqueIds - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/resolve/uids-to-uniqueIds - edge cases", () => {
  test("handles mix of found and not-found uids", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 12345 };

    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", {
      uids: ["user-1", "unknown-user"],
    }, "valid");
    expect(res.status).toBe(200);
    // Found user should be in mapping
    expect(res.body.mapping["user-1"]).toBeDefined();
    expect(res.body.mapping["user-1"].uniqueId).toBe(12345);
    expect(res.body.mapping["user-1"].displayName).toBe("Alice");
    // Unknown user should not be in mapping
    expect(res.body.mapping["unknown-user"]).toBeUndefined();
  });

  test("rejects non-string array items", async () => {
    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", {
      uids: [123, 456],
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("handles single uid", async () => {
    mockUsers["user-1"] = { displayName: "Solo", uniqueId: 42 };

    const res = await request("POST", "/api/resolve/uids-to-uniqueIds", {
      uids: ["user-1"],
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping["user-1"].uniqueId).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════
// POST /api/resolve/uniqueIds-to-uids - edge cases
// ═══════════════════════════════════════════════════════════════

describe("POST /api/resolve/uniqueIds-to-uids - edge cases", () => {
  test("handles mix of found and not-found uniqueIds", async () => {
    mockUsers["user-1"] = { displayName: "Alice", uniqueId: 42 };

    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", {
      uniqueIds: [42, 99999],
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping["42"]).toBe("user-1");
    // Unknown uniqueId should not appear
    expect(res.body.mapping["99999"]).toBeUndefined();
  });

  test("rejects non-number array items", async () => {
    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", {
      uniqueIds: ["abc", "def"],
    }, "valid");
    expect(res.status).toBe(400);
  });

  test("handles single uniqueId", async () => {
    mockUsers["user-1"] = { displayName: "Solo", uniqueId: 7 };

    const res = await request("POST", "/api/resolve/uniqueIds-to-uids", {
      uniqueIds: [7],
    }, "valid");
    expect(res.status).toBe(200);
    expect(res.body.mapping["7"]).toBe("user-1");
  });
});

/**
 * Tests for worker/index.js — Cloudflare Storage Proxy Worker
 *
 * Uses Vitest (native ESM support) with plain JS object mocks for the
 * Worker request/env interface. global.fetch is stubbed to control
 * Firebase token verification responses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "./index.js";

// ── Constants ────────────────────────────────────────────────────────────────

const TEST_UID = "test-uid-123";
const TEST_TOKEN = "valid-firebase-token";
const WORKER_URL = "https://worker.example.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stub global fetch for Firebase token verification calls */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFirebaseSuccess(uid = TEST_UID) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ users: [{ localId: uid }] }),
  });
}

function mockFirebaseHttpError() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({}),
  });
}

function mockFirebaseEmptyUsers() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ users: [] }),
  });
}

/**
 * Builds a minimal request-like object compatible with the worker's fetch handler.
 * Uses a plain object to avoid Web API quirks (e.g. Request.formData multipart parsing).
 */
function makeReq(method, pathname, headers = {}) {
  const allHeaders = { Authorization: `Bearer ${TEST_TOKEN}`, ...headers };
  return {
    url: `${WORKER_URL}${pathname}`,
    method,
    headers: {
      get: (key) => {
        const match = Object.entries(allHeaders).find(
          ([k]) => k.toLowerCase() === key.toLowerCase()
        );
        return match ? match[1] : null;
      },
    },
  };
}

function makeReqNoAuth(method, pathname) {
  return {
    url: `${WORKER_URL}${pathname}`,
    method,
    headers: { get: () => null },
  };
}

/**
 * Builds an upload request with a mocked formData() method so we can
 * test handleUpload logic without actually parsing multipart/form-data.
 */
function makeUploadReq({ file, path } = {}) {
  const mockFile = file ?? {
    type: "image/jpeg",
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
  };
  return {
    url: `${WORKER_URL}/upload`,
    method: "POST",
    headers: {
      get: (key) =>
        key.toLowerCase() === "authorization" ? `Bearer ${TEST_TOKEN}` : null,
    },
    formData: vi.fn().mockResolvedValue({
      get: (key) => {
        if (key === "file") return mockFile;
        if (key === "path") return path ?? "profile_photos";
        return null;
      },
    }),
  };
}

function makeEnv(r2Overrides = {}) {
  return {
    FIREBASE_API_KEY: "test-api-key",
    R2_BUCKET: {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      ...r2Overrides,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── CORS ─────────────────────────────────────────────────────────────────────

describe("CORS preflight", () => {
  it("returns 200 with CORS headers for OPTIONS", async () => {
    const req = makeReqNoAuth("OPTIONS", "/upload");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  });

  it("does not call Firebase or R2 for OPTIONS requests", async () => {
    const req = makeReqNoAuth("OPTIONS", "/upload");
    const env = makeEnv();
    await worker.fetch(req, env);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(env.R2_BUCKET.put).not.toHaveBeenCalled();
  });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("Authorization", () => {
  it("returns 401 with no Authorization header", async () => {
    const req = makeReqNoAuth("POST", "/upload");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header is not Bearer scheme", async () => {
    const req = makeReq("POST", "/upload", { Authorization: "Basic dXNlcjpwYXNz" });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("does not contact Firebase when no auth header is present", async () => {
    const req = makeReqNoAuth("POST", "/upload");
    await worker.fetch(req, makeEnv());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when Firebase token verification HTTP call fails", async () => {
    mockFirebaseHttpError();
    const req = makeReq("POST", "/upload");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid token");
  });

  it("returns 401 when Firebase returns empty users array", async () => {
    mockFirebaseEmptyUsers();
    const req = makeReq("POST", "/upload");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("passes idToken from Bearer header to Firebase verification", async () => {
    mockFirebaseSuccess();
    const req = makeReq("DELETE", `/delete?key=photos/${TEST_UID}/x.jpg`);
    await worker.fetch(req, makeEnv());
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.idToken).toBe(TEST_TOKEN);
  });
});

// ── Routing ───────────────────────────────────────────────────────────────────

describe("Routing", () => {
  it("returns 404 for unknown path", async () => {
    mockFirebaseSuccess();
    const res = await worker.fetch(makeReq("GET", "/unknown"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 404 for GET to /upload", async () => {
    mockFirebaseSuccess();
    const res = await worker.fetch(makeReq("GET", "/upload"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 404 for POST to /delete", async () => {
    mockFirebaseSuccess();
    const res = await worker.fetch(makeReq("POST", "/delete"), makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 404 for DELETE to /upload", async () => {
    mockFirebaseSuccess();
    const res = await worker.fetch(makeReq("DELETE", "/upload"), makeEnv());
    expect(res.status).toBe(404);
  });
});

// ── POST /upload ──────────────────────────────────────────────────────────────

describe("POST /upload", () => {
  it("uploads file to R2 and returns 200 with public URL", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = makeUploadReq({ path: "profile_photos" });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toMatch(
      /^https:\/\/images\.shytalk\.shyden\.co\.uk\/profile_photos\/.+\.jpg$/
    );
    expect(env.R2_BUCKET.put).toHaveBeenCalledOnce();
  });

  it("URL includes authenticated uid in the path", async () => {
    mockFirebaseSuccess("my-special-uid");
    const env = makeEnv();
    const req = makeUploadReq({ path: "profile_photos" });
    const res = await worker.fetch(req, env);

    const { url } = await res.json();
    expect(url).toContain("/my-special-uid/");

    const [putKey] = env.R2_BUCKET.put.mock.calls[0];
    expect(putKey).toContain("my-special-uid");
  });

  it("R2 put is called with correct bucket key and content type", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = makeUploadReq({
      file: { type: "image/png", arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5)) },
      path: "cover_photos",
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const [, , putOptions] = env.R2_BUCKET.put.mock.calls[0];
    expect(putOptions).toMatchObject({ httpMetadata: { contentType: "image/png" } });
  });

  it("returns 400 when file is missing from form data", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = {
      url: `${WORKER_URL}/upload`,
      method: "POST",
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${TEST_TOKEN}` : null) },
      formData: vi.fn().mockResolvedValue({ get: (k) => (k === "path" ? "profile_photos" : null) }),
    };
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(400);
    expect(env.R2_BUCKET.put).not.toHaveBeenCalled();
  });

  it("returns 400 when path is missing from form data", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = {
      url: `${WORKER_URL}/upload`,
      method: "POST",
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${TEST_TOKEN}` : null) },
      formData: vi.fn().mockResolvedValue({
        get: (k) =>
          k === "file"
            ? { type: "image/jpeg", arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(3)) }
            : null,
      }),
    };
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(400);
  });

  it("returns 400 when formData() throws (invalid body)", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = {
      url: `${WORKER_URL}/upload`,
      method: "POST",
      headers: { get: (k) => (k.toLowerCase() === "authorization" ? `Bearer ${TEST_TOKEN}` : null) },
      formData: vi.fn().mockRejectedValue(new Error("Invalid multipart")),
    };
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(400);
    expect(env.R2_BUCKET.put).not.toHaveBeenCalled();
  });

  // ── getExtension coverage via upload ────────────────────────────────

  it.each([
    ["image/png", /\.png$/],
    ["image/gif", /\.gif$/],
    ["image/webp", /\.webp$/],
    ["image/jpeg", /\.jpg$/],
    ["image/bmp", /\.jpg$/], // unknown → fallback jpg
    ["application/octet-stream", /\.jpg$/], // unknown → fallback jpg
    ["video/mp4", /\.mp4$/],
    ["video/quicktime", /\.mov$/],
    ["video/avi", /\.avi$/],
  ])("uses correct extension for %s", async (contentType, pattern) => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = makeUploadReq({
      file: { type: contentType, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(3)) },
      path: "pm_images",
    });
    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toMatch(pattern);
  });

  it("uses jpg when file.type is empty string (defaults to image/jpeg)", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const req = makeUploadReq({
      file: { type: "", arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(3)) },
      path: "profile_photos",
    });
    const res = await worker.fetch(req, env);

    const { url } = await res.json();
    expect(url).toMatch(/\.jpg$/);
  });
});

// ── DELETE /delete ────────────────────────────────────────────────────────────

describe("DELETE /delete", () => {
  it("deletes from R2 and returns {ok: true}", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const key = `profile_photos/${TEST_UID}/123.jpg`;
    const res = await worker.fetch(makeReq("DELETE", `/delete?key=${key}`), env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(env.R2_BUCKET.delete).toHaveBeenCalledWith(key);
  });

  it("returns 400 when key param is missing", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const res = await worker.fetch(makeReq("DELETE", "/delete"), env);

    expect(res.status).toBe(400);
    expect(env.R2_BUCKET.delete).not.toHaveBeenCalled();
  });

  it("returns 403 when key belongs to a different user", async () => {
    mockFirebaseSuccess("uid-alice");
    const env = makeEnv();
    const res = await worker.fetch(
      makeReq("DELETE", "/delete?key=profile_photos/uid-bob/photo.jpg"),
      env
    );

    expect(res.status).toBe(403);
    expect(env.R2_BUCKET.delete).not.toHaveBeenCalled();
  });

  it("returns 403 when key has no uid segment at all", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    // Key has no /{uid}/ component — just top-level filename
    const res = await worker.fetch(
      makeReq("DELETE", "/delete?key=profile_photos/orphan.jpg"),
      env
    );

    expect(res.status).toBe(403);
  });

  it("allows user to delete their own cover photo", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const key = `cover_photos/${TEST_UID}/cover.jpg`;
    const res = await worker.fetch(makeReq("DELETE", `/delete?key=${key}`), env);

    expect(res.status).toBe(200);
    expect(env.R2_BUCKET.delete).toHaveBeenCalledWith(key);
  });

  it("allows user to delete their own sticker", async () => {
    mockFirebaseSuccess();
    const env = makeEnv();
    const key = `stickers/${TEST_UID}/sticker.gif`;
    const res = await worker.fetch(makeReq("DELETE", `/delete?key=${key}`), env);

    expect(res.status).toBe(200);
    expect(env.R2_BUCKET.delete).toHaveBeenCalledWith(key);
  });
});

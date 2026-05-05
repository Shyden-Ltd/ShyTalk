import { test, expect } from "./fixtures/scenarios";

/**
 * Integration test #4 — Photo upload → R2 (MinIO) round-trip.
 *
 * Verifies the full multipart-upload pipeline:
 *
 *   1. authenticated POST /api/storage/upload with a multipart PNG
 *   2. multer parses the multipart body
 *   3. imageCompressor (sharp) enforces MIN_DIMENSION + ALLOWED_MIME
 *   4. r2.putObject writes to the MinIO mock bucket
 *   5. the returned URL is publicly fetchable and serves the bytes
 *   6. DELETE /api/storage/delete removes the object
 *   7. subsequent GET returns 404
 *
 * What this catches that no unit test can:
 *   - MinIO container actually serving on :9002 with the expected bucket
 *   - sharp pipeline working against real PNG bytes (codec install)
 *   - S3 SDK's PutObject ACL/public-read behaviour (the policy that
 *     makes the URL publicly fetchable without a presigned request)
 *   - DELETE actually removes the object from the backing store, not
 *     just from a Firestore row (a class of bug that PR #481
 *     exposed at the dev-smoke tier)
 *
 * Per `.project/plans/2026-05-05-integration-test-framework.md` test #4.
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:3000";

// 100×100 black PNG, ~130 bytes. imageCompressor.js enforces
// MIN_DIMENSION=100 and rejects smaller PNGs with ImagePolicyError → 400,
// so anything smaller would silently mask sharp/MinIO failures behind a
// validation 400. Sharing the same constant verbatim with the smoke
// suite's TEST_PNG_100X100 (tests/web/dev-smoke.spec.ts:514) — promoting
// it to a shared helper is deferred until the third consumer arrives,
// per the no-orphan-fixture rule.
const TEST_PNG_100X100 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA" +
    "NElEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAujF1lAAB" +
    "e5jSrAAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Integration — Photo upload → R2 round-trip", () => {
  test("uploads a PNG, fetches it back, then deletes it cleanly", async ({
    api,
    sender,
  }) => {
    // Phase 1 — multipart upload. Do NOT set Content-Type on the
    // request; Playwright's `multipart` option sets the
    // multipart/form-data boundary automatically.
    const upload = await api.post(`${API_BASE}/api/storage/upload`, {
      headers: { Authorization: `Bearer ${sender.idToken}` },
      multipart: {
        path: "evidence", // ALLOWED_UPLOAD_PATHS — does NOT mutate user doc
        file: {
          name: "integration.png",
          mimeType: "image/png",
          buffer: TEST_PNG_100X100,
        },
      },
    });
    expect(
      upload.ok(),
      `upload expected 200, got ${upload.status()}: ${await upload.text()}`,
    ).toBe(true);

    const body = await upload.json();
    expect(typeof body.url, `body.url shape: ${JSON.stringify(body)}`).toBe(
      "string",
    );
    // Local stack: URL points at MinIO via http://localhost:9002/<bucket>/<key>.
    // This is the contract Express's r2.js produces in `isLocal` mode
    // (see express-api/src/utils/r2.js:48). Asserting on the prefix
    // catches a misconfigured CDN_URL or a future change that would
    // hand a non-fetchable URL back to the client.
    expect(body.url, `URL must point at the local MinIO bucket`).toMatch(
      /^http:\/\/localhost:9002\/[^/]+\//,
    );

    // Extract the key UP-FRONT so the cleanup-in-finally below can
    // delete the object even if a later assertion throws. The
    // `sender` fixture only tears down Firestore-tagged docs (see
    // fixtures/scenarios.ts) — it has no R2 hook, so a mid-test
    // failure would otherwise leak one MinIO object per failed run.
    const url = new URL(body.url);
    const pathParts = url.pathname.split("/").filter((p) => p.length > 0);
    expect(
      pathParts.length,
      `URL pathname must include bucket + key, got "${url.pathname}"`,
    ).toBeGreaterThanOrEqual(2);
    const key = pathParts.slice(1).join("/");

    try {
      // Phase 2 — verify the object is publicly fetchable. MinIO is
      // strongly consistent for PUT-then-GET so no retry is needed.
      const fetched = await api.get(body.url);
      expect(
        fetched.ok(),
        `fetch-back expected 200, got ${fetched.status()} for ${body.url}`,
      ).toBe(true);
      const ct = fetched.headers()["content-type"] || "";
      expect(ct, `fetched content-type must be image/*, got "${ct}"`).toMatch(
        /^image\//,
      );
      const bytes = await fetched.body();
      // The compressed file may be smaller than the input (sharp may
      // strip metadata or re-encode), so we only assert non-empty here.
      // Byte-for-byte equality belongs to the unit tests for sharp;
      // the integration tier proves the file made it through.
      expect(
        bytes.length,
        `fetched image must be non-empty, got ${bytes.length} bytes`,
      ).toBeGreaterThan(0);

      // Phase 3 — DELETE. r2.deleteObject expects the key (no bucket
      // prefix). The cleanup-in-finally would also delete it, but we
      // assert the route's response here so a broken DELETE handler
      // is caught explicitly rather than masked by a successful
      // background sweep.
      const del = await api.delete(
        `${API_BASE}/api/storage/delete?key=${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${sender.idToken}` } },
      );
      expect(
        del.ok(),
        `delete expected 200, got ${del.status()}: ${await del.text()}`,
      ).toBe(true);

      // Phase 4 — verify the object is actually gone. MinIO does
      // NOT sit behind a CDN, so unlike the dev-smoke equivalent we
      // don't need a cache-buster. Strict 404 confirms DELETE
      // actually removed the object from storage (not just from a
      // Firestore index).
      const reFetch = await api.get(body.url);
      expect(
        reFetch.status(),
        `post-delete fetch must 404, got ${reFetch.status()} for ${body.url}`,
      ).toBe(404);
    } finally {
      // Idempotent best-effort cleanup. If Phase 3 succeeded the
      // object is already gone and the route returns 200 (DELETE on
      // a missing key is a no-op) — we still assert nothing here
      // because the goal is leak prevention, not correctness of
      // double-DELETE. Auth errors and 4xx are swallowed so a test
      // assertion failure is what surfaces, not the cleanup outcome.
      await api
        .delete(
          `${API_BASE}/api/storage/delete?key=${encodeURIComponent(key)}`,
          { headers: { Authorization: `Bearer ${sender.idToken}` } },
        )
        .catch(() => {
          /* swallow — leak prevention is best-effort */
        });
    }
  });

  test("returns 400 for an undersized image (MIN_DIMENSION gate)", async ({
    api,
    sender,
  }) => {
    // 1×1 PNG to verify the policy gate works through the integration
    // chain. The ImagePolicyError → 400 mapping is unit-tested in
    // express-api/tests/storage.test.js, but the integration tier
    // proves it survives the multer layer (which is mocked in unit
    // tests) without a 500 leaking through.
    const TEST_PNG_1X1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );

    const upload = await api.post(`${API_BASE}/api/storage/upload`, {
      headers: { Authorization: `Bearer ${sender.idToken}` },
      multipart: {
        path: "evidence",
        file: {
          name: "tiny.png",
          mimeType: "image/png",
          buffer: TEST_PNG_1X1,
        },
      },
    });
    expect(upload.status()).toBe(400);
    const body = await upload.json();
    // Pin to the exact substring imageCompressor.js:47 produces
    // (`...below minimum WIDTHxHEIGHT`). A copy edit there will fail
    // this assertion — desirable, because if THAT message changes the
    // route's tests should also be re-checked. Looser regex variants
    // could mask a regression that returned a generic 400 from a
    // different gate (e.g. multer file-size limit) and silently pass.
    expect(body.error).toContain("below minimum");
  });

  test("returns 400 for a disallowed upload path", async ({ api, sender }) => {
    // The path allow-list is enforced BEFORE compression
    // (storage.js:45). Catches a class of bug where a future refactor
    // moves the check after multipart parsing — would then permit a
    // path-traversal attack via the `path` field.
    const upload = await api.post(`${API_BASE}/api/storage/upload`, {
      headers: { Authorization: `Bearer ${sender.idToken}` },
      multipart: {
        path: "../../etc/passwd",
        file: {
          name: "x.png",
          mimeType: "image/png",
          buffer: TEST_PNG_100X100,
        },
      },
    });
    expect(upload.status()).toBe(400);
    const body = await upload.json();
    expect(body.error).toMatch(/invalid upload path|disallowed/i);
  });
});

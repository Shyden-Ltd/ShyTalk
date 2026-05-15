import {
  test,
  expect,
  request as pwRequest,
  APIRequestContext,
} from "@playwright/test";

/**
 * Dev deployment smoke tests — exercise critical user-facing API
 * journeys against the deployed dev environment so the deploy goes
 * RED on infrastructure regressions (auth, Firestore rules, R2,
 * LiveKit token issuance, transactional wallet writes).
 *
 * This is intentionally distinct from `dev-sanity.spec.ts`, which
 * only checks page loads. The smoke suite signs in as a real test
 * user via Firebase Auth REST and exercises authenticated endpoints
 * end-to-end.
 *
 * Targets:
 *   - dev: API_BASE_URL=https://dev-api.shytalk.shyden.co.uk
 *   - local: API_BASE_URL=http://localhost:3000 (run during pre-push
 *     hook; see playwright.config.ts dev-smoke project)
 *
 * Failure semantics: every assertion must hold, otherwise the deploy
 * job goes red and the operator gets a failure email. There is no
 * "warn-only" mode — see `feedback-tests-always-block`.
 *
 * Auth: signs in via Firebase Auth REST `signInWithPassword`. The
 * test account email is fixed (`SMOKE_TEST_EMAIL`); the password
 * comes from a CI secret. We DO NOT use the admin Firebase token
 * because admin-claim accounts bypass several gates and would mask
 * real-user regressions. The smoke account is a regular user.
 */

const API_BASE = process.env.API_BASE_URL;
const FIREBASE_API_KEY = process.env.SMOKE_FIREBASE_API_KEY;
const SMOKE_EMAIL = process.env.SMOKE_TEST_EMAIL;
const SMOKE_PASSWORD = process.env.SMOKE_TEST_PASSWORD;
const DEV_BASIC_AUTH_PASSWORD = process.env.DEV_BASIC_AUTH_PASSWORD;
// UK OSA #17 PR 7 added a same-cohort gate to `/api/livekit/token` that
// reads `rooms/{roomName}` and 404s if the doc is absent (existence-
// hiding). The smoke suite mints a token against a real Firestore room
// doc (created via Firestore REST API as the smoke user), so we need
// the project ID for the REST endpoint URL. Default keeps the suite
// runnable against dev without a per-job override.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "shytalk-dev";
// Target user the smoke account follows/unfollows during the journey
// test. MUST be a different uniqueId than the smoke account (the route
// rejects self-follow with 400). On dev, uniqueId 10000008/10000009
// are documented orphan accounts safe to use as inert targets — see
// reference-dev-smoke-account.md.
const SMOKE_TARGET_UNIQUE_ID = process.env.SMOKE_TARGET_UNIQUE_ID;

// Firebase Auth REST endpoint — production identitytoolkit. The
// smoke suite never targets the local Auth emulator because its
// purpose is to verify the deployed Firebase Auth project.
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

// Skip the whole file when prerequisites are missing — keeps `npx
// playwright test` runnable locally without the full secret bundle.
test.skip(
  !API_BASE || !FIREBASE_API_KEY || !SMOKE_EMAIL || !SMOKE_PASSWORD || !SMOKE_TARGET_UNIQUE_ID,
  "dev-smoke requires API_BASE_URL, SMOKE_FIREBASE_API_KEY, SMOKE_TEST_EMAIL, SMOKE_TEST_PASSWORD, SMOKE_TARGET_UNIQUE_ID",
);

// HTTP Basic credentials for the dev web gate (NOT for API). Only
// applies to web pages; the API has its own auth.
if (DEV_BASIC_AUTH_PASSWORD) {
  test.use({
    httpCredentials: { username: "dev", password: DEV_BASIC_AUTH_PASSWORD },
  });
}

interface SmokeAuth {
  api: APIRequestContext;
  idToken: string;
  refreshToken: string;
  uniqueId: number;
  targetUniqueId: number;
}

let smoke: SmokeAuth;

test.beforeAll(async () => {
  // 1. Sign in via Firebase Auth REST — same path real clients
  //    take. A regression here means the entire app cannot sign in.
  const api = await pwRequest.newContext();
  const signIn = await api.post(FIREBASE_SIGN_IN_URL, {
    headers: { "Content-Type": "application/json" },
    data: {
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      returnSecureToken: true,
    },
  });
  if (!signIn.ok()) {
    throw new Error(
      `Firebase sign-in failed (${signIn.status()}): ${await signIn.text()}. ` +
        `Verify SMOKE_FIREBASE_API_KEY + SMOKE_TEST_EMAIL/PASSWORD in CI secrets.`,
    );
  }
  const signInBody = await signIn.json();
  const idToken: string = signInBody.idToken;
  const refreshToken: string = signInBody.refreshToken;
  expect(idToken, "idToken returned").toBeTruthy();
  expect(
    refreshToken,
    "refreshToken returned (needed to refresh claims after Express sign-in)",
  ).toBeTruthy();

  // 2. Sign in to Express — exchanges the Firebase token for the
  //    server-side `uniqueId`. Catches the firebaseUid → uniqueId
  //    resolution path in the auth middleware AND the suspension
  //    cache wiring.
  //
  //    Wire format: `{ provider, identifier }` — the route looks
  //    up `identityMap/{provider}:{identifier}` to find the user.
  //    `email` as a top-level field is NOT accepted by the route
  //    handler, so we send `provider: 'email'` + `identifier: <email>`
  //    matching what the smoke account was registered with via
  //    POST /api/users (provider 'email'). A regression here means
  //    real email-provider sign-in is broken.
  const expressSignIn = await api.post(`${API_BASE}/api/users/sign-in`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    data: { provider: "email", identifier: SMOKE_EMAIL },
  });
  expect(
    expressSignIn.ok(),
    `Express /api/users/sign-in must succeed (${expressSignIn.status()}: ${await expressSignIn.text()})`,
  ).toBe(true);
  const me = await expressSignIn.json();
  // The route returns `{ found: true, uniqueId }`. `found: false`
  // means the identity-map row is missing — the smoke account was
  // never registered (or got deleted). Fail loud rather than letting
  // a downstream test produce a confusing 404.
  expect(me.found, `sign-in returned found=${me.found}: ${JSON.stringify(me)}`).toBe(true);
  const uniqueId: number = me.uniqueId;
  expect(uniqueId, "uniqueId returned by Express sign-in").toBeTruthy();

  // Parse target uniqueId. Strict integer parse so a typo'd secret
  // (e.g., trailing whitespace, hex value) fails the suite up-front
  // instead of producing a confusing 404 mid-journey.
  const targetUniqueId = Number.parseInt(SMOKE_TARGET_UNIQUE_ID!, 10);
  expect(
    Number.isInteger(targetUniqueId) && targetUniqueId > 0,
    `SMOKE_TARGET_UNIQUE_ID must be a positive integer, got "${SMOKE_TARGET_UNIQUE_ID}"`,
  ).toBe(true);
  expect(
    targetUniqueId,
    "SMOKE_TARGET_UNIQUE_ID must differ from smoke account uniqueId — follow rejects self-follow",
  ).not.toBe(uniqueId);

  smoke = { api, idToken, refreshToken, uniqueId, targetUniqueId };
});

test.afterAll(async () => {
  await smoke?.api?.dispose();
});

function authedHeaders() {
  return {
    Authorization: `Bearer ${smoke.idToken}`,
    "Content-Type": "application/json",
  };
}

test.describe("Dev Smoke — critical user-facing API journeys", () => {
  test("GET /api/health responds OK", async () => {
    // First-line infra check — also covered by dev-sanity, repeated
    // here so this suite is self-contained when run in isolation.
    const res = await smoke.api.get(`${API_BASE}/api/health`);
    expect(res.ok(), `${res.status()}`).toBe(true);
  });

  test("GET /api/users/:uniqueId returns the smoke user (auth round-trip)", async () => {
    // Catches: Firebase token verify, firebaseUid → uniqueId lookup,
    // user-doc Firestore read, suspension-cache miss path. Failure
    // here means real users can't sign in.
    const res = await smoke.api.get(`${API_BASE}/api/users/${smoke.uniqueId}`, {
      headers: authedHeaders(),
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const user = await res.json();
    expect(user.uniqueId).toBe(smoke.uniqueId);
  });

  test("GET /api/economy/balance returns numeric coin + bean balances", async () => {
    // Catches: economy module Firestore reads, transactional balance
    // resolver, response shape contract used by every wallet UI.
    const res = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    // The route returns `{ coins, beans }` (already coerced from the
    // user-doc `shyCoins`/`shyBeans` fields). Both must be numbers —
    // every wallet/IAP/gift flow on the app side reads these. A field
    // rename or omission would hard-break the app.
    expect(typeof body.coins, `coins shape: ${JSON.stringify(body)}`).toBe("number");
    expect(typeof body.beans, `beans shape: ${JSON.stringify(body)}`).toBe("number");
  });

  test("POST /api/economy/daily-reward succeeds OR returns 409 already-claimed (idempotent)", async () => {
    // Catches: transactional Firestore daily-reward update,
    // streak/milestone computation, gift-grant + transaction-log
    // writes. Idempotent across runs — the second smoke run on the
    // same UTC day will see 409, which is also a healthy response.
    const res = await smoke.api.post(`${API_BASE}/api/economy/daily-reward`, {
      headers: authedHeaders(),
    });
    expect(
      [200, 409].includes(res.status()),
      `expected 200 (claimed) or 409 (already claimed today); got ${res.status()}: ${await res.text()}`,
    ).toBe(true);
  });

  test("POST /api/suggestions accepts a smoke submission (public-write path + sanitisation)", async () => {
    // Catches: input sanitisation, language detection, tag
    // validation, Firestore rule on the `suggestions` collection.
    //
    // Pre-clean: withdraw any orphaned `[smoke]`-prefixed pending
    // suggestions from prior runs. Without this, every deploy adds a
    // pending entry that nobody reviews, and after 10 runs the route
    // returns HTTP 429 (`MAX_PENDING_PER_USER` in
    // express-api/src/utils/suggestion-constants.js — observed on the
    // second back-to-back DEV deploy on 2026-05-08). Same idiom as the
    // follow/unfollow journey's pre-clean: assert success because a
    // pre-clean failure would let the rest of the test give misleading
    // results.
    const minePre = await smoke.api.get(`${API_BASE}/api/suggestions/mine`, {
      headers: authedHeaders(),
    });
    expect(
      minePre.ok(),
      `pre-clean GET /suggestions/mine expected 200, got ${minePre.status()}: ${await minePre.text()}`,
    ).toBe(true);
    const minePreBody = (await minePre.json()) as { suggestions?: Array<Record<string, unknown>> };
    const orphans = (minePreBody.suggestions ?? []).filter(
      (s) =>
        s.status === "pending" &&
        typeof s.title === "string" &&
        (s.title as string).startsWith("[smoke]"),
    );
    for (const s of orphans) {
      const del = await smoke.api.delete(`${API_BASE}/api/suggestions/${s.id}`, {
        headers: authedHeaders(),
      });
      expect(
        del.ok(),
        `pre-clean DELETE /suggestions/${s.id} expected 200, got ${del.status()}: ${await del.text()}`,
      ).toBe(true);
    }

    const stamp = new Date().toISOString();
    const res = await smoke.api.post(`${API_BASE}/api/suggestions`, {
      headers: authedHeaders(),
      data: {
        title: `[smoke] dev-deploy smoke ${stamp}`,
        description:
          "Automated smoke submission from dev-deploy pipeline. Safe to delete. " +
          `stamp=${stamp}`,
        language: "en",
      },
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);
    const body = await res.json();
    const newId = (body.id || body.suggestionId) as string | undefined;
    expect(newId, "suggestion id returned").toBeTruthy();

    // Post-clean: withdraw the suggestion we just created. Best-effort
    // — the next run's pre-clean catches anything we miss here.
    if (newId) {
      await smoke.api
        .delete(`${API_BASE}/api/suggestions/${newId}`, { headers: authedHeaders() })
        .catch(() => {});
    }
  });
});

test.describe("Dev Smoke — follow / unfollow journey", () => {
  // Catches: requireOwner auth gate, atomic two-doc batch write to
  // `users/{me}.followingIds` + `users/{target}.followerIds`, public
  // GET path on a non-self user. A regression here breaks the entire
  // social graph on dev — every profile, leaderboard, and follower
  // count derives from these two array fields.
  //
  // Idempotency strategy: leave-clean. The journey ends with the
  // smoke account NOT following the target, so repeated runs do not
  // accumulate state. A best-effort pre-clean unfollow at the start
  // makes the assertion deterministic even if a previous run crashed
  // between the follow and unfollow phases.
  //
  // Assertion side: we verify the *target's* followerIds rather than
  // the smoke user's followingIds. The follow handler uses a
  // transactional `db.batch()` today, so a partial write is impossible
  // at the storage layer — but if a future refactor splits the batch
  // into sequential `await`s, this assertion catches the regression.
  // It also gives the suite its only GET-other-user coverage.

  test("POST follow → GET target shows smoke as a follower → POST unfollow leaves no trace", async () => {
    const followBody = { targetUserId: smoke.targetUniqueId };

    // Pre-clean: unconditional unfollow. arrayRemove is idempotent
    // so this is a 200 no-op when the smoke account is not currently
    // following the target — but we ASSERT 200 (not "best-effort
    // ignore the result") because a 5xx here would mask a recurring
    // failure on the actual follow phase below.
    //
    // Ownership contract (per `feedback-environment-isolation`):
    // the smoke→target follow edge is contractually owned by THIS
    // suite. No admin action, manual test, or second-gate run is
    // permitted to populate it from outside. The pre-clean
    // unconditionally wipes the edge to ensure a deterministic
    // starting state — and it's safe to do so because no external
    // process is allowed to set it. This contract is enforced by
    // the dev environment having ONLY this smoke suite using
    // SMOKE_TARGET_UNIQUE_ID = 10000008.
    const preClean = await smoke.api.post(
      `${API_BASE}/api/users/${smoke.uniqueId}/unfollow`,
      { headers: authedHeaders(), data: followBody },
    );
    expect(
      preClean.ok(),
      `pre-clean unfollow expected 200 (idempotent), got ${preClean.status()}: ${await preClean.text()}`,
    ).toBe(true);

    // Phase 1 — follow.
    const followRes = await smoke.api.post(
      `${API_BASE}/api/users/${smoke.uniqueId}/follow`,
      { headers: authedHeaders(), data: followBody },
    );
    expect(
      followRes.ok(),
      `follow expected 200, got ${followRes.status()}: ${await followRes.text()}`,
    ).toBe(true);
    expect((await followRes.json()).success, "follow body.success=true").toBe(true);

    // Phase 2a — verify the TARGET's view of the fan-out. This
    // catches a regression where the SECOND batch.update fails
    // (target's followerIds doesn't update).
    const targetAfterFollow = await smoke.api.get(
      `${API_BASE}/api/users/${smoke.targetUniqueId}`,
      { headers: authedHeaders() },
    );
    expect(
      targetAfterFollow.ok(),
      `target GET expected 200, got ${targetAfterFollow.status()}: ${await targetAfterFollow.text()}`,
    ).toBe(true);
    const targetBody = await targetAfterFollow.json();
    expect(
      Array.isArray(targetBody.followerIds),
      `target.followerIds must be an array, got ${typeof targetBody.followerIds}`,
    ).toBe(true);
    // Type-strictness check: catches mid-migration drift where the
    // route emits BOTH numeric and string forms of the same id
    // (e.g., [10000007, "10000007"]). A simple .map(Number) would
    // collapse both to 10000007 and the includes() assertion would
    // pass against corrupt data. Asserting strict-number type AND
    // post-coerce dedup catches the drift loud.
    expect(
      targetBody.followerIds.every((x: unknown) => typeof x === "number"),
      `target.followerIds must be strict numbers, got ${JSON.stringify(targetBody.followerIds)}`,
    ).toBe(true);
    const followerIds: number[] = targetBody.followerIds.map(Number);
    expect(
      new Set(followerIds).size,
      `target.followerIds must have no duplicates after coerce: ${JSON.stringify(followerIds)}`,
    ).toBe(followerIds.length);
    expect(
      followerIds.includes(smoke.uniqueId),
      `target.followerIds=${JSON.stringify(followerIds)} must include smoke uniqueId=${smoke.uniqueId} after follow`,
    ).toBe(true);

    // Phase 2b — verify the SMOKE user's own view (followingIds).
    // Symmetric to Phase 2a: catches a regression where the FIRST
    // batch.update fails (smoke's followingIds doesn't update).
    // Together with Phase 2a, asserts both sides of the atomic
    // batch — a partial-write split would now fail one of them.
    const smokeAfterFollow = await smoke.api.get(
      `${API_BASE}/api/users/${smoke.uniqueId}`,
      { headers: authedHeaders() },
    );
    expect(
      smokeAfterFollow.ok(),
      `smoke GET expected 200, got ${smokeAfterFollow.status()}: ${await smokeAfterFollow.text()}`,
    ).toBe(true);
    const smokeBody = await smokeAfterFollow.json();
    expect(
      Array.isArray(smokeBody.followingIds),
      `smoke.followingIds must be an array, got ${typeof smokeBody.followingIds}`,
    ).toBe(true);
    // Same type-strictness + dedup check as Phase 2a.
    expect(
      smokeBody.followingIds.every((x: unknown) => typeof x === "number"),
      `smoke.followingIds must be strict numbers, got ${JSON.stringify(smokeBody.followingIds)}`,
    ).toBe(true);
    const followingIds: number[] = smokeBody.followingIds.map(Number);
    expect(
      new Set(followingIds).size,
      `smoke.followingIds must have no duplicates: ${JSON.stringify(followingIds)}`,
    ).toBe(followingIds.length);
    expect(
      followingIds.includes(smoke.targetUniqueId),
      `smoke.followingIds=${JSON.stringify(followingIds)} must include target uniqueId=${smoke.targetUniqueId} after follow`,
    ).toBe(true);

    // Phase 3 — unfollow.
    const unfollowRes = await smoke.api.post(
      `${API_BASE}/api/users/${smoke.uniqueId}/unfollow`,
      { headers: authedHeaders(), data: followBody },
    );
    expect(
      unfollowRes.ok(),
      `unfollow expected 200, got ${unfollowRes.status()}: ${await unfollowRes.text()}`,
    ).toBe(true);

    // Phase 4a — verify TARGET cleanup. After unfollow the target's
    // followerIds must NOT include the smoke uniqueId.
    const targetAfterUnfollow = await smoke.api.get(
      `${API_BASE}/api/users/${smoke.targetUniqueId}`,
      { headers: authedHeaders() },
    );
    expect(targetAfterUnfollow.ok()).toBe(true);
    const cleanFollowerIds: number[] = (await targetAfterUnfollow.json()).followerIds.map(
      Number,
    );
    expect(
      cleanFollowerIds.includes(smoke.uniqueId),
      `target.followerIds=${JSON.stringify(cleanFollowerIds)} must NOT include smoke uniqueId=${smoke.uniqueId} after unfollow`,
    ).toBe(false);

    // Phase 4b — verify SMOKE cleanup. Symmetric to 4a.
    // The leave-clean promise applies to BOTH users — partial
    // cleanup is just as bad as partial follow.
    const smokeAfterUnfollow = await smoke.api.get(
      `${API_BASE}/api/users/${smoke.uniqueId}`,
      { headers: authedHeaders() },
    );
    expect(smokeAfterUnfollow.ok()).toBe(true);
    const cleanFollowingIds: number[] = (await smokeAfterUnfollow.json()).followingIds.map(
      Number,
    );
    expect(
      cleanFollowingIds.includes(smoke.targetUniqueId),
      `smoke.followingIds=${JSON.stringify(cleanFollowingIds)} must NOT include target uniqueId=${smoke.targetUniqueId} after unfollow`,
    ).toBe(false);
  });

  test("POST follow with targetUserId === self is rejected with 400", async () => {
    // Invariant assertion: the same endpoint that succeeds for a real
    // target must reject self-follow. Costs one extra request and
    // pins down a contract that the app UI relies on (the Follow
    // button is hidden on the user's own profile but the server is
    // the authoritative gate).
    const res = await smoke.api.post(
      `${API_BASE}/api/users/${smoke.uniqueId}/follow`,
      { headers: authedHeaders(), data: { targetUserId: smoke.uniqueId } },
    );
    expect(res.status(), `expected 400 for self-follow, got ${res.status()}`).toBe(400);
  });
});

test.describe("Dev Smoke — voice-room token issuance", () => {
  // Catches: LiveKit AccessToken signing on Express, region resolution
  // (`getRegion`/`getRegionConfig`), LIVEKIT_KEY_*/SECRET_* env vars,
  // auth → identity mapping, response shape contract.
  //
  // Scope: token-only. We verify the JWT *payload structure* but do
  // NOT verify the signature (the smoke runner intentionally has no
  // LiveKit secret — defense-in-depth) and we do NOT actually connect
  // to LiveKit. Real WebRTC reachability would need @livekit/rtc-node
  // (heavy native dep) and would create real participants on the
  // LiveKit server — that belongs in a dedicated integration suite,
  // not a fast smoke gate.
  //
  // Region note: GitHub Actions runners hit dev without Cloudflare's
  // `cf-ipcountry` header, so `getRegion` defaults to 'asia'. Per
  // livekit-region.js, dev should configure all regions to the same
  // LiveKit instance, so this is fine.

  // UK OSA #17 PR 7 added a same-cohort gate on `/api/livekit/token`
  // that requires `rooms/{roomName}` to exist in Firestore AND have a
  // matching `cohort` field. Pre-create a real room doc owned by the
  // smoke user, with the cohort claim from the user's JWT (defaults
  // 'minor' to match the rules-layer fallback). Cleaned up after the
  // suite. We use Firestore REST (not Admin SDK) so the write goes
  // through the rules layer — same as a real iOS/Android client — and
  // a regression in the rooms create rule fails this test loudly.
  let smokeRoomName: string;

  // Token forcibly refreshed in beforeAll so the JWT carries the
  // latest custom claims (uniqueId + cohort) that Express sign-in or
  // pm-lock-check may have minted after the initial Firebase Auth
  // sign-in. Firestore rules read claims from the JWT directly (no
  // server-side claim lookup), so a stale token would fail the
  // rooms-create rule even when the underlying claim *is* set.
  let livekitFreshIdToken: string;

  test.beforeAll(async () => {
    // 1. Refresh the token via Firebase Identity secureToken endpoint.
    //    This is the same call iOS/Android clients make via
    //    `getIdToken(forceRefresh = true)` and is the only way to
    //    surface server-side claim updates into the JWT.
    const refreshRes = await smoke.api.post(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        form: { grant_type: "refresh_token", refresh_token: smoke.refreshToken },
      },
    );
    expect(
      refreshRes.ok(),
      `Token refresh must succeed (${refreshRes.status()}: ${await refreshRes.text()})`,
    ).toBe(true);
    const refreshBody = await refreshRes.json();
    // securetoken endpoint returns id_token (snake_case), distinct
    // from signInWithPassword's idToken (camelCase).
    livekitFreshIdToken = refreshBody.id_token;
    expect(
      livekitFreshIdToken,
      "id_token returned from securetoken refresh",
    ).toBeTruthy();

    // 2. Decode the fresh JWT to read the cohort claim. Match the
    //    firestore.rules fallback exactly: `token.get('cohort',
    //    'minor')` — accounts with no cohort claim are treated as
    //    'minor' by the rules layer, and the LiveKit gate uses the
    //    same fallback (`effectiveCohort` / `cohortFromClaim`), so
    //    stamping 'minor' on the room keeps everything consistent.
    smokeRoomName = `smoke-livekit-${Date.now()}`;
    const jwtParts = livekitFreshIdToken.split(".");
    const jwtPayload = JSON.parse(
      Buffer.from(jwtParts[1], "base64url").toString(),
    );
    const cohort = jwtPayload.cohort === "adult" ? "adult" : "minor";

    // 3. Create the room doc via Firestore REST as the smoke user —
    //    same path as a real iOS/Android client. The
    //    rooms-create rule (firestore.rules) enforces:
    //      • request.resource.data.cohort == request.auth.token.cohort
    //      • cohort ∈ {'adult', 'minor'}
    //      • String(callerUniqueId) == request.resource.data.ownerId
    //    If any rule check fails the response is 403.
    const docUrl =
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rooms?documentId=${smokeRoomName}`;
    const writeRes = await smoke.api.post(docUrl, {
      headers: {
        Authorization: `Bearer ${livekitFreshIdToken}`,
        "Content-Type": "application/json",
      },
      data: {
        // Firestore REST `fields` syntax — typed values per the v1
        // Document protobuf. We stamp the fields the rooms-create
        // rule reads (cohort, ownerId) and a few minimum others that
        // the LiveKit token gate doesn't touch but help operators
        // identify the doc during cleanup investigations.
        fields: {
          cohort: { stringValue: cohort },
          ownerId: { stringValue: String(smoke.uniqueId) },
          name: { stringValue: `[SMOKE] LiveKit test room` },
          state: { stringValue: "ACTIVE" },
          createdAt: { integerValue: String(Date.now()) },
        },
      },
    });
    if (!writeRes.ok()) {
      throw new Error(
        `Firestore REST write to rooms/${smokeRoomName} failed ` +
          `(${writeRes.status()}): ${await writeRes.text()}. ` +
          `Verify FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID}" matches the ` +
          `dev Firebase project, that the smoke account has \`uniqueId\` ` +
          `+ \`cohort\` custom claims minted (run pm-lock-check or re-sign-in ` +
          `as the smoke user), and that the rooms-create rule still permits ` +
          `owner=self + cohort=claim writes.`,
      );
    }
  });

  test.afterAll(async () => {
    if (!smokeRoomName) return;
    // Best-effort cleanup. A leftover smoke room is harmless (it has
    // cohort=smoke-cohort, ownerId=smoke and no participants ever
    // join it), but we delete to keep the dev project tidy across
    // many CI runs. Use the SAME fresh token from beforeAll so the
    // rules-layer delete check (owner-only) passes.
    const docUrl =
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rooms/${smokeRoomName}`;
    await smoke.api
      .delete(docUrl, {
        headers: {
          Authorization: `Bearer ${livekitFreshIdToken || smoke.idToken}`,
        },
      })
      .catch(() => {
        /* swallow — afterAll cleanup must not fail the run */
      });
  });

  test("POST /api/livekit/token returns a signed JWT with correct grants", async () => {
    // Use the pre-created same-cohort room (beforeAll above) so the
    // PR 7 cohort gate matches. We still assert the JWT's `video.room`
    // claim equals exactly what we asked for, so a regression in the
    // grant-stamping path is caught.
    const roomName = smokeRoomName;

    const res = await smoke.api.post(`${API_BASE}/api/livekit/token`, {
      headers: authedHeaders(),
      data: { roomName },
    });
    expect(res.ok(), `${res.status()}: ${await res.text()}`).toBe(true);

    const body = await res.json();
    expect(typeof body.token, `token shape: ${JSON.stringify(body)}`).toBe("string");

    // The dev environment MUST include the LiveKit server URL — only
    // local mode (NODE_ENV === 'local') omits it. Missing URL on dev
    // means LIVEKIT_URL_* env vars are unset, which the iOS/Android
    // clients cannot fall back from.
    expect(
      typeof body.url,
      `url must be returned on dev (NODE_ENV !== 'local'): ${JSON.stringify(body)}`,
    ).toBe("string");
    expect(body.url, `LiveKit URL must be wss:// or ws://`).toMatch(/^wss?:\/\//);

    // Decode JWT payload without signature verification. The smoke
    // runner does NOT have the LiveKit signing secret (defense-in-depth)
    // so we trust the server's claim and inspect structure only. A
    // future signature-verifying test would require giving CI the
    // secret, which we deliberately avoid.
    const parts: string[] = body.token.split(".");
    expect(parts.length, `JWT must have 3 segments, got ${parts.length}`).toBe(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    // Identity = stringified uniqueId (route does String(req.auth.uniqueId)).
    // A drift here means auth → identity mapping is broken; users would
    // appear with random or empty identities in voice rooms.
    expect(payload.sub, "JWT sub must equal stringified smoke uniqueId").toBe(
      String(smoke.uniqueId),
    );

    // Expiry: route sets ttl: '24h'. Window of 23-25h tolerates clock
    // skew between CI runner and dev API. A token with 0 or 1h TTL
    // would silently break long voice sessions.
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSec = payload.exp - nowSec;
    expect(
      ttlSec > 23 * 3600 && ttlSec < 25 * 3600,
      `JWT TTL must be ~24h (got ${ttlSec}s = ${(ttlSec / 3600).toFixed(2)}h)`,
    ).toBe(true);

    // Grants: must allow joining the requested room AND publishing AND
    // subscribing. Missing canPublish would silently mute every user;
    // missing canSubscribe would silently deafen them.
    expect(payload.video?.roomJoin, "video.roomJoin grant").toBe(true);
    expect(payload.video?.room, "video.room must equal requested roomName").toBe(roomName);
    expect(payload.video?.canPublish, "video.canPublish grant").toBe(true);
    expect(payload.video?.canSubscribe, "video.canSubscribe grant").toBe(true);
  });

  test("POST /api/livekit/token without roomName is rejected with 400", async () => {
    // Invariant: roomName is required. Missing roomName must reject
    // pre-flight rather than minting a useless empty-room token (which
    // would burn a LiveKit signing operation and produce a token that
    // the client cannot actually use).
    const res = await smoke.api.post(`${API_BASE}/api/livekit/token`, {
      headers: authedHeaders(),
      data: {},
    });
    expect(res.status(), `expected 400 for missing roomName, got ${res.status()}`).toBe(400);
  });
});

// 100x100 black PNG, ~130 bytes. Generated once via:
//   sharp({create:{width:100,height:100,channels:3,background:'#000'}}).png()
// Embedded as base64 to keep this spec self-contained — no fixture
// file, no new dep. The dimensions matter: imageCompressor.js
// enforces MIN_DIMENSION = 100 and rejects smaller images with
// ImagePolicyError → 400. A 1x1 PNG would silently fail every run.
//
// Reused by the disallowed-path invariant too. Even though that test
// targets a check that runs BEFORE compression, using the same valid
// fixture means the assertion can only fail for the reason we're
// testing — not because the PNG is malformed.
const TEST_PNG_100X100 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA" +
    "NElEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAujF1lAAB" +
    "e5jSrAAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Dev Smoke — R2 image upload", () => {
  // Catches: R2 credentials, R2 PUT path, multer multipart parsing,
  // sharp/imageCompressor pipeline, public-read URL signing.
  //
  // Idempotency strategy: leave-clean at the side-effect level. Each
  // upload creates a unique R2 object; the test DELETEs it before
  // returning so we don't accumulate orphaned objects across runs.
  // The 'evidence' upload-path is chosen because it does NOT update
  // any user-doc field (vs 'profiles' which would mutate
  // smoke.profilePhotoUrl).

  test("POST /api/storage/upload accepts a PNG, URL is reachable, DELETE cleans up", async () => {
    // Phase 1 — upload via multipart. NOTE: do NOT include
    // Content-Type in headers; Playwright's `multipart` option sets
    // the multipart/form-data boundary automatically.
    const upload = await smoke.api.post(`${API_BASE}/api/storage/upload`, {
      headers: { Authorization: `Bearer ${smoke.idToken}` },
      multipart: {
        path: "evidence",
        file: {
          name: "smoke.png",
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
    expect(typeof body.url, `body.url shape: ${JSON.stringify(body)}`).toBe("string");
    expect(body.url, `URL must be https://`).toMatch(/^https:\/\//);

    // Phase 2 — verify the object is publicly reachable. R2 has
    // read-after-write consistency so no retry is needed.
    const fetched = await smoke.api.get(body.url);
    expect(
      fetched.ok(),
      `fetch-back expected 200, got ${fetched.status()} for ${body.url}`,
    ).toBe(true);
    const ct = fetched.headers()["content-type"] || "";
    expect(ct, `fetched content-type must be image/*, got "${ct}"`).toMatch(/^image\//);

    // Phase 3 — cleanup. Extract the R2 key from the public URL
    // pathname (DELETE expects ?key=, NOT the full URL).
    const key = new URL(body.url).pathname.replace(/^\//, "");
    const del = await smoke.api.delete(
      `${API_BASE}/api/storage/delete?key=${encodeURIComponent(key)}`,
      { headers: authedHeaders() },
    );
    expect(
      del.ok(),
      `delete expected 200, got ${del.status()}: ${await del.text()} for key=${key}`,
    ).toBe(true);

    // Phase 4 — verify the object is actually gone. CRITICAL: the
    // upload sets `Cache-Control: public, max-age=31536000, immutable`
    // (r2.js:58), so the Cloudflare edge fronting the bucket will
    // serve a cached 200 for the URL we GET'd in Phase 2 for up to
    // a year. We MUST cache-bust to force a real origin lookup,
    // otherwise this assertion would silently pass even when DELETE
    // is fully broken.
    //
    // Cache-buster strategy: append a unique query string. CF treats
    // query strings as part of the cache key by default, so the
    // bust-URL is guaranteed-uncached. If CF is configured to strip
    // query strings (it isn't on shytalk-dev today), this assertion
    // would fail with `expected 404, got 200 (cache)` — a real
    // configuration regression worth catching.
    //
    // Status: strict 404. R2 returns 404 for missing keys; we don't
    // accept 403 (which would indicate bucket-policy leak / creds
    // rotation gone wrong, NOT a successful delete).
    const verifyDel = await smoke.api.get(`${body.url}?cb=${Date.now()}`);
    expect(
      verifyDel.status(),
      `expected 404 after DELETE, got ${verifyDel.status()} for ${body.url} — ` +
        `object was NOT actually removed and orphans will accumulate. ` +
        `If status is 200, the cache-buster failed to bypass CDN; check CF caching policy.`,
    ).toBe(404);
  });

  test("POST /api/storage/upload with disallowed path is rejected with 400", async () => {
    // Invariant: the path-allowlist is the upload-target ACL. If
    // someone adds a new path-handling code branch but forgets to
    // update ALLOWED_UPLOAD_PATHS, the gate would silently fail open.
    //
    // Reuses the same valid 100x100 PNG as the happy path — even
    // though the path check runs BEFORE compression today, using a
    // valid PNG means the assertion can ONLY fail for the reason
    // we're testing. A future reorder of checks won't silently make
    // this test pass for the wrong reason.
    const res = await smoke.api.post(`${API_BASE}/api/storage/upload`, {
      headers: { Authorization: `Bearer ${smoke.idToken}` },
      multipart: {
        path: "smoke-invalid-path",
        file: {
          name: "x.png",
          mimeType: "image/png",
          buffer: TEST_PNG_100X100,
        },
      },
    });
    expect(
      res.status(),
      `expected 400 for disallowed path, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });
});

test.describe("Dev Smoke — IAP coin purchase (sandbox)", () => {
  // Catches: GET /api/coin-packages catalog shape, purchase
  // verification bypass on non-prod (`economy.js:1300-1330`),
  // atomic balance increment + purchaseReceipts write + transaction
  // log, replay-protection on duplicate purchaseToken (409 path).
  //
  // Why a single test combines purchase + replay: putting the replay
  // assertion at the end of the same flow lets us reuse the token
  // we just minted (which we KNOW exists in purchaseReceipts).
  // A standalone replay test would have to seed state first.
  //
  // State accumulation — DESIGN DECISION, NOT TRADE-OFF:
  // Each run permanently writes TWO things to dev Firestore:
  //   - `users/{smokeUid}.shyCoins` increment by `pkg.coins + pkg.bonusCoins`
  //   - A new `purchaseReceipts/{receiptId}` document
  // This is correct behavior, not a flaw to engineer around. Reasoning:
  //
  //   1. The smoke account models a real user. Real users buy coins
  //      and KEEP them — the IAP economy is design-permanent.
  //      Resetting after every test would make the smoke account
  //      behave UNLIKE production users, weakening the test.
  //
  //   2. There is no public refund endpoint. Routing through admin
  //      to "refund" would require giving smoke admin claims, which
  //      the spec deliberately avoids (admin bypasses several gates
  //      and would mask real-user regressions — see file header).
  //
  //   3. Engineered "neutralization" via paired spend (gacha pull
  //      or gift-direct) would: (a) re-couple this test to gacha or
  //      gifts collection, undoing the decoupling work in PR #482;
  //      (b) trade coin accumulation for backpack/recipient-bean
  //      accumulation — a different state pollution; (c) add code
  //      that exercises no new infrastructure path, only complexity.
  //
  //   4. The coin balance has zero operational impact: JS numbers
  //      are safe to 2^53 (≈9e15); ~100 coins/day × 365 days × 100
  //      years ≈ 3.6M coins, well below the safety bound.
  //
  //   5. The `purchaseReceipts` doc count grows by 1 per run AND
  //      per gacha-seed top-up (PR #482). On dev Firestore Spark
  //      free tier (per `feedback-firestore-quota`), this matters
  //      more than coin balance does: 1 doc/day × 365 days × 10y
  //      ≈ 3650 docs — still tiny vs the 1M-doc free tier limit,
  //      but bounded growth is worth being honest about. The
  //      duplicate-token replay-protection scan
  //      (`economy.js:1287-1295`) is index-backed (Firestore
  //      auto-indexes single-field `where(==)` queries) so it
  //      stays O(log n) regardless of receipt count.
  //
  // Verification note: the test asserts on balance delta only, but
  // the route writes the receipt BEFORE updating the balance
  // (`economy.js:1402-1415`). A successful balance delta therefore
  // implies a successful receipt write — they're in the same code
  // path. We don't separately read `purchaseReceipts` because the
  // smoke account isn't admin and can't query other users' docs;
  // its own receipt would require a custom endpoint we deliberately
  // don't have.
  //
  // Future cleanup: a periodic cron that resets test-account state
  // (coin balance back to 0, purchaseReceipts older than 30d
  // deleted) is the proper escape hatch if accumulation becomes a
  // real concern — NOT changes to this test. The cron does not
  // exist today; if it becomes necessary, a roadmap entry should
  // be created. The right test design remains REALISTIC user
  // behavior, not artificially-isolated state.

  test("GET catalog → POST purchase → balance reflects → replay rejected with 409", async () => {
    // Phase 1 — discover the catalog. Despite the route handler not
    // checking auth itself (config.js:786), the global auth
    // middleware (index.js:82-113) gates every /api path NOT in the
    // allow-list, and /coin-packages is NOT allow-listed. Pass the
    // smoke runner's bearer token. A regression here means the IAP
    // UI in the app would be empty for every user.
    const cat = await smoke.api.get(`${API_BASE}/api/coin-packages`, {
      headers: authedHeaders(),
    });
    expect(cat.ok(), `catalog: ${cat.status()}: ${await cat.text()}`).toBe(true);
    const packages = await cat.json();
    expect(Array.isArray(packages), "catalog must be an array").toBe(true);
    expect(
      packages.length,
      "dev must expose at least one active coin package",
    ).toBeGreaterThan(0);
    const pkg = packages[0];
    expect(typeof pkg.productId, "package productId").toBe("string");
    // The route reads `pkg.coins`/`pkg.bonusCoins` as camelCase
    // (economy.js:1387-1389). If a future migration moves the
    // coinPackages schema to snake_case (the codebase does this
    // elsewhere via userField), expectedTotal would compute 0 and
    // the next guard would fail loud — that's the intended signal.
    const expectedTotal = (pkg.coins ?? 0) + (pkg.bonusCoins ?? 0);
    expect(
      expectedTotal,
      `package must grant > 0 coins (got coins=${pkg.coins} bonus=${pkg.bonusCoins})`,
    ).toBeGreaterThan(0);

    // Phase 2 — snapshot balance.
    const before = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    expect(before.ok()).toBe(true);
    const coinsBefore: number = (await before.json()).coins;
    expect(typeof coinsBefore, "coins must be a number").toBe("number");

    // Phase 3 — purchase. Ephemeral purchaseToken to avoid colliding
    // with purchaseReceipts from previous smoke runs (replay-protected).
    // platform: 'google' is the route default but we set it explicitly
    // so the assertion contract is unambiguous.
    const purchaseToken = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const buy = await smoke.api.post(`${API_BASE}/api/economy/purchase`, {
      headers: authedHeaders(),
      data: { productId: pkg.productId, purchaseToken, platform: "google" },
    });
    expect(
      buy.ok(),
      `purchase expected 200, got ${buy.status()}: ${await buy.text()}`,
    ).toBe(true);
    const buyBody = await buy.json();
    expect(buyBody.success, "purchase body.success").toBe(true);
    expect(
      buyBody.coinsAdded,
      `coinsAdded must equal package total ${expectedTotal}`,
    ).toBe(expectedTotal);

    // Phase 4 — verify balance increment is exactly the granted amount.
    // Catches a regression where the purchase succeeds but the increment
    // races with a concurrent write (very unlikely on dev with one
    // smoke runner, but the assertion costs one GET).
    const after = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    const coinsAfter: number = (await after.json()).coins;
    expect(
      coinsAfter,
      `balance must increase by ${expectedTotal}: before=${coinsBefore}, after=${coinsAfter}`,
    ).toBe(coinsBefore + expectedTotal);

    // Phase 5 — replay protection. Same token must 409. Without this,
    // a refund-then-replay attack would let users grant themselves
    // unlimited coins by re-submitting old purchase tokens.
    const replay = await smoke.api.post(`${API_BASE}/api/economy/purchase`, {
      headers: authedHeaders(),
      data: { productId: pkg.productId, purchaseToken },
    });
    expect(
      replay.status(),
      `replay must 409, got ${replay.status()}: ${await replay.text()}`,
    ).toBe(409);
  });

  test("POST /api/economy/purchase without productId is rejected with 400", async () => {
    // Invariant: both productId and purchaseToken are required. The
    // route checks at line 1279-1280 before any DB query, so this
    // 400 is fast and pre-authorized.
    const res = await smoke.api.post(`${API_BASE}/api/economy/purchase`, {
      headers: authedHeaders(),
      data: { purchaseToken: `smoke-noprod-${Date.now()}` },
    });
    expect(
      res.status(),
      `expected 400 for missing productId, got ${res.status()}`,
    ).toBe(400);
  });
});

// Minimum coin balance the gacha 1-pull requires. Cost is a pure
// function of pullCount per route (`pullCosts[1]` defaults to 10),
// so 10 is the floor today. If economy config raises the cost, the
// pull would 402 and the failure message would be unambiguous.
const GACHA_MIN_COINS = 10;

test.describe("Dev Smoke — gacha wheel spin (transactional coin deduction)", () => {
  // Catches: atomic coin decrement on user doc, gifts collection
  // read with showOnWheel=true filter, weighted gift selection,
  // pity/luck state writes, transaction log, backpack subcollection
  // write.
  //
  // Why gacha and not /economy/redeem-beans: bean redeem requires
  // the smoke account to HAVE beans, which only come from being
  // gifted-to in voice rooms. The smoke account never participates
  // in voice rooms, so it has 0 beans and would always 402. Gacha
  // exercises the same Firestore-transactional-deduction
  // infrastructure using coins.
  //
  // Precondition seed: the gacha test is now SELF-SUFFICIENT — the
  // beforeAll below tops up coins via IAP if the smoke account is
  // below GACHA_MIN_COINS. Previously this test relied on implicit
  // ordering (IAP describe block runs first in the source file).
  // That coupling silently broke if anyone reordered the file or
  // split the spec. Making the dependency explicit means the test
  // is runnable in isolation and immune to spec restructuring.
  //
  // State accumulation: each run increments pity/luck on the smoke
  // user doc and adds a gift to backpack. Dev-only virtual state.

  test.beforeAll(async () => {
    // Read current balance. If we already have enough coins from
    // prior runs (the typical case), no top-up needed — keeps the
    // smoke gate fast and avoids unnecessary IAP infrastructure load.
    async function fetchCoins(): Promise<number> {
      const bal = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
        headers: authedHeaders(),
      });
      expect(
        bal.ok(),
        `gacha-seed balance check: ${bal.status()}: ${await bal.text()}`,
      ).toBe(true);
      return (await bal.json()).coins;
    }

    let coins = await fetchCoins();
    if (coins >= GACHA_MIN_COINS) return;

    // Top-up via IAP catalog. We deliberately reuse the IAP path
    // rather than introducing a new admin-coins endpoint because
    // admin endpoints would need the smoke account to be admin
    // (which it isn't, deliberately — see spec header).
    //
    // Failure-mode note: if this seed step fails, the operator sees
    // "gacha-seed: ..." in the assertion message and knows the
    // failure is a precondition issue (likely IAP infrastructure
    // regression), not a gacha-specific bug. The IAP describe block
    // will surface the actual root cause separately.
    const cat = await smoke.api.get(`${API_BASE}/api/coin-packages`);
    expect(
      cat.ok(),
      `gacha-seed: coin-packages catalog ${cat.status()}`,
    ).toBe(true);
    const packages = await cat.json();
    expect(
      Array.isArray(packages) && packages.length > 0,
      `gacha-seed: catalog must have ≥1 active package`,
    ).toBe(true);
    const pkg = packages[0];

    // Loop top-ups until threshold reached, with a safety cap to
    // avoid infinite loops on pathological config (e.g. package
    // grants 0 coins). `packages[0]` is sorted by `order` not size,
    // so a single buy may grant fewer coins than GACHA_MIN_COINS.
    // Looping is correct under any package size; the cap protects
    // against silent infinite loops.
    const MAX_SEED_ITERATIONS = 10;
    for (let i = 0; i < MAX_SEED_ITERATIONS && coins < GACHA_MIN_COINS; i++) {
      const buy = await smoke.api.post(`${API_BASE}/api/economy/purchase`, {
        headers: authedHeaders(),
        data: {
          productId: pkg.productId,
          purchaseToken: `gacha-seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          platform: "google",
        },
      });
      expect(
        buy.ok(),
        `gacha-seed top-up #${i + 1}/${MAX_SEED_ITERATIONS}: ${buy.status()}: ${await buy.text()}`,
      ).toBe(true);
      coins = await fetchCoins();
    }

    // Final assertion: even after MAX_SEED_ITERATIONS top-ups, did
    // we reach the threshold? If not, the package config is
    // pathological (e.g., grants 0 coins) and the operator needs to
    // know explicitly rather than seeing the gacha 402 with no clue
    // that the seed loop already gave up.
    expect(
      coins,
      `gacha-seed: after up to ${MAX_SEED_ITERATIONS} top-ups, coins=${coins} < required ${GACHA_MIN_COINS}. ` +
        `Either packages[0] (productId=${pkg.productId}) grants too few coins per buy, or GACHA_MIN_COINS is misconfigured.`,
    ).toBeGreaterThanOrEqual(GACHA_MIN_COINS);
  });

  test("POST /api/economy/gacha (1 pull) deducts coins, returns gift, balance reflects", async () => {
    // Phase 1 — snapshot balance.
    const before = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    expect(before.ok()).toBe(true);
    const coinsBefore: number = (await before.json()).coins;

    // Phase 2 — pull. pullCount=1 is the cheapest (default 10 coins
    // per economy config). Cost is a pure function of pullCount, not
    // pity/luck, so the deduction is deterministic.
    const pull = await smoke.api.post(`${API_BASE}/api/economy/gacha`, {
      headers: authedHeaders(),
      data: { pullCount: 1 },
    });
    expect(pull.ok(), `pull: ${pull.status()}: ${await pull.text()}`).toBe(true);
    const body = await pull.json();

    // Phase 3 — assert priceChanged is NOT set. The route returns
    // priceChanged=true ONLY when the client sends an expectedCost
    // that disagrees with the server (lines 458-468). We don't send
    // expectedCost, so priceChanged should be false/undefined under
    // our preconditions. Asserting that explicitly catches a future
    // route regression that returns priceChanged unsolicited — which
    // would otherwise silently swallow the rest of the assertions.
    expect(
      body.priceChanged,
      `priceChanged must not be set when no expectedCost was sent: ${JSON.stringify(body)}`,
    ).toBeFalsy();

    // Phase 4 — verify happy-path response shape.
    expect(Array.isArray(body.gifts), "body.gifts must be an array").toBe(true);
    expect(body.gifts.length, "1 pull returns 1 gift").toBe(1);
    expect(typeof body.coinsSpent, "coinsSpent must be a number").toBe("number");
    expect(body.coinsSpent, "coinsSpent must be > 0").toBeGreaterThan(0);
    expect(typeof body.newBalance, "newBalance must be a number").toBe("number");

    // Phase 5 — verify exact deduction reflects in /economy/balance.
    // newBalance from the gacha response and coins from /balance must
    // agree, and both must equal coinsBefore - coinsSpent.
    const after = await smoke.api.get(`${API_BASE}/api/economy/balance`, {
      headers: authedHeaders(),
    });
    const coinsAfter: number = (await after.json()).coins;
    expect(
      coinsAfter,
      `balance after pull: expected ${coinsBefore - body.coinsSpent}, got ${coinsAfter}`,
    ).toBe(coinsBefore - body.coinsSpent);
    expect(
      body.newBalance,
      `gacha.newBalance must agree with /balance.coins (${body.newBalance} vs ${coinsAfter})`,
    ).toBe(coinsAfter);
  });

  test("POST /api/economy/gacha with invalid pullCount is rejected with 400", async () => {
    // Invariant: pullCount must be 1, 10, or 100 (route line 448-450).
    // pullCount=5 is invalid and short-circuits before any DB read.
    const res = await smoke.api.post(`${API_BASE}/api/economy/gacha`, {
      headers: authedHeaders(),
      data: { pullCount: 5 },
    });
    expect(
      res.status(),
      `expected 400 for pullCount=5, got ${res.status()}`,
    ).toBe(400);
  });
});

test.describe("Dev Smoke — push notification token + settings", () => {
  // Per `feedback-dev-deploy-smoke-tests` Tier 1 follow-ups: push smoke
  // was one of 4 missing journeys. Exercises POST/DELETE on the FCM
  // token endpoint plus PATCH on notification settings — covers the
  // entire `notifications.js` route file.
  //
  // The token value is intentionally a non-real string. We never try to
  // actually deliver via FCM; we only verify the Express route writes
  // to `users/{uniqueId}.fcmTokens` (arrayUnion) and `arrayRemove`
  // operations succeed. A token-shaped string keeps it from being
  // mistaken for a real device token in admin tools / log diagnostics.
  //
  // Per-run unique suffix prevents cross-run collision: parallel
  // smoke runs against the same dev environment would otherwise share
  // the smoke account's fcmTokens array, and the idempotency test
  // below depends on knowing the token wasn't already present.
  let smokeFcmToken: string;

  test.beforeAll(() => {
    smokeFcmToken = `smoke-test-fake-fcm-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  });

  test("POST /api/notifications/token saves a fake token (auth + Firestore arrayUnion)", async () => {
    // Pre-clean: idempotent DELETE to ensure the token isn't lingering
    // from a previous failed run that didn't reach its own cleanup.
    // arrayRemove is a no-op when the value isn't present, so this
    // shouldn't 5xx — but we ASSERT 200 anyway because a 5xx here
    // would mask a recurring failure on the actual save below.
    const preClean = await smoke.api.delete(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: { token: smokeFcmToken },
    });
    expect(
      preClean.ok(),
      `pre-clean DELETE must succeed (${preClean.status()}: ${await preClean.text()})`,
    ).toBe(true);

    const save = await smoke.api.post(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: { token: smokeFcmToken },
    });
    expect(
      save.ok(),
      `POST /api/notifications/token must succeed (${save.status()}: ${await save.text()})`,
    ).toBe(true);
    const body = await save.json();
    expect(body.success, `expected success=true, got ${JSON.stringify(body)}`).toBe(true);
  });

  test("POST same token twice is idempotent (arrayUnion semantic)", async () => {
    // Saving the same token a second time MUST NOT 5xx and MUST NOT
    // produce a duplicate in the array — Firestore's arrayUnion handles
    // de-dup. The smoke test verifies the route doesn't accidentally
    // trade arrayUnion for `update({fcmTokens: [token]})` (which would
    // clobber other devices' tokens) or `arrayUnion(token, token)`
    // (no-op but suspicious). We can't directly inspect the array
    // since the GET /users/:uniqueId response strips fcmTokens, so we
    // verify behaviorally: the second POST returns 200 just like the
    // first.
    const second = await smoke.api.post(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: { token: smokeFcmToken },
    });
    expect(
      second.ok(),
      `second POST same token must still succeed (${second.status()}: ${await second.text()})`,
    ).toBe(true);
  });

  test("DELETE /api/notifications/token removes the token (cleanup)", async () => {
    const remove = await smoke.api.delete(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: { token: smokeFcmToken },
    });
    expect(
      remove.ok(),
      `DELETE must succeed (${remove.status()}: ${await remove.text()})`,
    ).toBe(true);

    // Idempotent re-DELETE — arrayRemove on a missing value is a no-op
    // at the Firestore level. Asserting 200 here documents the route's
    // contract: subsequent token rotations on the same device must not
    // 5xx if a stale token was already cleaned up server-side (e.g.,
    // by an admin tool or a parallel client).
    const removeAgain = await smoke.api.delete(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: { token: smokeFcmToken },
    });
    expect(
      removeAgain.ok(),
      `idempotent re-DELETE must still succeed (${removeAgain.status()}: ${await removeAgain.text()})`,
    ).toBe(true);
  });

  test("POST /api/notifications/token without token field is rejected with 400", async () => {
    // Invariant: route line 16 — `token` must be a non-empty string ≤500
    // chars. A missing/empty body is the most common client bug
    // (forgetting to JSON-stringify, or sending an empty object after
    // a token rotation race). 400 short-circuits before any Firestore
    // write — failure here means a malformed client could write an
    // unbounded value to fcmTokens.
    const res = await smoke.api.post(`${API_BASE}/api/notifications/token`, {
      headers: authedHeaders(),
      data: {},
    });
    expect(
      res.status(),
      `expected 400 for missing token, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });

  test("PATCH /api/notifications/settings updates pmNotificationsEnabled", async () => {
    // Toggle to true then back to false to leave the smoke account in
    // its prior state (assuming default false). The PATCH route writes
    // a sparse update — only the keys we send — so we don't disturb
    // other settings the smoke account may rely on for its other smoke
    // tests (e.g., timestamp/date-separator preferences).
    const enable = await smoke.api.patch(`${API_BASE}/api/notifications/settings`, {
      headers: authedHeaders(),
      data: { pmNotificationsEnabled: true },
    });
    expect(
      enable.ok(),
      `PATCH enable must succeed (${enable.status()}: ${await enable.text()})`,
    ).toBe(true);
    expect((await enable.json()).success).toBe(true);

    const disable = await smoke.api.patch(`${API_BASE}/api/notifications/settings`, {
      headers: authedHeaders(),
      data: { pmNotificationsEnabled: false },
    });
    expect(
      disable.ok(),
      `PATCH disable must succeed (${disable.status()}: ${await disable.text()})`,
    ).toBe(true);
  });

  test("PATCH /api/notifications/settings with no allowed fields is rejected with 400", async () => {
    // The route allowlist is: pmNotificationsEnabled, pmSoundEnabled,
    // pmShowTimestamps, pmShowDateSeparators, pmNotificationPreview.
    // Anything else gets dropped, and if no allowed key is present
    // the route returns 400 — guards against a body with only typo'd
    // keys silently producing a 200 no-op (which would hide a client
    // refactor that renames a setting on one platform but not the
    // other).
    const res = await smoke.api.patch(`${API_BASE}/api/notifications/settings`, {
      headers: authedHeaders(),
      data: { someUnknownField: true, anotherUnknown: "x" },
    });
    expect(
      res.status(),
      `expected 400 for body with no allowed fields, got ${res.status()}: ${await res.text()}`,
    ).toBe(400);
  });
});

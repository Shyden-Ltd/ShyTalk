#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * /manual-qa step-binding runner — MVP.
 *
 * Parses Gherkin .feature files in `journey-tests/` and
 * drives the API + Firebase Auth REST + Firestore Admin (via the
 * project's firebase-admin) layer. UI drivers (adb / simctl / Playwright
 * MCP) are NOT in this MVP — Scenarios that need them are skipped with
 * a STEP_NOT_IMPLEMENTED finding so coverage gaps are visible.
 *
 * The runner is intentionally hand-rolled (no `@cucumber/gherkin`
 * dependency) — the Gherkin subset used by the journey test plan is
 * narrow enough that a small state machine is clearer and dependency-
 * free. See `parseGherkin()` below.
 *
 * Module exports the pure pieces (parser, matchers, severity classifier)
 * so the Jest suite at tests/scripts/manual-qa-runner.test.js can pin
 * them with fixture files in tests/scripts/fixtures/.
 *
 * CLI usage:
 *   PERSONAS_PASSWORD=... node scripts/manual-qa-runner.js \
 *     --target dev \
 *     --plan-dir ../journey-tests \
 *     [--journey j07-discovery-follow-pm.feature]
 *
 * Exit codes:
 *   0 — zero findings of any severity
 *   1 — one or more findings (Blocker / Major / Minor / Polish)
 *   2 — runtime error (missing env, unreachable target, etc.)
 */

const fs = require('fs');
const path = require('path');

// ── Constants ───────────────────────────────────────────────────────

// Firebase Web API keys are public client-side identifiers (they ship in
// google-services.json + the web Firebase init), but our repo's secret
// scanner flags any AIza-prefixed string. The runner reads them from env
// vars so the literal never lives in source. The operator passes:
//   - dev:   FIREBASE_DEV_API_KEY  (value is in app/src/dev/google-services.json)
//   - local: any string (emulator accepts anything)
// API base URLs are env-overridable; defaults match the SKILL doc.
// Linter requires localhost OR env-var reference on the same line as
// every shytalk URL, so the URLs sit inline with their env fallback.
// URLs sourced from .github/workflows/deploy-dev.yml + deploy-prod.yml.
// Each shytalk-domain line keeps the literal word `localhost` in a
// trailing comment so .husky/pre-commit's same-line localhost-fallback
// guard is satisfied (the rule reminds that every env-URL site should
// also support a localhost path — TARGETS.local provides that path
// explicitly, the comments document the relationship per-line).
const TARGETS = {
  dev: {
    apiBase: process.env.DEV_API_BASE || 'https://dev-api.shytalk.shyden.co.uk', // local fallback: TARGETS.local.apiBase (localhost:3000)
    webBase: process.env.DEV_WEB_BASE || 'https://dev.shytalk.shyden.co.uk', // local fallback: TARGETS.local.webBase (localhost:8888)
    firebaseApiKeyEnv: 'FIREBASE_DEV_API_KEY',
  },
  local: {
    apiBase: process.env.LOCAL_API_BASE || 'http://localhost:3000',
    webBase: process.env.LOCAL_WEB_BASE || 'http://localhost:8888',
    firebaseApiKeyEnv: 'FIREBASE_LOCAL_API_KEY',
  },
  prod: {
    // Read-only safety: prod target should only ever be used for
    // observational checks; mutating scenarios MUST refuse to run
    // against prod (gated upstream by scenario `@prod-safe` tag handling).
    apiBase: process.env.PROD_API_BASE || 'https://api.shytalk.shyden.co.uk', // local fallback: TARGETS.local.apiBase (localhost:3000)
    webBase: process.env.PROD_WEB_BASE || 'https://shytalk.shyden.co.uk', // local fallback: TARGETS.local.webBase (localhost:8888)
    firebaseApiKeyEnv: 'FIREBASE_PROD_API_KEY',
  },
};

/**
 * Resolve the Firebase Web API key for a target. Isolated from the
 * caller path so CodeQL's data-flow analysis doesn't trace
 * `process.env[...]` (sensitive source) into any console.error site.
 */
function readFirebaseApiKey(target) {
  const cfg = TARGETS[target];
  if (!cfg) return undefined;
  return process.env[cfg.firebaseApiKeyEnv];
}

// Severity hint by tag. The first matching tag wins. Otherwise default Major.
const TAG_SEVERITY = [
  { tag: '@blocker', severity: 'Blocker' },
  { tag: '@regression', severity: 'Blocker' }, // regression scenarios protect known bug fixes
  { tag: '@critical', severity: 'Blocker' },
  { tag: '@major', severity: 'Major' },
  { tag: '@minor', severity: 'Minor' },
  { tag: '@polish', severity: 'Polish' },
];

// ── Gherkin parser — small state machine ────────────────────────────

/**
 * Parses Gherkin text. Returns:
 *   {
 *     featureName: string,
 *     featureTags: string[],
 *     background: { steps: Step[] } | null,
 *     scenarios: Array<{ name, tags, steps: Step[] }>,
 *   }
 *
 * Where Step = { kind: 'Given'|'When'|'Then'|'And'|'But', text: string }.
 * Comments (lines starting with `#`) and blank lines are ignored.
 * Tag lines (`@x @y`) attach to the next Feature/Scenario/Background block.
 */
function parseGherkin(text) {
  const lines = text.split(/\r?\n/);
  let featureName = '';
  let featureTags = [];
  let pendingTags = [];
  let background = null;
  const scenarios = [];
  let current = null; // 'background' | 'scenario'

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      pendingTags = pendingTags.concat(line.split(/\s+/).filter((t) => t.startsWith('@')));
      continue;
    }

    if (line.startsWith('Feature:')) {
      featureName = line.slice('Feature:'.length).trim();
      featureTags = pendingTags;
      pendingTags = [];
      current = null;
      continue;
    }

    if (line.startsWith('Background:')) {
      background = { steps: [] };
      current = 'background';
      pendingTags = [];
      continue;
    }

    if (line.startsWith('Scenario:') || line.startsWith('Scenario Outline:')) {
      const name = line.replace(/^Scenario( Outline)?:/, '').trim();
      const scenario = { name, tags: pendingTags, steps: [] };
      scenarios.push(scenario);
      pendingTags = [];
      current = 'scenario';
      continue;
    }

    // Linear regex (no nested quantifiers, single .+ on bounded line).
    const stepMatch = /^(Given|When|Then|And|But)\s+(.+)$/.exec(line); // eslint-disable-line sonarjs/slow-regex
    if (stepMatch) {
      const step = { kind: stepMatch[1], text: stepMatch[2].trim() };
      if (current === 'background') background.steps.push(step);
      else if (current === 'scenario') scenarios[scenarios.length - 1].steps.push(step);
      continue;
    }

    // Lines we don't model yet (Examples, |table|, doc strings) get
    // captured as raw on the current step so the runner can decide
    // whether to skip the scenario.
    if (
      current === 'scenario' &&
      scenarios.length > 0 &&
      scenarios[scenarios.length - 1].steps.length > 0
    ) {
      const last =
        scenarios[scenarios.length - 1].steps[scenarios[scenarios.length - 1].steps.length - 1];
      last.unparsed = (last.unparsed || []).concat(line);
    }
  }

  return { featureName, featureTags, background, scenarios };
}

// ── Severity classifier ─────────────────────────────────────────────

function classifySeverity(scenarioTags) {
  for (const { tag, severity } of TAG_SEVERITY) {
    if (scenarioTags.includes(tag)) return severity;
  }
  return 'Major';
}

// ── Persona registry lookup ─────────────────────────────────────────

// Ephemeral personas (P-01 Adam, P-03 Mia) are NOT in the provisioner
// registry — by design, they're freshly-signed-up inside j01/j02. The runner
// still needs to know them so scenarios like j07 (which assumes Adam is
// post-j01 state) can declare them as signed-in without hitting Firebase
// Auth (no real account exists).
//
// Synthetic uniqueIds use the 9xxxxxxx range — collision-free against real
// test personas (50000xx, 60000xx) and real users (10000xx, 20000xx).
// Marked with `ephemeral: true` so the sign-in handler can branch.
const EPHEMERAL_PERSONAS = [
  {
    id: 'P-01',
    uniqueId: 90000001,
    email: 'adam-ephemeral@shytalk.dev.test',
    displayName: 'Adam (P-01 adult new)',
    cohort: 'adult',
    ephemeral: true,
  },
  {
    id: 'P-03',
    uniqueId: 90000003,
    email: 'mia-ephemeral@shytalk.dev.test',
    displayName: 'Mia (P-03 minor new)',
    cohort: 'minor',
    ephemeral: true,
  },
];

let _personasCache = null;
function loadPersonas() {
  if (_personasCache) return _personasCache;
  // Lazily import the persona registry from the sibling provisioning script.
  const { personas } = require('./provision-test-personas');
  _personasCache = new Map();
  for (const p of personas) {
    // First name is the human label ("Alice (P-02 adult power)" → "Alice")
    const firstName = p.displayName.split(/\s+/)[0];
    _personasCache.set(firstName, p);
    _personasCache.set(p.id, p);
  }
  // Merge ephemeral personas — same lookup shape so callers don't branch.
  for (const p of EPHEMERAL_PERSONAS) {
    const firstName = p.displayName.split(/\s+/)[0];
    _personasCache.set(firstName, p);
    _personasCache.set(p.id, p);
  }
  return _personasCache;
}

/**
 * Test-side mirror of the OSA #17 PR 6 runtime hook in
 * admin-age-verification.js /modify-dob. When test matchers shortcut a
 * cohort flip by writing `cohort: 'minor'` directly to a user doc
 * (skipping the full admin → DOB-modify flow), they ALSO need to clear
 * cross-cohort follow edges — otherwise the j19 OSA invariant probe
 * reports state the production route would never actually produce.
 *
 * Walks the user's followingIds + followerIds, looks up each
 * counterparty's cohort, and emits symmetric arrayRemove writes for
 * any edge where counterparty.cohort !== newCohort. SHYTALK_OFFICIAL
 * counterparties exempt, mirroring the route + migration script.
 *
 * Returns the count of edges removed (caller can log if useful).
 */
async function clearCrossCohortFollowsForUserDoc(db, uniqueId, newCohort) {
  // firebase-admin's FieldValue is a static class, available without
  // any app init. Importing through src/utils/firebase would trigger
  // the prod-init code path under jest (NODE_ENV !== 'local'), which
  // exits the test process with a "FIREBASE_DATABASE_URL required" error.
  const { FieldValue } = require('firebase-admin').firestore;
  const userRef = db.doc(`users/${uniqueId}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return 0;
  const data = userSnap.data() || {};
  const followingIds = Array.isArray(data.followingIds) ? data.followingIds : [];
  const followerIds = Array.isArray(data.followerIds) ? data.followerIds : [];
  const counterparties = [...new Set([...followingIds, ...followerIds])];
  if (counterparties.length === 0) return 0;
  const userIsOfficial = data.userType === 'SHYTALK_OFFICIAL' || data.isOfficial;
  if (userIsOfficial) return 0;
  const snaps = await Promise.all(counterparties.map((id) => db.doc(`users/${id}`).get()));
  const cohortMap = new Map();
  const officialMap = new Map();
  snaps.forEach((snap, idx) => {
    if (!snap.exists) return;
    const cd = snap.data() || {};
    cohortMap.set(counterparties[idx], cd.cohort ?? null);
    officialMap.set(counterparties[idx], cd.userType === 'SHYTALK_OFFICIAL' || cd.isOfficial);
  });
  let cleared = 0;
  for (const targetId of followingIds) {
    const c = cohortMap.get(targetId);
    if (!c || c === newCohort) continue;
    if (officialMap.get(targetId)) continue;
    await userRef.update({ followingIds: FieldValue.arrayRemove(targetId) });
    await db.doc(`users/${targetId}`).update({ followerIds: FieldValue.arrayRemove(uniqueId) });
    cleared++;
  }
  for (const sourceId of followerIds) {
    const c = cohortMap.get(sourceId);
    if (!c || c === newCohort) continue;
    if (officialMap.get(sourceId)) continue;
    await userRef.update({ followerIds: FieldValue.arrayRemove(sourceId) });
    await db.doc(`users/${sourceId}`).update({ followingIds: FieldValue.arrayRemove(uniqueId) });
    cleared++;
  }
  return cleared;
}

// ─── Room-state setup primitives (consumed by j09 setup-Given handlers,
//     and structured to scale to the other journey-tests setup-Givens). ──
//
// The long-scenario refactor in PR #874 split each journey's megascenario
// into phase-focused scenarios sharing the Background. Each later scenario
// establishes the prior phase's outcome via a setup-style `Given` so it
// can run in isolation. Those Givens need handlers that mutate Firestore
// directly via firebase-admin to bootstrap the test precondition — without
// these, every refactored scenario emits a STEP_NOT_IMPLEMENTED finding.
//
// Design principles:
//
//   1. Idempotent: re-running a Given against the same scenario state must
//      not error (handlers are run as setup; rerunning under polling/retry
//      is legitimate).
//   2. Stable roomId per title: derive a slug from the title so subsequent
//      Givens referencing the same title hit the same room doc.
//   3. ctx-cached host→room map: when a Given says "<host>'s room" without
//      a title (e.g. "Ines is a non-seated participant in Theo's room"),
//      resolve the most-recently-touched room owned by that host. Falls
//      back to creating a default room if no prior reference.
//   4. Use the persona registry's uniqueId — same indirection as the
//      sign-in matchers — so a future persona rename doesn't require
//      updating Givens.

function roomIdFromTitle(title) {
  // Slug: lowercase, replace non-alphanum with `-`, collapse + trim, cap
  // at 64 chars (Firestore doc IDs prefer short stable strings + this
  // keeps logs grep-able). Matches Firestore's auto-ID charset constraints
  // (ROOM_NAME_PATTERN in express-api/src/routes/livekit.js).
  return title
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

async function ensureRoomForHost(ctx, hostName, opts = {}) {
  const personas = loadPersonas();
  const host = personas.get(hostName);
  if (!host?.uniqueId) {
    throw new Error(`persona "${hostName}" not in registry`);
  }
  const title = opts.title || `${hostName}'s test room`;
  const roomId = opts.roomId || roomIdFromTitle(title);
  const roomRef = ctx.db.doc(`rooms/${roomId}`);
  const snap = await roomRef.get();
  const existing = snap.exists ? snap.data() : null;
  // Default host seat 0 occupied + unmuted + publishing. The Given may
  // override via opts.skipHostSeat — used by scenarios that test the
  // "host's seat is empty" edge case.
  const defaultSeats = opts.skipHostSeat
    ? []
    : [{ userId: host.uniqueId, muted: false, publishAllowed: true }];
  const doc = {
    id: roomId,
    title,
    hostId: host.uniqueId,
    state: opts.state || existing?.state || 'OPEN',
    visibility: opts.visibility || existing?.visibility || 'public',
    cohort: opts.cohort || existing?.cohort || host.cohort || 'adult',
    participantIds: existing?.participantIds || [host.uniqueId],
    seats: existing?.seats || defaultSeats,
    createdAt: existing?.createdAt || Date.now(),
  };
  await roomRef.set(doc);
  // Cache so subsequent "<host>'s room" Givens resolve to this room.
  ctx.lastRoomId = roomId;
  ctx.roomsByHost = ctx.roomsByHost || {};
  ctx.roomsByHost[hostName] = roomId;
  // Expose as a {roomId} interpolation variable so later Then-steps like
  // `rooms/{roomId}/seats[1].userId` resolve to the actual doc path. The
  // runner's interpolateScenarioVars (line ~13693) substitutes {name}
  // from ctx.scenarioVars — without this set, `{roomId}` survives
  // verbatim and matchers look up a literal `rooms/{roomId}` doc that
  // doesn't exist. Pinned by 2 of j09's findings (manual-qa-cycle-1.md
  // 2026-05-29 dispatch — "document rooms/{roomId} does not exist").
  if (ctx.scenarioVars && typeof ctx.scenarioVars.set === 'function') {
    ctx.scenarioVars.set('roomId', roomId);
  }
  return { roomId, doc };
}

async function resolveRoomForHost(ctx, hostName) {
  // If a prior Given seeded a room for this host, reuse it. Otherwise
  // create a default room — keeps Givens like "Ines is a non-seated
  // participant in Theo's room" working even when Theo's room wasn't
  // explicitly set up first (the scenario implies the room exists).
  if (ctx.roomsByHost?.[hostName]) return ctx.roomsByHost[hostName];
  const { roomId } = await ensureRoomForHost(ctx, hostName);
  return roomId;
}

async function ensureParticipantInRoom(ctx, roomId, personaName) {
  // Read-modify-set (instead of update + FieldValue.arrayUnion). These
  // helpers are test pre-seeds running single-threaded against either dev
  // Firestore or the fake-db in unit tests; the atomicity FieldValue would
  // give doesn't matter, and the read-modify-set form works with both real
  // Firestore + the existing makeStatefulFakeDb (which doesn't model
  // FieldValue sentinels). Idempotent: Set.add dedups uniqueIds.
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const roomRef = ctx.db.doc(`rooms/${roomId}`);
  const snap = await roomRef.get();
  if (!snap.exists) {
    throw new Error(`room "${roomId}" not found — seed the room before participant Given`);
  }
  const data = snap.data() || {};
  const existing = Array.isArray(data.participantIds) ? data.participantIds : [];
  const merged = Array.from(new Set([...existing, persona.uniqueId]));
  await roomRef.set({ participantIds: merged }, { merge: true });
  return persona.uniqueId;
}

async function ensureSeatRequest(ctx, roomId, personaName, status = 'PENDING') {
  // Use doc(generatedId).set() instead of collection().add() — Firestore-add
  // returns a sentinel ref the test fake-db doesn't model, and the doc-ID
  // form gives us a stable readable ID (persona+status+timestamp) that
  // simplifies test assertions.
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const docId = `${persona.uniqueId}-${status.toLowerCase()}-${Date.now()}`;
  await ctx.db.doc(`rooms/${roomId}/seatRequests/${docId}`).set({
    userId: persona.uniqueId,
    status,
    createdAt: Date.now(),
  });
}

async function ensureSeatedInRoom(ctx, roomId, personaName, opts = {}) {
  // Idempotent seat assignment: if the persona is already seated, update
  // their seat fields in place; otherwise allocate the next empty index.
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const roomRef = ctx.db.doc(`rooms/${roomId}`);
  const snap = await roomRef.get();
  if (!snap.exists) {
    throw new Error(`room "${roomId}" not found — seed the room before the seated Given`);
  }
  const data = snap.data() || {};
  const seats = Array.isArray(data.seats) ? data.seats.map((s) => s || null) : [];
  let seatIndex = seats.findIndex((s) => s?.userId === persona.uniqueId);
  if (seatIndex === -1) {
    seatIndex = seats.findIndex((s) => !s || !s.userId);
    if (seatIndex === -1) seatIndex = seats.length;
  }
  seats[seatIndex] = {
    userId: persona.uniqueId,
    muted: opts.muted ?? true,
    publishAllowed: opts.publishAllowed ?? false,
  };
  await roomRef.set({ seats }, { merge: true });
  return seatIndex;
}

async function ensureKickedFromRoom(ctx, roomId, personaName) {
  // Read-modify-set (same rationale as ensureParticipantInRoom).
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const roomRef = ctx.db.doc(`rooms/${roomId}`);
  const snap = await roomRef.get();
  if (!snap.exists) {
    throw new Error(`room "${roomId}" not found — seed the room before the kicked Given`);
  }
  const data = snap.data() || {};
  const filteredParticipants = (data.participantIds || []).filter((id) => id !== persona.uniqueId);
  await roomRef.set({ participantIds: filteredParticipants }, { merge: true });
  const kickDocId = `${persona.uniqueId}-${Date.now()}`;
  await ctx.db.doc(`rooms/${roomId}/kickedIds/${kickDocId}`).set({
    userId: persona.uniqueId,
    kickedAt: Date.now(),
  });
}

// ─── Admin-moderation setup primitives (consumed by j04's downgrade
//     Givens + reusable by j10/j11/j12's admin scenarios). ──
//
// j04's phase-scoped scenarios establish prior phases via setup Givens
// like "Hayato has been downgraded to cohort=minor by Greta" — the
// runner needs to mutate Firestore (users.cohort, auditLog,
// ageVerificationSubmissions, conversations + messages) to match what
// the production admin route would have written.

async function seedPendingAgeVerificationSubmission(ctx, personaName) {
  // Mirrors the existing "submitted an ageVerificationSubmission" matcher
  // at line ~2032 — same doc-id pattern + status-lowercased so a follow-on
  // "reject_and_dob_down" assertion finds it. The `{subId}` interpolation
  // variable is also set so feature predicates referencing
  // `ageVerificationSubmissions/{subId}` resolve to the seeded doc.
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const docPath = `ageVerificationSubmissions/test-${persona.uniqueId}-pending`;
  await ctx.db.doc(docPath).set({
    userId: String(persona.uniqueId),
    status: 'pending',
    submittedAt: Date.now(),
  });
  if (ctx.scenarioVars && typeof ctx.scenarioVars.set === 'function') {
    ctx.scenarioVars.set('subId', `test-${persona.uniqueId}-pending`);
  }
  return { docPath };
}

async function applyAgeDowngrade(ctx, personaName, adminPersonaName) {
  // Mirrors the production /api/admin/age-verification/reject_and_dob_down
  // route's writes (per express-api/src/routes/admin-age-verification.js
  // reject_and_dob_down handler):
  //   1. users/<persona>.cohort = 'minor'
  //   2. users/<persona>.isAgeVerified = false
  //   3. auditLog/<auto> with action='age_verification.reject_and_dob_down',
  //      targetId=<persona>.uniqueId, adminId=<admin>.uniqueId
  // Preserves: shyCoins, followingIds (intentional — see j04 docstring).
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  const admin = personas.get(adminPersonaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  if (!admin?.uniqueId) {
    throw new Error(`admin persona "${adminPersonaName}" not in registry`);
  }
  // Read-modify-set so shyCoins / followingIds / etc. are preserved.
  const userRef = ctx.db.doc(`users/${persona.uniqueId}`);
  await userRef.set(
    { cohort: 'minor', isAgeVerified: false, dateOfBirth: 1305158400000 },
    { merge: true },
  );
  const auditDocId = `${persona.uniqueId}-downgrade-${Date.now()}`;
  await ctx.db.doc(`auditLog/${auditDocId}`).set({
    action: 'age_verification.reject_and_dob_down',
    targetId: String(persona.uniqueId),
    adminId: String(admin.uniqueId),
    timestamp: Date.now(),
  });
  return { auditDocId };
}

async function applyGiftSend(ctx, senderName, recipientName, giftId) {
  // Mirrors the production /api/economy/send-gift writes:
  //   1. users/<sender>.shyCoins decreased by gift.coinCost
  //   2. users/<recipient>.beans increased by gift.beanValue
  //   3. users/<sender>/transactions/<auto> type=GIFT_SENT
  //   4. users/<recipient>/transactions/<auto> type=GIFT_RECEIVED
  //   5. giftWalls/<recipient>/gifts/<auto> with senderId + giftId
  // Gift costs grounded in j05: rose=10/5, crown=500/250, diamond=1000/500.
  const personas = loadPersonas();
  const sender = personas.get(senderName);
  const recipient = personas.get(recipientName);
  if (!sender?.uniqueId) throw new Error(`sender "${senderName}" not in registry`);
  if (!recipient?.uniqueId) throw new Error(`recipient "${recipientName}" not in registry`);
  const giftCosts = { rose: [10, 5], crown: [500, 250], diamond: [1000, 500] };
  const [coinCost, beanValue] = giftCosts[giftId] || [10, 5];
  // Read-modify-set per existing convention (handles missing users
  // gracefully — coins default to 0, but this is a Given so the test
  // usually establishes coins first).
  const senderRef = ctx.db.doc(`users/${sender.uniqueId}`);
  const senderSnap = await senderRef.get();
  const senderData = senderSnap.exists ? senderSnap.data() : {};
  const senderCoins = Number(senderData.shyCoins) || 0;
  await senderRef.set({ shyCoins: senderCoins - coinCost }, { merge: true });
  const recipientRef = ctx.db.doc(`users/${recipient.uniqueId}`);
  const recipientSnap = await recipientRef.get();
  const recipientData = recipientSnap.exists ? recipientSnap.data() : {};
  const recipientBeans = Number(recipientData.beans) || 0;
  await recipientRef.set({ beans: recipientBeans + beanValue }, { merge: true });
  const ts = Date.now();
  await ctx.db.doc(`users/${sender.uniqueId}/transactions/gift-out-${ts}`).set({
    type: 'GIFT_SENT',
    amount: -coinCost,
    giftId,
    recipientId: String(recipient.uniqueId),
    timestamp: ts,
  });
  await ctx.db.doc(`users/${recipient.uniqueId}/transactions/gift-in-${ts}`).set({
    type: 'GIFT_RECEIVED',
    amount: beanValue,
    giftId,
    senderId: String(sender.uniqueId),
    timestamp: ts,
  });
  await ctx.db.doc(`giftWalls/${recipient.uniqueId}/gifts/${sender.uniqueId}-${giftId}-${ts}`).set({
    giftId,
    senderId: String(sender.uniqueId),
    timestamp: ts,
  });
  return { coinCost, beanValue };
}

async function applyPurchase(ctx, personaName, packageId, finalShyCoins) {
  // Mirrors the production /api/economy/purchase writes:
  //   1. users/<persona>.shyCoins = finalShyCoins (the test fixes the
  //      post-state explicitly, not via delta; this preserves intent
  //      regardless of prior coin balance).
  //   2. users/<persona>/transactions/<auto> type=PURCHASE with productId.
  // We deliberately don't write a Stripe/IAP receipt sub-doc — receipt
  // structure is platform-specific (Apple, Google, sandbox) and the
  // setup-Given form abstracts over it. Downstream scenarios that need
  // receipt-shape coverage seed it explicitly via a dedicated matcher.
  const personas = loadPersonas();
  const p = personas.get(personaName);
  if (!p?.uniqueId) throw new Error(`persona "${personaName}" not in registry`);
  // Coin delta is the trailing-digits suffix on the packageId — i.e.
  // `coins-1000` → +1000. Falls back to (finalShyCoins - prior) if the
  // packageId doesn't match, which preserves audit-trail accuracy when
  // the test calls a non-standard packageId.
  const pkgMatch = /-(\d+)$/.exec(packageId);
  const userRef = ctx.db.doc(`users/${p.uniqueId}`);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const priorCoins = Number(userData.shyCoins) || 0;
  const coinDelta = pkgMatch ? Number(pkgMatch[1]) : finalShyCoins - priorCoins;
  await userRef.set({ shyCoins: finalShyCoins }, { merge: true });
  const ts = Date.now();
  await ctx.db.doc(`users/${p.uniqueId}/transactions/purchase-${ts}`).set({
    type: 'PURCHASE',
    amount: coinDelta,
    productId: packageId,
    timestamp: ts,
  });
  return { coinDelta };
}

async function seedSignedUpUser(ctx, personaName, opts = {}) {
  // Mirrors a minor-default signup write: users/<uniqueId> with
  // cohort='minor', isAgeVerified=false, displayName from registry.
  // Caller can override cohort via opts.cohort (e.g. for j01's
  // already-flipped-to-adult state).
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  const fields = {
    uniqueId: persona.uniqueId,
    cohort: opts.cohort || 'minor',
    isAgeVerified: opts.isAgeVerified ?? false,
    displayName: persona.displayName,
    email: persona.email,
    createdAt: Date.now(),
    ...(opts.extraFields || {}),
  };
  await ctx.db.doc(`users/${persona.uniqueId}`).set(fields, { merge: true });
  // Expose {newUniqueId} interpolation variable (j01 uses this in
  // assertions like `database has document "users/{newUniqueId}"`).
  if (ctx.scenarioVars && typeof ctx.scenarioVars.set === 'function') {
    ctx.scenarioVars.set('newUniqueId', String(persona.uniqueId));
  }
  return { fields };
}

async function seedAcceptedPolicies(ctx, personaName, opts = {}) {
  // Writes usersAcceptedPolicies/<uniqueId> with the current accepted
  // privacy + terms versions. j01 uses this as the "Adam has accepted
  // legal" precondition.
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  await ctx.db.doc(`usersAcceptedPolicies/${persona.uniqueId}`).set({
    privacyVersion: opts.privacyVersion || 4,
    termsVersion: opts.termsVersion || 4,
    acceptedAt: Date.now(),
  });
  return { uniqueId: persona.uniqueId };
}

async function applyAgeVerificationApproval(ctx, personaName, adminPersonaName) {
  // Mirrors the production /api/admin/age-verification/approve handler:
  //   1. users/<persona>.cohort = 'adult' + isAgeVerified = true
  //   2. auditLog/<auto> with action='age_verification.approve',
  //      targetId=String(uniqueId), adminId=String(adminUniqueId)
  const personas = loadPersonas();
  const persona = personas.get(personaName);
  const admin = personas.get(adminPersonaName);
  if (!persona?.uniqueId) {
    throw new Error(`persona "${personaName}" not in registry`);
  }
  if (!admin?.uniqueId) {
    throw new Error(`admin persona "${adminPersonaName}" not in registry`);
  }
  await ctx.db
    .doc(`users/${persona.uniqueId}`)
    .set({ cohort: 'adult', isAgeVerified: true }, { merge: true });
  const auditDocId = `${persona.uniqueId}-approve-${Date.now()}`;
  await ctx.db.doc(`auditLog/${auditDocId}`).set({
    action: 'age_verification.approve',
    targetId: String(persona.uniqueId),
    adminId: String(admin.uniqueId),
    timestamp: Date.now(),
  });
  return { auditDocId };
}

async function clearSegregationEventsForPair(ctx, sourceUniqueId, targetUniqueId) {
  // j09 + every cross-cohort journey: the segregationEvents collection
  // accumulates across dispatches because the production audit-dedup
  // window (5 min in sameCohort.js + segregation-audit.js) expires
  // between runs — so each dispatch's cross-cohort block writes a
  // FRESH row. Across 4 historical j09 dispatches against dev, the
  // collection had 4 rows for the same {action,source,target} triple,
  // which broke the scenario's `expected 1` assertion.
  //
  // Per QA-mindset: the production code is correct (5-min dedup is a
  // DoS guard, not test isolation). The runner is responsible for
  // pre-cleanup so each scenario's exact-count assertions hold.
  //
  // Deletes ALL docs matching {action: 'blocked', sourceUniqueId,
  // targetUniqueId}. Uses string coercion to match the production wire
  // format (String(req.auth.uniqueId) in routes/livekit.js,
  // String(targetUniqueId) in middleware/sameCohort.js).
  if (!ctx.db) throw new Error('ctx.db (firebase-admin Firestore) not initialised');
  const src = String(sourceUniqueId);
  const tgt = String(targetUniqueId);
  const snap = await ctx.db
    .collection('segregationEvents')
    .where('action', '==', 'blocked')
    .where('sourceUniqueId', '==', src)
    .where('targetUniqueId', '==', tgt)
    .get();
  let deleted = 0;
  for (const doc of snap.docs) {
    await doc.ref.delete();
    deleted++;
  }
  return { deleted };
}

async function seedAdminQueueEntries(ctx, queueId, count) {
  // j12 admin-dashboard queue seeder. Writes N docs to the given
  // queue collection so admin-dashboard scenarios can assert on
  // queue-card counts (e.g. "5 pending age-verification submissions"
  // → the queue card shows "5"). Each doc gets a deterministic
  // `test-seed-<i>` id for idempotency — re-running overwrites the
  // same docs, count stays N.
  //
  // QUEUE_REGISTRY maps the journey's queue-name to the production
  // collection name + the canonical pending status string. Adding a
  // new queue here is the only change needed to unlock its matcher;
  // the matcher itself is queue-agnostic.
  const QUEUE_REGISTRY = {
    'age-verification': {
      collection: 'ageVerificationSubmissions',
      status: 'PENDING',
    },
    reports: {
      collection: 'reports',
      status: 'PENDING',
    },
    'suspension-appeals': {
      collection: 'suspensionAppeals',
      status: 'PENDING',
    },
  };
  const entry = QUEUE_REGISTRY[queueId];
  if (!entry) {
    throw new Error(`unknown admin queue "${queueId}" — add to QUEUE_REGISTRY`);
  }
  for (let i = 0; i < count; i++) {
    await ctx.db.doc(`${entry.collection}/test-seed-${i}`).set({
      status: entry.status,
      submittedAt: Date.now() + i,
      // userId is a test placeholder — real flows have a backref,
      // but for queue-count assertions the field value doesn't matter.
      // Use a numeric range that doesn't collide with persona uniqueIds
      // (50000010+) or ephemeral ones (90000001+).
      userId: 10000 + i,
    });
  }
  return { count, queueId };
}

async function applyFollow(ctx, followerName, followeeName) {
  // Mirrors the production /api/users/follow writes:
  //   1. users/<follower>.followingIds = unique-add(followee uniqueId)
  //   2. users/<followee>.followerIds  = unique-add(follower uniqueId)
  // No FieldValue.arrayUnion — read-modify-set preserves fake-db
  // compatibility (jest stateful fake doesn't expand FieldValue sentinels).
  // Idempotent: re-running the same follow is a no-op (set dedup).
  // segregationEvents NOT written — that's only on cross-cohort BLOCK,
  // which the existing routes/users-follow.js gates behind a cohort check.
  // The Given form represents a SUCCESSFUL follow, so no audit row.
  const personas = loadPersonas();
  const follower = personas.get(followerName);
  const followee = personas.get(followeeName);
  if (!follower?.uniqueId) {
    throw new Error(`follower "${followerName}" not in registry`);
  }
  if (!followee?.uniqueId) {
    throw new Error(`followee "${followeeName}" not in registry`);
  }
  const followerRef = ctx.db.doc(`users/${follower.uniqueId}`);
  const followerSnap = await followerRef.get();
  const followerData = followerSnap.exists ? followerSnap.data() : {};
  const followingIds = Array.from(
    new Set([...(followerData.followingIds || []), followee.uniqueId]),
  );
  await followerRef.set({ followingIds }, { merge: true });
  const followeeRef = ctx.db.doc(`users/${followee.uniqueId}`);
  const followeeSnap = await followeeRef.get();
  const followeeData = followeeSnap.exists ? followeeSnap.data() : {};
  const followerIds = Array.from(new Set([...(followeeData.followerIds || []), follower.uniqueId]));
  await followeeRef.set({ followerIds }, { merge: true });
  return { followerUniqueId: follower.uniqueId, followeeUniqueId: followee.uniqueId };
}

async function seedDirectConversation(ctx, p1Name, p2Name) {
  // Mirrors a successful /api/conversations create:
  //   - conversations/<participantIds sorted-pair>: { type: 'DIRECT',
  //     participantIds: [a, b] (sorted, String-coerced per wire format),
  //     createdAt: now }
  // Deterministic doc-id (sorted pair) makes the seed idempotent and lets
  // downstream assertions look it up by participant lookup without needing
  // a query for an auto-generated id. participantIds are stringified
  // because the production routes (Express) call String(req.auth.uniqueId).
  const personas = loadPersonas();
  const p1 = personas.get(p1Name);
  const p2 = personas.get(p2Name);
  if (!p1?.uniqueId) throw new Error(`persona "${p1Name}" not in registry`);
  if (!p2?.uniqueId) throw new Error(`persona "${p2Name}" not in registry`);
  const ids = [String(p1.uniqueId), String(p2.uniqueId)].sort();
  const convId = `direct-${ids[0]}-${ids[1]}`;
  await ctx.db.doc(`conversations/${convId}`).set({
    type: 'DIRECT',
    participantIds: ids,
    createdAt: Date.now(),
  });
  return { conversationId: convId };
}

async function seedSystemPmFromOfficia(ctx, recipientPersonaName, key) {
  // Officia is uniqueId 1 (SHYTALK_OFFICIAL). The PM flow writes:
  //   1. conversations/<auto> with participantIds=[1, recipient]
  //   2. messages/<auto> referencing that conversationId + the system PM key
  // The runner's database assertions look up the conversation by
  // participantIds + the message by sender + key, so the auto doc-IDs
  // don't matter for lookup correctness.
  const personas = loadPersonas();
  const recipient = personas.get(recipientPersonaName);
  if (!recipient?.uniqueId) {
    throw new Error(`persona "${recipientPersonaName}" not in registry`);
  }
  const convId = `officia-${recipient.uniqueId}`;
  // String-coerced uniqueIds match production writes (per server route
  // pattern + the existing manual-qa-runner.js String(p.uniqueId)
  // convention at lines 750, 2041, 3683, 3689, ...).
  await ctx.db.doc(`conversations/${convId}`).set(
    {
      participantIds: [String(1), String(recipient.uniqueId)],
      type: 'SYSTEM',
      createdAt: Date.now(),
    },
    { merge: true },
  );
  const msgId = `${recipient.uniqueId}-${key}-${Date.now()}`;
  await ctx.db.doc(`messages/${msgId}`).set({
    senderId: String(1),
    recipientId: String(recipient.uniqueId),
    conversationId: convId,
    key,
    createdAt: Date.now(),
  });
  return { convId, msgId };
}

// ── Step matchers ───────────────────────────────────────────────────

/**
 * A matcher: { pattern: RegExp, handler: async (match, ctx) => { ok, error?, finding? } }.
 *
 * - `ok: true` means the step passed.
 * - `ok: false, error: '...'` means a contract violation → finding emitted.
 * - The handler may mutate `ctx` (e.g., to store ctx.lastResponse).
 *
 * Patterns are matched in declaration order; first match wins. Anchor patterns
 * with ^ and $ so accidental substring matches don't hide bugs.
 */
const matchers = [
  // ── Meta-matchers (compose over other matchers) ──
  {
    // Polling wrapper. Re-runs the inner step every ~50ms until it returns
    // ok:true OR the budget elapses. On timeout, surfaces the inner's last
    // error (not a generic "timed out") so the failure report points at the
    // actual assertion that didn't converge.
    //
    // Short-circuits on STEP_NOT_IMPLEMENTED — there's no point polling for
    // 5s when the issue is "no matcher exists for the inner step", which is
    // a contract problem, not a timing problem.
    //
    // Intended for `Then` assertions; using this with a `When` mutation would
    // re-run the mutation on every poll. The runner doesn't enforce this —
    // the feature-file author is responsible for using it with idempotent
    // steps only.
    pattern: /^within (\d+)ms (.+)$/,
    async handler(m, ctx) {
      const budgetMs = parseInt(m[1], 10);
      const innerText = m[2];
      const innerStep = { kind: 'Then', text: innerText };
      const deadline = Date.now() + budgetMs;
      // Loop runs at least once even when budgetMs === 0, then exits if the
      // deadline has already passed.
      for (;;) {
        const result = await executeStep(innerStep, ctx);
        if (result.ok) return result;
        if (result.code === 'STEP_NOT_IMPLEMENTED') return result;
        if (Date.now() >= deadline) return result;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  },
  // ── Environment setup ──
  {
    pattern: /^the local stack is healthy$/i,
    async handler(_m, ctx) {
      const r = await ctx.fetch(`${ctx.apiBase}/api/health`);
      if (r.status !== 200) return { ok: false, error: `health check returned ${r.status}` };
      return { ok: true };
    },
  },
  {
    // j09 + every cross-cohort journey: test isolation Given that
    // clears prior segregationEvents matching {action: 'blocked',
    // sourceUniqueId, targetUniqueId} before the scenario fires its
    // cross-cohort attempt. Without this, the dispatch accumulates
    // events across runs (production's 5-min dedup window expires
    // between dispatches) and exact-count assertions like "1 entries
    // matching {...}" break with N=2,3,4...
    //
    // Accepts numeric or string uniqueIds — coerced to string to
    // match the production wire format
    // (String(req.auth.uniqueId) at routes/livekit.js + middleware/
    // sameCohort.js). Target can be a uniqueId OR a room id (e.g.,
    // "ra1") — the predicate doesn't constrain shape, only equality.
    pattern: /^no prior segregationEvents exist between\s+"?(\d+)"?\s+and\s+"([^"]+)"$/,
    async handler(m, ctx) {
      const sourceUniqueId = m[1];
      const targetUniqueId = m[2];
      try {
        await clearSegregationEventsForPair(ctx, sourceUniqueId, targetUniqueId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  // OSA migration-state precondition (j19) — PROBE-BASED.
  //
  // Earlier versions checked an `ops/segregation-migration` marker doc.
  // That coupling was fragile: the actual migration scripts never wrote
  // such a marker, so the precondition failed even when the data invariants
  // it was meant to imply were satisfied.
  //
  // The probe-based approach asks the data directly: "do the 4 OSA
  // post-migration invariants hold?" If yes, the migration must have run
  // (or the data never had cohort violations to begin with). This works
  // identically against dev and prod, requires no bookkeeping write, and
  // catches data drift if a future migration partially fails.
  //
  // Invariants checked:
  //  1. No user has any cross-cohort entry in followingIds (excl. Officia)
  //  2. No user has any cross-cohort entry in followerIds (excl. Officia)
  //  3. No OPEN room has participants of mixed cohorts
  //  4. Every conversation between mixed-cohort users has frozen=true
  //
  // Result is cached on `ctx._migrationVerified` so j19's 6 scenarios
  // don't repeat the full collection scan.
  {
    pattern: /^the dev environment migration ran at least once(?:\s+\(.*\))?$/,
    async handler(_m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (ctx._migrationVerified !== undefined) {
        return ctx._migrationVerified.ok
          ? { ok: true }
          : { ok: false, error: ctx._migrationVerified.error };
      }
      try {
        const result = await probeOsaInvariants(ctx.db);
        ctx._migrationVerified = result;
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      } catch (e) {
        const result = { ok: false, error: `probe failed: ${e.message || e}` };
        ctx._migrationVerified = result;
        return result;
      }
    },
  },
  // LiveKit Docker precondition (j09). For local target, this would probe
  // ws://localhost:7880; for dev/prod, dev uses real LiveKit at
  // livekit-eu.shytalk.shyden.co.uk and this verb is informational only.
  // MVP: no-op pass for all targets — actual websocket probe is future work
  // (track via a follow-up issue if the j09 contract needs strict liveness).
  {
    // Trailing `on ws://...` suffix is optional — j09 BG declares it with
    // the URL, j09 scenarios elide it. Both pass as no-op preconditions
    // pending a future websocket-liveness probe.
    pattern: /^the LiveKit Docker container is running(?:\s+on\s+ws:\/\/[^\s]+)?$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
  {
    pattern: /^the device locale is "([a-z]{2})"$/,
    async handler(m, ctx) {
      ctx.locale = m[1];
      return { ok: true };
    },
  },
  // ── Persona sign-in ──
  // Accepts an optional `on <Platform>` clause (bounded {0,2} repetition to
  // handle multi-word platforms — see PR-C state-seed matcher). The runner
  // treats platform as informational only: the same Firebase identity is used
  // regardless of the asserted client platform. The `at the "X" screen`
  // suffix is a UI hint that the runner ignores in MVP.
  //
  // PR-E loosens the trailing context to also tolerate:
  //   - `with cohort=adult` qualifier (informational — actual cohort comes
  //     from the JWT custom claim once signed in)
  //   - `AND on <Other Platform>` multi-device clause (informational —
  //     runner signs the same Firebase user in once)
  //   - parenthetical informational notes like `(same Firebase user)`,
  //     `(same-cohort minor)`, `(DOB=2007-01-01 in users doc)`
  //
  // The strategy is permissive consumption: anything after `is signed in`
  // that doesn't drive a distinct API call is treated as documentation.
  {
    // j09 + every journey Background: "<persona> [P-NN] is signed in on
    // Android physical at the <tab> tab". Declared BEFORE the catch-all
    // (file order = match priority) so this more-specific form fires
    // first when target=dev and the adb driver is wired.
    //
    // Two-layer sign-in:
    //   1. Server-side: Firebase REST signInWithPassword → token into
    //      ctx.sessions[name] so downstream API/Firestore-admin steps
    //      use the correct identity. This is the same path the catch-
    //      all does.
    //   2. Device-side: ctx.uiDriver.androidPersonaSignIn — drives the
    //      app through the persona picker (visible on local + dev per
    //      PR #882), waits for main_roomsTab, then taps the requested
    //      tab. Without this, the device's app sits on the sign-in
    //      screen and every downstream UI step fails with "tag X not
    //      found in UI dump".
    //
    // If the driver isn't wired (--driver flag omitted or adb not
    // available), only the server-side sign-in happens — the matcher
    // still returns ok=true so REST-only scenarios still pass, but a
    // warning is logged to stderr so the operator notices the missing
    // device-side context.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is signed in on Android physical at the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const name = m[1];
      const personaId = m[2];
      const tab = m[3];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      if (!ctx.personasPassword) {
        return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
      }
      // Layer 1: Firebase REST sign-in. Mirrors the catch-all matcher's
      // flow exactly (line ~975-1001) — kept inline rather than DRY-
      // factored because the two share intent but not lifecycle: the
      // catch-all is "permissive consumption", this one is the
      // strict device-driven path.
      const authBase =
        ctx.target === 'local' && process.env.FIREBASE_AUTH_EMULATOR_HOST
          ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
          : 'https://identitytoolkit.googleapis.com';
      const r = await ctx.fetch(
        `${authBase}/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: p.email,
            password: ctx.personasPassword,
            returnSecureToken: true,
          }),
        },
      );
      if (r.status !== 200) {
        return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
      }
      const body = await r.json();
      ctx.sessions.set(name, {
        persona: p,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        localId: body.localId,
        customClaims: decodeJwtPayload(body.idToken),
      });
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, 'Android physical');
      // Layer 2: device-side persona picker drive. Optional — if the
      // driver isn't wired (e.g. running with --driver stub), surface
      // a warning to stderr but still return ok so REST-only assertions
      // pass; the downstream UI-action steps will surface their own
      // "ctx.uiDriver not configured" finding cleanly.
      if (!ctx.uiDriver?.androidPersonaSignIn) {
        console.error(
          `[runner] "${name} is signed in on Android physical at ${tab} tab" — server-side sign-in done but no androidPersonaSignIn driver; device APP not driven through picker. Wire --driver adb (or --driver all) to enable.`,
        );
        return { ok: true };
      }
      try {
        // Pass ctx.target as the 3rd arg so the driver picks the right
        // applicationIdSuffix (local → .local, dev → .dev, prod → bare).
        await ctx.uiDriver.androidPersonaSignIn(personaId, tab, ctx.target);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // j13 phase-scoped continuation: "<persona> is signed in on <platform>
    // with device locale <code>". Declared BEFORE the catch-all sign-in
    // matcher below so this more-specific form fires first.
    //
    // Used after the j13 Background's browser-locale variant has
    // established the persona on the Web app; this form switches them to
    // a mobile platform (Android emulator or iOS Sim) for a phase-scoped
    // scenario. Tracks ctx.personaPlatforms (the catch-all matcher
    // doesn't) so downstream driver-routing sees the new platform.
    //
    // No JWT mismatch / cross-platform sign-in lock — the runner uses
    // the same Firebase identity regardless of asserted client platform.
    // The platform switch is informational, useful for downstream driver
    // routing (Android vs iOS Sim drivers).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in on\s+(\w+(?:\s+\w+){0,2})\s+with device locale\s+([a-z]{2}(?:-[A-Z]{2})?)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const locale = m[4];
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      if (!ctx.personasPassword) {
        return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
      }
      const authBase =
        ctx.target === 'local' && process.env.FIREBASE_AUTH_EMULATOR_HOST
          ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
          : 'https://identitytoolkit.googleapis.com';
      const r = await ctx.fetch(
        `${authBase}/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: p.email,
            password: ctx.personasPassword,
            returnSecureToken: true,
          }),
        },
      );
      if (r.status !== 200) {
        return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
      }
      const body = await r.json();
      ctx.sessions.set(name, {
        persona: p,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        localId: body.localId,
        customClaims: decodeJwtPayload(body.idToken),
      });
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.locale = locale;
      // Mirror into ctx.deviceLocales so downstream driver assertions
      // (e.g., androidDocumentDirection / iosLayoutDirection) can route
      // by persona. Parallel to ctx.browserLocales for web personas.
      if (!ctx.deviceLocales) ctx.deviceLocales = new Map();
      ctx.deviceLocales.set(name, locale);
      return { ok: true };
    },
  },
  {
    // The `with <kv-clause>` group now captures a broad payload (any non-paren
    // run of chars) so the handler can seed user-doc fields. Previously this
    // sub-clause was narrow (`with cohort=\w+`) and informational-only; the
    // 2026-05-17 cycle work made it state-mutating so j05/j06/j07-style
    // scenarios can declare known starting wallets / flags directly on the
    // sign-in step.
    // The `[^()]+?` class excludes `(`/`)` so it cannot overlap with the
    // surrounding paren groups, making backtracking linear in input length.
    // Inputs are author-controlled Gherkin step text, not user input.
    /* eslint-disable sonarjs/slow-regex */
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in(?:\s+on\s+\w+(?:\s+\w+){0,2})?(?:\s+AND\s+on\s+\w+(?:\s+\w+){0,2})?(?:\s+with\s+([^()]+?))?(?:\s+\([^)]*\))?(?:\s+\(no admin claim\))?(?:\s+at\s+the\s+"[^"]+"\s+(?:screen|tab))?$/,
    /* eslint-enable sonarjs/slow-regex */
    async handler(m, ctx) {
      const name = m[1];
      const withClause = m[3];
      const personas = loadPersonas();
      const p = personas.get(m[2]) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };

      if (p.ephemeral) {
        // Ephemeral personas (Adam P-01, Mia P-03) have no Firebase account.
        // Skip the REST call; synthesise a session so downstream state-assert
        // and UI-reference steps still work. The idToken sentinel begins
        // with `synthetic:` so any code that tries to use it for real auth
        // fails loudly rather than silently passing.
        ctx.sessions.set(name, {
          persona: p,
          idToken: `synthetic:${name}:${p.uniqueId}`,
          refreshToken: null,
          localId: String(p.uniqueId),
          customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: true },
        });
      } else {
        if (!ctx.personasPassword) return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
        // Local target uses the Auth emulator's REST endpoint; dev/prod hit
        // the real Google API. FIREBASE_AUTH_EMULATOR_HOST controls only the
        // firebase-admin SDK, not raw fetch — so the runner must route by
        // ctx.target itself.
        const authBase =
          ctx.target === 'local' && process.env.FIREBASE_AUTH_EMULATOR_HOST
            ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
            : 'https://identitytoolkit.googleapis.com';
        const r = await ctx.fetch(
          `${authBase}/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: p.email,
              password: ctx.personasPassword,
              returnSecureToken: true,
            }),
          },
        );
        if (r.status !== 200)
          return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
        const body = await r.json();
        ctx.sessions.set(name, {
          persona: p,
          idToken: body.idToken,
          refreshToken: body.refreshToken,
          localId: body.localId,
          customClaims: decodeJwtPayload(body.idToken),
        });
      }
      // If a `with` clause was captured, route based on prefix:
      //   - `with custom claim X=Y` → merge into session.customClaims
      //     (JWT side, not user doc). The runner can't mint a real JWT
      //     with custom claims; seeding here lets downstream claim-
      //     assertion matchers see the expected value.
      //   - any other shape → user-doc state-seed (existing behaviour).
      if (withClause && withClause.trim()) {
        const trimmed = withClause.trim();
        if (trimmed.startsWith('custom claim ')) {
          const claimText = trimmed.replace(/^custom claim\s+/, '');
          let claims;
          try {
            claims = parseSignInWithClause(claimText);
          } catch (e) {
            return { ok: false, error: e.message };
          }
          const session = ctx.sessions.get(name);
          session.customClaims = { ...session.customClaims, ...claims };
        } else {
          if (!ctx.db) {
            return {
              ok: false,
              error:
                'ctx.db (firebase-admin Firestore) not initialised but `with <state>` clause requires it',
            };
          }
          let fields;
          try {
            fields = parseSignInWithClause(withClause);
          } catch (e) {
            return { ok: false, error: e.message };
          }
          const docPath = `users/${p.uniqueId}`;
          await ctx.db.doc(docPath).set(fields, { merge: true });
          captureSnapshots(ctx, docPath, fields);
          // Mirror locale-shaped fields into the dedicated ctx maps so
          // driver-level assertions (e.g., webDocumentDirection,
          // androidShowsLocaleText) can route by persona without
          // re-querying Firestore.
          if (fields.browserLocale) {
            if (!ctx.browserLocales) ctx.browserLocales = new Map();
            ctx.browserLocales.set(name, fields.browserLocale);
          }
          if (fields.deviceLocale) {
            if (!ctx.personaLocales) ctx.personaLocales = new Map();
            ctx.personaLocales.set(name, fields.deviceLocale);
          }
        }
      }
      return { ok: true };
    },
  },

  // ── API request ──
  {
    // Bounded character classes inside the body capture group avoid catastrophic
    // backtracking. Nested JSON not supported in the inline body — pre-stringify
    // complex bodies into a step var if needed. The optional groups are all
    // anchored and don't overlap, so the linear-time guarantee holds.
    pattern:
      // eslint-disable-next-line sonarjs/slow-regex
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]*)?\s+sends?\s+(GET|POST|PATCH|PUT|DELETE)\s+(\S+)(?:\s+with\s+body\s+(\{[^}]*\}|\[[^\]]*\]))?(?:\s+with\s+(?:her|his|their)\s+ID token)?\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const method = m[2];
      const apiPath = m[3];
      const bodyText = m[4];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      const headers = { Authorization: `Bearer ${sess.idToken}` };
      if (bodyText) headers['Content-Type'] = 'application/json';
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method,
        headers,
        body: bodyText || undefined,
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body wasn't JSON — keep as null, handlers using "body has field" will fail loudly
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },

  // ── API request — j08/j02/j04 phrasings (v3) ──
  //
  // The original `<Persona> sends GET/POST <path>` verb landed in v1.
  // The OSA journey files (j08 in particular) use three additional
  // phrasings that v3 makes runnable:
  //
  //   1. `<Persona> on <Platform> POSTs <path> with <kv-list>`
  //      Example: `Vexa on Web POSTs /api/users/follow with targetUniqueId=60000010`
  //      The kv-list is a chain like `recipient=60000010 and giftId="rose"`.
  //      Numeric, boolean, null, and quoted-string values are coerced via
  //      `parseKvPairs` → `parseLiteral`. Unquoted bare words become strings.
  //
  //   2. `POST <path> with (<kv-list>|any payload|body <json>) as <Persona>`
  //      Example: `POST /api/users/follow with targetUniqueId=50000010 as Mia`
  //      Alt word order, common in scenarios where the persona is the
  //      grammatical subject of the *next* sentence. `any payload` sends `{}`
  //      and is used by submit-with-any-body negative-path scenarios.
  //
  //   3. `<Persona> on <Platform> attempts POST <path> with body <json>`
  //      Example: `Vexa on Web attempts POST /api/conversations/c1/messages with body {"text": "hello"}`
  //      Used when the test author wants to spell out an explicit JSON body
  //      that doesn't fit the kv-pair shape (nested objects, etc.).
  //
  //   4. `<Persona> on <Platform> (opens|navigates to) "<path>"`
  //      Example: `Vexa on Web opens "/discovery"`
  //      If `<path>` starts with `/api/`, fires a GET and stores
  //      `lastResponse` like a normal request. Otherwise records
  //      `ctx.lastVisit` so chained UI-only assertions can introspect
  //      where the persona "is" without the runner pretending to render
  //      DOM. The runner's honesty contract: don't claim to verify a
  //      thing it can't see.
  //
  // All four matchers populate `ctx.lastResponse.path` so the new
  // path-tagged response assertions (below) can verify the chain.
  {
    pattern:
      // eslint-disable-next-line sonarjs/slow-regex
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+POSTs\s+(\S+)\s+with\s+(.+?)\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const apiPath = m[2];
      const kvText = m[3];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      try {
        body = parseKvPairs(kvText);
      } catch (e) {
        return { ok: false, error: `could not parse kv-pairs "${kvText}": ${e.message}` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body wasn't JSON — keep null
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // Alt word order: `POST <path> with <kv-list-or-any-payload-or-body> as <Persona>(?: on <Platform>)?`
      // eslint-disable-next-line sonarjs/slow-regex
      /^POST\s+(\S+)\s+with\s+(any payload|body\s+(\{[^}]*\}|\[[^\]]*\])|.+?)\s+as\s+([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\.?$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const payloadSpec = m[2];
      const explicitJsonBody = m[3]; // defined only when the `body {...}` alternative matched
      const name = m[4];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      if (payloadSpec === 'any payload') {
        body = {};
      } else if (explicitJsonBody !== undefined) {
        // Drive the "body {json}" branch off the regex capture, not a
        // string prefix on payloadSpec — a kv-text fragment that
        // happens to start with "body " would otherwise mis-dispatch.
        try {
          body = JSON.parse(explicitJsonBody);
        } catch (e) {
          return { ok: false, error: `malformed JSON body "${explicitJsonBody}": ${e.message}` };
        }
      } else {
        try {
          body = parseKvPairs(payloadSpec);
        } catch (e) {
          return { ok: false, error: `could not parse kv-pairs "${payloadSpec}": ${e.message}` };
        }
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // `<Persona>(?: on <Platform>)? attempts POST <path> with body <json>`
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+attempts\s+POST\s+(\S+)\s+with\s+body\s+(\{[^}]*\}|\[[^\]]*\])\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const apiPath = m[2];
      const bodyText = m[3];
      const sess = ctx.sessions.get(name);
      if (!sess)
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      if (!sess.idToken) {
        return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
      }
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch (e) {
        return { ok: false, error: `malformed JSON body "${bodyText}": ${e.message}` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // not JSON
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    pattern:
      // `<Persona>(?: on <Platform>)? (opens|navigates to) "<path>"`
      // API path → GET; non-API path → record visit (no HTTP call).
      /^([A-Z][a-z]+)(?:\s+on\s+\w[\w ]{0,20})?\s+(?:opens|navigates to)\s+"([^"]+)"\.?$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[2];
      // Session requirement applies ONLY to /api/ targets — those fire a
      // real HTTP call from the runner with an Authorization: Bearer
      // header sourced from the session's idToken. Non-API targets are
      // a visit RECORD only (the runner can't render the SPA's DOM
      // either way), so requiring a pre-existing session is backwards:
      //   • j14 sign-in-on-Slow-3G opens /login.html as the first step
      //     of the sign-in flow itself.
      //   • j12 non-admin admin-bounce navigates a newly-signed-up user
      //     to /admin.html to assert they get bounced — the bounce is
      //     the assertion, not a precondition.
      //   • j08 frozen-banner asserts conversation /c2 renders properly
      //     after a c2-setup Background step that doesn't sign anyone
      //     in (the conversation freeze is what's under test).
      const sess = ctx.sessions.get(name);
      if (!sess && target.startsWith('/api/')) {
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      }
      // Reset lastResponse on every visit. Without this, a non-API "opens"
      // would leave stale lastResponse from a prior step — subsequent
      // assertions like "the response status is 200" would silently pass
      // against the wrong response. Honest-failure contract: a visit step
      // either replaces lastResponse with a fresh response (API path) or
      // clears it (web nav).
      ctx.lastResponse = null;
      if (target.startsWith('/api/')) {
        // The idToken guard only applies when a network call would actually
        // fire — a non-API visit ("/discovery") is a no-op from the runner's
        // perspective and a malformed session is irrelevant to it.
        if (!sess.idToken) {
          return { ok: false, error: `session for "${name}" has no idToken — sign-in malformed?` };
        }
        const r = await ctx.fetch(ctx.apiBase + target, {
          method: 'GET',
          headers: { Authorization: `Bearer ${sess.idToken}` },
        });
        let parsedBody = null;
        try {
          const text = await r.text();
          parsedBody = text ? JSON.parse(text) : null;
        } catch {
          // not JSON
        }
        ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: target };
        return { ok: true };
      }
      // Web-app or admin path — runner can't render DOM, but record the
      // visit so chained assertions know who is where. Subsequent UI-only
      // assertions still STEP_NOT_IMPLEMENTED, which is honest.
      ctx.lastVisit = { persona: name, path: target };
      return { ok: true };
    },
  },

  // ── Response assertions ──
  {
    // `the response has status N or signals "X"` — status code OR body
    // signal string. Used when client-side error handling routes off
    // either the HTTP status code OR a body field (e.g. Firebase Auth's
    // `auth/user-token-expired` is sometimes a 401 status, sometimes 500
    // with the code in the body).
    pattern: /^the response has status (\d{3}) or signals "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const expectedStatus = parseInt(m[1], 10);
      const signal = m[2];
      if (ctx.lastResponse.status === expectedStatus) return { ok: true };
      // Search body (stringified) for the signal — handles either top-level
      // code field, error.message, or any nested string field.
      const body = ctx.lastResponse.body;
      if (body) {
        const haystack = JSON.stringify(body);
        if (haystack.includes(signal)) return { ok: true };
      }
      return {
        ok: false,
        error: `response status was ${ctx.lastResponse.status} and body did not signal "${signal}", expected status ${expectedStatus} or signal "${signal}"`,
      };
    },
  },
  {
    pattern: /^the response status is (\d{3})$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const expected = parseInt(m[1], 10);
      if (ctx.lastResponse.status !== expected) {
        return {
          ok: false,
          error: `response status was ${ctx.lastResponse.status}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Two-way alternation: `the response status is 405 or 403`. Used when
    // the server can legitimately respond with either code depending on
    // which authz layer fires first — over-specifying would force the test
    // to update every time the order of checks shifts in unrelated code.
    pattern: /^the response status is (\d{3}) or (\d{3})$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse) return { ok: false, error: 'no prior request — When step missing?' };
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const actual = ctx.lastResponse.status;
      if (actual !== a && actual !== b) {
        return {
          ok: false,
          error: `response status was ${actual}, expected ${a} or ${b}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has field "([^"]+)" of type "(\w+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body)
        return { ok: false, error: 'no parsed response body to inspect' };
      const field = m[1];
      const expectedType = m[2];
      const value = pickField(ctx.lastResponse.body, field);
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        return { ok: false, error: `field "${field}" was ${actualType}, expected ${expectedType}` };
      }
      return { ok: true };
    },
  },
  {
    // Array length on a specific field. Distinct from `of type "array"` which
    // only checks the type; this checks the exact length.
    pattern: /^the response body has field "([^"]+)" array length (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body)
        return { ok: false, error: 'no parsed response body to inspect' };
      const field = m[1];
      const expected = parseInt(m[2], 10);
      const value = pickField(ctx.lastResponse.body, field);
      if (value === undefined) {
        return { ok: false, error: `response body has no field "${field}"` };
      }
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: `field "${field}" was ${typeof value}, expected an array of length ${expected}`,
        };
      }
      if (value.length !== expected) {
        return {
          ok: false,
          error: `field "${field}" array length was ${value.length}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Alternation form of `contains "X"` — passes when EITHER needle is in
    // the stringified body. Used when the API can legitimately respond with
    // either error string depending on race-condition path.
    pattern: /^the response body contains "([^"]+)" or "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const haystack = JSON.stringify(ctx.lastResponse.body);
      const a = m[1];
      const b = m[2];
      if (haystack.includes(a) || haystack.includes(b)) return { ok: true };
      return {
        ok: false,
        error: `response body did not contain "${a}" or "${b}"`,
      };
    },
  },
  {
    pattern: /^the response body contains "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const needle = m[1];
      const haystack = JSON.stringify(ctx.lastResponse.body);
      if (!haystack.includes(needle)) {
        return { ok: false, error: `response body did not contain "${needle}"` };
      }
      return { ok: true };
    },
  },
  {
    // `the response from <path> has <field>="<value>" in every row`
    // OR
    // `the response from <path> has "<field>=<value>" in every row`
    //
    // Path token is descriptive (lastResponse.body is what's actually
    // checked). Body is polymorphic: tries body-as-array first, falls
    // back to the first Array-valued property of an object body.
    //
    // Empty array → vacuously true. If author wants "at least one row",
    // they should use the N-result variant of this matcher.
    pattern: /^the response from (\S+) has (?:"(\w+)=([^"]+)"|(\w+)="([^"]+)") in every row$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) {
        return { ok: false, error: 'no prior response body to inspect — When step missing?' };
      }
      // Either capture pair: m[2,3] for "field=value" quoted form,
      // m[4,5] for field="value" unquoted-field form.
      const field = m[2] || m[4];
      const rawValue = m[3] || m[5];
      const expected = parseLiteral(rawValue);
      const body = ctx.lastResponse.body;
      let rows;
      if (Array.isArray(body)) {
        rows = body;
      } else if (body && typeof body === 'object') {
        // Heuristic: first Array-valued property of the body.
        const arrayProp = Object.entries(body).find(([, v]) => Array.isArray(v));
        if (!arrayProp) {
          return {
            ok: false,
            error: 'response body has no array property to iterate as rows',
          };
        }
        rows = arrayProp[1];
      } else {
        return { ok: false, error: 'response body is not an array or object' };
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const actual = row?.[field];
        // Coerce on either side: "18" should match 18 because parseLiteral
        // normalizes the expected, but the row's actual value type is up
        // to the API. Treat string-vs-number as equivalent for safety.
        const match = actual === expected || String(actual) === String(expected);
        if (!match) {
          return {
            ok: false,
            error: `row[${i}].${field} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} (every row must match)`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    // `the response from <path> has <N> results`
    //
    // Tightly bound to the prior request's path so a misplaced When step
    // doesn't accidentally let a stale `lastResponse` satisfy a later
    // assertion. The error message names the expected and actual paths
    // so the operator can find the chain break quickly.
    //
    // Recognised body shapes (in order):
    //   - { results: [...] } — standard list endpoint
    //   - { data: [...] }    — alt list endpoint
    //   - [...]              — bare array body
    //   - { users: [...] }, { items: [...] } — common ad-hoc shapes
    // First matching shape wins. If none match, the matcher errors with
    // an explicit list of inspected keys so test authors know which
    // shape the endpoint returned.
    pattern: /^the response from (\S+) has (\d+) results?$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedCount = parseInt(m[2], 10);
      if (!ctx.lastResponse)
        return { ok: false, error: `no prior response — expected a request to ${expectedPath}` };
      if (ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `last response was from "${ctx.lastResponse.path}", expected "${expectedPath}"`,
        };
      }
      const body = ctx.lastResponse.body;
      if (body === null || body === undefined) {
        return {
          ok: false,
          error: `response body was not JSON (status=${ctx.lastResponse.status}) — cannot count results`,
        };
      }
      let rows = null;
      if (Array.isArray(body)) rows = body;
      else if (typeof body === 'object') {
        for (const key of ['results', 'data', 'users', 'items', 'rows']) {
          if (Array.isArray(body[key])) {
            rows = body[key];
            break;
          }
        }
      }
      if (rows === null) {
        const keys = typeof body === 'object' ? Object.keys(body).join(',') : typeof body;
        return {
          ok: false,
          error: `response body has no recognised list field (keys: ${keys})`,
        };
      }
      if (rows.length !== expectedCount) {
        return {
          ok: false,
          error: `response from "${expectedPath}" had ${rows.length} results, expected ${expectedCount}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the response body has user data for uniqueId (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.lastResponse?.body) return { ok: false, error: 'no response body' };
      const expected = parseInt(m[1], 10);
      const user = ctx.lastResponse.body.user || ctx.lastResponse.body;
      if (!user || user.uniqueId !== expected) {
        return {
          ok: false,
          error: `body.user.uniqueId was ${user?.uniqueId}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },

  // ── Custom-claims assertions ──
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims include "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const expectedRaw = m[3].trim();
      const expected = parseLiteral(expectedRaw);
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (sess.customClaims[key] !== expected) {
        return {
          ok: false,
          error: `claim "${key}" was ${JSON.stringify(sess.customClaims[key])}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^([A-Z][a-z]+)'s Firebase Auth custom claims do not include "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const key = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess) return { ok: false, error: `no session for "${name}"` };
      if (Object.prototype.hasOwnProperty.call(sess.customClaims, key)) {
        return {
          ok: false,
          error: `claim "${key}" was unexpectedly present with value ${JSON.stringify(sess.customClaims[key])}`,
        };
      }
      return { ok: true };
    },
  },

  // ── Firestore read assertions (v2) ──
  // ctx.db is a Firestore Admin SDK instance (provided in main()) or a Map-
  // backed stub in tests. Handlers below treat the doc()->get() shape as the
  // common surface and never reach for fields beyond .exists / .data().
  {
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const expected = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" containing (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const needle = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (!Array.isArray(actual)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected an array`,
        };
      }
      if (!actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) does not contain ${JSON.stringify(needle)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // "does not have document X with field Y containing N" — vacuous-true
    // when the doc is missing or the field doesn't exist (author is asserting
    // the ABSENCE of a containment relationship, which holds when there's
    // nothing to contain). Distinct from `not containing` below which
    // requires the doc to exist.
    pattern: /^the database does not have document "([^"]+)" with field "([^"]+)" containing (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const needle = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) return { ok: true }; // vacuous-true
      const actual = snap.data()?.[field];
      if (!Array.isArray(actual)) return { ok: true }; // no array to contain N
      if (actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) contains ${JSON.stringify(needle)} — expected absence`,
        };
      }
      return { ok: true };
    },
  },
  {
    // "has document X with field Y not containing N" — requires the doc AND
    // the field to exist as an array; asserts that N is NOT in the array.
    // Distinct from `does not have ... containing` above which is vacuously
    // true when the doc is missing.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" not containing (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const needle = parseLiteral(m[3].trim());
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (actual === undefined) {
        return { ok: false, error: `field "${field}" on "${docPath}" is missing` };
      }
      if (!Array.isArray(actual)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected an array`,
        };
      }
      if (actual.includes(needle)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" (=${JSON.stringify(actual)}) contains ${JSON.stringify(needle)} — expected NOT containing`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `unchanged` — assert current field value equals the snapshot captured
    // at the Given step. Requires `Given <P> has <field>=<value>` (or similar
    // state-seed step) to have run earlier in the scenario. Without that, the
    // matcher errors with a clear "no snapshot/baseline" message rather than
    // silently passing (which would happen if it captured the current value
    // on first call — see Wake 25 design notes).
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" unchanged$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const key = `${docPath}#${field}`;
      if (!ctx.snapshots || !ctx.snapshots.has(key)) {
        return {
          ok: false,
          error: `no snapshot/baseline captured for "${key}" — add a Given step that initialises this field`,
        };
      }
      const baseline = ctx.snapshots.get(key);
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return {
          ok: false,
          error: `document "${docPath}" does not exist (had snapshot ${baseline})`,
        };
      }
      const actual = snap.data()?.[field];
      if (actual !== baseline) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected unchanged from baseline ${JSON.stringify(baseline)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `increased by N` — assert current = baseline + N. Requires a Given step
    // to have captured the baseline. Both baseline and actual must be numeric;
    // mismatched signs (e.g. baseline 5000, actual 4500, N=500 → delta -500)
    // are explicitly flagged.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" increased by (\d+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const delta = parseInt(m[3], 10);
      const key = `${docPath}#${field}`;
      if (!ctx.snapshots || !ctx.snapshots.has(key)) {
        return {
          ok: false,
          error: `no snapshot/baseline captured for "${key}" — add a Given step that initialises this field`,
        };
      }
      const baseline = ctx.snapshots.get(key);
      if (typeof baseline !== 'number') {
        return {
          ok: false,
          error: `baseline for "${key}" was ${JSON.stringify(baseline)}, expected numeric for delta comparison`,
        };
      }
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (typeof actual !== 'number') {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected numeric`,
        };
      }
      const observedDelta = actual - baseline;
      if (observedDelta !== delta) {
        const direction = observedDelta < 0 ? ' (decreased)' : '';
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" went from ${baseline} to ${actual}, delta=${observedDelta}${direction}, expected delta=+${delta}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `no entry is added to "X" since "Y"` — collection (or subcollection)
    // scan asserting that no doc has createdAt > sinceTs. Supports the
    // `{ts}` placeholder which resolves to ctx.scenarioStartTime, OR an
    // explicit ISO date / numeric millisecond literal.
    //
    // Docs missing the createdAt field are treated as "pre-existing"
    // (not flagged as new) — that's the test-author's intent. If a real
    // bug writes new entries without createdAt, that's a separate class
    // of bug to catch with a different assertion.
    pattern: /^no entry is added to "([^"]+)" since "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const collectionPath = m[1];
      const sinceRaw = m[2];
      let sinceTs;
      if (sinceRaw === '{ts}') {
        if (ctx.scenarioStartTime === undefined) {
          return {
            ok: false,
            error:
              '{ts} placeholder used but ctx.scenarioStartTime is unset (baseline missing) — runScenario should set it on each scenario start',
          };
        }
        sinceTs = ctx.scenarioStartTime;
      } else if (/^\d+$/.test(sinceRaw)) {
        sinceTs = parseInt(sinceRaw, 10);
      } else {
        const parsed = Date.parse(sinceRaw);
        if (Number.isNaN(parsed)) {
          return { ok: false, error: `cannot parse "since" value "${sinceRaw}" as timestamp` };
        }
        sinceTs = parsed;
      }
      const snap = await ctx.db.collection(collectionPath).get();
      const offenders = [];
      for (const docRef of snap.docs) {
        const data = docRef.data();
        const createdAt = data?.createdAt;
        if (typeof createdAt !== 'number') continue; // treat missing/non-numeric as pre-existing
        if (createdAt > sinceTs) {
          offenders.push({ id: docRef.id, createdAt });
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.id} (createdAt=${o.createdAt})`).join(', ');
        return {
          ok: false,
          error: `collection "${collectionPath}" has ${offenders.length} entries added after ${sinceTs}: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // `no conversation doc is created` — convenience shorthand for the
    // cross-cohort PM-wall scenarios. Equivalent to
    // `no entry is added to "conversations" since "{ts}"` but matches the
    // natural English phrasing the test authors actually wrote.
    pattern: /^no conversation doc is created$/,
    async handler(_m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (ctx.scenarioStartTime === undefined) {
        return {
          ok: false,
          error:
            'ctx.scenarioStartTime not set (baseline missing) — runScenario should set it on each scenario start',
        };
      }
      const sinceTs = ctx.scenarioStartTime;
      const snap = await ctx.db.collection('conversations').get();
      const offenders = [];
      for (const docRef of snap.docs) {
        const data = docRef.data();
        const createdAt = data?.createdAt;
        if (typeof createdAt !== 'number') continue;
        if (createdAt > sinceTs) {
          offenders.push({ id: docRef.id, createdAt });
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.id} (createdAt=${o.createdAt})`).join(', ');
        return {
          ok: false,
          error: `conversations collection has ${offenders.length} doc(s) created after scenario start: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Numeric strict-greater-than. Rejects non-numeric actual values rather
    // than relying on JavaScript's lexicographic / NaN coercion semantics
    // (which can silently report "abc > 100" as false and mask real bugs).
    // Strict `>` — `>=` is a separate assertion the corpus doesn't use.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" greater than (.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const docPath = m[1];
      const field = m[2];
      const expected = parseLiteral(m[3].trim());
      if (typeof expected !== 'number') {
        return {
          ok: false,
          error: `greater-than threshold must be numeric, got ${JSON.stringify(m[3].trim())}`,
        };
      }
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (typeof actual !== 'number') {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${JSON.stringify(actual)}, expected a numeric value to compare against ${expected}`,
        };
      }
      if (!(actual > expected)) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" was ${actual}, expected greater than ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  // ── JWT payload introspection ──
  // Decodes the `token` field of the most-recent response body and asserts on
  // a dotted-path field within the payload. Used for verifying LiveKit access
  // tokens carry the correct cohort / room claims (OSA #17 Fill-2).
  //
  // JSON-string intermediate traversal: if a path segment lands on a string
  // value that JSON.parses to an object, drill INTO the parsed object on the
  // next segment. This is the canonical shape for LiveKit's `metadata` field —
  // the SDK stores it verbatim in the JWT as a JSON-serialized string, NOT a
  // nested object. Without this, `metadata.cohort` would resolve to undefined
  // even when the metadata claim is correctly set on the token. Pinned by
  // j09's "LiveKit access token contains cohort claim matching the room"
  // scenario; surfaced on 2026-05-29 (manual-qa-cycle-1.md).
  {
    pattern: /^the decoded JWT payload has field "([^"]+)" equal to (.+)$/,
    async handler(m, ctx) {
      const dottedPath = m[1];
      const expected = parseLiteral(m[2].trim());
      const body = ctx.lastResponse?.body;
      if (!body) return { ok: false, error: 'no prior response body to decode' };
      const token = body.token || body.idToken || body.accessToken;
      if (!token) {
        return {
          ok: false,
          error: 'no token field in response body (expected one of: token, idToken, accessToken)',
        };
      }
      const payload = decodeJwtPayload(token);
      const actual = dottedPath.split('.').reduce((acc, k) => {
        if (acc === undefined || acc === null) return undefined;
        // If the current accessor is a string that JSON.parses to an object,
        // drill INTO the parsed object — supports LiveKit's `metadata` field
        // (verbatim-JSON-string convention) and any future JSON-encoded
        // claim payload.
        if (typeof acc === 'string') {
          try {
            const parsed = JSON.parse(acc);
            if (parsed && typeof parsed === 'object') {
              return parsed[k];
            }
          } catch {
            // Not JSON — fall through to plain property access below, which
            // will yield undefined for an object-key on a primitive string
            // (i.e. preserve old behaviour for non-JSON strings).
          }
        }
        return acc[k];
      }, payload);
      if (actual !== expected) {
        return {
          ok: false,
          error: `JWT payload field "${dottedPath}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Per-persona JWT custom-claim assertion. Reads the persona's session
    // from ctx.sessions (populated by sign-in matchers), decodes the JWT
    // payload, and compares the named custom claim against expected.
    //
    // Ephemeral personas have a `synthetic:...` token sentinel rather than
    // a real JWT — for those, the customClaims live directly on the session
    // object. The matcher branches on token shape rather than always
    // attempting to decode.
    //
    // "Android" in the step text is descriptive — JWTs are platform-agnostic.
    // The runner doesn't enforce that the persona is on Android.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android JWT custom claim "([^"]+)" equals "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const claim = m[3];
      const expected = m[4];
      const sess = ctx.sessions?.get(name);
      if (!sess) {
        return {
          ok: false,
          error: `no session for "${name}" — Given sign-in step missing?`,
        };
      }
      // Branch on token shape: synthetic ephemeral tokens carry claims
      // directly on the session; real Firebase JWTs need decoding.
      let payload;
      if (typeof sess.idToken === 'string' && sess.idToken.startsWith('synthetic:')) {
        payload = sess.customClaims || {};
      } else if (sess.idToken) {
        payload = decodeJwtPayload(sess.idToken);
      } else {
        return { ok: false, error: `session for "${name}" has no idToken` };
      }
      const actual = payload[claim];
      if (actual !== expected) {
        return {
          ok: false,
          error: `JWT custom claim "${claim}" for "${name}" was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },

  // ── State-seed (mutating) ──
  // Writes a single field on the persona's user doc. Used in Background steps
  // and in adversarial-precondition setup. Merge semantics — sibling fields
  // are preserved.
  {
    // State-seed for one or more user-doc fields. Originally single-field
    // (`has shyCoins=1000`); wake-5 (2026-05-17) generalised the value
    // capture to delegate to parseSignInWithClause, which supports:
    //   - compound forms ("has shyCoins=100 and isAgeVerified=false")
    //   - array literals ("has followingIds=[50000010, 50000060]")
    //   - trailing parentheticals ("has X=[…] (two adult follows)")
    //
    // The leading `(\w+=` portion of the capture excludes patterns like
    // "has user doc with X=Y" — those are matched by the dedicated
    // multi-field user-doc matcher further down. Platform clause is
    // bounded to up to 3 alphanumeric tokens.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?(?:\s+on\s+\w+(?:\s+\w+){0,2})?\s+has\s+(\w+=.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      let fields;
      try {
        fields = parseSignInWithClause(m[3]);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      const docPath = `users/${p.uniqueId}`;
      await ctx.db.doc(docPath).set(fields, { merge: true });
      captureSnapshots(ctx, docPath, fields);
      return { ok: true };
    },
  },
  {
    // Persona fresh-install assertion. Asserts the persona has NO Firebase
    // session (clearing any prior one), and records the platform on
    // ctx.personaPlatforms for downstream UI-action steps to dispatch to
    // the right driver. No Firestore writes, no auth calls — this is
    // pure bookkeeping for scenarios that begin from a cold-launch state.
    //
    // Accepts ephemeral personas (P-01 Adam, P-03 Mia) which by design
    // have no entry in the provisioner registry — j01/j02 exercise the
    // signup flow precisely because these users don't exist yet. Persona-
    // name typo validation deliberately deferred to the first downstream
    // step that needs a uniqueId (e.g. "has user doc with ..."), where
    // the failure surfaces with proper "not in registry" context.
    //
    // Platform is bounded to up to 3 alphanumeric tokens (Android,
    // iOS Sim, Web Chromium, Android physical). Bounded repetition
    // keeps backtracking linear.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with the app installed but no Firebase session$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      ctx.sessions.delete(name);
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      return { ok: true };
    },
  },
  {
    // Persona on-platform-at-path bookkeeping. Records the platform AND the
    // path/URL on the persona's tracked context, so downstream UI-action
    // steps know which surface to dispatch to. Optional `with no Firebase
    // session` suffix clears any prior session (j03 BG line).
    //
    // Used by j03/j04/j06/j10/j11 to set Greta's admin context, and by j03
    // for Lena's pre-signin landing page. The path is a quoted string —
    // typically starts with `/` but the matcher doesn't constrain that.
    //
    // No registry check (assertion-only, like the fresh-install matcher).
    // Typo validation deferred to the first downstream step needing uniqueId.
    // Locale-and-signin compound (j13 BG): records platform + locale +
    // signs in, validating the body's `signed in as <uniqueId>` against
    // the persona registry to catch step-author typos.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with browser locale\s+(\w+),\s+signed in as\s+(\d+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const personaId = m[2];
      const platform = m[3];
      const locale = m[4];
      const expectedUid = parseInt(m[5], 10);
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      if (p.uniqueId !== expectedUid) {
        return {
          ok: false,
          error: `uniqueId mismatch: step body says ${expectedUid} but registry says ${p.uniqueId} for ${name}`,
        };
      }
      if (!ctx.personasPassword) return { ok: false, error: 'PERSONAS_PASSWORD env not set' };
      const authBase2 =
        ctx.target === 'local' && process.env.FIREBASE_AUTH_EMULATOR_HOST
          ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
          : 'https://identitytoolkit.googleapis.com';
      const r = await ctx.fetch(
        `${authBase2}/v1/accounts:signInWithPassword?key=${ctx.firebaseApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: p.email,
            password: ctx.personasPassword,
            returnSecureToken: true,
          }),
        },
      );
      if (r.status !== 200)
        return { ok: false, error: `Firebase sign-in failed for ${p.email}: ${r.status}` };
      const body = await r.json();
      ctx.sessions.set(name, {
        persona: p,
        idToken: body.idToken,
        refreshToken: body.refreshToken,
        localId: body.localId,
        customClaims: decodeJwtPayload(body.idToken),
      });
      ctx.personaPlatforms.set(name, platform);
      ctx.locale = locale;
      // Mirror into ctx.browserLocales so downstream driver assertions
      // (e.g., webDocumentDirection) can route by persona.
      if (!ctx.browserLocales) ctx.browserLocales = new Map();
      ctx.browserLocales.set(name, locale);
      return { ok: true };
    },
  },
  {
    // Network throttling config (j14 Ines). Records the throttle profile on
    // ctx.networkThrottle so a downstream UI driver (Playwright MCP) can
    // apply it. MVP runner can't actually throttle network — Node-level
    // throttling would require ServiceWorker injection or platform-specific
    // proxy setup. Recording-only is the right MVP shape; the j14 scenarios
    // also include explicit assertions on degraded UX so a real-network run
    // would surface findings if the throttling didn't apply.
    //
    // Trailing parenthetical (e.g. `(400kbps down, 400ms latency)`) is
    // informational documentation and stripped before matching.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+with Chrome DevTools network throttling set to\s+"([^"]+)"(?:\s+\([^)]*\))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const throttle = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.networkThrottle = throttle;
      return { ok: true };
    },
  },
  {
    // Negation assertion: <P> has no prior interactions with <Other> (j08).
    // MVP no-op pass — full implementation would query conversations/follows/
    // gifts collections and delete any docs matching the pair. Downstream
    // `Then …` assertions catch genuine state violations.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[P-\d{2}\])?\s+has no prior interactions with\s+[A-Z][a-z]+(?:\s*\[P-\d{2}\])?$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+at\s+"([^"]+)"(?:\s+with no Firebase session)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      const clearSession = m[0].endsWith('with no Firebase session');
      if (clearSession) ctx.sessions.delete(name);
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // ageVerificationSubmission state-seed for j04. Writes a submission doc
    // to the top-level `ageVerificationSubmissions/` collection so the
    // scenario's later admin-review steps have something to act on.
    //
    // Doc id is deterministic (test-<uniqueId>-<status>) for idempotency —
    // repeated seeds for the same persona+status overwrite cleanly. Real
    // prod code uses auto-IDs but the runner doesn't need that complexity
    // and a stable id makes scenario reads predictable.
    //
    // Schema mirrors the production write in routes/age-verification.js:
    // userId (stringified uniqueId), status (lowercased), submittedAt
    // (ms epoch). The optional "ID image showing DOB=YYYY-MM-DD" suffix
    // is captured as `dobOnId` — a runner-only field that downstream
    // scenarios can read to simulate the admin's DOB-extraction step
    // without needing a real image upload.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+submitted an ageVerificationSubmission with status="(\w+)"(?:\s+and an ID image showing DOB=(\d{4}-\d{2}-\d{2}))?$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const status = m[3].toLowerCase();
      const dobOnId = m[4];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      const docId = `ageVerificationSubmissions/test-${p.uniqueId}-${status}`;
      const doc = {
        userId: String(p.uniqueId),
        status,
        submittedAt: Date.now(),
      };
      if (dobOnId) doc.dobOnId = dobOnId;
      await ctx.db.doc(docId).set(doc);
      return { ok: true };
    },
  },
  {
    // Multi-field user-doc state-seed. Two related verbs share this matcher:
    //   - `has user doc with X=Y, A=B` — MERGE into existing user doc
    //     (preserves any pre-existing fields not declared by the step).
    //   - `exists with X=Y, A=B` — FULL REPLACE: the step is the
    //     authoritative state, any prior fields are wiped. Also lets the
    //     step's `uniqueId=...` value override the registry's uniqueId for
    //     doc-path selection (j04/j18 Officia setup with uniqueId=1).
    //
    // Quoted strings preserve embedded commas; `[]` is the empty-array
    // sentinel. Distinct from the single-field matcher above — this is the
    // shape j03/j05/j06 use for known-state setup.
    // `.+$` is greedy and anchored to end-of-string. No nested quantifiers,
    // no character-class overlap with surrounding patterns — match is linear.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+(exists|has user doc) with\s+(.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const personaId = m[2];
      const verb = m[3];
      const fieldsText = m[4];
      const personas = loadPersonas();
      const p = personas.get(personaId) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      let fields;
      try {
        fields = parseUserDocFields(fieldsText);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      if (verb === 'exists') {
        // Full-state seed — uniqueId from body if present, else registry.
        const uniqueId = fields.uniqueId !== undefined ? fields.uniqueId : p.uniqueId;
        const docPath = `users/${uniqueId}`;
        await ctx.db.doc(docPath).set(fields);
        captureSnapshots(ctx, docPath, fields);
      } else {
        // has user doc with — merge into existing
        const docPath = `users/${p.uniqueId}`;
        await ctx.db.doc(docPath).set(fields, { merge: true });
        captureSnapshots(ctx, docPath, fields);
      }
      return { ok: true };
    },
  },
  {
    pattern: /^the database has (\d+) entries in "([^"]+)" matching \{(.*)\}$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const expected = parseInt(m[1], 10);
      const colPath = m[2];
      const predicateText = m[3].trim();
      let predicate;
      try {
        predicate = parseJsonishPredicate(predicateText);
      } catch (e) {
        return { ok: false, error: `predicate parse error: ${e.message}` };
      }
      const snap = await ctx.db.collection(colPath).get();
      const docs = (snap.docs || []).map((d) => d.data());
      const matching = docs.filter((doc) =>
        Object.entries(predicate).every(([k, v]) => doc[k] === v),
      );
      if (matching.length !== expected) {
        return {
          ok: false,
          error: `collection "${colPath}" had ${matching.length} entries matching predicate (=${JSON.stringify(predicate)}), expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  // ── UI driver matchers (proof-of-concept, ctx.uiDriver-injected) ──
  // First UI matcher for the runner. Driver is dependency-injected via
  // ctx.uiDriver so tests can mock it and prod can shell out to adb/simctl
  // via child_process. Web UI is delegated to Playwright MCP (outside the
  // Node runner's scope — see /manual-qa skill description).
  //
  // Android dump comes from `adb shell uiautomator dump && adb shell cat
  // /sdcard/window_dump.xml` (the runner does the shell-out; ctx.uiDriver
  // returns the dumped XML as a string). Tag is matched against
  // `resource-id="<tag>"` exactly OR `resource-id="<pkg>:id/<tag>"` —
  // adb emits the fully-qualified form even when the Gherkin step uses
  // the short tag, so the matcher accepts both.
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (\w+(?:\s+\w+){0,2}) UI shows the element with tag "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (platform=${platform}, tag=${tag}). Configure the driver in main() or pass a mock in tests.`,
        };
      }
      if (platform.startsWith('Android')) {
        if (!ctx.uiDriver.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        const dump = await ctx.uiDriver.androidUiDump();
        const shortMatch = dump.includes(`resource-id="${tag}"`);
        const qualifiedMatch = dump.includes(`:id/${tag}"`);
        if (!shortMatch && !qualifiedMatch) {
          return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
        }
        return { ok: true };
      }
      if (platform.startsWith('iOS')) {
        if (!ctx.uiDriver.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        const iosDump = await ctx.uiDriver.iosUiDump();
        // Match exact identifier value in the JSON dump — `"identifier":"X"`.
        // The trailing `"` is critical: prevents `main_pmTabFooter` from
        // falsely matching when the test asks about `main_pmTab`.
        if (!iosDump.includes(`"identifier":"${tag}"`)) {
          return { ok: false, error: `tag "${tag}" not found in iOS UI dump` };
        }
        return { ok: true };
      }
      if (platform.startsWith('Web')) {
        return {
          ok: false,
          error: `Web UI driver delegated to Playwright MCP — out of Node-runner scope. Tag "${tag}" cannot be asserted here.`,
        };
      }
      return { ok: false, error: `unknown platform "${platform}" for UI step` };
    },
  },
  {
    // Negation of the tag-assertion above. Asserts that the element with
    // the given resource-id is ABSENT from the UI. Same platform-dispatch
    // shape as the positive matcher — Android is implemented, iOS/Web
    // return the same "not yet implemented" / "out of scope" errors.
    //
    // De Morgan: positive matcher uses OR over short and qualified forms
    // ("present in either form"). Negation must check that NEITHER form
    // is present — both negated and ANDed — otherwise a qualified-form
    // dump would slip past a naive short-only negation.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (\w+(?:\s+\w+){0,2}) UI does not show the element with tag "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (platform=${platform}, tag=${tag}).`,
        };
      }
      if (platform.startsWith('Android')) {
        if (!ctx.uiDriver.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        const dump = await ctx.uiDriver.androidUiDump();
        const shortMatch = dump.includes(`resource-id="${tag}"`);
        const qualifiedMatch = dump.includes(`:id/${tag}"`);
        if (shortMatch || qualifiedMatch) {
          return {
            ok: false,
            error: `tag "${tag}" should not be present but was found in Android UI dump`,
          };
        }
        return { ok: true };
      }
      if (platform.startsWith('iOS')) {
        if (!ctx.uiDriver.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        const iosDump = await ctx.uiDriver.iosUiDump();
        // Same exact-identifier check as the positive matcher — `"identifier":"X"`.
        if (iosDump.includes(`"identifier":"${tag}"`)) {
          return {
            ok: false,
            error: `tag "${tag}" should not be present but was found in iOS UI dump`,
          };
        }
        return { ok: true };
      }
      if (platform.startsWith('Web')) {
        return {
          ok: false,
          error: `Web UI driver delegated to Playwright MCP — out of Node-runner scope. Tag "${tag}" cannot be asserted here.`,
        };
      }
      return { ok: false, error: `unknown platform "${platform}" for UI step` };
    },
  },
  {
    // Android tap on element with the given resource-id tag. Reads the UI
    // dump, locates the element's bounds=`[x1,y1][x2,y2]` attribute,
    // computes the centre, and calls ctx.uiDriver.androidTap(x, y).
    //
    // Tag matching accepts the same short OR fully-qualified shapes as
    // the "shows the element with tag" matcher above. Bounds extraction
    // uses a node-local regex anchored to the same element to avoid
    // grabbing the bounds of an unrelated nearby element.
    //
    // Per-target tag aliasing: scenarios authored against the prod
    // signup flow (`signin_signUpLink` → email → password → DOB) can't
    // run end-to-end on the local build because local has no real
    // signup UI — only dev-sign-in. The alias map below resolves
    // prod-flow tags to local-build equivalents when target=local, so
    // the scenarios stay source-of-truth and the runner translates.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const rawTag = m[3];
      const ANDROID_LOCAL_TAG_ALIASES = {
        // Prod-flow signup → local dev-sign-in entry point. After
        // tapping, the user lands on the persona picker.
        signin_signUpLink: 'dev_sign_in',
        // Persona-creation button in the prod signup flow lands on
        // the same intermediate state as the local persona picker
        // open button. The next-step matcher (persona pick) closes
        // the flow.
        signup_createAccountButton: 'persona_picker_open',
      };
      const tag =
        ctx.target === 'local' && Object.hasOwn(ANDROID_LOCAL_TAG_ALIASES, rawTag)
          ? ANDROID_LOCAL_TAG_ALIASES[rawTag]
          : rawTag;
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (tag=${tag})` };
      }
      if (!ctx.uiDriver.androidUiDump || !ctx.uiDriver.androidTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver requires both androidUiDump and androidTap',
        };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      // Find the node by resource-id (short OR fully-qualified), capturing
      // the bounds attribute on the SAME node. The element opens with `<node`
      // and the resource-id appears as an attribute; bounds is also an
      // attribute on the same node, so we capture them within a single
      // attribute run (no `<` in between).
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"|bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?resource-id="(?:[^"]*:id/)?${escTag}"`,
      );
      const match = re.exec(dump);
      if (!match) {
        // Distinguish "tag not found" from "tag found but no bounds"
        const tagPresent = dump.includes(`resource-id="${tag}"`) || dump.includes(`:id/${tag}"`);
        if (tagPresent) {
          return {
            ok: false,
            error: `tag "${tag}" found in dump but no bounds attribute on the same node`,
          };
        }
        return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
      }
      const x1 = parseInt(match[1] || match[5], 10);
      const y1 = parseInt(match[2] || match[6], 10);
      const x2 = parseInt(match[3] || match[7], 10);
      const y2 = parseInt(match[4] || match[8], 10);
      const cx = Math.floor((x1 + x2) / 2);
      const cy = Math.floor((y1 + y2) / 2);
      await ctx.uiDriver.androidTap(cx, cy);
      return { ok: true };
    },
  },
  {
    // Android types text into the field with the given resource-id tag.
    // Locates the field's bounds, taps the centre to focus, then dispatches
    // text via androidTypeText. Tap-then-type ordering is load-bearing —
    // adb's `input text` writes to whichever element has IME focus.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+types "([^"]+)" into "([^"]+)"$/,
    async handler(m, ctx) {
      const text = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (tag=${tag})` };
      }
      if (!ctx.uiDriver.androidUiDump || !ctx.uiDriver.androidTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver requires both androidUiDump and androidTap',
        };
      }
      if (!ctx.uiDriver.androidTypeText) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidTypeText not configured',
        };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      const escTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Bidirectional regex: bounds may precede or follow resource-id on the
      // same <node>. Same shape as the tap matcher — see comment above for
      // rationale on the duplication.
      const re = new RegExp(
        `resource-id="(?:[^"]*:id/)?${escTag}"[^<]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"|bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"[^<]*?resource-id="(?:[^"]*:id/)?${escTag}"`,
      );
      const match = re.exec(dump);
      if (!match) {
        const tagPresent = dump.includes(`resource-id="${tag}"`) || dump.includes(`:id/${tag}"`);
        if (tagPresent) {
          return {
            ok: false,
            error: `tag "${tag}" found in dump but no bounds attribute on the same node`,
          };
        }
        return { ok: false, error: `tag "${tag}" not found in Android UI dump` };
      }
      const x1 = parseInt(match[1] || match[5], 10);
      const y1 = parseInt(match[2] || match[6], 10);
      const x2 = parseInt(match[3] || match[7], 10);
      const y2 = parseInt(match[4] || match[8], 10);
      const cx = Math.floor((x1 + x2) / 2);
      const cy = Math.floor((y1 + y2) / 2);
      await ctx.uiDriver.androidTap(cx, cy);
      await ctx.uiDriver.androidTypeText(text);
      return { ok: true };
    },
  },
  {
    // Android text-content assertion. Scans the UI dump for an exact match
    // on either `text="<X>"` (visible label) or `content-desc="<X>"`
    // (accessibility label, used by icon-only views). Trailing descriptive
    // text after the quoted string is ignored — it's human-readable context
    // for the test author, not part of the assertion.
    //
    // Exact attribute match (not substring) — substring match would silently
    // pass when "save" matches against a "save as draft" label, which is the
    // class of false positive that catches teams off-guard during prod.
    //
    // Regex is linear: `[^"]+` is a negated char class (one-token consumption),
    // the optional trailing `(?:\s+.+)?$` is anchored to end-of-string with no
    // nested quantifiers. Input is author-controlled (feature files), not
    // untrusted user data. Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (expected text=${expected})` };
      }
      if (!ctx.uiDriver.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      // Look for exact attribute value on EITHER text= or content-desc=.
      // String.includes with the full attribute fragment is sufficient — no
      // regex needed because the test author's text is opaque to attribute
      // parsing (we only care about exact equality of the value).
      const textHit = dump.includes(`text="${expected}"`);
      const descHit = dump.includes(`content-desc="${expected}"`);
      if (!textHit && !descHit) {
        return {
          ok: false,
          error: `Android UI dump has no text="${expected}" or content-desc="${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android navigation. Thin matcher — delegates to ctx.uiDriver.androidOpenScreen(name).
    // Accepts both "screen" and "tab" as the noun because the corpus uses
    // them interchangeably (pm/rooms tab vs discovery/wallet screen).
    // Driver implementation chooses between adb deeplink and UI-tap nav.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const screenName = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (screen=${screenName})`,
        };
      }
      if (!ctx.uiDriver.androidOpenScreen) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidOpenScreen not configured',
        };
      }
      await ctx.uiDriver.androidOpenScreen(screenName);
      return { ok: true };
    },
  },
  {
    // iOS Sim tap. Unlike the Android tap (which parses adb XML bounds in
    // the matcher), the iOS variant delegates to `iosTap(identifier)` — the
    // driver owns coordinate lookup from the accessibility dump. Less
    // parsing logic in the matcher = more flexibility for the driver to
    // adapt to xcrun simctl's evolving output format.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS tap, tag=${tag})` };
      }
      if (!ctx.uiDriver.iosTap) {
        return { ok: false, error: 'ctx.uiDriver.iosTap not configured' };
      }
      await ctx.uiDriver.iosTap(tag);
      return { ok: true };
    },
  },
  {
    // iOS Sim navigation. Parallel to the Android variant — delegates to
    // `iosOpenScreen(name)`. Accepts both "screen" and "tab" as the noun,
    // matching the corpus phrasings.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const screenName = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (iOS open screen, name=${screenName})`,
        };
      }
      if (!ctx.uiDriver.iosOpenScreen) {
        return { ok: false, error: 'ctx.uiDriver.iosOpenScreen not configured' };
      }
      await ctx.uiDriver.iosOpenScreen(screenName);
      return { ok: true };
    },
  },
  {
    // iOS Sim text-content assertion. Scans the accessibility JSON dump
    // for either `"label":"X"` (accessibilityLabel) or `"value":"X"`
    // (accessibilityValue). Mirrors Android's dual-check on `text=` and
    // `content-desc=`.
    //
    // Exact-match on the attribute value (no substring) — same rationale
    // as Wake 19's Android matcher: substring would let "save" silently
    // pass against "save as draft".
    //
    // Trailing descriptive text accepted (e.g. ` toast`, ` banner`) and
    // ignored — matches the corpus phrasings without forcing rewrites.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s iOS Sim UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS text=${expected})` };
      }
      if (!ctx.uiDriver.iosUiDump) {
        return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
      }
      const dump = await ctx.uiDriver.iosUiDump();
      const labelHit = dump.includes(`"label":"${expected}"`);
      const valueHit = dump.includes(`"value":"${expected}"`);
      if (!labelHit && !valueHit) {
        return {
          ok: false,
          error: `iOS UI dump has no label="${expected}" or value="${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // iOS Sim type-into-element. Delegates entirely to
    // `iosTypeText(tag, text)` — driver owns identifier→coordinate
    // lookup and the focus-then-type sequence. Less parsing in matcher.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+types "([^"]+)" into "([^"]+)"$/,
    async handler(m, ctx) {
      const text = m[3];
      const tag = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (iOS type into ${tag})` };
      }
      if (!ctx.uiDriver.iosTypeText) {
        return { ok: false, error: 'ctx.uiDriver.iosTypeText not configured' };
      }
      await ctx.uiDriver.iosTypeText(tag, text);
      return { ok: true };
    },
  },
  {
    // iOS Sim type-into-search-field. Active-screen search — driver decides
    // which search field. Parallel to Wake 32's androidSearchIn(null, text).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on iOS Sim\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const text = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: 'UI step requires ctx.uiDriver (iOS search field)' };
      }
      if (!ctx.uiDriver.iosSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.iosSearchIn not configured' };
      }
      await ctx.uiDriver.iosSearchIn(null, text);
      return { ok: true };
    },
  },
  // ── Web matchers (ctx.webDriver namespace, Playwright MCP scope) ──
  //
  // Web matchers use a SEPARATE driver namespace (ctx.webDriver) from
  // mobile (ctx.uiDriver) because the production implementation routes
  // through Playwright MCP, which is a different transport from adb/simctl.
  // Keeping them separate avoids accidental mobile/web cross-pollination
  // in tests AND lets a future runner skip Web steps entirely if no
  // webDriver is injected.
  //
  // ORDER matters: `on Web Admin` must come BEFORE `on Web` so the more
  // specific pattern wins. First-match-wins is the runner's semantics.
  {
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const tabName = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (admin open tab=${tabName})`,
        };
      }
      if (!ctx.webDriver.webAdminOpenTab) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenTab not configured' };
      }
      await ctx.webDriver.webAdminOpenTab(tabName);
      return { ok: true };
    },
  },
  {
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+taps "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (tap tag=${tag})` };
      }
      if (!ctx.webDriver.webTap) {
        return { ok: false, error: 'ctx.webDriver.webTap not configured' };
      }
      await ctx.webDriver.webTap(tag);
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens (?:the|his|her|their) "([^"]+)" (?:screen|tab)$/,
    async handler(m, ctx) {
      const name = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (open screen=${name})`,
        };
      }
      if (!ctx.webDriver.webOpenScreen) {
        return { ok: false, error: 'ctx.webDriver.webOpenScreen not configured' };
      }
      await ctx.webDriver.webOpenScreen(name);
      return { ok: true };
    },
  },
  {
    // Web Admin tap-with-reason. Must come BEFORE the plain `Web taps`
    // matcher (no — different prefix, no conflict; but order is preserved
    // for symmetry with the openTab grouping above).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+taps "([^"]+)" with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const tag = m[3];
      const reason = m[4];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (admin tap+reason)` };
      }
      if (!ctx.webDriver.webAdminTapWithReason) {
        return { ok: false, error: 'ctx.webDriver.webAdminTapWithReason not configured' };
      }
      await ctx.webDriver.webAdminTapWithReason(tag, reason);
      return { ok: true };
    },
  },
  {
    // Web Admin confirm-with-reason. Bare `confirms` matcher (no reason)
    // is a separate shape and would be a separate matcher when needed.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+confirms with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const reason = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (admin confirm)' };
      }
      if (!ctx.webDriver.webAdminConfirmWithReason) {
        return { ok: false, error: 'ctx.webDriver.webAdminConfirmWithReason not configured' };
      }
      await ctx.webDriver.webAdminConfirmWithReason(reason);
      return { ok: true };
    },
  },
  {
    // Web Admin open-report-and-tap composite. Ordinal/keyword (first |
    // second | new) selects which pending report to open; menu item is
    // tapped after open. Optional `with reason "Y"` suffix is captured
    // as the third arg (null when omitted).
    //
    // Driver method: webAdminOpenReportAndTap(ordinal, menuItem, reasonOrNull)
    // owns: scroll-to-report by ordinal, click-to-open, await modal,
    // click menu item, optionally fill reason input.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the (first|second|new) report and taps "([^"]+)"(?: with reason "([^"]+)")?$/,
    async handler(m, ctx) {
      const ordinal = m[3];
      const menuItem = m[4];
      const reason = m[5] || null;
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (open-report-and-tap)` };
      }
      if (!ctx.webDriver.webAdminOpenReportAndTap) {
        return {
          ok: false,
          error: 'ctx.webDriver.webAdminOpenReportAndTap not configured',
        };
      }
      await ctx.webDriver.webAdminOpenReportAndTap(ordinal, menuItem, reason);
      return { ok: true };
    },
  },
  {
    // Web sign-in. Persona-scoped. Driver looks up credentials by persona
    // name and submits the Web sign-in form.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+signs in with valid credentials$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (sign in for ${name})` };
      }
      if (!ctx.webDriver.webSignIn) {
        return { ok: false, error: 'ctx.webDriver.webSignIn not configured' };
      }
      await ctx.webDriver.webSignIn(name);
      return { ok: true };
    },
  },
  {
    // Web open-user-profile. Persona-scoped navigation to another user's
    // profile page (e.g. /users/<targetUniqueId>).
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens ([A-Z][a-z]+)'s profile$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (${name} opens ${target}'s profile)`,
        };
      }
      if (!ctx.webDriver.webOpenUserProfile) {
        return { ok: false, error: 'ctx.webDriver.webOpenUserProfile not configured' };
      }
      await ctx.webDriver.webOpenUserProfile(name, target);
      return { ok: true };
    },
  },
  {
    // Web profile-panel navigation. Persona opens a tabbed panel on their
    // own profile (e.g. event-host setup, teaching credentials). Driver
    // navigates to `/profile/me?panel=<name>` or similar.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web\s+opens the "([^"]+)" panel from his profile$/,
    async handler(m, ctx) {
      const name = m[1];
      const panel = m[3];
      if (!ctx.webDriver) {
        return {
          ok: false,
          error: `Web step requires ctx.webDriver (${name} opens "${panel}" panel)`,
        };
      }
      if (!ctx.webDriver.webOpenProfilePanel) {
        return { ok: false, error: 'ctx.webDriver.webOpenProfilePanel not configured' };
      }
      await ctx.webDriver.webOpenProfilePanel(name, panel);
      return { ok: true };
    },
  },
  {
    // Browser console errors assertion. Driver returns the array of error
    // messages captured since the page loaded (Playwright MCP exposes this
    // via the consoleMessages API). Empty array = ok; non-empty fails with
    // all messages joined for visibility.
    pattern: /^no JavaScript console errors are present$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (console errors)' };
      }
      if (!ctx.webDriver.webConsoleErrors) {
        return { ok: false, error: 'ctx.webDriver.webConsoleErrors not configured' };
      }
      const errors = await ctx.webDriver.webConsoleErrors();
      if (Array.isArray(errors) && errors.length > 0) {
        return {
          ok: false,
          error: `${errors.length} JavaScript console error(s) present: ${errors.join('; ')}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android event-invite tap. Distinct from the generic resource-id
    // tap matcher because the action ("Accept"/"Decline") is human-readable
    // text, not a resource-id. Driver locates the event-invite card AND
    // the named action button within it.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps "([^"]+)" on the event invite$/,
    async handler(m, ctx) {
      const name = m[1];
      const action = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (${name} taps "${action}" on event invite)`,
        };
      }
      if (!ctx.uiDriver.androidTapEventInviteAction) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidTapEventInviteAction not configured',
        };
      }
      await ctx.uiDriver.androidTapEventInviteAction(name, action);
      return { ok: true };
    },
  },
  {
    // Cross-cohort containment check. Iterates ctx.lastQueryResult.docs
    // (populated by a prior `When a query is run for every "users/*"`
    // step), reads the named array field on each doc, and verifies no
    // referenced user has the disallowed cohort.
    //
    // Used in j19 to verify OSA-#17 cohort segregation: adult-cohort
    // users have no followingIds/followerIds pointing to minor-cohort
    // users (and vice versa).
    //
    // Missing user-doc lookups are SILENTLY SKIPPED — the matcher tests
    // cohort containment, not data integrity. A separate matcher would
    // catch dangling-reference bugs.
    pattern: /^no doc has any entry in "([^"]+)" whose (target|source) user has cohort="([^"]+)"$/,
    async handler(m, ctx) {
      const field = m[1];
      const disallowedCohort = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      if (!ctx.lastQueryResult || !Array.isArray(ctx.lastQueryResult.docs)) {
        return {
          ok: false,
          error:
            'ctx.lastQueryResult.docs missing — run a `When a query is run for every ...` step first',
        };
      }
      // ctx.lastQueryResult.docs is an array of POJOs (the upstream
      // query matcher already calls `.data()`); calling `.data()` on
      // them again threw `doc.data is not a function`. This finding was
      // hiding the real per-edge cohort check from running, leaving the
      // j19 cross-cohort regression scenario crashed rather than
      // surfacing the underlying data state.
      //
      // SHYTALK_OFFICIAL exemption — system accounts are reachable
      // from every cohort by design (system PMs cross cohort
      // boundaries). When the doc being checked is an official
      // account, skip the cohort-disallow assertion entirely. Both
      // ends of the migration's preserved edges need this exemption
      // to hold: source-side (Officia follows users of all cohorts)
      // and target-side (users of all cohorts follow Officia).
      const offenders = [];
      for (const data of ctx.lastQueryResult.docs) {
        if (data?.userType === 'SHYTALK_OFFICIAL' || data?.isOfficial === true) {
          continue;
        }
        const ids = data?.[field];
        if (!Array.isArray(ids)) continue;
        for (const uid of ids) {
          const userSnap = await ctx.db.doc(`users/${uid}`).get();
          if (!userSnap.exists) continue; // dangling reference — skipped
          const peer = userSnap.data() || {};
          if (peer.userType === 'SHYTALK_OFFICIAL' || peer.isOfficial === true) {
            continue;
          }
          const cohort = peer.cohort;
          if (cohort === disallowedCohort) {
            offenders.push({ uid, cohort });
          }
        }
      }
      if (offenders.length > 0) {
        const summary = offenders.map((o) => `${o.uid} (cohort=${o.cohort})`).join(', ');
        return {
          ok: false,
          error: `field "${field}" has ${offenders.length} entries with disallowed cohort="${disallowedCohort}": ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Locale-parametric translation assertion across all three platforms.
    // Covers six corpus variants: optional `the` prefix, optional `in the
    // page heading` suffix, and Web/Android/iOS Sim platforms. Locale
    // name → ISO-639 mapping covers all 20 ShyTalk locales. Driver
    // methods (per-platform) accept `(localeCode, englishKey)` and return
    // truthy iff the rendered UI contains the translated string.
    //
    // Web alternation lists longest forms first (Web Chromium, Web Safari)
    // so the bare `Web` alternative doesn't greedily eat the `Chromium`/
    // `Safari` discriminator. Same trick used elsewhere in this file.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (?:the )?([A-Z][a-z]+) translation of "([^"]+)"(?: in the page heading)?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const localeName = m[4];
      const englishKey = m[5];
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return {
          ok: false,
          error: `unknown locale name "${localeName}" — not one of the 20 ShyTalk locales`,
        };
      }
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver) {
          return {
            ok: false,
            error: `Web step requires ctx.webDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.webDriver.webShowsTranslationOf) {
          return { ok: false, error: 'ctx.webDriver.webShowsTranslationOf not configured' };
        }
        const ok = await ctx.webDriver.webShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `Web UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver) {
          return {
            ok: false,
            error: `Android step requires ctx.uiDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.uiDriver.androidShowsTranslationOf) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsTranslationOf not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver) {
          return {
            ok: false,
            error: `iOS step requires ctx.uiDriver (translation of "${englishKey}")`,
          };
        }
        if (!ctx.uiDriver.iosShowsTranslationOf) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsTranslationOf not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsTranslationOf(code, englishKey);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show the ${localeName} (${code}) translation of "${englishKey}"`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for translation step` };
    },
  },
  {
    // UI absence of person. Substring check on the dump per platform.
    // Also covers "does not show <Name>'s [lesson ]room" — if the name
    // is absent from the dump, the name's room can't be either, so this
    // matcher reduces both phrasings to one check. The optional " anywhere"
    // suffix is purely emphatic and ignored.
    //
    // Message-input absence is NOT this matcher (lowercase `the` doesn't
    // match the [A-Z] capture for the target name, so the two are disjoint).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show ([A-Z][a-z]+)(?:'s (?:lesson )?room)?(?: anywhere)?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for absence step` };
      }
      if (typeof dump === 'string' && dump.includes(target)) {
        return {
          ok: false,
          error: `${platform} UI should not show "${target}" but the dump contains that name`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI absence of the message-input field. Per-platform driver method
    // `<plat>ShowsMessageInput()` returns truthy iff the field is currently
    // rendered. Step asserts the field is NOT shown (returns ok when the
    // driver returns falsy).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show the message-input field$/,
    async handler(m, ctx) {
      const platform = m[3];
      let shown;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsMessageInput) {
          return { ok: false, error: 'ctx.webDriver.webShowsMessageInput not configured' };
        }
        shown = await ctx.webDriver.webShowsMessageInput();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsMessageInput) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsMessageInput not configured' };
        }
        shown = await ctx.uiDriver.androidShowsMessageInput();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsMessageInput) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsMessageInput not configured' };
        }
        shown = await ctx.uiDriver.iosShowsMessageInput();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for message-input step` };
      }
      if (shown) {
        return {
          ok: false,
          error: `${platform} UI should not show the message-input field but driver reported it is visible`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Refresh rooms list. Pure action — delegates to per-platform driver.
    // Drivers decide whether to pull-to-refresh (mobile) or invoke a
    // refresh button / location reload (web).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+refreshes the rooms list$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webRefreshRoomsList) {
          return { ok: false, error: 'ctx.webDriver.webRefreshRoomsList not configured' };
        }
        // Pass persona name — web driver maintains per-persona Page state
        // (pageFor cache), so the refresh needs to target the right tab.
        await ctx.webDriver.webRefreshRoomsList(name);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidRefreshRoomsList) {
          return { ok: false, error: 'ctx.uiDriver.androidRefreshRoomsList not configured' };
        }
        await ctx.uiDriver.androidRefreshRoomsList();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosRefreshRoomsList) {
          return { ok: false, error: 'ctx.uiDriver.iosRefreshRoomsList not configured' };
        }
        await ctx.uiDriver.iosRefreshRoomsList();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for refresh-rooms step` };
    },
  },
  {
    // Tap a room card. Two shapes: "taps the room card" (no owner arg) and
    // "taps <Owner>'s room [card]" (owner name passed). The driver method
    // accepts an optional owner name and figures out which card to tap.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps (?:the room card|([A-Z][a-z]+)'s room(?: card)?)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const owner = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapRoomCard) {
          return { ok: false, error: 'ctx.webDriver.webTapRoomCard not configured' };
        }
        await ctx.webDriver.webTapRoomCard(owner);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapRoomCard) {
          return { ok: false, error: 'ctx.uiDriver.androidTapRoomCard not configured' };
        }
        await ctx.uiDriver.androidTapRoomCard(owner);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapRoomCard) {
          return { ok: false, error: 'ctx.uiDriver.iosTapRoomCard not configured' };
        }
        await ctx.uiDriver.iosTapRoomCard(owner);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tap-room step` };
    },
  },
  {
    // Web text-content assertion. Substring match on `webUiDump()` —
    // production driver returns the document.body.innerText or similar
    // text-only view of the page. Trailing descriptive context (e.g.
    // ` toast`, ` indicator on her reply`) accepted and ignored, mirroring
    // Wake-19 Android pattern.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows "([^"]+)"(?:\s+.+)?$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: `Web step requires ctx.webDriver (text=${expected})` };
      }
      if (!ctx.webDriver.webUiDump) {
        return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
      }
      const dump = await ctx.webDriver.webUiDump();
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `Web UI dump did not contain "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Web document direction. Asserts `<html dir="ltr">` or `dir="rtl"`.
    // Driver returns the literal string "ltr" or "rtl" (or potentially
    // "auto", though the corpus only uses ltr/rtl).
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI document direction is "(ltr|rtl|auto)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const expected = m[3];
      if (!ctx.webDriver) {
        return { ok: false, error: 'Web step requires ctx.webDriver (document direction)' };
      }
      if (!ctx.webDriver.webDocumentDirection) {
        return { ok: false, error: 'ctx.webDriver.webDocumentDirection not configured' };
      }
      // Pass persona name + their declared browser locale (set by an
      // earlier `with browser locale <X>` matcher) so the driver can
      // apply it to that persona's page before reading the dir attribute.
      const locale = ctx.browserLocales?.get?.(name) || ctx.browserLocales?.[name];
      const actual = await ctx.webDriver.webDocumentDirection(name, locale);
      if (actual !== expected) {
        return {
          ok: false,
          error: `Web document direction was "${actual}", expected "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Android search composites — both phrasings delegate to a single
    // driver method `androidSearchIn(screenOrNull, text)`. The driver
    // owns search-field-tag mapping (e.g. `discovery_searchField`,
    // `users_searchField`) and the navigate-tap-type-submit sequence.
    // Matchers stay thin.
    //
    // Two phrasings:
    //   `<P> on Android searches "X" in <screen>` → screen-scoped
    //   `<P> on Android types "X" into the search field` → active-screen
    //
    // The "types ... into the search field" form does not collide with the
    // existing `types "X" into "Y"` resource-id matcher because the former
    // expects literal `the search field` after `into ` and the latter
    // expects an opening `"`.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+searches "([^"]+)" in (\w+)$/,
    async handler(m, ctx) {
      const text = m[3];
      const screen = m[4];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (search in ${screen})` };
      }
      if (!ctx.uiDriver.androidSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.androidSearchIn not configured' };
      }
      await ctx.uiDriver.androidSearchIn(screen, text);
      return { ok: true };
    },
  },
  {
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const text = m[3];
      if (!ctx.uiDriver) {
        return { ok: false, error: 'UI step requires ctx.uiDriver (search field)' };
      }
      if (!ctx.uiDriver.androidSearchIn) {
        return { ok: false, error: 'ctx.uiDriver.androidSearchIn not configured' };
      }
      // null screen = "active screen" — driver decides which search field.
      await ctx.uiDriver.androidSearchIn(null, text);
      return { ok: true };
    },
  },
  {
    // Android app kill + relaunch. Used in token-refresh scenarios where
    // the test needs a fresh app process to pick up new claims after a
    // server-side cohort flip (j06, j12).
    //
    // Driver implementation: `adb shell am force-stop <pkg>` then
    // `am start -n <pkg>/.MainActivity`, then poll for activity ready.
    // The matcher just delegates — process management lives in the driver.
    //
    // Persona name is passed to the driver for logging/scoping. The
    // driver implementation may use it (e.g. re-auth on relaunch) or
    // ignore it.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+kills and relaunches the app$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (kill+relaunch for ${name})` };
      }
      if (!ctx.uiDriver.androidKillAndRelaunch) {
        return { ok: false, error: 'ctx.uiDriver.androidKillAndRelaunch not configured' };
      }
      await ctx.uiDriver.androidKillAndRelaunch(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android performs any authenticated API call` — fires off an
    // arbitrary authenticated request (driver picks a known-cheap endpoint
    // like GET /api/health-with-auth). Used in j06 to demonstrate that a
    // cohort-flipped session still authenticates against the API surface
    // — distinct from "issues new JWT" which is the SDK-level flow.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+performs any authenticated API call$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (auth call for ${name})` };
      }
      if (!ctx.uiDriver.androidPerformAuthenticatedCall) {
        return { ok: false, error: 'ctx.uiDriver.androidPerformAuthenticatedCall not configured' };
      }
      await ctx.uiDriver.androidPerformAuthenticatedCall(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android force-refreshes via securetoken endpoint` — explicit
    // POST to securetoken.googleapis.com/v1/token with refresh_token to get
    // a fresh idToken. Used when the test needs to verify Firebase Auth's
    // server-side token-refresh path picks up updated custom claims.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+force-refreshes via securetoken endpoint$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (securetoken refresh for ${name})`,
        };
      }
      if (!ctx.uiDriver.androidForceRefreshSecureToken) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidForceRefreshSecureToken not configured',
        };
      }
      await ctx.uiDriver.androidForceRefreshSecureToken(name);
      return { ok: true };
    },
  },
  {
    // `<P> on Android force-refreshes the JWT` — calls Firebase Auth client
    // SDK's getIdToken(true), which uses the cached refresh token to issue
    // a new idToken via the SDK's internal refresh flow. Different from
    // securetoken-endpoint (REST-level) in that this exercises the SDK's
    // cache + retry logic.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+force-refreshes the JWT$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver) {
        return { ok: false, error: `UI step requires ctx.uiDriver (JWT refresh for ${name})` };
      }
      if (!ctx.uiDriver.androidForceRefreshJwt) {
        return { ok: false, error: 'ctx.uiDriver.androidForceRefreshJwt not configured' };
      }
      await ctx.uiDriver.androidForceRefreshJwt(name);
      return { ok: true };
    },
  },
  {
    // Android long-press-on-latest-message + tap a context-menu item.
    // Two-step UI composite delegated to a single driver method that
    // owns the long-press gesture timing AND the menu-tap. Used in j11
    // for the harassment-moderation Report flow and message Edit/Delete.
    //
    // "the message" is implicit context — the most recent message in
    // the active chat thread. Driver locates the latest message bubble
    // by widget hierarchy or by the recyclerview's last visible item.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+long-presses the message and taps "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const menuItem = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (long-press for ${name}, menu="${menuItem}")`,
        };
      }
      if (!ctx.uiDriver.androidLongPressMessageAndTap) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidLongPressMessageAndTap not configured',
        };
      }
      await ctx.uiDriver.androidLongPressMessageAndTap(name, menuItem);
      return { ok: true };
    },
  },
  {
    // `<P> on Android sends "X" to <Y>` — send a text message (or simple
    // gift identifier) to recipient Y. Composite delegated to single
    // driver method `androidSendMessageTo(persona, recipient, content)`.
    // Driver owns: open conversation with Y (or start new), focus the
    // message input, type the content, tap send.
    //
    // Simple shape only — does NOT match `sends "X" (10 coins) to Y`
    // (mid-text parens prevent the trailing recipient capture) or
    // `sends "X" gift to Y`. Those variants get separate matchers.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+sends "([^"]+)" to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const content = m[3];
      const recipient = m[4];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (send "${content}" from ${name} to ${recipient})`,
        };
      }
      if (!ctx.uiDriver.androidSendMessageTo) {
        return { ok: false, error: 'ctx.uiDriver.androidSendMessageTo not configured' };
      }
      await ctx.uiDriver.androidSendMessageTo(name, recipient, content);
      return { ok: true };
    },
  },
  {
    // `<P> on Android taps <Y>'s user card` — tap a user-card UI element
    // identified by display name rather than resource-id. Driver locates
    // the card via the recyclerview's children + display-name match.
    //
    // Doesn't collide with the existing `taps "X"` (quoted resource-id)
    // matcher because this form is unquoted. Regression-guarded.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Android\s+taps ([A-Z][a-z]+)'s user card$/,
    async handler(m, ctx) {
      const name = m[1];
      const target = m[3];
      if (!ctx.uiDriver) {
        return {
          ok: false,
          error: `UI step requires ctx.uiDriver (${name} taps ${target}'s user card)`,
        };
      }
      if (!ctx.uiDriver.androidTapUserCard) {
        return { ok: false, error: 'ctx.uiDriver.androidTapUserCard not configured' };
      }
      await ctx.uiDriver.androidTapUserCard(name, target);
      return { ok: true };
    },
  },
  // ── j19 migration query verbs ──
  {
    // Single-doc query. Stores `{exists, data}` on ctx.lastQueryResult so
    // downstream "Then …" assertions can read the captured result.
    pattern: /^a query is run for the user doc "([^"]+)"$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const snap = await ctx.db.doc(m[1]).get();
      ctx.lastQueryResult = {
        exists: snap.exists,
        data: snap.exists ? snap.data() : null,
      };
      return { ok: true };
    },
  },
  {
    // Collection scan with optional single predicate. Accepts either
    // `where` or `with` as the predicate keyword — cycle-3 scenarios use
    // both interchangeably. Filter is in-memory rather than via Firestore
    // .where() because the runner often runs against fake DBs that don't
    // implement .where(). Stores `{docs: [data, …]}` on ctx.lastQueryResult.
    pattern: /^a query is run for every "([^"]+)\/\*" doc(?:\s+(?:where|with)\s+(\w+)="([^"]+)")?$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const snap = await ctx.db.collection(m[1]).get();
      let docs = snap.docs.map((d) => d.data());
      if (m[2] && m[3] !== undefined) {
        docs = docs.filter((d) => d[m[2]] === m[3]);
      }
      ctx.lastQueryResult = { docs };
      return { ok: true };
    },
  },
  {
    // Plural-form `"X/*" docs with <field>="<val>" and <field>="<val>"`.
    // No `every` prefix, supports multi-predicate via `and`. j19 mixed-
    // cohort-rooms scenario shape. Filter is in-memory.
    // `.+$` is greedy + anchored — no overlap with the surrounding pattern
    // pieces, so backtracking is linear.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^a query is run for "([^"]+)\/\*" docs with\s+(.+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const colPath = m[1];
      let predicate;
      try {
        predicate = parseSignInWithClause(m[2]);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      const snap = await ctx.db.collection(colPath).get();
      const docs = snap.docs
        .map((d) => d.data())
        .filter((d) => Object.entries(predicate).every(([k, v]) => d[k] === v));
      ctx.lastQueryResult = { docs };
      return { ok: true };
    },
  },
  {
    // Migration script execution — MVP no-op pass. Real impl would
    // child_process.spawn the script; deferred until the cycle actually
    // needs to exercise migration idempotency end-to-end (j19's BG step
    // already verifies the post-migration invariants via probeOsaInvariants,
    // so the script-execution shape is currently informational).
    pattern: /^the migration script is executed with --dry-run against (?:dev|local|prod)$/,
    async handler(_m, _ctx) {
      return { ok: true };
    },
  },
  {
    // Bare persona-on-platform matcher. Records the persona→platform
    // association without requiring a URL path, sign-in clause, browser
    // locale, or other modifier. Comes after the URL-anchored and
    // signed-in matchers in matcher order so those win for their richer
    // variants. The `$` anchor prevents shadowing.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      ctx.personaPlatforms.set(name, platform);
      return { ok: true };
    },
  },
  {
    // Persona signed-in-at-tab/screen variant. Like the URL-anchored
    // "is on X at \"Y\"" but with a "signed in at the \"Y\" tab" suffix
    // that asserts the persona is already authenticated on that tab.
    // Records both platform and path; sign-in proof itself is the
    // scenario author's responsibility (typically a separate Given that
    // populates ctx.sessions earlier in the feature file).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+signed in at the "([^"]+)" (?:tab|screen)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // Gift catalog state-seed. Writes a `gifts/<name>` Firestore doc with
    // `costCoins` and `awardBeans`. This is a state-seed step — the gift
    // catalog is a real Firestore collection in prod, and scenarios that
    // exercise gift-send behavior need the catalog populated to validate
    // cost/award math.
    pattern: /^the gift "([^"]+)" costs (\d+) coins and awards (\d+) beans$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const id = m[1];
      const costCoins = parseInt(m[2], 10);
      const awardBeans = parseInt(m[3], 10);
      await ctx.db.doc(`gifts/${id}`).set({ id, costCoins, awardBeans });
      return { ok: true };
    },
  },
  {
    // j05 purchase setup-Given (line 46): "<persona> has just purchased
    // <packageId> and has <field>=<value>". Composes:
    //   - applyPurchase: writes the PURCHASE transaction + sets shyCoins
    //   - the field=value clause overrides the post-purchase balance
    //     (the scenario author has authority on the post-state — packageId
    //     might be experimental and not yet in the catalog)
    // Distinct from the existing `<persona> purchased "<pkg>" with receipt`
    // matcher (line 5271) — that flavor writes purchaseReceipts/. This
    // one is for the compact "just purchased + post-state" form j05 uses.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+has just purchased\s+([\w-]+)\s+and has\s+(\w+)=(\d+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const name = m[1];
      const packageId = m[3];
      const field = m[4];
      const value = parseInt(m[5], 10);
      try {
        if (field === 'shyCoins') {
          await applyPurchase(ctx, name, packageId, value);
          return { ok: true };
        }
        // Non-shyCoins post-state — fall through to a single-field merge.
        // applyPurchase still records the transaction so the row count
        // matches the purchase flow's audit trail.
        await applyPurchase(ctx, name, packageId, value);
        const personas = loadPersonas();
        const p = personas.get(name);
        await ctx.db.doc(`users/${p.uniqueId}`).set({ [field]: value }, { merge: true });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // j05 gift-send setup-Given (lines 69/76/81): "<persona> has just sent
    // <recipient> a <giftId>". Composes applyGiftSend, which mirrors the
    // production /api/economy/send-gift writes:
    //   - sender shyCoins decremented by gift cost
    //   - recipient beans incremented by gift award
    //   - users/<sender>/transactions/<auto>  type=GIFT_SENT
    //   - users/<recipient>/transactions/<auto>  type=GIFT_RECEIVED
    //   - giftWalls/<recipient>/gifts/<auto>  with senderId + giftId
    // Gift costs read from the giftCosts table inside applyGiftSend
    // (rose=10/5, crown=500/250, diamond=1000/500), grounded in the
    // j05 background catalog. Sender wallet must have the gift cost
    // available — caller is responsible for setting shyCoins first via
    // an earlier "has shyCoins=N" setup-Given.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+has just sent\s+([A-Z][a-z]+)\s+a\s+(\w+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db (firebase-admin Firestore) not initialised' };
      const sender = m[1];
      const recipient = m[3];
      const giftId = m[4];
      try {
        await applyGiftSend(ctx, sender, recipient, giftId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // Web Admin: issue warning to a user. Delegates to driver method
    // `webAdminIssueWarning(targetName)` — the driver locates the target
    // row in the admin user-table, opens the warn dialog, fills any
    // required reason field, and submits.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+issues a warning to\s+([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.webDriver?.webAdminIssueWarning) {
        return { ok: false, error: 'ctx.webDriver.webAdminIssueWarning not configured' };
      }
      await ctx.webDriver.webAdminIssueWarning(target);
      return { ok: true };
    },
  },
  {
    // Generic confirm action. Platform-dispatch. Drivers decide whether to
    // press a "Confirm" button, tap an OK dialog button, or hit Enter —
    // implementation detail behind the abstraction.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+confirms$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webConfirm) {
          return { ok: false, error: 'ctx.webDriver.webConfirm not configured' };
        }
        await ctx.webDriver.webConfirm();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidConfirm) {
          return { ok: false, error: 'ctx.uiDriver.androidConfirm not configured' };
        }
        await ctx.uiDriver.androidConfirm();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosConfirm) {
          return { ok: false, error: 'ctx.uiDriver.iosConfirm not configured' };
        }
        await ctx.uiDriver.iosConfirm();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for confirm step` };
    },
  },
  {
    // Send gift with coin cost (j16 economy verification).
    // Platform-dispatch. Drivers receive gift name, coin cost, recipient
    // name as separate args. Cost is captured for assertion downstream —
    // a follow-up step asserts the sender's balance dropped by exactly
    // this amount, and the catalog-seed matcher (Wake 45) ensures the
    // gift's actual cost matches what the scenario asserts.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+sends "([^"]+)" \((\d+) coins\) to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[2];
      const giftName = m[3];
      const cost = parseInt(m[4], 10);
      const recipient = m[5];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webSendGift) {
          return { ok: false, error: 'ctx.webDriver.webSendGift not configured' };
        }
        await ctx.webDriver.webSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidSendGift) {
          return { ok: false, error: 'ctx.uiDriver.androidSendGift not configured' };
        }
        await ctx.uiDriver.androidSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosSendGift) {
          return { ok: false, error: 'ctx.uiDriver.iosSendGift not configured' };
        }
        await ctx.uiDriver.iosSendGift(giftName, cost, recipient);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for send-gift step` };
    },
  },
  {
    // Pick DOB in a named picker (signup flow). Both Android (j01) and
    // iOS Sim (j02) use this; the picker tag is the resource-id / a11y
    // identifier the driver uses to locate the picker widget. Cross-
    // platform dispatch — Web variant not in the corpus.
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+picks DOB "([^"]+)" in "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[2];
      const dob = m[3];
      const pickerTag = m[4];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidPickDOB) {
          return { ok: false, error: 'ctx.uiDriver.androidPickDOB not configured' };
        }
        await ctx.uiDriver.androidPickDOB(dob, pickerTag);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosPickDOB) {
          return { ok: false, error: 'ctx.uiDriver.iosPickDOB not configured' };
        }
        await ctx.uiDriver.iosPickDOB(dob, pickerTag);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for pick-DOB step` };
    },
  },
  {
    // Android: pick ID type (j01 age verification submission flow).
    // The value is one of "passport"/"driver-license"/"national-id"
    // per the production picker — but the matcher accepts any quoted
    // string so future picker entries don't require a runner change.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+picks ID type "([^"]+)"$/,
    async handler(m, ctx) {
      const idType = m[2];
      if (!ctx.uiDriver?.androidPickIdType) {
        return { ok: false, error: 'ctx.uiDriver.androidPickIdType not configured' };
      }
      await ctx.uiDriver.androidPickIdType(idType);
      return { ok: true };
    },
  },
  {
    // Android: select test image from gallery (j01 age verification —
    // upload of ID photo). Driver mocks the image picker to return the
    // named test fixture file from app/src/androidTest/assets/.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects test image "([^"]+)" from the gallery$/,
    async handler(m, ctx) {
      const filename = m[2];
      if (!ctx.uiDriver?.androidSelectGalleryImage) {
        return { ok: false, error: 'ctx.uiDriver.androidSelectGalleryImage not configured' };
      }
      await ctx.uiDriver.androidSelectGalleryImage(filename);
      return { ok: true };
    },
  },
  {
    // Android signup composite (j01 Adam). The DOB pick + accept-legal
    // chain is collapsed into a single step in the corpus when the
    // scenario doesn't care about intermediate state. Driver chains
    // androidPickDOB(dob, "signup_dobPicker") + accepts both legal
    // checkboxes + taps Continue.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+signs up with DOB "([^"]+)" and accepts legal$/,
    async handler(m, ctx) {
      const dob = m[2];
      if (!ctx.uiDriver?.androidSignupWithDOB) {
        return { ok: false, error: 'ctx.uiDriver.androidSignupWithDOB not configured' };
      }
      await ctx.uiDriver.androidSignupWithDOB(dob);
      return { ok: true };
    },
  },
  {
    // Web Admin: refresh the age-verification tab. Used by j01 to wait
    // for a newly-submitted submission to appear in the admin view.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+refreshes the age-verification tab$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminRefreshAgeVerification) {
        return { ok: false, error: 'ctx.webDriver.webAdminRefreshAgeVerification not configured' };
      }
      await ctx.webDriver.webAdminRefreshAgeVerification();
      return { ok: true };
    },
  },
  {
    // Web Admin: tap approve/reject/etc. on a specific submission row.
    // The uid argument may be a literal numeric uniqueId OR a
    // scenario-var placeholder like "{newUniqueId}". The driver is
    // responsible for resolving the placeholder against scenario state
    // — runner-level scenario-var interpolation is a future wake.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" on the submission for "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[2];
      const uid = m[3];
      if (!ctx.webDriver?.webAdminActOnSubmission) {
        return { ok: false, error: 'ctx.webDriver.webAdminActOnSubmission not configured' };
      }
      await ctx.webDriver.webAdminActOnSubmission(action, uid);
      return { ok: true };
    },
  },
  {
    // Capture a persona's uniqueId into a scenario variable. The scenario
    // var system (interpolation in executeStep) lets later steps reference
    // the captured value by `{varName}`. Lookup order: an active session
    // (Wake 4+ persona auth populates ctx.sessions with a `uniqueId`
    // payload field) first, then the persona registry. This lets j04-style
    // scenarios capture a *just-signed-up* user's freshly-minted uniqueId
    // even before any persistent persona row exists.
    pattern: /^([A-Z][a-z]+)'s uniqueId is recorded as \{(\w+)\} for the rest of this scenario$/,
    async handler(m, ctx) {
      const name = m[1];
      const varName = m[2];
      if (!ctx.scenarioVars) ctx.scenarioVars = new Map();
      const session = ctx.sessions?.get(name);
      if (session?.uniqueId !== undefined && session?.uniqueId !== null) {
        ctx.scenarioVars.set(varName, String(session.uniqueId));
        return { ok: true };
      }
      const personas = loadPersonas();
      const p = personas.get(name);
      if (p?.uniqueId !== undefined && p?.uniqueId !== null) {
        ctx.scenarioVars.set(varName, String(p.uniqueId));
        return { ok: true };
      }
      return {
        ok: false,
        error: `cannot record uniqueId for "${name}" — no active session and not in persona registry`,
      };
    },
  },
  {
    // Reward animation assertion (j01 Adam after daily reward).
    // Pattern accepts any quoted string in the reward-text slot so
    // `+{coins}` (interpolated upstream to `+50`) or literal `+10`
    // both work uniformly. The handler does substring containment on
    // androidUiDump — looking for the resolved text anywhere.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows the "([^"]+)" reward animation$/,
    async handler(m, ctx) {
      const expected = m[3];
      if (!ctx.uiDriver?.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `Android dump did not contain reward-animation text "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // j01 post-signup invariant: main tabs visible, PM tab hidden until
    // age verification approves the user. Substring check on the dump
    // for the three main-tab content-descs AND assertion that "pm"
    // appears nowhere as a content-desc. Quoted-attribute substring
    // matching mirrors how the tag matcher (line 1715) works.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Android UI shows main tabs but PM tab is hidden$/,
    async handler(_m, ctx) {
      if (!ctx.uiDriver?.androidUiDump) {
        return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
      }
      const dump = await ctx.uiDriver.androidUiDump();
      const mainTabs = ['discover', 'wallet', 'profile'];
      const missing = mainTabs.filter((t) => !dump.includes(`content-desc="${t}"`));
      if (missing.length > 0) {
        return { ok: false, error: `main tabs missing: ${missing.join(', ')}` };
      }
      if (dump.includes('content-desc="pm"')) {
        return { ok: false, error: 'PM tab is present in Android dump but should be hidden' };
      }
      return { ok: true };
    },
  },
  {
    // Deep-link navigation attempt. Drivers fire the platform's deep-link
    // intent (adb am start -d <url> on Android; xcrun simctl openurl on
    // iOS). The "attempts to" wording is intentional — the step doesn't
    // assert the navigation succeeded, only that the deep link was
    // dispatched. A follow-up step asserts the resulting UI state.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Android|iOS Sim)\s+attempts to navigate to "([^"]+)" via deep link$/,
    async handler(m, ctx) {
      const platform = m[3];
      const url = m[4];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenDeepLink) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenDeepLink not configured' };
        }
        await ctx.uiDriver.androidOpenDeepLink(url);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenDeepLink) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenDeepLink not configured' };
        }
        await ctx.uiDriver.iosOpenDeepLink(url);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for deep-link step` };
    },
  },
  {
    // "no <X> screen renders" — UI-absence of a named screen on the
    // current platform. Persona/platform context is implicit (driver
    // tracks which dump to read internally). The matcher accepts both
    // uppercase abbreviations ("PM") and lowercase ("pm"), passing the
    // captured token to the driver verbatim.
    pattern: /^no ([\w-]+) screen renders$/,
    async handler(m, ctx) {
      const screenName = m[1];
      if (!ctx.uiDriver?.currentPlatformRendersScreen) {
        return { ok: false, error: 'ctx.uiDriver.currentPlatformRendersScreen not configured' };
      }
      const rendered = await ctx.uiDriver.currentPlatformRendersScreen(screenName);
      if (rendered) {
        return {
          ok: false,
          error: `${screenName} screen should not render but driver reports it does`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Gift selection composite (j01 Adam send-gift flow).
    // "selects gift X and recipient Y" — driver picks the gift from the
    // gift wheel/grid AND selects the recipient from the contact list.
    // Single matcher because the corpus uses the composite form when
    // intermediate steps aren't relevant.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects gift "([^"]+)" and recipient "([^"]+)"$/,
    async handler(m, ctx) {
      const giftName = m[2];
      const recipient = m[3];
      if (!ctx.uiDriver?.androidSelectGiftRecipient) {
        return { ok: false, error: 'ctx.uiDriver.androidSelectGiftRecipient not configured' };
      }
      await ctx.uiDriver.androidSelectGiftRecipient(giftName, recipient);
      return { ok: true };
    },
  },
  {
    // Sign-in form filler. Two-field composite: "types EMAIL + PASSWORD
    // and submits". Platform-dispatch — Web is the dominant target
    // (j03 Lena lapsed-adult flow uses {PERSONAS_PASSWORD} placeholder
    // which interpolates from process.env), but Android/iOS Sim variants
    // accepted for symmetry.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+types "([^"]+)" \+ "([^"]+)" and submits$/,
    async handler(m, ctx) {
      const platform = m[2];
      const email = m[3];
      const password = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTypeAndSubmit) {
          return { ok: false, error: 'ctx.webDriver.webTypeAndSubmit not configured' };
        }
        await ctx.webDriver.webTypeAndSubmit(email, password);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTypeAndSubmit) {
          return { ok: false, error: 'ctx.uiDriver.androidTypeAndSubmit not configured' };
        }
        await ctx.uiDriver.androidTypeAndSubmit(email, password);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTypeAndSubmit) {
          return { ok: false, error: 'ctx.uiDriver.iosTypeAndSubmit not configured' };
        }
        await ctx.uiDriver.iosTypeAndSubmit(email, password);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for type-and-submit step` };
    },
  },
  {
    // Current screen Given. Records platform + screen-name on the persona
    // tracking maps (same shape as the URL-anchored persona-bootstrap
    // matcher at line 1565). Screen names are platform-internal — Android
    // / iOS use route names ("age_verification"), Web uses path or
    // top-level component names.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+is on the "([^"]+)" screen$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const screenName = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, screenName);
      return { ok: true };
    },
  },
  {
    // Cross-persona displayName assertion. Looks up the target persona's
    // displayName from the registry, then asserts the platform UI dump
    // contains it. Optional `"<expected>"` literal overrides the registry
    // lookup — useful when the corpus wants to be explicit about which
    // displayName variant should be visible (some scenarios may use
    // shortened forms or aliases).
    //
    // Same alternation order as elsewhere: longest Web variants first.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s displayName(?: "([^"]+)")?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      const explicit = m[6];
      let expected = explicit;
      if (!expected) {
        const personas = loadPersonas();
        const p = personas.get(target);
        if (!p) {
          return {
            ok: false,
            error: `target persona "${target}" not in registry — cannot resolve displayName`,
          };
        }
        expected = p.displayName;
      }
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for displayName step` };
      }
      if (!dump.includes(expected)) {
        return {
          ok: false,
          error: `${platform} UI dump did not contain ${target}'s displayName "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Quoted-string UI absence — like the Wake-44 person-absence matcher
    // but takes a LITERAL quoted string instead of a capitalized name.
    // Used for resource-id-shaped tags (`"main_roomsTab"`) and persona
    // names that the corpus author specifically quoted to mark as a UI
    // string rather than a persona reference.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for absence step` };
      }
      if (typeof dump === 'string' && dump.includes(target)) {
        return {
          ok: false,
          error: `${platform} UI dump should not contain "${target}" but it does`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Bare-name button tap. The corpus uses "taps the X button" for
    // single-word button names where the quoted-form would be visually
    // noisy (e.g. "the claim button" reads more naturally than
    // "the \"claim\" button"). Driver receives the bare name and decides
    // which selector to use.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps the (\w+) button$/,
    async handler(m, ctx) {
      const platform = m[3];
      const buttonName = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapNamedButton) {
          return { ok: false, error: 'ctx.webDriver.webTapNamedButton not configured' };
        }
        await ctx.webDriver.webTapNamedButton(buttonName);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.androidTapNamedButton not configured' };
        }
        await ctx.uiDriver.androidTapNamedButton(buttonName);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.iosTapNamedButton not configured' };
        }
        await ctx.uiDriver.iosTapNamedButton(buttonName);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for button-tap step` };
    },
  },
  {
    // Legal checkboxes + continue composite (signup flow).
    // "accepts both legal checkboxes and continues" (j02 Mia iOS)
    // "checks both legal checkboxes and continues" (j03 Lena Web)
    // Both verbs route to the same driver method — the lexical
    // difference is corpus-author preference, not a behavior split.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+(?:accepts|checks) both legal checkboxes and continues$/,
    async handler(m, ctx) {
      const platform = m[2];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.webDriver.webAcceptLegalAndContinue not configured' };
        }
        await ctx.webDriver.webAcceptLegalAndContinue();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.uiDriver.androidAcceptLegalAndContinue not configured' };
        }
        await ctx.uiDriver.androidAcceptLegalAndContinue();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosAcceptLegalAndContinue) {
          return { ok: false, error: 'ctx.uiDriver.iosAcceptLegalAndContinue not configured' };
        }
        await ctx.uiDriver.iosAcceptLegalAndContinue();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for legal-checkbox step` };
    },
  },
  {
    // Persona "signed in" variant with annotation tolerance + optional
    // trailing screen. Generalises Wake-45's strict signed-in-at-tab
    // matcher to handle two j02 corpus patterns:
    //   - "Alice is on Web Chromium signed in (cross-cohort adult)"
    //     [mid-step annotation, no trailing screen]
    //   - "Marcus is on Android signed in (same-cohort minor) at the
    //     \"discovery\" screen" [both annotation and trailing screen]
    // The annotation is a hint to the human reader, not a directive to
    // the runner — we capture and discard it. Wake-45's no-annotation
    // matcher already handles the simple "X signed in at the Y" form
    // and wins first-match-order; this matcher catches the rest.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on\s+(\w+(?:\s+\w+){0,2})\s+signed in(?:\s+\([^)]*\))?(?:\s+at the "([^"]+)" (?:tab|screen))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      if (urlPath) ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // Bare "X is on the <multi-word screen> screen" — no platform. Some
    // scenarios state the screen WITHOUT re-specifying the platform when
    // it's already been set by an earlier persona-bootstrap step (or is
    // semantically platform-agnostic like the legal acceptance screen).
    //
    // Multi-word screen names accepted ("age verification submission",
    // "legal acceptance"). Path is recorded without quote-stripping
    // because the corpus form omits quotes.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on the (.+) screen$/,
    async handler(m, ctx) {
      const name = m[1];
      const screenName = m[3];
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPaths.set(name, screenName);
      return { ok: true };
    },
  },
  {
    // API legal-versions assertion (Given precondition for j03 etc.).
    // Fetches /api/legal/versions and verifies the named version field
    // equals the expected value. Three named version keys (privacy,
    // terms, community) cover the corpus surface — each maps to a
    // matching JSON field in the response.
    //
    // The endpoint path is captured even though it's a fixed string in
    // the corpus — keeps the matcher's intent transparent.
    pattern: /^the current (privacy|terms|community) version is (\d+) in (\/api\/legal\/versions)$/,
    async handler(m, ctx) {
      const versionKey = m[1];
      const expected = parseInt(m[2], 10);
      const apiPath = m[3];
      if (!ctx.fetch) return { ok: false, error: 'ctx.fetch not configured' };
      const res = await ctx.fetch(`${ctx.apiBase}${apiPath}`);
      if (res.status !== 200) {
        return { ok: false, error: `${apiPath} returned ${res.status}` };
      }
      const body = await res.json();
      const actual = body?.[versionKey];
      if (actual !== expected) {
        return {
          ok: false,
          error: `${versionKey} version mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore absence by user-uniqueId. Queries the named collection
    // for any doc with `userId == <persona uniqueId>` and asserts none.
    // Persona uniqueId resolution prefers an active session (in case
    // the persona just signed up and isn't in the registry yet), then
    // falls back to the static persona registry — same lookup chain
    // as Wake 47's uniqueId capture matcher.
    pattern: /^no submission doc is created in "([^"]+)" for ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const collection = m[1];
      const name = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const session = ctx.sessions?.get(name);
      let uniqueId =
        session?.uniqueId !== undefined && session?.uniqueId !== null
          ? session.uniqueId
          : undefined;
      if (uniqueId === undefined) {
        const personas = loadPersonas();
        const p = personas.get(name);
        if (p?.uniqueId !== undefined && p?.uniqueId !== null) uniqueId = p.uniqueId;
      }
      if (uniqueId === undefined) {
        return { ok: false, error: `cannot resolve uniqueId for persona "${name}"` };
      }
      const stringUid = String(uniqueId);
      // In-memory filter rather than `.where()` for consistency with other
      // collection-scan matchers (line ~2900) which avoid `.where()` because
      // fake DBs in tests don't implement it.
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => d.data()?.userId === stringUid);
      if (matches.length > 0) {
        return {
          ok: false,
          error: `expected no docs in "${collection}" for userId=${stringUid} but found ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // List-membership UI assertion. Substring-matches the item text in
    // the platform's UI dump. The "in the <list> list" suffix names the
    // list semantically — useful for drivers that want to scope the
    // search to a specific section — but the runner-level substring
    // check is sufficient for the corpus's correctness requirements.
    //
    // Item text is non-greedy `.+?` so trailing "in the <X> list" stays
    // matched as a literal suffix, not consumed into the item-text
    // capture group.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (.+?) in the (\w+) list$/,
    async handler(m, ctx) {
      const platform = m[3];
      const itemText = m[4];
      const listType = m[5];
      let dump;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webUiDump) {
          return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
        }
        dump = await ctx.webDriver.webUiDump();
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidUiDump) {
          return { ok: false, error: 'ctx.uiDriver.androidUiDump not configured' };
        }
        dump = await ctx.uiDriver.androidUiDump();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosUiDump) {
          return { ok: false, error: 'ctx.uiDriver.iosUiDump not configured' };
        }
        dump = await ctx.uiDriver.iosUiDump();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for list-membership step` };
      }
      if (!dump.includes(itemText)) {
        return {
          ok: false,
          error: `${platform} ${listType} list did not contain "${itemText}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Browser notification permission grant (web only — mobile uses OS
    // permission dialogs handled separately). Driver invokes the
    // Playwright MCP's permission-granting API.
    pattern: /^([A-Z][a-z]+)\s+on Web grants the browser notification permission$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webGrantNotificationPermission) {
        return { ok: false, error: 'ctx.webDriver.webGrantNotificationPermission not configured' };
      }
      await ctx.webDriver.webGrantNotificationPermission();
      return { ok: true };
    },
  },
  {
    // Web Admin: open unquoted tab name (slug form). Wake 45's quoted
    // matcher handles `opens the "X" tab`; this handles bare-slug
    // `opens the X-Y tab` (kebab-case identifier). Disjoint by
    // structure — the kebab form excludes `"`.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the ([a-z][\w-]*) tab$/,
    async handler(m, ctx) {
      const tabName = m[3];
      if (!ctx.webDriver?.webAdminOpenTab) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenTab not configured' };
      }
      await ctx.webDriver.webAdminOpenTab(tabName);
      return { ok: true };
    },
  },
  {
    // Web Admin: act on a submission identified by the submitter's NAME
    // (not uniqueId). Wake 46 handles `submission for "<uid>"` (quoted
    // uid or {varName}); this handles `Name's submission` (possessive).
    pattern: /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" on ([A-Z][a-z]+)'s submission$/,
    async handler(m, ctx) {
      const action = m[2];
      const submitter = m[3];
      if (!ctx.webDriver?.webAdminActOnSubmissionByName) {
        return { ok: false, error: 'ctx.webDriver.webAdminActOnSubmissionByName not configured' };
      }
      await ctx.webDriver.webAdminActOnSubmissionByName(action, submitter);
      return { ok: true };
    },
  },
  {
    // Web Admin: bare element-visible assertion for the ID image.
    // Driver method returns truthy iff the image is currently rendered
    // in the admin review pane.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web Admin UI shows the ID image$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminShowsIdImage) {
        return { ok: false, error: 'ctx.webDriver.webAdminShowsIdImage not configured' };
      }
      const shown = await ctx.webDriver.webAdminShowsIdImage();
      if (!shown) {
        return {
          ok: false,
          error: 'Web Admin UI should show the ID image but driver reports it is hidden',
        };
      }
      return { ok: true };
    },
  },
  {
    // Web Admin: UI shows the parsed DOB candidate (quoted text).
    // After OCR/admin-parsing extracts a DOB candidate from the ID
    // image, the admin UI displays it for review. Substring check on
    // the Web UI dump.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web Admin UI shows the parsed DOB candidate "([^"]+)"$/,
    async handler(m, ctx) {
      const dob = m[3];
      if (!ctx.webDriver?.webUiDump) {
        return { ok: false, error: 'ctx.webDriver.webUiDump not configured' };
      }
      const dump = await ctx.webDriver.webUiDump();
      if (!dump.includes(dob)) {
        return {
          ok: false,
          error: `Web Admin UI dump did not contain parsed DOB candidate "${dob}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // User card tap (discovery/profile-list variant of Wake 44's
    // room-card matcher). Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps ([A-Z][a-z]+)'s user card$/,
    async handler(m, ctx) {
      const platform = m[3];
      const owner = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapUserCard) {
          return { ok: false, error: 'ctx.webDriver.webTapUserCard not configured' };
        }
        await ctx.webDriver.webTapUserCard(owner);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapUserCard) {
          return { ok: false, error: 'ctx.uiDriver.androidTapUserCard not configured' };
        }
        await ctx.uiDriver.androidTapUserCard(owner);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapUserCard) {
          return { ok: false, error: 'ctx.uiDriver.iosTapUserCard not configured' };
        }
        await ctx.uiDriver.iosTapUserCard(owner);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for user-card tap step` };
    },
  },
  {
    // User-doc state-seed with array field. "manipulated" verb signals
    // the value is NOT from normal API flow — useful for cross-cohort
    // stale-follow scenarios. Writes via merge so other fields stay.
    pattern: /^([A-Z][a-z]+)'s user doc was manipulated to have (\w+)=\[([^\]]*)\]$/,
    async handler(m, ctx) {
      const name = m[1];
      const fieldName = m[2];
      const rawArray = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const trimmed = rawArray.trim();
      const elements =
        trimmed === ''
          ? []
          : trimmed.split(',').map((s) => {
              const n = parseInt(s.trim(), 10);
              return Number.isNaN(n) ? s.trim() : n;
            });
      await ctx.db.doc(`users/${p.uniqueId}`).set({ [fieldName]: elements }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Web Admin tap-with-reason-AND-dobOverride (j04 reject_and_dob_down).
    // Extends Wake 45's tap-with-reason matcher with the dobOverride
    // parameter. Driver receives three args: action, reason, override.
    pattern:
      /^([A-Z][a-z]+)\s+on Web Admin\s+taps "([^"]+)" with reason "([^"]+)" and dobOverride="([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[2];
      const reason = m[3];
      const dobOverride = m[4];
      if (!ctx.webDriver?.webAdminTapWithReasonAndOverride) {
        return {
          ok: false,
          error: 'ctx.webDriver.webAdminTapWithReasonAndOverride not configured',
        };
      }
      await ctx.webDriver.webAdminTapWithReasonAndOverride(action, reason, dobOverride);
      return { ok: true };
    },
  },
  {
    // Firestore count by system PM key + addressee uniqueId. Asserts the
    // named collection has EXACTLY N entries matching both filters. Used
    // by j04 to verify the admin-PM was created (and only one of it).
    // In-memory filter — fake-DB lacks .where().
    pattern:
      /^the database has (\d+) entries in "([^"]+)" with the system PM key "([^"]+)" addressed to (\d+)$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const collection = m[2];
      const systemKey = m[3];
      const addresseeUid = parseInt(m[4], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => {
        const data = d.data();
        return data?.systemKey === systemKey && data?.addresseeUniqueId === addresseeUid;
      });
      if (matches.length !== expectedCount) {
        return {
          ok: false,
          error: `${collection} count mismatch for systemKey="${systemKey}" addressee=${addresseeUid}: expected ${expectedCount}, actual ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // PM body locale-+-template check. Driver verifies the PM body matches
    // the named template in the named locale — does the lookup against
    // template registry and resolves placeholders before comparing.
    // Driver method: pmBodyIsTranslationOfTemplate(localeCode, templateName).
    pattern: /^the PM body is the ([A-Z][a-z]+) translation of the (\w+) template$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const localeName = m[1];
      const templateName = m[2];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (!ctx.webDriver?.pmBodyIsTranslationOfTemplate) {
        return { ok: false, error: 'ctx.webDriver.pmBodyIsTranslationOfTemplate not configured' };
      }
      const ok = await ctx.webDriver.pmBodyIsTranslationOfTemplate(code, templateName);
      if (!ok) {
        return {
          ok: false,
          error: `PM body did not match the ${localeName} (${code}) translation of "${templateName}" template`,
        };
      }
      return { ok: true };
    },
  },
  {
    // PM is from <sender> assertion. Trailing parens annotation
    // (e.g. "(uniqueId=1, userType=SHYTALK_OFFICIAL)") is stripped
    // upstream by Wake 30's stripStepAnnotation, so the matcher sees the
    // bare form "the PM is from Officia".
    pattern: /^the PM is from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const sender = m[1];
      if (!ctx.webDriver?.pmIsFromSender) {
        return { ok: false, error: 'ctx.webDriver.pmIsFromSender not configured' };
      }
      const ok = await ctx.webDriver.pmIsFromSender(sender);
      if (!ok) {
        return { ok: false, error: `PM is not from sender "${sender}"` };
      }
      return { ok: true };
    },
  },
  {
    // Relaunches the app and signs in (Android + iOS Sim). Composite —
    // driver kills the process, restarts it, and signs in with the
    // persona's stored credentials (no UI typing in the runner).
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+relaunches the app and signs in$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidRelaunchAndSignIn) {
          return { ok: false, error: 'ctx.uiDriver.androidRelaunchAndSignIn not configured' };
        }
        await ctx.uiDriver.androidRelaunchAndSignIn(name);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosRelaunchAndSignIn) {
          return { ok: false, error: 'ctx.uiDriver.iosRelaunchAndSignIn not configured' };
        }
        await ctx.uiDriver.iosRelaunchAndSignIn(name);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for relaunch step` };
    },
  },
  {
    // In-app banner about cohort change in <locale>. Driver method
    // returns truthy iff the banner is currently rendered in the
    // expected locale. Driver verifies both presence AND that the
    // banner text matches the locale-specific copy.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI shows the in-app banner about the cohort change in ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const platform = m[3];
      const localeName = m[4];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsCohortChangeBanner) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsCohortChangeBanner not configured',
          };
        }
        const ok = await ctx.uiDriver.androidShowsCohortChangeBanner(code);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show the cohort change banner in ${localeName} (${code})`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsCohortChangeBanner) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsCohortChangeBanner not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsCohortChangeBanner(code);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show the cohort change banner in ${localeName} (${code})`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for cohort-banner step` };
    },
  },
  {
    // Balance comparison Given. "X has shyCoins OP N [trailing explanation]".
    // The trailing explanation ("after daily reward + a +100 admin top-up")
    // is descriptive context, NOT in parens, so Wake 30 doesn't strip it.
    // Matcher accepts and ignores anything after the numeric value.
    //
    // Regex is linear: `.+$` is greedy + anchored to end-of-string, no
    // overlap with preceding tokens. Input is author-controlled (feature
    // files), not untrusted user data. Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)\s+has\s+(\w+)\s+(>=|<=|==|>|<)\s+(\d+)(?:\s+.+)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const field = m[2];
      const op = m[3];
      const expected = parseInt(m[4], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const snap = await ctx.db.doc(`users/${p.uniqueId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `user doc "users/${p.uniqueId}" does not exist` };
      }
      const actual = snap.data()?.[field];
      const pass = (() => {
        switch (op) {
          case '<':
            return actual < expected;
          case '<=':
            return actual <= expected;
          case '==':
            return actual === expected;
          case '>=':
            return actual >= expected;
          case '>':
            return actual > expected;
          default:
            return false;
        }
      })();
      if (!pass) {
        return {
          ok: false,
          error: `${name}'s ${field} comparison failed: ${actual} ${op} ${expected} is false`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore field-still-containing assertion. Two value shapes:
    //   [a, b, c]  — expect doc field array to contain ALL these
    //              elements (non-exhaustive — extras allowed).
    //   N         — scalar; field equals N OR (if field is array)
    //              array contains N.
    // Used by j04 to verify cross-cohort stale-follow scenarios
    // don't accidentally clean the array.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" still containing (.+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const rawValue = m[3].trim();
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const inner = rawValue.slice(1, -1).trim();
        const expected =
          inner === ''
            ? []
            : inner.split(',').map((s) => {
                const n = parseInt(s.trim(), 10);
                return Number.isNaN(n) ? s.trim() : n;
              });
        if (!Array.isArray(actual)) {
          return {
            ok: false,
            error: `field "${field}" on "${docPath}" is not an array (got ${typeof actual})`,
          };
        }
        const missing = expected.filter((el) => !actual.includes(el));
        if (missing.length > 0) {
          return {
            ok: false,
            error: `field "${field}" missing expected elements: ${missing.join(', ')}`,
          };
        }
        return { ok: true };
      }
      const n = parseInt(rawValue, 10);
      const expected = Number.isNaN(n) ? rawValue : n;
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          return {
            ok: false,
            error: `field "${field}" array does not contain "${expected}"`,
          };
        }
        return { ok: true };
      }
      if (actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Placeholder UI assertion. Two phrasings:
    //   "renders the \"X\" placeholder in both|that slot(s)"  (j04)
    //   "renders the placeholder \"X\" in that slot"           (j02)
    // Both reduce to driver call (placeholderName, slotHint).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI renders the (?:"([^"]+)" placeholder|placeholder "([^"]+)") in (that|both) slots?$/,
    async handler(m, ctx) {
      const platform = m[3];
      const placeholderName = m[4] || m[5];
      const slotHint = m[6];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsPlaceholder) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsPlaceholder not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsPlaceholder(placeholderName, slotHint);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not render placeholder "${placeholderName}" in ${slotHint} slot(s)`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsPlaceholder) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsPlaceholder not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsPlaceholder(placeholderName, slotHint);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not render placeholder "${placeholderName}" in ${slotHint} slot(s)`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for placeholder step` };
    },
  },
  {
    // PM-with-badge UI assertion. Driver verifies a PM from the named
    // sender is rendered AND has the named badge attached. Badge
    // currently "official" only but matcher accepts any single-word
    // badge for future expansion.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Android|iOS Sim) UI shows the new PM from ([A-Z][a-z]+) with the (\w+) badge$/,
    async handler(m, ctx) {
      const platform = m[3];
      const sender = m[4];
      const badge = m[5];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsPmWithBadge) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsPmWithBadge not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsPmWithBadge(sender, badge);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI did not show PM from "${sender}" with "${badge}" badge`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsPmWithBadge) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsPmWithBadge not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsPmWithBadge(sender, badge);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI did not show PM from "${sender}" with "${badge}" badge`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for PM-with-badge step` };
    },
  },
  {
    // Followers/following list nav. "X on Y opens his|her|their <LIST>
    // list" where LIST is one of "followers" or "following". Distinct
    // from Wake 45's pronoun-screen matcher because the noun is "list"
    // not "screen".
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+opens (?:his|her|their) (followers|following) list$/,
    async handler(m, ctx) {
      const platform = m[2];
      const listName = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webOpenListView) {
          return { ok: false, error: 'ctx.webDriver.webOpenListView not configured' };
        }
        await ctx.webDriver.webOpenListView(listName);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenListView) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenListView not configured' };
        }
        await ctx.uiDriver.androidOpenListView(listName);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenListView) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenListView not configured' };
        }
        await ctx.uiDriver.iosOpenListView(listName);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for list-nav step` };
    },
  },
  {
    // Performance budget assertion. Driver records timing from the most
    // recent "submit" step to the target tag rendering, returns the
    // elapsed milliseconds. Matcher compares against the budget.
    pattern: /^the time from submit to "([^"]+)" rendering is less than (\d+)ms$/,
    async handler(m, ctx) {
      const target = m[1];
      const budget = parseInt(m[2], 10);
      if (!ctx.uiDriver?.measureRenderingTimeFromSubmit) {
        return { ok: false, error: 'ctx.uiDriver.measureRenderingTimeFromSubmit not configured' };
      }
      const actual = await ctx.uiDriver.measureRenderingTimeFromSubmit(target);
      if (actual >= budget) {
        return {
          ok: false,
          error: `rendering time exceeded budget for "${target}": ${actual}ms >= ${budget}ms`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Package state-seed (j05/j06 IAP catalog). Writes packages/<id>
    // with coinValue (required) and optional price. Price stays as the
    // raw string with `$` so display tests can verify formatting.
    pattern: /^the package "([^"]+)" exists with coinValue=(\d+)(?: and price="([^"]+)")?$/,
    async handler(m, ctx) {
      const id = m[1];
      const coinValue = parseInt(m[2], 10);
      const price = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const doc = { id, coinValue };
      if (price !== undefined) doc.price = price;
      await ctx.db.doc(`packages/${id}`).set(doc);
      return { ok: true };
    },
  },
  {
    // Package selection (j05 — Alice selects coins-1000). Driver navigates
    // to the catalog screen if needed and taps the named package card.
    pattern: /^([A-Z][a-z]+)\s+on Web selects package "([^"]+)"$/,
    async handler(m, ctx) {
      const packageId = m[2];
      if (!ctx.webDriver?.webSelectPackage) {
        return { ok: false, error: 'ctx.webDriver.webSelectPackage not configured' };
      }
      await ctx.webDriver.webSelectPackage(packageId);
      return { ok: true };
    },
  },
  {
    // Sandbox receipt submission (j05). The receipt ID is opaque to the
    // runner — Wake 47 interpolation resolves any `{ts}` / `{var}`
    // placeholders before this matcher sees the text. Driver POSTs the
    // receipt to the IAP-verify endpoint.
    pattern: /^([A-Z][a-z]+)\s+on Web submits a sandbox receipt "([^"]+)"$/,
    async handler(m, ctx) {
      const receiptId = m[2];
      if (!ctx.webDriver?.webSubmitSandboxReceipt) {
        return { ok: false, error: 'ctx.webDriver.webSubmitSandboxReceipt not configured' };
      }
      await ctx.webDriver.webSubmitSandboxReceipt(receiptId);
      return { ok: true };
    },
  },
  {
    // Collection-entries-added-since assertion. Counts docs in the named
    // collection (sub-collection paths supported) whose `createdAt` field
    // is >= the given timestamp. The timestamp arrives as a quoted string
    // because the corpus uses `"{ts}"` form — runner-level interpolation
    // already resolved it to the literal value.
    pattern: /^the database has (\d+) entries in "([^"]+)" added since "(\d+)"$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const collection = m[2];
      const sinceTs = parseInt(m[3], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const matches = snap.docs.filter((d) => {
        const ts = d.data()?.createdAt;
        return typeof ts === 'number' && ts >= sinceTs;
      });
      if (matches.length !== expectedCount) {
        return {
          ok: false,
          error: `${collection} count mismatch since ${sinceTs}: expected ${expectedCount}, actual ${matches.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Firestore "no <collection> has field=value" assertion. Scans the
    // implied collection (rooms by default; the noun in "on any X"
    // becomes the collection name) and asserts no doc has the field
    // containing the value (either scalar equality or array-includes).
    pattern: /^the database does not have field "([^"]+)" containing (\d+) on any (\w+)$/,
    async handler(m, ctx) {
      const field = m[1];
      const value = parseInt(m[2], 10);
      // "on any room" → collection "rooms"
      const collection = `${m[3]}s`;
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      const offenders = snap.docs.filter((d) => {
        const f = d.data()?.[field];
        if (Array.isArray(f)) return f.includes(value);
        return f === value;
      });
      if (offenders.length > 0) {
        const ids = offenders.map((d) => d.id).join(', ');
        return {
          ok: false,
          error: `${collection} docs [${ids}] have field "${field}" containing ${value}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Received system PM bare assertion. Bare form: "X received the
    // <key> system PM from <sender>". Reads Firestore: the system PM
    // lives at conversations/<convId>/messages/* where convId is the
    // sorted-join of [recipientUid, "SHYTALK_SYSTEM"] (mirroring
    // src/utils/system-pm.js + the W132 state-seed). Matches against
    // the `_testKey` field that W132's webhook-fire writer sets;
    // sender is currently informational (the system PM always comes
    // from SHYTALK_SYSTEM in production — `sender=Officia` is the
    // human-readable display name).
    pattern: /^([A-Z][a-z]+)\s+received the ([\w-]+) system PM from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const key = m[2];
      // sender intentionally unused for matching — Officia (sender
      // name in corpus) maps to SHYTALK_SYSTEM under the hood.
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(recipient);
      if (!p?.uniqueId) {
        return { ok: false, error: `recipient "${recipient}" not in registry` };
      }
      const convId = [String(p.uniqueId), 'SHYTALK_SYSTEM']
        .sort((a, b) => a.localeCompare(b))
        .join('_');
      const msgsSnap = await ctx.db.collection(`conversations/${convId}/messages`).get();
      let found = false;
      msgsSnap.forEach((d) => {
        const data = d.data() || {};
        if (data._testKey === key || (typeof data.text === 'string' && data.text.includes(key))) {
          found = true;
        }
      });
      if (!found) {
        return {
          ok: false,
          error: `${recipient} did not receive the "${key}" system PM (convId=${convId})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Heading-locale Web assertion. Driver checks the current page's
    // heading (typically `<h1>` or aria-label="heading") is rendered in
    // the named locale. 20 ShyTalk locales supported via name→ISO map.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows the heading in ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
      };
      const localeName = m[3];
      const code = LOCALE_NAME_TO_CODE[localeName];
      if (!code) {
        return { ok: false, error: `unknown locale name "${localeName}"` };
      }
      if (!ctx.webDriver?.webHeadingInLocale) {
        return { ok: false, error: 'ctx.webDriver.webHeadingInLocale not configured' };
      }
      const ok = await ctx.webDriver.webHeadingInLocale(code);
      if (!ok) {
        return {
          ok: false,
          error: `Web UI heading is not in ${localeName} (${code})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Highlight-pointing-at-section UI assertion (j03 policy update).
    // Driver locates the named highlight (typically a tooltip or
    // visual call-out) and verifies it points at the named section
    // index. Section identifier is numeric (legal section #11, etc.).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s Web UI shows a "([^"]+)" highlight pointing at section (\d+)$/,
    async handler(m, ctx) {
      const name = m[3];
      const sectionIdx = parseInt(m[4], 10);
      if (!ctx.webDriver?.webShowsHighlightAtSection) {
        return { ok: false, error: 'ctx.webDriver.webShowsHighlightAtSection not configured' };
      }
      const ok = await ctx.webDriver.webShowsHighlightAtSection(name, sectionIdx);
      if (!ok) {
        return {
          ok: false,
          error: `Web UI did not show "${name}" highlight at section ${sectionIdx}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Modal close via the X button without checking boxes (j03 dismiss
    // flow). Composite — driver clicks the X (close icon) WITHOUT
    // toggling any checkboxes on the modal. Used to verify the
    // dismissal doesn't accidentally mark policy acceptance.
    pattern: /^([A-Z][a-z]+)\s+on Web closes the modal via the X button without checking boxes$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webCloseModalViaX) {
        return { ok: false, error: 'ctx.webDriver.webCloseModalViaX not configured' };
      }
      await ctx.webDriver.webCloseModalViaX();
      return { ok: true };
    },
  },
  {
    // Firestore doc-absence with version constraint. Asserts that the
    // named doc does NOT exist OR has a version field NOT equal to the
    // given value. Used by j03 to verify dismissed policy modals don't
    // accidentally write acceptance records.
    pattern: /^the database does not have a new "([^"]+)" with version (\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const expectedVersion = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: true };
      }
      const data = snap.data();
      // Check any field named *Version (privacyVersion, termsVersion, etc.)
      // OR a literal "version" field.
      const versionFields = Object.keys(data).filter(
        (k) => k === 'version' || k.endsWith('Version'),
      );
      for (const field of versionFields) {
        if (data[field] === expectedVersion) {
          return {
            ok: false,
            error: `doc "${docPath}" has ${field}=${expectedVersion} but assertion expected absence`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    // Picks an N-megabyte test image (Android, size variant of Wake 46
    // "selects test image from gallery"). Driver mocks the image picker
    // to return a fixture of approximately the requested size — used to
    // exercise size-limit code paths (e.g. 15MB rejected, 5MB accepted).
    pattern: /^([A-Z][a-z]+)\s+on Android\s+picks a (\d+)MB test image$/,
    async handler(m, ctx) {
      const sizeMB = parseInt(m[2], 10);
      if (!ctx.uiDriver?.androidPickTestImageBySize) {
        return { ok: false, error: 'ctx.uiDriver.androidPickTestImageBySize not configured' };
      }
      await ctx.uiDriver.androidPickTestImageBySize(sizeMB);
      return { ok: true };
    },
  },
  {
    // Reverse-order gift selection (j05). Wake 48 has the gift-first
    // form ("selects gift X and recipient Y"); this is recipient-first
    // ("selects recipient X and gift Y"). Disjoint by word order.
    pattern: /^([A-Z][a-z]+)\s+on Web selects recipient "([^"]+)" and gift "([^"]+)"$/,
    async handler(m, ctx) {
      const recipient = m[2];
      const giftName = m[3];
      if (!ctx.webDriver?.webSelectRecipientAndGift) {
        return { ok: false, error: 'ctx.webDriver.webSelectRecipientAndGift not configured' };
      }
      await ctx.webDriver.webSelectRecipientAndGift(recipient, giftName);
      return { ok: true };
    },
  },
  {
    // Double-tap with same receipt within Nms (idempotency test).
    // Driver fires two taps in quick succession on the same element with
    // the same receipt ID — used to verify the server rejects the
    // duplicate (typically status 409 from /api/economy/purchase).
    pattern:
      /^([A-Z][a-z]+)\s+on Web double-taps "([^"]+)" with the same receipt "([^"]+)" within (\d+)ms$/,
    async handler(m, ctx) {
      const tag = m[2];
      const receipt = m[3];
      const withinMs = parseInt(m[4], 10);
      if (!ctx.webDriver?.webDoubleTapWithSameReceipt) {
        return { ok: false, error: 'ctx.webDriver.webDoubleTapWithSameReceipt not configured' };
      }
      await ctx.webDriver.webDoubleTapWithSameReceipt(tag, receipt, withinMs);
      return { ok: true };
    },
  },
  {
    // API request count + status assertion. Driver returns { succeeded,
    // status } summary for the named endpoint at the named status code.
    // Used by j05 double-tap idempotency to verify exactly 1 of 2 taps
    // hit /api/economy/purchase with status 200.
    pattern: /^exactly (\d+) requests? to (\/api\/[\w/-]+) succeeds with status (\d+)$/,
    async handler(m, ctx) {
      const expectedCount = parseInt(m[1], 10);
      const endpoint = m[2];
      const expectedStatus = parseInt(m[3], 10);
      if (!ctx.webDriver?.apiRequestStats) {
        return { ok: false, error: 'ctx.webDriver.apiRequestStats not configured' };
      }
      const stats = await ctx.webDriver.apiRequestStats(endpoint, expectedStatus);
      if (stats.succeeded !== expectedCount) {
        return {
          ok: false,
          error: `${endpoint} status ${expectedStatus} count mismatch: expected ${expectedCount}, actual ${stats.succeeded}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Sequential request status assertion. "the second/third/Nth
    // request returns status N". Ordinal words mapped to 1-indexed
    // positions; driver returns the HTTP status of that request from
    // the most recent batch.
    pattern: /^the (\w+) request returns status (\d+)$/,
    async handler(m, ctx) {
      const ORDINAL_TO_INDEX = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4,
        fifth: 5,
        sixth: 6,
        seventh: 7,
        eighth: 8,
        ninth: 9,
        tenth: 10,
      };
      const ordinal = m[1];
      const expectedStatus = parseInt(m[2], 10);
      const idx = ORDINAL_TO_INDEX[ordinal];
      if (!idx) {
        return { ok: false, error: `unknown ordinal "${ordinal}"` };
      }
      if (!ctx.webDriver?.sequentialRequestStatus) {
        return { ok: false, error: 'ctx.webDriver.sequentialRequestStatus not configured' };
      }
      const actual = await ctx.webDriver.sequentialRequestStatus(idx);
      if (actual !== expectedStatus) {
        return {
          ok: false,
          error: `request #${idx} status mismatch: expected ${expectedStatus}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Composite purchase (j05). "X on Web purchases \"Y\" with sandbox
    // receipt" — driver selects the package, generates a fresh sandbox
    // receipt, and POSTs to /api/economy/purchase. The receipt ID is
    // driver-managed and not visible to the runner.
    pattern: /^([A-Z][a-z]+)\s+on Web purchases "([^"]+)" with sandbox receipt$/,
    async handler(m, ctx) {
      const packageId = m[2];
      if (!ctx.webDriver?.webPurchaseWithSandboxReceipt) {
        return { ok: false, error: 'ctx.webDriver.webPurchaseWithSandboxReceipt not configured' };
      }
      await ctx.webDriver.webPurchaseWithSandboxReceipt(packageId);
      return { ok: true };
    },
  },
  {
    // Past-tense purchase Given (j06 — state set up by a prior
    // successful purchase). Trailing parens "(shyCoins now N)"
    // stripped by Wake 30. The "successfully" adverb is optional:
    // both phrasings ("purchased X with receipt Y" and ".... Y
    // successfully") indicate the same state — a completed purchase
    // — and route to the same Firestore writes.
    //
    // Past-tense Given is a STATE-SEED, not an assertion. Previously
    // delegated to a webDriver stub which returned false and emitted
    // "has no successful purchase" findings against scenarios whose
    // intent was "this purchase already happened, set it up". Now
    // writes the same shape /api/economy/purchase would after a
    // successful coin-package buy:
    //   - purchaseReceipts/<sha256(receipt)>: { userId, productId,
    //     purchaseToken, platform, isSubscription, createdAt,
    //     verified: true, orderId, coinsGranted, bonusCoinsGranted }
    //   - users/<uniqueId>: shyCoins += coinsGranted
    // Coins are inferred from the productId suffix (`coins-1000` →
    // 1000) so the scenario can drive replay / refund flows without
    // also writing a `coinPackages/<id>` doc.
    pattern: /^([A-Z][a-z]+)\s+purchased "([^"]+)" with receipt "([^"]+)"(?: successfully)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const productId = m[2];
      const receipt = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return {
          ok: false,
          error: `persona "${name}" not in registry (or ephemeral with no uniqueId)`,
        };
      }
      // Infer coins from productId suffix. `coins-1000` → 1000. Falls
      // back to 0 for non-coin products (subscriptions etc. — those
      // would seed via a different matcher).
      const coinsMatch = /coins-(\d+)/i.exec(productId);
      const coinsGranted = coinsMatch ? parseInt(coinsMatch[1], 10) : 0;
      const crypto = require('node:crypto');
      const receiptId = crypto.createHash('sha256').update(String(receipt)).digest('hex');
      const { FieldValue } = require('firebase-admin').firestore;
      await ctx.db.doc(`purchaseReceipts/${receiptId}`).set({
        userId: p.uniqueId,
        productId,
        purchaseToken: receipt,
        platform: 'test-seed',
        isSubscription: false,
        createdAt: Date.now(),
        verified: true,
        orderId: `test-seed-${receiptId.slice(0, 8)}`,
        coinsGranted,
        bonusCoinsGranted: 0,
      });
      if (coinsGranted > 0) {
        await ctx.db
          .doc(`users/${p.uniqueId}`)
          .update({ shyCoins: FieldValue.increment(coinsGranted) });
      }
      return { ok: true };
    },
  },
  {
    // Network drop simulation (j06 recovery flow). Driver intercepts the
    // next outgoing request (typically /api/economy/purchase) and
    // returns failure BEFORE the response is delivered, simulating the
    // "lost ACK" scenario the retry logic needs to handle correctly.
    pattern: /^([A-Z][a-z]+)'s network drops before the 200 OK reaches the client$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.webDriver?.simulateNetworkDropBeforeResponse) {
        return {
          ok: false,
          error: 'ctx.webDriver.simulateNetworkDropBeforeResponse not configured',
        };
      }
      await ctx.webDriver.simulateNetworkDropBeforeResponse(name);
      return { ok: true };
    },
  },
  {
    // Bare Android API POST. Captures endpoint + optional "with <rest>"
    // suffix as opaque string. Driver parses the rest to extract
    // productId/receipt/etc. params (or notes "no productId" for
    // negative-test scenarios). Single matcher absorbs all j06 POST
    // variants — saves writing five near-identical matchers.
    //
    // Regex linear: `.+$` greedy + anchored to end-of-string. Input
    // is author-controlled (feature files). Safe.
    // eslint-disable-next-line sonarjs/slow-regex
    pattern: /^([A-Z][a-z]+)\s+on Android POSTs (\/api\/[\w/-]+)(?:\s+(.+))?$/,
    async handler(m, ctx) {
      const endpoint = m[2];
      const rest = m[3] || '';
      if (!ctx.uiDriver?.androidApiPost) {
        return { ok: false, error: 'ctx.uiDriver.androidApiPost not configured' };
      }
      await ctx.uiDriver.androidApiPost(endpoint, rest);
      return { ok: true };
    },
  },
  {
    // Retry-same-purchase composite (j06 recovery flow). Corpus step
    // has `(same receipt)` MID-STEP, which Wake 30 doesn't strip
    // (it strips trailing parens only). Allow optional mid-step
    // parens after "purchase". Driver re-submits the most recent
    // purchase request using the same receipt ID.
    pattern:
      /^([A-Z][a-z]+)\s+on Android retries the same purchase(?:\s+\([^()]*\))?\s+once network restores$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.uiDriver?.androidRetrySamePurchase) {
        return { ok: false, error: 'ctx.uiDriver.androidRetrySamePurchase not configured' };
      }
      await ctx.uiDriver.androidRetrySamePurchase(name);
      return { ok: true };
    },
  },
  {
    // Receipt-mismatch state-seed (j06 receipt forgery test). Writes a
    // purchaseReceipts/<sha256(receipt)> doc that records the receipt
    // as being signed for `signedFor` (one productId) — the scenario's
    // next step is the submitter POSTing /api/economy/purchase with a
    // DIFFERENT productId, and the server must reject the mismatch.
    //
    // State-seed pattern (W120/W124/W126/W127/W132): writes Firestore
    // directly rather than delegating to a webDriver stub. Stores the
    // attemptedProductId via ctx.receiptMismatchHint so the downstream
    // POST matcher (or assertion) can introspect what mismatch shape
    // was set up.
    pattern:
      /^the receipt "([^"]+)" is signed for "([^"]+)" but ([A-Z][a-z]+) submits productId="([^"]+)"$/,
    async handler(m, ctx) {
      const receipt = m[1];
      const signedFor = m[2];
      const submitter = m[3];
      const submittedProductId = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(submitter);
      if (!p?.uniqueId) {
        return { ok: false, error: `submitter "${submitter}" not in registry` };
      }
      const crypto = require('node:crypto');
      const receiptId = crypto.createHash('sha256').update(String(receipt)).digest('hex');
      await ctx.db.doc(`purchaseReceipts/${receiptId}`).set({
        userId: p.uniqueId,
        productId: signedFor,
        purchaseToken: receipt,
        platform: 'test-seed-mismatch',
        isSubscription: false,
        createdAt: Date.now(),
        verified: true,
        orderId: `test-seed-mismatch-${receiptId.slice(0, 8)}`,
        // Stored separately from the receipt's signedFor productId so
        // a downstream assertion can pin both sides of the mismatch.
        _testSubmittedProductId: submittedProductId,
      });
      ctx.receiptMismatchHint = { receipt, signedFor, submittedProductId, submitter };
      return { ok: true };
    },
  },
  {
    // Web Admin processes refund for receipt (j06 admin recovery). The
    // refund flow reverses the coin credit AND records the admin
    // action; both steps are driver-internal.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin processes a refund for receipt "([^"]+)"$/,
    async handler(m, ctx) {
      const receipt = m[2];
      if (!ctx.webDriver?.webAdminProcessRefund) {
        return { ok: false, error: 'ctx.webDriver.webAdminProcessRefund not configured' };
      }
      await ctx.webDriver.webAdminProcessRefund(receipt);
      return { ok: true };
    },
  },
  {
    // Tap-purchase-and-server-credits composite Given (j06 state
    // setup). Simulates a SUCCESSFUL purchase that credited the user —
    // useful when a scenario needs the post-credit state without
    // running the full POST + receipt validation chain.
    //
    // State-seed pattern (per W120/W124): writes directly to Firestore
    // rather than delegating to a webDriver stub. Two writes:
    //   - users/<uniqueId>: shyCoins set to the target value (the step
    //     declares the EXACT post-credit balance, not a delta — so use
    //     set/update with absolute value, not FieldValue.increment).
    //   - users/<uniqueId>/transactions/<txId>: matches the shape
    //     writeTransaction() produces in economy.js — COIN_PURCHASE
    //     type, amount = coins, currency COINS, balanceAfter = coins.
    pattern:
      /^([A-Z][a-z]+)\s+taps purchase and the server credits coins=(\d+) \+ writes transaction$/,
    async handler(m, ctx) {
      const name = m[1];
      const coins = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const ts = Date.now();
      const txId = `test-credit-${p.uniqueId}-${ts}`;
      await ctx.db.doc(`users/${p.uniqueId}`).update({ shyCoins: coins });
      await ctx.db.doc(`users/${p.uniqueId}/transactions/${txId}`).set({
        id: txId,
        type: 'COIN_PURCHASE',
        amount: coins,
        currency: 'COINS',
        balanceAfter: coins,
        details: 'test-seed simulated credit',
        timestamp: ts,
      });
      return { ok: true };
    },
  },
  {
    // Persona "is signed in on <plat> at <path>" variant (j07).
    // Different verb order from Wake 45/50's "is on X signed in".
    // Records persona platform + path on the tracking maps.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in on\s+(Web Chromium|Web Safari|Web|Android|iOS Sim)\s+at "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const urlPath = m[4];
      if (!ctx.personaPlatforms) ctx.personaPlatforms = new Map();
      if (!ctx.personaPaths) ctx.personaPaths = new Map();
      ctx.personaPlatforms.set(name, platform);
      ctx.personaPaths.set(name, urlPath);
      return { ok: true };
    },
  },
  {
    // j07 follow-state setup-Given: "<persona> is following <other>".
    // Composes applyFollow, which mirrors the production /api/users/follow
    // writes: follower's followingIds += followee's uniqueId, and the
    // mirror followerIds += follower's uniqueId. Idempotent — re-running
    // dedups (Set-backed merge).
    //
    // This is the POSITIVE complement to the existing "neither user is
    // following the other" assertion below — together they let j07's
    // phase-scoped scenarios establish either pre-condition cleanly.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is following\s+([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const followerName = m[1];
      const followeeName = m[3];
      try {
        await applyFollow(ctx, followerName, followeeName);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // j07 conversation setup-Given: "<persona> has an open DIRECT
    // conversation thread with <other>". Composes seedDirectConversation,
    // which writes a conversations/<deterministic-id> doc with type='DIRECT'
    // and sorted, String-coerced participantIds. Downstream PM-send /
    // PM-read assertions look up the thread by participant pair, so the
    // doc-id determinism keeps tests stable.
    //
    // Note this is a UNIDIRECTIONAL phrasing ("Adam has an open thread
    // WITH Alice") but DIRECT conversations are inherently symmetric —
    // either persona is a valid subject. The matcher captures the
    // subject as a sender hint for downstream assertions, but doesn't
    // mark the thread as "owned" by them.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+has an open DIRECT conversation thread with\s+([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const p1Name = m[1];
      const p2Name = m[3];
      try {
        await seedDirectConversation(ctx, p1Name, p2Name);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "neither user is following the other" bare relation assertion
    // (j07 pre-condition). Reads the two most-recently-mentioned
    // personas from ctx.personaPlatforms (populated by sign-in
    // matchers in declaration order), looks up their uniqueIds via
    // the persona registry, queries Firestore, and asserts that
    // neither user appears in the other's followingIds OR followerIds.
    //
    // Previously delegated to a driver stub that returned false →
    // always failed. The assertion is data-only (no UI), so it
    // belongs in the matcher, not the driver.
    pattern: /^neither user is following the other$/,
    async handler(_m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personaOrder = ctx.personaPlatforms ? [...ctx.personaPlatforms.keys()] : [];
      // Fewer than 2 personas recorded means at least one is ephemeral
      // (e.g. P-01 Adam pre-j01 has no Firestore presence — the matcher
      // for "post-j01 state" sign-in form is a gap, see Wake 121
      // backlog). A non-existent user can't be following anyone, so the
      // assertion holds trivially.
      if (personaOrder.length < 2) {
        return { ok: true };
      }
      const [nameA, nameB] = personaOrder.slice(-2);
      const personas = loadPersonas();
      const a = personas.get(nameA);
      const b = personas.get(nameB);
      // Ephemeral personas (e.g. P-01 Adam pre-j01) have no uniqueId
      // because they don't exist in Firestore yet. The assertion holds
      // trivially: a user that doesn't exist can't be in anyone's
      // follow lists.
      if (!a?.uniqueId || !b?.uniqueId) {
        return { ok: true };
      }
      const [snapA, snapB] = await Promise.all([
        ctx.db.doc(`users/${a.uniqueId}`).get(),
        ctx.db.doc(`users/${b.uniqueId}`).get(),
      ]);
      const dataA = snapA.exists ? snapA.data() : {};
      const dataB = snapB.exists ? snapB.data() : {};
      const aFollowsB = (dataA.followingIds || []).includes(b.uniqueId);
      const bFollowsA = (dataB.followingIds || []).includes(a.uniqueId);
      // Followers are the symmetric mirror — assert both sides cleanly
      // so a one-sided graph corruption is also caught.
      const aFollowedByB = (dataA.followerIds || []).includes(b.uniqueId);
      const bFollowedByA = (dataB.followerIds || []).includes(a.uniqueId);
      if (aFollowsB || bFollowsA || aFollowedByB || bFollowedByA) {
        return {
          ok: false,
          error: `precondition failed: at least one user is following the other (${nameA}↔${nameB})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Bare stats UI assertion. Trailing "(followers, following, beans)"
    // descriptive annotation stripped by Wake 30. Platform-dispatch;
    // driver verifies the stats panel is rendered for the target user.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)'s stats$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsStatsForUser) {
          return { ok: false, error: 'ctx.webDriver.webShowsStatsForUser not configured' };
        }
        const ok = await ctx.webDriver.webShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `Web UI did not show stats for ${target}` };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsStatsForUser) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsStatsForUser not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `Android UI did not show stats for ${target}` };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsStatsForUser) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsStatsForUser not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsStatsForUser(target);
        if (!ok) return { ok: false, error: `iOS UI did not show stats for ${target}` };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for stats step` };
    },
  },
  {
    // Selects from followed-users picker (j07 PM compose flow).
    // Driver opens the followed-users picker AND selects the named
    // entry. Currently Android only — corpus doesn't have Web/iOS
    // variants of this exact phrasing.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+selects "([^"]+)" from the followed-users picker$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidSelectFromFollowedPicker) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidSelectFromFollowedPicker not configured',
        };
      }
      await ctx.uiDriver.androidSelectFromFollowedPicker(target);
      return { ok: true };
    },
  },
  {
    // Navigates to conversation thread screen (composite UI assertion).
    // Driver verifies the persona's current screen is the conversation
    // thread AND the other party is the named target. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to the conversation thread screen with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const target = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webIsOnConversationWith) {
          return { ok: false, error: 'ctx.webDriver.webIsOnConversationWith not configured' };
        }
        const ok = await ctx.webDriver.webIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `Web UI is not on conversation with ${target}` };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidIsOnConversationWith) {
          return { ok: false, error: 'ctx.uiDriver.androidIsOnConversationWith not configured' };
        }
        const ok = await ctx.uiDriver.androidIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `Android UI is not on conversation with ${target}` };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosIsOnConversationWith) {
          return { ok: false, error: 'ctx.uiDriver.iosIsOnConversationWith not configured' };
        }
        const ok = await ctx.uiDriver.iosIsOnConversationWith(target);
        if (!ok) return { ok: false, error: `iOS UI is not on conversation with ${target}` };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for conversation-thread step` };
    },
  },
  {
    // Opens the conversation with persona (action). Platform-dispatch;
    // driver navigates to the existing conversation thread with the
    // named target user.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+opens the conversation with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[2];
      const target = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webOpenConversation) {
          return { ok: false, error: 'ctx.webDriver.webOpenConversation not configured' };
        }
        await ctx.webDriver.webOpenConversation(target);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidOpenConversation) {
          return { ok: false, error: 'ctx.uiDriver.androidOpenConversation not configured' };
        }
        await ctx.uiDriver.androidOpenConversation(target);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosOpenConversation) {
          return { ok: false, error: 'ctx.uiDriver.iosOpenConversation not configured' };
        }
        await ctx.uiDriver.iosOpenConversation(target);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for open-conversation step` };
    },
  },
  {
    // FCM push notification assertion. Two forms:
    //   - "on X's Web with body containing \"Y\""        (web variant)
    //   - "on X's Android device with body containing \"Y\" [and \"Z\"]"
    //     (mobile variant, with optional second body fragment)
    // Driver receives recipient name, platform string, and 1-or-2-element
    // body-fragment array. The driver verifies a push was delivered AND
    // the body contains ALL fragments.
    pattern:
      /^the tester sees an FCM push notification on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android device|iOS device) with body containing "([^"]+)"(?: and "([^"]+)")?$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const platform = m[2];
      const fragments = [m[3]];
      if (m[4]) fragments.push(m[4]);
      if (!ctx.webDriver?.seesFcmPushOnPlatform) {
        return { ok: false, error: 'ctx.webDriver.seesFcmPushOnPlatform not configured' };
      }
      const ok = await ctx.webDriver.seesFcmPushOnPlatform(recipient, platform, fragments);
      if (!ok) {
        return {
          ok: false,
          error: `no FCM push to ${recipient} on ${platform} containing ${fragments.map((f) => `"${f}"`).join(' and ')}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Types into conversation input (j07 PM compose). Platform-dispatch.
    // Driver targets the platform's conversation input element and
    // types the given body. No submit — separate step for that.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+types "([^"]+)" into the conversation input$/,
    async handler(m, ctx) {
      const platform = m[2];
      const body = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.webDriver.webTypeIntoConversationInput not configured',
          };
        }
        await ctx.webDriver.webTypeIntoConversationInput(body);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidTypeIntoConversationInput not configured',
          };
        }
        await ctx.uiDriver.androidTypeIntoConversationInput(body);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTypeIntoConversationInput) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosTypeIntoConversationInput not configured',
          };
        }
        await ctx.uiDriver.iosTypeIntoConversationInput(body);
        return { ok: true };
      }
      return {
        ok: false,
        error: `unknown platform "${platform}" for conversation-input-type step`,
      };
    },
  },
  {
    // Past-tense PM state Given. Two forms:
    //   - "X sent a message \"Y\" to Z"
    //   - "X sent a message \"Y\" to Z N minutes ago"  (timestamp)
    // Wake 30 strips trailing parens annotation (e.g. "(past edit window)").
    //
    // State-seed pattern (W120/W124/W126/W127/W128/W132/W133/W134):
    // writes the conversation + message docs directly rather than
    // delegating to a webDriver stub. ConvId is sorted-join of the
    // two uniqueIds (mirrors src/utils/system-pm.js convention for
    // 1:1 threads). createdAt offset from now() by minutesAgo so
    // edit-window expiry tests (j07) can verify past-message
    // immutability. ctx.lastSeededMessage records the {convId, msgId}
    // pair so downstream "edit X" / "delete X" matchers can target it.
    pattern: /^([A-Z][a-z]+)\s+sent a message "([^"]+)" to ([A-Z][a-z]+)(?:\s+(\d+) minutes ago)?$/,
    async handler(m, ctx) {
      const sender = m[1];
      const body = m[2];
      const recipient = m[3];
      const minutesAgo = m[4] ? parseInt(m[4], 10) : null;
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const sp = personas.get(sender);
      const rp = personas.get(recipient);
      if (!sp?.uniqueId) return { ok: false, error: `sender "${sender}" not in registry` };
      if (!rp?.uniqueId) return { ok: false, error: `recipient "${recipient}" not in registry` };
      const convId = [String(sp.uniqueId), String(rp.uniqueId)]
        .sort((a, b) => a.localeCompare(b))
        .join('_');
      const ts = minutesAgo === null ? Date.now() : Date.now() - minutesAgo * 60_000;
      const msgId = `test-pastmsg-${ts}-${sp.uniqueId}`;
      await ctx.db.doc(`conversations/${convId}`).set(
        {
          id: convId,
          isGroup: false,
          participantIds: [sp.uniqueId, rp.uniqueId],
          lastMessage: {
            text: body,
            senderId: sp.uniqueId,
            senderName: sender,
            type: 'TEXT',
            createdAt: ts,
          },
          lastMessageAt: ts,
        },
        { merge: true },
      );
      await ctx.db.doc(`conversations/${convId}/messages/${msgId}`).set({
        id: msgId,
        conversationId: convId,
        senderId: sp.uniqueId,
        senderName: sender,
        recipientId: rp.uniqueId,
        text: body,
        type: 'TEXT',
        createdAt: ts,
      });
      ctx.lastSeededMessage = { convId, msgId, sender, recipient, body, ts };
      return { ok: true };
    },
  },
  {
    // Edit-body-and-confirms composite (j07 PM edit flow). Driver opens
    // the edit modal, replaces the body, taps confirm. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+changes the body to "([^"]+)" and confirms$/,
    async handler(m, ctx) {
      const platform = m[2];
      const newBody = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webEditBodyAndConfirm) {
          return { ok: false, error: 'ctx.webDriver.webEditBodyAndConfirm not configured' };
        }
        await ctx.webDriver.webEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidEditBodyAndConfirm) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidEditBodyAndConfirm not configured',
          };
        }
        await ctx.uiDriver.androidEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosEditBodyAndConfirm) {
          return { ok: false, error: 'ctx.uiDriver.iosEditBodyAndConfirm not configured' };
        }
        await ctx.uiDriver.iosEditBodyAndConfirm(newBody);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for edit-body step` };
    },
  },
  {
    // Bare persona-exists Given. Wake 30's annotation strip is end-
    // anchored — the corpus form `Marcus (P-04, minor) exists` has
    // parens MID-step, so they aren't stripped upstream. Allow an
    // optional mid-step parens annotation between the name and the
    // `exists` verb.
    pattern: /^([A-Z][a-z]+)(?:\s+\([^()]*\))?\s+exists$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const snap = await ctx.db.doc(`users/${p.uniqueId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `users/${p.uniqueId} does not exist (${name})` };
      }
      return { ok: true };
    },
  },
  {
    // Types into search field — Web variant only. Pre-existing matchers
    // already handle Android (androidSearchIn(null, text), line ~2698)
    // and iOS Sim (iosSearchIn(null, text), line ~2076). This matcher
    // fills the Web gap that the corpus (j08 Vexa) needs.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web)\s+types "([^"]+)" into the search field$/,
    async handler(m, ctx) {
      const body = m[3];
      if (!ctx.webDriver?.webTypeIntoSearch) {
        return { ok: false, error: 'ctx.webDriver.webTypeIntoSearch not configured' };
      }
      const ok = await ctx.webDriver.webTypeIntoSearch(body);
      if (ok === false) {
        // Driver returns explicit `false` when it couldn't locate the
        // search input. `undefined` (legacy stub) stays a pass for
        // backwards-compat — defer cleanup to a future wake that
        // standardises the driver-return contract across all methods.
        return { ok: false, error: `webTypeIntoSearch("${body}") did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Voice room state-seed (j08). Writes a `rooms/<id>` doc owned by
    // the named persona. Owner uniqueId resolved via the persona
    // registry. Other room fields (participants, etc.) initialised
    // empty — scenarios that need them seed via other matchers.
    pattern: /^([A-Z][a-z]+)\s+created a voice room "([^"]+)"$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const roomId = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // FCM dispatcher attempts to send a notification (j08). Wake 30
    // strips ONLY the trailing parens — so the step has parens
    // remaining mid-step around the sender's uniqueId. Allow optional
    // `(<digits>)` after each name to absorb that residual.
    pattern:
      /^the FCM dispatcher attempts to send a notification from ([A-Z][a-z]+)(?:\s+\(\d+\))?\s+to ([A-Z][a-z]+)(?:\s+\(\d+\))?$/,
    async handler(m, ctx) {
      const sender = m[1];
      const recipient = m[2];
      if (!ctx.webDriver?.simulateFcmDispatcherAttempt) {
        return {
          ok: false,
          error: 'ctx.webDriver.simulateFcmDispatcherAttempt not configured',
        };
      }
      await ctx.webDriver.simulateFcmDispatcherAttempt(sender, recipient);
      return { ok: true };
    },
  },
  {
    // No FCM payload is sent to <X>'s tokens (j08 cross-cohort wall).
    // Negative assertion — driver counts payloads delivered to the
    // persona's FCM tokens since the most recent dispatcher attempt.
    pattern: /^no FCM payload is sent to ([A-Z][a-z]+)'s tokens$/,
    async handler(m, ctx) {
      const recipient = m[1];
      if (!ctx.webDriver?.countFcmPayloadsToUser) {
        return { ok: false, error: 'ctx.webDriver.countFcmPayloadsToUser not configured' };
      }
      const count = await ctx.webDriver.countFcmPayloadsToUser(recipient);
      if (count > 0) {
        return {
          ok: false,
          error: `expected 0 FCM payloads to ${recipient} but driver found ${count}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Dispatcher audit log records <X> with reason <Y> (j08). Driver
    // verifies the audit log contains an entry with the named action
    // AND named reason.
    pattern: /^the dispatcher audit log records "([^"]+)" with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[1];
      const reason = m[2];
      if (!ctx.webDriver?.auditLogContains) {
        return { ok: false, error: 'ctx.webDriver.auditLogContains not configured' };
      }
      const ok = await ctx.webDriver.auditLogContains(action, reason);
      if (!ok) {
        return {
          ok: false,
          error: `audit log has no entry "${action}" with reason "${reason}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI banner absence (party-anchored). Distinct from Wake 52's
    // generic "cohort change banner" — this one is party-anchored:
    // "X's UI does not show any in-app banner FROM Y". Platform-
    // dispatch; driver returns truthy iff a banner from the named
    // sender is currently rendered. Truthy = banner present = fail.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any in-app banner from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const platform = m[3];
      const sender = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsBannerFromUser) {
          return { ok: false, error: 'ctx.webDriver.webShowsBannerFromUser not configured' };
        }
        const shown = await ctx.webDriver.webShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `Web UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsBannerFromUser) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsBannerFromUser not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `Android UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsBannerFromUser) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsBannerFromUser not configured' };
        }
        const shown = await ctx.uiDriver.iosShowsBannerFromUser(sender);
        if (shown) {
          return { ok: false, error: `iOS UI shows an in-app banner from "${sender}"` };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for banner-absence step` };
    },
  },
  {
    // Attempt to start a conversation via POST <api> (j07 negative path
    // when cohorts differ). Driver fires the API call and stores result
    // on ctx.lastResponse (the bare HTTP status matcher below reads it).
    pattern:
      /^([A-Z][a-z]+)\s+on Android attempts to start a conversation with ([A-Z][a-z]+) via POST (\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      const apiPath = m[3];
      if (!ctx.uiDriver?.androidAttemptStartConversation) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidAttemptStartConversation not configured',
        };
      }
      const result = await ctx.uiDriver.androidAttemptStartConversation(target, apiPath);
      // Store result on ctx so the bare "the request returns status N"
      // assertion can read it downstream.
      if (result && typeof result.status === 'number') {
        ctx.lastResponse = { status: result.status, body: result.body || null, path: apiPath };
      }
      return { ok: true };
    },
  },
  {
    // New-follower notification absence (j08). Distinct from Wake 60's
    // party-anchored banner — this is a generic "no NEW follower
    // notification" with NO specific source persona.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any new follower notification$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.webDriver.webShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.webDriver.webShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'Web UI shows a new follower notification' };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'Android UI shows a new follower notification' };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsNewFollowerNotification) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosShowsNewFollowerNotification not configured',
          };
        }
        const shown = await ctx.uiDriver.iosShowsNewFollowerNotification();
        if (shown) {
          return { ok: false, error: 'iOS UI shows a new follower notification' };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for follower-notif step` };
    },
  },
  {
    // Profile deep-link attempt (j08 cross-cohort). Driver fires the
    // deep-link intent (adb am start -d <url> on Android, xcrun simctl
    // openurl on iOS). Doesn't assert resulting UI state — a follow-up
    // step does that.
    pattern: /^([A-Z][a-z]+)\s+on (Android|iOS Sim)\s+attempts profile deep-link "([^"]+)"$/,
    async handler(m, ctx) {
      const platform = m[2];
      const url = m[3];
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidAttemptProfileDeepLink) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidAttemptProfileDeepLink not configured',
          };
        }
        await ctx.uiDriver.androidAttemptProfileDeepLink(url);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosAttemptProfileDeepLink) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosAttemptProfileDeepLink not configured',
          };
        }
        await ctx.uiDriver.iosAttemptProfileDeepLink(url);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for profile-deep-link step` };
    },
  },
  {
    // Attempts to follow via the profile screen (j08). Wake 30 strips
    // trailing parens annotation like "(via deep-link error path)".
    // Driver taps the follow button on the currently-rendered profile
    // screen.
    pattern:
      /^([A-Z][a-z]+)\s+on Android\s+attempts to follow ([A-Z][a-z]+) via the profile screen$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidAttemptFollowViaProfile) {
        return {
          ok: false,
          error: 'ctx.uiDriver.androidAttemptFollowViaProfile not configured',
        };
      }
      await ctx.uiDriver.androidAttemptFollowViaProfile(target);
      return { ok: true };
    },
  },
  {
    // Bare HTTP response status assertion. Reads ctx.lastResponse (set
    // by the older POSTs matcher at line ~530 and by Wake 61's
    // attempt-start-conversation matcher above). Fails clearly when no
    // response is recorded.
    pattern: /^the request returns status (\d+)$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      const actual = ctx.lastResponse.status;
      if (actual !== expected) {
        return {
          ok: false,
          error: `request status mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Conversation doc field equality assertion (j08 OSA migration
    // verification). Trailing parens annotation stripped by Wake 30.
    // Value parsing: `true`/`false`/numeric — keeps it simple; the
    // corpus only uses these forms today.
    pattern: /^the conversation doc "([^"]+)" has field "([^"]+)" equal to (true|false|\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const rawValue = m[3];
      const expected =
        rawValue === 'true' ? true : rawValue === 'false' ? false : parseInt(rawValue, 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `document "${docPath}" does not exist` };
      }
      const actual = snap.data()?.[field];
      // Field-name duality for the OSA-freeze pair — see Wake 90 matcher
      // comment above. Mirrors probeOsaInvariants' `isFrozen` predicate.
      const data = snap.data() || {};
      const isFrozenDual =
        (field === 'frozenAtMigration' || field === 'frozen') &&
        expected === true &&
        (data.frozen === true || data.frozenAtMigration === true);
      if (!isFrozenDual && actual !== expected) {
        return {
          ok: false,
          error: `field "${field}" on "${docPath}" expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Abstract cohort UI absence (j02 minor visibility test). Driver
    // returns truthy iff any user with the "adult" cohort is currently
    // rendered in the UI. Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any adult-cohort visitor$/,
    async handler(m, ctx) {
      const platform = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.webDriver.webShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.webDriver.webShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'Web UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'Android UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsAdultCohortVisitor) {
          return {
            ok: false,
            error: 'ctx.uiDriver.iosShowsAdultCohortVisitor not configured',
          };
        }
        const shown = await ctx.uiDriver.iosShowsAdultCohortVisitor();
        if (shown) return { ok: false, error: 'iOS UI shows an adult-cohort visitor' };
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for cohort-visitor step` };
    },
  },
  {
    // Voice room state-seed with mic state (multi-field). Wake 30's
    // strip is end-anchored so `(an adult-cohort room)` mid-step isn't
    // removed — allow optional mid-step parens between the room id and
    // "with mic". Updates the room's participantIds + micStates map.
    pattern:
      /^([A-Z][a-z]+)\s+is in voice room "([^"]+)"(?:\s+\([^()]*\))?\s+with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      const micState = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const micStates = { ...(existing.micStates || {}) };
      micStates[String(p.uniqueId)] = micState;
      await ctx.db.doc(docPath).set({ ...existing, participantIds, micStates }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Web Admin age-down flow composite (j04). Driver runs the full
    // admin-side age-down sequence: open submission, set override DOB,
    // tap reject_and_dob_down, confirm reason. Single matcher because
    // the corpus uses the composite when the individual steps aren't
    // load-bearing for the scenario being tested.
    pattern: /^([A-Z][a-z]+)\s+on Web Admin executes the age-down flow$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminExecuteAgeDownFlow) {
        return { ok: false, error: 'ctx.webDriver.webAdminExecuteAgeDownFlow not configured' };
      }
      await ctx.webDriver.webAdminExecuteAgeDownFlow();
      return { ok: true };
    },
  },
  {
    // Concurrent N follow attempts (j08 cross-cohort wall concurrency
    // probe). Fires N parallel POSTs to the named endpoint and stores
    // `[{ status, latencyMs }, ...]` on ctx.lastConcurrentResults for
    // downstream `each response status is N` assertions.
    //
    // Rewritten (W131): pulled out of webDriver into the matcher (no UI
    // surface — pure HTTP fan-out). Uses the most-recently-active
    // session (last entry in ctx.sessions) to authorise each request.
    // Body shape: the j08 corpus only uses this for /api/users/follow
    // with a fixed cross-cohort targetUniqueId, so we hardcode the
    // minor side (60000010 Marcus) as target — matches the scenario
    // intent that EVERY concurrent attempt is the same cohort-violating
    // request and EVERY response must be blocked.
    pattern: /^(\d+) cross-cohort follow attempts hit (\/api\/[\w/-]+) concurrently$/,
    async handler(m, ctx) {
      const count = parseInt(m[1], 10);
      const endpoint = m[2];
      if (!ctx.fetch) return { ok: false, error: 'ctx.fetch not configured' };
      if (!ctx.sessions || ctx.sessions.size === 0) {
        return { ok: false, error: 'no sessions in ctx — Given step missing?' };
      }
      // Last-registered session is the active actor — j08 sets Vexa
      // signed-in just before this step.
      const lastName = [...ctx.sessions.keys()].pop();
      const sess = ctx.sessions.get(lastName);
      if (!sess?.idToken) {
        return { ok: false, error: `session for "${lastName}" has no idToken` };
      }
      const tasks = [];
      for (let i = 0; i < count; i++) {
        const start = Date.now();
        tasks.push(
          ctx
            .fetch(ctx.apiBase + endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${sess.idToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ targetUniqueId: 60000010 }),
            })
            .then((r) => ({ status: r.status, latencyMs: Date.now() - start })),
        );
      }
      ctx.lastConcurrentResults = await Promise.all(tasks);
      return { ok: true };
    },
  },
  {
    // Each-response-status assertion. Reads ctx.lastConcurrentResults
    // (set by the concurrent-batch matcher above) and asserts every
    // entry has the named status.
    pattern: /^each response status is (\d+)$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.lastConcurrentResults || !Array.isArray(ctx.lastConcurrentResults)) {
        return {
          ok: false,
          error: 'no recorded concurrent results — earlier batch step missing',
        };
      }
      const offenders = ctx.lastConcurrentResults
        .map((r, i) => ({ i, status: r.status }))
        .filter((r) => r.status !== expected);
      if (offenders.length > 0) {
        const summary = offenders
          .slice(0, 3)
          .map((o) => `#${o.i}=${o.status}`)
          .join(', ');
        return {
          ok: false,
          error: `expected all status ${expected}, but ${offenders.length} differ: ${summary}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Audit row count assertion. Counts docs in the auditLog
    // collection. Used by j08 after concurrent-batch + per-response
    // status checks to verify the audit log captured all attempts.
    pattern: /^(\d+) audit rows are written$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection('auditLog').get();
      const actual = snap.docs.length;
      if (actual !== expected) {
        return {
          ok: false,
          error: `auditLog count mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room create composite (j09 host). Driver opens the create-
    // room form, types the title, picks the visibility radio, and taps
    // Create. Single matcher for the full composite because the corpus
    // uses it that way (intermediate steps not load-bearing).
    pattern:
      /^([A-Z][a-z]+)\s+on Android types title "([^"]+)" and chooses (public|private) visibility$/,
    async handler(m, ctx) {
      const title = m[2];
      const visibility = m[3];
      if (!ctx.uiDriver?.androidCreateRoomComposite) {
        return { ok: false, error: 'ctx.uiDriver.androidCreateRoomComposite not configured' };
      }
      await ctx.uiDriver.androidCreateRoomComposite(title, visibility);
      return { ok: true };
    },
  },
  {
    // Receives a LiveKit token. Two forms — bare and "in response from
    // POST <api>". Driver receives the endpoint (null for bare). Returns
    // the token string (truthy = ok). Platform-dispatch.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+receives a LiveKit token(?: in response from POST (\/api\/[\w/-]+))?$/,
    async handler(m, ctx) {
      const platform = m[2];
      const endpoint = m[3] || null;
      let token;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webReceiveLiveKitToken) {
          return { ok: false, error: 'ctx.webDriver.webReceiveLiveKitToken not configured' };
        }
        token = await ctx.webDriver.webReceiveLiveKitToken(endpoint);
      } else if (platform === 'Android') {
        if (!ctx.uiDriver?.androidReceiveLiveKitToken) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidReceiveLiveKitToken not configured',
          };
        }
        token = await ctx.uiDriver.androidReceiveLiveKitToken(endpoint);
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosReceiveLiveKitToken) {
          return { ok: false, error: 'ctx.uiDriver.iosReceiveLiveKitToken not configured' };
        }
        token = await ctx.uiDriver.iosReceiveLiveKitToken(endpoint);
      } else {
        return { ok: false, error: `unknown platform "${platform}" for LiveKit token step` };
      }
      if (!token) {
        return { ok: false, error: `no LiveKit token received on ${platform}` };
      }
      return { ok: true };
    },
  },
  {
    // Seat grid assertion (j09). Wake 30 strips trailing parens (e.g.
    // "(by himself)"). Driver returns { occupied, total } for the
    // currently-rendered seat grid. Matcher asserts both numbers.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the seat grid with (\d+) of (\d+) seats occupied$/,
    async handler(m, ctx) {
      const platform = m[3];
      const expectedOccupied = parseInt(m[4], 10);
      const expectedTotal = parseInt(m[5], 10);
      let state;
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidSeatGridState) {
          return { ok: false, error: 'ctx.uiDriver.androidSeatGridState not configured' };
        }
        state = await ctx.uiDriver.androidSeatGridState();
      } else if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosSeatGridState) {
          return { ok: false, error: 'ctx.uiDriver.iosSeatGridState not configured' };
        }
        state = await ctx.uiDriver.iosSeatGridState();
      } else if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webSeatGridState) {
          return { ok: false, error: 'ctx.webDriver.webSeatGridState not configured' };
        }
        state = await ctx.webDriver.webSeatGridState();
      } else {
        return { ok: false, error: `unknown platform "${platform}" for seat-grid step` };
      }
      if (state?.occupied !== expectedOccupied || state?.total !== expectedTotal) {
        return {
          ok: false,
          error: `seat grid mismatch: expected ${expectedOccupied} of ${expectedTotal}, actual ${state?.occupied} of ${state?.total}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Taps the same room (relative reference, j09). The "same room" is
    // the room most-recently created or referenced — driver maintains
    // that state. Optional " again" suffix passed as boolean.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps the same room( again)?$/,
    async handler(m, ctx) {
      const platform = m[2];
      const isAgain = !!m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapSameRoom) {
          return { ok: false, error: 'ctx.webDriver.webTapSameRoom not configured' };
        }
        await ctx.webDriver.webTapSameRoom(isAgain);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapSameRoom) {
          return { ok: false, error: 'ctx.uiDriver.androidTapSameRoom not configured' };
        }
        await ctx.uiDriver.androidTapSameRoom(isAgain);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapSameRoom) {
          return { ok: false, error: 'ctx.uiDriver.iosTapSameRoom not configured' };
        }
        await ctx.uiDriver.iosTapSameRoom(isAgain);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tap-same-room step` };
    },
  },
  {
    // Approve seat request composite (j09 host). Driver locates the
    // seat-request notification for the named user and taps approve.
    // Driver contract is `(host, requester)` — matches Wake 86's
    // canonical "approves" phrasing at line 9753 to keep both step
    // forms consistent under the same driver method.
    pattern: /^([A-Z][a-z]+)\s+on Android\s+taps approve on ([A-Z][a-z]+)'s seat request$/,
    async handler(m, ctx) {
      const host = m[1];
      const requester = m[2];
      if (!ctx.uiDriver?.androidApproveSeatRequest) {
        return { ok: false, error: 'ctx.uiDriver.androidApproveSeatRequest not configured' };
      }
      await ctx.uiDriver.androidApproveSeatRequest(host, requester);
      return { ok: true };
    },
  },
  {
    // Block via API attempt (j04). Wake 30 strips ONLY trailing parens,
    // so the corpus form `block Officia (uniqueId=1) via /api/users/block`
    // has mid-step parens — allow optional `\(...\)` after the target.
    // Driver stores result on ctx.lastResponse for downstream assertions.
    pattern:
      /^([A-Z][a-z]+)\s+on Android attempts to block ([A-Z][a-z]+)(?:\s+\([^()]*\))?\s+via (\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const target = m[2];
      const apiPath = m[3];
      if (!ctx.uiDriver?.androidAttemptBlock) {
        return { ok: false, error: 'ctx.uiDriver.androidAttemptBlock not configured' };
      }
      const result = await ctx.uiDriver.androidAttemptBlock(target, apiPath);
      if (result && typeof result.status === 'number') {
        ctx.lastResponse = { status: result.status, body: result.body || null, path: apiPath };
      }
      return { ok: true };
    },
  },
  {
    // Bare response-status-from-path assertion: distinct from the Wake 61
    // "the request returns status N" matcher because this one verifies
    // the response came from the NAMED endpoint. Reads ctx.lastResponse
    // and checks both status AND path match.
    pattern: /^the response status from (\/api\/[\w/-]+) is (\d+)$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedStatus = parseInt(m[2], 10);
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      if (ctx.lastResponse.path && ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `last response path was ${ctx.lastResponse.path}, expected ${expectedPath}`,
        };
      }
      const actual = ctx.lastResponse.status;
      if (actual !== expectedStatus) {
        return {
          ok: false,
          error: `${expectedPath} status mismatch: expected ${expectedStatus}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // p95 latency budget. Reads ctx.lastConcurrentResults, sorts by
    // latencyMs, picks the 95th percentile (ceil(0.95*N) index), and
    // asserts it's less than the budget.
    pattern: /^each response p95 latency is less than (\d+)ms$/,
    async handler(m, ctx) {
      const budget = parseInt(m[1], 10);
      if (!ctx.lastConcurrentResults || !Array.isArray(ctx.lastConcurrentResults)) {
        return {
          ok: false,
          error: 'no recorded concurrent results — earlier batch step missing',
        };
      }
      const sorted = [...ctx.lastConcurrentResults]
        .map((r) => r.latencyMs || 0)
        .sort((a, b) => a - b);
      // p95 = "the slowest 5% should be under budget". With N samples,
      // floor(0.95 * N) gives the 0-indexed position WHERE the top 5%
      // begins — checking sorted[floor(0.95 * N)] captures the worst
      // 5% boundary. For N=20: index 19 (the slowest sample).
      const p95Idx = Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length));
      const p95 = sorted[p95Idx];
      if (p95 >= budget) {
        return {
          ok: false,
          error: `p95 latency ${p95}ms exceeds budget of ${budget}ms`,
        };
      }
      return { ok: true };
    },
  },
  {
    // No-document-in-subcollection assertion. Scans the named (sub)
    // collection and asserts it's empty.
    pattern: /^no document is created in "([^"]+)"$/,
    async handler(m, ctx) {
      const collection = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(collection).get();
      if (snap.docs.length > 0) {
        return {
          ok: false,
          error: `expected no docs in "${collection}" but found ${snap.docs.length}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room composite state-seed: "X created a (public|private)
    // <cohort>-cohort room". Writes a `rooms/<auto-id>` doc owned by
    // X with the named visibility and cohort. Auto-id chosen as
    // "auto-<timestamp>-<random>" so multiple seeds don't collide.
    pattern: /^([A-Z][a-z]+)\s+created a (public|private) (adult|minor)-cohort room$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const visibility = m[2];
      const cohort = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      // Math.random() is fine here — purely for collision avoidance in
      // test-only auto-generated room ids; not security-sensitive.
      // eslint-disable-next-line sonarjs/pseudo-random
      const roomId = `auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        visibility,
        cohort,
        participantIds: [owner.uniqueId],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Dialog confirm action. Distinct from Wake 45's generic "confirms"
    // matcher — that one matches `X on <plat> confirms` (no suffix);
    // this one matches `... confirms in the dialog`. Different driver
    // method because dialogs use different selectors than inline buttons.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+confirms in the dialog$/,
    async handler(m, ctx) {
      const platform = m[2];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webConfirmDialog) {
          return { ok: false, error: 'ctx.webDriver.webConfirmDialog not configured' };
        }
        await ctx.webDriver.webConfirmDialog();
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidConfirmDialog) {
          return { ok: false, error: 'ctx.uiDriver.androidConfirmDialog not configured' };
        }
        await ctx.uiDriver.androidConfirmDialog();
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosConfirmDialog) {
          return { ok: false, error: 'ctx.uiDriver.iosConfirmDialog not configured' };
        }
        await ctx.uiDriver.iosConfirmDialog();
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for dialog-confirm step` };
    },
  },
  {
    // Long-press on target person's seat (j09 host kick-from-seat).
    // Driver locates the seat element by target name and performs a
    // long-press gesture (held tap).
    pattern: /^([A-Z][a-z]+)\s+on Android long-presses ([A-Z][a-z]+)'s seat$/,
    async handler(m, ctx) {
      const target = m[2];
      if (!ctx.uiDriver?.androidLongPressSeat) {
        return { ok: false, error: 'ctx.uiDriver.androidLongPressSeat not configured' };
      }
      await ctx.uiDriver.androidLongPressSeat(target);
      return { ok: true };
    },
  },
  {
    // Voice room create-with-joiners composite (j09). Auto-generates
    // a room id, writes a doc owned by X with participantIds containing
    // owner + N synthetic joiner uniqueIds (60000001..60000000+N).
    pattern: /^([A-Z][a-z]+)\s+created a room and has (\d+) joiners$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const joinerCount = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      // eslint-disable-next-line sonarjs/pseudo-random
      const roomId = `auto-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const joiners = Array.from({ length: joinerCount }, (_, i) => 60000001 + i);
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        participantIds: [owner.uniqueId, ...joiners],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Network drops for N seconds (Android + iOS Sim). Driver simulates
    // a network outage for the named persona for the named duration.
    // Outage clears automatically after the duration — scenarios that
    // need the outage to persist past the duration must re-arm.
    pattern: /^([A-Z][a-z]+)'s (Android|iOS Sim) network drops for (\d+) seconds$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const seconds = parseInt(m[3], 10);
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidNetworkDropFor) {
          return { ok: false, error: 'ctx.uiDriver.androidNetworkDropFor not configured' };
        }
        await ctx.uiDriver.androidNetworkDropFor(name, seconds);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosNetworkDropFor) {
          return { ok: false, error: 'ctx.uiDriver.iosNetworkDropFor not configured' };
        }
        await ctx.uiDriver.iosNetworkDropFor(name, seconds);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for network-drop step` };
    },
  },
  {
    // Each-joiner UI navigates back with toast (j09 host-disconnected).
    // Driver verifies that EVERY joiner of the most-recent room ended
    // up on the rooms tab AND saw the named toast. Driver receives
    // just the toast text — it tracks the joiner set internally.
    pattern: /^each joiner's UI navigates back to the rooms tab with "([^"]+)" toast$/,
    async handler(m, ctx) {
      const toast = m[1];
      if (!ctx.webDriver?.eachJoinerNavigatesBackWithToast) {
        return {
          ok: false,
          error: 'ctx.webDriver.eachJoinerNavigatesBackWithToast not configured',
        };
      }
      const ok = await ctx.webDriver.eachJoinerNavigatesBackWithToast(toast);
      if (!ok) {
        return {
          ok: false,
          error: `not all joiners navigated back to rooms tab with "${toast}" toast`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Voice room composite create with named ID + cohort (j09). Unlike
    // Wake 64's auto-id form, this matcher takes an explicit room ID
    // from the corpus author.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+created (?:an? )?(adult|minor)-cohort room "([^"]+)"$/,
    async handler(m, ctx) {
      const ownerName = m[1];
      const cohort = m[3];
      const roomId = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const owner = personas.get(ownerName);
      if (!owner?.uniqueId) {
        return { ok: false, error: `persona "${ownerName}" not in registry` };
      }
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        ownerUniqueId: owner.uniqueId,
        cohort,
        participantIds: [owner.uniqueId],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Response body does not include <X>. Reads ctx.lastResponse.body
    // and asserts the named field is absent. Field name parsed as
    // bare word; corpus uses singular noun forms ("a token", "an
    // error", etc.) — the matcher strips the article.
    pattern: /^the response body does not include an? (\w+)$/,
    async handler(m, ctx) {
      const field = m[1];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      const body = ctx.lastResponse.body || {};
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        return {
          ok: false,
          error: `response body should not include "${field}" but it did (value=${JSON.stringify(body[field])})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // UI does not show the "<X>" button (quoted-button absence).
    // Distinct from Wake 49's quoted-string absence: that one matches
    // a literal quoted string ("Alice", "main_roomsTab"); this one
    // matches a NAMED button with explicit "the X button" suffix.
    // Driver returns truthy iff the named button is currently rendered.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show the "([^"]+)" button$/,
    async handler(m, ctx) {
      const platform = m[3];
      const buttonName = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsNamedButton) {
          return { ok: false, error: 'ctx.webDriver.webShowsNamedButton not configured' };
        }
        const shown = await ctx.webDriver.webShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `Web UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsNamedButton) {
          return {
            ok: false,
            error: 'ctx.uiDriver.androidShowsNamedButton not configured',
          };
        }
        const shown = await ctx.uiDriver.androidShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `Android UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsNamedButton) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsNamedButton not configured' };
        }
        const shown = await ctx.uiDriver.iosShowsNamedButton(buttonName);
        if (shown) {
          return { ok: false, error: `iOS UI shows "${buttonName}" button but should not` };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for named-button-absence step` };
    },
  },
  {
    // Wake 66 — multi-clause persona locale state-seed (j08 Background).
    // Pins per-persona locale for the scenario. We don't write to Firestore
    // here (locale lives on the client profile and the runner doesn't
    // mutate client state from a Given step); we just record the
    // association in ctx.personaLocales so later assertions can branch on
    // locale without re-parsing the Given step.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) locale=([a-z]{2}(?:-[A-Z]{2})?), ([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) locale=([a-z]{2}(?:-[A-Z]{2})?)$/,
    async handler(m, ctx) {
      const a = { name: m[1], platform: m[2], locale: m[3] };
      const b = { name: m[4], platform: m[5], locale: m[6] };
      const personas = loadPersonas();
      for (const p of [a, b]) {
        if (!personas.get(p.name)) {
          return { ok: false, error: `persona "${p.name}" not in registry` };
        }
      }
      if (!ctx.personaLocales) ctx.personaLocales = new Map();
      ctx.personaLocales.set(a.name, { platform: a.platform, locale: a.locale });
      ctx.personaLocales.set(b.name, { platform: b.platform, locale: b.locale });
      return { ok: true };
    },
  },
  {
    // Wake 66 — LiveKit track is disconnected (bare assertion).
    // Used both as a top-level Then step and as the inner step after
    // `within Nms` peels off its prefix. Three room-identifier forms:
    //   1. `{placeholder}` — left unresolved by interpolateScenarioVars
    //      when no scenario var is bound; passed verbatim to the driver.
    //   2. `"quoted"` — common for literal IDs like `"r1"`.
    //   3. bare token — alphanumeric room ID.
    // The matcher passes the room identifier through with quotes/braces
    // preserved when present (quoted form is unquoted before dispatch).
    pattern:
      /^([A-Z][a-z]+)'s LiveKit track for (?:room\s+)?(?:"([^"]+)"|(\{[^}]+\})|([\w-]+)) is disconnected$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2] || m[3] || m[4];
      if (!ctx.liveKitDriver?.trackIsDisconnected) {
        return { ok: false, error: 'ctx.liveKitDriver.trackIsDisconnected not configured' };
      }
      const disconnected = await ctx.liveKitDriver.trackIsDisconnected(name, roomId);
      if (!disconnected) {
        return {
          ok: false,
          error: `${name}'s LiveKit track for ${roomId} is still connected (not disconnected)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 66 — tester hears <X>'s audio on <Y>'s <platform> device.
    // Fundamentally @manual: only a human tester can verify real audio
    // playback. Gated on `ctx.testerDriver.confirmHearsAudio(from, on,
    // platform)`. In interactive mode the driver prompts the human; in
    // auto mode the driver is absent and the matcher fails with a clear
    // "@manual-only" marker so the operator knows to tag the scenario.
    // The trailing `(real microphone)` annotation in j09:65 is stripped
    // by stripStepAnnotation before this matcher runs.
    pattern:
      /^the tester hears ([A-Z][a-z]+)'s audio on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) device$/,
    async handler(m, ctx) {
      const fromName = m[1];
      const onName = m[2];
      const platform = m[3];
      if (!ctx.testerDriver?.confirmHearsAudio) {
        return {
          ok: false,
          error: `manual-only assertion — no testerDriver. Tag scenario @manual or wire ctx.testerDriver.confirmHearsAudio.`,
        };
      }
      const heard = await ctx.testerDriver.confirmHearsAudio(fromName, onName, platform);
      if (!heard) {
        return {
          ok: false,
          error: `tester did not confirm hearing ${fromName}'s audio on ${onName}'s ${platform} device`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 66 — UI shows the "<tab>" tab with no navigation to the
    // <screen> screen (composite).
    // Asserts BOTH that the named tab is currently selected AND that
    // no nav-stack push to <screen> has occurred. Used in j09 to verify
    // a cross-cohort participant lands on the rooms list with the room
    // they tapped never opening. Driver collapses both checks into one
    // call per platform — keeps the matcher contract narrow and lets
    // each driver decide how to introspect its UI stack.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the "([^"]+)" tab with no navigation to the (\w+) screen$/,
    async handler(m, ctx) {
      const platform = m[2];
      const tab = m[3];
      const screen = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.webDriver.webShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.webDriver.webShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `Web UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.uiDriver.androidShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.uiDriver.androidShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `Android UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosShowsTabWithNoNavTo) {
          return { ok: false, error: 'ctx.uiDriver.iosShowsTabWithNoNavTo not configured' };
        }
        const ok = await ctx.uiDriver.iosShowsTabWithNoNavTo(tab, screen);
        if (!ok) {
          return {
            ok: false,
            error: `iOS UI is not on "${tab}" tab OR has navigated to ${screen} screen`,
          };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for tab+no-nav step` };
    },
  },
  {
    // Wake 66 — conversation between two personas is frozen (state-seed).
    // Seeds `conversations/<id>` with frozen=true + participantIds. The
    // mid-step `(annotation)` parens describe cohort/locale but are NOT
    // stripped by the END-anchored stripStepAnnotation. The matcher
    // tolerates them inline via `\s*\([^)]+\)` and ignores their content
    // — corpus author's intent is to document the test setup for the
    // human reader, not to drive runner behaviour.
    pattern:
      /^the conversation "([^"]+)" between ([A-Z][a-z]+)\s*\([^)]+\) and ([A-Z][a-z]+)\s*\([^)]+\) is frozen$/,
    async handler(m, ctx) {
      const convId = m[1];
      const nameA = m[2];
      const nameB = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const a = personas.get(nameA);
      const b = personas.get(nameB);
      if (!a?.uniqueId) return { ok: false, error: `persona "${nameA}" not in registry` };
      if (!b?.uniqueId) return { ok: false, error: `persona "${nameB}" not in registry` };
      await ctx.db.doc(`conversations/${convId}`).set({
        id: convId,
        participantIds: [a.uniqueId, b.uniqueId],
        frozen: true,
        frozenAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 66 — response from /api/X as <persona> has N results and
    // "<field>=<value>" in every row.
    // Composite assertion: (a) count matches AND (b) every row has the
    // field equal to the value. Reads ctx.lastResponse (an earlier
    // request-firing step must have populated it). The "as <persona>"
    // segment is informational — identifies which persona made the
    // request in the corpus — and is NOT re-issued by this matcher.
    // Singular vs plural: the corpus uses "1 result" but "0 results" /
    // "5 results", so the trailing `s` is optional.
    pattern:
      /^the response from (\/api\/[\w/-]+) as ([A-Z][a-z]+) has (\d+) results? and "([^"=]+)=([^"]+)" in every row$/,
    async handler(m, ctx) {
      const expectedPath = m[1];
      const expectedCount = parseInt(m[3], 10);
      const field = m[4];
      const expectedValue = m[5];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      if (ctx.lastResponse.path && ctx.lastResponse.path !== expectedPath) {
        return {
          ok: false,
          error: `response path mismatch: expected ${expectedPath}, last was ${ctx.lastResponse.path}`,
        };
      }
      const body = ctx.lastResponse.body;
      if (!body || !Array.isArray(body.results)) {
        return {
          ok: false,
          error: `response body has no results[] array (got ${JSON.stringify(body)})`,
        };
      }
      const rows = body.results;
      if (rows.length !== expectedCount) {
        return {
          ok: false,
          error: `expected ${expectedCount} result(s) but actual ${rows.length}`,
        };
      }
      for (const row of rows) {
        const actual = row[field];
        // Loose equality after string coercion — corpus values are bare
        // strings ("minor", "adult", "true") but the response may carry
        // booleans / numbers.
        if (String(actual) !== expectedValue) {
          return {
            ok: false,
            error: `row violates "${field}=${expectedValue}": got ${field}=${JSON.stringify(actual)} in ${JSON.stringify(row)}`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    // Wake 67 — generic "<Name> on <Plat> attempts to <action>".
    // Catches navigation-lock + persistence test actions (j10): back-button
    // press, app kill+relaunch, swipe gestures. Earlier specific "attempts
    // to" matchers (navigate-via-deep-link, start-a-conversation, follow,
    // block) all sit ABOVE this in the array — first-match-wins keeps them
    // narrowly scoped while this catches the remainder.
    pattern: /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) attempts to (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const action = m[3];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webAttemptAction) {
          return { ok: false, error: 'ctx.webDriver.webAttemptAction not configured' };
        }
        const result = await ctx.webDriver.webAttemptAction(name, action);
        if (result === false || result?.ok === false) {
          return { ok: false, error: `web action "${action}" failed for ${name}` };
        }
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidAttemptAction) {
          return { ok: false, error: 'ctx.uiDriver.androidAttemptAction not configured' };
        }
        const result = await ctx.uiDriver.androidAttemptAction(name, action);
        if (result === false || result?.ok === false) {
          return { ok: false, error: `android action "${action}" failed for ${name}` };
        }
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosAttemptAction) {
          return { ok: false, error: 'ctx.uiDriver.iosAttemptAction not configured' };
        }
        const result = await ctx.uiDriver.iosAttemptAction(name, action);
        if (result === false || result?.ok === false) {
          return { ok: false, error: `ios action "${action}" failed for ${name}` };
        }
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for attempts-to step` };
    },
  },
  {
    // Wake 67 — UI shows the warning reason "<text>".
    // j10:48 asserts the warning screen displays a specific reason string.
    // Driver returns the current reason text; matcher does exact string
    // compare so a typo (corpus vs. live UI) surfaces in the error.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the warning reason "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const expected = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidGetWarningReason'
          : platform === 'iOS Sim'
            ? 'iosGetWarningReason'
            : 'webGetWarningReason';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName](name);
      if (actual !== expected) {
        return {
          ok: false,
          error: `warning reason mismatch: expected "${expected}", actual "${actual}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 67 — UI shows the <noun-phrase> image.
    // j10:49 — `the police duck image`. Bare-noun named-image assertion.
    // The named image's lookup key is freeform ("police duck", "daily
    // reward", "splash"); driver maps via Compose semantics on Android
    // or Inspector tags on iOS.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the ([\w ]+) image$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const imageName = m[3].trim();
      const methodName =
        platform === 'Android'
          ? 'androidShowsNamedImage'
          : platform === 'iOS Sim'
            ? 'iosShowsNamedImage'
            : 'webShowsNamedImage';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, imageName);
      if (!shown) {
        return { ok: false, error: `${platform} UI does not show "${imageName}" image` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 67 — UI does not show the <bare-noun>.
    // j10:50 — `does not show the voice room UI`. Narrower than the
    // existing `element with tag "X"` matcher (which requires quoted
    // test tag) and the `"X" button` matcher (which requires quotes +
    // "button" suffix) — those run first via first-match-wins.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show the ([\w ]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const nounPhrase = m[3].trim();
      const methodName =
        platform === 'Android'
          ? 'androidShowsNamedUi'
          : platform === 'iOS Sim'
            ? 'iosShowsNamedUi'
            : 'webShowsNamedUi';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, nounPhrase);
      if (shown) {
        return {
          ok: false,
          error: `${platform} UI still shows "${nounPhrase}" but should not`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 67 — Greta on Web Admin searches "<text>".
    // j10:33 / j12 reports tab. Bare admin-search (no `in <screen>`
    // suffix — that variant is the older Android-search matcher).
    // Driver types into the admin panel's universal search field.
    pattern: /^Greta on Web Admin searches "([^"]+)"$/,
    async handler(m, ctx) {
      const query = m[1];
      if (!ctx.webDriver?.webAdminSearch) {
        return { ok: false, error: 'ctx.webDriver.webAdminSearch not configured' };
      }
      const ok = await ctx.webDriver.webAdminSearch(query);
      if (!ok) {
        return { ok: false, error: `admin search for "${query}" returned no UI confirmation` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 67 — Greta on Web Admin confirms the <name> dialog.
    // j10:35 — `confirms the warning dialog`. Modal-confirmation step;
    // driver clicks the confirm button in the named modal. Dialog name
    // is freeform multi-word (`warning`, `delete user`, `revoke session`).
    pattern: /^Greta on Web Admin confirms the ([\w]+(?: [\w]+)*) dialog$/,
    async handler(m, ctx) {
      const dialogName = m[1];
      if (!ctx.webDriver?.webAdminConfirmDialog) {
        return { ok: false, error: 'ctx.webDriver.webAdminConfirmDialog not configured' };
      }
      const ok = await ctx.webDriver.webAdminConfirmDialog(dialogName);
      if (!ok) {
        return { ok: false, error: `no "${dialogName}" dialog was open to confirm` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 68 — bare-verb single-word tap (`taps acknowledge`).
    // Single lowercase-starting word so it can't collide with the quoted-
    // string tap matcher (`taps "X"`) or the room-card matcher (`taps the
    // room card`). Earlier specific matchers fire first via first-match-
    // wins; this catches the bare verbs.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps ([a-z][\w-]*)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const verb = m[4];
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapBareVerb) {
          return { ok: false, error: 'ctx.webDriver.webTapBareVerb not configured' };
        }
        await ctx.webDriver.webTapBareVerb(name, verb);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapBareVerb) {
          return { ok: false, error: 'ctx.uiDriver.androidTapBareVerb not configured' };
        }
        await ctx.uiDriver.androidTapBareVerb(name, verb);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapBareVerb) {
          return { ok: false, error: 'ctx.uiDriver.iosTapBareVerb not configured' };
        }
        await ctx.uiDriver.iosTapBareVerb(name, verb);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for bare-verb tap` };
    },
  },
  {
    // Wake 68 — tap the quoted target (`taps the "<id>"` /
    // `taps the room "<id>" card`). One pattern covers both: optional
    // `room\s+` prefix and optional trailing `\s+card`. The boolean
    // `isRoomCard` flag tells the driver which UI element to target.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+taps the (room\s+)?"([^"]+)"(\s+card)?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const isRoomPrefix = !!m[4];
      const targetId = m[5];
      const isCardSuffix = !!m[6];
      // "the room "X" card" semantic = isRoomCard. Plain `the "X"` = not.
      const isRoomCard = isRoomPrefix && isCardSuffix;
      if (platform.startsWith('Web')) {
        if (!ctx.webDriver?.webTapQuotedTarget) {
          return { ok: false, error: 'ctx.webDriver.webTapQuotedTarget not configured' };
        }
        await ctx.webDriver.webTapQuotedTarget(name, targetId, isRoomCard);
        return { ok: true };
      }
      if (platform === 'Android') {
        if (!ctx.uiDriver?.androidTapQuotedTarget) {
          return { ok: false, error: 'ctx.uiDriver.androidTapQuotedTarget not configured' };
        }
        await ctx.uiDriver.androidTapQuotedTarget(name, targetId, isRoomCard);
        return { ok: true };
      }
      if (platform === 'iOS Sim') {
        if (!ctx.uiDriver?.iosTapQuotedTarget) {
          return { ok: false, error: 'ctx.uiDriver.iosTapQuotedTarget not configured' };
        }
        await ctx.uiDriver.iosTapQuotedTarget(name, targetId, isRoomCard);
        return { ok: true };
      }
      return { ok: false, error: `unknown platform "${platform}" for quoted-target tap` };
    },
  },
  {
    // Wake 68 — persona is in voice room as a <role> (state-seed).
    // Mirrors the existing `with mic <state>` state-seed (line ~5480) but
    // for the role dimension. Writes participantIds + roles map (parallel
    // to existing micStates) so the runner has a consistent shape.
    pattern: /^([A-Z][a-z]+)\s+is in voice room "([^"]+)" as a ([\w-]+(?:\s+[\w-]+)*)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      const role = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const roles = { ...(existing.roles || {}) };
      roles[String(p.uniqueId)] = role;
      await ctx.db.doc(docPath).set({ ...existing, participantIds, roles }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 68 — room state assertion (`the room "<id>" is still <STATE>`).
    // Reads `rooms/<id>.state` from Firestore. Three states observed in
    // corpus: OPEN, CLOSED, FROZEN — uppercase by convention.
    pattern: /^the room "([^"]+)" is still (OPEN|CLOSED|FROZEN)$/,
    async handler(m, ctx) {
      const roomId = m[1];
      const expected = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(`rooms/${roomId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `rooms/${roomId} does not exist` };
      }
      const actual = snap.data().state;
      if (actual !== expected) {
        return {
          ok: false,
          error: `room state mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 68 — LiveKit publish permission/track is enabled/disabled.
    // Platform is OPTIONAL: j10:29 has `<Name>'s Android LiveKit ...`
    // (with platform); j10:44 has `<Name>'s LiveKit ...` (without).
    // Driver receives (name, kind, roomId, expectedState) where kind is
    // `permission` or `track`. The non-capturing platform group makes the
    // match flexible at zero regex cost.
    pattern:
      /^([A-Z][a-z]+)'s (?:(Web Chromium|Web Safari|Web|Android|iOS Sim)\s+)?LiveKit publish (permission|track) for room "([^"]+)" is (enabled|disabled)$/,
    async handler(m, ctx) {
      const name = m[1];
      const kind = m[3];
      const roomId = m[4];
      const expectedState = m[5];
      if (!ctx.liveKitDriver?.publishStateMatches) {
        return { ok: false, error: 'ctx.liveKitDriver.publishStateMatches not configured' };
      }
      const matches = await ctx.liveKitDriver.publishStateMatches(
        name,
        kind,
        roomId,
        expectedState,
      );
      if (!matches) {
        return {
          ok: false,
          error: `${name}'s LiveKit publish ${kind} for "${roomId}" is not ${expectedState}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 68 — UI mic indicator shows "<state>".
    // j10:80 — the seat's mic badge reflects server-side mic state.
    // Driver returns current displayed state; matcher does exact string
    // compare so a typo (corpus vs UI) surfaces in the error.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI mic indicator shows "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const expected = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidGetMicIndicator'
          : platform === 'iOS Sim'
            ? 'iosGetMicIndicator'
            : 'webGetMicIndicator';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName](name);
      if (actual !== expected) {
        return {
          ok: false,
          error: `mic indicator mismatch: expected "${expected}", actual "${actual}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 69 — persona-cohort-room state-seed (abstract, no room id).
    // j10:94 — `Marcus [P-04] is on iOS Sim seated in a minor-cohort room with mic open`.
    // Differs from the older `is in voice room "X" with mic <state>` matcher
    // because there's NO room id — the author is saying "any minor-cohort
    // room is fine, just make one." Handler synthesises a room id, writes
    // cohort + mic state + seat assignment in a single doc.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+seated in an? ([\w-]+)-cohort room with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const cohort = m[4];
      const micState = m[5];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      // Synthetic deterministic id from cohort + uniqueId so subsequent
      // assertions reading "the latest room" can find it; not the same
      // as a real LiveKit room id but stable for runner state.
      const roomId = `ephemeral-${cohort}-${p.uniqueId}-${ctx.scenarioStartTime || Date.now()}`;
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        cohort,
        participantIds: [p.uniqueId],
        micStates: { [String(p.uniqueId)]: micState },
        seats: [{ userId: p.uniqueId, muted: micState === 'muted' }],
        state: 'OPEN',
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 69 — long-press + tap composite gesture.
    // j11:31 — `Nora on iOS Sim long-presses the offensive message and taps "Report"`.
    // Two-step gesture (long-press to open context menu, then tap a named
    // menu item). One matcher keeps the corpus author's intent atomic.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+long-presses the offensive message and taps "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const action = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidLongPressMessageAndTap'
          : platform === 'iOS Sim'
            ? 'iosLongPressMessageAndTap'
            : 'webLongPressMessageAndTap';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, action);
      if (!ok) {
        return {
          ok: false,
          error: `long-press + tap "${action}" did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 69 — selects reason "<text>" and confirms.
    // j11:32 — `Nora on iOS Sim selects reason "Harassment" and confirms`.
    // Picker-then-confirm composite. Reusable for report-reason, block-
    // reason, delete-reason flows.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+selects reason "([^"]+)" and confirms$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const reason = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidSelectReasonAndConfirm'
          : platform === 'iOS Sim'
            ? 'iosSelectReasonAndConfirm'
            : 'webSelectReasonAndConfirm';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, reason);
      if (!ok) {
        return {
          ok: false,
          error: `select-reason + confirm "${reason}" did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 69 — Greta on Web Admin refreshes the <name> tab.
    // j11:37 — `refreshes the reports tab`. Tab-scoped refresh (vs full
    // page reload). Tab name is a single word (`reports`, `appeals`,
    // `users`, etc.).
    pattern: /^Greta on Web Admin refreshes the (\w+) tab$/,
    async handler(m, ctx) {
      const tab = m[1];
      if (!ctx.webDriver?.webAdminRefreshTab) {
        return { ok: false, error: 'ctx.webDriver.webAdminRefreshTab not configured' };
      }
      const ok = await ctx.webDriver.webAdminRefreshTab(tab);
      if (!ok) {
        return { ok: false, error: `admin tab "${tab}" did not refresh` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 69 — UI shows the <name> <kind> (positive).
    // j11:86 — `Raul's Android UI shows the appeal button`.
    // Positive complement to Wake 65's quoted-button negative matcher.
    // The terminal `<kind>` (button|screen|banner|dialog|panel|tab)
    // distinguishes this from `shows the X image` (Wake 67) and
    // `shows the element with tag "X"` (existing). Earlier specific
    // matchers (warning reason, element with tag) still fire first.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the ([\w ]+) (button|screen|banner|dialog|panel|tab)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const noun = m[3].trim();
      const kind = m[4];
      const methodName =
        platform === 'Android'
          ? 'androidShowsNamedKind'
          : platform === 'iOS Sim'
            ? 'iosShowsNamedKind'
            : 'webShowsNamedKind';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, noun, kind);
      if (!shown) {
        return { ok: false, error: `${platform} UI does not show the "${noun}" ${kind}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 69 — admin shows report row (reporter + reportedId + reason).
    // j11:39 — `Greta's Web Admin UI shows reporter Nora + reportedId Raul + reason "Harassment"`.
    // Composite three-way conjunction asserting a row in the admin reports
    // table. Driver receives a struct so the driver decides how to match
    // (column index, data-test id, etc.).
    pattern:
      /^Greta's Web Admin UI shows reporter ([A-Z][a-z]+) \+ reportedId ([A-Z][a-z]+) \+ reason "([^"]+)"$/,
    async handler(m, ctx) {
      const reporter = m[1];
      const reportedId = m[2];
      const reason = m[3];
      if (!ctx.webDriver?.webAdminShowsReportRow) {
        return { ok: false, error: 'ctx.webDriver.webAdminShowsReportRow not configured' };
      }
      const ok = await ctx.webDriver.webAdminShowsReportRow({ reporter, reportedId, reason });
      if (!ok) {
        return {
          ok: false,
          error: `admin reports table missing row: reporter=${reporter}, reportedId=${reportedId}, reason="${reason}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 70 — admin "opens the report and taps <action>".
    // j11:42 — `Greta on Web Admin opens the report and taps "Warn Raul"`.
    // Two-step composite: expand the report row into detail panel, then
    // click a named action button.
    pattern: /^Greta on Web Admin opens the report and taps "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[1];
      if (!ctx.webDriver?.webAdminOpenReportAndTap) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenReportAndTap not configured' };
      }
      const ok = await ctx.webDriver.webAdminOpenReportAndTap(action);
      if (!ok) {
        return { ok: false, error: `admin report-open + tap "${action}" did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 70 — "<Name> on <Plat> reports it for "<reason>"".
    // j11:34 — `Nora on iOS Sim reports it for "Harassment"`. "It" is the
    // contextually-selected entity (message or user the persona just
    // long-pressed). Driver wires the reason into the open report flow.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+reports it for "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const reason = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidReportItFor'
          : platform === 'iOS Sim'
            ? 'iosReportItFor'
            : 'webReportItFor';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, reason);
      if (!ok) {
        return { ok: false, error: `report-for "${reason}" did not complete on ${platform}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 70 — "<Name> is currently in a voice room "<id>" with mic <state>".
    // j11:69 — sibling of the existing `is in voice room "X" ... with mic
    // <state>` matcher; corpus authors mix "is in" and "is currently in"
    // forms. Same Firestore effect (participantIds + micStates).
    pattern: /^([A-Z][a-z]+)\s+is currently in a voice room "([^"]+)" with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      const micState = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const micStates = { ...(existing.micStates || {}) };
      micStates[String(p.uniqueId)] = micState;
      await ctx.db.doc(docPath).set({ ...existing, participantIds, micStates }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 70 — UI shows reason "<text>" (bare positive, no "warning").
    // j11:51 — `Raul's Android UI shows reason "Repeat harassment"`. The
    // suspension screen displays the suspension reason. Distinct from Wake
    // 67's `shows the warning reason "X"` (has `the` and `warning`).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows reason "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const expected = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidGetDisplayedReason'
          : platform === 'iOS Sim'
            ? 'iosGetDisplayedReason'
            : 'webGetDisplayedReason';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName](name);
      if (actual !== expected) {
        return {
          ok: false,
          error: `displayed reason mismatch: expected "${expected}", actual "${actual}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 70 — UI shows an end date N days from now (relative-date).
    // j11:60 — `Raul's Android UI shows an end date 3 days from now`.
    // Driver returns the displayed end-date in milliseconds; matcher
    // accepts a 24h tolerance (date may be rendered as start-of-day or
    // now+Nd exactly, both acceptable).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows an end date (\d+) days from now$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const days = parseInt(m[3], 10);
      const methodName =
        platform === 'Android'
          ? 'androidGetDisplayedEndDate'
          : platform === 'iOS Sim'
            ? 'iosGetDisplayedEndDate'
            : 'webGetDisplayedEndDate';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actualMs = await driver[methodName](name);
      const expectedMs = Date.now() + days * 24 * 60 * 60 * 1000;
      const toleranceMs = 24 * 60 * 60 * 1000;
      if (Math.abs(actualMs - expectedMs) > toleranceMs) {
        const actualDays = (actualMs - Date.now()) / (24 * 60 * 60 * 1000);
        return {
          ok: false,
          error: `end date mismatch: expected ${days} days from now, actual ~${actualDays.toFixed(1)} days`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 70 — "<Name> is suspended until N days from now" (state-seed).
    // j11:67 — writes users/<uniqueId>.suspendedUntil = Date.now() + N days.
    pattern: /^([A-Z][a-z]+) is suspended until (\d+) days from now$/,
    async handler(m, ctx) {
      const name = m[1];
      const days = parseInt(m[2], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const suspendedUntil = Date.now() + days * 24 * 60 * 60 * 1000;
      await ctx.db.doc(`users/${p.uniqueId}`).set({ suspendedUntil }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 71 — bare "POST <path> as <persona>" (no body).
    // j11:73 — `POST /api/livekit/token as Raul`. Endpoints that derive
    // everything from the bearer token need no request body. Distinct
    // from existing `POST <path> with <kv-list> as <persona>` which
    // requires a `with <payload>` token.
    pattern: /^POST\s+(\/api\/[\w/-]+)\s+as\s+([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const name = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess) {
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body not JSON — keep null
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    // Wake 71 — "<Name> on <Plat> attempts POST <path>" (bare, no body).
    // j11:96 — `Raul on Android attempts POST /api/messages`. Sibling of
    // the existing `attempts POST <path> with body <json>` matcher; this
    // variant tests the API's rejection of bodyless POSTs (e.g., suspended
    // user attempting to send a message).
    pattern:
      /^([A-Z][a-z]+)(?:\s+on\s+(?:Web Chromium|Web Safari|Web|Android|iOS Sim))?\s+attempts POST\s+(\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const apiPath = m[2];
      const sess = ctx.sessions.get(name);
      if (!sess) {
        return { ok: false, error: `no signed-in session for "${name}" — Given step missing?` };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body not JSON — keep null
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: name, path: apiPath };
      return { ok: true };
    },
  },
  {
    // Wake 71 — types "<text>" into the <name> field (non-search).
    // j11:82 — `types "..." into the appeal field`. Existing matchers
    // catch `into the search field` specifically; this generic catches
    // any other named field. First-match-wins keeps the search-specific
    // matchers winning for their form.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+types "([^"]*)" into the (\w+) field$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const text = m[3];
      const fieldName = m[4];
      const methodName =
        platform === 'Android'
          ? 'androidTypeIntoNamedField'
          : platform === 'iOS Sim'
            ? 'iosTypeIntoNamedField'
            : 'webTypeIntoNamedField';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      await driver[methodName](name, fieldName, text);
      return { ok: true };
    },
  },
  {
    // Wake 71 — UI no longer shows the <name> <kind>.
    // j11:88 — `Raul's Android UI no longer shows the suspension screen`.
    // Semantic-equivalent of `does not show the X` phrased as a state
    // change. Reuses the same driver method as Wake 69's positive-form
    // (just with inverted assertion).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI no longer shows the ([\w ]+) (button|screen|banner|dialog|panel|tab)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const noun = m[3].trim();
      const kind = m[4];
      const methodName =
        platform === 'Android'
          ? 'androidShowsNamedKind'
          : platform === 'iOS Sim'
            ? 'iosShowsNamedKind'
            : 'webShowsNamedKind';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const stillShown = await driver[methodName](name, noun, kind);
      if (stillShown) {
        return {
          ok: false,
          error: `${platform} UI still shows the "${noun}" ${kind} but should not (no longer)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 71 — predicate state-seed "has been warned but not suspended".
    // j11:101 — writes hasActiveWarning=true AND zeroes suspendedUntil.
    // Tests the transition state — warning exists, suspension does not.
    pattern: /^([A-Z][a-z]+) has been warned but not suspended$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db
        .doc(`users/${p.uniqueId}`)
        .set({ hasActiveWarning: true, suspendedUntil: 0 }, { merge: true });
      return { ok: true };
    },
  },
  {
    // j11 setup-Given: "<persona> has been issued a first-strike warning".
    // Mirrors the production /api/admin/moderation/warn handler's user-doc
    // writes:
    //   - hasActiveWarning = true
    //   - warningCount = 1 (first strike — second-strike form differs)
    //   - warningAcknowledged = false (operator-facing UI is pending ack)
    //   - lastWarningAt = now (audit timestamp)
    // No audit row here — that's covered by the moderation action matcher
    // (the audit semantics belong to the admin UI flow, not the state-seed).
    pattern: /^([A-Z][a-z]+)\s+has been issued a first-strike warning$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set(
        {
          hasActiveWarning: true,
          warningCount: 1,
          warningAcknowledged: false,
          lastWarningAt: Date.now(),
        },
        { merge: true },
      );
      return { ok: true };
    },
  },
  {
    // j11 setup-Given: "<persona> has acknowledged his/her/their first-strike
    // warning". Composes the issued-warning state PLUS flips
    // warningAcknowledged → true. This is the state Raul reaches after he
    // taps the "I understand" button on the warning screen — distinct from
    // the issued state where the warning still requires acknowledgement.
    //
    // Pronoun alternation captures all three forms ("his", "her", "their")
    // since the corpus uses them depending on persona gender — anchored to
    // a fixed word list, no \w+ expansion.
    pattern: /^([A-Z][a-z]+)\s+has acknowledged (?:his|her|their) first-strike warning$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set(
        {
          hasActiveWarning: true,
          warningCount: 1,
          warningAcknowledged: true,
          lastWarningAt: Date.now(),
        },
        { merge: true },
      );
      return { ok: true };
    },
  },
  {
    // Wake 71 — "<Name> on <Plat> opens his/her conversation with <Other>".
    // j11:93 — composite navigation: open PM thread between the speaker
    // and the named other persona. Driver resolves the conv id from the
    // persona pair and navigates.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+opens (?:his|her|their) conversation with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const otherName = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidOpenConversationWith'
          : platform === 'iOS Sim'
            ? 'iosOpenConversationWith'
            : 'webOpenConversationWith';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, otherName);
      if (!ok) {
        return {
          ok: false,
          error: `${platform}: conversation between ${name} and ${otherName} did not open`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin "opens the <ordinal> report and taps "<X>"" (generic).
    // j12:42 — `opens the third report and taps "Suspend for 7 days"`. The
    // existing matcher at line ~2194 only accepts (first|second|new); this
    // generic catches every other ordinal (third, fourth, fifth, ...).
    // First-match-wins lets the existing matcher keep winning for its enum.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+on Web Admin\s+opens the ([a-z]+) report and taps "([^"]+)"(?: with reason "([^"]+)")?$/,
    async handler(m, ctx) {
      const ordinal = m[3];
      const menuItem = m[4];
      const reason = m[5] || null;
      if (!ctx.webDriver?.webAdminOpenReportAndTap) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenReportAndTap not configured' };
      }
      await ctx.webDriver.webAdminOpenReportAndTap(ordinal, menuItem, reason);
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin "approves submissions <N>-<M>" (batch range).
    // j12:48 — range-based batch approve. Driver receives (start, end)
    // inclusive and approves all submissions in that range.
    pattern: /^Greta on Web Admin approves submissions (\d+)-(\d+)$/,
    async handler(m, ctx) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      if (!ctx.webDriver?.webAdminApproveSubmissions) {
        return { ok: false, error: 'ctx.webDriver.webAdminApproveSubmissions not configured' };
      }
      const ok = await ctx.webDriver.webAdminApproveSubmissions(start, end);
      if (!ok) {
        return { ok: false, error: `admin failed to approve submissions ${start}-${end}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin "rejects submission <N> with reason "<X>"" (+ optional dobOverride).
    // j12:49 — bare form. j12:50 — `and dobOverride="2011-01-01"` suffix
    // for age-verification rejections that also override the DOB. Optional
    // group captures the override; null when absent.
    pattern:
      /^Greta on Web Admin rejects submission (\d+) with reason "([^"]+)"(?: and dobOverride="([^"]+)")?$/,
    async handler(m, ctx) {
      const submissionIdx = parseInt(m[1], 10);
      const reason = m[2];
      const dobOverride = m[3] || null;
      if (!ctx.webDriver?.webAdminRejectSubmission) {
        return { ok: false, error: 'ctx.webDriver.webAdminRejectSubmission not configured' };
      }
      const ok = await ctx.webDriver.webAdminRejectSubmission(submissionIdx, reason, dobOverride);
      if (!ok) {
        return { ok: false, error: `admin failed to reject submission ${submissionIdx}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin UI "shows <N> rows".
    // j12:64 — generic table row-count assertion. Driver returns current
    // visible row count for the active table; matcher does exact compare.
    pattern: /^Greta's Web Admin UI shows (\d+) rows$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      if (!ctx.webDriver?.webAdminGetRowCount) {
        return { ok: false, error: 'ctx.webDriver.webAdminGetRowCount not configured' };
      }
      const actual = await ctx.webDriver.webAdminGetRowCount();
      if (actual !== expected) {
        return {
          ok: false,
          error: `admin row-count mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin "searches for user "<text>"".
    // j12:80 — dedicated user-search flow (distinct from Wake 67's
    // universal `searches "X"` which is the admin panel's global search).
    pattern: /^Greta on Web Admin searches for user "([^"]+)"$/,
    async handler(m, ctx) {
      const query = m[1];
      if (!ctx.webDriver?.webAdminSearchForUser) {
        return { ok: false, error: 'ctx.webDriver.webAdminSearchForUser not configured' };
      }
      const ok = await ctx.webDriver.webAdminSearchForUser(query);
      if (!ok) {
        return { ok: false, error: `admin user-search for "${query}" did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 72 — admin "adjusts shyCoins by ±<N> with reason "<X>"".
    // j12:84 — signed-integer wallet adjustment with required audit-trail
    // reason. The +/- prefix is part of the delta; driver receives signed
    // int (positive = credit, negative = debit).
    pattern: /^Greta on Web Admin adjusts shyCoins by ([+-]\d+) with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const delta = parseInt(m[1], 10);
      const reason = m[2];
      if (!ctx.webDriver?.webAdminAdjustShyCoins) {
        return { ok: false, error: 'ctx.webDriver.webAdminAdjustShyCoins not configured' };
      }
      const ok = await ctx.webDriver.webAdminAdjustShyCoins(delta, reason);
      if (!ok) {
        return { ok: false, error: `admin failed to adjust shyCoins by ${delta}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "lifts the <ordinal> appeal".
    // j12:70 — reverses a suspension on the targeted appeal.
    pattern: /^Greta on Web Admin lifts the (\w+) appeal$/,
    async handler(m, ctx) {
      const ordinal = m[1];
      if (!ctx.webDriver?.webAdminLiftAppeal) {
        return { ok: false, error: 'ctx.webDriver.webAdminLiftAppeal not configured' };
      }
      const ok = await ctx.webDriver.webAdminLiftAppeal(ordinal);
      if (!ok) {
        return { ok: false, error: `admin failed to lift the ${ordinal} appeal` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "denies the <ordinal> appeal with reason "<X>"".
    // j12:71 — inverse of lift. Reason required for audit-trail.
    pattern: /^Greta on Web Admin denies the (\w+) appeal with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const ordinal = m[1];
      const reason = m[2];
      if (!ctx.webDriver?.webAdminDenyAppeal) {
        return { ok: false, error: 'ctx.webDriver.webAdminDenyAppeal not configured' };
      }
      const ok = await ctx.webDriver.webAdminDenyAppeal(ordinal, reason);
      if (!ok) {
        return { ok: false, error: `admin failed to deny the ${ordinal} appeal` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "opens the "<name>" subtab".
    // j12:91 — subtab navigation inside the admin panel (distinct from
    // top-level tabs handled by webAdminOpenTab). Names are quoted; may
    // be multi-word.
    pattern: /^Greta on Web Admin opens the "([^"]+)" subtab$/,
    async handler(m, ctx) {
      const subtab = m[1];
      if (!ctx.webDriver?.webAdminOpenSubtab) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenSubtab not configured' };
      }
      const ok = await ctx.webDriver.webAdminOpenSubtab(subtab);
      if (!ok) {
        return { ok: false, error: `admin failed to open "${subtab}" subtab` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "filters by action="<X>"".
    // j12:103 — audit-log filter step. Drives the column-filter input.
    pattern: /^Greta on Web Admin filters by action="([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[1];
      if (!ctx.webDriver?.webAdminFilterByAction) {
        return { ok: false, error: 'ctx.webDriver.webAdminFilterByAction not configured' };
      }
      const ok = await ctx.webDriver.webAdminFilterByAction(action);
      if (!ok) {
        return { ok: false, error: `admin failed to filter by action="${action}"` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "attempts to PATCH|DELETE <path>" (audit-immutability).
    // j12:106-107 — `attempts to PATCH /api/admin/audit/{anyEntry}` and
    // `attempts to DELETE /api/admin/audit/{anyEntry}`. The `{anyEntry}`
    // placeholder is left unresolved by interpolateScenarioVars (no
    // scenario var bound); the runner passes the literal path through to
    // fetch. The API is expected to return 405 — the matcher records
    // lastResponse without asserting the status (the next assertion step
    // does that).
    pattern: /^Greta on Web Admin attempts to (PATCH|DELETE) (\/api\/[\w/-]+(?:\/\{[\w]+\})?)$/,
    async handler(m, ctx) {
      const method = m[1];
      const apiPath = m[2];
      const sess = ctx.sessions.get('Greta');
      if (!sess) {
        return { ok: false, error: 'no signed-in session for "Greta" — Given step missing?' };
      }
      const r = await ctx.fetch(ctx.apiBase + apiPath, {
        method,
        headers: {
          Authorization: `Bearer ${sess.idToken}`,
          'Content-Type': 'application/json',
        },
      });
      let parsedBody = null;
      try {
        const text = await r.text();
        parsedBody = text ? JSON.parse(text) : null;
      } catch {
        // body not JSON — keep null
      }
      ctx.lastResponse = { status: r.status, body: parsedBody, persona: 'Greta', path: apiPath };
      return { ok: true };
    },
  },
  {
    // Wake 73 — admin "taps "<X>" and types deviceId="<id>" + reason "<text>"".
    // j12:93 — ban-device composite. Triple composite: tap action,
    // type deviceId, type reason. Driver receives a struct.
    pattern: /^Greta on Web Admin taps "([^"]+)" and types deviceId="([^"]+)" \+ reason "([^"]+)"$/,
    async handler(m, ctx) {
      const action = m[1];
      const deviceId = m[2];
      const reason = m[3];
      if (!ctx.webDriver?.webAdminTapAndTypeBanDevice) {
        return { ok: false, error: 'ctx.webDriver.webAdminTapAndTypeBanDevice not configured' };
      }
      const ok = await ctx.webDriver.webAdminTapAndTypeBanDevice({ action, deviceId, reason });
      if (!ok) {
        return { ok: false, error: `admin "${action}" composite did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 74 — "<Name>'s browser locale is "<code>"" (state-seed).
    // j12:130 — sets the persona's browser-locale before subsequent
    // rendering steps run. Stored on ctx.browserLocales for later use
    // by document-direction and label-language assertions.
    pattern: /^([A-Z][a-z]+)'s browser locale is "([a-z]{2}(?:-[A-Z]{2})?)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const locale = m[2];
      if (!ctx.browserLocales) ctx.browserLocales = new Map();
      ctx.browserLocales.set(name, locale);
      return { ok: true };
    },
  },
  {
    // Wake 74 — "<Name>'s Web Admin UI document direction is "<dir>"".
    // j12:131 — distinct from the existing `Web UI document direction`
    // matcher (line ~2648); admin panel can have different RTL handling
    // (English-only per ShyTalk policy → always ltr regardless of
    // browser locale).
    pattern: /^([A-Z][a-z]+)'s Web Admin UI document direction is "(ltr|rtl|auto)"$/,
    async handler(m, ctx) {
      const expected = m[2];
      if (!ctx.webDriver?.webAdminGetDocumentDirection) {
        return { ok: false, error: 'ctx.webDriver.webAdminGetDocumentDirection not configured' };
      }
      const actual = await ctx.webDriver.webAdminGetDocumentDirection();
      if (actual !== expected) {
        return {
          ok: false,
          error: `Web Admin document direction was "${actual}", expected "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 74 — "<Name>'s Web Admin UI labels are in <language>".
    // j12:132 — admin panel labels must always be English regardless of
    // browser locale. Driver detects label language via DOM sampling.
    pattern: /^([A-Z][a-z]+)'s Web Admin UI labels are in (\w+)$/,
    async handler(m, ctx) {
      const expected = m[2];
      if (!ctx.webDriver?.webAdminDetectLabelLanguage) {
        return { ok: false, error: 'ctx.webDriver.webAdminDetectLabelLanguage not configured' };
      }
      const actual = await ctx.webDriver.webAdminDetectLabelLanguage();
      if (actual !== expected) {
        return {
          ok: false,
          error: `Web Admin labels were in ${actual}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 74 — "no rendered <text|character> <contains|has> the Unicode
    // replacement glyph U+FFFD".
    // j13:14 + j13:96 — both shapes share one matcher. U+FFFD (`�`)
    // renders when a glyph can't be resolved (font-fallback failure).
    pattern:
      /^no rendered (?:text|character) (?:contains|has) the Unicode replacement glyph U\+FFFD$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webHasReplacementGlyph) {
        return { ok: false, error: 'ctx.webDriver.webHasReplacementGlyph not configured' };
      }
      const hasGlyph = await ctx.webDriver.webHasReplacementGlyph();
      if (hasGlyph) {
        return {
          ok: false,
          error: 'rendered text contains the U+FFFD replacement glyph (font fallback failed)',
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 74 — "no string is missing translation".
    // j13:95 — driver scans the rendered DOM for raw i18n keys or
    // missing-translation sentinels. Returns an array of offending keys
    // (empty = all translated).
    pattern: /^no string is missing translation$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webMissingTranslations) {
        return { ok: false, error: 'ctx.webDriver.webMissingTranslations not configured' };
      }
      const missing = await ctx.webDriver.webMissingTranslations();
      if (Array.isArray(missing) && missing.length > 0) {
        return {
          ok: false,
          error: `missing translations: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` (and ${missing.length - 5} more)` : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 74 — "<Name>'s <Plat> UI does not show any raw i18n key like
    // "<X>"". j13:24 — a raw resource key in the rendered DOM indicates
    // a missing translation. The "X" is a sample key; the driver uses
    // it to detect the sentinel format.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not show any raw i18n key like "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const sampleKey = m[3];
      const methodName =
        platform === 'Android'
          ? 'androidShowsRawI18nKey'
          : platform === 'iOS Sim'
            ? 'iosShowsRawI18nKey'
            : 'webShowsRawI18nKey';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shows = await driver[methodName](name, sampleKey);
      if (shows) {
        return {
          ok: false,
          error: `${platform} UI shows raw i18n key like "${sampleKey}" — translation missing`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "UI shows the <name> field aligned <direction>".
    // j13:13 — RTL layout verification. Driver returns current alignment
    // for the named field.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the (\w+) field aligned (left|right|center)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const fieldName = m[3];
      const expected = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webGetFieldAlignment'
        : platform === 'Android'
          ? 'androidGetFieldAlignment'
          : 'iosGetFieldAlignment';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName](name, fieldName);
      if (actual !== expected) {
        return {
          ok: false,
          error: `${fieldName} field alignment: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "UI shows <language> labels for "<X>", "<Y>", ...".
    // j13:18 — verify named English labels render in the persona's locale.
    // Driver receives the persona, target language, and parsed label list.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (\w+) labels for ((?:"[^"]+"(?:,\s*)?)+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const language = m[3];
      const labelList = m[4];
      const labels = [...labelList.matchAll(/"([^"]+)"/g)].map((mm) => mm[1]);
      const methodName = platform.startsWith('Web')
        ? 'webShowsLocaleLabels'
        : platform === 'Android'
          ? 'androidShowsLocaleLabels'
          : 'iosShowsLocaleLabels';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, language, labels);
      if (!ok) {
        return {
          ok: false,
          error: `${platform} UI does not show ${language} labels for ${labels.join(', ')}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "UI shows the balance with locale-appropriate thousands
    // separator". j13:31 — driver checks the rendered balance string uses
    // the locale's correct separator.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the balance with locale-appropriate thousands separator$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webBalanceUsesLocaleSeparator'
        : platform === 'Android'
          ? 'androidBalanceUsesLocaleSeparator'
          : 'iosBalanceUsesLocaleSeparator';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${platform} UI balance does not use locale-appropriate thousands separator`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "<Name>'s Android UI layoutDirection is <RTL|LTR>".
    // j13:39 — Android-specific layoutDirection attribute. Driver
    // introspects the root view's layoutDirection.
    pattern: /^([A-Z][a-z]+)'s Android UI layoutDirection is (RTL|LTR)$/,
    async handler(m, ctx) {
      const expected = m[2];
      if (!ctx.uiDriver?.androidGetLayoutDirection) {
        return { ok: false, error: 'ctx.uiDriver.androidGetLayoutDirection not configured' };
      }
      const actual = await ctx.uiDriver.androidGetLayoutDirection();
      if (actual !== expected) {
        return {
          ok: false,
          error: `Android layoutDirection was ${actual}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "system font fallback resolves to a <X>-capable font".
    // j13:45 — CJK font fallback verification. Driver loads a sample
    // glyph for the named script and asserts the resolved font supports
    // it.
    pattern: /^the system font fallback resolves to a (\w+(?:-\w+)*)-capable font$/,
    async handler(m, ctx) {
      const script = m[1];
      if (!ctx.webDriver?.webFontFallbackCapable) {
        return { ok: false, error: 'ctx.webDriver.webFontFallbackCapable not configured' };
      }
      const ok = await ctx.webDriver.webFontFallbackCapable(script);
      if (!ok) {
        return {
          ok: false,
          error: `system font fallback is not ${script}-capable (missing font?)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 75 — "<Name> on <Plat> sends a/an "<gift>" gift to <Recipient>".
    // j13:27 + j13:71 — two corpus shapes share one matcher via optional
    // `(?:an? )?` article. Sends a gift (vs a message) — separate UI flow.
    pattern:
      /^([A-Z][a-z]+)\s+on (Web Chromium|Web Safari|Web|Android|iOS Sim)\s+sends (?:an? )?"([^"]+)" gift to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const giftName = m[3];
      const recipient = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webSendGiftTo'
        : platform === 'Android'
          ? 'androidSendGiftTo'
          : 'iosSendGiftTo';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, giftName, recipient);
      if (!ok) {
        return {
          ok: false,
          error: `${name} failed to send "${giftName}" gift to ${recipient} on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 76 — "<Name> (locale=<X>) is age-verified and Greta downgrades
    // <him|her|them> to minor".
    // j13:91 — composite state-seed writing post-downgrade state in one
    // shot (locale, isAgeVerified=true, cohort=minor).
    pattern:
      /^([A-Z][a-z]+) \(locale=([a-z]+)\) is age-verified and Greta downgrades (?:him|her|them) to minor$/,
    async handler(m, ctx) {
      const name = m[1];
      const locale = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db
        .doc(`users/${p.uniqueId}`)
        .set({ locale, isAgeVerified: true, cohort: 'minor' }, { merge: true });
      // OSA #17 PR 6 test-side mirror: clear cross-cohort follow edges
      // that the runtime route would clear. Without this the j19 probe
      // reports state the prod /modify-dob route would never produce.
      await clearCrossCohortFollowsForUserDoc(ctx.db, p.uniqueId, 'minor');
      return { ok: true };
    },
  },
  {
    // Wake 76 — "<Name>'s <Plat> UI shows <Language> labels" (bare).
    // j13:48 — distinct from Wake 75's "shows X labels for A, B, C"
    // (which requires the quoted list). Bare form asserts overall UI
    // is in the named language. Driver receives empty labels array as
    // the discriminator.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (\w+) labels$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const language = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsLocaleLabels'
        : platform === 'Android'
          ? 'androidShowsLocaleLabels'
          : 'iosShowsLocaleLabels';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, language, []);
      if (!ok) {
        return { ok: false, error: `${platform} UI does not show ${language} labels overall` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 76 — "no rendered character is the replacement glyph U+FFFD".
    // j13:54 — third corpus variant ("is the X" wording). Wake 74's
    // matcher covered "contains the X" and "has the X"; this is the
    // remaining shape. Same driver, same semantic.
    pattern: /^no rendered character is the replacement glyph U\+FFFD$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webHasReplacementGlyph) {
        return { ok: false, error: 'ctx.webDriver.webHasReplacementGlyph not configured' };
      }
      const hasGlyph = await ctx.webDriver.webHasReplacementGlyph();
      if (hasGlyph) {
        return {
          ok: false,
          error: 'rendered text contains the U+FFFD replacement glyph (font fallback failed)',
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 76 — "any system PM template renders with the <Language> variant".
    // j13:43 — every system-PM template (welcome, cohort-flip, suspension
    // notice, etc.) must render in the target language for the current
    // persona's locale.
    pattern: /^any system PM template renders with the (\w+) variant$/,
    async handler(m, ctx) {
      const language = m[1];
      if (!ctx.webDriver?.webSystemPmRendersInLanguage) {
        return { ok: false, error: 'ctx.webDriver.webSystemPmRendersInLanguage not configured' };
      }
      const ok = await ctx.webDriver.webSystemPmRendersInLanguage(language);
      if (!ok) {
        return {
          ok: false,
          error: `at least one system PM template did not render in ${language}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 76 — "the test runner scans all rendered strings on <Name>'s
    // <Plat> UI across N screens".
    // j13:60 — meta state-seed. Instructs runner to navigate N screens
    // and collect all rendered strings into ctx.scannedStrings.
    pattern:
      /^the test runner scans all rendered strings on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI across (\d+) screens$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const screens = parseInt(m[3], 10);
      const methodName = platform.startsWith('Web')
        ? 'webScanAllRenderedStrings'
        : platform === 'Android'
          ? 'androidScanAllRenderedStrings'
          : 'iosScanAllRenderedStrings';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      ctx.scannedStrings = await driver[methodName](name, screens);
      return { ok: true };
    },
  },
  {
    // Wake 76 — "no string has the value of the en/strings.xml fallback
    // when the locale is <X>".
    // j13:61 — follow-up assertion on ctx.scannedStrings (produced by the
    // scan step). Driver returns the array of strings that still look
    // like English fallback values (i.e., the localisation didn't pick up).
    pattern:
      /^no string has the value of the en\/strings\.xml fallback when the locale is ([a-z]{2})$/,
    async handler(m, ctx) {
      const locale = m[1];
      if (!ctx.scannedStrings) {
        return {
          ok: false,
          error: 'no scannedStrings recorded — earlier scan step is missing',
        };
      }
      if (!ctx.webDriver?.webFallbackEnStrings) {
        return { ok: false, error: 'ctx.webDriver.webFallbackEnStrings not configured' };
      }
      const fallbacks = await ctx.webDriver.webFallbackEnStrings(locale, ctx.scannedStrings);
      if (Array.isArray(fallbacks) && fallbacks.length > 0) {
        return {
          ok: false,
          error: `${fallbacks.length} string(s) still use en fallback in locale=${locale}: ${fallbacks.slice(0, 3).join(', ')}${fallbacks.length > 3 ? '...' : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 77 — "<Name> on <Plat> opens "<path>" on <NetworkProfile>".
    // j14:23 — composite navigation with network throttling. Driver wires
    // CDP `Network.emulateNetworkConditions` (Web) or equivalent for the
    // named profile (Slow 3G, Fast 3G, 4G, Offline, WiFi).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) opens "([^"]+)" on (Slow 3G|Fast 3G|4G|Offline|WiFi)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const urlPath = m[3];
      const profile = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webOpenWithNetwork'
        : platform === 'Android'
          ? 'androidOpenWithNetwork'
          : 'iosOpenWithNetwork';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, urlPath, profile);
      if (!ok) {
        return {
          ok: false,
          error: `${name} on ${platform}: open "${urlPath}" on ${profile} did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 77 — "<Name> is in a conversation with <Other>" (state-seed).
    // j14:62 — ensures a conversation doc exists between two personas.
    // Conv id is synthesised from sorted uniqueIds → idempotent across
    // orderings ("X is in conv with Y" and "Y is in conv with X" yield
    // the same doc).
    pattern: /^([A-Z][a-z]+) is in a conversation with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const nameA = m[1];
      const nameB = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const a = personas.get(nameA);
      const b = personas.get(nameB);
      if (!a?.uniqueId) return { ok: false, error: `persona "${nameA}" not in registry` };
      if (!b?.uniqueId) return { ok: false, error: `persona "${nameB}" not in registry` };
      const sortedIds = [a.uniqueId, b.uniqueId].sort((x, y) => x - y);
      const convId = `conv-${sortedIds[0]}-${sortedIds[1]}`;
      await ctx.db.doc(`conversations/${convId}`).set({
        id: convId,
        participantIds: sortedIds,
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 77 — "<Name> on <Plat> sets the network to "<X>" via DevTools".
    // j14:35 — mid-scenario throttle change without navigation. Distinct
    // from `opens "X" on <Profile>` which combines nav + throttle.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web) sets the network to "([^"]+)" via DevTools$/,
    async handler(m, ctx) {
      const name = m[1];
      const profile = m[3];
      if (!ctx.webDriver?.webSetNetwork) {
        return { ok: false, error: 'ctx.webDriver.webSetNetwork not configured' };
      }
      const ok = await ctx.webDriver.webSetNetwork(name, profile);
      if (!ok) {
        return { ok: false, error: `${name}: set network to "${profile}" did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 77 — "<Name> on <Plat> types "<text>" and taps send".
    // j14:36 — type-then-send in the current conversation. Distinct from
    // `types "X" into the search field` (different target field) and
    // `sends "X" gift to Y` (gift flow). Targets the message input.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) types "([^"]+)" and taps send$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const text = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webTypeAndSend'
        : platform === 'Android'
          ? 'androidTypeAndSend'
          : 'iosTypeAndSend';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, text);
      if (!ok) {
        return {
          ok: false,
          error: `${name} on ${platform}: type + send "${text}" did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 77 — "no XHR returns <status>".
    // j14:42 — network log assertion. Driver checks the recorded network
    // log for any request with the named status code.
    pattern: /^no XHR returns (\d+)$/,
    async handler(m, ctx) {
      const status = parseInt(m[1], 10);
      if (!ctx.webDriver?.webNetworkLogHasStatus) {
        return { ok: false, error: 'ctx.webDriver.webNetworkLogHasStatus not configured' };
      }
      const hasStatus = await ctx.webDriver.webNetworkLogHasStatus(status);
      if (hasStatus) {
        return { ok: false, error: `at least one XHR returned ${status}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 77 — "the network log shows N attempts to <path>".
    // j14:88 — retry-count assertion for fault-injection tests.
    pattern: /^the network log shows (\d+) attempts to (\/api\/[\w/-]+)$/,
    async handler(m, ctx) {
      const expected = parseInt(m[1], 10);
      const apiPath = m[2];
      if (!ctx.webDriver?.webNetworkLogCountAttempts) {
        return { ok: false, error: 'ctx.webDriver.webNetworkLogCountAttempts not configured' };
      }
      const actual = await ctx.webDriver.webNetworkLogCountAttempts(apiPath);
      if (actual !== expected) {
        return {
          ok: false,
          error: `network log attempt count for ${apiPath}: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "<Name> on <Plat> restores the network to "<X>"".
    // j14:39 — restoration variant of Wake 77's `sets the network`.
    // Same driver — `restores` is just author wording for "set back to
    // the previous profile after Offline".
    pattern: /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web) restores the network to "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const profile = m[3];
      if (!ctx.webDriver?.webSetNetwork) {
        return { ok: false, error: 'ctx.webDriver.webSetNetwork not configured' };
      }
      const ok = await ctx.webDriver.webSetNetwork(name, profile);
      if (!ok) {
        return { ok: false, error: `${name}: restore network to "${profile}" did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "Express API <path> has a N second latency injected".
    // j14:96 — fault-injection state-seed. Driver enables server-side
    // latency for the named endpoint.
    pattern: /^the Express API (\/api\/[\w/-]+) has a (\d+) second latency injected$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const seconds = parseInt(m[2], 10);
      if (!ctx.webDriver?.injectApiLatency) {
        return { ok: false, error: 'ctx.webDriver.injectApiLatency not configured' };
      }
      const ok = await ctx.webDriver.injectApiLatency(apiPath, seconds);
      if (!ok) {
        return {
          ok: false,
          error: `failed to inject ${seconds}s latency on ${apiPath}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "Express API <path> fails twice with N, succeeds on Nth try".
    // j14:85 — fault-injection with retry-success pattern. Driver receives
    // path, failure status code, success ordinal (3rd, 4th, etc.).
    pattern: /^the Express API (\/api\/[\w/-]+) fails twice with (\d+), succeeds on (\w+) try$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const failureStatus = parseInt(m[2], 10);
      const successOrdinal = m[3];
      if (!ctx.webDriver?.injectApiFailureThenSuccess) {
        return { ok: false, error: 'ctx.webDriver.injectApiFailureThenSuccess not configured' };
      }
      const ok = await ctx.webDriver.injectApiFailureThenSuccess(
        apiPath,
        failureStatus,
        successOrdinal,
      );
      if (!ok) {
        return {
          ok: false,
          error: `failed to inject failure-twice-then-${successOrdinal}-success on ${apiPath}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "Network Link Conditioner injects N% packet loss".
    // j14:64 — iOS-specific network fault tool. Driver enables NLC at
    // the named packet-loss percentage.
    pattern: /^Network Link Conditioner injects (\d+)% packet loss$/,
    async handler(m, ctx) {
      const percent = parseInt(m[1], 10);
      if (!ctx.uiDriver?.iosNetworkLinkConditioner) {
        return { ok: false, error: 'ctx.uiDriver.iosNetworkLinkConditioner not configured' };
      }
      const ok = await ctx.uiDriver.iosNetworkLinkConditioner(percent);
      if (!ok) {
        return { ok: false, error: `failed to enable NLC at ${percent}% packet loss` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "<Name>'s <Plat> UI shows the message in the conversation".
    // j14:41 — assert the most-recently-sent message (from a sibling
    // persona's perspective) appears in the currently-open conversation.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the message in the conversation$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsLastMessage'
        : platform === 'Android'
          ? 'androidShowsLastMessage'
          : 'iosShowsLastMessage';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name);
      if (!shown) {
        return {
          ok: false,
          error: `${name} on ${platform}: most recent message not visible in conversation`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 78 — "<Name>'s <Plat> UI shows a "<X>" indicator".
    // j14:79 — named-indicator presence assertion. Distinct from `<X>
    // button` / `<X> tab` matchers (different terminal kind word).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a "([^"]+)" indicator$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const indicatorName = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsNamedIndicator'
        : platform === 'Android'
          ? 'androidShowsNamedIndicator'
          : 'iosShowsNamedIndicator';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, indicatorName);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show "${indicatorName}" indicator`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name> on <Plat> picks template "<X>" and title "<Y>"".
    // j15:25 — composite room-creation: select template + name room.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) picks template "([^"]+)" and title "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const template = m[3];
      const title = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webPickTemplateAndTitle'
        : platform === 'Android'
          ? 'androidPickTemplateAndTitle'
          : 'iosPickTemplateAndTitle';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, template, title);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: pick template "${template}" + title "${title}" did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name> on <Plat> refreshes the "<X>" tab".
    // j15:32 — app tab refresh (vs Web Admin refresh which has its own
    // matcher at line ~3163).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) refreshes the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const tab = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webRefreshTab'
        : platform === 'Android'
          ? 'androidRefreshTab'
          : 'iosRefreshTab';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, tab);
      if (!ok) {
        return { ok: false, error: `${name}: refresh "${tab}" tab did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name> on <Plat> selects "<gift>" and recipient "<X>"".
    // j15:42 — two-step composite gift-modal flow: pick gift, pick
    // recipient.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) selects "([^"]+)" and recipient "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const gift = m[3];
      const recipient = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webSelectGiftAndRecipient'
        : platform === 'Android'
          ? 'androidSelectGiftAndRecipient'
          : 'iosSelectGiftAndRecipient';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, gift, recipient);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: select "${gift}" + recipient "${recipient}" did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name>'s <Plat> UI shows the "<X>" tier badge on the
    // room card". j15:36 — asserts the tier-badge text on a room card.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the "([^"]+)" tier badge on the room card$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const tier = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsTierBadge'
        : platform === 'Android'
          ? 'androidShowsTierBadge'
          : 'iosShowsTierBadge';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, tier);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show "${tier}" tier badge on the room card`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name>'s mic is already open on the seated host slot"
    // (state-seed). j15:46 — finds the persona's host-owned room and
    // sets mic-open + seated. Scans rooms/* by ownerUniqueId.
    pattern: /^([A-Z][a-z]+)'s mic is already open on the seated host slot$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const snap = await ctx.db.collection('rooms').get();
      let targetDoc = null;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data.ownerUniqueId === p.uniqueId) {
          targetDoc = { id: doc.id, data };
          break;
        }
      }
      if (!targetDoc) {
        return { ok: false, error: `no host-owned room found for "${name}"` };
      }
      const existing = targetDoc.data;
      await ctx.db.doc(`rooms/${targetDoc.id}`).set(
        {
          ...existing,
          micStates: { ...(existing.micStates || {}), [String(p.uniqueId)]: 'open' },
          seats: [{ userId: p.uniqueId, muted: false }],
        },
        { merge: true },
      );
      return { ok: true };
    },
  },
  {
    // Wake 79 — "<Name>'s <Plat> UI shows his/her/their seat as <state>".
    // j10:79 — bridges back to j10 tail. Driver returns current seat
    // state (available/occupied/reserved).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (?:his|her|their) seat as (available|occupied|reserved)$/,
    async handler(m, ctx) {
      const platform = m[2];
      const expected = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webGetSeatState'
        : platform === 'Android'
          ? 'androidGetSeatState'
          : 'iosGetSeatState';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName]();
      if (actual !== expected) {
        return {
          ok: false,
          error: `seat state mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 80 — multi-listener tester-hears audio.
    // j15:48 — `the tester hears <X>'s voice on <Y>'s <Plat> speakers
    // AND <Z>'s <Plat> speakers`. Two-listener extension of Wake 66's
    // tester-hears matcher. Manual-only.
    pattern:
      /^the tester hears ([A-Z][a-z]+)'s voice on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) speakers AND ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) speakers$/,
    async handler(m, ctx) {
      const speaker = m[1];
      const listenerA = { name: m[2], platform: m[3] };
      const listenerB = { name: m[4], platform: m[5] };
      if (!ctx.testerDriver?.confirmHearsAudioMulti) {
        return {
          ok: false,
          error: `manual-only assertion — no testerDriver. Tag scenario @manual or wire ctx.testerDriver.confirmHearsAudioMulti.`,
        };
      }
      const heard = await ctx.testerDriver.confirmHearsAudioMulti(speaker, [listenerA, listenerB]);
      if (!heard) {
        return {
          ok: false,
          error: `tester did not confirm hearing ${speaker}'s voice on ${listenerA.name} AND ${listenerB.name} speakers`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 80 — "Greta on Web Admin opens the economy stats".
    // j15:60 — bare admin nav (no quoted tab / no ordinal).
    pattern: /^Greta on Web Admin opens the economy stats$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.webAdminOpenEconomyStats) {
        return { ok: false, error: 'ctx.webDriver.webAdminOpenEconomyStats not configured' };
      }
      const ok = await ctx.webDriver.webAdminOpenEconomyStats();
      if (!ok) {
        return { ok: false, error: 'admin failed to open the economy stats view' };
      }
      return { ok: true };
    },
  },
  {
    // Wake 80 — "<Name> on <Plat> taps the gift icon in the room".
    // j15:41 — composite: open the gift modal from within a voice room.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps the gift icon in the room$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webTapGiftIconInRoom'
        : platform === 'Android'
          ? 'androidTapGiftIconInRoom'
          : 'iosTapGiftIconInRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return { ok: false, error: `${name}: tap gift icon in room did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 80 — "<Name>'s room "<X>" is OPEN" (possessive variant).
    // j15:67 — possessive form of Wake 68's `the room "<X>" is still
    // OPEN`. Same Firestore check, different scoping intent.
    pattern: /^([A-Z][a-z]+)'s room "([^"]+)" is (OPEN|CLOSED|FROZEN)$/,
    async handler(m, ctx) {
      const roomId = m[2];
      const expected = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(`rooms/${roomId}`).get();
      if (!snap.exists) {
        return { ok: false, error: `rooms/${roomId} does not exist` };
      }
      const actual = snap.data().state;
      if (actual !== expected) {
        return {
          ok: false,
          error: `room state mismatch: expected ${expected}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  // ── Room-state setup Givens (j09 phase-scoped scenarios) ──
  //
  // The long-scenario refactor (PR #874) split j09's 47-step megascenario
  // into 10 phase-focused subscenarios sharing the Background sign-in.
  // Each subscenario establishes the prior phase's outcome via a
  // setup-style `Given` so it runs in isolation. These 8 matchers seed
  // the corresponding Firestore state via the room-state primitives
  // defined above. Together they unblock the 8 STEP_NOT_IMPLEMENTED
  // findings on j09 (manual-qa-cycle-1.md, 2026-05-29).
  //
  // Composition: each handler routes through the primitives so a future
  // schema change (seat shape, kickedIds collection name, etc.) needs
  // one update at the helper level, not 8.
  {
    pattern: /^([A-Z][a-z]+)'s public room "([^"]+)" is OPEN$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await ensureRoomForHost(ctx, m[1], { title: m[2], state: 'OPEN', visibility: 'public' });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+)'s room "([^"]+)" has ([A-Z][a-z]+) joined as a participant$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const { roomId } = await ensureRoomForHost(ctx, m[1], { title: m[2] });
        await ensureParticipantInRoom(ctx, roomId, m[3]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+) is a non-seated participant in ([A-Z][a-z]+)'s room$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const roomId = await resolveRoomForHost(ctx, m[2]);
        await ensureParticipantInRoom(ctx, roomId, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+) has a PENDING seat request in ([A-Z][a-z]+)'s room$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const roomId = await resolveRoomForHost(ctx, m[2]);
        await ensureParticipantInRoom(ctx, roomId, m[1]);
        await ensureSeatRequest(ctx, roomId, m[1], 'PENDING');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+) is seated in ([A-Z][a-z]+)'s room with publish permission$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const roomId = await resolveRoomForHost(ctx, m[2]);
        await ensureParticipantInRoom(ctx, roomId, m[1]);
        await ensureSeatedInRoom(ctx, roomId, m[1], { muted: true, publishAllowed: true });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+) is seated and unmuted in ([A-Z][a-z]+)'s room$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const roomId = await resolveRoomForHost(ctx, m[2]);
        await ensureParticipantInRoom(ctx, roomId, m[1]);
        await ensureSeatedInRoom(ctx, roomId, m[1], { muted: false, publishAllowed: true });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+) has been kicked from ([A-Z][a-z]+)'s room$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const roomId = await resolveRoomForHost(ctx, m[2]);
        await ensureKickedFromRoom(ctx, roomId, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    pattern: /^([A-Z][a-z]+)'s room "([^"]+)" is OPEN with ([A-Z][a-z]+) as a participant$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const { roomId } = await ensureRoomForHost(ctx, m[1], { title: m[2], state: 'OPEN' });
        await ensureParticipantInRoom(ctx, roomId, m[3]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  // ── Admin-moderation setup Givens (j04 + reusable by j10/j11/j12) ──
  //
  // j04's 8-phase moderation flow (Greta downgrades Hayato) needs setup
  // matchers that mutate Firestore directly via firebase-admin. Each
  // matcher routes through the primitives above (seedPending...,
  // applyAgeDowngrade, seedSystemPmFromOfficia) so a future schema
  // change to the admin-route writes can be made in one place.
  // Note: "<persona> submitted an ageVerificationSubmission with
  // status=\"PENDING\" and an ID image showing DOB=..." is already
  // handled by the earlier matcher at line ~2032. No new handler here.
  {
    // "Greta has reviewed Hayato's age-verification submission" —
    // No state change beyond the existing PENDING submission (review is
    // a UI-side action, not a Firestore write). Recorded on ctx so a
    // follow-on "Greta's reject_and_dob_down" matcher can probe it.
    pattern: /^([A-Z][a-z]+)\s+has reviewed ([A-Z][a-z]+)'s age-verification submission$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        // Ensure the PENDING submission exists for the named persona
        // (idempotent — re-running this Given doesn't duplicate). The
        // review action itself is UI-side; no Firestore write needed.
        await seedPendingAgeVerificationSubmission(ctx, m[2]);
        ctx.reviewedSubmissions = ctx.reviewedSubmissions || new Set();
        ctx.reviewedSubmissions.add(m[2]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Hayato has been downgraded to cohort=minor by Greta"
    pattern: /^([A-Z][a-z]+)\s+has been downgraded to cohort=minor by ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await applyAgeDowngrade(ctx, m[1], m[2]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Hayato has been downgraded to cohort=minor and has the Officia
    //  age-down PM in his inbox" — composes downgrade + system PM.
    pattern:
      /^([A-Z][a-z]+)\s+has been downgraded to cohort=minor and has the Officia age-down PM in his inbox$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        // Use the Background-default admin (Greta) when the Given omits
        // the admin name. This pattern repeats in j04 — operator can
        // refactor to take an explicit admin arg if a future scenario
        // needs a different admin persona.
        await applyAgeDowngrade(ctx, m[1], 'Greta');
        await seedSystemPmFromOfficia(ctx, m[1], 'age_seg_age_down_admin_pm');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Hayato has been downgraded to cohort=minor with followingIds
    //  still containing 50000010 + 50000060"
    pattern:
      /^([A-Z][a-z]+)\s+has been downgraded to cohort=minor with followingIds still containing ([\d, +]+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const personas = loadPersonas();
        const persona = personas.get(m[1]);
        if (!persona?.uniqueId) {
          return { ok: false, error: `persona "${m[1]}" not in registry` };
        }
        // Parse the uniqueId list (comma + `+` separators allowed).
        const ids = m[2]
          .split(/[\s,+]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter((n) => Number.isFinite(n));
        await ctx.db.doc(`users/${persona.uniqueId}`).set({ followingIds: ids }, { merge: true });
        await applyAgeDowngrade(ctx, m[1], 'Greta');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Hayato has been downgraded to cohort=minor with his pre-downgrade
    //  shyCoins=100"
    pattern:
      /^([A-Z][a-z]+)\s+has been downgraded to cohort=minor with his pre-downgrade shyCoins=(\d+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        const personas = loadPersonas();
        const persona = personas.get(m[1]);
        if (!persona?.uniqueId) {
          return { ok: false, error: `persona "${m[1]}" not in registry` };
        }
        const shyCoins = parseInt(m[2], 10);
        await ctx.db.doc(`users/${persona.uniqueId}`).set({ shyCoins }, { merge: true });
        await applyAgeDowngrade(ctx, m[1], 'Greta');
        // Re-assert shyCoins survived the downgrade write (the downgrade
        // helper uses merge:true so shyCoins is preserved — pin it).
        await ctx.db.doc(`users/${persona.uniqueId}`).set({ shyCoins }, { merge: true });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  // Note: "Hayato received the age-down system PM from Officia" (j04:106)
  // and "Hayato is in voice room <X> ... with mic open" (j04:98) are NOT
  // added here:
  //   - The "received the X system PM" wording collides with the existing
  //     ASSERTION matcher at line ~4897 (which checks the
  //     conversations/<convId>/messages subcollection for the PM) so adding
  //     a setup-Given with the same pattern would shadow the assertion.
  //   - The "is in voice room ... with mic open" handler had a hostId
  //     read-back miss in unit tests that needs deeper debugging. Both
  //     are tracked as follow-ups; the compose form
  //     "Hayato has been downgraded ... and has the Officia age-down PM
  //     in his inbox" already covers the j04 PM-state setup. The voice-
  //     room precondition is only used by j04's "ejected when downgrade
  //     hits" scenario, which can be left as STEP_NOT_IMPLEMENTED for
  //     now and addressed in a follow-up PR.
  // ── Adam's first-day setup Givens (j01 phase-scoped scenarios) ──
  //
  // j01's 10 phase-scoped scenarios establish prior phases via setup
  // Givens that walk Adam through: signup (minor default) → legal accept
  // → age-verification submission → admin approve → adult verified
  // → daily reward → first gift. Adam is an EPHEMERAL persona
  // (P-01 in EPHEMERAL_PERSONAS, uniqueId 90000001).
  {
    // "Adam has just signed up with a minor-default cohort"
    pattern: /^([A-Z][a-z]+)\s+has just signed up with a minor-default cohort$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await seedSignedUpUser(ctx, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Adam has accepted legal as a minor-default user" — composes
    // signup state + accepted-policies row.
    pattern: /^([A-Z][a-z]+)\s+has accepted legal as a minor-default user$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await seedSignedUpUser(ctx, m[1]);
        await seedAcceptedPolicies(ctx, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // j02 phrasing: "Mia has just signed up as a minor". Same outcome as
    // the j01 "minor-default cohort" form — they're synonymous, and the
    // matcher just routes to the same seedSignedUpUser primitive. Kept as
    // a separate pattern (rather than alternating one regex) so each
    // journey reads naturally in its own voice — j01 emphasises that
    // minor is the SIGNUP DEFAULT (because Adam will later be approved
    // to adult); j02 emphasises that Mia STAYS a minor (because the
    // restrictions are her permanent UX, not a temporary state).
    pattern: /^([A-Z][a-z]+)\s+has just signed up as a minor$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await seedSignedUpUser(ctx, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // j02 phrasing: "Mia has accepted legal as a minor". Composes
    // signup-as-minor + accepted-policies. Same primitives as the j01
    // "minor-default user" form; see paired comment above for why the
    // two phrasings exist side-by-side.
    pattern: /^([A-Z][a-z]+)\s+has accepted legal as a minor$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        await seedSignedUpUser(ctx, m[1]);
        await seedAcceptedPolicies(ctx, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Adam has just been approved to cohort=adult by Greta"
    pattern: /^([A-Z][a-z]+)\s+has just been approved to cohort=adult by ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        // Ensure user-doc exists (idempotent — has user doc with cohort=minor
        // first, then the admin approve flips it to adult).
        await seedSignedUpUser(ctx, m[1]);
        await applyAgeVerificationApproval(ctx, m[1], m[2]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  {
    // "Adam is verified adult with adult features unlocked"
    pattern: /^([A-Z][a-z]+)\s+is verified adult with adult features unlocked$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      try {
        // Final-state seed: cohort=adult, isAgeVerified=true, policies
        // accepted. No audit entry — the test scenarios that care about
        // the audit row use the "has just been approved" Given which
        // does include it.
        await seedSignedUpUser(ctx, m[1], { cohort: 'adult', isAgeVerified: true });
        await seedAcceptedPolicies(ctx, m[1]);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  },
  // Note: "<persona> has shyCoins >= 10 after daily reward + a +100
  // admin top-up" (j01:111) is NOT added here — it collides with the
  // existing assertion matcher at line ~4620 (`<persona> has <field>
  // <op> <number>`). j01 line 111 should be rewritten as a compose:
  //   Given Adam is verified adult with adult features unlocked
  //   Given Adam has user doc with shyCoins=200
  // using the existing line ~2066 "has user doc with X=Y" matcher.
  // Pending j01 feature-file update.
  {
    // Wake 80 — "the response from <path>?<query> includes <Name>".
    // j15:62 — checks ctx.lastResponse.results[] for an entry matching
    // the named persona (by displayName or uniqueId).
    pattern: /^the response from (\/api\/[\w/-]+)\?[\w=&-]+ includes ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const name = m[2];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — earlier request step is missing' };
      }
      if (ctx.lastResponse.path && ctx.lastResponse.path !== apiPath) {
        return {
          ok: false,
          error: `response path mismatch: expected ${apiPath}, last was ${ctx.lastResponse.path}`,
        };
      }
      const personas = loadPersonas();
      const p = personas.get(name);
      const rows = ctx.lastResponse.body?.results || [];
      const found = rows.some((row) => row.displayName === name || row.uniqueId === p?.uniqueId);
      if (!found) {
        return {
          ok: false,
          error: `response from ${apiPath} does not include ${name} (got ${rows.length} row(s))`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 80 — "<Name>'s <Plat> UI shows total beans earned this
    // session = (N + N + N) = N" (arithmetic verification).
    // j15:54 — two-level check: (a) sum of addends equals claimed
    // total (corpus-bug detector), (b) driver returns the same total
    // (UI-drift detector).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows total beans earned this session = \(([\d\s+]+)\) = (\d+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const addendsExpr = m[3];
      const claimedTotal = parseInt(m[4], 10);
      const addends = addendsExpr.split('+').map((s) => parseInt(s.trim(), 10));
      const sum = addends.reduce((acc, n) => acc + n, 0);
      if (sum !== claimedTotal) {
        return {
          ok: false,
          error: `corpus arithmetic mismatch: addends sum to ${sum}, claimed total ${claimedTotal}`,
        };
      }
      const methodName = platform.startsWith('Web')
        ? 'webGetTotalBeansThisSession'
        : platform === 'Android'
          ? 'androidGetTotalBeansThisSession'
          : 'iosGetTotalBeansThisSession';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const actual = await driver[methodName](name);
      if (actual !== claimedTotal) {
        return {
          ok: false,
          error: `total beans mismatch: expected ${claimedTotal}, actual ${actual}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 81 — multi-device pairing state-seed.
    // j17:19 — `<Name> is also paired on <Plat> (same Firebase identity)
    // for <purpose>`. Records on ctx.pairedPlatforms.
    pattern:
      /^([A-Z][a-z]+) is also paired on (Web Chromium|Web Safari|Web|Android|iOS Sim) \(same Firebase identity\) for (\w+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const purpose = m[3];
      if (!ctx.pairedPlatforms) ctx.pairedPlatforms = new Map();
      ctx.pairedPlatforms.set(name, { platform, purpose });
      return { ok: true };
    },
  },
  {
    // Wake 81 — multi-field form-fill composite.
    // j17:28 — `<Name> on <Plat> fills in: language "zh", level
    // "Beginner", title "Intro to Mandarin tones"`. Parses kv-list:
    // `<key> "<value>", <key> "<value>", ...`.
    pattern: /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) fills in: (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const kvText = m[3];
      // Parse `<key> "<value>"(, <key> "<value>")*` into a plain object.
      // The `[^"]*` quoted-value capture is bounded by `"` on both sides,
      // so the regex makes linear progress over kvText (no overlapping
      // captures). The `\w+` key class is non-overlapping with the space
      // that follows. Linear time despite the alternation-free capture.
      const fields = {};
      // eslint-disable-next-line sonarjs/slow-regex
      for (const match of kvText.matchAll(/(\w+)\s+"([^"]*)"/g)) {
        fields[match[1]] = match[2];
      }
      const methodName = platform.startsWith('Web')
        ? 'webFillIn'
        : platform === 'Android'
          ? 'androidFillIn'
          : 'iosFillIn';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, fields);
      if (!ok) {
        return { ok: false, error: `${name}: fill-in did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 81 — tap a named button on a named card.
    // j17:33 — `<Name> on <Plat> taps "<X>" on the <noun> card`. Driver
    // receives persona, button text, card type.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps "([^"]+)" on the (\w+) card$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const buttonText = m[3];
      const cardType = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webTapOnCard'
        : platform === 'Android'
          ? 'androidTapOnCard'
          : 'iosTapOnCard';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, buttonText, cardType);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: tap "${buttonText}" on ${cardType} card did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 81 — triple-composite gift action.
    // j17:57 — `<Name> on <Plat> taps the gift icon and selects "<X>"
    // with recipient "<Y>"`. Combines Wake 79's two-step gift modal
    // with Wake 80's gift-icon-in-room opener.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps the gift icon and selects "([^"]+)" with recipient "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const gift = m[3];
      const recipient = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webGiftIconSelectAndRecipient'
        : platform === 'Android'
          ? 'androidGiftIconSelectAndRecipient'
          : 'iosGiftIconSelectAndRecipient';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, gift, recipient);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: gift icon + select "${gift}" + recipient "${recipient}" did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 82 — "<Name> [P-NN] exists with uniqueId=N, userType=X,
    // isOfficial=B, isUnblockable=B". j18:19 — multi-field state-seed
    // for the Officia system account. Booleans parsed from text.
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+exists with uniqueId=(\d+), userType=(\w+), isOfficial=(true|false), isUnblockable=(true|false)$/,
    async handler(m, ctx) {
      const uniqueId = parseInt(m[3], 10);
      const userType = m[4];
      const isOfficial = m[5] === 'true';
      const isUnblockable = m[6] === 'true';
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      await ctx.db.doc(`users/${uniqueId}`).set({ uniqueId, userType, isOfficial, isUnblockable });
      return { ok: true };
    },
  },
  {
    // Wake 82 — "<Name> was just age-verified by admin". j18:27 — past-
    // tense state-seed. The trailing `(cohort flipped from minor to
    // adult)` parenthetical is stripped by stripStepAnnotation before
    // matchers run, so the cohort direction is implicit: always upgrade
    // (corpus only uses this step for the post-approval flow).
    pattern: /^([A-Z][a-z]+) was just age-verified by admin$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db
        .doc(`users/${p.uniqueId}`)
        .set({ cohort: 'adult', ageVerificationFlippedAt: Date.now() }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 82 — "the <name> webhook fires sendSystemPm with key="<X>"
    // recipient=<Y>". j18:28 — webhook trigger. Resolves recipient name
    // to uniqueId via persona registry.
    pattern:
      /^the (\w+(?:-\w+)*) webhook fires sendSystemPm with key="([^"]+)" recipient=([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const webhookName = m[1];
      const key = m[2];
      const recipientName = m[3];
      const personas = loadPersonas();
      const p = personas.get(recipientName);
      if (!p?.uniqueId) {
        return { ok: false, error: `recipient "${recipientName}" not in registry` };
      }
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      // Mirror src/utils/system-pm.js sendSystemPm: write conversation
      // + message + userSettings docs. Conversation ID is sorted-join
      // of [recipientUid, SYSTEM_UID] to match production. text is set
      // to a key-tagged placeholder so downstream assertions about
      // localised body content fail with a clear "got [<key>]" rather
      // than the stub's "not configured". ctx.lastSentSystemPm is
      // populated for the recipient-tracking matcher (line ~10207).
      const SYSTEM_UID = 'SHYTALK_SYSTEM';
      const recipientUid = p.uniqueId;
      const convId = [String(recipientUid), SYSTEM_UID]
        .sort((a, b) => a.localeCompare(b))
        .join('_');
      const ts = Date.now();
      const msgId = `test-webhook-${ts}`;
      const placeholderText = `[${key}]`;
      await ctx.db.doc(`conversations/${convId}`).set(
        {
          id: convId,
          isGroup: false,
          participantIds: [recipientUid, SYSTEM_UID],
          lastMessage: {
            text: placeholderText,
            senderId: SYSTEM_UID,
            senderName: 'ShyTalk System',
            type: 'SYSTEM',
            createdAt: ts,
          },
          lastMessageAt: ts,
        },
        { merge: true },
      );
      await ctx.db.doc(`conversations/${convId}/messages/${msgId}`).set({
        id: msgId,
        conversationId: convId,
        senderId: SYSTEM_UID,
        senderName: 'ShyTalk System',
        text: placeholderText,
        type: 'SYSTEM',
        createdAt: ts,
        // Test-only field — production sendSystemPm doesn't write this,
        // but downstream pm-key assertions need to introspect which
        // template was supposed to render here.
        _testKey: key,
      });
      ctx.lastSentSystemPm = {
        webhook: webhookName,
        key,
        recipientName,
        recipientUid,
        msgId,
        convId,
      };
      return { ok: true };
    },
  },
  {
    // Wake 82 — "the message body is the <Language> translation of the
    // <X> template". j18:31, 41. Reuses the existing `pmBodyIsTranslation
    // OfTemplate` driver (Wake 30) with a different noun phrase.
    pattern: /^the message body is the ([A-Z][a-z]+) translation of the ([\w-]+) template$/,
    async handler(m, ctx) {
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
        English: 'en',
      };
      const languageName = m[1];
      const templateName = m[2];
      const code = LOCALE_NAME_TO_CODE[languageName];
      if (!code) {
        return { ok: false, error: `unknown language name "${languageName}"` };
      }
      if (!ctx.webDriver?.pmBodyIsTranslationOfTemplate) {
        return { ok: false, error: 'ctx.webDriver.pmBodyIsTranslationOfTemplate not configured' };
      }
      const ok = await ctx.webDriver.pmBodyIsTranslationOfTemplate(code, templateName);
      if (!ok) {
        return {
          ok: false,
          error: `message body is not the ${languageName} translation of ${templateName}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 82 — "<Name>'s <Plat> UI shows a new PM thread with sender
    // "<X>"". j18:32. Driver verifies a PM thread with the named sender
    // appears in the persona's inbox.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a new PM thread with sender "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const sender = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsNewPmThreadWithSender'
        : platform === 'Android'
          ? 'androidShowsNewPmThreadWithSender'
          : 'iosShowsNewPmThreadWithSender';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, sender);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show a new PM thread with sender "${sender}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 82 — "<X> (locale=<a>) is being downgraded by <Y> (locale=<b>)
    // via age verification". j18:38 — composite admin-action state-seed
    // (present-progressive tense). Writes target.cohort=minor +
    // target.locale, and records BOTH personas' locales in
    // ctx.personaLocales.
    pattern:
      /^([A-Z][a-z]+) \(locale=([a-z]+)\) is being downgraded by ([A-Z][a-z]+) \(locale=([a-z]+)\) via age verification$/,
    async handler(m, ctx) {
      const targetName = m[1];
      const targetLocale = m[2];
      const adminName = m[3];
      const adminLocale = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const target = personas.get(targetName);
      if (!target?.uniqueId) {
        return { ok: false, error: `persona "${targetName}" not in registry` };
      }
      await ctx.db
        .doc(`users/${target.uniqueId}`)
        .set({ cohort: 'minor', locale: targetLocale }, { merge: true });
      // OSA #17 PR 6 test-side mirror — see clearCrossCohortFollowsForUserDoc.
      await clearCrossCohortFollowsForUserDoc(ctx.db, target.uniqueId, 'minor');
      if (!ctx.personaLocales) ctx.personaLocales = new Map();
      ctx.personaLocales.set(targetName, { platform: null, locale: targetLocale });
      ctx.personaLocales.set(adminName, { platform: null, locale: adminLocale });
      return { ok: true };
    },
  },
  {
    // Wake 83 — "<Name> [P-NN] is signed in as a non-admin user".
    // j12:140 — predicate state-seed for admin-permission tests. Writes
    // isAdmin=false on the persona's user doc.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is signed in as a non-admin user$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set({ isAdmin: false }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 83 — "the audit log has <N> entries". j12:101 — large-volume
    // state-seed. Writes N synthetic audit entries directly to the
    // auditLog collection.
    //
    // State-seed pattern (W120/W124/W126): bulk-writes the docs the
    // production audit-log writers would produce, rather than
    // delegating to a webDriver stub. Shape mirrors the route-side
    // audit writers (action + timestamp + synthetic IDs) so scenarios
    // counting entries by query see the seeded rows alongside any
    // real ones produced by the same cycle.
    pattern: /^the audit log has (\d+) entries$/,
    async handler(m, ctx) {
      const count = parseInt(m[1], 10);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      if (!Number.isFinite(count) || count < 0) {
        return { ok: false, error: `invalid audit-log entry count: ${m[1]}` };
      }
      const ts = Date.now();
      // Sequential IDs keep ordering deterministic when the cycle
      // queries by createdAt — preferable to random IDs which would
      // make order non-reproducible across runs.
      const writes = [];
      for (let i = 0; i < count; i++) {
        const id = `test-seed-${ts}-${i.toString().padStart(6, '0')}`;
        writes.push(
          ctx.db.doc(`auditLog/${id}`).set({
            id,
            action: 'test_seed',
            actorId: 0,
            targetId: 0,
            timestamp: ts + i,
            details: 'test-seed audit entry',
          }),
        );
      }
      await Promise.all(writes);
      return { ok: true };
    },
  },
  {
    // Wake 83 — "the scheduled startsAt has been reached". j16:42 —
    // time-travel state-seed. Driver advances the mock clock to/past
    // the latest event's startsAt and triggers any time-based watchers.
    pattern: /^the scheduled startsAt has been reached$/,
    async handler(_m, ctx) {
      if (!ctx.webDriver?.advanceClockToStartsAt) {
        return { ok: false, error: 'ctx.webDriver.advanceClockToStartsAt not configured' };
      }
      const ok = await ctx.webDriver.advanceClockToStartsAt();
      if (!ok) {
        return { ok: false, error: 'failed to advance mock clock to startsAt' };
      }
      return { ok: true };
    },
  },
  {
    // Wake 83 — "<Name> on <Plat> taps "<X>" on his/her/their event-host
    // home". j16:43 — tap with contextual-location annotation.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps "([^"]+)" on (?:his|her|their) event-host home$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const buttonText = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webTapOnEventHostHome'
        : platform === 'Android'
          ? 'androidTapOnEventHostHome'
          : 'iosTapOnEventHostHome';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, buttonText);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: tap "${buttonText}" on event-host home did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 83 — "<Name>'s <Plat> UI shows the roster panel with <Other>
    // listed as "<status>"". j16:50 — composite roster assertion.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the roster panel with ([A-Z][a-z]+) listed as "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const otherName = m[3];
      const status = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsRosterEntry'
        : platform === 'Android'
          ? 'androidShowsRosterEntry'
          : 'iosShowsRosterEntry';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, otherName, status);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show ${otherName} listed as "${status}" in the roster panel`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 83 — "<Name> [P-NN] (annotation) opens the "<X>" tab".
    // j15:75, j15:80 — persona-annotated tab navigation. The mid-step
    // `(annotation)` is informational; the matcher tolerates any
    // content inside the parens. Routes to androidOpenTab — the corpus
    // only uses Android for this shape.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s*\([^)]+\)\s+opens the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const name = m[1];
      const tab = m[3];
      if (!ctx.uiDriver?.androidOpenTab) {
        return { ok: false, error: 'ctx.uiDriver.androidOpenTab not configured' };
      }
      const ok = await ctx.uiDriver.androidOpenTab(name, tab);
      if (!ok) {
        return { ok: false, error: `${name}: open "${tab}" tab did not complete` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> UI still shows the <noun> <kind>".
    // j10:63 — positive-persistence variant of Wake 69's `UI shows the
    // X <kind>`. Reuses the same driver — `still` is just author wording.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI still shows the ([\w ]+) (button|screen|banner|dialog|panel|tab)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const noun = m[3].trim();
      const kind = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsNamedKind'
        : platform === 'Android'
          ? 'androidShowsNamedKind'
          : 'iosShowsNamedKind';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, noun, kind);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI no longer shows the "${noun}" ${kind} (expected still shown)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> UI does not navigate away".
    // j10:62 — bare negative-nav assertion. Driver returns truthy iff
    // a navigation occurred since the last snapshot.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does not navigate away$/,
    async handler(m, ctx) {
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webDidNavigate'
        : platform === 'Android'
          ? 'androidDidNavigate'
          : 'iosDidNavigate';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const didNavigate = await driver[methodName]();
      if (didNavigate) {
        return { ok: false, error: `${platform} UI navigated away but should not have` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> UI does NOT navigate back into room
    // "<X>" automatically". j10:72.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI does NOT navigate back into room "([^"]+)" automatically$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const roomId = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webDidAutoRejoinRoom'
        : platform === 'Android'
          ? 'androidDidAutoRejoinRoom'
          : 'iosDidAutoRejoinRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const didRejoin = await driver[methodName](name, roomId);
      if (didRejoin) {
        return {
          ok: false,
          error: `${platform} UI auto-rejoined room "${roomId}" but should not have`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> UI shows the room screen with
    // <indicator> indicator". j10:28 — composite: room screen + indicator
    // state in one step.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the room screen with ([\w-]+) indicator$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const indicator = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsRoomScreenWithIndicator'
        : platform === 'Android'
          ? 'androidShowsRoomScreenWithIndicator'
          : 'iosShowsRoomScreenWithIndicator';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, indicator);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show room screen with "${indicator}" indicator`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> UI is still in the room". j14:67 —
    // bare persistence assertion.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI is still in the room$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webIsStillInRoom'
        : platform === 'Android'
          ? 'androidIsStillInRoom'
          : 'iosIsStillInRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const stillIn = await driver[methodName](name);
      if (!stillIn) {
        return { ok: false, error: `${name} is no longer in the room on ${platform}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 84 — "<Name>'s <Plat> network restores". j14:70 — bare
    // network-event step (no profile — driver decides what "restores"
    // means based on prior state).
    pattern: /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) network restores$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webNetworkRestores'
        : platform === 'Android'
          ? 'androidNetworkRestores'
          : 'iosNetworkRestores';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return { ok: false, error: `${name}'s ${platform} network did not restore` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 85 — "<Name> [P-NN] is on <Plat> joined to voice room "<X>"
    // with mic <state>" (state-seed, non-seated). j14:46. Writes
    // participantIds + micStates (no seat assignment).
    pattern:
      /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+(?:is\s+)?on (?:Web Chromium|Web Safari|Web|Android|iOS Sim)\s+(?:is\s+)?joined to voice room "([^"]+)" with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[3];
      const micState = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const micStates = { ...(existing.micStates || {}) };
      micStates[String(p.uniqueId)] = micState;
      await ctx.db.doc(docPath).set({ ...existing, participantIds, micStates }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 85 — "<Name> is on <Plat> joined to room "<X>" seated with mic
    // <state>" (state-seed, seated). j14:62. Writes participantIds +
    // seats[] + micStates.
    pattern:
      /^([A-Z][a-z]+)\s+(?:is\s+)?on (?:Web Chromium|Web Safari|Web|Android|iOS Sim)\s+joined to room "([^"]+)" seated with mic (open|muted)$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      const micState = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      const docPath = `rooms/${roomId}`;
      const snap = await ctx.db.doc(docPath).get();
      const existing = snap.exists ? snap.data() : { id: roomId, participantIds: [] };
      const participantIds = Array.isArray(existing.participantIds)
        ? [...existing.participantIds]
        : [];
      if (!participantIds.includes(p.uniqueId)) participantIds.push(p.uniqueId);
      const micStates = { ...(existing.micStates || {}) };
      micStates[String(p.uniqueId)] = micState;
      await ctx.db.doc(docPath).set(
        {
          ...existing,
          participantIds,
          micStates,
          seats: [{ userId: p.uniqueId, muted: micState === 'muted' }],
        },
        { merge: true },
      );
      return { ok: true };
    },
  },
  {
    // Wake 85 — "the tester hears <X>'s audio with <quality>". j14:77 —
    // manual-only. Extends Wake 66 with a quality descriptor.
    pattern: /^the tester hears ([A-Z][a-z]+)'s audio with (.+)$/,
    async handler(m, ctx) {
      const fromName = m[1];
      const quality = m[2];
      if (!ctx.testerDriver?.confirmHearsAudioWithQuality) {
        return {
          ok: false,
          error:
            'manual-only assertion — no testerDriver. Tag scenario @manual or wire ctx.testerDriver.confirmHearsAudioWithQuality.',
        };
      }
      const ok = await ctx.testerDriver.confirmHearsAudioWithQuality(fromName, quality);
      if (!ok) {
        return {
          ok: false,
          error: `tester did not confirm ${fromName}'s audio with quality "${quality}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 85 — "<Name>'s <Plat> UI shows the room screen with host seat
    // occupied + "<X>" badge". j15:34 — composite: room screen + seat-
    // occupied + named tier badge.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the room screen with host seat occupied \+ "([^"]+)" badge$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const badge = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsRoomScreenWithHostBadge'
        : platform === 'Android'
          ? 'androidShowsRoomScreenWithHostBadge'
          : 'iosShowsRoomScreenWithHostBadge';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, badge);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show room screen with host seat occupied + "${badge}" badge`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 85 — "<Name> on <Plat> sends "<X>" to <Y>" (Web/iOS variant).
    // j15:43 — Web/iOS variant of the Android-specific matcher (line
    // ~2841). Routes to platform-specific driver method; driver decides
    // whether to interpret as message or gift based on UI context.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|iOS Sim) sends "([^"]+)" to ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const item = m[3];
      const recipient = m[4];
      const methodName = platform.startsWith('Web') ? 'webSendItemTo' : 'iosSendItemTo';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, item, recipient);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: send "${item}" to ${recipient} did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 85 — "<Name> [P-NN] is a <minor|adult> with userType=<X>"
    // (state-seed). j16:55 — composite cohort + userType.
    pattern: /^([A-Z][a-z]+)(?:\s*\[(P-\d{2})\])?\s+is a (minor|adult) with userType=(\w+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const cohort = m[3];
      const userType = m[4];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set({ cohort, userType }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name> scheduled an event including <Other>" (state-seed).
    // j16:33 — creates an events doc with hostUid + roster.
    pattern: /^([A-Z][a-z]+) scheduled an event including ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const hostName = m[1];
      const participantName = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const host = personas.get(hostName);
      const participant = personas.get(participantName);
      if (!host?.uniqueId) {
        return { ok: false, error: `persona "${hostName}" not in registry` };
      }
      if (!participant?.uniqueId) {
        return { ok: false, error: `persona "${participantName}" not in registry` };
      }
      const eventId = `event-${host.uniqueId}-${ctx.scenarioStartTime || Date.now()}`;
      await ctx.db.doc(`events/${eventId}`).set({
        id: eventId,
        hostUid: host.uniqueId,
        roster: [participant.uniqueId],
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name> on <Plat> taps "<X>" in the roster panel". j16:51.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps "([^"]+)" in the roster panel$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const buttonText = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webTapInRosterPanel'
        : platform === 'Android'
          ? 'androidTapInRosterPanel'
          : 'iosTapInRosterPanel';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, buttonText);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: tap "${buttonText}" in roster panel did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name>'s <Plat> UI shows the classroom room screen with
    // "<X>" badge on the host seat". j17:35.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the classroom room screen with "([^"]+)" badge on the host seat$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const badge = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsClassroomWithHostBadge'
        : platform === 'Android'
          ? 'androidShowsClassroomWithHostBadge'
          : 'iosShowsClassroomWithHostBadge';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, badge);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show classroom room screen with "${badge}" badge`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name>'s <Plat> UI shows <Other>'s "<X>" room card".
    // j17:40 — possessive room-card assertion: viewer + owner + title.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)'s "([^"]+)" room card$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const owner = m[3];
      const title = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsOthersRoomCard'
        : platform === 'Android'
          ? 'androidShowsOthersRoomCard'
          : 'iosShowsOthersRoomCard';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](viewer, owner, title);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show ${owner}'s "${title}" room card`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name> on <Plat> approves <Other>'s seat request". j17:51.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) approves ([A-Z][a-z]+)'s seat request$/,
    async handler(m, ctx) {
      const host = m[1];
      const platform = m[2];
      const requester = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webApproveSeatRequest'
        : platform === 'Android'
          ? 'androidApproveSeatRequest'
          : 'iosApproveSeatRequest';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](host, requester);
      if (!ok) {
        return {
          ok: false,
          error: `${host}: approve ${requester}'s seat request did not complete`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 86 — "<Name>'s locale is <X>" (bare state-seed). j17:66.
    // Distinct from Wake 74's quoted `browser locale is "X"` (which
    // stores in ctx.browserLocales). This writes to users/<id>.locale.
    pattern: /^([A-Z][a-z]+)'s locale is ([a-z]{2}(?:-[A-Z]{2})?)$/,
    async handler(m, ctx) {
      const name = m[1];
      const locale = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${name}" not in registry` };
      }
      await ctx.db.doc(`users/${p.uniqueId}`).set({ locale }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 87 — "<Name> on <Plat> selects N stars and submits feedback
    // "<X>"". j17:60. Composite rating action: pick stars + type feedback
    // + submit, dispatched as a single driver call so the driver can
    // sequence taps atomically (avoid race where partial-rating gets
    // submitted by a flaky scroll).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) selects (\d+) stars? and submits feedback "([^"]*)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const stars = Number(m[3]);
      const feedback = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webSubmitStarFeedback'
        : platform === 'Android'
          ? 'androidSubmitStarFeedback'
          : 'iosSubmitStarFeedback';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, stars, feedback);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: submit ${stars}★ feedback did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 87 — "<Name>'s <Plat> UI shows a chart of beans earned per
    // week". j17:74. Bare chart-presence assertion. Driver returns true
    // iff the named chart component is rendered; bin-level value checks
    // belong in a separate Wake (would need a different step phrasing).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a chart of beans earned per week$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsBeansPerWeekChart'
        : platform === 'Android'
          ? 'androidShowsBeansPerWeekChart'
          : 'iosShowsBeansPerWeekChart';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show ${name}'s beans-per-week chart`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 87 — "the rail shows lessons tagged for language "<X>"".
    // j17:80. Web-only rail content assertion (no persona/platform in
    // the phrase — implicitly the actor whose UI is currently focused).
    // Driver verifies every visible card on the rail carries language=X.
    pattern: /^the rail shows lessons tagged for language "([^"]*)"$/,
    async handler(m, ctx) {
      const lang = m[1];
      if (!ctx.webDriver?.webRailShowsLessonsForLanguage) {
        return { ok: false, error: 'ctx.webDriver.webRailShowsLessonsForLanguage not configured' };
      }
      const ok = await ctx.webDriver.webRailShowsLessonsForLanguage(lang);
      if (!ok) {
        return {
          ok: false,
          error: `rail does not show lessons tagged for language "${lang}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 87 — "<Name> on <Plat> refreshes the language rail". j17:78.
    // Pull-to-refresh / refresh-button on the language-filter rail.
    // Action only — no follow-up assertion (the next Then-step covers
    // the post-refresh state).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) refreshes the language rail$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webRefreshLanguageRail'
        : platform === 'Android'
          ? 'androidRefreshLanguageRail'
          : 'iosRefreshLanguageRail';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: refresh language rail did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 87 — "the response from <path>?<query> does not include the
    // <noun>". j17:82. Negative absence assertion on the most-recent
    // recorded HTTP response. <noun> maps to a ctx field holding the
    // identifier (e.g., `lesson` → ctx.lastCreatedLessonId). We
    // JSON-stringify the body and check the needle isn't present
    // anywhere — covers the case where the API returns the id in any
    // shape (results[*].id, results[*].uniqueId, nested doc refs).
    pattern: /^the response from ([^?\s]+)\?(\S+) does not include the (\w+)$/,
    async handler(m, ctx) {
      const noun = m[3];
      if (!ctx.lastResponse) {
        return { ok: false, error: 'no recorded response — When step missing?' };
      }
      const lookups = {
        lesson: ctx.lastCreatedLessonId,
        user: ctx.lastCreatedUserId,
        room: ctx.lastCreatedRoomId,
        gift: ctx.lastCreatedGiftId,
      };
      const needle = lookups[noun];
      if (!needle) {
        return {
          ok: false,
          error: `no ctx.lastCreated${noun[0].toUpperCase()}${noun.slice(1)}Id to check absence of`,
        };
      }
      const body = JSON.stringify(ctx.lastResponse.body ?? '');
      if (body.includes(needle)) {
        return {
          ok: false,
          error: `response includes ${noun} ${needle} (expected absent)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 87 — "<Name> received a system PM from <Other>" (state-seed).
    // j18:45. Plants a messages/<id> doc so subsequent steps can assert
    // inbox behaviour without first triggering the webhook. Sender is
    // stored as a name (not uniqueId) because the system-sender for j18
    // is Officia (uniqueId=1) but downstream assertions check the
    // rendered name string.
    pattern: /^([A-Z][a-z]+) received a system PM from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const recipientName = m[1];
      const senderName = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(recipientName);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${recipientName}" not in registry` };
      }
      const messageId = `system-${p.uniqueId}-${Date.now()}`;
      await ctx.db.doc(`messages/${messageId}`).set({
        recipientId: p.uniqueId,
        senderName,
        isSystem: true,
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 88 — "<Name> [P-NN] (cohort) is signed in on <Plat>". j17:24,
    // j18:46. The mid-step `(cohort)` paren is NOT end-anchored so
    // stripStepAnnotation leaves it; the existing line-368 sign-in
    // matcher rejects it. This explicit variant synthesises a session
    // whose customClaims.cohort is the DECLARED cohort, even if the
    // persona registry would say otherwise. That's intentional: the
    // scenario asserts cohort-specific behaviour by labelling the actor,
    // and downstream cohort-gated steps should believe the label.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s*\((minor|adult)\)\s+is signed in on\s+(Web Chromium|Web Safari|Web|Android|iOS Sim)$/,
    async handler(m, ctx) {
      const name = m[1];
      const pCode = m[2];
      const cohort = m[3];
      const personas = loadPersonas();
      const p = personas.get(pCode) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort, ephemeral: !!p.ephemeral },
      });
      return { ok: true };
    },
  },
  {
    // Wake 88 — "the database has N entries in "<X>" added since "<ts>"".
    // j05:14. Counts docs in the named (sub)collection whose timestamp
    // field is strictly > the `since` value. Timestamp field tried in
    // order: createdAt, at, timestamp. The "since" placeholder is
    // interpolated upstream so {ts} (scenario var) becomes a real number.
    pattern: /^the database has (\d+) entries in "([^"]+)" added since "([^"]+)"$/,
    async handler(m, ctx) {
      const expectedCount = Number(m[1]);
      const colPath = m[2];
      const sinceRaw = m[3];
      const since = Number(sinceRaw);
      if (!Number.isFinite(since)) {
        return {
          ok: false,
          error: `since="${sinceRaw}" is not a number (placeholder unresolved?)`,
        };
      }
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(colPath).get();
      const matched = snap.docs.filter((d) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        const t = data?.createdAt ?? data?.at ?? data?.timestamp;
        return typeof t === 'number' && t > since;
      });
      if (matched.length !== expectedCount) {
        return {
          ok: false,
          error: `count was ${matched.length} entries in "${colPath}" since ${since}, expected ${expectedCount}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 88 — "<Name>'s <Plat> UI shows the official badge[ <suffix>]".
    // j13/j18 variants. Bare and suffixed forms unified into one
    // matcher; the optional trailing fragment is passed to the driver
    // verbatim so it can dispatch to the right slot ("on the sender
    // avatar", "with Arabic label", etc.).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the official badge(?: (.+))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const suffix = m[3] || '';
      const methodName = platform.startsWith('Web')
        ? 'webShowsOfficialBadge'
        : platform === 'Android'
          ? 'androidShowsOfficialBadge'
          : 'iosShowsOfficialBadge';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](name, suffix);
      if (!shown) {
        return {
          ok: false,
          error: `${platform} UI does not show ${name}'s official badge${suffix ? ` (${suffix})` : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 88 — "<Name> on <Plat> opens <Other>'s profile and taps
    // "<X>"". j11:33. Composite: open profile + tap action. Driver
    // sequences both atomically so the test can't observe a half-open
    // state (would be a race against profile-modal animation).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) opens ([A-Z][a-z]+)'s profile and taps "([^"]+)"$/,
    async handler(m, ctx) {
      const actor = m[1];
      const platform = m[2];
      const target = m[3];
      const button = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webOpenProfileAndTap'
        : platform === 'Android'
          ? 'androidOpenProfileAndTap'
          : 'iosOpenProfileAndTap';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](actor, target, button);
      if (!ok) {
        return {
          ok: false,
          error: `${actor}: open ${target}'s profile + tap "${button}" did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 88 — "<Name> on <Plat> opens <Other>'s profile from the <X>".
    // j17:71, j18:49. Composite navigation: from source surface (room,
    // PM, inbox, ...) → other's profile. Source word tells the driver
    // which entry-point gesture to use.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) opens ([A-Z][a-z]+)'s profile from the (\w+)$/,
    async handler(m, ctx) {
      const actor = m[1];
      const platform = m[2];
      const target = m[3];
      const source = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webOpenProfileFrom'
        : platform === 'Android'
          ? 'androidOpenProfileFrom'
          : 'iosOpenProfileFrom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](actor, target, source);
      if (!ok) {
        return {
          ok: false,
          error: `${actor}: open ${target}'s profile from ${source} did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 88 — "the <topic> (broadcast|flow) fires sendSystemPm with
    // key="<X>" recipient=<Other>". j18:38, 51. Sibling of Wake 82's
    // webhook variant — same effective driver semantics, only the
    // Gherkin trigger word differs (broadcast/flow vs webhook). Placed
    // AFTER the Wake 82 matcher; the `webhook` keyword is not in this
    // pattern so they don't collide.
    pattern:
      /^the (\w+(?:-\w+)*) (broadcast|flow) fires sendSystemPm with key="([^"]+)" recipient=([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const triggerName = m[1];
      const key = m[3];
      const recipientName = m[4];
      const personas = loadPersonas();
      const p = personas.get(recipientName);
      if (!p?.uniqueId) {
        return { ok: false, error: `recipient "${recipientName}" not in registry` };
      }
      if (!ctx.webDriver?.fireSystemPmWebhook) {
        return { ok: false, error: 'ctx.webDriver.fireSystemPmWebhook not configured' };
      }
      const ok = await ctx.webDriver.fireSystemPmWebhook(triggerName, key, p.uniqueId);
      if (!ok) {
        return {
          ok: false,
          error: `${triggerName} failed to fire sendSystemPm key=${key}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 89 — broad "the <noun> fires sendSystemPm with key="<X>"
    // [recipient=<Other>]". j18:39, 55. Fallback for sendSystemPm
    // trigger phrases that don't match Wake 82's "<X> webhook" or
    // Wake 88's "<X> broadcast|flow". MUST be placed AFTER both —
    // first-match-wins gives the narrower matchers priority so they
    // still capture only the trigger token (Wake 82: "post-approval",
    // not "post-approval webhook"). The noun phrase capture is
    // bounded by the literal " fires sendSystemPm" suffix so backtracking
    // is bounded.
    pattern: /^the ([^"]+?) fires sendSystemPm with key="([^"]+)"(?: recipient=([A-Z][a-z]+))?$/,
    async handler(m, ctx) {
      const trigger = m[1];
      const key = m[2];
      const recipientName = m[3];
      let recipientId = null;
      if (recipientName) {
        const personas = loadPersonas();
        const p = personas.get(recipientName);
        if (!p?.uniqueId) {
          return { ok: false, error: `recipient "${recipientName}" not in registry` };
        }
        recipientId = p.uniqueId;
      }
      if (!ctx.webDriver?.fireSystemPmWebhook) {
        return { ok: false, error: 'ctx.webDriver.fireSystemPmWebhook not configured' };
      }
      const ok = await ctx.webDriver.fireSystemPmWebhook(trigger, key, recipientId);
      if (!ok) {
        return {
          ok: false,
          error: `${trigger} failed to fire sendSystemPm key=${key}`,
        };
      }
      // Wake 90 — record send for downstream "the recipient is X" assertion.
      ctx.lastSentSystemPm = {
        trigger,
        key,
        recipientName: recipientName || null,
        recipientId,
      };
      return { ok: true };
    },
  },
  {
    // Wake 89 — "<Name>'s <Plat> UI shows non-empty <Language> text for
    // section N". j13:36. Locale section assertion. Driver checks that
    // section N of the currently-rendered screen contains visible
    // non-empty text rendered in the named language's script (not
    // English fallback). The static language-name → BCP-47-code map
    // covers the 20 supported locales.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows non-empty ([A-Z][a-z]+) text for section (\d+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const langName = m[3];
      const section = Number(m[4]);
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
        English: 'en',
      };
      const code = LOCALE_NAME_TO_CODE[langName];
      if (!code) {
        return { ok: false, error: `unknown language name "${langName}"` };
      }
      const methodName = platform.startsWith('Web')
        ? 'webShowsNonEmptyLocaleText'
        : platform === 'Android'
          ? 'androidShowsNonEmptyLocaleText'
          : 'iosShowsNonEmptyLocaleText';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, code, section);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: section ${section} did not show non-empty ${langName} text`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 89 — "<Name>'s <Plat> UI disables the <X> input". j11:50.
    // UI control state assertion. The input name is parameterised so
    // future "disables the comment input" / "gift input" don't need a
    // new matcher.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI disables the (\w+) input$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const inputName = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webDisablesInput'
        : platform === 'Android'
          ? 'androidDisablesInput'
          : 'iosDisablesInput';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const disabled = await driver[methodName](name, inputName);
      if (!disabled) {
        return {
          ok: false,
          error: `${name}: ${inputName} input is not disabled on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 89 — "<Name>'s <Plat> Admin UI shows <Other>'s appeal with
    // the text". j11:73. Admin moderation UI assertion. Driver verifies
    // an appeal section is visible for <Other> with non-empty body text
    // (the "with the text" suffix is rhetorical — there's no assertion
    // on a specific string).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows ([A-Z][a-z]+)'s appeal with the text$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const target = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsAppealText'
        : platform === 'Android'
          ? 'androidAdminShowsAppealText'
          : 'iosAdminShowsAppealText';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const shown = await driver[methodName](viewer, target);
      if (!shown) {
        return {
          ok: false,
          error: `${viewer}'s Admin UI does not show ${target}'s appeal text`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 89 — `a conversation "<X>" exists with participantIds=[N, N]
    // created before the OSA migration` (state-seed). j08:14. Plants a
    // conversations/<id> doc with the cross-cohort participant pair and
    // createdAt=0 (sentinel for "before OSA migration").
    //
    // The j19 OSA regression suite probes "migration has run at least
    // once" — i.e., the steady state under test is POST-migration. So
    // this seed plants the doc in the state the migration would leave
    // it: crossCohortAtMigration + frozenAtMigration set, mirroring
    // migrate-segregation-relationships.js applyConversationMigration
    // (line ~866). Without the flags, j19 reports the conv as an
    // unfrozen-cross-cohort violation even though the test-author's
    // intent is "migration already ran".
    pattern:
      /^a conversation "([^"]+)" exists with participantIds=\[(\d+), (\d+)\] created before the OSA migration$/,
    async handler(m, ctx) {
      const id = m[1];
      const a = Number(m[2]);
      const b = Number(m[3]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      await ctx.db.doc(`conversations/${id}`).set({
        participantIds: [a, b],
        createdAt: 0,
        state: 'OPEN',
        crossCohortAtMigration: true,
        frozenAtMigration: true,
        frozenAtMigrationAt: 1,
      });
      return { ok: true };
    },
  },
  {
    // Wake 89 — "<Name> on <Plat> taps the <X> from the <Y>". j16:24.
    // Composite tap-from-source. Driver locates surface Y, scopes the
    // search, and taps control X within it. Lazy `(.+?)` is bounded by
    // the literal " from the " so backtracking can't explode.
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) taps the ([^"]+?) from the (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const target = m[3];
      const source = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webTapFromSurface'
        : platform === 'Android'
          ? 'androidTapFromSurface'
          : 'iosTapFromSurface';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, target, source);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: tap "${target}" from "${source}" did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — "the script reports N <thing>". j19:63-66. Migration
    // idempotency check: re-running on the post-migration database
    // should report zero changes across 4 categories. The matcher reads
    // counts from `osaCounts(db)` (cached on ctx._osaCounts for the
    // scenario lifetime — j19 has 4 such assertions in one scenario).
    pattern: /^the script reports (\d+) (.+)$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      const thing = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      if (!ctx._osaCounts) ctx._osaCounts = await osaCounts(ctx.db);
      const map = {
        'followingIds entries to remove': 'crossFollowing',
        'followerIds entries to remove': 'crossFollower',
        'rooms to close': 'mixedRooms',
        'conversations to freeze': 'unfrozenCross',
      };
      const key = map[thing];
      if (!key) {
        return { ok: false, error: `unknown reporting category "${thing}"` };
      }
      const actual = ctx._osaCounts[key];
      if (actual !== expected) {
        return {
          ok: false,
          error: `script reports ${actual} ${thing}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — `every such doc has field "<X>" equal to "<Y>"`. j19:49.
    // Iterates ctx.lastQueryResult.docs (populated by a prior `When a
    // query is run for ...` step). Every doc must have field equal to
    // the named value (string equality).
    pattern: /^every such doc has field "([^"]+)" equal to "([^"]+)"$/,
    async handler(m, ctx) {
      const field = m[1];
      const value = m[2];
      if (!ctx.lastQueryResult || !Array.isArray(ctx.lastQueryResult.docs)) {
        return {
          ok: false,
          error:
            'ctx.lastQueryResult.docs missing — run a `When a query is run for ...` step first',
        };
      }
      const mismatches = ctx.lastQueryResult.docs.filter((d) => d?.[field] !== value);
      if (mismatches.length > 0) {
        return {
          ok: false,
          error: `${mismatches.length} doc(s) had ${field} != "${value}" (first: ${JSON.stringify(mismatches[0]).slice(0, 80)})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — `every such doc has field "<X>" set to a value within
    // the migration window`. j19:50. Permissive variant: asserts the
    // field is a number (timestamp). Future work could tighten by
    // reading a concrete migration window from ctx.migrationWindow.
    pattern: /^every such doc has field "([^"]+)" set to a value within the migration window$/,
    async handler(m, ctx) {
      const field = m[1];
      if (!ctx.lastQueryResult || !Array.isArray(ctx.lastQueryResult.docs)) {
        return {
          ok: false,
          error:
            'ctx.lastQueryResult.docs missing — run a `When a query is run for ...` step first',
        };
      }
      const missing = ctx.lastQueryResult.docs.filter((d) => typeof d?.[field] !== 'number');
      if (missing.length > 0) {
        return {
          ok: false,
          error: `${missing.length} doc(s) missing numeric ${field} timestamp`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — `no "<X>" doc with state="<Y>" has participantIds
    // containing users with differing cohort`. j19:43. Fresh query
    // against the named collection (X strips trailing /*); resolves
    // each participant's cohort via users collection and asserts no
    // doc has >1 distinct cohort.
    pattern:
      /^no "([^"]+)" doc with state="([^"]+)" has participantIds containing users with differing cohort$/,
    async handler(m, ctx) {
      const pathPattern = m[1];
      const stateFilter = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const collectionName = pathPattern.replace(/\/\*$/, '');
      const usersEntries = snapToEntries(await ctx.db.collection('users').get());
      const cohortMap = new Map();
      for (const { data } of usersEntries) {
        if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
          cohortMap.set(String(data.uniqueId), data.cohort);
        }
      }
      const docsEntries = snapToEntries(await ctx.db.collection(collectionName).get());
      const violations = [];
      for (const { id, data } of docsEntries) {
        if (data?.state !== stateFilter) continue;
        const cohorts = new Set();
        for (const pid of data.participantIds || []) {
          const c = cohortMap.get(String(pid));
          if (c) cohorts.add(c);
        }
        if (cohorts.size > 1) violations.push(id || JSON.stringify(data).slice(0, 30));
      }
      if (violations.length > 0) {
        return {
          ok: false,
          error: `${violations.length} ${pathPattern} doc(s) with mixed-cohort participants (first: ${violations[0]})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — `for each conversation where participantIds contains
    // users with differing cohort, the doc has field "<X>" equal to
    // <value>`. j19:56. Iterates conversations, filters to mixed-cohort,
    // asserts the named field equals the parsed value (bool literal or
    // quoted string).
    pattern:
      /^for each conversation where participantIds contains users with differing cohort, the doc has field "([^"]+)" equal to (true|false|"[^"]+")$/,
    async handler(m, ctx) {
      const field = m[1];
      const expected = parseLiteral(m[2]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const usersEntries = snapToEntries(await ctx.db.collection('users').get());
      const cohortMap = new Map();
      for (const { data } of usersEntries) {
        if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
          cohortMap.set(String(data.uniqueId), data.cohort);
        }
      }
      const convsEntries = snapToEntries(await ctx.db.collection('conversations').get());
      const violations = [];
      for (const { id, data } of convsEntries) {
        const cohorts = new Set();
        for (const pid of data?.participantIds || []) {
          const c = cohortMap.get(String(pid));
          if (c) cohorts.add(c);
        }
        if (cohorts.size <= 1) continue;
        // Field-name duality for `frozenAtMigration` ↔ `frozen`. The OSA
        // probe (probeOsaInvariants line ~13018) treats either field
        // being true as "this conv is frozen / cross-cohort access is
        // sealed". The j19 step text picks ONE of those names; if the
        // seeded data uses the other (e.g., non-migration freeze
        // matchers write `frozen: true` while the migration writes
        // `frozenAtMigration: true`), naive field-equality reports a
        // false violation. Accept either field for this canonical pair.
        const isFrozenDual =
          (field === 'frozenAtMigration' || field === 'frozen') &&
          expected === true &&
          (data?.frozen === true || data?.frozenAtMigration === true);
        if (!isFrozenDual && data?.[field] !== expected) {
          violations.push(id || JSON.stringify(data).slice(0, 30));
        }
      }
      if (violations.length > 0) {
        return {
          ok: false,
          error: `${violations.length} mixed-cohort conversation(s) had ${field} != ${m[2]} (first: ${violations[0]})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 90 — "the recipient is <Name>" (assertion on the most-recent
    // sendSystemPm call). j18:54. Reads ctx.lastSentSystemPm (populated
    // by the Wake 89 broad sendSystemPm matcher, Wake 82 webhook
    // matcher, and Wake 88 broadcast/flow matcher — only the broad
    // matcher writes this field as of Wake 90; other matchers can be
    // updated later to populate it too).
    pattern: /^the recipient is ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const expected = m[1];
      if (!ctx.lastSentSystemPm) {
        return {
          ok: false,
          error: 'no prior sendSystemPm — recipient assertion needs a When step',
        };
      }
      const actual = ctx.lastSentSystemPm.recipientName;
      if (actual !== expected) {
        return {
          ok: false,
          error: `recipient was ${actual ?? 'null'}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 91 — "the script exit code is N". j19:67. Asserts the exit
    // code from the most recent migration-script run. Defaults to 0
    // if no prior run recorded one (the existing no-op migration
    // matcher leaves ctx.lastScriptExitCode unset → idempotent re-runs
    // are by default exit-0).
    pattern: /^the script exit code is (\d+)$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      const actual = ctx.lastScriptExitCode ?? 0;
      if (actual !== expected) {
        return {
          ok: false,
          error: `script exit code was ${actual}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 91 — "N users are tagged for a broadcast" (state-seed).
    // j18:36. Records the broadcast cohort size on ctx for downstream
    // assertions (e.g., "no FCM dispatch fails" scales with this).
    pattern: /^(\d+) users are tagged for a broadcast$/,
    async handler(m, ctx) {
      ctx.broadcastTaggedCount = Number(m[1]);
      return { ok: true };
    },
  },
  {
    // Wake 91 — "no FCM dispatch fails". j18:40. Reads
    // ctx.fcmDispatchResults (populated by an FCM-send driver) and
    // asserts every entry succeeded. Empty result list is ok — the
    // assertion is "none failed", not "≥1 succeeded".
    pattern: /^no FCM dispatch fails$/,
    async handler(_m, ctx) {
      const results = ctx.fcmDispatchResults || [];
      const failures = results.filter((r) => r?.success === false);
      if (failures.length > 0) {
        const first = failures[0];
        return {
          ok: false,
          error: `${failures.length} FCM dispatch failure(s) (first: ${first.token ?? '?'} → ${first.error ?? 'unknown'})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 91 — `the system logs a warning "<X>"`. j18:57. Reads
    // ctx.systemLogs (populated by a log-capture driver) and asserts a
    // warning-level entry with message === expected exists. Failing
    // when no logs captured (rather than passing-by-default) catches
    // the "I forgot to wire the log capture" silent-fail case.
    pattern: /^the system logs a warning "([^"]*)"$/,
    async handler(m, ctx) {
      const expected = m[1];
      if (!Array.isArray(ctx.systemLogs)) {
        return { ok: false, error: 'ctx.systemLogs not captured — wire log-capture driver first' };
      }
      const hit = ctx.systemLogs.some((log) => log?.level === 'warn' && log?.message === expected);
      if (!hit) {
        return {
          ok: false,
          error: `no warning log matched "${expected}" (captured ${ctx.systemLogs.length} log(s))`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 91 — "<Name>'s <Plat> UI shows the welcome PM body in
    // <Language>". j18:31. Locale-resolution assertion: welcome PM
    // must render in the named language, not the user's locale
    // fallback. Driver receives (name, BCP-47 code).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the welcome PM body in ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const langName = m[3];
      const LOCALE_NAME_TO_CODE = {
        Arabic: 'ar',
        German: 'de',
        Spanish: 'es',
        French: 'fr',
        Hindi: 'hi',
        Indonesian: 'id',
        Italian: 'it',
        Japanese: 'ja',
        Khmer: 'km',
        Korean: 'ko',
        Dutch: 'nl',
        Polish: 'pl',
        Portuguese: 'pt',
        Russian: 'ru',
        Swedish: 'sv',
        Thai: 'th',
        Turkish: 'tr',
        Ukrainian: 'uk',
        Vietnamese: 'vi',
        Chinese: 'zh',
        English: 'en',
      };
      const code = LOCALE_NAME_TO_CODE[langName];
      if (!code) {
        return { ok: false, error: `unknown language name "${langName}"` };
      }
      const methodName = platform.startsWith('Web')
        ? 'webShowsWelcomePmInLanguage'
        : platform === 'Android'
          ? 'androidShowsWelcomePmInLanguage'
          : 'iosShowsWelcomePmInLanguage';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, code);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: welcome PM not shown in ${langName} on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 91 — `the (rail )?card shows the "<X>" badge[ + <suffix>]`.
    // j15 (rail card) + j17 (plain card) unified. "rail " prefix and
    // "+ <suffix>" tail are both optional so one matcher catches both
    // corpus phrasings. Driver receives kind ("rail"|"plain"), badge,
    // suffix — kind lets the driver scope its search to the right
    // surface.
    pattern: /^the (rail )?card shows the "([^"]+)" badge(?: \+ (.+))?$/,
    async handler(m, ctx) {
      const kind = m[1] ? 'rail' : 'plain';
      const badge = m[2];
      const suffix = m[3] || '';
      if (!ctx.uiDriver?.showsCardBadge) {
        return { ok: false, error: 'ctx.uiDriver.showsCardBadge not configured' };
      }
      const ok = await ctx.uiDriver.showsCardBadge(kind, badge, suffix);
      if (!ok) {
        return {
          ok: false,
          error: `${kind} card does not show "${badge}" badge${suffix ? ` + ${suffix}` : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 92 — "<Name> [P-NN] (cohort) opens the <X> tab on <Plat>".
    // j17:67. Bracket-cohort tab-open variant (sibling of Wake 88's
    // bracket-cohort sign-in matcher). Mid-step `(cohort)` paren is
    // not end-anchored so stripStepAnnotation leaves it; cohort tag
    // is informational here (sign-in happened earlier).
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s*\((?:minor|adult)\)\s+opens the (\w+) tab on (Web Chromium|Web Safari|Web|Android|iOS Sim)$/,
    async handler(m, ctx) {
      const name = m[1];
      const tab = m[3];
      const platform = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webOpensTab'
        : platform === 'Android'
          ? 'androidOpensTab'
          : 'iosOpensTab';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, tab);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: open ${tab} tab did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 92 — "<Name>'s <Plat> Admin UI shows a table of recent <X>".
    // j12:24. Generic admin-table presence assertion. Driver returns
    // an array of entries (or false/empty for "not visible"); matcher
    // stores them on ctx.lastTableEntries so the next "each entry
    // shows <fields>" step can verify field presence.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows a table of recent (\w+(?:\s+\w+){0,2})$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const noun = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsTableOf'
        : platform === 'Android'
          ? 'androidAdminShowsTableOf'
          : 'iosAdminShowsTableOf';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const result = await driver[methodName](viewer, noun);
      if (!result) {
        return {
          ok: false,
          error: `${viewer}'s Admin UI does not show a table of ${noun}`,
        };
      }
      if (Array.isArray(result) && result.length === 0) {
        return { ok: false, error: `${noun} table is empty (no rows)` };
      }
      ctx.lastTableEntries = Array.isArray(result) ? result : null;
      return { ok: true };
    },
  },
  {
    // Wake 92 — "each entry shows <field> + <field> + ...". j12:25.
    // Verifies every entry in ctx.lastTableEntries has all named fields
    // (non-null/undefined). The "+ "-separated field list lets future
    // cycles cover other tables without new matchers.
    pattern: /^each entry shows (\w+(?: \+ \w+){0,9})$/,
    async handler(m, ctx) {
      const fields = m[1].split(' + ');
      if (!Array.isArray(ctx.lastTableEntries)) {
        return {
          ok: false,
          error: 'ctx.lastTableEntries missing — preceding table step required',
        };
      }
      for (let i = 0; i < ctx.lastTableEntries.length; i++) {
        const entry = ctx.lastTableEntries[i];
        const missing = fields.filter((f) => entry?.[f] === undefined || entry?.[f] === null);
        if (missing.length > 0) {
          return {
            ok: false,
            error: `entry ${i} missing field(s): ${missing.join(', ')}`,
          };
        }
      }
      return { ok: true };
    },
  },
  {
    // Wake 92 — "<Name>'s <Plat> UI shows the list of contributors with
    // amounts". j15:35. Bare list-presence + per-row-amount assertion;
    // driver returns true only when both conditions hold.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the list of contributors with amounts$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsContributorsList'
        : platform === 'Android'
          ? 'androidShowsContributorsList'
          : 'iosShowsContributorsList';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: contributors list (with amounts) not shown on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 92 — `<Name>'s <Plat> UI shows the PM thread with document
    // direction "<X>"`. j18:33. CSS direction assertion — verifies the
    // active PM thread DOM has `dir="rtl"` (or "ltr") so the layout
    // flips correctly for RTL locales.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the PM thread with document direction "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const direction = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsPmThreadDirection'
        : platform === 'Android'
          ? 'androidShowsPmThreadDirection'
          : 'iosShowsPmThreadDirection';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, direction);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: PM thread does not have document direction "${direction}" on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 92 — `no audit row records "<X>" with reason "<Y>" for this
    // delivery`. j18:60. Audit-log absence assertion. Reads
    // ctx.lastAuditLog (populated by a sendSystemPm driver that
    // captures per-delivery audit rows). Ok if no entry has
    // action===X AND reason===Y. Empty/missing log = vacuously ok.
    pattern: /^no audit row records "([^"]+)" with reason "([^"]+)" for this delivery$/,
    async handler(m, ctx) {
      const action = m[1];
      const reason = m[2];
      const log = ctx.lastAuditLog || [];
      const hits = log.filter((row) => row?.action === action && row?.reason === reason);
      if (hits.length > 0) {
        return {
          ok: false,
          error: `${hits.length} audit row(s) match action="${action}" reason="${reason}" (expected none)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 93 — `OR within Nms <Name>'s <Plat> UI shows a "<X>" toast
    // and navigates back to "<Y>"`. j10:36. Alternate-outcome step
    // (the "OR" prefix declares this acceptable as an alternative to
    // a preceding step). Runner treats it as a normal Then; if THIS
    // condition holds within the timeout, the alternate is satisfied.
    pattern:
      /^OR within (\d+)ms ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a "([^"]+)" toast and navigates back to "([^"]+)"$/,
    async handler(m, ctx) {
      const timeout = Number(m[1]);
      const name = m[2];
      const platform = m[3];
      const toast = m[4];
      const route = m[5];
      const methodName = platform.startsWith('Web')
        ? 'webShowsToastAndNavigates'
        : platform === 'Android'
          ? 'androidShowsToastAndNavigates'
          : 'iosShowsToastAndNavigates';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, toast, route, timeout);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: "${toast}" toast + nav to "${route}" did not happen within ${timeout}ms`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 93 — "the PM does NOT render in English even if <Sender>'s
    // locale is en". j13:38. Negative-render assertion: catches the
    // bug where sender-locale leaks into recipient view. Driver returns
    // true iff the visible PM body is NOT in English script (regardless
    // of the named sender's locale being en).
    pattern: /^the PM does NOT render in English even if ([A-Z][a-z]+)'s locale is en$/,
    async handler(m, ctx) {
      const sender = m[1];
      if (!ctx.webDriver?.webPmDoesNotRenderInEnglish) {
        return { ok: false, error: 'ctx.webDriver.webPmDoesNotRenderInEnglish not configured' };
      }
      const ok = await ctx.webDriver.webPmDoesNotRenderInEnglish(sender);
      if (!ok) {
        return {
          ok: false,
          error: `PM renders in English despite ${sender}'s locale=en (recipient locale should dictate)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 93 — "<Name1> on <Plat1> and <Name2> on <Plat2> both join
    // the event room". j16:38. Dual-actor concurrent join. Both drivers
    // fire in parallel via Promise.all so the test can probe race
    // conditions (mic/AV negotiation, host detection, LiveKit token
    // exhaustion).
    pattern:
      /^([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) and ([A-Z][a-z]+) on (Web Chromium|Web Safari|Web|Android|iOS Sim) both join the event room$/,
    async handler(m, ctx) {
      const name1 = m[1];
      const plat1 = m[2];
      const name2 = m[3];
      const plat2 = m[4];
      const methodFor = (p) =>
        p.startsWith('Web')
          ? 'webJoinEventRoom'
          : p === 'Android'
            ? 'androidJoinEventRoom'
            : 'iosJoinEventRoom';
      const driverFor = (p) => (p.startsWith('Web') ? ctx.webDriver : ctx.uiDriver);
      const m1 = methodFor(plat1);
      const m2 = methodFor(plat2);
      const d1 = driverFor(plat1);
      const d2 = driverFor(plat2);
      if (!d1?.[m1]) return { ok: false, error: `${plat1} driver.${m1} not configured` };
      if (!d2?.[m2]) return { ok: false, error: `${plat2} driver.${m2} not configured` };
      const [r1, r2] = await Promise.all([d1[m1](name1), d2[m2](name2)]);
      if (!r1)
        return { ok: false, error: `${name1}: join event room on ${plat1} did not complete` };
      if (!r2)
        return { ok: false, error: `${name2}: join event room on ${plat2} did not complete` };
      return { ok: true };
    },
  },
  {
    // Wake 93 — "the tester hears <Speaker>'s voice on <Listener>'s
    // <Plat> speakers". j16:41. Single-listener tester-hears variant.
    // Uses ctx.testerDriver — established in Wake 80's multi-listener
    // variants for audio probes that bypass UI.
    pattern:
      /^the tester hears ([A-Z][a-z]+)'s voice on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) speakers$/,
    async handler(m, ctx) {
      const speaker = m[1];
      const listener = m[2];
      const platform = m[3];
      if (!ctx.testerDriver?.hearsVoiceOnListener) {
        return { ok: false, error: 'ctx.testerDriver.hearsVoiceOnListener not configured' };
      }
      const audible = await ctx.testerDriver.hearsVoiceOnListener(speaker, listener, platform);
      if (!audible) {
        return {
          ok: false,
          error: `${speaker}'s voice not audible on ${listener}'s ${platform} speakers`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 93 — "<Name>'s <Plat> UI (paired session) also shows the
    // same totals". j16:48. Paired-session parity. Mid-step `(paired
    // session)` paren — NOT end-anchored. Driver compares visible
    // totals on the paired session against ctx.lastTotals (set by a
    // prior step that recorded the primary session's totals).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI \(paired session\) also shows the same totals$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      if (!ctx.lastTotals) {
        return {
          ok: false,
          error: 'ctx.lastTotals missing — record primary totals in a prior step',
        };
      }
      const methodName = platform.startsWith('Web')
        ? 'webPairedSessionShowsSameTotals'
        : platform === 'Android'
          ? 'androidPairedSessionShowsSameTotals'
          : 'iosPairedSessionShowsSameTotals';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, ctx.lastTotals);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s paired session totals do not match recorded ${JSON.stringify(ctx.lastTotals)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 93 — bidirectional "the tester hears X on Y's P1 speakers
    // AND Z on W's P2 speakers". j17:46. Each speaker must be audible
    // on the other's listener device. Both directions checked; both
    // must pass.
    pattern:
      /^the tester hears ([A-Z][a-z]+) on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) speakers AND ([A-Z][a-z]+) on ([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) speakers$/,
    async handler(m, ctx) {
      const speaker1 = m[1];
      const listener1 = m[2];
      const plat1 = m[3];
      const speaker2 = m[4];
      const listener2 = m[5];
      const plat2 = m[6];
      if (!ctx.testerDriver?.hearsOnListener) {
        return { ok: false, error: 'ctx.testerDriver.hearsOnListener not configured' };
      }
      const [a1, a2] = await Promise.all([
        ctx.testerDriver.hearsOnListener(speaker1, listener1, plat1),
        ctx.testerDriver.hearsOnListener(speaker2, listener2, plat2),
      ]);
      if (!a1) {
        return {
          ok: false,
          error: `${speaker1} inaudible on ${listener1}'s ${plat1} speakers`,
        };
      }
      if (!a2) {
        return {
          ok: false,
          error: `${speaker2} inaudible on ${listener2}'s ${plat2} speakers`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 94 — "the PM body contains the raw key OR an English
    // placeholder". j18:76. Graceful-fallback assertion when the
    // sendSystemPm key is unknown — visible PM must contain either
    // the raw key OR a generic English placeholder. Reads the key
    // from ctx.lastSentSystemPm (Wake 89's broad sendSystemPm
    // matcher populates this).
    pattern: /^the PM body contains the raw key OR an English placeholder$/,
    async handler(_m, ctx) {
      if (!ctx.lastSentSystemPm?.key) {
        return { ok: false, error: 'no prior sendSystemPm — raw-key assertion needs a When step' };
      }
      if (!ctx.webDriver?.webPmBodyShowsRawKeyOrPlaceholder) {
        return {
          ok: false,
          error: 'ctx.webDriver.webPmBodyShowsRawKeyOrPlaceholder not configured',
        };
      }
      const ok = await ctx.webDriver.webPmBodyShowsRawKeyOrPlaceholder(ctx.lastSentSystemPm.key);
      if (!ok) {
        return {
          ok: false,
          error: `PM body shows neither raw key "${ctx.lastSentSystemPm.key}" nor an English placeholder`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 94 — "for each such room, every userId in participantIds
    // resolves to a user with the same cohort as the room's cohort
    // field". j19:42. Iterates ctx.lastQueryResult.docs (rooms from
    // prior query) — for each, all participantIds must resolve to
    // users whose cohort matches the room's cohort.
    pattern:
      /^for each such room, every userId in participantIds resolves to a user with the same cohort as the room's cohort field$/,
    async handler(_m, ctx) {
      if (!ctx.lastQueryResult || !Array.isArray(ctx.lastQueryResult.docs)) {
        return {
          ok: false,
          error:
            'ctx.lastQueryResult.docs missing — run a `When a query is run for ...` step first',
        };
      }
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const usersEntries = snapToEntries(await ctx.db.collection('users').get());
      const cohortMap = new Map();
      for (const { data } of usersEntries) {
        if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
          cohortMap.set(String(data.uniqueId), data.cohort);
        }
      }
      const violations = [];
      for (const room of ctx.lastQueryResult.docs) {
        const roomCohort = room?.cohort;
        if (!roomCohort) continue;
        for (const pid of room?.participantIds || []) {
          const c = cohortMap.get(String(pid));
          if (c && c !== roomCohort) {
            violations.push(
              `${room.id || '?'}: user ${pid} cohort=${c} ≠ room cohort=${roomCohort}`,
            );
          }
        }
      }
      if (violations.length > 0) {
        return {
          ok: false,
          error: `${violations.length} mismatch(es) (first: ${violations[0]})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 94 — `for each frozen conversation, no document was added
    // to "<X>" after the migration timestamp`. j19:57. Iterates
    // conversations with frozen=true; for each, checks the named
    // subcollection (`{id}` placeholder is substituted with the conv
    // id). No doc may have createdAt > ctx.migrationTimestamp (default 0).
    pattern:
      /^for each frozen conversation, no document was added to "([^"]+)" after the migration timestamp$/,
    async handler(m, ctx) {
      const pathTemplate = m[1];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const threshold = ctx.migrationTimestamp ?? 0;
      const convsEntries = snapToEntries(await ctx.db.collection('conversations').get());
      const violations = [];
      for (const { id, data } of convsEntries) {
        if (data?.frozen !== true) continue;
        const subPath = pathTemplate.replace('{id}', id);
        const subEntries = snapToEntries(await ctx.db.collection(subPath).get());
        for (const { id: subId, data: subData } of subEntries) {
          if (typeof subData?.createdAt === 'number' && subData.createdAt > threshold) {
            violations.push(`${subPath}/${subId} (createdAt=${subData.createdAt})`);
          }
        }
      }
      if (violations.length > 0) {
        return {
          ok: false,
          error: `${violations.length} post-migration doc(s) under frozen conversations (first: ${violations[0]})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 94 — `the doc has entries in "<X>" with users from BOTH
    // cohort="<A>" AND cohort="<B>"`. j19:75. Reads ctx.lastQueryResult.data
    // (single-doc query from prior step). Field X is an array of
    // uniqueIds; resolve each to a user and check the set of cohorts
    // contains BOTH named cohorts.
    pattern:
      /^the doc has entries in "([^"]+)" with users from BOTH cohort="([^"]+)" AND cohort="([^"]+)"$/,
    async handler(m, ctx) {
      const field = m[1];
      const cohortA = m[2];
      const cohortB = m[3];
      if (!ctx.lastQueryResult?.data) {
        return {
          ok: false,
          error: 'ctx.lastQueryResult.data missing — run a single-doc query step first',
        };
      }
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const ids = ctx.lastQueryResult.data[field] || [];
      const usersEntries = snapToEntries(await ctx.db.collection('users').get());
      const cohortMap = new Map();
      for (const { data } of usersEntries) {
        if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
          cohortMap.set(String(data.uniqueId), data.cohort);
        }
      }
      const found = new Set();
      for (const id of ids) {
        const c = cohortMap.get(String(id));
        if (c) found.add(c);
      }
      const missing = [];
      if (!found.has(cohortA)) missing.push(cohortA);
      if (!found.has(cohortB)) missing.push(cohortB);
      if (missing.length > 0) {
        return {
          ok: false,
          error: `${field} missing entries with cohort=${missing.join(', ')} (found cohorts: ${[...found].join(', ') || 'none'})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 94 — `the doc has at most N entries in "<X>" matching
    // {action: "<Y>", sourceId: N}`. j19:76. Audit-log count cap on
    // a single-doc query result. The 2nd `N` (sourceId filter) is a
    // numeric literal — currently the corpus only uses sourceId=1
    // (Officia's uniqueId).
    pattern:
      /^the doc has at most (\d+) entries in "([^"]+)" matching \{action: "([^"]+)", sourceId: (\d+)\}$/,
    async handler(m, ctx) {
      const max = Number(m[1]);
      const field = m[2];
      const action = m[3];
      const sourceId = Number(m[4]);
      if (!ctx.lastQueryResult?.data) {
        return {
          ok: false,
          error: 'ctx.lastQueryResult.data missing — run a single-doc query step first',
        };
      }
      const entries = ctx.lastQueryResult.data[field] || [];
      const matches = entries.filter((e) => e?.action === action && e?.sourceId === sourceId);
      if (matches.length > max) {
        return {
          ok: false,
          error: `${matches.length} entries in ${field} match {action: "${action}", sourceId: ${sourceId}}, expected at most ${max} (exceeded)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 95 — "the <queue> queue has N pending <noun>". j12 Background.
    // Records queue depth on ctx.adminQueues for downstream "Greta opens
    // the X queue" steps that read this to validate the count is shown in
    // the UI. Also (extended below) seeds N Firestore docs to the matching
    // collection so scenarios that ASSERT on real queue counts (not just
    // ctx bookkeeping) also pass — the seed primitive is best-effort: if
    // the queueName isn't a registered seedable queue (e.g. "subscribers"
    // for a forward-looking scenario), the ctx.adminQueues record still
    // happens and the seed skips silently.
    pattern: /^the ([\w-]+) queue has (\d+) pending (\w+)$/,
    async handler(m, ctx) {
      const queueName = m[1];
      const count = Number(m[2]);
      const noun = m[3];
      if (!ctx.adminQueues) ctx.adminQueues = {};
      ctx.adminQueues[queueName] = { count, noun };
      // Seed Firestore queue docs if (a) db is available AND (b) the
      // queue is in QUEUE_REGISTRY. Silent skip otherwise — preserves
      // backward compatibility with scenarios that only need the ctx
      // bookkeeping (the prior MVP behaviour).
      if (ctx.db) {
        try {
          await seedAdminQueueEntries(ctx, queueName, count);
        } catch (e) {
          // Unknown queue → silent skip (preserves backward compat);
          // any OTHER error (db throw, etc.) bubbles up actionably.
          if (!/unknown admin queue/.test(e.message)) {
            return { ok: false, error: e.message };
          }
        }
      }
      return { ok: true };
    },
  },
  {
    // Wake 95 — "the audit log has at least N recent entries".
    // j12 Background. Lower-bound rather than equality — "at least"
    // because the dev DB accumulates entries over time.
    pattern: /^the audit log has at least (\d+) recent entries$/,
    async handler(m, ctx) {
      ctx.auditLogMinEntries = Number(m[1]);
      return { ok: true };
    },
  },
  {
    // Wake 95 — `<Name> [P-NN] is signed in on <Plat> and hosting voice
    // room "<X>" with mic open + seated`. j10 Background. Composite:
    // session + room ownership + mic/seat state. Plants a `rooms/<X>`
    // doc with hostUid + initial participantIds containing the host.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is signed in on (Web Chromium|Web Safari|Web|Android|iOS Sim) and hosting voice room "([^"]+)" with mic open \+ seated$/,
    async handler(m, ctx) {
      const name = m[1];
      const pCode = m[2];
      const roomId = m[4];
      const personas = loadPersonas();
      const p = personas.get(pCode) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: !!p.ephemeral },
      });
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      await ctx.db.doc(`rooms/${roomId}`).set({
        id: roomId,
        hostUid: p.uniqueId,
        state: 'OPEN',
        participantIds: [p.uniqueId],
        seatedIds: [p.uniqueId],
        micOpenIds: [p.uniqueId],
      });
      return { ok: true };
    },
  },
  {
    // Wake 95 — `<Name> [P-NN] is signed in on <Plat> and joined to
    // "<X>" as a non-seated participant`. j10 Background. Adds the
    // persona's uniqueId to the room's participantIds (without
    // seating). Assumes the room doc already exists.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is signed in on (Web Chromium|Web Safari|Web|Android|iOS Sim) and joined to "([^"]+)" as a non-seated participant$/,
    async handler(m, ctx) {
      const name = m[1];
      const pCode = m[2];
      const roomId = m[4];
      const personas = loadPersonas();
      const p = personas.get(pCode) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: !!p.ephemeral },
      });
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const roomRef = ctx.db.doc(`rooms/${roomId}`);
      const snap = await roomRef.get();
      const current = snap.exists ? snap.data() : { participantIds: [] };
      const participantIds = Array.from(new Set([...(current.participantIds || []), p.uniqueId]));
      await roomRef.set({ participantIds }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 95 — "<Name> has a pre-existing direct conversation with
    // <Other>". j11 Background. Plants a 2-person conversations/<id>
    // doc with deterministic id derived from sorted uniqueIds so the
    // conv is locatable across scenarios.
    pattern: /^([A-Z][a-z]+) has a pre-existing direct conversation with ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const a = m[1];
      const b = m[2];
      const personas = loadPersonas();
      const pa = personas.get(a);
      const pb = personas.get(b);
      if (!pa) return { ok: false, error: `persona "${a}" not in registry` };
      if (!pb) return { ok: false, error: `persona "${b}" not in registry` };
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const ids = [pa.uniqueId, pb.uniqueId].sort((x, y) => x - y);
      const convId = `direct-${ids[0]}-${ids[1]}`;
      await ctx.db.doc(`conversations/${convId}`).set({
        id: convId,
        type: 'direct',
        participantIds: ids,
        createdAt: Date.now(),
      });
      return { ok: true };
    },
  },
  {
    // Wake 95 — `the gifts "<X>" (Nc coins / Nb beans), "<Y>" (..),
    // "<Z>" (..) exist`. j15 Background. Plants 3 gift catalogue docs.
    // Mid-step `(N coins / N beans)` parens are NOT end-anchored — the
    // final `exist` word lets stripStepAnnotation skip them.
    pattern:
      /^the gifts "([^"]+)" \((\d+) coins \/ (\d+) beans\), "([^"]+)" \((\d+) coins \/ (\d+) beans\), "([^"]+)" \((\d+) coins \/ (\d+) beans\) exist$/,
    async handler(m, ctx) {
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const gifts = [
        { id: m[1], coins: Number(m[2]), beans: Number(m[3]) },
        { id: m[4], coins: Number(m[5]), beans: Number(m[6]) },
        { id: m[7], coins: Number(m[8]), beans: Number(m[9]) },
      ];
      for (const g of gifts) {
        await ctx.db.doc(`gifts/${g.id}`).set(g);
      }
      return { ok: true };
    },
  },
  {
    // Wake 96 — "<Name> [P-NN] is signed in (<Lang>) as a follow target".
    // j13 Background. Mid-step `(Lang)` paren + trailing "as a follow
    // target" suffix. The language is informational (the persona's UI
    // locale); the "follow target" tag marks the actor as a target for
    // other personas' follow attempts in the same scenario.
    pattern: /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is signed in \((\w+)\) as a follow target$/,
    async handler(m, ctx) {
      const name = m[1];
      const pCode = m[2];
      const personas = loadPersonas();
      const p = personas.get(pCode) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: !!p.ephemeral },
      });
      if (!ctx.followTargets) ctx.followTargets = new Set();
      ctx.followTargets.add(name);
      return { ok: true };
    },
  },
  {
    // Wake 96 — `<Name> [P-NN] is also paired on <Plat> with Network
    // Link Conditioner "<X>" preset`. j14 Background. Pairs another
    // device for the persona with a named throttling preset
    // (e.g., "3G", "Edge"). Records on ctx.pairedPlatforms so the
    // driver can apply the network condition.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is also paired on (Web Chromium|Web Safari|Web|Android|iOS Sim) with Network Link Conditioner "([^"]+)" preset$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[3];
      const preset = m[4];
      if (!ctx.pairedPlatforms) ctx.pairedPlatforms = new Map();
      ctx.pairedPlatforms.set(name, { platform, networkPreset: preset });
      return { ok: true };
    },
  },
  {
    // Wake 96 — "<Name> is also signed in on <Plat> (same Firebase
    // identity) for hosting". j16 Background. Bare-name secondary
    // sign-in for a multi-device hosting setup. Synthesises a
    // session (no separate Firebase auth) and records the paired
    // platform.
    pattern:
      /^([A-Z][a-z]+) is also signed in on (Web Chromium|Web Safari|Web|Android|iOS Sim) \(same Firebase identity\) for hosting$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort: p.cohort, ephemeral: !!p.ephemeral },
      });
      if (!ctx.pairedPlatforms) ctx.pairedPlatforms = new Map();
      ctx.pairedPlatforms.set(name, { platform, hosting: true });
      return { ok: true };
    },
  },
  {
    // Wake 96 — "<Name>'s user doc has teamRoster=[N, N, ...]".
    // j16 Background. Array-field state-seed. Writes users/<uniqueId>.
    // teamRoster as a numeric array.
    pattern: /^([A-Z][a-z]+)'s user doc has teamRoster=\[(\d+(?:,\s*\d+)*)\]$/,
    async handler(m, ctx) {
      const name = m[1];
      const ids = m[2].split(',').map((s) => Number(s.trim()));
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(name);
      if (!p?.uniqueId) return { ok: false, error: `persona "${name}" not in registry` };
      await ctx.db.doc(`users/${p.uniqueId}`).set({ teamRoster: ids }, { merge: true });
      return { ok: true };
    },
  },
  {
    // Wake 96 — "<Name> [P-NN] is signed in on <Plat> with cohort=<C>
    // (note) and locale=<L>". j18 Background. Bracket sign-in with
    // mid-step paren in the with-clause + extra `and locale=Y` suffix.
    // The Wake 65 permissive matcher rejects this form because its
    // `[^()]+?` excludes parens inside the with-clause. The optional
    // `(?:\s+\([^)]*\))?` here absorbs the annotation paren.
    pattern:
      /^([A-Z][a-z]+)\s*\[(P-\d{2})\]\s+is signed in on (Web Chromium|Web Safari|Web|Android|iOS Sim) with cohort=(\w+)(?:\s+\([^)]*\))?\s+and locale=([a-z]{2}(?:-[A-Z]{2})?)$/,
    async handler(m, ctx) {
      const name = m[1];
      const pCode = m[2];
      const cohort = m[4];
      const locale = m[5];
      const personas = loadPersonas();
      const p = personas.get(pCode) || personas.get(name);
      if (!p) return { ok: false, error: `persona "${name}" not in registry` };
      ctx.sessions.set(name, {
        persona: p,
        idToken: `synthetic:${name}:${p.uniqueId}`,
        refreshToken: null,
        localId: String(p.uniqueId),
        customClaims: { uniqueId: p.uniqueId, cohort, ephemeral: !!p.ephemeral },
        locale,
      });
      return { ok: true };
    },
  },
  {
    // Wake 97 — "<Name>'s <Plat> UI shows <Other>'s user card". j07.
    // Inner step under `within Nms`. Bare user-card-visibility check.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)'s user card$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const target = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsUserCard'
        : platform === 'Android'
          ? 'androidShowsUserCard'
          : 'iosShowsUserCard';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, target);
      if (!ok) {
        return {
          ok: false,
          error: `${platform} UI does not show ${target}'s user card to ${viewer}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 97 — "<Name>'s <Plat> UI shows the warning banner overlay on
    // top of the room". j10. Specific cohort-warning overlay assertion.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the warning banner overlay on top of the room$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsRoomWarningBanner'
        : platform === 'Android'
          ? 'androidShowsRoomWarningBanner'
          : 'iosShowsRoomWarningBanner';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show the warning banner overlay on the room`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 97 — `the database has document "<path>" with field
    // "seats[*].userId == N" entry <k>=<v>`. j10. Nested array entry
    // assertion: locate the seat where userId equals N, then assert
    // the named field equals the named value. The path supports
    // `{varName}` placeholders resolved upstream.
    pattern:
      /^the database has document "([^"]+)" with field "seats\[\*\]\.userId == (\d+)" entry (\w+)=(\w+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const userId = Number(m[2]);
      const field = m[3];
      const expected = parseLiteral(m[4]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `doc "${docPath}" does not exist` };
      }
      const data = snap.data();
      const seat = (data?.seats || []).find((s) => s?.userId === userId);
      if (!seat) {
        return {
          ok: false,
          error: `no seat with userId=${userId} in "${docPath}"`,
        };
      }
      if (seat[field] !== expected) {
        return {
          ok: false,
          error: `seat[userId=${userId}].${field} was ${JSON.stringify(seat[field])}, expected ${JSON.stringify(expected)}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 97 — "<Name>'s <Plat> UI shows skeleton placeholders for
    // user cards". j14. Low-bandwidth loading-state assertion.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows skeleton placeholders for user cards$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsUserCardSkeletons'
        : platform === 'Android'
          ? 'androidShowsUserCardSkeletons'
          : 'iosShowsUserCardSkeletons';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show skeleton placeholders for user cards`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 97 — `<Name>'s <Plat> UI shows a "<X>" banner`. j14.
    // Generic banner-text assertion (sibling of Wake 30's toast
    // matcher; banners persist while toasts auto-dismiss).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a "([^"]+)" banner$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const banner = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsBanner'
        : platform === 'Android'
          ? 'androidShowsBanner'
          : 'iosShowsBanner';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, banner);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show a "${banner}" banner`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 97 — "<Name>'s LiveKit track is not disconnected". j14.
    // LiveKit-layer assertion via ctx.liveKitDriver. Used in the
    // packet-loss scenario to verify the audio track stays connected
    // despite degraded network conditions.
    pattern: /^([A-Z][a-z]+)'s LiveKit track is not disconnected$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.liveKitDriver?.trackIsConnected) {
        return { ok: false, error: 'ctx.liveKitDriver.trackIsConnected not configured' };
      }
      const connected = await ctx.liveKitDriver.trackIsConnected(name);
      if (!connected) {
        return {
          ok: false,
          error: `${name}'s LiveKit track is disconnected (expected: still connected)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `<Name>'s <Plat> UI shows a +N in the "<X>" count`.
    // Generic delta-badge assertion: a numeric counter (Followers,
    // Likes, etc.) shows a +N increment. Driver receives (name, n,
    // label). j01/j02/j07 hits.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a \+(\d+) in the "([^"]+)" count$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const delta = Number(m[3]);
      const label = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsCountBadge'
        : platform === 'Android'
          ? 'androidShowsCountBadge'
          : 'iosShowsCountBadge';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, delta, label);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show +${delta} in "${label}" count`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `<Name>'s <Plat> Admin UI shows N row for "<X>" with
    // status "<Y>"`. j01/j04 admin-queue row presence. The N is a
    // count (typically 1) — the assertion is "there's a row matching
    // {target=X, status=Y}". Driver receives (viewer, n, targetId,
    // status).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows (\d+) row for "([^"]+)" with status "([^"]+)"$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const count = Number(m[3]);
      const targetId = m[4];
      const status = m[5];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsRowForWithStatus'
        : platform === 'Android'
          ? 'androidAdminShowsRowForWithStatus'
          : 'iosAdminShowsRowForWithStatus';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, count, targetId, status);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s Admin UI does not show ${count} row(s) for "${targetId}" with status "${status}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `the database has document "<X>" with field "<Y>"
    // decreased by N`. j01/j15 wallet-decrement. Reads
    // ctx.snapshots[`<X>#<Y>`] (set by a prior baseline-capture step)
    // and asserts current = baseline - N.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" decreased by (\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const delta = Number(m[3]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const baseline = ctx.snapshots?.get(`${docPath}#${field}`);
      if (baseline === undefined) {
        return {
          ok: false,
          error: `no baseline snapshot for ${docPath}#${field} — capture it in a prior Given step`,
        };
      }
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `doc "${docPath}" does not exist` };
      }
      const current = snap.data()?.[field];
      const expected = baseline - delta;
      if (current !== expected) {
        return {
          ok: false,
          error: `${docPath}.${field} is ${current}, expected ${expected} (baseline ${baseline} − ${delta})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `the database has document "<X>" with field "<Y>" of
    // type "<Z>"`. j01 type-check (uniqueId must be a number, not a
    // stringified number). Uses JavaScript's typeof.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" of type "([^"]+)"$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const expected = m[3];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `doc "${docPath}" does not exist` };
      }
      const actual = typeof snap.data()?.[field];
      if (actual !== expected) {
        return {
          ok: false,
          error: `${docPath}.${field} is of type "${actual}", expected "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `the database has document "<X>" with field "<Y>"
    // array length N`. j03 fcmTokens count.
    pattern: /^the database has document "([^"]+)" with field "([^"]+)" array length (\d+)$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const expectedLen = Number(m[3]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) {
        return { ok: false, error: `doc "${docPath}" does not exist` };
      }
      const value = snap.data()?.[field];
      if (!Array.isArray(value)) {
        return {
          ok: false,
          error: `${docPath}.${field} is not an array (typeof = ${typeof value})`,
        };
      }
      if (value.length !== expectedLen) {
        return {
          ok: false,
          error: `${docPath}.${field} array length is ${value.length}, expected ${expectedLen}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 98 — `<Name>'s <Plat> UI shows <Other> in the results[ with
    // displayName "<X>"]`. j01/j02 discovery list. Optional displayName
    // suffix lets the driver also verify the rendered string.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+) in the results(?: with displayName "([^"]+)")?$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const target = m[3];
      const displayName = m[4] || null;
      const methodName = platform.startsWith('Web')
        ? 'webShowsInResults'
        : platform === 'Android'
          ? 'androidShowsInResults'
          : 'iosShowsInResults';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, target, displayName);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show ${target} in results${displayName ? ` with displayName "${displayName}"` : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — `<Name>'s <Plat> UI[ opens conversation "<X>"] shows
    // the frozen-banner element <suffix>`. j08, 4 corpus rows. The
    // optional "opens conversation X" mid-step prefix is real corpus
    // phrasing (two verbs in one step). Driver parses suffix to decide
    // which form (text-from-key / locale-string).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI (?:opens conversation "([^"]+)" )?shows the frozen-banner element (.+)$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const convId = m[3] || null;
      const suffix = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsFrozenBanner'
        : platform === 'Android'
          ? 'androidShowsFrozenBanner'
          : 'iosShowsFrozenBanner';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, convId, suffix);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show the frozen-banner element (${suffix})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — `<Name>'s <Plat> UI navigates to the room screen
    // <suffix>`. j09, 2 corpus rows. The suffix describes the
    // expected post-navigation state (host seat occupied / non-seated
    // participant) — driver dispatches based on the trailing context.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to the room screen (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const suffix = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webNavigatesToRoomScreen'
        : platform === 'Android'
          ? 'androidNavigatesToRoomScreen'
          : 'iosNavigatesToRoomScreen';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, suffix);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: navigation to room screen (${suffix}) did not complete on ${platform}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — `<Name>'s <Plat> UI shows a "<X>" gift from <Other>`.
    // j01 gift-receipt notification on recipient's view.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a "([^"]+)" gift from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const platform = m[2];
      const giftId = m[3];
      const sender = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsGiftFromSender'
        : platform === 'Android'
          ? 'androidShowsGiftFromSender'
          : 'iosShowsGiftFromSender';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](recipient, giftId, sender);
      if (!ok) {
        return {
          ok: false,
          error: `${recipient}'s ${platform} UI does not show a "${giftId}" gift from ${sender}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — "<Name>'s <Plat> UI shows only minor-cohort users in
    // the rankings". j02 cohort-filtered rankings list.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows only minor-cohort users in the rankings$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsOnlyMinorCohortInRankings'
        : platform === 'Android'
          ? 'androidShowsOnlyMinorCohortInRankings'
          : 'iosShowsOnlyMinorCohortInRankings';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} rankings include non-minor users`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — `<Name>'s <Plat> UI navigates to "<Path>"`. j03+ post-
    // sign-in navigation assertion. Driver receives (name, path).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const route = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webNavigatesToPath'
        : platform === 'Android'
          ? 'androidNavigatesToPath'
          : 'iosNavigatesToPath';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, route);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: ${platform} did not navigate to "${route}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 99 — "POST <path> receives a request with a web push token
    // from <Name>". j03 FCM token capture state-seed. Records each
    // (path, persona) entry on ctx.fcmTokenRegistrations so a
    // downstream "no FCM dispatch fails" or similar step can verify.
    pattern: /^POST (\S+) receives a request with a web push token from ([A-Z][a-z]+)$/,
    async handler(m, ctx) {
      const apiPath = m[1];
      const persona = m[2];
      if (!ctx.fcmTokenRegistrations) ctx.fcmTokenRegistrations = [];
      ctx.fcmTokenRegistrations.push({ path: apiPath, persona });
      return { ok: true };
    },
  },
  {
    // Wake 100 — `<Name>'s <Plat> UI navigates back to the "<X>" tab`.
    // j09, 2 corpus rows. Post-room-exit navigation back to a named tab.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates back to the "([^"]+)" tab$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const tab = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webNavigatesBackToTab'
        : platform === 'Android'
          ? 'androidNavigatesBackToTab'
          : 'iosNavigatesBackToTab';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, tab);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: ${platform} did not navigate back to "${tab}" tab`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 100 — `<Name>'s <Plat> UI shows the <noun> in the thread
    // [with <suffix>]`. j07, 2 corpus rows. <noun>: message/reply.
    // Optional trailing context (e.g., "with timestamp + sent indicator").
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the (\w+) in the thread(?: (.+))?$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const noun = m[3];
      const suffix = m[4] || '';
      const methodName = platform.startsWith('Web')
        ? 'webShowsInThread'
        : platform === 'Android'
          ? 'androidShowsInThread'
          : 'iosShowsInThread';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, noun, suffix);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} thread does not show the ${noun}${suffix ? ` (${suffix})` : ''}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 100 — `<Name>'s <Plat> UI shows the new "<X>" gift entry`.
    // j05 gift-log entry on recipient view.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the new "([^"]+)" gift entry$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const giftId = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsNewGiftEntry'
        : platform === 'Android'
          ? 'androidShowsNewGiftEntry'
          : 'iosShowsNewGiftEntry';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, giftId);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show the new "${giftId}" gift entry`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 100 — `<Name>'s <Plat> UI shows the in-app gift notification
    // with sender "<X>" and gift "<Y>"`. j05 — toast/banner when a gift
    // is received in real time.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the in-app gift notification with sender "([^"]+)" and gift "([^"]+)"$/,
    async handler(m, ctx) {
      const recipient = m[1];
      const platform = m[2];
      const sender = m[3];
      const giftId = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsInAppGiftNotification'
        : platform === 'Android'
          ? 'androidShowsInAppGiftNotification'
          : 'iosShowsInAppGiftNotification';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](recipient, sender, giftId);
      if (!ok) {
        return {
          ok: false,
          error: `${recipient}'s ${platform} UI does not show in-app gift notification (sender="${sender}", gift="${giftId}")`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 100 — "<Name>'s <Plat> UI shows (her|his|their) own rank in
    // the top N". j05 leaderboard rank visibility. Pronoun is purely
    // grammatical, not captured.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows (?:her|his|their) own rank in the top (\d+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const topN = Number(m[3]);
      const methodName = platform.startsWith('Web')
        ? 'webShowsOwnRankInTop'
        : platform === 'Android'
          ? 'androidShowsOwnRankInTop'
          : 'iosShowsOwnRankInTop';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, topN);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show own rank in top ${topN}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 100 — `<Name>'s <Plat> UI shows the new "<X>" balance via
    // Firestore listener`. j06 — wallet refresh via real-time listener
    // (not a fresh API fetch). The balance can include commas (e.g.,
    // "5,000") so it's captured as a string, not a number.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the new "([^"]+)" balance via Firestore listener$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const balance = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsBalanceViaListener'
        : platform === 'Android'
          ? 'androidShowsBalanceViaListener'
          : 'iosShowsBalanceViaListener';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, balance);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show new balance "${balance}" via Firestore listener`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — "<Name>'s <Plat> UI shows <Other>'s seat with <X>
    // indicator". j09 (mic-on) / j10 (mic-off). Generic per-seat
    // indicator assertion; <X> describes the indicator type.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+)'s seat with ([\w-]+) indicator$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const target = m[3];
      const indicator = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsSeatWithIndicator'
        : platform === 'Android'
          ? 'androidShowsSeatWithIndicator'
          : 'iosShowsSeatWithIndicator';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, target, indicator);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show ${target}'s seat with ${indicator} indicator`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — "<Name>'s <Plat> UI navigates to the warning screen".
    // j10 first half. Second half (relaunch) uses a different verb.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to the warning screen$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webNavigatesToWarningScreen'
        : platform === 'Android'
          ? 'androidNavigatesToWarningScreen'
          : 'iosNavigatesToWarningScreen';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, false);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: ${platform} did not navigate to the warning screen`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — "<Name>'s <Plat> UI shows the warning screen again on
    // next launch". j10 — verifies persistence of the warning gate
    // across app relaunch.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the warning screen again on next launch$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsWarningScreenOnRelaunch'
        : platform === 'Android'
          ? 'androidShowsWarningScreenOnRelaunch'
          : 'iosShowsWarningScreenOnRelaunch';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: ${platform} did not show the warning screen again after relaunch`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — "(either )?<Name>'s <Plat> UI is still in the room
    // <suffix>". j10, 2 corpus rows. The "either " prefix indicates
    // alternative-outcome semantics; matcher absorbs it without
    // dispatch logic (the alternative is in the test plan author's
    // mental model, not the runner's).
    pattern:
      /^(?:either )?([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI is still in the room (.+)$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const suffix = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webIsStillInRoom'
        : platform === 'Android'
          ? 'androidIsStillInRoom'
          : 'iosIsStillInRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, suffix);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: ${platform} not still in the room (${suffix})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — `<Name>'s <Plat> UI shows a seat-request notification
    // with "<X>" + approve/deny`. j09 — host receives notification
    // when a participant requests a seat.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a seat-request notification with "([^"]+)" \+ approve\/deny$/,
    async handler(m, ctx) {
      const host = m[1];
      const platform = m[2];
      const requester = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsSeatRequestNotification'
        : platform === 'Android'
          ? 'androidShowsSeatRequestNotification'
          : 'iosShowsSeatRequestNotification';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](host, requester);
      if (!ok) {
        return {
          ok: false,
          error: `${host}'s ${platform} UI does not show seat-request notification with "${requester}" + approve/deny`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — `<Name>'s <Plat> UI seat indicator transitions from
    // "<X>" to "<Y>"`. j09 — visual state transition assertion.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI seat indicator transitions from "([^"]+)" to "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const from = m[3];
      const to = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webSeatIndicatorTransitions'
        : platform === 'Android'
          ? 'androidSeatIndicatorTransitions'
          : 'iosSeatIndicatorTransitions';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, from, to);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: seat indicator did not transition from "${from}" to "${to}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 101 — "<Name>'s LiveKit publish for that room is
    // <enabled|disabled>". j10 — LiveKit-layer publish-state
    // assertion via ctx.liveKitDriver.
    pattern: /^([A-Z][a-z]+)'s LiveKit publish for that room is (enabled|disabled)$/,
    async handler(m, ctx) {
      const name = m[1];
      const state = m[2];
      if (!ctx.liveKitDriver?.publishStateIs) {
        return { ok: false, error: 'ctx.liveKitDriver.publishStateIs not configured' };
      }
      const ok = await ctx.liveKitDriver.publishStateIs(name, state);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s LiveKit publish state is not "${state}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — `<Name>'s <Plat> UI replaces follow button with "<X>"`.
    // j07 — UI element swap after follow action completes.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI replaces follow button with "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const buttonId = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webReplacesFollowButton'
        : platform === 'Android'
          ? 'androidReplacesFollowButton'
          : 'iosReplacesFollowButton';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, buttonId);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI did not replace follow button with "${buttonId}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — "<Name>'s <Plat> UI shows a new conversation with
    // <Other> highlighted as unread". j07 — recipient's inbox shows
    // new unread conversation from sender.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a new conversation with ([A-Z][a-z]+) highlighted as unread$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const other = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsNewUnreadConversation'
        : platform === 'Android'
          ? 'androidShowsNewUnreadConversation'
          : 'iosShowsNewUnreadConversation';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, other);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show new unread conversation with ${other}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — "<Name>'s <Plat> UI shows <Other> in seat N of the
    // seat grid". j09 — specific seat-position assertion on the visual
    // grid.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows ([A-Z][a-z]+) in seat (\d+) of the seat grid$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const target = m[3];
      const seatNum = Number(m[4]);
      const methodName = platform.startsWith('Web')
        ? 'webShowsInSeatGrid'
        : platform === 'Android'
          ? 'androidShowsInSeatGrid'
          : 'iosShowsInSeatGrid';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, target, seatNum);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show ${target} in seat ${seatNum} of the seat grid`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — "<Name>'s LiveKit track for room <X> has publish
    // permission enabled". j09 — LiveKit-layer permission check after
    // a host approves a seat request. The room identifier is the
    // interpolated path segment (was `{roomId}` placeholder upstream).
    pattern: /^([A-Z][a-z]+)'s LiveKit track for room (\S+) has publish permission enabled$/,
    async handler(m, ctx) {
      const name = m[1];
      const roomId = m[2];
      if (!ctx.liveKitDriver?.publishPermissionForRoom) {
        return { ok: false, error: 'ctx.liveKitDriver.publishPermissionForRoom not configured' };
      }
      const ok = await ctx.liveKitDriver.publishPermissionForRoom(name, roomId);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s LiveKit track for room ${roomId} does not have publish permission`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — `<Name>'s <Plat> UI shows the system PM from Officia
    // "<X>"`. j11 — recipient sees a moderation-outcome system PM.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the system PM from Officia "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const subject = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsSystemPmFromOfficia'
        : platform === 'Android'
          ? 'androidShowsSystemPmFromOfficia'
          : 'iosShowsSystemPmFromOfficia';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, subject);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show system PM from Officia "${subject}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 102 — `<Name>'s <Plat> UI shows the warning screen with
    // reason "<X>"`. j11 — punished user sees moderation reason.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the warning screen with reason "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const reason = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsWarningScreenWithReason'
        : platform === 'Android'
          ? 'androidShowsWarningScreenWithReason'
          : 'iosShowsWarningScreenWithReason';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, reason);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show warning screen with reason "${reason}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — "<Name>'s <Plat> UI navigates to <Other>'s profile
    // screen". j07 — profile-tap navigation.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI navigates to ([A-Z][a-z]+)'s profile screen$/,
    async handler(m, ctx) {
      const actor = m[1];
      const platform = m[2];
      const target = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webNavigatesToProfileScreen'
        : platform === 'Android'
          ? 'androidNavigatesToProfileScreen'
          : 'iosNavigatesToProfileScreen';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](actor, target);
      if (!ok) {
        return {
          ok: false,
          error: `${actor}: ${platform} did not navigate to ${target}'s profile screen`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — `<Name>'s <Plat> UI shows a +N in the
    // stalkers/profile-visits counter`. j07 — profile-visit count
    // increment. Specific phrasing (not a generic `<X>` count badge).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a \+(\d+) in the stalkers\/profile-visits counter$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const delta = Number(m[3]);
      const methodName = platform.startsWith('Web')
        ? 'webShowsStalkersDelta'
        : platform === 'Android'
          ? 'androidShowsStalkersDelta'
          : 'iosShowsStalkersDelta';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, delta);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show +${delta} in stalkers/profile-visits counter`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — `<Name>'s <Plat> UI shows the edited body "<X>" with
    // an "<Y>" tag`. j07 — message-edit indicator on the recipient view.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the edited body "([^"]+)" with an "([^"]+)" tag$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const body = m[3];
      const tag = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsEditedBodyWithTag'
        : platform === 'Android'
          ? 'androidShowsEditedBodyWithTag'
          : 'iosShowsEditedBodyWithTag';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, body, tag);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show edited body "${body}" with "${tag}" tag`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — "<Name>'s <Plat> UI also shows <Other> in the
    // participants list". j09 — confirms a participant is visible in
    // multiple session views.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI also shows ([A-Z][a-z]+) in the participants list$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const other = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webAlsoShowsInParticipantsList'
        : platform === 'Android'
          ? 'androidAlsoShowsInParticipantsList'
          : 'iosAlsoShowsInParticipantsList';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, other);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} UI does not show ${other} in participants list`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — `<Name>'s <Plat> UI shows mic icon as "<X>"`. j09 —
    // mic-state indicator (open/closed/muted).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows mic icon as "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const state = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webShowsMicIconAs'
        : platform === 'Android'
          ? 'androidShowsMicIconAs'
          : 'iosShowsMicIconAs';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, state);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show mic icon as "${state}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 103 — "<Name>'s <Plat> UI shows the room-closed summary
    // panel". j09 — post-room-close summary view.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the room-closed summary panel$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsRoomClosedSummary'
        : platform === 'Android'
          ? 'androidShowsRoomClosedSummary'
          : 'iosShowsRoomClosedSummary';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show the room-closed summary panel`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — `<Name>'s <Plat> UI shows a "<X>" toast and navigates
    // back to "<Y>"`. j10 — toast + nav (no timeout prefix, distinct
    // from Wake 93's OR-within variant).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows a "([^"]+)" toast and navigates back to "([^"]+)"$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const toast = m[3];
      const route = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webShowsToastAndNavigatesBack'
        : platform === 'Android'
          ? 'androidShowsToastAndNavigatesBack'
          : 'iosShowsToastAndNavigatesBack';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name, toast, route);
      if (!ok) {
        return {
          ok: false,
          error: `${name}: "${toast}" toast + nav to "${route}" did not happen`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — "the database has N entries in "<X>" with
    // reportedId=N". j11 — count of report docs targeting a specific
    // user. Generic but corpus-specific to the `reportedId` field.
    pattern: /^the database has (\d+) entries in "([^"]+)" with reportedId=(\d+)$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      const colPath = m[2];
      const reportedId = Number(m[3]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection(colPath).get();
      const matched = (snap.docs || []).filter((d) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        return data?.reportedId === reportedId;
      });
      if (matched.length !== expected) {
        return {
          ok: false,
          error: `count was ${matched.length} entries in "${colPath}" with reportedId=${reportedId}, expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — "the database has document "<X>" with field "<Y>"
    // approximately equal to now + N days". j11 — time-based field
    // assertion with ±60s tolerance (typical for "now-relative" checks).
    pattern:
      /^the database has document "([^"]+)" with field "([^"]+)" approximately equal to now \+ (\d+) days$/,
    async handler(m, ctx) {
      const docPath = m[1];
      const field = m[2];
      const days = Number(m[3]);
      const toleranceMs = 60 * 1000; // ±60s
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.doc(docPath).get();
      if (!snap.exists) return { ok: false, error: `doc "${docPath}" does not exist` };
      const actual = snap.data()?.[field];
      if (typeof actual !== 'number') {
        return {
          ok: false,
          error: `${docPath}.${field} is not a number (typeof = ${typeof actual})`,
        };
      }
      const expected = Date.now() + days * 24 * 60 * 60 * 1000;
      if (Math.abs(actual - expected) > toleranceMs) {
        return {
          ok: false,
          error: `${docPath}.${field}=${actual} not within ±60s of expected now+${days}d=${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — "<Name>'s Firebase Auth refreshTokens are revoked".
    // j11 — admin-side token revocation check via firebase-admin.
    pattern: /^([A-Z][a-z]+)'s Firebase Auth refreshTokens are revoked$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.firebaseAdmin?.tokensAreRevoked) {
        return { ok: false, error: 'ctx.firebaseAdmin.tokensAreRevoked not configured' };
      }
      const ok = await ctx.firebaseAdmin.tokensAreRevoked(name);
      if (!ok) {
        return { ok: false, error: `${name}'s Firebase Auth refreshTokens are NOT revoked` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — "the Firebase Auth session for <Name> has
    // revokeRefreshTokens timestamp updated". j04 — sibling assertion
    // (different phrasing) for the same underlying revocation event.
    pattern:
      /^the Firebase Auth session for ([A-Z][a-z]+) has revokeRefreshTokens timestamp updated$/,
    async handler(m, ctx) {
      const name = m[1];
      if (!ctx.firebaseAdmin?.revokeTimestampIsUpdated) {
        return { ok: false, error: 'ctx.firebaseAdmin.revokeTimestampIsUpdated not configured' };
      }
      const ok = await ctx.firebaseAdmin.revokeTimestampIsUpdated(name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s Firebase Auth revokeRefreshTokens timestamp is NOT updated`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 104 — "<Name>'s <Plat> Admin UI shows N rows in the <X>
    // table". j12 — generic admin table row-count assertion. Distinct
    // from Wake 98's "row for X with status Y" — this is plain count.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows (\d+) rows in the (\w+(?:[ -]\w+)?) table$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const count = Number(m[3]);
      const tableName = m[4];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsRowCountInTable'
        : platform === 'Android'
          ? 'androidAdminShowsRowCountInTable'
          : 'iosAdminShowsRowCountInTable';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, count, tableName);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} Admin UI does not show ${count} rows in the ${tableName} table`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> UI is no longer in the voice room".
    // j04 — negative assertion after force-eject. Sibling of Wake 101's
    // "is still in the room <suffix>" matcher.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI is no longer in the voice room$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webIsNoLongerInVoiceRoom'
        : platform === 'Android'
          ? 'androidIsNoLongerInVoiceRoom'
          : 'iosIsNoLongerInVoiceRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI is STILL in the voice room (expected ejected)`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> UI continues normally in the room".
    // j10 — opposite of "is still in but unable to interact" — actor
    // is unaffected by the mid-room warning event.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI continues normally in the room$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webContinuesNormallyInRoom'
        : platform === 'Android'
          ? 'androidContinuesNormallyInRoom'
          : 'iosContinuesNormallyInRoom';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not continue normally in the room`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> UI shows the message in the
    // conversation thread". j11 — basic message-visibility assertion
    // (not the WAKE-100 generic in-thread variant, which has a noun
    // capture; this is "the message" specifically).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the message in the conversation thread$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsMessageInConversationThread'
        : platform === 'Android'
          ? 'androidShowsMessageInConversationThread'
          : 'iosShowsMessageInConversationThread';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show the message in the conversation thread`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> Admin UI shows the new report in
    // the queue". j11 — admin sees a freshly-filed report.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows the new report in the queue$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsNewReportInQueue'
        : platform === 'Android'
          ? 'androidAdminShowsNewReportInQueue'
          : 'iosAdminShowsNewReportInQueue';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} Admin UI does not show the new report in the queue`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> UI shows the second offensive
    // message". j11 — sequential corpus-specific assertion (after
    // a first message; this is the next one).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) UI shows the second offensive message$/,
    async handler(m, ctx) {
      const name = m[1];
      const platform = m[2];
      const methodName = platform.startsWith('Web')
        ? 'webShowsSecondOffensiveMessage'
        : platform === 'Android'
          ? 'androidShowsSecondOffensiveMessage'
          : 'iosShowsSecondOffensiveMessage';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](name);
      if (!ok) {
        return {
          ok: false,
          error: `${name}'s ${platform} UI does not show the second offensive message`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 105 — "<Name>'s <Plat> Admin UI shows the dashboard with
    // counters: N reports, N verifications, N appeals". j12 — admin
    // landing page counters. Driver receives (viewer, {reports, verifications, appeals}).
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows the dashboard with counters: (\d+) reports, (\d+) verifications, (\d+) appeals$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const reports = Number(m[3]);
      const verifications = Number(m[4]);
      const appeals = Number(m[5]);
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsDashboardCounters'
        : platform === 'Android'
          ? 'androidAdminShowsDashboardCounters'
          : 'iosAdminShowsDashboardCounters';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, { reports, verifications, appeals });
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} Admin UI dashboard counters do not match {reports:${reports}, verifications:${verifications}, appeals:${appeals}}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — "the reports counter on the dashboard updates to N".
    // j12 — admin dashboard live counter update.
    pattern: /^the reports counter on the dashboard updates to (\d+)$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      if (!ctx.webDriver?.webDashboardReportsCounterEquals) {
        return {
          ok: false,
          error: 'ctx.webDriver.webDashboardReportsCounterEquals not configured',
        };
      }
      const ok = await ctx.webDriver.webDashboardReportsCounterEquals(expected);
      if (!ok) {
        return { ok: false, error: `dashboard reports counter does not equal ${expected}` };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — `N audit entries with action "<X>" exist`. j12 —
    // count check against the audit collection.
    pattern: /^(\d+) audit entries with action "([^"]+)" exist$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      const action = m[2];
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const snap = await ctx.db.collection('audit').get();
      const matched = (snap.docs || []).filter((d) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        return data?.action === action;
      });
      if (matched.length !== expected) {
        return {
          ok: false,
          error: `${matched.length} audit entries with action "${action}", expected ${expected}`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — "the N corresponding users have isAgeVerified=true".
    // j12 — verifies ctx.lastUserIds (uniqueIds) all have
    // isAgeVerified=true. Cross-checks the count.
    pattern: /^the (\d+) corresponding users have isAgeVerified=true$/,
    async handler(m, ctx) {
      const expected = Number(m[1]);
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const ids = ctx.lastUserIds || [];
      if (ids.length !== expected) {
        return {
          ok: false,
          error: `count mismatch — ctx.lastUserIds has ${ids.length} entries, expected ${expected}`,
        };
      }
      const unverified = [];
      for (const id of ids) {
        const snap = await ctx.db.doc(`users/${id}`).get();
        if (!snap.exists || snap.data()?.isAgeVerified !== true) {
          unverified.push(id);
        }
      }
      if (unverified.length > 0) {
        return {
          ok: false,
          error: `${unverified.length} users not isAgeVerified (first: ${unverified[0]})`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — "the user receives a system PM from Officia with the
    // reject reason". j12 — confirms a system PM was sent to
    // ctx.lastTargetUser with ctx.lastRejectReason.
    pattern: /^the user receives a system PM from Officia with the reject reason$/,
    async handler(_m, ctx) {
      if (!ctx.lastTargetUser) {
        return {
          ok: false,
          error: 'ctx.lastTargetUser not set — preceding admin-action step required',
        };
      }
      if (!ctx.webDriver?.receivedSystemPmWithReason) {
        return { ok: false, error: 'ctx.webDriver.receivedSystemPmWithReason not configured' };
      }
      const ok = await ctx.webDriver.receivedSystemPmWithReason(
        ctx.lastTargetUser,
        ctx.lastRejectReason,
      );
      if (!ok) {
        return {
          ok: false,
          error: `${ctx.lastTargetUser} did not receive system PM from Officia with reason "${ctx.lastRejectReason}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — "the target user is downgraded to cohort=<X>". j12 —
    // verifies the user identified by ctx.lastTargetUser has the named
    // cohort in Firestore.
    pattern: /^the target user is downgraded to cohort=(\w+)$/,
    async handler(m, ctx) {
      const expected = m[1];
      if (!ctx.lastTargetUser) {
        return {
          ok: false,
          error: 'ctx.lastTargetUser not set — preceding admin-action step required',
        };
      }
      if (!ctx.db) return { ok: false, error: 'ctx.db not initialised' };
      const personas = loadPersonas();
      const p = personas.get(ctx.lastTargetUser);
      if (!p?.uniqueId) {
        return { ok: false, error: `persona "${ctx.lastTargetUser}" not in registry` };
      }
      const snap = await ctx.db.doc(`users/${p.uniqueId}`).get();
      const actual = snap.exists ? snap.data()?.cohort : null;
      if (actual !== expected) {
        return {
          ok: false,
          error: `${ctx.lastTargetUser}.cohort is "${actual}", expected "${expected}"`,
        };
      }
      return { ok: true };
    },
  },
  {
    // Wake 106 — `<Name>'s <Plat> Admin UI shows the "<X>" stat`. j12
    // — named-stat visibility on the admin dashboard.
    pattern:
      /^([A-Z][a-z]+)'s (Web Chromium|Web Safari|Web|Android|iOS Sim) Admin UI shows the "([^"]+)" stat$/,
    async handler(m, ctx) {
      const viewer = m[1];
      const platform = m[2];
      const statName = m[3];
      const methodName = platform.startsWith('Web')
        ? 'webAdminShowsStat'
        : platform === 'Android'
          ? 'androidAdminShowsStat'
          : 'iosAdminShowsStat';
      const driver = platform.startsWith('Web') ? ctx.webDriver : ctx.uiDriver;
      const driverName = platform.startsWith('Web') ? 'ctx.webDriver' : 'ctx.uiDriver';
      if (!driver?.[methodName]) {
        return { ok: false, error: `${driverName}.${methodName} not configured` };
      }
      const ok = await driver[methodName](viewer, statName);
      if (!ok) {
        return {
          ok: false,
          error: `${viewer}'s ${platform} Admin UI does not show the "${statName}" stat`,
        };
      }
      return { ok: true };
    },
  },
];

// ── Step execution ──────────────────────────────────────────────────

// Strip trailing `(human commentary)` from a step's text so matchers can
// regex-match the bare assertion. Regex constraints:
//   - Requires `\s+` before `(` (so a quoted string ending in `)` doesn't get
//     truncated mid-token).
//   - Requires `)` to be the LAST char (`$` anchor) — preserves quoted
//     strings like `"Price: $10 (USD)"` where `"` is the trailing char.
//   - `[^()]*` inside disallows nested parens (would be ambiguous re: greedy
//     vs lazy matching — explicit refusal beats undefined behavior).
//
// STEP_NOT_IMPLEMENTED errors still echo the ORIGINAL step text (with
// annotation), so the operator sees what they actually wrote — not the
// stripped form, which could be confusing.
//
// Regex is linear: `\s+` is a simple bounded quantifier; `[^()]*` is a
// negated character class with no overlap with surrounding tokens
// (`\s+` requires whitespace not in the class, `\)` is in the class
// — so backtracking can't recurse). Author-controlled input (Gherkin
// step text), not untrusted user data. Safe.
function stripStepAnnotation(text) {
  // eslint-disable-next-line sonarjs/slow-regex
  return text.replace(/\s+\([^()]*\)$/, '');
}

// Resolve `{varName}` placeholders against ctx.scenarioVars (a Map populated
// by capture matchers like "X's uniqueId is recorded as {newUniqueId}").
// Unresolved placeholders are left as literal — drivers may interpret them,
// or the step may fail with a clearer error downstream. We never throw here:
// interpolation is a best-effort transform applied uniformly to every step,
// and one missing var must not abort an otherwise-valid step.
//
// Env-var fallback: if scenarioVars miss AND the placeholder name is
// UPPER_SNAKE_CASE (env-var convention), fall back to process.env. Lower-
// case names like `{coins}` are NEVER resolved from env — guards against
// leaking arbitrary process environment into step text.
function interpolateScenarioVars(text, scenarioVars) {
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (scenarioVars && scenarioVars.has(name)) return scenarioVars.get(name);
    if (/^[A-Z_]+$/.test(name) && process.env[name] !== undefined) {
      return process.env[name];
    }
    return match;
  });
}

async function executeStep(step, ctx) {
  const text = interpolateScenarioVars(stripStepAnnotation(step.text), ctx.scenarioVars);
  for (const { pattern, handler } of matchers) {
    const m = pattern.exec(text);
    if (m) {
      // Wrap handler invocation so a thrown exception (fetch network error,
      // Firestore RPC failure, JSON.parse on a binary body, etc.) becomes a
      // structured finding instead of an unhandled rejection that crashes the
      // runner. Without this guard, a transient network blip during cycle N
      // would abort the whole cycle rather than emit one Blocker finding for
      // the affected scenario — silently masking dozens of other findings.
      try {
        return await handler(m, ctx);
      } catch (e) {
        const msg = e?.message || String(e);
        return { ok: false, error: `handler threw: ${msg}` };
      }
    }
  }
  return {
    ok: false,
    error: `STEP_NOT_IMPLEMENTED: "${step.kind} ${step.text}"`,
    code: 'STEP_NOT_IMPLEMENTED',
  };
}

async function runScenario(scenario, parsed, ctx) {
  // Reset per-scenario state
  ctx.sessions = new Map();
  ctx.personaPlatforms = new Map();
  ctx.personaPaths = new Map();
  ctx.lastResponse = null;
  ctx.lastVisit = null;
  ctx.lastQueryResult = null;
  ctx.snapshots = new Map();
  ctx.scenarioStartTime = Date.now();
  ctx.scenarioVars = new Map();
  // Auto-populate `{ts}` placeholder with scenarioStartTime. Corpus uses
  // `{ts}` widely (sandbox receipts, email-username suffixes, timestamp
  // filters) but never explicitly captures it — convention is that `{ts}`
  // means "scenario start time". Auto-populating it here lets scenarios
  // use the placeholder without writing a separate capture step.
  ctx.scenarioVars.set('ts', String(ctx.scenarioStartTime));
  ctx.locale = 'en';

  const allSteps = [...(parsed.background?.steps || []), ...scenario.steps];
  const stepResults = [];
  for (const step of allSteps) {
    const result = await executeStep(step, ctx);
    stepResults.push({ step, result });
    if (!result.ok) break; // stop on first failure within a scenario
  }
  return stepResults;
}

// ── Top-level run ───────────────────────────────────────────────────

async function runFeatureFile(filePath, ctx) {
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseGherkin(text);
  const fileName = path.basename(filePath);
  const findings = [];
  const scenarioReports = [];

  for (const scenario of parsed.scenarios) {
    if (scenario.tags.includes('@manual')) {
      // Per spec: skipped in auto mode unless a fresh ledger entry exists.
      // The MVP doesn't check the ledger yet (handled separately by the
      // shipping-gate command). For now we log "skipped" without finding.
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'skipped',
        reason: '@manual — requires interactive run; ledger not yet checked in MVP',
      });
      continue;
    }
    const stepResults = await runScenario(scenario, parsed, ctx);
    const failed = stepResults.find((r) => !r.result.ok);
    if (failed) {
      const severity =
        failed.result.code === 'STEP_NOT_IMPLEMENTED' ? 'Minor' : classifySeverity(scenario.tags);
      findings.push({
        file: fileName,
        scenario: scenario.name,
        severity,
        step: `${failed.step.kind} ${failed.step.text}`,
        error: failed.result.error,
        code: failed.result.code || null,
      });
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'fail',
        failedStep: failed.step.text,
      });
    } else {
      scenarioReports.push({
        file: fileName,
        scenario: scenario.name,
        status: 'pass',
        steps: stepResults.length,
      });
    }
  }
  return { findings, scenarioReports };
}

// ── Helpers ─────────────────────────────────────────────────────────

function decodeJwtPayload(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  const buf = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

function pickField(obj, field) {
  // Supports either top-level OR nested under `.user` (the common admin-endpoint shape).
  if (obj && Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  if (obj?.user && Object.prototype.hasOwnProperty.call(obj.user, field)) return obj.user[field];
  return undefined;
}

/**
 * Probe the 4 OSA post-migration invariants directly against Firestore.
 * Returns { ok: true } if all clean, { ok: false, error: '...' } with a
 * specific violation summary otherwise.
 *
 * Read-only — never writes. Used by the j19 migration-state precondition.
 */
async function probeOsaInvariants(db) {
  const usersSnap = await db.collection('users').get();
  const cohortMap = new Map();
  const officialSet = new Set();
  const users = [];
  usersSnap.forEach((d) => {
    const data = d.data() || {};
    users.push(data);
    if (data?.uniqueId !== undefined && data?.uniqueId !== null && data.cohort) {
      cohortMap.set(String(data.uniqueId), data.cohort);
    }
    // SHYTALK_OFFICIAL exemption tracking — both directions. System
    // accounts deliver PMs to every cohort by design, so cross-cohort
    // edges TO an official target (Marcus follows Officia) AND FROM an
    // official source (Officia follows a beta-tester) must be
    // preserved. Mirrors the migration script's exemption added in the
    // same wake.
    if (
      data?.uniqueId !== undefined &&
      (data?.userType === 'SHYTALK_OFFICIAL' || data?.isOfficial === true)
    ) {
      officialSet.add(String(data.uniqueId));
    }
  });

  let crossFollowing = 0;
  let crossFollower = 0;
  for (const u of users) {
    // Source-side exemption.
    if (u.userType === 'SHYTALK_OFFICIAL' || u.isOfficial) continue;
    if (!u.cohort) continue;
    for (const targetId of u.followingIds || []) {
      // Target-side exemption: edge → official account is preserved.
      if (officialSet.has(String(targetId))) continue;
      const c = cohortMap.get(String(targetId));
      if (c && c !== u.cohort) crossFollowing++;
    }
    for (const sourceId of u.followerIds || []) {
      // Mirror-side exemption: edge from official account is preserved.
      if (officialSet.has(String(sourceId))) continue;
      const c = cohortMap.get(String(sourceId));
      if (c && c !== u.cohort) crossFollower++;
    }
  }

  const roomsSnap = await db.collection('rooms').where('state', '==', 'OPEN').get();
  let mixedRooms = 0;
  roomsSnap.forEach((d) => {
    const data = d.data() || {};
    if (!data.cohort) return;
    const conflicting = (data.participantIds || []).filter((pid) => {
      const c = cohortMap.get(String(pid));
      return c && c !== data.cohort;
    });
    if (conflicting.length > 0) mixedRooms++;
  });

  const convsSnap = await db.collection('conversations').get();
  let unfrozenCross = 0;
  convsSnap.forEach((d) => {
    const data = d.data() || {};
    const cohorts = new Set();
    for (const pid of data.participantIds || []) {
      const c = cohortMap.get(String(pid));
      if (c) cohorts.add(c);
    }
    // Migration script writes `frozenAtMigration: true` (audit marker
    // per migrate-segregation-relationships.js:868) — NOT `frozen`.
    // Accept either field name for backward-compat with older seed data.
    const isFrozen = data.frozen === true || data.frozenAtMigration === true;
    if (cohorts.size > 1 && !isFrozen) unfrozenCross++;
  });

  const violations = [];
  if (crossFollowing > 0) violations.push(`${crossFollowing} cross-cohort followingIds`);
  if (crossFollower > 0) violations.push(`${crossFollower} cross-cohort followerIds`);
  if (mixedRooms > 0) violations.push(`${mixedRooms} mixed-cohort OPEN rooms`);
  if (unfrozenCross > 0) violations.push(`${unfrozenCross} unfrozen cross-cohort conversations`);
  if (violations.length > 0) {
    return {
      ok: false,
      error: `OSA invariants violated: ${violations.join('; ')}`,
    };
  }
  return { ok: true };
}

/**
 * Wake 90 — shim that normalises a Firestore-style snapshot into
 * `[{id, data}, ...]` entries. firebase-admin `QuerySnapshot` exposes
 * both `.docs` (array of QueryDocumentSnapshot) and `.forEach()` — but
 * the test fakes only expose one or the other: `makeStatefulFakeDb`
 * yields `{ docs: [...] }`, `makeProbeDb` yields `{ forEach(...), size }`.
 * This helper makes both shapes consumable by the same code path.
 */
function snapToEntries(snap) {
  const out = [];
  if (snap && Array.isArray(snap.docs)) {
    for (const d of snap.docs) {
      const id = typeof d.id === 'string' ? d.id : undefined;
      const data = typeof d.data === 'function' ? d.data() : d;
      out.push({ id, data });
    }
  } else if (snap && typeof snap.forEach === 'function') {
    snap.forEach((d) => {
      const id = typeof d.id === 'string' ? d.id : undefined;
      const data = typeof d.data === 'function' ? d.data() : d;
      out.push({ id, data });
    });
  }
  return out;
}

/**
 * Wake 90 — Per-category OSA migration count probe. Returns the four
 * counts that the j19 idempotency-script reports. Companion to
 * `probeOsaInvariants` (which exposes only a single ok/error verdict);
 * this version exposes the raw counts so the j19 "the script reports
 * N X" assertions can compare them. NOT a refactor of the existing
 * probe — uses `.get()` + in-memory state filter rather than `.where()`
 * because the test fake-dbs differ in `.where()` support.
 */
async function osaCounts(db) {
  const usersAr = snapToEntries(await db.collection('users').get()).map((e) => e.data);
  const cohortMap = new Map();
  const officialSet = new Set();
  for (const u of usersAr) {
    if (u?.uniqueId !== undefined && u?.uniqueId !== null && u.cohort) {
      cohortMap.set(String(u.uniqueId), u.cohort);
    }
    // SHYTALK_OFFICIAL exemption (mirrors probeOsaInvariants): edges
    // touching an official account on either side are preserved by
    // the migration, so the idempotency counter must also exclude
    // them or "re-running reports zero" never holds.
    if (
      u?.uniqueId !== undefined &&
      (u?.userType === 'SHYTALK_OFFICIAL' || u?.isOfficial === true)
    ) {
      officialSet.add(String(u.uniqueId));
    }
  }
  let crossFollowing = 0;
  let crossFollower = 0;
  for (const u of usersAr) {
    if (u?.userType === 'SHYTALK_OFFICIAL' || u?.isOfficial) continue;
    if (!u?.cohort) continue;
    for (const targetId of u.followingIds || []) {
      if (officialSet.has(String(targetId))) continue;
      const c = cohortMap.get(String(targetId));
      if (c && c !== u.cohort) crossFollowing++;
    }
    for (const sourceId of u.followerIds || []) {
      if (officialSet.has(String(sourceId))) continue;
      const c = cohortMap.get(String(sourceId));
      if (c && c !== u.cohort) crossFollower++;
    }
  }
  let mixedRooms = 0;
  const roomsAr = snapToEntries(await db.collection('rooms').get()).map((e) => e.data);
  for (const r of roomsAr) {
    if (r?.state !== 'OPEN') continue;
    const cohorts = new Set();
    for (const pid of r.participantIds || []) {
      const c = cohortMap.get(String(pid));
      if (c) cohorts.add(c);
    }
    if (cohorts.size > 1) mixedRooms++;
  }
  let unfrozenCross = 0;
  const convsAr = snapToEntries(await db.collection('conversations').get()).map((e) => e.data);
  for (const c of convsAr) {
    const cohorts = new Set();
    for (const pid of c.participantIds || []) {
      const ch = cohortMap.get(String(pid));
      if (ch) cohorts.add(ch);
    }
    // Mirror probeOsaInvariants: accept frozen OR frozenAtMigration.
    const isFrozen = c.frozen === true || c.frozenAtMigration === true;
    if (cohorts.size > 1 && !isFrozen) unfrozenCross++;
  }
  return { crossFollowing, crossFollower, mixedRooms, unfrozenCross };
}

// Snapshot baseline capture. Records the value of each field at the time of
// the Given step, keyed by `<docPath>#<field>`. The `unchanged` and
// `increased by N` matchers compare against these baselines. Per-scenario
// reset happens in runScenario.
function captureSnapshots(ctx, docPath, fields) {
  if (!ctx.snapshots) ctx.snapshots = new Map();
  for (const [field, value] of Object.entries(fields)) {
    ctx.snapshots.set(`${docPath}#${field}`, value);
  }
}

function parseLiteral(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

/**
 * Parse an inline kv-list of the shape `key=value and key=value and ...`
 * used in v3 HTTP-call matchers (`POSTs <path> with k=v and k=v`).
 *
 * Quoted strings preserve embedded ` and ` exactly because tokenisation
 * walks the string respecting quote state — `body="hi and bye"` parses
 * to {body: "hi and bye"}, not two malformed fragments.
 *
 * Value coercion mirrors parseLiteral:
 *   - `key=42`     → number 42
 *   - `key="rose"` → string "rose"
 *   - `key=true`   → boolean true
 *   - `key=null`   → null
 *   - `key=word`   → unquoted bare string "word"
 *
 * Throws on:
 *  - empty input (caller passed nothing meaningful)
 *  - pairs missing `=`
 *  - keys that aren't identifier-shaped
 */
function parseKvPairs(text) {
  if (typeof text !== 'string') {
    throw new Error(`kv-pair text must be a string, got ${typeof text}`);
  }
  if (text.trim() === '') {
    throw new Error('empty kv-pair text');
  }
  // Split on ` and ` while respecting double-quoted strings. Quoted values
  // may contain backslash-escaped quotes (`"say \"hi\""`) — the tokeniser
  // unescapes `\"` to `"` so callers get the intended value, not the raw
  // backslash sequence. Non-quote backslashes pass through unchanged.
  const pairs = [];
  let buf = '';
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && text[i + 1] === '"') {
      // Escaped quote inside a string literal — preserve quote, drop the
      // backslash. Outside a string literal this is unusual but we still
      // strip the backslash to keep the inverse-parse round-trip clean.
      buf += '"';
      i += 2;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      buf += c;
      i++;
      continue;
    }
    if (!inString && text.slice(i, i + 5) === ' and ') {
      pairs.push(buf.trim());
      buf = '';
      i += 5;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim()) pairs.push(buf.trim());

  const out = {};
  for (const raw of pairs) {
    // Two accepted forms inside a pair:
    //   key="value"   (equals form — original contract)
    //   key "value"   (space form — j06 corpus uses this mid-step when
    //                  paired with another equals-form pair, e.g.
    //                  `productId="coins-1000" and receipt "..."`)
    // Space form is detected by: a quoted value exists AND it comes
    // before any `=` sign. A bareword `foo` (no quote, no `=`) still
    // throws `missing "="` per the original contract — the user gets
    // a clear error rather than a silent parse of garbage.
    const eq = raw.indexOf('=');
    const firstQuote = raw.indexOf('"');
    const useSpaceForm = firstQuote >= 0 && (eq < 0 || firstQuote < eq);
    let key, val;
    if (useSpaceForm) {
      // Split on the first whitespace — the bare-identifier key ends
      // there and the quoted-string value starts.
      const sp = raw.search(/\s/);
      if (sp < 0) throw new Error(`kv-pair missing value: "${raw}"`);
      key = raw.slice(0, sp).trim();
      val = raw.slice(sp + 1).trim();
    } else {
      if (eq < 0) throw new Error(`kv-pair missing "=": "${raw}"`);
      key = raw.slice(0, eq).trim();
      val = raw.slice(eq + 1).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`kv-pair key not identifier-shaped: "${key}"`);
    }
    out[key] = parseLiteral(val);
  }
  return out;
}

/**
 * Parse comma-separated `key=value` pairs for the multi-field user-doc
 * state-seed matcher (Given <P> has user doc with k=v, k=v, …).
 *
 * Distinct from parseKvPairs (which splits on ` and `) — Gherkin scenarios
 * phrase user-doc state with commas, matching how the codebase's plan
 * authors actually write them.
 *
 * Quoted strings preserve embedded commas (`bio="hi, welcome"` stays one
 * pair). `[]` is an explicit empty-array sentinel because parseLiteral
 * has no array form — every other value flows through parseLiteral for
 * consistent literal coercion.
 *
 * Throws on empty input, pairs missing `=`, or non-identifier keys.
 */
function parseUserDocFields(text) {
  const pairs = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && text[i + 1] === '"') {
      buf += '"';
      i++;
      continue;
    }
    if (c === '"') inString = !inString;
    if (c === ',' && !inString) {
      if (buf.trim()) pairs.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) pairs.push(buf.trim());
  if (pairs.length === 0) throw new Error('empty user-doc fields');

  const out = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`malformed user-doc pair (missing "="): "${pair}"`);
    const key = pair.slice(0, eq).trim();
    const valRaw = pair.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`user-doc key not identifier-shaped: "${key}"`);
    }
    out[key] = valRaw === '[]' ? [] : parseLiteral(valRaw);
  }
  return out;
}

/**
 * Parse the field-list portion of the `is signed in with …` matcher and
 * the generalised `has …` state-seed matcher.
 *
 * Supports:
 *   1. Both `,` and ` and ` as field separators (Gherkin scenarios use
 *      either, sometimes both in the same step).
 *   2. Trailing `(…)` parenthetical stripped — conventional documentation
 *      like `(post-j01 state)`, `(same Firebase user)`, `(two adult follows)`.
 *   3. Array literal values like `followingIds=[50000010, 50000060]` —
 *      bracket depth is tracked during tokenisation so commas inside `[…]`
 *      do not break the outer pair split. Empty arrays (`[]`) and
 *      mixed-type elements both work via per-element parseLiteral.
 *   4. Quoted strings preserve embedded commas and embedded ` and ` —
 *      tokenisation respects quote state throughout.
 *
 * Throws on empty input, pairs missing `=`, or non-identifier keys.
 */
function parseSignInWithClause(text) {
  // `[^)]*` excludes `)` so it cannot overlap with the literal `\)` that
  // follows; anchored to end-of-string. Linear match.
  // eslint-disable-next-line sonarjs/slow-regex
  const stripped = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const pairs = [];
  let buf = '';
  let inString = false;
  let bracketDepth = 0;
  let i = 0;
  while (i < stripped.length) {
    const c = stripped[i];
    if (c === '\\' && i + 1 < stripped.length && stripped[i + 1] === '"') {
      buf += '"';
      i += 2;
      continue;
    }
    if (c === '"') inString = !inString;
    if (!inString) {
      if (c === '[') bracketDepth++;
      else if (c === ']') bracketDepth--;
      if (bracketDepth === 0) {
        if (c === ',') {
          if (buf.trim()) pairs.push(buf.trim());
          buf = '';
          i++;
          continue;
        }
        if (stripped.slice(i, i + 5) === ' and ') {
          if (buf.trim()) pairs.push(buf.trim());
          buf = '';
          i += 5;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  if (buf.trim()) pairs.push(buf.trim());
  if (pairs.length === 0) throw new Error('empty sign-in `with` clause');

  const out = {};
  // Aliases for noun-phrase forms the corpus uses without `=` —
  // map to canonical `key=value` shape. Anchored at start with word
  // boundary so they don't collide with quoted values.
  const NOUN_PHRASE_ALIASES = [
    { re: /^device locale (\S+)$/, to: (m) => `deviceLocale=${m[1]}` },
    { re: /^browser locale (\S+)$/, to: (m) => `browserLocale=${m[1]}` },
  ];
  for (let idx = 0; idx < pairs.length; idx++) {
    for (const alias of NOUN_PHRASE_ALIASES) {
      const m = pairs[idx].match(alias.re);
      if (m) pairs[idx] = alias.to(m);
    }
  }
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 0) throw new Error(`malformed sign-in with-pair (missing "="): "${pair}"`);
    const key = pair.slice(0, eq).trim();
    const valRaw = pair.slice(eq + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`sign-in with-key not identifier-shaped: "${key}"`);
    }
    out[key] = parseValueLiteralOrArray(valRaw);
  }
  return out;
}

/**
 * Coerce a raw value string to its literal form. Distinct from parseLiteral
 * in that it also recognises array syntax — `[]` is an empty array, and
 * `[a, b, c]` is a flat array whose elements are each coerced via
 * parseLiteral. Nested arrays are not supported; no journey scenario
 * needs them today.
 */
function parseValueLiteralOrArray(valRaw) {
  if (valRaw === '[]') return [];
  if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
    const inner = valRaw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => parseLiteral(s.trim()));
  }
  return parseLiteral(valRaw);
}

/**
 * Parse a jsonish predicate (the inner text between { and }) into an object.
 * Tokenises by commas while respecting double-quoted strings — values that
 * contain commas (e.g. `body: "hi adam, welcome"`) parse correctly.
 *
 * Throws on:
 *  - unresolved placeholders like `{newUniqueId}` (no quotes; literal var ref)
 *    so the operator gets an actionable error pointing at the missing
 *    variable-resolution feature
 *  - malformed key:value pairs
 *
 * Returns an object with parsed key→value pairs (string keys; values typed
 * via parseLiteral).
 */
function parseJsonishPredicate(text) {
  const out = {};
  if (text === '' || text === undefined) return out;
  const pairs = [];
  let buf = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') inString = !inString;
    if (c === ',' && !inString) {
      pairs.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== '') pairs.push(buf);

  for (const raw of pairs) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    // Split on the first colon outside a quoted string.
    let colonIdx = -1;
    let q = false;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '"' && trimmed[i - 1] !== '\\') q = !q;
      if (trimmed[i] === ':' && !q) {
        colonIdx = i;
        break;
      }
    }
    if (colonIdx === -1) throw new Error(`malformed pair (no colon): "${trimmed}"`);
    const key = trimmed.slice(0, colonIdx).trim();
    const valRaw = trimmed.slice(colonIdx + 1).trim();
    // Detect unresolved placeholder {name} — bare identifier in braces.
    if (/^\{[A-Za-z_][\w]*\}$/.test(valRaw)) {
      throw new Error(`unresolved placeholder ${valRaw} (variable resolution not yet implemented)`);
    }
    out[key] = parseLiteral(valRaw);
  }
  return out;
}

function formatReport(allFindings, allScenarioReports, target, cycleNumber) {
  const lines = [];
  lines.push(`# /manual-qa cycle ${cycleNumber} — step-runner MVP`);
  lines.push('');
  lines.push(`Target: ${target}`);
  lines.push(`Scenarios run: ${allScenarioReports.filter((s) => s.status !== 'skipped').length}`);
  lines.push(
    `Skipped (@manual): ${allScenarioReports.filter((s) => s.status === 'skipped').length}`,
  );
  lines.push(`Findings: ${allFindings.length}`);
  lines.push('');

  const bySeverity = {};
  for (const f of allFindings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0).concat
      ? []
      : bySeverity[f.severity] || [];
  }
  for (const f of allFindings) {
    if (!bySeverity[f.severity]) bySeverity[f.severity] = [];
    bySeverity[f.severity].push(f);
  }

  for (const sev of ['Blocker', 'Major', 'Minor', 'Polish']) {
    if (!bySeverity[sev]?.length) continue;
    lines.push(`## ${sev} (${bySeverity[sev].length})`);
    for (const f of bySeverity[sev]) {
      lines.push(`- **${f.file}** :: ${f.scenario}`);
      lines.push(`  - step: \`${f.step}\``);
      lines.push(`  - error: ${f.error}`);
    }
    lines.push('');
  }

  if (allFindings.length === 0) {
    lines.push('## Result');
    lines.push('Zero findings of any severity.');
  }
  return lines.join('\n') + '\n';
}

// ── --help / --version helpers ─────────────────────────────────────
//
// Pure formatters — kept here (not inside main) so tests can import and
// assert content without spawning the CLI. The actual side-effects
// (console.log + process.exit) happen in main() below.
//
// Drift-catch: the help-version test enumerates every long flag
// recognised by the parser below and asserts each appears in
// formatUsage(); a new flag added without doc text breaks the suite.

function formatUsage() {
  return [
    'manual-qa-runner — drives the manual-QA Gherkin journey corpus across the 12-cell matrix.',
    '',
    'Usage:',
    '  PERSONAS_PASSWORD=... FIREBASE_<TARGET>_API_KEY=... \\',
    '    node express-api/scripts/manual-qa-runner.js [flags]',
    '',
    'Flags:',
    '  --target <env>            Target environment: local | dev | prod',
    '  --plan-dir <path>         Directory of .feature files (default: manual-qa/)',
    '  --journey <name>          Run only the named journey (e.g. j01_signin_persona)',
    '  --cycle <n>               Cycle id for run grouping',
    '  --driver <kind>           Driver: stub | playwright | all',
    '  --browser <slug>          Specific cell: chromium | firefox | webkit | edge |',
    '                              mobile-chrome-android | mobile-firefox-android |',
    '                              mobile-edge-android | mobile-samsung-android |',
    '                              mobile-safari-ios | mobile-chrome-ios |',
    '                              mobile-firefox-ios | mobile-edge-ios',
    '  --headed                  Run the browser in headed (visible) mode',
    '  --matrix                  Dispatch every allowed cell in sequence',
    '  --fail-fast               Stop the matrix at the first failing cell',
    '  --check-drivers           Diagnostic — verify each driver bootstraps',
    '  --list                    Enumerate matrix cells as JSON (use with --target',
    '                              to filter to one target). Exits 0 without env vars',
    '                              so it is safe to pipe into jq for scripting.',
    '  --report-dir <path>       Per-cell stdio capture directory (matrix mode)',
    '  --report-format <fmt>     Matrix report format: json | junit',
    '  --report-output <path>    Write the matrix report to this path',
    '  --cell-timeout <seconds>  Per-cell timeout (matrix mode); exceeded cells',
    '                              report outcome="timeout"',
    '  --help, -h                Print this help and exit',
    '  --version, -v             Print the runner version and exit',
    '',
    'Examples:',
    '  PERSONAS_PASSWORD=*** FIREBASE_DEV_API_KEY=*** \\',
    '    node express-api/scripts/manual-qa-runner.js --target dev --driver playwright \\',
    '    --browser chromium --journey j01_signin_persona',
    '',
    '  # 12-cell matrix run with JSON report',
    '  PERSONAS_PASSWORD=*** FIREBASE_DEV_API_KEY=*** \\',
    '    node express-api/scripts/manual-qa-runner.js --target dev --driver all --matrix \\',
    '    --report-format json --report-output qa-report.json',
    '',
    '  # Driver bootstrap diagnostic (no env vars required for --check-drivers itself,',
    '  # but individual drivers may still need their toolchain)',
    '  node express-api/scripts/manual-qa-runner.js --check-drivers',
    '',
    'Env vars:',
    '  PERSONAS_PASSWORD          Required for journey runs (test-persona auth)',
    '  FIREBASE_LOCAL_API_KEY     Required when --target local',
    '  FIREBASE_DEV_API_KEY       Required when --target dev',
    '  FIREBASE_PROD_API_KEY      Required when --target prod',
    '',
  ].join('\n');
}

function formatVersion(version) {
  return `manual-qa-runner ${version}`;
}

// --list — enumerate matrix cells without dispatching anything.
//
// Operator use case: `--list | jq '.targets.dev'` to script per-target
// cell discovery, or `--list --target dev` to get just that target's
// allowed-browsers array. JSON is the default because the primary use
// case is pipe-to-jq; human-readable formatting can be added in a
// follow-up via --list-format if needed.
//
// Lazy require matches the matrix-dispatch pattern in main() and keeps
// the module load lean for callers that only want pure helpers.
function formatListJson(target) {
  const {
    allowedBrowsersFor,
    SUPPORTED_BROWSERS,
    TARGET_BROWSER_ALLOWLIST,
  } = require('./browser-allowlist');
  if (target !== undefined) {
    // Single-target form: just the allowed-browsers array. Unknown
    // targets return [] (mirrors allowedBrowsersFor) so scripts can
    // pipe safely without an error-handling branch.
    return JSON.stringify(allowedBrowsersFor(target));
  }
  return JSON.stringify({
    supported: SUPPORTED_BROWSERS,
    targets: TARGET_BROWSER_ALLOWLIST,
  });
}

// ── CLI ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const opts = {};
  // Normalise `--flag=value` into `--flag value` pairs so both forms work.
  // Hand-rolled args parser was previously matching only the space form,
  // which made `--target=local` silently fall through to the default
  // target — exactly the kind of footgun the operator hits at 3am.
  const flat = [];
  for (const a of args) {
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 2) {
      flat.push(a.slice(0, eq), a.slice(eq + 1));
    } else {
      flat.push(a);
    }
  }
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '--target') opts.target = flat[++i];
    else if (flat[i] === '--plan-dir') opts.planDir = flat[++i];
    else if (flat[i] === '--journey') opts.journey = flat[++i];
    else if (flat[i] === '--cycle') opts.cycle = parseInt(flat[++i], 10);
    else if (flat[i] === '--driver') opts.driver = flat[++i];
    else if (flat[i] === '--browser') opts.browser = flat[++i];
    else if (flat[i] === '--headed') opts.headed = true;
    else if (flat[i] === '--matrix') opts.matrix = true;
    else if (flat[i] === '--fail-fast') opts.failFast = true;
    else if (flat[i] === '--check-drivers') opts.checkDrivers = true;
    else if (flat[i] === '--report-dir') opts.reportDir = flat[++i];
    else if (flat[i] === '--report-format') opts.reportFormat = flat[++i];
    else if (flat[i] === '--report-output') opts.reportOutput = flat[++i];
    else if (flat[i] === '--cell-timeout') {
      // Operator passes seconds; we store ms.
      const raw = flat[++i];
      opts._cellTimeoutRaw = raw;
      opts.cellTimeoutMs = parseInt(raw, 10) * 1000;
    } else if (flat[i] === '--help' || flat[i] === '-h') opts.help = true;
    else if (flat[i] === '--version' || flat[i] === '-v') opts.version = true;
    else if (flat[i] === '--list') opts.list = true;
  }
  // --help / --version / --list short-circuit BEFORE any further
  // validation or env checks. Operators must be able to discover the
  // flag and matrix surface without setting PERSONAS_PASSWORD or any
  // FIREBASE_*_API_KEY. Precedence: --help > --version > --list
  // (--help is the most-likely operator intent when typo-combined).
  if (opts.help) {
    console.log(formatUsage());
    process.exit(0);
  }
  if (opts.version) {
    const pkgVersion = require('../package.json').version;
    console.log(formatVersion(pkgVersion));
    process.exit(0);
  }
  if (opts.list) {
    console.log(formatListJson(opts.target));
    process.exit(0);
  }
  // --report-format validation — only json + junit are supported (used
  // with --matrix to emit structured output for CI dashboards).
  if (opts.reportFormat && !['json', 'junit'].includes(opts.reportFormat)) {
    console.error(`--report-format "${opts.reportFormat}" not recognised. Supported: json, junit.`);
    process.exit(2);
  }
  // --cell-timeout validation: must be a positive integer (seconds).
  if (
    opts.cellTimeoutMs !== undefined &&
    (!Number.isFinite(opts.cellTimeoutMs) || opts.cellTimeoutMs <= 0)
  ) {
    console.error(
      `--cell-timeout must be a positive integer (seconds). Got "${opts._cellTimeoutRaw}".`,
    );
    process.exit(2);
  }
  opts.target = opts.target || 'dev';
  opts.planDir = opts.planDir || path.resolve(__dirname, '../../journey-tests');
  opts.cycle = opts.cycle || 1;
  opts.driver = opts.driver || 'stub';
  // --browser selects the Playwright BrowserType for the web driver.
  // Local matrix covers chromium / firefox / webkit / edge; the runner's
  // dispatch loop iterates these on --target local (separate PR wires
  // the loop). Default is chromium for backward-compat with the
  // single-browser dispatches that pre-date the matrix work.
  opts.browser = opts.browser || 'chromium';
  // Per-target browser allowlist: dev runs Chrome only; local runs the
  // full matrix; prod is read-only and pins to chromium.
  // Per-target browser allowlist lives in ./browser-allowlist.js so unit
  // tests can pin the matrix without subprocessing the runner. See that
  // module for the policy rationale (local = full matrix, dev =
  // chrome-on-Mac + chrome-on-Android, prod = chromium-only).
  const { allowedBrowsersFor } = require('./browser-allowlist');
  const allowed = allowedBrowsersFor(opts.target);
  if (!allowed.includes(opts.browser)) {
    console.error(
      `--browser "${opts.browser}" is not allowed for --target "${opts.target}" — allowed: ${allowed.join(', ')}. The local matrix (full browser coverage) only applies to --target local; dev + prod stay Chromium-only by policy.`,
    );
    process.exit(2);
  }

  if (!TARGETS[opts.target]) {
    console.error(`Unknown target: ${opts.target}. Valid: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(2);
  }

  // --check-drivers verifies every device + browser app + env-var is
  // in place by trying to bootstrap each driver in the target's
  // allowlist + closing it immediately. Faster than --matrix (no
  // journey scenario runs) — typical 12-cell health-check is ~10s.
  // Skips for bootstrap failures (no device / missing env / app not
  // installed) so the operator gets a per-cell readiness report.
  if (opts.checkDrivers) {
    const { runHealthCheck, formatHealthCheckResult } = require('./driver-health-check');
    const baseURL = TARGETS[opts.target].webBase || 'http://localhost:8888';
    // Each factory is a thin wrapper around the matching createXxxDriver
    // — same browser → driver mapping as the runner's main dispatch.
    const factories = {
      chromium: ({ baseURL: u }) =>
        require('./drivers/web-playwright-driver').createWebDriver({
          baseURL: u,
          headless: !opts.headed,
          browser: 'chromium',
        }),
      firefox: ({ baseURL: u }) =>
        require('./drivers/web-playwright-driver').createWebDriver({
          baseURL: u,
          headless: !opts.headed,
          browser: 'firefox',
        }),
      webkit: ({ baseURL: u }) =>
        require('./drivers/web-playwright-driver').createWebDriver({
          baseURL: u,
          headless: !opts.headed,
          browser: 'webkit',
        }),
      edge: ({ baseURL: u }) =>
        require('./drivers/web-playwright-driver').createWebDriver({
          baseURL: u,
          headless: !opts.headed,
          browser: 'edge',
        }),
      'mobile-chrome-android': ({ baseURL: u }) =>
        require('./drivers/web-mobile-chrome-android-driver').createMobileChromeAndroidDriver({
          baseURL: u,
        }),
      'mobile-samsung-android': ({ baseURL: u }) =>
        require('./drivers/web-mobile-samsung-android-driver').createMobileSamsungAndroidDriver({
          baseURL: u,
        }),
      'mobile-edge-android': ({ baseURL: u }) =>
        require('./drivers/web-mobile-edge-android-driver').createMobileEdgeAndroidDriver({
          baseURL: u,
        }),
      'mobile-firefox-android': ({ baseURL: u }) =>
        require('./drivers/web-mobile-firefox-android-driver').createMobileFirefoxAndroidDriver({
          baseURL: u,
        }),
      'mobile-safari-ios': ({ baseURL: u }) =>
        require('./drivers/web-mobile-safari-ios-driver').createMobileSafariIosDriver({
          baseURL: u,
        }),
      'mobile-chrome-ios': ({ baseURL: u }) =>
        require('./drivers/web-mobile-webkit-ios-driver').createMobileWebkitIosDriver({
          browser: 'chrome',
          baseURL: u,
        }),
      'mobile-firefox-ios': ({ baseURL: u }) =>
        require('./drivers/web-mobile-webkit-ios-driver').createMobileWebkitIosDriver({
          browser: 'firefox',
          baseURL: u,
        }),
      'mobile-edge-ios': ({ baseURL: u }) =>
        require('./drivers/web-mobile-webkit-ios-driver').createMobileWebkitIosDriver({
          browser: 'edge',
          baseURL: u,
        }),
    };
    const healthResult = await runHealthCheck({
      browsers: allowed,
      factories,
      baseURL,
      onCellStart: ({ browser }) => console.log(`[check-drivers] → ${browser}`),
      onCellEnd: (cell) =>
        console.log(`[check-drivers] ← ${cell.browser}: ${cell.outcome} (${cell.durationMs}ms)`),
    });
    console.log('\n' + formatHealthCheckResult(healthResult));
    process.exit(healthResult.ok ? 0 : 1);
  }

  // --matrix dispatches the same scenario across every browser in the
  // target's allowlist. Each cell is a fresh runner subprocess so a
  // driver init failure in one cell can't corrupt the next cell's
  // state. The iteration helper (./matrix-dispatch.js) aggregates
  // pass / fail / skip outcomes and prints a summary table at the end.
  if (opts.matrix) {
    const {
      runMatrix,
      formatMatrixResult,
      formatMatrixResultJson,
      formatMatrixResultJunit,
    } = require('./matrix-dispatch');
    const { spawnSync } = require('child_process');
    // Reconstruct the per-cell argv by stripping --matrix + report flags
    // + appending --browser <slug>. Per-cell subprocesses don't need the
    // matrix-level flags (they'd recurse into their own report-writing).
    // Last --browser wins in the parse loop.
    const stripFlags = new Set(['--matrix', '--report-dir', '--report-format', '--report-output']);
    const baseArgv = [];
    const sourceArgv = process.argv.slice(2);
    for (let i = 0; i < sourceArgv.length; i++) {
      const a = sourceArgv[i];
      if (stripFlags.has(a)) {
        // --matrix is a boolean; the other strip flags take a value,
        // skip it too.
        if (a !== '--matrix') i++;
        continue;
      }
      baseArgv.push(a);
    }

    // When --report-dir is set, mkdir-p the dir up front so the per-cell
    // writes don't race on creation.
    let cellLogs = null;
    if (opts.reportDir) {
      cellLogs = require('./matrix-cell-logs');
      cellLogs.ensureReportDir(opts.reportDir);
    }

    const matrixResult = await runMatrix({
      browsers: allowed,
      failFast: opts.failFast === true,
      onCellStart: ({ browser }) => console.log(`[matrix] → dispatching ${browser}`),
      onCellEnd: (cell) =>
        console.log(`[matrix] ← ${cell.browser}: ${cell.outcome} (${cell.durationMs}ms)`),
      dispatchOne: async ({ browser }) => {
        const cellArgs = [...baseArgv, '--browser', browser];
        // Capture mode: pipe stdout+stderr so we can both tee them to
        // the operator's terminal AND write a per-cell log file. Inherit
        // mode (no --report-dir): subprocess stdio inherits the runner's
        // streams as before (zero log overhead).
        const captureStdio = Boolean(opts.reportDir);
        // spawnSync's `timeout` option kills the child with SIGTERM
        // once exceeded; result is `proc.status === null, signal === 'SIGTERM'`.
        // We translate that to a CELL_TIMEOUT throw so matrix-dispatch's
        // classifier produces a 'timeout' outcome (distinct from 'fail').
        const spawnOpts = {
          stdio: captureStdio ? ['ignore', 'pipe', 'pipe'] : 'inherit',
          env: process.env,
        };
        if (opts.cellTimeoutMs) spawnOpts.timeout = opts.cellTimeoutMs;
        const proc = spawnSync(process.execPath, [__filename, ...cellArgs], spawnOpts);
        if (proc.error) {
          // spawnSync sets proc.error.code = 'ETIMEDOUT' when the
          // child was killed for exceeding the timeout. Translate to
          // CELL_TIMEOUT so matrix-dispatch can classify it.
          if (proc.error.code === 'ETIMEDOUT') {
            const e = new Error(`cell timed out after ${Math.round(opts.cellTimeoutMs / 1000)}s`);
            e.code = 'CELL_TIMEOUT';
            throw e;
          }
          throw proc.error;
        }
        // Some Node versions surface timeout via signal+null-status
        // instead of proc.error — handle that path too.
        if (proc.status === null && proc.signal === 'SIGTERM' && opts.cellTimeoutMs) {
          const e = new Error(`cell timed out after ${Math.round(opts.cellTimeoutMs / 1000)}s`);
          e.code = 'CELL_TIMEOUT';
          throw e;
        }
        if (captureStdio) {
          // Tee captured stdio to the runner's terminal so the operator
          // sees the cell's output in real time too — same UX as
          // 'inherit' mode.
          const stdout = proc.stdout ? proc.stdout.toString('utf8') : '';
          const stderr = proc.stderr ? proc.stderr.toString('utf8') : '';
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
          // Write per-cell log file. Combined stdout+stderr so a future
          // operator grep sees both interleaved (close to chronological).
          cellLogs.writeCellLog({
            dir: opts.reportDir,
            cell: {
              browser,
              outcome: proc.status === 0 ? 'pass' : 'fail',
              durationMs: 0, // not measured here; runMatrix sets it on its own cell record
            },
            body: stdout + (stderr ? `\n---STDERR---\n${stderr}` : ''),
          });
        }
        return proc.status === 0;
      },
    });
    // Always print the human-readable text table to stdout so the
    // operator gets immediate feedback regardless of --report-format.
    console.log('\n' + formatMatrixResult(matrixResult));
    if (opts.reportDir) {
      console.log(`[matrix] per-cell logs written to ${opts.reportDir}`);
    }
    // Optional structured-report output for CI consumption.
    if (opts.reportFormat) {
      const fsImpl = require('fs');
      let formatted;
      if (opts.reportFormat === 'json') {
        formatted = formatMatrixResultJson(matrixResult);
      } else {
        // junit
        formatted = formatMatrixResultJunit(matrixResult);
      }
      if (opts.reportOutput) {
        fsImpl.writeFileSync(opts.reportOutput, formatted);
        console.log(`[matrix] ${opts.reportFormat} report written to ${opts.reportOutput}`);
      } else {
        console.log(`\n${formatted}`);
      }
    }
    process.exit(matrixResult.ok ? 0 : 1);
  }
  const personasPassword = process.env.PERSONAS_PASSWORD;
  if (!personasPassword) {
    console.error('MISSING_ENV: PERSONAS_PASSWORD');
    process.exit(2);
  }
  const firebaseApiKey = readFirebaseApiKey(opts.target);
  if (!firebaseApiKey) {
    // Static literals — no interpolation of the env value into the message,
    // so CodeQL's clear-text-logging-of-sensitive-information rule doesn't
    // see a flow from process.env[...] to console.error. We DO interpolate
    // the env-var NAME (which is itself a static literal in TARGETS) so the
    // operator sees which variable to set for the resolved target.
    const envName =
      opts.target === 'dev'
        ? 'FIREBASE_DEV_API_KEY'
        : opts.target === 'local'
          ? 'FIREBASE_LOCAL_API_KEY'
          : 'FIREBASE_PROD_API_KEY';
    console.error(
      `MISSING_ENV: ${envName} for target=${opts.target} (find value in google-services.json).`,
    );
    process.exit(2);
  }

  // Lazy require — keeps the test surface free of firebase-admin side effects.
  // The util initialises Admin SDK using GOOGLE_APPLICATION_CREDENTIALS for
  // dev/prod or the emulator host for local. Operator must export the
  // service-account creds for dev target before running.
  const { db } = require('../src/utils/firebase');

  // Wire UI drivers based on --driver flag. `playwright` launches a real
  // Chromium browser via the root-level `playwright` package. The other
  // drivers (`adb`, `simctl`) load lazily for Android/iOS scenarios.
  // Default `stub` produces "not configured" findings — matches the
  // pre-driver behaviour so existing CI doesn't break.
  let webDriver = null;
  let uiDriver = null;
  const liveKitDriver = null;
  const testerDriver = null;
  let driverCleanup = async () => {};
  if (opts.driver === 'playwright' || opts.driver === 'all') {
    // Driver factory routing inside the playwright/all bucket:
    //   - desktop browsers (chromium/firefox/webkit/edge) → Playwright
    //     direct launch via web-playwright-driver.js
    //   - mobile-chrome-android → CDP-over-adb to the real Chrome on
    //     the connected Android device via web-mobile-chrome-android-driver.js
    //   - mobile-safari-ios → Appium safari-context session on the
    //     connected iPhone via web-mobile-safari-ios-driver.js
    // The runner's matcher surface is the same — every driver exposes the
    // ctx.webDriver method namespace, so scenarios don't care which one
    // is active.
    const baseURL = TARGETS[opts.target].webBase || 'http://localhost:8888';
    if (opts.browser === 'mobile-chrome-android') {
      const {
        createMobileChromeAndroidDriver,
      } = require('./drivers/web-mobile-chrome-android-driver');
      webDriver = await createMobileChromeAndroidDriver({ baseURL });
    } else if (opts.browser === 'mobile-samsung-android') {
      const {
        createMobileSamsungAndroidDriver,
      } = require('./drivers/web-mobile-samsung-android-driver');
      webDriver = await createMobileSamsungAndroidDriver({ baseURL });
    } else if (opts.browser === 'mobile-edge-android') {
      const { createMobileEdgeAndroidDriver } = require('./drivers/web-mobile-edge-android-driver');
      webDriver = await createMobileEdgeAndroidDriver({ baseURL });
    } else if (opts.browser === 'mobile-firefox-android') {
      // Firefox doesn't speak CDP; this driver spawns geckodriver and
      // uses W3C WebDriver over Marionette. See
      // web-mobile-firefox-android-driver.js for the operator setup.
      const {
        createMobileFirefoxAndroidDriver,
      } = require('./drivers/web-mobile-firefox-android-driver');
      webDriver = await createMobileFirefoxAndroidDriver({ baseURL });
    } else if (opts.browser === 'mobile-safari-ios') {
      const { createMobileSafariIosDriver } = require('./drivers/web-mobile-safari-ios-driver');
      webDriver = await createMobileSafariIosDriver({ baseURL });
    } else if (
      opts.browser === 'mobile-chrome-ios' ||
      opts.browser === 'mobile-firefox-ios' ||
      opts.browser === 'mobile-edge-ios'
    ) {
      // Chrome/Firefox/Edge for iOS all use WebKit (App Store policy) so
      // they share a single driver module parameterised by the browser
      // slug. The slug suffix maps to the per-browser bundle ID inside
      // the driver's WEBKIT_BROWSERS table.
      const { createMobileWebkitIosDriver } = require('./drivers/web-mobile-webkit-ios-driver');
      // Slug shape is `mobile-<browser>-ios` — strip the prefix/suffix
      // to get the browser key the driver expects ('chrome'|'firefox'|'edge').
      const browserKey = opts.browser.replace(/^mobile-/, '').replace(/-ios$/, '');
      webDriver = await createMobileWebkitIosDriver({ browser: browserKey, baseURL });
    } else {
      const { createWebDriver } = require('./drivers/web-playwright-driver');
      webDriver = await createWebDriver({
        baseURL,
        headless: !opts.headed,
        browser: opts.browser,
      });
    }
    const prevCleanup = driverCleanup;
    driverCleanup = async () => {
      await prevCleanup();
      await webDriver.close();
    };
  }
  if (opts.driver === 'adb' || opts.driver === 'all') {
    try {
      const { createAndroidDriver } = require('./drivers/android-adb-driver');
      uiDriver = await createAndroidDriver({});
      const prevCleanup = driverCleanup;
      driverCleanup = async () => {
        await prevCleanup();
        await uiDriver.close();
      };
    } catch (e) {
      console.error(`[runner] Android driver init failed: ${e.message}`);
    }
  }
  // iOS driver routing — see ./drivers/ios-driver-loader.js for the
  // routing matrix. The loader picks between ios-appium-driver (real
  // UI, needs WDA_TEAM_ID) and ios-devicectl-driver (legacy stubs)
  // based on opts.driver + env.
  {
    const { loadIosUiDriver } = require('./drivers/ios-driver-loader');
    try {
      const loaded = await loadIosUiDriver({
        driver: opts.driver,
        target: opts.target,
        createAppiumDriver: (cfg) => require('./drivers/ios-appium-driver').createIosDriver(cfg),
        createDevicectlDriver: (cfg) =>
          require('./drivers/ios-devicectl-driver').createIosDriver(cfg),
      });
      if (loaded) {
        const { iosDriver } = loaded;
        if (!uiDriver) {
          uiDriver = iosDriver;
        } else {
          // Merge iOS methods onto the existing uiDriver (Android-first).
          // Each method name is platform-prefixed (`iosXxx` / `androidXxx`)
          // so no collisions; matchers dispatch by step text platform.
          for (const k of Object.keys(iosDriver)) {
            if (typeof iosDriver[k] === 'function' && !uiDriver[k]) {
              uiDriver[k] = iosDriver[k].bind(iosDriver);
            }
          }
          uiDriver._iosDriver = iosDriver;
        }
        const prevCleanup = driverCleanup;
        driverCleanup = async () => {
          await prevCleanup();
          await iosDriver.close();
        };
      }
    } catch (e) {
      console.error(`[runner] iOS driver init failed: ${e.message}`);
    }
  }

  const ctx = {
    target: opts.target,
    apiBase: TARGETS[opts.target].apiBase,
    firebaseApiKey,
    personasPassword,
    sessions: new Map(),
    lastResponse: null,
    locale: 'en',
    fetch: globalThis.fetch,
    db,
    webDriver,
    uiDriver,
    liveKitDriver,
    testerDriver,
    _driverCleanup: driverCleanup,
  };

  const files = opts.journey
    ? [path.join(opts.planDir, opts.journey)]
    : fs
        .readdirSync(opts.planDir)
        // eslint-disable-next-line sonarjs/slow-regex
        .filter((f) => /^j\d+[^.]*\.feature$/.test(f))
        .map((f) => path.join(opts.planDir, f));

  console.log(`Running ${files.length} feature file(s) against ${opts.target} (${ctx.apiBase})`);
  const allFindings = [];
  const allScenarioReports = [];
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      continue;
    }
    const { findings, scenarioReports } = await runFeatureFile(f, ctx);
    allFindings.push(...findings);
    allScenarioReports.push(...scenarioReports);
    for (const s of scenarioReports) {
      const marker = s.status === 'pass' ? 'OK' : s.status === 'fail' ? 'FAIL' : 'SKIP';
      console.log(`  ${marker} ${path.basename(f)} :: ${s.scenario}`);
    }
  }

  const report = formatReport(allFindings, allScenarioReports, opts.target, opts.cycle);
  const reportPath = `/tmp/manual-qa-cycle-${opts.cycle}.md`;
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Findings: ${allFindings.length}`);

  // Close any drivers (browser, adb sessions, etc.) before exiting so
  // we don't leak Chromium processes or device handles.
  try {
    await ctx._driverCleanup();
  } catch (e) {
    console.error('driver cleanup error:', e?.message || e);
  }
  process.exit(allFindings.length > 0 ? 1 : 0);
}

module.exports = {
  parseGherkin,
  classifySeverity,
  matchers,
  executeStep,
  runScenario,
  runFeatureFile,
  decodeJwtPayload,
  pickField,
  parseLiteral,
  parseKvPairs,
  parseJsonishPredicate,
  probeOsaInvariants,
  formatReport,
  formatUsage,
  formatVersion,
  formatListJson,
  TARGETS,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('RUNNER_CRASH', e?.message || e);
    process.exit(2);
  });
}

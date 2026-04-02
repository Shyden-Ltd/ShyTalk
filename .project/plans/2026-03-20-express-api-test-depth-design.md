# Express API Test Depth — Fill All Coverage Gaps

**Date:** 2026-03-20
**Status:** Spec
**Goal:** Deepen test coverage on 10 thinly-tested files across crons, routes, and utils. Two passes: fill gaps, then re-audit and deepen again.

---

## Context

The Express API has 100% file-level test coverage (62/62 source files tested, ~2,597 tests). However, 10 files have shallow coverage relative to their complexity. This spec targets those files with precise test cases for every untested code path.

**Test infrastructure:** Jest 30 + Supertest, self-contained mocks per file, `jest.mock()` for Firebase/R2/FCM, `beforeEach(jest.clearAllMocks)`. No shared fixtures.

---

## Files and Gap Analysis

### 1. `cron/staleRooms.js` — 3 tests → ~37 tests

**Source:** Closes OWNER_AWAY rooms. Two closure paths: immediate (no non-owner seated) or 10-min timeout (non-owners seated). Clears seats, participantIds, and users' currentRoomId. Batches in chunks of 500.

**Existing tests cover:** empty seats close immediately, seated non-owners block closure within 10 min, stale rooms (>10 min) close regardless.

**Missing tests:**
- Empty snapshot (no OWNER_AWAY rooms) → early return, no batch
- Room with `ownerLeftAt: null` → skipped (filter returns false)
- Room at exactly 10 minutes (boundary) → should NOT close (< not <=). **Requires `jest.useFakeTimers()` / `jest.setSystemTime()`** to freeze `Date.now()` — otherwise millisecond drift between test setup and function execution makes this flaky
- Room at 10 min + 1ms (boundary) → SHOULD close
- Room with `seats: null/undefined` → `hasNonOwnerSeated` returns false → immediate close
- Room with `seats: {}` (empty object, no keys) → `hasNonOwnerSeated` returns false → immediate close
- Multiple rooms: mix of closeable and non-closeable → only closeable rooms in batch
- Participant currentRoomId clearing for multiple participants → verify all get cleared
- Owner's own currentRoomId clearing (owner is in participantIds)
- Room with empty `participantIds: []` → no user writes, only room write
- Room with `participantIds: undefined` → falls back to `[]`, no user writes
- Batching: >500 writes triggers multiple batch.commit() calls
- `hasNonOwnerSeated`: seat with `state: 'REQUESTING'` (not OCCUPIED) → returns false
- `hasNonOwnerSeated`: owner is seated in non-0 seat → not counted as non-owner
- `hasNonOwnerSeated`: seat with `userId: null` → skipped
- Batch commit failure → should propagate error
- Closed room data shape: verify `closedAt` is set, `ownerLeftAt` is null, seats are all EMPTY, participantIds is `[]`
- Log message: verify `log.info` called with correct count
- Firestore query throws → error propagates (no try/catch in `staleRooms()`)
- Query uses `.limit(100)` → verify limit is applied (caps rooms processed per run)
- `batch.set` called with `{ merge: true }` → verify merge option passed
- Seats always reset to exactly 8 empty seats (hardcoded `for i < 8`) regardless of original seat count
- `closedAt` timestamp is consistent across all rooms in same batch (both use same `Date.now()` call)
- Room with all 8 seats occupied by non-owners, owner left 1 min ago → NOT closed (non-owners present, within 10 min)
- Duplicate participantIds in array → same user gets two `currentRoomId: null` writes (verify no crash, both batch.set calls made)
- Room with `ownerId: undefined` → `hasNonOwnerSeated` compares `seat.userId !== undefined`, so ALL seated users are "non-owner" → waits 10 min
- Verify Firestore chain: `collection('rooms')` → `.where('state', '==', 'OWNER_AWAY')` → `.limit(100)` → `.get()` — all chained correctly
- `toClose.length === 0` after filtering → early return, no batch, no log message
- Return value: `staleRooms()` resolves to `undefined` (no explicit return) — verify promise resolves, not rejects
- Sequential calls: calling `staleRooms()` twice in same test → each call uses fresh `Date.now()` and fresh query
- Owner NOT in participantIds → owner's currentRoomId is NOT cleared (only pids in `room.participantIds` are cleared)
- `hasNonOwnerSeated`: seat with empty string userId (`''`) → falsy, skipped by `seat.userId &&` check
- Exact batch.set call count: 1 room with 3 participants → 4 calls (1 room + 3 users)
- Each empty seat in reset has exact shape `{ userId: null, state: 'EMPTY', isMuted: false }` — verify all three fields

**Housekeeping:** Move test from `src/__tests__/staleRooms.test.js` to `tests/cron/staleRooms.test.js`. Update all import paths: `../utils/firebase` → `../../src/utils/firebase`, `../cron/staleRooms` → `../../src/cron/staleRooms`, `../utils/log` → `../../src/utils/log`. Delete the old file. After moving, verify Jest discovers the new path: `npm test -- --testPathPattern staleRooms`.

### 2. `cron/backups.js` — 7 tests → ~43 tests

**Source:** Full DB backup to R2. Backs up 15 top-level collections + 3 subcollections. Writes manifest. Writes backwards-compat users backup. Prunes backups >7 days. Per-collection try/catch continues on failure.

**Existing tests cover:** all top-level collections backed up, subcollection file creation, manifest with doc counts, pruning old backups, empty collections, backwards-compat users file, return value.

**Implementation note:** The existing test uses a flat `mockGet` that doesn't distinguish between collection queries. Failure-path tests (e.g. "one collection throws while others succeed") require restructuring the mock to track which collection is being queried — either by making `mockCollection` return different mocks per collection name, or by using `mockGet.mockImplementation` with call-count tracking. Plan for mock rework before writing failure tests.

**Missing tests:**
- Collection backup failure (Firestore .get() throws) → logs error, continues to next collection
- Subcollection backup failure → logs error, continues
- R2 putObject failure for one collection → error logged, other collections still backed up
- Manifest still written even if some collections failed
- Backwards-compat users file contains `'[]'` when users collection fails (usersJsonStr remains null)
- `pruneOldBackups` with unparseable date strings → filtered out (isNaN check)
- `pruneOldBackups` with no old backups → deleteObjects not called
- ~~`pruneOldBackups` called for both prefixes~~ (already covered by existing pruning test which mocks both prefixes)
- Subcollection backup with actual parent docs → verifies parentId field in output
- `backupCollection` returns correct count for non-empty collection
- `backupSubcollection` with parent doc that has no subcollection docs → empty array
- Large doc count → verifies JSON.stringify handles it
- Manifest timestamp is ISO format
- R2 putObject metadata contains docCount and createdAt
- Manifest putObject throws → `backups()` rejects (manifest write is outside try/catch)
- Backwards-compat users putObject throws → `backups()` rejects (also outside try/catch)
- `r2.listObjects` throws in `pruneOldBackups` → `backups()` rejects (no try/catch around prune)
- `r2.deleteObjects` throws in `pruneOldBackups` → `backups()` rejects
- Backup key format: verify path is `backups/full/YYYY-MM-DD/{collection}.json`
- Backwards-compat users key format: verify path is `backups/users/YYYY-MM-DD.json`
- Log messages: verify `log.info` called for each saved collection with bytes count
- Log messages: verify `log.error` called for failed collections with error message
- Collection backup: verify R2 key content type is `'application/json'`
- Collection backup: JSON is pretty-printed (`JSON.stringify(docs, null, 2)`) — verify Buffer content
- `backupCollection`: doc data is spread with `{ id: d.id, ...d.data() }` — verify id field present in output
- `backupSubcollection`: iterates ALL parent docs to find subcollection docs (not just first parent)
- Prune: date at exactly 7 days ago boundary → NOT pruned (uses `<` not `<=`)
- Prune: `backups/full/` prefix extracts date from folder name (first path segment after prefix)
- Prune: `backups/users/` prefix extracts date from filename (strips `.json`)
- Failed collection does NOT appear in manifest.collections (try/catch skips manifest update)
- Multiple collections fail → all logged, manifest only contains successful ones
- Collections backed up in `TOP_LEVEL_COLLECTIONS` order (users first) — verify iteration order matters for `usersJsonStr` capture
- `usersJsonStr` reused for backwards-compat (same in-memory string, no extra Firestore read) — verify Buffer content matches the users collection backup
- Subcollection backup across multiple parents: e.g. 3 rooms each with 2 messages → all 6 messages in output with correct parentId
- Manifest `date` field uses UTC date (`new Date().toISOString().slice(0, 10)`) — verify format regardless of local timezone
- R2 putObject call order: all 15 collections, then 3 subcollections, then manifest, then legacy users
- Return value: `backups()` resolves to `{ date, manifest }` — verify both fields, manifest has `date`, `timestamp`, `collections` keys
- `TOP_LEVEL_COLLECTIONS` has exactly 15 entries — verify exported array length matches expected
- `SUBCOLLECTIONS` has exactly 3 entries — verify exported array
- Exact R2 putObject call count: 15 top-level + 3 subcollections + 1 manifest + 1 legacy = 20 calls
- Backwards-compat users metadata uses `userCount` key (not `docCount`) — different from collection metadata
- `log.info` call for manifest includes `{ key: manifestKey }` — verify key in log context

### 3. `cron/expireBans.js` — 4 tests → ~30 tests

**Source:** Queries deviceBans and networkBans for non-null expiresAt, filters expired, batch deletes, notifies admins via FCM.

**Existing tests cover:** removes expired bans, skips non-expired, handles empty collections, sends FCM notification.

**Missing tests:**
- Mixed expired + non-expired in same collection → only expired deleted
- Only deviceBans expired, networkBans empty → partial deletion
- Only networkBans expired, deviceBans empty → partial deletion
- >500 expired bans → multiple batch.commit() calls
- Exactly 500 bans → single batch
- 501 bans → two batches (500 + 1)
- FCM: alertConfig exists but fcmRecipientUserIds is empty → no FCM sent
- FCM: admin user exists but has no fcmTokens → no FCM sent
- FCM: admin user doesn't exist → skipped
- FCM: sendFcmToTokens returns invalid tokens → cleanupInvalidTokens called
- FCM: notification error → caught, logged, doesn't throw
- Boundary: expiresAt exactly equal to now → not expired (`<` not `<=`). **Requires `jest.useFakeTimers()` / `jest.setSystemTime()`** — `nowIso` is computed inside `expireBans()` so clock must be frozen
- FCM: multiple admin recipients → iterates all, sends to each
- Log message on no expired bans: verify `log.info` called with "no expired bans"
- Log message on removal: verify `log.info` called with correct count
- Batch commit failure → propagates (no try/catch around batch writes)
- FCM notification body contains correct count string (e.g. "2 ban(s) have expired and been removed.")
- FCM: `cleanupInvalidTokens` called with correct userId argument
- FCM: alertConfig doc exists but `data()` returns object with no fcmRecipientUserIds field → `|| []` fallback, no FCM
- Queries use `where('expiresAt', '!=', null)` → verify Firestore .where() called with correct args
- Return value: `expireBans()` resolves to `undefined` — verify resolves cleanly in all paths
- Exact batch.delete call count: 3 device + 2 network expired → 5 delete calls, 1 commit
- ISO string comparison: verify `expiresAt` with different timezone offsets (N/A — both sides use `toISOString()` which is always UTC `Z` suffix)
- Firestore query for deviceBans happens before networkBans → verify collection() call order
- Device bans appear before network bans in combined `allExpired` array — verify deletion order
- FCM: one recipient's sendFcmToTokens fails → error caught, next recipient still gets notified (independent iteration)
- `batch.delete(doc.ref)` → verify `.ref` property from Firestore doc is passed (not the doc itself)

### 4. `cron/serverHealth.js` — 2 tests → ~27 tests

**Source:** Checks RSS memory against threshold, checks PM2 restart counts. Takes `alertManager` as parameter.

**Existing tests cover:** creates alert on high memory, does nothing on normal memory.

**Implementation notes:**
- PM2 tests require `jest.mock('child_process', ...)` to mock `execFile`
- `lastRestartCounts` is **module-level state** that persists across tests. PM2 restart tests must use `jest.resetModules()` + re-require `serverHealth` in `beforeEach` within a dedicated PM2 `describe` block. Without this, tests are order-dependent and flaky (`describe` blocks do not guarantee execution order).

**Missing tests:**
- Memory at exact threshold (rssPercent === memThreshold) → no alert (> not >=)
- Default threshold used when config has no `serverMemoryWarningPercent` → defaults to 30
- PM2 restart detection: new restarts since last check → creates alert
- PM2 restart detection: same count as last check → no alert
- PM2 restart detection: first check (lastKnown === 0) → no alert (tracks but doesn't alert)
- PM2: execFile error → resolves without throwing (no log call — error is silently swallowed via `resolve()`)
- PM2: invalid JSON output → logs warning, resolves
- PM2: pm2RestartAlert is false → skips PM2 check entirely
- PM2: process has no pm2_env → skipped
- PM2: multiple processes, only one has new restarts → alert only for the restarted process
- PM2: `createAlert` rejects → caught by `.catch()`, logs error, doesn't crash
- PM2: empty process list (`[]`) → no alerts, no errors
- PM2: stdout is empty string → resolves (hits `!stdout` branch)
- Log output: verify `log.debug` called with rssMB and rssPercent on every check
- Memory alert description string format: contains `rssMB`, `systemTotalMB`, percentage with 1 decimal, and threshold value
- PM2: `restart_time` field missing on pm2_env → defaults to 0 via `|| 0`
- PM2: `lastRestartCounts[name]` always updated after check, even if no alert fires — verify state tracking works across sequential calls
- PM2: verify `execFile` called with `'pm2'`, `['jlist']`, `{ timeout: 10000 }`
- PM2: alert metadata contains `processName`, `restartCount`, and `newRestarts` fields
- PM2: `rssPercent` rounded to 1 decimal in both alert metadata and debug log (`Math.round(rssPercent * 10) / 10`)
- Return value: `serverHealth()` resolves to `undefined` — verify resolves in all paths (memory alert, PM2 alert, no alert)
- `alertManager.getConfig()` throws → unhandled, propagates (no try/catch around config read)
- Memory + PM2 alert in same check: both fire if both thresholds exceeded
- PM2 alert description string: `"N new restart(s) (total: M)"` — verify exact format
- `rssMB` uses `Math.round()` — verify rounding (e.g. 1100.4 MB rounds to 1100, not 1100.4)

### 5. `routes/admin-logs.js` — 5 tests → ~33 tests

**Source:** Two endpoints. `GET /admin/logs` with 10 query params (level, source, userId, sessionTraceId, requestTraceId, route, keyword, startTime, endTime, cursor) + limit. `GET /admin/logs/trace/:traceId`.

**Existing tests cover:** default query, non-admin 403, query param filters (level, source, userId, limit), trace endpoint, trace non-admin.

**Missing tests:**
- `sessionTraceId` filter → Firestore .where()
- `requestTraceId` filter → Firestore .where()
- `startTime` filter → .where('timestamp', '>=', startTime)
- `endTime` filter → .where('timestamp', '<=', endTime)
- `cursor` pagination → .startAfter(cursor)
- `route` client-side filter → filters by context.route or top-level route field
- `keyword` client-side filter → case-insensitive match on message + JSON.stringify(context)
- `keyword` matches in context but not message
- `limit` clamping: limit=0 → DEFAULT_LIMIT (50) — caught by `parseInt(...) || DEFAULT_LIMIT` short-circuit (0 is falsy), not the `< 1` guard
- `limit` clamping: limit=999 → MAX_LIMIT (200)
- `limit` clamping: limit=-5 → DEFAULT_LIMIT — caught by `if (limit < 1)` guard (not the `||` short-circuit, since `-5` is truthy)
- `nextCursor`: when results < limit → null
- Firestore error → 500 response
- Trace endpoint: Firestore error → 500 response
- `route` filter matches top-level `entry.route` field (not just `context.route`)
- `keyword` filter is case-insensitive (e.g. "ERROR" matches "error" in message)
- `keyword` with no matches → returns empty logs array
- Combined filters: `startTime` + `endTime` + `level` together → all Firestore .where() calls made
- `limit` with non-numeric string (e.g. "abc") → `parseInt` returns NaN → `|| DEFAULT_LIMIT`
- Trace endpoint: returns logs ordered by timestamp ascending (verify `orderBy` called with 'asc')
- Trace endpoint: respects MAX_TRACE_LIMIT (500)
- Main endpoint `requireAdmin` is inside try/catch → admin error returns 403 not 500
- Trace endpoint `requireAdmin` is OUTSIDE try/catch (line 87) → if `requireAdmin` throws, no 500 handler catches it
- `nextCursor` value: when present, equals the `timestamp` field of the last doc in the snapshot
- `route` filter with `entry.context` being null/undefined → optional chaining `?.route` returns undefined, skips entry
- Empty snapshot → returns `{ logs: [], nextCursor: null }`
- Main query always starts with `orderBy('timestamp', 'desc')` — verify ordering
- Response shape: `{ logs: [...], nextCursor: ... }` — verify both fields always present
- `keyword` filter: JSON.stringify of context with special chars → no crash (caught by outer try/catch if circular ref)
- Each log entry in response includes `id` field from Firestore doc id
- `route` filter with entry having `entry.route` at top level (no context) → still matches
- `keyword` empty string → all logs pass (empty string `.includes('')` is always true)
- No query params at all → returns all logs with DEFAULT_LIMIT (50) and descending order

### 6. `routes/storage.js` — delete: 3 → ~20 tests, upload: 8 → ~24 tests

**Existing upload tests (8):** cover jpeg/png/webp allowed, text/html/SVG/PDF rejected, disallowed path, missing file.

**Existing delete tests cover:** missing key 400, wrong owner 403, successful delete 200.

**Missing delete tests:**
- Key with fewer than 3 parts (e.g. `"onlyone"`) → 403
- Key with exactly 2 parts (e.g. `"profiles/file.jpg"`) → 403
- R2 deleteObject throws → 500 response
- Numeric uniqueId matches string key part (String(uniqueId) comparison)
- Key with extra path segments (e.g. `"profiles/user-abc/subfolder/file.jpg"`) → allowed (only checks keyParts[1])
- Different path prefixes (covers, messages, etc.) → all work if ownership matches
- Key with empty string → 400 (falsy, hits `!key` check)
- Successful delete: verify `log.info` called with key and uniqueId

**Missing upload tests:**
- R2 putObject failure → 500 response
- `image/gif` upload → allowed
- Missing path (no path field) → 400
- All 7 allowed paths accepted (use `test.each` for remaining 5 untested paths: covers, groups, evidence, stickers, banners)
- Upload key format: verify key is `{path}/{uniqueId}/{timestamp}-{random}.{ext}`
- Successful upload: verify `log.info` called with key, uniqueId, contentType
- File with no mimetype → defaults to `'image/jpeg'` (line 48: `file.mimetype || 'image/jpeg'`)
- Upload: verify `r2.putObject` called with correct key, buffer, and content type args
- Upload: file exceeds 10MB multer limit → multer error (400 or 500 depending on Express error handling)
- Delete: verify `log.warn` called on 403 with key and uniqueId for audit trail
- Upload: verify `log.warn` called on disallowed MIME type with uniqueId and contentType
- **Security: path traversal** in delete: key `"profiles/user-abc/../../admin/secret.jpg"` → keyParts[1] is `"user-abc"` which PASSES ownership check — verify r2.deleteObject receives the traversal path (documents this risk)
- Delete: key with URL-encoded chars (e.g. `"profiles/user-abc/%2e%2e/file.jpg"`) → verify behavior
- Upload: verify returned `url` value equals the r2.putObject return value exactly
- Delete: verify response content-type is `application/json`
- Upload: verify response content-type is `application/json`
- Upload: `log.warn` called on missing params includes `{ hasFile, hasPath }` booleans
- Delete response shape: `{ ok: true }` — verify exact shape
- Upload response shape: `{ url: ... }` — verify url field comes from r2.putObject return value
- Delete: verify `r2.deleteObject` called with exact key string from query param
- Upload: `application/octet-stream` MIME type → rejected (not in ALLOWED_MIME_TYPES)

### 7. `utils/firestore-helpers.js` — 4 tests → ~15 tests

**Source:** Two functions: `getDoc(path)` and `queryDocs(ref)`.

**Existing tests cover:** getDoc exists, getDoc not exists, queryDocs with results, queryDocs empty.

**Missing tests:**
- `getDoc`: Firestore throws → error propagates
- `getDoc`: document with no data fields → returns `{ id }`
- `getDoc`: called with correct path (verifies db.doc called with path arg)
- `queryDocs`: Firestore throws → error propagates
- `queryDocs`: single doc result
- `queryDocs`: documents with nested data
- `getDoc`: data contains fields that shadow `id` → spread order means doc field overwrites snap.id (verify behavior)
- `queryDocs`: large result set (10+ docs) → all mapped correctly
- `getDoc`: empty string path → passes to db.doc(''), verify db.doc called (behavior depends on Firestore)
- `getDoc`: data() returns object with `undefined` values → spread preserves them
- `queryDocs`: docs with `id` field in data → spread overwrites snap.id (same behavior as getDoc)

### 8. `utils/log.js` — 6 tests → ~13 tests

**Existing tests cover:** all 5 levels (debug, info, warn, error, fatal), never throws.

**Missing tests:**
- Context with nested objects → passed through correctly
- `null`/`undefined` message → doesn't throw
- `null`/`undefined` source → doesn't throw
- Context is `undefined` when not provided (3-arg call) → passed as `undefined` to logger
- `logEntry` swallows ALL errors: verify even `TypeError` (e.g. if `logger` is `null`) doesn't throw
- Called with zero arguments: `log.info()` → source is `undefined`, message is `undefined` — doesn't throw
- All 5 level functions are distinct exports — verify `log.debug !== log.info`

### 9. `utils/consoleLogger.js` — 6 tests → ~21 tests

**Source:** Patches console methods to also write to structured logger. Detects source from message patterns. Caps messages at 2000 chars.

**Existing tests cover:** console.error→ERROR, console.log→INFO, console.warn→WARN, AUTO-BAN source detection, never throws, truncation.

**Implementation note:** The existing `afterAll` restores `console.log`, `console.error`, `console.warn` but NOT `console.info`. When adding the `console.info` test, also add `const originalInfo = console.info;` at the top alongside the other originals, and `console.info = originalInfo;` to the `afterAll` block.

**Missing tests:**
- console.info → INFO level
- HTTP method prefix detection (e.g. `"GET /api/users"` → source `'http'`)
- Non-string arguments → JSON.stringify'd
- Multiple arguments → joined with space
- Object argument serialization
- `POST /api/users` prefix detection → source `'http'` (starts with POST)
- `DELETE /api/users/123` prefix detection → source `'http'`
- `PATCH /api/rooms/abc` prefix detection → source `'http'`
- `PUT /api/config` prefix detection → source `'http'`
- Message with no recognized prefix → falls back to `'express-api'` (already covered but verify explicitly)
- `null` argument → JSON.stringify'd to `"null"`
- `undefined` argument → JSON.stringify'd to `undefined` (not included in output — verify behavior)
- Circular object reference in argument → caught by inner try/catch, original console still outputs
- Original console methods still produce stdout output (patching doesn't suppress originals)
- Calling `patchConsole()` twice → second call re-patches, but `originalConsole` bindings were captured in first call's closure — original stdout still works
- `console.log()` with zero arguments → args is `[]`, map produces `[]`, join produces `""` — logger called with empty message
- `detectSource` returns `'express-api'` for messages not matching any pattern — verify default fallback explicitly

### 10. `cron/expireTempIds.js` — 3 tests → ~18 tests

**Source:** Queries users with tempUniqueIdExpiry <= now and > 0, batch updates to null.

**Existing tests cover:** expires past IDs, skips future IDs, empty results.

**Missing tests:**
- Single expired user → batch with 1 update
- Batch commit failure → error propagates
- Verifies correct Firestore query (two .where() calls with correct params)
- Large batch (verifies all docs updated)
- Log message includes count (verify `log.info` called with `{ count: snap.size }`)
- Update data shape: verify each doc updated with `{ tempUniqueId: null, tempUniqueIdExpiry: null }`
- Firestore query failure → error propagates (no try/catch in source)
- Uses single batch (no chunking) → **potential bug**: if >500 users have expired temp IDs, Firestore batch limit exceeded. Test with 501 docs to verify behavior (will throw Firestore error)
- Uses `batch.update()` not `batch.set()` → verify update semantics (only modifies specified fields, doesn't overwrite doc)
- Queries 'users' collection specifically → verify `db.collection('users')` called
- Two `.where()` clauses: `('tempUniqueIdExpiry', '<=', nowMs)` and `('tempUniqueIdExpiry', '>', 0)` → verify both applied
- No log message when `snap.empty` → function returns `undefined` silently, no log call
- Return value: `expireTempIds()` resolves to `undefined` in all paths
- `snap.size` used for log count (not `snap.docs.length`) — verify the mock provides `size` property

---

## Pass 2: Re-audit

After implementing all Pass 1 tests:
1. Run full test suite (`npm test`)
2. Run `npm run test:coverage` to identify remaining gaps
3. Re-audit each of the 10 files for any paths still uncovered
4. Write additional tests for any remaining gaps
5. Re-run full suite to confirm green

---

## Approach

- **One test file per chunk** — each of the 10 files gets its tests written or extended in-place
- **Follow existing patterns** — Jest mocks, Supertest, `createApp()` helpers, `beforeEach(jest.clearAllMocks)`
- **staleRooms only:** move test file from `src/__tests__/` to `tests/cron/`, delete old file
- **No source changes** — this is test-only work
- **Estimated new tests:** ~220-250 across 10 files

## Implementation Order

1. `cron/staleRooms.js` (highest risk, needs file move)
2. `cron/backups.js` (data integrity)
3. `cron/expireBans.js` (data deletion)
4. `cron/serverHealth.js` (infrastructure monitoring)
5. `cron/expireTempIds.js` (data mutation)
6. `routes/admin-logs.js` (query combinations)
7. `routes/storage.js` (delete + upload gaps)
8. `utils/firestore-helpers.js` (core helper)
9. `utils/log.js` (logging)
10. `utils/consoleLogger.js` (logging)

Then: Pass 2 re-audit + coverage gaps.

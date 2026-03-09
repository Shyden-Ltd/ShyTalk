# Optimise Changelog — ShyTalk

**Date:** 2026-03-09
**Total cycles:** 2 (across 2 sessions)
**Total issues found & fixed:** 8

---

## Pass 1 — Bugs & Logic Errors

- **`express-api/src/routes/economy.js:1014`** — Duplicate `const newCoins` declaration in same block scope caused `SyntaxError: Identifier 'newCoins' has already been declared`. Removed duplicate; first declaration at line 1005 already computed the correct value.

## Pass 2 — Security Risks

- **`express-api/src/routes/notifications.js:16,35`** — FCM token parameter lacked type validation. `req.body.token` was only checked for truthiness, allowing objects/arrays/numbers to be stored in Firestore's `fcmTokens` array via `arrayUnion`. Added `typeof req.body.token !== 'string'` guard on both POST and DELETE routes.

- **`express-api/src/routes/logs.js:42-50`** — Log entry `source` and `message` fields lacked type validation and length limits. Non-string values (objects, arrays) could be logged, and unbounded strings could cause log bloat. Added string type assertions and truncation constants (`MAX_SOURCE_LENGTH = 100`, `MAX_MESSAGE_LENGTH = 2000`).

## Pass 3 — i18n Issues

No new issues found.

## Pass 4 — Naming Conventions

No new issues found.

## Pass 5 — Comments & Documentation

- **`express-api/src/routes/translate.js:1-6`** — Added JSDoc route summary header documenting endpoints.
- **`express-api/src/routes/logs.js:1-6`** — Added JSDoc route summary header documenting endpoints.
- **`express-api/src/routes/notifications.js:1-7`** — Added JSDoc route summary header documenting endpoints.

## Pass 6 — Stale & Dead Code

- **`app/src/test/.../PrivateChatViewModelTest.kt:1291-1300`** — Removed duplicate test `hideConversation calls repository` that duplicated `hideConversation calls repo` at line 577.

## Pass 7 — Logging

No new issues found.

## Pass 8 — Responsive Design & Screen Compatibility

No new issues found.

## Pass 9 — Bandwidth & API Cost Reduction

No new issues found.

## Pass 10 — Webpage Checks

- **`public/index.html:126,140`** — Container `<div>` changed to semantic `<main>` element for accessibility and HTML5 standards compliance.

---

## Test Fixes

- **`express-api/tests/routes/conversations.test.js`** — 5 tests were failing because `db.doc()` mock was missing `.set()` method. The conversations route calls `db.doc(...).set(...)` for un-hiding conversations, which threw synchronously inside `.map()` before `Promise.all().catch()` could catch it. Also added `db.collection().doc()` for the logger mock.

- **`express-api/tests/routes/device-info.test.js`** — 2 tests were failing because supertest sends from `::ffff:127.0.0.1` (IPv6-mapped), which doesn't match the route's IPv4 regex in `getIpGeo()`. Added `x-forwarded-for: 203.0.113.1` header to the test that expects geo data.

## New Tests Added

- **`express-api/tests/routes/notifications.test.js`** (NEW — 15 tests)
  - POST token: valid string, missing, null, empty, object injection, array, numeric
  - DELETE token: valid string, missing, object injection, empty
  - PATCH settings: valid fields, unknown fields, truthy coercion, disallowed field filtering

- **`express-api/tests/routes/logs.test.js`** (4 new tests added)
  - Rejects non-string `source` (object)
  - Rejects non-string `message` (array)
  - Truncates oversized source to 100 chars
  - Truncates oversized message to 2000 chars

## Test Results

- **Express API:** 255 total — 255 passed, 0 failed
- **Kotlin unit tests:** 1829 total — 1829 passed, 0 failed
- **All new tests passing:** Yes (19/19)

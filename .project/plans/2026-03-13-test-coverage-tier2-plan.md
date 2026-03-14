# Test Coverage Tier 2: Core Features — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill test gaps for core user-facing features: Kotlin ViewModels, conversation methods, Express user/admin routes, and API contract tests.

**Architecture:** TDD — write tests for existing behavior. No implementation changes unless bugs are discovered.

**Tech Stack:** Jest/supertest (Express), MockK/JUnit (Kotlin), kotlin-test (commonTest)

---

## File Structure

### New Test Files
- `express-api/tests/routes/users-missing.test.js` — untested user endpoints (appeal, lift-suspension, unfollow, remove-follower)
- `express-api/tests/routes/admin-users-missing.test.js` — untested admin endpoints (warn, warnings, GCS reset, stalkers, auth-debug)
- `express-api/tests/routes/storage-upload-extended.test.js` — extended upload tests (currently only MIME validation)
- `express-api/tests/routes/banners.test.js` — all 7 banner endpoints
- `express-api/tests/routes/fun-facts.test.js` — all 5 fun-fact endpoints
- `express-api/tests/routes/admin-gifts.test.js` — all 3 gift catalog endpoints
- `express-api/tests/contracts/api-contracts.test.js` — API contract tests (response shape validation)
- `app/src/test/java/.../feature/splash/FunFactSplashViewModelTest.kt`
- `app/src/test/java/.../core/model/EconomyConfigMilestoneTest.kt`

---

## Task 1: Express user endpoints — appeal, unfollow, remove-follower

**Files:**
- Create: `express-api/tests/routes/users-missing.test.js`
- Reference: `express-api/src/routes/users.js`

Tests:
- POST /users/:id/appeal — 400 not suspended, 400 missing text, 200 creates appeal
- POST /users/:id/lift-suspension — 400 not suspended, 400 not expired, 200 lifts
- POST /users/:id/unfollow — 400 missing targetId, 200 removes follow
- POST /users/:id/remove-follower — 400 missing followerId, 200 removes follower

## Task 2: Express admin user endpoints — warnings, GCS, stalkers

**Files:**
- Create: `express-api/tests/routes/admin-users-missing.test.js`
- Reference: `express-api/src/routes/admin-users.js`

Tests:
- GET /admin/user/:uniqueId — 403 non-admin, 200 returns user
- POST /admin/user/:uniqueId/warn — 403, 200 creates warning with GCS deduction
- GET /admin/user/:uniqueId/warnings — 403, 200 returns warnings list
- POST /admin/user/:id/warnings/:id/revoke — 403, 200 revokes warning
- POST /admin/user/:uniqueId/reset-gcs — 403, 200 resets score
- GET /admin/user/:uniqueId/stalkers — 403, 200 returns stalker list

## Task 3: Express banners + fun-facts + admin-gifts tests

**Files:**
- Create: `express-api/tests/routes/banners.test.js`
- Create: `express-api/tests/routes/fun-facts.test.js`
- Create: `express-api/tests/routes/admin-gifts.test.js`

Tests per file:
- banners: GET /banners/active (200, empty, date filter), admin CRUD (403 guard, create, update, delete, reorder)
- fun-facts: GET /fun-facts (200, empty), admin CRUD (403, create, update, delete)
- admin-gifts: POST /gifts (403, 200), PUT /gifts/:id (403, 200), DELETE /gifts/:id (403, 200)

## Task 4: API contract tests

**Files:**
- Create: `express-api/tests/contracts/api-contracts.test.js`
- Reference: Kotlin model `fromMap` methods for expected field shapes

Contract tests verify that API response JSON matches the shape the Kotlin client expects. For each major entity:
- User profile: fields match User.fromMap expectations
- Room: fields match ChatRoom.fromMap
- Conversation: fields match Conversation.fromMap
- Gift: fields match Gift model
- Banner: fields match Banner.fromMap
- Economy balance: { shyCoins, shyBeans }
- Daily reward response shape
- Transaction shape

Each test mocks Firestore to return a complete document and asserts the response JSON has all required fields with correct types.

## Task 5: FunFactSplashViewModel tests

**Files:**
- Create: `app/src/test/java/.../feature/splash/FunFactSplashViewModelTest.kt`

Tests:
- warmUpComplete becomes true after all jobs finish
- funFacts populated from cache on init
- warmUpComplete true even if bannerRepository throws
- warmUpComplete true even if funFactRepository throws
- warmUpComplete true when currentUserId is null

## Task 6: EconomyConfig milestone reward parsing tests

**Files:**
- Create: `app/src/test/java/.../core/model/EconomyConfigMilestoneTest.kt`

Tests:
- milestoneRewards parses numeric-string keys correctly
- MilestoneReward.fromMap defaults type to "coins"
- MilestoneReward.fromMap defaults giftId to null
- milestoneRewards handles malformed inner objects
- milestoneRewards with non-Map value defaults to empty

## Task 7: Express cron job tests

**Files:**
- Create: `express-api/tests/cron/closedRooms.test.js`
- Create: `express-api/tests/cron/subscriptions.test.js`
- Create: `express-api/tests/cron/orphanedStorage.test.js`
- Create: `express-api/tests/cron/archiveReports.test.js`
- Create: `express-api/tests/cron/backpackCleanup.test.js`

Each cron job needs: happy path, empty collection, error handling.

## Task 8: Run all tests and verify

Run Express + Kotlin tests. Push and create PR.

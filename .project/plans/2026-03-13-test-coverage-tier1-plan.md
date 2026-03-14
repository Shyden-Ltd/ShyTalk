# Test Coverage Tier 1: Money & Security — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill critical test coverage gaps for money-handling endpoints, security-sensitive operations, and data-destructive admin endpoints.

**Architecture:** TDD — write failing tests first, verify they fail, then confirm they pass against existing code (no implementation changes needed, we're testing existing behavior). All tests use Jest with mocked Firebase/R2 dependencies following existing patterns in `express-api/tests/`.

**Tech Stack:** Jest, supertest, Express.js mocks

**Scope:** This is Tier 1 of 4. Covers Express API economy, reports, admin-cleanup, storage DELETE, plus Kotlin BannerRepositoryImpl and GiftRepositoryImpl tests. Estimated 6-8 tasks.

**Pre-work:** Delete legacy `docs/*.html` files (migrated to `public/` on Cloudflare Pages).

---

## File Structure

### New Test Files
- `express-api/tests/routes/economy-gacha.test.js` — gacha pull tests
- `express-api/tests/routes/economy-gifts.test.js` — gift, gift-direct, gift-batch, backpack-send tests
- `express-api/tests/routes/economy-purchase.test.js` — IAP purchase, trial, redeem-beans tests
- `express-api/tests/routes/economy-queries.test.js` — transactions, gift-wall, gift-wall-senders tests
- `express-api/tests/routes/reports-lifecycle.test.js` — report submit, resolve, appeals tests
- `express-api/tests/routes/reports-admin.test.js` — stats, export, lock, suspend/unsuspend tests
- `express-api/tests/routes/admin-cleanup.test.js` — destructive operation tests
- `express-api/tests/routes/storage-delete.test.js` — DELETE /storage/delete tests
- `app/src/test/java/com/shyden/shytalk/data/repository/BannerRepositoryImplTest.kt` — date-window filtering
- `app/src/test/java/com/shyden/shytalk/data/repository/GiftRepositoryImplTest.kt` — replace empty placeholder

### Files to Delete
- `docs/privacy-policy.html` — migrated to `public/privacy.html`
- `docs/terms-and-conditions.html` — migrated to `public/terms.html`
- `docs/community-guidelines.html` — migrated to `public/community-guidelines.html`

---

## Chunk 1: Express Economy Tests — Gacha & Gifts

### Task 1: Economy gacha tests

**Files:**
- Create: `express-api/tests/routes/economy-gacha.test.js`
- Reference: `express-api/src/routes/economy.js` (POST /economy/gacha, lines ~350-530)

**Mock pattern** (reuse across all economy test files):

```javascript
// Standard economy test setup
jest.mock('../../src/utils/firebase', () => {
  const mockGet = jest.fn();
  const mockSet = jest.fn().mockResolvedValue();
  const mockUpdate = jest.fn().mockResolvedValue();
  const mockDelete = jest.fn().mockResolvedValue();
  const mockAdd = jest.fn().mockResolvedValue({ id: 'mock-id' });
  const mockDoc = jest.fn(() => ({
    get: mockGet, set: mockSet, update: mockUpdate, delete: mockDelete,
    collection: jest.fn(() => ({ add: mockAdd, get: mockGet })),
  }));
  const mockWhere = jest.fn().mockReturnThis();
  const mockOrderBy = jest.fn().mockReturnThis();
  const mockLimit = jest.fn().mockReturnThis();
  const mockCollection = jest.fn(() => ({
    doc: mockDoc, where: mockWhere, orderBy: mockOrderBy,
    limit: mockLimit, get: mockGet, add: mockAdd,
  }));
  const mockRunTransaction = jest.fn(async (fn) => fn({
    get: mockGet, set: mockSet, update: mockUpdate, delete: mockDelete,
  }));
  return {
    db: {
      doc: mockDoc, collection: mockCollection,
      runTransaction: mockRunTransaction, batch: jest.fn(() => ({
        set: mockSet, update: mockUpdate, delete: mockDelete,
        commit: jest.fn().mockResolvedValue(),
      })),
    },
    admin: { firestore: { FieldValue: { increment: jest.fn(n => `increment(${n})`) } } },
  };
});
jest.mock('../../src/utils/log', () => ({
  debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));
```

- [ ] **Step 1: Write failing gacha tests**

Test scenarios for `POST /economy/gacha`:
1. `returns 400 when pullCount is missing`
2. `returns 400 when pullCount is not 1, 10, or 100`
3. `returns 402 when user has insufficient coins`
4. `returns 404 when user not found`
5. `returns 200 with items array on successful single pull`
6. `returns 200 with correct item count for 10-pull`
7. `deducts correct coin amount from user balance`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testMatch='**/tests/routes/economy-gacha*' --verbose`
Expected: FAIL (tests reference real route behavior)

- [ ] **Step 3: Fix mock setup to match real behavior, verify tests pass**

Run: `npx jest --testMatch='**/tests/routes/economy-gacha*' --verbose`
Expected: All 7 tests PASS

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/routes/economy-gacha.test.js
git commit -m "test: add gacha pull endpoint tests (economy.js)"
```

### Task 2: Economy gift endpoint tests

**Files:**
- Create: `express-api/tests/routes/economy-gifts.test.js`
- Reference: `express-api/src/routes/economy.js` (POST /economy/gift, gift-direct, gift-batch, backpack-send)

- [ ] **Step 1: Write failing gift tests**

Test scenarios for `POST /economy/gift` (from backpack):
1. `returns 400 when recipientId missing`
2. `returns 400 when giftId missing`
3. `returns 402 when insufficient backpack quantity`
4. `returns 404 when recipient not found`
5. `returns 404 when gift not found`
6. `returns 400 when sending to self`
7. `returns 200 and decrements backpack on success`

Test scenarios for `POST /economy/gift-direct` (buy + send):
8. `returns 402 when insufficient coins`
9. `returns 200 and deducts coins on success`

Test scenarios for `POST /economy/gift-batch`:
10. `returns 400 when recipientIds is not an array`
11. `returns 400 when recipientIds exceeds 50`
12. `returns 402 when insufficient balance for batch`
13. `returns 200 with correct recipientCount`

Test scenarios for `POST /economy/backpack-send`:
14. `returns 400 when backpack is empty`
15. `returns 200 and clears entire backpack`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest --testMatch='**/tests/routes/economy-gifts*' --verbose`
Expected: FAIL

- [ ] **Step 3: Fix mock setup, verify tests pass**

Run: `npx jest --testMatch='**/tests/routes/economy-gifts*' --verbose`
Expected: All 15 tests PASS

- [ ] **Step 4: Commit**

```bash
git add express-api/tests/routes/economy-gifts.test.js
git commit -m "test: add gift/gift-direct/gift-batch/backpack-send tests (economy.js)"
```

### Task 3: Economy purchase, trial, and redeem tests

**Files:**
- Create: `express-api/tests/routes/economy-purchase.test.js`
- Reference: `express-api/src/routes/economy.js` (POST /economy/purchase, trial-claim, trial-activate, redeem-beans)

- [ ] **Step 1: Write failing purchase tests**

Test scenarios for `POST /economy/purchase` (IAP):
1. `returns 400 when productId missing`
2. `returns 400 when purchaseToken missing`
3. `returns 409 when duplicate purchaseToken`
4. `returns 403 when Google Play verification fails`
5. `returns 200 and increments coins for coin package`
6. `returns 200 and sets isSuperShy for subscription`

Test scenarios for `POST /economy/trial-claim`:
7. `returns 409 when trial already claimed`
8. `returns 200 and adds trial item to backpack`

Test scenarios for `POST /economy/trial-activate`:
9. `returns 402 when no trial item in backpack`
10. `returns 200 and sets isSuperShy with 30-day expiry`

Test scenarios for `POST /economy/redeem-beans`:
11. `returns 400 when amount <= 0`
12. `returns 402 when insufficient beans`
13. `returns 200 and converts beans to coins`

- [ ] **Step 2: Run, verify fail**
- [ ] **Step 3: Fix mocks, verify pass**
- [ ] **Step 4: Commit**

```bash
git add express-api/tests/routes/economy-purchase.test.js
git commit -m "test: add purchase/trial/redeem-beans tests (economy.js)"
```

### Task 4: Economy query endpoint tests

**Files:**
- Create: `express-api/tests/routes/economy-queries.test.js`

- [ ] **Step 1: Write failing query tests**

Test scenarios:
1. `GET /economy/transactions returns 200 with transaction list`
2. `GET /economy/transactions respects limit parameter`
3. `GET /economy/transactions filters by type`
4. `GET /users/:id/gift-wall returns 200 with gifts`
5. `GET /users/:id/gift-wall/:giftId/senders returns sorted senders`

- [ ] **Step 2-4: Standard TDD cycle + commit**

```bash
git commit -m "test: add economy query endpoint tests (transactions, gift-wall)"
```

---

## Chunk 2: Express Reports & Storage Tests

### Task 5: Reports lifecycle tests

**Files:**
- Create: `express-api/tests/routes/reports-lifecycle.test.js`
- Reference: `express-api/src/routes/reports.js`

- [ ] **Step 1: Write failing report lifecycle tests**

Test scenarios for `POST /reports` (submit):
1. `returns 400 when reportedUserId missing`
2. `returns 400 when reason missing`
3. `returns 200 and creates report document`

Test scenarios for `POST /reports/:id/resolve` (admin):
4. `returns 403 for non-admin`
5. `returns 404 when report not found`
6. `returns 200 for dismissed action`
7. `returns 200 for warned action and creates warning`
8. `returns 200 for suspended action`

Test scenarios for `POST /appeals` (user):
9. `returns 400 when user not suspended`
10. `returns 400 when appealText empty`
11. `returns 403 when canAppeal is false`
12. `returns 409 when appeal already pending`
13. `returns 200 and creates appeal document`

Test scenarios for `PATCH /appeals/:id` (admin):
14. `returns 400 for invalid status`
15. `returns 200 for approved appeal and unsuspends user`
16. `returns 200 for denied appeal`

- [ ] **Step 2-4: Standard TDD cycle + commit**

```bash
git commit -m "test: add report submit/resolve/appeal lifecycle tests"
```

### Task 6: Reports admin + storage DELETE tests

**Files:**
- Create: `express-api/tests/routes/reports-admin.test.js`
- Create: `express-api/tests/routes/storage-delete.test.js`
- Reference: `express-api/src/routes/reports.js`, `express-api/src/routes/storage.js`

- [ ] **Step 1: Write failing reports admin tests**

Test scenarios:
1. `GET /reports/stats returns 200 with pending/resolved counts`
2. `GET /reports/export returns CSV with date range`
3. `POST /reports/:id/lock returns 200 and creates lock`
4. `DELETE /reports/:id/lock returns 200 and removes lock`
5. `POST /reports/resolve-all/:userId resolves all user reports`
6. `GET /admin/audit-log returns recent admin actions`

- [ ] **Step 2: Write failing storage DELETE tests**

Test scenarios for `DELETE /storage/delete`:
7. `returns 400 when key is missing`
8. `returns 403 when key does not contain caller uniqueId`
9. `returns 200 and deletes R2 object when key matches user`

- [ ] **Step 3-5: Standard TDD cycle + commit**

```bash
git commit -m "test: add reports admin (stats/export/lock) + storage DELETE tests"
```

---

## Chunk 3: Express Admin Cleanup Tests

### Task 7: Admin cleanup destructive operation tests

**Files:**
- Create: `express-api/tests/routes/admin-cleanup.test.js`
- Reference: `express-api/src/routes/admin-cleanup.js`

The cleanup endpoints follow a consistent pattern: require admin, query docs, delete/reset in batches. We don't need to test every single one exhaustively — test the pattern with representative endpoints, then verify admin guard on all.

- [ ] **Step 1: Write admin guard tests for all cleanup endpoints**

```javascript
// Test that every cleanup endpoint returns 403 for non-admin
const cleanupEndpoints = [
  'POST /api/cleanup/system-conversations',
  'POST /api/cleanup/all-reports',
  'POST /api/cleanup/all-warnings',
  'POST /api/cleanup/all-backpacks',
  'POST /api/cleanup/all-giftwalls',
  'POST /api/cleanup/all-coins',
  'POST /api/cleanup/all-beans',
  'POST /api/cleanup/all-spin-history',
  'POST /api/cleanup/all-transactions',
  'POST /api/cleanup/all-supershy',
  'POST /api/cleanup/all-appeals',
  'POST /api/cleanup/all-private-messages',
  'POST /api/cleanup/all-group-chats',
  'POST /api/cleanup/all-rooms',
  'POST /api/cleanup/all-broadcasts',
  'POST /api/cleanup/all-audit-logs',
  'POST /api/cleanup/all-device-bindings',
  'POST /api/cleanup/all-stalkers',
  'POST /api/cleanup/destroyed-users',
  'POST /api/cleanup/orphaned-storage',
  'GET /api/storage/audit',
];

cleanupEndpoints.forEach(endpoint => {
  test(`${endpoint} returns 403 for non-admin`, async () => { ... });
});
```

- [ ] **Step 2: Write representative happy-path tests**

Test 3-4 representative endpoints in detail:
1. `POST /cleanup/all-coins resets all user coin balances to 0`
2. `POST /cleanup/all-device-bindings deletes all bindings`
3. `GET /storage/audit returns folder counts and sizes`
4. `POST /cleanup/orphaned-storage deletes unreferenced keys`

- [ ] **Step 3-5: Standard TDD cycle + commit**

```bash
git commit -m "test: add admin cleanup tests (403 guard + representative happy paths)"
```

---

## Chunk 4: Kotlin Repository Tests

### Task 8: BannerRepositoryImpl date-window filtering tests

**Files:**
- Create: `app/src/test/java/com/shyden/shytalk/data/repository/BannerRepositoryImplTest.kt`
- Reference: `app/src/main/java/com/shyden/shytalk/data/repository/BannerRepositoryImpl.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
@Test
fun `getActiveBanners excludes banner with future startDate`()

@Test
fun `getActiveBanners excludes banner with past endDate`()

@Test
fun `getActiveBanners includes banner with zero startDate`()

@Test
fun `getActiveBanners includes banner with MAX_VALUE endDate`()

@Test
fun `getActiveBanners sorts results by sortOrder`()

@Test
fun `getActiveBanners returns empty list when no banners match`()

@Test
fun `getActiveBanners returns Error on Firestore exception`()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./gradlew test --tests "*.BannerRepositoryImplTest" -i`
Expected: FAIL (test class doesn't exist yet / tests fail)

- [ ] **Step 3: Write test implementation with MockK**

Follow the pattern from `PrivateMessageRepositoryImplTest.kt`:
- Mock `FirebaseFirestore`, `QuerySnapshot`, `DocumentSnapshot`
- Set up document data with controlled timestamps
- Assert filtering and sorting behavior

- [ ] **Step 4: Verify tests pass**

Run: `./gradlew test --tests "*.BannerRepositoryImplTest" -i`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/test/java/com/shyden/shytalk/data/repository/BannerRepositoryImplTest.kt
git commit -m "test: add BannerRepositoryImpl date-window filtering tests"
```

### Task 9: GiftRepositoryImpl tests

**Files:**
- Modify: `app/src/test/java/com/shyden/shytalk/data/repository/GiftRepositoryImplTest.kt` (replace placeholder)
- Reference: `app/src/main/java/com/shyden/shytalk/data/repository/GiftRepositoryImpl.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
@Test
fun `sendGift returns Success on API 200`()

@Test
fun `sendGift returns Error on API failure`()

@Test
fun `sendGift includes correct parameters in API call`()

@Test
fun `claimGiftFromBackpack returns Success on API 200`()

@Test
fun `claimGiftFromBackpack returns Error on API failure`()

@Test
fun `getGiftWall returns Success with gift list`()

@Test
fun `getGiftWall returns Error on Firestore exception`()
```

- [ ] **Step 2-4: Standard TDD cycle**
- [ ] **Step 5: Commit**

```bash
git commit -m "test: replace GiftRepositoryImpl placeholder with real tests"
```

### Task 10: Conversation business method tests

**Files:**
- Create: `shared/src/commonTest/kotlin/com/shyden/shytalk/core/model/ConversationBusinessTest.kt`
- Reference: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/Conversation.kt`

- [ ] **Step 1: Write failing tests**

```kotlin
@Test
fun `generateId is commutative`() {
    assertEquals(Conversation.generateId("a", "b"), Conversation.generateId("b", "a"))
}

@Test
fun `otherUserId returns other participant in two-person conversation`()

@Test
fun `otherUserId returns null when participant list has one entry`()

@Test
fun `isAdmin returns true for createdBy user`()

@Test
fun `isAdmin returns true for user in groupAdminIds`()

@Test
fun `isMod returns true for user in groupModIds`()

@Test
fun `isModOrAbove returns true for admin`()

@Test
fun `roleOf returns OWNER for createdBy`()

@Test
fun `roleOf returns MEMBER for non-privileged user`()
```

- [ ] **Step 2-4: Standard TDD cycle**
- [ ] **Step 5: Commit**

```bash
git commit -m "test: add Conversation business method tests (generateId, roleOf, otherUserId)"
```

---

## Chunk 5: Cleanup & Verification

### Task 11: Delete legacy docs HTML files

**Files:**
- Delete: `docs/privacy-policy.html`
- Delete: `docs/terms-and-conditions.html`
- Delete: `docs/community-guidelines.html`

- [ ] **Step 1: Delete files**

```bash
git rm docs/privacy-policy.html docs/terms-and-conditions.html docs/community-guidelines.html
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore: remove legacy docs/ HTML files (migrated to public/ on Cloudflare Pages)"
```

### Task 12: Run all tests and verify

- [ ] **Step 1: Run Express tests**

```bash
cd express-api && npx jest --testMatch='**/{src/__tests__,tests}/**/*.test.js' --verbose
```

Expected: All new tests pass, no regressions in existing tests.

- [ ] **Step 2: Run Kotlin tests**

```bash
./gradlew test
```

Expected: All tests pass including new BannerRepositoryImpl, GiftRepositoryImpl, ConversationBusiness tests.

- [ ] **Step 3: Commit any fixes, then push and create PR**

```bash
git push -u origin feature/test-coverage-tier1
gh pr create --title "Add Tier 1 test coverage: money, security & data-destructive endpoints" --body "..."
```

---

## Summary

| Task | Files | Tests Added | Priority |
|------|-------|-------------|----------|
| 1 | economy-gacha.test.js | 7 | Critical |
| 2 | economy-gifts.test.js | 15 | Critical |
| 3 | economy-purchase.test.js | 13 | Critical |
| 4 | economy-queries.test.js | 5 | Important |
| 5 | reports-lifecycle.test.js | 16 | Critical |
| 6 | reports-admin.test.js + storage-delete.test.js | 9 | Critical |
| 7 | admin-cleanup.test.js | ~25 | Critical |
| 8 | BannerRepositoryImplTest.kt | 7 | Critical |
| 9 | GiftRepositoryImplTest.kt | 7 | Critical |
| 10 | ConversationBusinessTest.kt | 9 | Important |
| 11 | Delete legacy HTML | 0 (cleanup) | Low |
| 12 | Full test run | 0 (verification) | Required |
| **Total** | **12 tasks** | **~113 tests** | |

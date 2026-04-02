# Phase 1: Deep Playwright Tests — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shallow Playwright admin tests (90% visibility checks) with full round-trip functional tests that seed data, perform actions, reload, and verify persistence.

**Architecture:** Worker-scoped fixtures seed test data via the Express API test-helpers endpoint, share an authenticated BrowserContext across tests, and clean up on teardown. An `AdminApi` class intercepts the Firebase auth token and wraps `page.request` for API verification calls.

**Tech Stack:** Playwright, TypeScript, Express.js test-helpers API, Firebase Auth + Firestore

**Spec:** `.project/specs/2026-03-18-playwright-phase1-deep-tests.md`

**Key principle:** When a test fails, assume the app/backend is broken — investigate the admin panel or API code first, not the test.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `express-api/src/routes/test-helpers.js` | Fix setup (uniqueId, field names, device binding) and teardown (recursive delete, ban cleanup) |
| Modify | `express-api/tests/routes/test-helpers.test.js` | Tests for the updated endpoints |
| Create | `tests/web/helpers/api.ts` | AdminApi class — token interception + typed HTTP wrapper |
| Modify | `tests/web/fixtures/admin.ts` | Extend with `testData` worker-scoped fixture (spec shows separate `test-data.ts` but we consolidate into `admin.ts` for simplicity — one fixture file, one import) |
| Modify | `tests/web/helpers/admin-auth.ts` | No changes needed (already updated in prior PR) |
| Rewrite | `tests/web/admin-login.spec.ts` | Minor: add round-trip to sign-out test |
| Rewrite | `tests/web/admin-users-profile.spec.ts` | 10 full round-trip tests |
| Rewrite | `tests/web/admin-users-moderation.spec.ts` | 10 full round-trip tests |
| Rewrite | `tests/web/admin-users-security.spec.ts` | 6 full round-trip tests |
| Rewrite | `tests/web/admin-users-economy.spec.ts` | 10 full round-trip tests |
| Modify | `.github/workflows/e2e-tests.yml` | Add `TEST_API_KEY` + `API_BASE_URL` env vars |
| Keep | `tests/web/admin-panel.spec.ts` | No changes |
| Keep | `tests/web/landing-page.spec.ts` | No changes |
| Keep | `tests/web/legal-pages.spec.ts` | No changes |

---

## Chunk 1: Backend Prerequisites (test-helpers.js)

### Task 1: Fix test user setup — uniqueId allocation + production field names

**Files:**
- Modify: `express-api/src/routes/test-helpers.js`
- Test: `express-api/tests/routes/test-helpers.test.js`

- [ ] **Step 1: Write failing test for uniqueId allocation**

In `express-api/tests/routes/test-helpers.test.js`, add a test that verifies the setup endpoint returns a numeric `uniqueId` and stores the user doc at `users/{uniqueId}`:

```javascript
describe('POST /api/test/setup - uniqueId allocation', () => {
  it('should allocate a numeric uniqueId and store doc at users/{uniqueId}', async () => {
    const res = await request(app)
      .post('/api/test/setup')
      .set('X-Test-API-Key', TEST_KEY)
      .send({ users: [{ name: 'test-uid-alloc', shyCoins: 100, shyBeans: 50 }] });

    expect(res.status).toBe(200);
    expect(res.body.testRunId).toBeTruthy();
    expect(res.body.users).toHaveLength(1);

    const user = res.body.users[0];
    expect(typeof user.uniqueId).toBe('number');
    expect(user.uniqueId).toBeGreaterThan(0);
    expect(user.uid).toBeTruthy();
    expect(user.displayName).toBe('test-uid-alloc');

    // Verify the doc was stored at users/{uniqueId}
    const docRef = db.doc(`users/${user.uniqueId}`);
    const doc = await docRef.get();
    expect(doc.exists).toBe(true);
    expect(doc.data().shyCoins).toBe(100);
    expect(doc.data().shyBeans).toBe(50);
    expect(doc.data().gcsScore).toBe(100);
    expect(doc.data().uniqueId).toBe(user.uniqueId);
    expect(doc.data().warningCount).toBe(0);
    expect(doc.data().hasActiveWarning).toBe(false);
    expect(doc.data().luckScore).toBe(0);
    expect(doc.data().pityCounter).toBe(0);
    expect(doc.data().isSuspended).toBe(false);
    expect(doc.data()._testRun).toBe(res.body.testRunId);

    // Cleanup
    await request(app)
      .post('/api/test/teardown')
      .set('X-Test-API-Key', TEST_KEY)
      .send({ testRunId: res.body.testRunId });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="uniqueId allocation" -v`
Expected: FAIL — current setup doesn't return `uniqueId` or use production field names.

- [ ] **Step 3: Implement uniqueId allocation in test-helpers.js**

Read the current `POST /api/test/setup` handler in `express-api/src/routes/test-helpers.js`. Replace the user creation logic with:

```javascript
// Inside the user creation loop:
// 1. Allocate uniqueId via counter transaction
const counterRef = db.doc('counters/uniqueId');
const uniqueId = await db.runTransaction(async (t) => {
  const counterDoc = await t.get(counterRef);
  const current = counterDoc.exists ? counterDoc.data().value : 10000000;
  const next = current + 1;
  t.set(counterRef, { value: next }, { merge: true });
  return next;
});

// 2. Write user doc at users/{uniqueId} with production field names
const uid = `test_${testRunId}_user_${i}`;
const userData = {
  uid,                        // admin-users.js reads user.uid for backfillAuthInfo
  firebaseUid: uid,           // Production field name (users.js stores this)
  uniqueId,
  displayName: user.name || `Test User ${i}`,
  userType: user.role || 'MEMBER',
  shyCoins: user.shyCoins ?? 0,
  shyBeans: user.shyBeans ?? 0,
  gcsScore: 100,
  warningCount: 0,
  hasActiveWarning: false,
  luckScore: 0,
  pityCounter: 0,
  isSuspended: false,
  createdAt: Date.now(),
  _testRun: testRunId,
};
await db.doc(`users/${uniqueId}`).set(userData);
created.users.push({ ...userData });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="uniqueId allocation" -v`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd express-api && npm test`
Expected: All 1133+ tests pass. Fix any regressions in existing test-helpers tests that relied on the old field names (`coins`, `beans`, `gcs`).

- [ ] **Step 6: Commit**

```bash
git add express-api/src/routes/test-helpers.js express-api/tests/routes/test-helpers.test.js
git commit -m "feat: allocate real uniqueId + use production field names in test setup"
```

### Task 2: Add device binding seeding to test setup

**Files:**
- Modify: `express-api/src/routes/test-helpers.js`
- Test: `express-api/tests/routes/test-helpers.test.js`

- [ ] **Step 1: Write failing test for device binding seeding**

```javascript
it('should create deviceBindings doc when deviceInfo is provided', async () => {
  const res = await request(app)
    .post('/api/test/setup')
    .set('X-Test-API-Key', TEST_KEY)
    .send({
      users: [{
        name: 'test-device-seed',
        shyCoins: 100,
        shyBeans: 0,
        deviceInfo: {
          deviceId: 'test-device-123',
          manufacturer: 'Google',
          model: 'Pixel 6',
          lastIp: '203.0.113.1',
          isp: 'Test ISP',
        },
      }],
    });

  expect(res.status).toBe(200);
  const user = res.body.users[0];

  // Verify device binding doc exists
  const bindingDoc = await db.doc('deviceBindings/test-device-123').get();
  expect(bindingDoc.exists).toBe(true);
  expect(bindingDoc.data().uniqueId).toBe(user.uniqueId); // number, not string
  expect(typeof bindingDoc.data().uniqueId).toBe('number');
  expect(bindingDoc.data().manufacturer).toBe('Google');
  expect(bindingDoc.data().model).toBe('Pixel 6');
  expect(bindingDoc.data().lastIp).toBe('203.0.113.1');
  expect(bindingDoc.data().isp).toBe('Test ISP');
  expect(bindingDoc.data()._testRun).toBe(res.body.testRunId);

  // Also verify user doc has lastIp for ban tests
  const userDoc = await db.doc(`users/${user.uniqueId}`).get();
  expect(userDoc.data().lastIp).toBe('203.0.113.1');

  // Cleanup
  await request(app)
    .post('/api/test/teardown')
    .set('X-Test-API-Key', TEST_KEY)
    .send({ testRunId: res.body.testRunId });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="deviceBindings" -v`
Expected: FAIL

- [ ] **Step 3: Implement device binding seeding**

After creating the user doc, add:

```javascript
// 3. Optionally create device binding
if (user.deviceInfo) {
  const { deviceId, manufacturer, model, lastIp, isp } = user.deviceInfo;
  await db.doc(`deviceBindings/${deviceId}`).set({
    deviceId,
    uniqueId, // number — must match user doc type for Firestore queries
    manufacturer: manufacturer || 'Unknown',
    model: model || 'Unknown',
    lastIp: lastIp || null,
    isp: isp || null,
    boundAt: Date.now(),
    _testRun: testRunId,
  });
  // Also set lastIp on user doc for ban tests
  if (lastIp) {
    await db.doc(`users/${uniqueId}`).update({ lastIp });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="deviceBindings" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add express-api/src/routes/test-helpers.js express-api/tests/routes/test-helpers.test.js
git commit -m "feat: support device binding seeding in test setup"
```

### Task 3: Implement recursive teardown with ban cleanup

**Files:**
- Modify: `express-api/src/routes/test-helpers.js`
- Test: `express-api/tests/routes/test-helpers.test.js`

- [ ] **Step 1: Write failing test for recursive teardown**

```javascript
describe('POST /api/test/teardown - recursive cleanup', () => {
  it('should delete user subcollections, device bindings, and bans', async () => {
    // Setup: create user with device binding
    const setupRes = await request(app)
      .post('/api/test/setup')
      .set('X-Test-API-Key', TEST_KEY)
      .send({
        users: [{
          name: 'test-teardown',
          shyCoins: 100,
          shyBeans: 0,
          deviceInfo: { deviceId: 'td-device-1', manufacturer: 'G', model: 'P', lastIp: '1.2.3.4', isp: 'T' },
        }],
      });
    const { testRunId, users } = setupRes.body;
    const user = users[0];

    // Simulate data that admin actions would create
    await db.doc(`users/${user.uniqueId}/warnings/w1`).set({ reason: 'test', createdAt: Date.now() });
    await db.doc(`users/${user.uniqueId}/transactions/t1`).set({ type: 'ADMIN_ADJUSTMENT', amount: 100 });
    await db.doc(`users/${user.uniqueId}/backpack/g1`).set({ giftId: 'g1', quantity: 3 });
    await db.doc(`deviceBans/td-device-1`).set({ linkedUniqueId: user.uniqueId, reason: 'test' });
    await db.doc(`networkBans/nb1`).set({ linkedUniqueId: user.uniqueId, type: 'ip', value: '1.2.3.4' });

    // Teardown
    const teardownRes = await request(app)
      .post('/api/test/teardown')
      .set('X-Test-API-Key', TEST_KEY)
      .send({ testRunId });

    expect(teardownRes.status).toBe(200);

    // Verify everything is deleted
    expect((await db.doc(`users/${user.uniqueId}`).get()).exists).toBe(false);
    expect((await db.doc(`users/${user.uniqueId}/warnings/w1`).get()).exists).toBe(false);
    expect((await db.doc(`users/${user.uniqueId}/transactions/t1`).get()).exists).toBe(false);
    expect((await db.doc(`users/${user.uniqueId}/backpack/g1`).get()).exists).toBe(false);
    expect((await db.doc(`deviceBindings/td-device-1`).get()).exists).toBe(false);
    expect((await db.doc(`deviceBans/td-device-1`).get()).exists).toBe(false);
    expect((await db.doc(`networkBans/nb1`).get()).exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="recursive cleanup" -v`
Expected: FAIL — current teardown only deletes top-level docs, misses subcollections and bans.

- [ ] **Step 3: Implement recursive teardown**

Replace the `deleteTestData` function in `test-helpers.js` with:

```javascript
/** Delete all docs in known subcollections, then the parent doc */
async function deleteDocWithSubcollections(docRef) {
  const subcollections = ['warnings', 'transactions', 'backpack'];
  for (const sub of subcollections) {
    const snap = await docRef.collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (snap.size > 0) await batch.commit();
  }
  await docRef.delete();
}

async function deleteTestData(testRunId) {
  let deleted = 0;

  // 1. Find all test users and delete docs + subcollections
  const userSnap = await db.collection('users').where('_testRun', '==', testRunId).get();
  const userUniqueIds = [];
  for (const doc of userSnap.docs) {
    userUniqueIds.push(doc.data().uniqueId || doc.id);
    await deleteDocWithSubcollections(doc.ref);
    deleted++;
  }

  // 2. Delete device bindings tagged with this testRun
  const bindingSnap = await db.collection('deviceBindings').where('_testRun', '==', testRunId).get();
  const batch1 = db.batch();
  for (const doc of bindingSnap.docs) {
    batch1.delete(doc.ref);
    deleted++;
  }
  if (bindingSnap.size > 0) await batch1.commit();

  // 3. Delete device and network bans linked to test users
  // linkedUniqueId may be stored as number (from Firestore doc) or string
  // (from Express route params). Firestore equality is type-strict, so query both.
  for (const uid of userUniqueIds) {
    for (const uidVariant of [uid, String(uid)]) {
      const deviceBanSnap = await db.collection('deviceBans').where('linkedUniqueId', '==', uidVariant).get();
      for (const doc of deviceBanSnap.docs) { await doc.ref.delete(); deleted++; }

      const networkBanSnap = await db.collection('networkBans').where('linkedUniqueId', '==', uidVariant).get();
      for (const doc of networkBanSnap.docs) { await doc.ref.delete(); deleted++; }
    }
  }

  // 4. Delete other top-level test docs (gifts, rooms, banners, funFacts, conversations)
  // Note: system PMs created by admin actions (warn, suspend, balance adjust) won't have
  // _testRun set, so they accumulate. This is an accepted trade-off — the dev cron handles cleanup.
  const otherCollections = ['gifts', 'rooms', 'banners', 'funFacts', 'conversations'];
  for (const col of otherCollections) {
    const snap = await db.collection(col).where('_testRun', '==', testRunId).get();
    const batch = db.batch();
    for (const doc of snap.docs) { batch.delete(doc.ref); deleted++; }
    if (snap.size > 0) await batch.commit();
  }

  return deleted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd express-api && npx jest tests/routes/test-helpers.test.js --testNamePattern="recursive cleanup" -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd express-api && npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add express-api/src/routes/test-helpers.js express-api/tests/routes/test-helpers.test.js
git commit -m "feat: recursive teardown — delete subcollections, device bindings, and bans"
```

- [ ] **Step 7: Deploy to dev**

Push the branch, wait for the Release Pipeline to deploy the backend to dev, then verify:

```bash
curl -s -H "X-Test-API-Key: $TEST_API_KEY" https://dev-api.shytalk.shyden.co.uk/api/health
```

Expected: `{"status":"ok",...}`

---

## Chunk 2: Playwright Infrastructure (API client + fixtures)

### Task 4: Create `helpers/api.ts` — AdminApi class

**Files:**
- Create: `tests/web/helpers/api.ts`

- [ ] **Step 1: Create the AdminApi class**

```typescript
import { Page } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'https://dev-api.shytalk.shyden.co.uk';
const TEST_API_KEY = process.env.TEST_API_KEY || '';

export interface SetupUserPayload {
  name: string;
  shyCoins?: number;
  shyBeans?: number;
  deviceInfo?: {
    deviceId: string;
    manufacturer: string;
    model: string;
    lastIp: string;
    isp: string;
  };
}

export interface SetupPayload {
  users: SetupUserPayload[];
}

export interface SetupResult {
  testRunId: string;
  users: Array<{
    uid: string;
    uniqueId: number;
    displayName: string;
  }>;
}

export class AdminApi {
  private token: string | null = null;
  private tokenPromise: Promise<string>;
  private resolveToken!: (token: string) => void;

  constructor(private page: Page) {
    this.tokenPromise = new Promise((resolve) => {
      this.resolveToken = resolve;
    });

    // Intercept the first authenticated request to capture the Firebase token
    const handler = (request: any) => {
      const auth = request.headers()['authorization'];
      if (auth?.startsWith('Bearer ')) {
        this.token = auth.slice(7);
        this.resolveToken(this.token);
        page.off('request', handler);
      }
    };
    page.on('request', handler);
  }

  /** Block until the Firebase token is captured from an authenticated request (15s deadline) */
  async waitForToken(): Promise<string> {
    return Promise.race([
      this.tokenPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Token not captured within 15s — no authenticated API call detected')), 15_000),
      ),
    ]);
  }

  // ── Admin API (Firebase Bearer token) ──

  async get(path: string): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.get(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) throw new Error(`GET ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async post(path: string, body?: any): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.post(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: body,
    });
    if (!res.ok()) throw new Error(`POST ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async patch(path: string, body?: any): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.patch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: body,
    });
    if (!res.ok()) throw new Error(`PATCH ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async delete(path: string): Promise<any> {
    const token = await this.tokenPromise;
    const res = await this.page.request.delete(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) throw new Error(`DELETE ${path} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  // ── Test Helper API (X-Test-API-Key) ──

  async testSetup(data: SetupPayload): Promise<SetupResult> {
    const res = await this.page.request.post(`${API_BASE}/api/test/setup`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY, 'Content-Type': 'application/json' },
      data,
    });
    if (!res.ok()) throw new Error(`test/setup → ${res.status()}: ${await res.text()}`);
    return res.json();
  }

  async testTeardown(testRunId: string): Promise<void> {
    const res = await this.page.request.post(`${API_BASE}/api/test/teardown`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY, 'Content-Type': 'application/json' },
      data: { testRunId },
    });
    if (!res.ok()) throw new Error(`test/teardown → ${res.status()}: ${await res.text()}`);
  }

  async testVerify(collection: string, docId: string): Promise<any> {
    const res = await this.page.request.get(`${API_BASE}/api/test/verify/${collection}/${docId}`, {
      headers: { 'X-Test-API-Key': TEST_API_KEY },
    });
    if (!res.ok()) throw new Error(`test/verify/${collection}/${docId} → ${res.status()}: ${await res.text()}`);
    return res.json();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx playwright test --list 2>&1 | head -5`
Expected: No import errors. Tests still list correctly.

- [ ] **Step 3: Commit**

```bash
git add tests/web/helpers/api.ts
git commit -m "feat: AdminApi class — token interception + typed HTTP wrapper"
```

### Task 5: Extend admin.ts fixture with testData

**Files:**
- Modify: `tests/web/fixtures/admin.ts`

- [ ] **Step 1: Rewrite the fixture to include testData**

Replace the entire `tests/web/fixtures/admin.ts` with:

```typescript
import { test as base, BrowserContext, expect } from '@playwright/test';
import { AdminApi, SetupResult } from '../helpers/api';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export interface TestData {
  testRunId: string;
  prefix: string;
  user: {
    uid: string;
    uniqueId: number;
    displayName: string;
  };
  api: AdminApi;
}

export const test = base.extend<{}, { adminContext: BrowserContext; testData: TestData }>({
  adminContext: [async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/admin/');
    const dashboard = page.locator('#dashboard-screen');
    const signInBtn = page.getByRole('button', { name: 'Sign In' });
    await Promise.race([
      dashboard.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
      signInBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {}),
    ]);

    if (!await dashboard.isVisible()) {
      if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD env vars required');
      }
      await page.getByRole('textbox', { name: 'Email' }).fill(ADMIN_EMAIL);
      await page.getByRole('textbox', { name: 'Password' }).fill(ADMIN_PASSWORD);
      await signInBtn.click();
      await expect(dashboard).toBeVisible({ timeout: 30_000 });
    }

    await page.close();
    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  testData: [async ({ adminContext }, use, workerInfo) => {
    const page = await adminContext.newPage();
    // Register token interceptor BEFORE navigating — otherwise the
    // admin panel's initial API calls fire before the listener is attached
    const api = new AdminApi(page);

    // Now navigate — Firebase auto-authenticates from IndexedDB,
    // the interceptor captures the Authorization header from the first API call
    await page.goto('/admin/');
    await page.locator('#dashboard-screen').waitFor({ state: 'visible', timeout: 15_000 });
    await api.waitForToken();
    const prefix = workerInfo.project.name;

    const result: SetupResult = await api.testSetup({
      users: [{
        name: `e2e-${prefix}-user`,
        shyCoins: 1000,
        shyBeans: 500,
        deviceInfo: {
          deviceId: `e2e-${prefix}-device`,
          manufacturer: 'Google',
          model: 'Pixel 6',
          lastIp: '203.0.113.1',
          isp: 'Test ISP',
        },
      }],
    });

    await use({
      testRunId: result.testRunId,
      prefix,
      user: result.users[0],
      api,
    });

    // Cleanup — recursive delete of user docs, subcollections, bans
    await api.testTeardown(result.testRunId);
    await page.close();
  }, { scope: 'worker' }],

  // Override page: open in shared context, clear sessionStorage
  page: async ({ adminContext }, use) => {
    const page = await adminContext.newPage();
    await page.addInitScript(() => sessionStorage.clear());
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 2: Verify it compiles**

Run: `npx playwright test --list 2>&1 | head -5`
Expected: Tests list without errors.

- [ ] **Step 3: Commit**

```bash
git add tests/web/fixtures/admin.ts
git commit -m "feat: extend admin fixture with testData — seed/cleanup lifecycle"
```

### Task 6: Add env vars to CI workflow

**Files:**
- Modify: `.github/workflows/e2e-tests.yml`

- [ ] **Step 1: Add `API_BASE_URL` and `TEST_API_KEY` to the Playwright test step**

Find the `Run Playwright tests` step and add the two new env vars:

```yaml
      - name: Run Playwright tests (${{ matrix.project }})
        env:
          WEB_BASE_URL: https://dev.shytalk.shyden.co.uk
          API_BASE_URL: https://dev-api.shytalk.shyden.co.uk
          ADMIN_EMAIL: ${{ secrets.ADMIN_EMAIL }}
          ADMIN_PASSWORD: ${{ secrets.ADMIN_PASSWORD }}
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
          ALLURE_ENABLED: 'true'
          ALLURE_PROJECT: ${{ matrix.project }}
        run: npx playwright test --project=${{ matrix.project }} --reporter=list,allure-playwright,html
```

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e-tests.yml')); print('valid')"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/e2e-tests.yml
git commit -m "chore: add API_BASE_URL + TEST_API_KEY to Playwright CI env"
```

---

## Chunk 3: Test Rewrites — Profile + Login

> **Implementation note for Tasks 7-11:** These tasks don't include full TypeScript because the implementing agent must read `public/admin/index.html` to discover the actual DOM selectors (IDs, classes, data attributes) at implementation time. The spec defines every test case with exact verification steps and API paths. The agent should:
> 1. Read the spec section for the file being rewritten
> 2. Read the admin panel HTML to find selectors for each UI element referenced
> 3. Read the existing test file to understand import patterns
> 4. Write the test using the `test` and `testData` fixtures from `./fixtures/admin`
> 5. Use `adminLogin(page)` + `navigateToTab(page, 'Users')` + `searchUser(page, String(testData.user.uniqueId))` in `beforeEach`
> 6. Use `testData.api.get(...)` / `testData.api.post(...)` for API verification
> 7. Always restore state at end of mutating tests

### Task 7: Rewrite admin-users-profile.spec.ts (10 tests)

**Files:**
- Rewrite: `tests/web/admin-users-profile.spec.ts`
- Reference: `public/admin/index.html` (DOM selectors), spec section "admin-users-profile.spec.ts"

- [ ] **Step 1: Write the complete rewritten test file**

Replace the entire file. Every test uses `testData` from the fixture and follows act → reload → verify. See spec section "admin-users-profile.spec.ts" for the 10 test cases. The file imports `{ test, expect }` from `'./fixtures/admin'` and uses `testData` for the seeded user.

Key patterns:
- `test('search shows correct seeded user data', async ({ page, testData }) => { ... })`
- Use `adminLogin(page)` + `navigateToTab(page, 'Users')` + `searchUser(page, String(testData.user.uniqueId))` in beforeEach
- After mutations: reload via `page.reload()` → `searchUser` again → verify UI state
- **Note:** Test users have no real Firebase Auth account, so `email` field will be empty. Test 7 (email show/hide toggle) should expect a blank or null email — the toggle mechanism still works, just with no email to display.
- After UI verify: call `testData.api.get('/api/user/' + testData.user.uniqueId)` to verify via admin API
- Restore original values at end of mutating tests

- [ ] **Step 2: Run the tests locally against dev**

Run: `npx playwright test tests/web/admin-users-profile.spec.ts --project=chromium --reporter=list`
Expected: Tests that pass confirm the admin panel works. Tests that FAIL indicate real bugs — investigate the admin panel code, not the test.

- [ ] **Step 3: Fix any real bugs found**

When tests fail, investigate `public/admin/index.html` and the Express API routes. Fix the root cause, not the test.

- [ ] **Step 4: Commit when all 10 tests pass**

```bash
git add tests/web/admin-users-profile.spec.ts
git commit -m "test: rewrite profile tests — full round-trip verification"
```

### Task 8: Minor update to admin-login.spec.ts

**Files:**
- Modify: `tests/web/admin-login.spec.ts`

- [ ] **Step 1: Add round-trip verification to sign-out test**

In the "sign out returns to login screen" test, add a reload after sign-out to confirm the session is truly cleared:

```typescript
  test('sign out returns to login screen', async ({ page }) => {
    test.skip(!ADMIN_EMAIL, 'ADMIN_EMAIL env var not set');
    await loginWith(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.locator('#dashboard-screen')).toBeVisible({ timeout: 30_000 });

    await page.locator('#signout-btn').click();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#dashboard-screen')).not.toBeVisible();

    // Round-trip: reload confirms session is truly cleared
    await page.reload();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#dashboard-screen')).not.toBeVisible();
  });
```

- [ ] **Step 2: Verify locally**

Run: `npx playwright test tests/web/admin-login.spec.ts --project=chromium --reporter=list`
Expected: All 8 tests pass (or skip if env vars not set).

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-login.spec.ts
git commit -m "test: add round-trip to sign-out test"
```

---

## Chunk 4: Test Rewrites — Moderation + Security + Economy

### Task 9: Rewrite admin-users-moderation.spec.ts (10 tests)

**Files:**
- Rewrite: `tests/web/admin-users-moderation.spec.ts`

- [ ] **Step 1: Write the complete rewritten test file**

All 10 tests from the spec. Key considerations:
- Test 1 (warn): verify warning in history + GCS === 85 via API, then revoke to clean up
- Test 2 (revoke): issue then revoke, verify GCS restored
- Test 3 (suspend/unsuspend): verify via both admin and app-facing APIs (`/api/user/` vs `/api/users/`). **After unsuspend, call `POST /api/user/{uniqueId}/reset-gcs` to restore GCS to 100** for the next test.
- Test 4 (GCS reset): precondition GCS > 0 (ensured by test 3 cleanup)
- Tests 7-8 (ban): use seeded device binding, unban all to clean up
- All tests: restore state at end

- [ ] **Step 2: Run locally and fix real bugs**

Run: `npx playwright test tests/web/admin-users-moderation.spec.ts --project=chromium --reporter=list`

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-users-moderation.spec.ts
git commit -m "test: rewrite moderation tests — warn, revoke, suspend, ban round-trips"
```

### Task 10: Rewrite admin-users-security.spec.ts (6 tests)

**Files:**
- Rewrite: `tests/web/admin-users-security.spec.ts`

- [ ] **Step 1: Write the complete rewritten test file**

6 tests from the spec. Key considerations:
- Test 1: verify PIN fields match `GET /api/user/{uniqueId}/auth-status`
- Test 3: OTP uses `GET /metrics/otp` (global), not per-user
- Test 6: raw Firestore verify via `testVerify('users', String(uniqueId))`

- [ ] **Step 2: Run locally and fix real bugs**

Run: `npx playwright test tests/web/admin-users-security.spec.ts --project=chromium --reporter=list`

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-users-security.spec.ts
git commit -m "test: rewrite security tests — PIN, biometric, OTP round-trips"
```

### Task 11: Rewrite admin-users-economy.spec.ts (10 tests)

**Files:**
- Rewrite: `tests/web/admin-users-economy.spec.ts`

- [ ] **Step 1: Write the complete rewritten test file**

10 tests from the spec. Key considerations:
- Tests 2-3: add/deduct coins with API verification + restore
- Test 5-6: backpack gift add/remove
- Test 7: verify transaction history entry after coin adjustment
- Test 10: deduct more than balance → verify clamped to 0
- All economy API paths use plural: `/api/users/{uniqueId}/economy`, `/api/users/{uniqueId}/luck`

- [ ] **Step 2: Run locally and fix real bugs**

Run: `npx playwright test tests/web/admin-users-economy.spec.ts --project=chromium --reporter=list`

- [ ] **Step 3: Commit**

```bash
git add tests/web/admin-users-economy.spec.ts
git commit -m "test: rewrite economy tests — coins, beans, backpack, transactions round-trips"
```

---

## Chunk 5: Integration + CI Verification

### Task 12: Run full Playwright suite locally

- [ ] **Step 1: Run all tests against dev**

Run: `npx playwright test --project=chromium --reporter=list`
Expected: All 71+ tests pass (or fail for real bugs to fix).

- [ ] **Step 2: Fix any remaining issues**

Investigate failures as real bugs. Fix admin panel or API code, not the tests.

- [ ] **Step 3: Push and verify CI**

Push the branch, trigger E2E tests, verify all 5 browser projects pass.

```bash
git push -u origin feature/deep-playwright-tests
gh workflow run "E2E Tests" --ref feature/deep-playwright-tests
```

- [ ] **Step 4: Create PR**

```bash
gh pr create --title "Deep Playwright tests — Phase 1: infrastructure + user management"
```

---

## Summary

| Task | Description | Tests Added |
|------|-------------|-------------|
| 1 | Fix test-helpers.js: uniqueId + field names | Backend tests |
| 2 | Add device binding seeding | Backend tests |
| 3 | Recursive teardown | Backend tests |
| 4 | Create AdminApi class | Infrastructure |
| 5 | Extend admin.ts fixture with testData | Infrastructure |
| 6 | Add env vars to CI | Config |
| 7 | Rewrite profile tests | 10 tests |
| 8 | Update login tests | 1 test improved |
| 9 | Rewrite moderation tests | 10 tests |
| 10 | Rewrite security tests | 6 tests |
| 11 | Rewrite economy tests | 10 tests |
| 12 | Integration + CI verification | Validation |

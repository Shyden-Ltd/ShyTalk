# LiveKit Self-Hosting Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from LiveKit Cloud ($50/month) to self-hosted LiveKit on Oracle Cloud with multi-region routing (Singapore + London). Small code changes in Express API and Android app.

**Architecture:** Express API token endpoint returns both JWT token and nearest LiveKit server URL based on user's geographic region (CF-IPCountry header). Android app reads URL from response instead of BuildConfig. Each region has its own API key/secret pair.

**Tech Stack:** Express.js, livekit-server-sdk, Kotlin/Android (livekit-android SDK), Oracle Cloud ARM VMs, Caddy, coturn

**Spec:** `.project/plans/2026-03-25-livekit-self-hosting-design.md`

---

## File Map

### Modified files
- `express-api/src/routes/livekit.js` — add region routing + return `url` in response
- `express-api/tests/routes/livekit.test.js` — update tests for new response shape + region routing
- `express-api/.env.example` — add per-region LiveKit env vars
- `express-api/.env.local.example` — keep single key for local mode
- `shared/src/commonMain/kotlin/.../data/remote/TokenService.kt` — change return type to include URL
- `app/src/main/java/.../data/remote/LiveKitTokenService.kt` — parse `url` from response
- `app/src/main/java/.../data/remote/LiveKitVoiceService.kt` — use returned URL for connection
- `app/src/test/java/.../data/remote/LiveKitTokenServiceTest.kt` — update tests
- `app/src/androidTest/java/.../fake/FakeTokenService.kt` — update fake return type
- `CLAUDE.md` — add LiveKit self-hosting details
- `README.md` + 19 translations — update Tech Stack, env vars

### New files
- `express-api/src/utils/livekit-region.js` — region routing logic (separate from route file)
- `express-api/tests/utils/livekit-region.test.js` — region routing tests

---

### Task 1: Express API — Region Routing Utility

**Files:**
- Create: `express-api/src/utils/livekit-region.js`
- Create: `express-api/tests/utils/livekit-region.test.js`

- [ ] **Step 1: Write failing tests for region routing**

Create `express-api/tests/utils/livekit-region.test.js`:

```javascript
describe('livekit-region', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LIVEKIT_URL_ASIA = 'wss://livekit.shytalk.shyden.co.uk';
    process.env.LIVEKIT_URL_EU = 'wss://livekit-eu.shytalk.shyden.co.uk';
    process.env.LIVEKIT_KEY_ASIA = 'asia-key';
    process.env.LIVEKIT_SECRET_ASIA = 'asia-secret';
    process.env.LIVEKIT_KEY_EU = 'eu-key';
    process.env.LIVEKIT_SECRET_EU = 'eu-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('routes Southeast Asian country to Asia region', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'SG' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'TH' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'ID' } })).toBe('asia');
    expect(getRegion({ headers: { 'cf-ipcountry': 'MY' } })).toBe('asia');
  });

  test('routes European country to EU region', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'GB' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'DE' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'FR' } })).toBe('eu');
  });

  test('routes Middle East to EU region (closer to London)', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'SA' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'AE' } })).toBe('eu');
    expect(getRegion({ headers: { 'cf-ipcountry': 'TR' } })).toBe('eu');
  });

  test('defaults to Asia when no CF-IPCountry header', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: {} })).toBe('asia');
  });

  test('defaults to Asia for unknown country', () => {
    const { getRegion } = require('../../src/utils/livekit-region');
    expect(getRegion({ headers: { 'cf-ipcountry': 'XX' } })).toBe('asia');
  });

  test('getRegionConfig returns correct URL and keys for Asia', () => {
    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('asia');
    expect(config.url).toBe('wss://livekit.shytalk.shyden.co.uk');
    expect(config.apiKey).toBe('asia-key');
    expect(config.apiSecret).toBe('asia-secret');
  });

  test('getRegionConfig returns correct URL and keys for EU', () => {
    const { getRegionConfig } = require('../../src/utils/livekit-region');
    const config = getRegionConfig('eu');
    expect(config.url).toBe('wss://livekit-eu.shytalk.shyden.co.uk');
    expect(config.apiKey).toBe('eu-key');
    expect(config.apiSecret).toBe('eu-secret');
  });

  test('falls back to single LIVEKIT_API_KEY when per-region keys not set', () => {
    delete process.env.LIVEKIT_KEY_ASIA;
    delete process.env.LIVEKIT_SECRET_ASIA;
    process.env.LIVEKIT_API_KEY = 'fallback-key';
    process.env.LIVEKIT_API_SECRET = 'fallback-secret';

    jest.isolateModules(() => {
      const { getRegionConfig } = require('../../src/utils/livekit-region');
      const config = getRegionConfig('asia');
      expect(config.apiKey).toBe('fallback-key');
      expect(config.apiSecret).toBe('fallback-secret');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/utils/livekit-region.test.js --verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement region routing utility**

Create `express-api/src/utils/livekit-region.js`:

```javascript
/**
 * LiveKit multi-region routing.
 *
 * Routes users to the nearest LiveKit server based on CF-IPCountry header.
 * Returns the server URL and API credentials for that region.
 */

// Countries routed to EU (London) — Europe + Middle East + Africa
const EU_COUNTRIES = new Set([
  // Western Europe
  'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'PT', 'IE', 'LU', 'MC', 'LI',
  // Northern Europe
  'SE', 'NO', 'DK', 'FI', 'IS',
  // Eastern Europe
  'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK',
  'UA', 'BY', 'MD', 'LT', 'LV', 'EE',
  // Russia (closer to London than Singapore)
  'RU',
  // Middle East
  'TR', 'SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'IL', 'PS', 'YE', 'SY', 'IR',
  'EG', 'LY', 'TN', 'DZ', 'MA',
  // Africa
  'ZA', 'NG', 'KE', 'GH', 'ET', 'TZ', 'UG', 'CI', 'SN', 'CM',
  // South Asia (closer to London than Singapore for western SA)
  'PK', 'AF',
]);

function getRegion(req) {
  const country = req.headers['cf-ipcountry'];
  if (country && EU_COUNTRIES.has(country)) {
    return 'eu';
  }
  return 'asia'; // default: Singapore (covers SEA, East Asia, Oceania, Americas)
}

function getRegionConfig(region) {
  if (region === 'eu') {
    return {
      url: process.env.LIVEKIT_URL_EU || 'wss://livekit-eu.shytalk.shyden.co.uk',
      apiKey: process.env.LIVEKIT_KEY_EU || process.env.LIVEKIT_API_KEY,
      apiSecret: process.env.LIVEKIT_SECRET_EU || process.env.LIVEKIT_API_SECRET,
    };
  }
  return {
    url: process.env.LIVEKIT_URL_ASIA || 'wss://livekit.shytalk.shyden.co.uk',
    apiKey: process.env.LIVEKIT_KEY_ASIA || process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_SECRET_ASIA || process.env.LIVEKIT_API_SECRET,
  };
}

module.exports = { getRegion, getRegionConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/utils/livekit-region.test.js --verbose`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add express-api/src/utils/livekit-region.js express-api/tests/utils/livekit-region.test.js
git commit -m "feat: LiveKit multi-region routing utility"
```

---

### Task 2: Express API — Update Token Endpoint

**Files:**
- Modify: `express-api/src/routes/livekit.js`
- Modify: `express-api/tests/routes/livekit.test.js`

- [ ] **Step 1: Update existing tests + add new tests**

In `express-api/tests/routes/livekit.test.js`:

Add mock for livekit-region at the top (after existing mocks):
```javascript
jest.mock('../../src/utils/livekit-region', () => ({
  getRegion: jest.fn().mockReturnValue('asia'),
  getRegionConfig: jest.fn().mockReturnValue({
    url: 'wss://livekit.test.com',
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  }),
}));

const { getRegion, getRegionConfig } = require('../../src/utils/livekit-region');
```

Remove the `beforeEach` env var lines (`process.env.LIVEKIT_API_KEY = ...` and `process.env.LIVEKIT_API_SECRET = ...`) and the `afterEach` block that deletes them — the region config mock handles credentials now.

Update existing test assertions:
- `res.body.token` should still be `'mock-jwt-token'`
- Add: `expect(res.body.url).toBe('wss://livekit.test.com')`
- Update `AccessToken` constructor assertion to use `'test-key'`, `'test-secret'` (from getRegionConfig)

Add new tests:
```javascript
test('returns url field from region config', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/livekit/token')
    .send({ roomName: 'test-room' })
    .expect(200);

  expect(res.body.url).toBe('wss://livekit.test.com');
  expect(res.body.token).toBe('mock-jwt-token');
});

test('uses EU region config when getRegion returns eu', async () => {
  getRegion.mockReturnValue('eu');
  getRegionConfig.mockReturnValue({
    url: 'wss://livekit-eu.test.com',
    apiKey: 'eu-key',
    apiSecret: 'eu-secret',
  });

  const app = createApp();
  const res = await request(app)
    .post('/api/livekit/token')
    .send({ roomName: 'test-room' })
    .expect(200);

  expect(res.body.url).toBe('wss://livekit-eu.test.com');
  expect(AccessToken).toHaveBeenCalledWith('eu-key', 'eu-secret', expect.anything());
});

test('omits url field in local mode', async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'local';

  const app = createApp();
  const res = await request(app)
    .post('/api/livekit/token')
    .send({ roomName: 'test-room' })
    .expect(200);

  expect(res.body.token).toBe('mock-jwt-token');
  expect(res.body.url).toBeUndefined();

  process.env.NODE_ENV = originalEnv;
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd express-api && npx jest tests/routes/livekit.test.js --verbose`
Expected: FAIL — response doesn't have `url` field

- [ ] **Step 3: Update livekit.js route**

Replace `express-api/src/routes/livekit.js`:

```javascript
/**
 * LiveKit token generation with multi-region routing.
 *
 * POST /api/livekit/token  -> Generate a LiveKit access token + nearest server URL
 */

const router = require('express').Router();
const { AccessToken } = require('livekit-server-sdk');
const log = require('../utils/log');
const { getRegion, getRegionConfig } = require('../utils/livekit-region');

router.post('/livekit/token', async (req, res) => {
  try {
    const { roomName } = req.body || {};
    const identity = String(req.auth.uniqueId);

    if (!roomName || typeof roomName !== 'string') {
      log.warn('livekit', 'Token request missing roomName', { userId: identity });
      return res.status(400).json({ error: 'roomName is required' });
    }

    const region = getRegion(req);
    const config = getRegionConfig(region);

    log.info('livekit', 'Generating token', { userId: identity, roomName, region });

    const at = new AccessToken(config.apiKey, config.apiSecret, {
      identity,
      ttl: '24h',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();

    // In local mode, omit URL (app uses BuildConfig fallback)
    const response = { token };
    if (process.env.NODE_ENV !== 'local') {
      response.url = config.url;
    }

    return res.json(response);
  } catch (err) {
    log.error('livekit', 'Failed to generate token', {
      userId: req.auth?.uniqueId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd express-api && npx jest tests/routes/livekit.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `cd express-api && npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add express-api/src/routes/livekit.js express-api/tests/routes/livekit.test.js
git commit -m "feat: token endpoint returns nearest LiveKit server URL by region"
```

---

### Task 3: Android — Update TokenService Interface

**Files:**
- Modify: `shared/src/commonMain/kotlin/.../data/remote/TokenService.kt`
- Modify: `app/src/main/java/.../data/remote/LiveKitTokenService.kt`
- Modify: `app/src/test/java/.../data/remote/LiveKitTokenServiceTest.kt`
- Modify: `app/src/androidTest/java/.../fake/FakeTokenService.kt`

- [ ] **Step 1: Create a TokenResponse data class and update the interface**

In `shared/src/commonMain/kotlin/com/shyden/shytalk/data/remote/TokenService.kt`:

```kotlin
package com.shyden.shytalk.data.remote

data class TokenResponse(
    val token: String,
    val url: String? = null,
)

interface TokenService {
    suspend fun fetchToken(
        roomName: String,
        identity: String,
    ): TokenResponse
}
```

- [ ] **Step 2: Update FakeTokenService to match new return type**

In `app/src/androidTest/java/com/shyden/shytalk/fake/FakeTokenService.kt`:

```kotlin
class FakeTokenService : TokenService {
    override suspend fun fetchToken(
        roomName: String,
        identity: String,
    ): TokenResponse = TokenResponse(token = "fake-token", url = null)
}
```

- [ ] **Step 3: Update LiveKitTokenService to parse url from response**

In `app/src/main/java/com/shyden/shytalk/data/remote/LiveKitTokenService.kt`:

```kotlin
class LiveKitTokenService(
    private val api: WorkerApiClient,
) : TokenService {
    override suspend fun fetchToken(
        roomName: String,
        identity: String,
    ): TokenResponse {
        val response =
            api.post(
                "/api/livekit/token",
                JSONObject().apply {
                    put("roomName", roomName)
                    put("identity", identity)
                },
            )
        val token = response
            .optString("token")
            .takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("Invalid token response from server")
        val url = response.optString("url").takeIf { it.isNotEmpty() }
        return TokenResponse(token = token, url = url)
    }
}
```

- [ ] **Step 4: Rewrite LiveKitTokenServiceTest**

Replace `app/src/test/java/com/shyden/shytalk/data/remote/LiveKitTokenServiceTest.kt`:

```kotlin
package com.shyden.shytalk.data.remote

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class LiveKitTokenServiceTest {
    private lateinit var api: WorkerApiClient
    private lateinit var service: LiveKitTokenService

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        service = LiveKitTokenService(api)
    }

    @Test
    fun `fetchToken returns token from successful response`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("token", "test-jwt-token")
                }

            val result = service.fetchToken("room-1", "user-1")

            assertEquals("test-jwt-token", result.token)
            assertNull(result.url)
            coVerify { api.post("/api/livekit/token", any()) }
        }

    @Test
    fun `fetchToken returns url when present in response`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("token", "test-jwt-token")
                    put("url", "wss://livekit.test.com")
                }

            val result = service.fetchToken("room-1", "user-1")

            assertEquals("test-jwt-token", result.token)
            assertEquals("wss://livekit.test.com", result.url)
        }

    @Test(expected = IllegalStateException::class)
    fun `fetchToken throws when response missing token field`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } returns
                JSONObject().apply {
                    put("error", "no token")
                }

            service.fetchToken("room-1", "user-1")
        }

    @Test(expected = RuntimeException::class)
    fun `fetchToken propagates exception from API`() =
        runTest {
            coEvery { api.post("/api/livekit/token", any()) } throws RuntimeException("Network error")

            service.fetchToken("room-1", "user-1")
        }
}
```

- [ ] **Step 5: Update LiveKitVoiceService to use returned URL**

In `app/src/main/java/com/shyden/shytalk/data/remote/LiveKitVoiceService.kt`, make these changes:

**5a. Add new cached URL fields** (after line 43 `cachedToken` and line 47 `prewarmedToken`):

```kotlin
private var cachedToken: String? = null
private var cachedServerUrl: String? = null   // NEW — cached URL from token response
// ...
private var prewarmedToken: String? = null
private var prewarmedRoomName: String? = null
private var prewarmedUrl: String? = null       // NEW — pre-warmed URL
```

**5b. Update joinRoom() — the main connect path** (~line 204-238):

Replace the token fetch block. Where it currently uses `prewarmedToken` (String), update to also capture URL:

```kotlin
// When using pre-warmed token:
val token: String
val serverUrl: String
if (prewarmedRoomName == roomName && prewarmedToken != null) {
    token = prewarmedToken!!
    serverUrl = prewarmedUrl ?: BuildConfig.LIVEKIT_SERVER_URL
    prewarmedToken = null
    prewarmedRoomName = null
    prewarmedUrl = null
} else {
    val response = try {
        tokenService.fetchToken(roomName, userId)
    } catch (e: Exception) {
        // ... existing error handling ...
        return@withLock
    }
    token = response.token
    serverUrl = response.url ?: BuildConfig.LIVEKIT_SERVER_URL
}
cachedToken = token
cachedServerUrl = serverUrl
```

Then replace `val serverUrl = BuildConfig.LIVEKIT_SERVER_URL` at line 230 — it's now set above.

**5c. Update switchAudioType() — the audio mode switch reconnect path** (~line 324-350):

Where it fetches a token when cached is null:

```kotlin
val token = cachedToken ?: try {
    Log.w(TAG, "No cached token for audio switch, fetching new one")
    val response = tokenService.fetchToken(roomName, userId)
    cachedServerUrl = response.url  // update cached URL too
    response.token
} catch (e: Exception) {
    // ... existing error handling ...
    return@withLock
}

// Then at reconnect (~line 349):
val serverUrl = cachedServerUrl ?: BuildConfig.LIVEKIT_SERVER_URL
room.connect(serverUrl, token)
```

**5d. Update prewarmToken()** (~line 376):

```kotlin
val response = tokenService.fetchToken(roomName, userId)
prewarmedToken = response.token
prewarmedUrl = response.url
prewarmedRoomName = roomName
```

**CRITICAL:** All 3 call sites must be updated. The `cachedServerUrl` field ensures `switchAudioType()` reconnects to the same region server, not the BuildConfig default.

- [ ] **Step 6: Build and run unit tests**

Run: `./gradlew test`
Expected: BUILD SUCCESSFUL

- [ ] **Step 7: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/data/remote/TokenService.kt \
       app/src/main/java/com/shyden/shytalk/data/remote/LiveKitTokenService.kt \
       app/src/main/java/com/shyden/shytalk/data/remote/LiveKitVoiceService.kt \
       app/src/test/java/com/shyden/shytalk/data/remote/LiveKitTokenServiceTest.kt \
       app/src/androidTest/java/com/shyden/shytalk/fake/FakeTokenService.kt
git commit -m "feat: Android app uses server-returned LiveKit URL with BuildConfig fallback"
```

---

### Task 4: Express API — Update .env Examples

**Files:**
- Modify: `express-api/.env.example`
- Modify: `express-api/.env.local.example`

- [ ] **Step 1: Update .env.example with per-region vars**

Add to `express-api/.env.example`:

```env
# LiveKit (self-hosted, per-region)
LIVEKIT_KEY_ASIA=
LIVEKIT_SECRET_ASIA=
LIVEKIT_URL_ASIA=wss://livekit.shytalk.shyden.co.uk
LIVEKIT_KEY_EU=
LIVEKIT_SECRET_EU=
LIVEKIT_URL_EU=wss://livekit-eu.shytalk.shyden.co.uk
```

Remove or comment out the old single `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` (keep as fallback comment).

- [ ] **Step 2: Verify .env.local.example still works**

The local example should keep the single-key pattern (local mode uses `LIVEKIT_API_KEY` fallback):
```env
# LIVEKIT_API_KEY=devkey
# LIVEKIT_API_SECRET=devsecret
```

No changes needed to the local example.

- [ ] **Step 3: Commit**

```bash
git add express-api/.env.example express-api/.env.local.example
git commit -m "docs: add per-region LiveKit env vars to .env.example"
```

---

### Task 5: Documentation Updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` + 19 translations

- [ ] **Step 1: Update CLAUDE.md**

Add to the Environments section:
- LiveKit servers: `livekit.shytalk.shyden.co.uk` (Singapore), `livekit-eu.shytalk.shyden.co.uk` (London)
- Note: self-hosted on Oracle Cloud, no LiveKit Cloud dependency

- [ ] **Step 2: Update README.md**

- Tech Stack table: change "LiveKit" row to note "Self-hosted on Oracle Cloud"
- Environment Variables table: add `LIVEKIT_KEY_ASIA`, `LIVEKIT_URL_ASIA`, etc.

- [ ] **Step 3: Update 19 translated READMEs**

Same changes as English README.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md README.*.md
git commit -m "docs: update docs for self-hosted multi-region LiveKit"
```

---

### Task 6: Infrastructure Setup (Manual — SSH)

This task is performed manually via SSH, not through code changes. Checklist format.

#### Phase 1: London (Dev + EU Prod)

- [ ] SSH to dev VM: `ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13`
- [ ] Install LiveKit server binary (ARM64):
  ```bash
  curl -sSL https://get.livekit.io | bash
  ```
- [ ] Install coturn: `sudo apt install coturn`
- [ ] Generate API keys: `livekit-server generate-keys`
- [ ] Create `/etc/livekit.yaml` with London config (EU keys, `livekit-eu.shytalk.shyden.co.uk` domain)
- [ ] Create systemd service for LiveKit (`/etc/systemd/system/livekit-server.service`)
- [ ] Configure coturn (`/etc/turnserver.conf`) or use LiveKit's built-in TURN
- [ ] Add Caddy rule: `livekit-eu.shytalk.shyden.co.uk { reverse_proxy localhost:7880 }`
- [ ] Reload Caddy: `sudo systemctl reload caddy`
- [ ] Add DNS record in Cloudflare: `livekit-eu.shytalk.shyden.co.uk` A `145.241.224.13` (DNS-only)
- [ ] Open Oracle Cloud security list ports: 443/TCP, 7881/TCP, 3478/UDP, 5349/TCP, 50000-50100/UDP
- [ ] Start LiveKit: `sudo systemctl enable --now livekit-server`
- [ ] Test: `curl -s https://livekit-eu.shytalk.shyden.co.uk` should return a response
- [ ] Update dev Express API `.env` with EU keys + both region URLs
- [ ] Restart Express API: `pm2 restart shytalk-api`
- [ ] Update GitHub secret `LIVEKIT_URL` (dev environment) to `wss://livekit-eu.shytalk.shyden.co.uk`
- [ ] Deploy dev app, test voice rooms

#### Phase 2: Singapore (Prod)

- [ ] Create new Oracle Cloud ARM VM in Singapore (new account if needed)
- [ ] Install Caddy, LiveKit, coturn (same steps as Phase 1)
- [ ] Generate separate API keys for Singapore
- [ ] Create `/etc/livekit.yaml` with Singapore config
- [ ] Add DNS record: `livekit.shytalk.shyden.co.uk` A `<new VM IP>` (DNS-only)
- [ ] Open firewall ports
- [ ] Start services
- [ ] Update prod Express API `.env` with Asia keys + both region URLs
- [ ] Restart: `pm2 restart shytalk-api`
- [ ] Update GitHub secret `LIVEKIT_URL` (prod environment) to `wss://livekit.shytalk.shyden.co.uk`
- [ ] Deploy prod app
- [ ] Test voice rooms from multiple regions
- [ ] Test TURN relay (from behind a corporate firewall if possible)

#### Phase 3: Cancel LiveKit Cloud (after 2 weeks stability)

- [ ] Confirm 2 weeks of stable operation on self-hosted
- [ ] Confirm majority of active users on builds with dynamic URL
- [ ] Cancel LiveKit Cloud subscription
- [ ] Save $50/month

---

## Execution Order

Tasks 1-2 are Express API changes (can be tested locally against Docker LiveKit).
Task 3 is Android changes (can be tested locally).
Task 4-5 are documentation.
Task 6 is infrastructure (manual SSH).

Dependencies:
- Task 2 depends on Task 1 (route imports region utility)
- Task 3 is independent (Android changes work with or without server changes — fallback to BuildConfig)
- Tasks 4-5 can run anytime
- Task 6 depends on Tasks 1-3 being deployed (need the code changes live before switching DNS)

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 (sequential, each builds on the last)

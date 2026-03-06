# Internationalization & Message Translation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to see the entire app UI in their chosen language and translate chat messages on demand (tap-to-translate for free users, auto-translate for SuperShy users).

**Architecture:** User language stored in Firestore + local prefs. UI strings via Compose Multiplatform `composeResources`. Message translation via Express API proxying to LibreTranslate on a dedicated Oracle ARM VM. Translations cached on message documents in Firestore. Quota tracked per user (50/day free, unlimited SuperShy).

**Tech Stack:** Compose Multiplatform resources, LibreTranslate (self-hosted), Express.js, Firebase Admin SDK, Firestore, KMP expect/actual for local preferences.

---

## Phase 1: Language Preference Foundation

### Task 1: Add language field to User model

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt`
- Modify: `app/src/test/java/com/shyden/shytalk/core/model/UserFromMapTest.kt`
- Modify: `app/src/test/java/com/shyden/shytalk/testutil/TestData.kt`

**Step 1: Write failing tests in UserFromMapTest.kt**

Add after the `selfDestructAlertEnabled` tests (~line 369):

```kotlin
// ===== Language preference =====

@Test
fun `fromMap parses language`() {
    val map = mapOf<String, Any?>("language" to "es")
    val user = User.fromMap(map, "uid")
    assertEquals("es", user.language)
}

@Test
fun `fromMap defaults language to en when missing`() {
    val user = User.fromMap(emptyMap(), "uid")
    assertEquals("en", user.language)
}

@Test
fun `toMap includes language`() {
    val user = User(language = "ja")
    val map = user.toMap()
    assertEquals("ja", map["language"])
}
```

**Step 2: Run tests to verify they fail**

Run: `./gradlew test --tests "*.UserFromMapTest"`
Expected: FAIL — `language` property doesn't exist on User

**Step 3: Add language field to User data class**

In `User.kt`, add after `hasClaimedSuperShyTrial` (~line 68):
```kotlin
val language: String = "en",
```

Add to `toMap()` before the closing paren (~line 138):
```kotlin
"language" to language,
```

Add to `fromMap()` before the closing paren (~line 211):
```kotlin
language = map["language"] as? String ?: "en",
```

**Step 4: Add language param to TestData.createTestUser**

In `TestData.kt`, add parameter:
```kotlin
fun createTestUser(
    ...existing params...,
    language: String = "en"
) = User(
    ...existing assignments...,
    language = language
)
```

**Step 5: Run tests to verify they pass**

Run: `./gradlew test --tests "*.UserFromMapTest"`
Expected: PASS

**Step 6: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/core/model/User.kt \
       app/src/test/java/com/shyden/shytalk/core/model/UserFromMapTest.kt \
       app/src/test/java/com/shyden/shytalk/testutil/TestData.kt
git commit -m "feat: add language field to User model"
```

---

### Task 2: Add language to user creation (Express API + Worker API)

**Files:**
- Modify: `express-api/src/routes/users.js`
- Modify: `worker-api/src/routes/users.js`

**Step 1: Add language to Express API user creation**

In `express-api/src/routes/users.js`, find the `POST /api/users` handler's `db.doc().set()` call. Add after `aliases: {}`:
```javascript
language:        body.language || 'en',
```

**Step 2: Add language to Worker API user creation**

In `worker-api/src/routes/users.js`, find the user creation `setDoc()` call (~line 119). Add after `aliases: {}`:
```javascript
language:        body.language || 'en',
```

**Step 3: Commit**

```bash
git add express-api/src/routes/users.js worker-api/src/routes/users.js
git commit -m "feat: include language field in user creation"
```

---

### Task 3: Create local language preference (KMP expect/actual)

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.kt`
- Create: `shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.android.kt`
- Create: `shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.ios.kt`

**Step 1: Create expect declaration**

`shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.kt`:
```kotlin
package com.shyden.shytalk.core.util

expect object LanguagePreference {
    fun get(): String
    fun set(languageCode: String)
}
```

**Step 2: Create Android actual**

`shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.android.kt`:
```kotlin
package com.shyden.shytalk.core.util

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences

@SuppressLint("StaticFieldLeak")
actual object LanguagePreference {
    private const val PREFS_NAME = "shytalk_prefs"
    private const val KEY_LANGUAGE = "preferred_language"
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    actual fun get(): String =
        prefs?.getString(KEY_LANGUAGE, null)
            ?: java.util.Locale.getDefault().language.take(2)

    actual fun set(languageCode: String) {
        prefs?.edit()?.putString(KEY_LANGUAGE, languageCode)?.apply()
    }
}
```

**Step 3: Create iOS actual**

`shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.ios.kt`:
```kotlin
package com.shyden.shytalk.core.util

import platform.Foundation.NSUserDefaults
import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.languageCode

actual object LanguagePreference {
    private const val KEY_LANGUAGE = "preferred_language"

    actual fun get(): String =
        NSUserDefaults.standardUserDefaults.stringForKey(KEY_LANGUAGE)
            ?: NSLocale.currentLocale.languageCode.take(2)

    actual fun set(languageCode: String) {
        NSUserDefaults.standardUserDefaults.setObject(languageCode, KEY_LANGUAGE)
    }
}
```

**Step 4: Initialize in ShyTalkApp.kt**

In `app/src/main/java/com/shyden/shytalk/ShyTalkApp.kt`, add to `onCreate()`:
```kotlin
LanguagePreference.init(this)
```

**Step 5: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.kt \
       shared/src/androidMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.android.kt \
       shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/LanguagePreference.ios.kt \
       app/src/main/java/com/shyden/shytalk/ShyTalkApp.kt
git commit -m "feat: add KMP language preference with local storage"
```

---

### Task 4: Add language picker to App Settings

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/AppSettingsViewModel.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/feature/settings/AppSettingsScreen.kt`
- Modify: `app/src/test/java/com/shyden/shytalk/feature/settings/AppSettingsViewModelTest.kt`

**Step 1: Add language to AppSettingsUiState**

In `AppSettingsViewModel.kt`, add to `AppSettingsUiState`:
```kotlin
val language: String = LanguagePreference.get(),
```

**Step 2: Add setLanguage method to AppSettingsViewModel**

```kotlin
fun setLanguage(languageCode: String) {
    val userId = authRepository.currentUserId ?: return
    _uiState.update { it.copy(language = languageCode) }
    LanguagePreference.set(languageCode)
    viewModelScope.launch {
        userRepository.updateProfile(userId, mapOf("language" to languageCode))
    }
}
```

Also update the `init` block to read language from the loaded user:
```kotlin
// Inside the user load success block:
_uiState.update { it.copy(language = user.language) }
LanguagePreference.set(user.language)
```

**Step 3: Add language picker section to AppSettingsScreen**

Add a new settings section after the DND section. Use a dialog that shows available languages with their native names:
```kotlin
// Language item
SettingsItem(
    title = "Language",
    subtitle = currentLanguageName,
    onClick = { showLanguageDialog = true }
)
```

The language dialog shows a list of language options (English, Español, العربية, 日本語, 한국어, 中文, Français, Deutsch, Português, Русский, हिन्दी, Türkçe, Italiano, etc.) with ISO 639-1 codes mapped to native names.

**Step 4: Write test for setLanguage**

```kotlin
@Test
fun `setLanguage updates state and calls updateProfile`() = runTest {
    val vm = createViewModel()
    advanceUntilIdle()

    vm.setLanguage("es")
    advanceUntilIdle()

    assertEquals("es", vm.uiState.value.language)
    coVerify { userRepository.updateProfile(any(), match { it["language"] == "es" }) }
}
```

**Step 5: Run tests**

Run: `./gradlew test --tests "*.AppSettingsViewModelTest"`
Expected: PASS

**Step 6: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/AppSettingsViewModel.kt \
       app/src/main/java/com/shyden/shytalk/feature/settings/AppSettingsScreen.kt \
       app/src/test/java/com/shyden/shytalk/feature/settings/AppSettingsViewModelTest.kt
git commit -m "feat: add language picker to app settings"
```

---

## Phase 2: Compose Resources & String Extraction

### Task 5: Set up Compose Multiplatform resources

**Files:**
- Modify: `shared/build.gradle.kts`
- Create: `shared/src/commonMain/composeResources/values/strings.xml`

**Step 1: Enable compose resources in shared/build.gradle.kts**

Add to the `compose.resources` block (create if needed):
```kotlin
compose.resources {
    publicResClass = true
    packageOfResClass = "com.shyden.shytalk.resources"
    generateResClass = always
}
```

**Step 2: Create the English strings.xml**

Create `shared/src/commonMain/composeResources/values/strings.xml` with the first batch of commonly used strings. Start with a small set to verify the setup works:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Common actions -->
    <string name="cancel">Cancel</string>
    <string name="confirm">Confirm</string>
    <string name="ok">OK</string>
    <string name="save">Save</string>
    <string name="delete">Delete</string>
    <string name="edit">Edit</string>
    <string name="close">Close</string>
    <string name="done">Done</string>
    <string name="retry">Retry</string>
    <string name="loading">Loading…</string>
    <string name="error_generic">Something went wrong</string>

    <!-- Message bubbles -->
    <string name="edited">edited</string>
    <string name="tap_to_join">Tap to join</string>
    <string name="message_recalled_by_you">You recalled this message</string>
    <string name="message_recalled">This message was recalled</string>
    <string name="message_hidden_by_mod">This message was hidden by a moderator</string>
    <string name="invite_to_mic">Invite to mic</string>

    <!-- Context menu -->
    <string name="react">React</string>
    <string name="reply">Reply</string>
    <string name="copy">Copy</string>
    <string name="recall">Recall</string>
    <string name="add_to_stickers">Add to Stickers</string>
    <string name="hide_message">Hide Message</string>
    <string name="report_message">Report Message</string>

    <!-- Translation -->
    <string name="translate">Translate</string>
    <string name="translated_from">Translated from %1$s</string>
    <string name="show_original">Show original</string>
    <string name="translation_limit_reached">Daily limit reached. Upgrade to SuperShy for unlimited translations.</string>
    <string name="auto_translate">Auto-translate</string>
    <string name="translations_remaining">%1$d translations remaining today</string>
</resources>
```

**Step 3: Build to verify resources generate**

Run: `./gradlew :shared:generateComposeResClass`
Expected: Generates `Res.string.*` accessors

**Step 4: Commit**

```bash
git add shared/build.gradle.kts \
       shared/src/commonMain/composeResources/values/strings.xml
git commit -m "feat: set up Compose Multiplatform string resources"
```

---

### Task 6: Apply locale override for string resolution

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/core/ui/LocaleProvider.kt`
- Modify: App root composable (where the theme is applied)

The Compose resources system uses the device locale by default. Since users can override their language in settings, we need to wrap the app content in a locale override.

**Step 1: Create locale composition local**

```kotlin
package com.shyden.shytalk.core.ui

import androidx.compose.runtime.compositionLocalOf

val LocalAppLanguage = compositionLocalOf { "en" }
```

**Step 2: On Android, override the Configuration locale**

In the root composable (or `MainActivity.kt`), wrap the content with the user's chosen locale applied to the Android `Configuration` so that `stringResource()` picks up the correct locale:

```kotlin
val language = LanguagePreference.get()
val locale = java.util.Locale(language)
val configuration = LocalConfiguration.current
val updatedConfiguration = Configuration(configuration).apply {
    setLocale(locale)
}
val context = LocalContext.current.createConfigurationContext(updatedConfiguration)
CompositionLocalProvider(LocalContext provides context) {
    // App content
}
```

**Step 3: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/core/ui/LocaleProvider.kt \
       app/src/main/java/com/shyden/shytalk/MainActivity.kt
git commit -m "feat: apply user language override for string resource resolution"
```

---

### Task 7: Replace hardcoded strings in MessageBubble and PrivateMessageBubble

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/MessageBubble.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateMessageBubble.kt`

**Step 1: Update MessageBubble.kt**

Replace hardcoded strings with `stringResource(Res.string.xxx)`:
- Line 162: `"Invite to mic"` → `stringResource(Res.string.invite_to_mic)`
- Line 235: `"edited"` → `stringResource(Res.string.edited)`

Add import: `import com.shyden.shytalk.resources.Res`
Add import: `import org.jetbrains.compose.resources.stringResource`

**Step 2: Update PrivateMessageBubble.kt**

Replace:
- Line 123: `"This message was hidden by a moderator"` → `stringResource(Res.string.message_hidden_by_mod)`
- Line 222: `"You recalled this message"` → `stringResource(Res.string.message_recalled_by_you)`
- Line 222: `"This message was recalled"` → `stringResource(Res.string.message_recalled)`
- Line 343: `"Tap to join"` → `stringResource(Res.string.tap_to_join)`
- Line 461: `"React"` → `stringResource(Res.string.react)`
- Line 468: `"Reply"` → `stringResource(Res.string.reply)`
- Line 475: `"Copy"` → `stringResource(Res.string.copy)`
- Line 484: `"Edit"` → `stringResource(Res.string.edit)`
- Line 493: `"Recall"` → `stringResource(Res.string.recall)`
- Line 502: `"Add to Stickers"` → `stringResource(Res.string.add_to_stickers)`
- Line 511: `"Hide Message"` → `stringResource(Res.string.hide_message)`
- Line 520: `"Report Message"` → `stringResource(Res.string.report_message)`

**Step 3: Build to verify compilation**

Run: `./gradlew :shared:compileKotlinAndroid`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/MessageBubble.kt \
       shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateMessageBubble.kt
git commit -m "feat: extract message bubble strings to compose resources"
```

---

### Task 8: Extract remaining hardcoded strings (batch)

This is mechanical work across ~50 files. The process for each file is:
1. Find hardcoded `Text("...")` calls
2. Add corresponding `<string name="key">value</string>` to `strings.xml`
3. Replace with `stringResource(Res.string.key)`

**Priority screens (do these first):**
- `feature/home/CreateRoomDialog.kt`
- `feature/home/HomeScreen.kt`
- `feature/home/RoomListItem.kt`
- `feature/auth/` screens
- `feature/profile/` screens
- `feature/shop/WalletScreen.kt`
- `feature/shop/SuperShyBottomSheet.kt`
- `feature/settings/AppSettingsScreen.kt` (largest — ~56KB)

**Lower priority (do after core features work):**
- `feature/legal/` screens
- Admin-only UI elements
- Error messages in ViewModels (these can stay as non-localized logs)

**Each file follows the same pattern — no code examples needed. Just search for `Text("` and replace.**

**Commit after each screen group:**
```bash
git commit -m "feat: extract strings from [screen-name] to compose resources"
```

---

### Task 9: Generate translations for all languages

**Files:**
- Create: Translation generation script
- Create: `shared/src/commonMain/composeResources/values-{lang}/strings.xml` for each language

**Step 1: Write a batch translation script**

Create `scripts/translate-strings.py` that reads `values/strings.xml`, sends each string to LibreTranslate, and writes locale-variant files.

**Step 2: Run the script for all target languages**

Generate translations for: es, ar, ja, ko, zh, fr, de, pt, ru, hi, tr, it, th, vi, id, pl, nl, sv, uk, bn (and more as LibreTranslate supports).

**Step 3: Review generated translations for obvious errors**

Quick manual scan of key strings in popular languages.

**Step 4: Commit all locale files**

```bash
git add shared/src/commonMain/composeResources/
git commit -m "feat: add machine-translated string resources for all languages"
```

---

## Phase 3: Translation API & Infrastructure

### Task 10: Add translate endpoint to Express API

**Files:**
- Create: `express-api/src/routes/translate.js`
- Modify: `express-api/src/index.js`

**Step 1: Create translate route**

`express-api/src/routes/translate.js`:
```javascript
const express = require('express');
const { db } = require('../utils/firebase');
const { FieldValue } = require('firebase-admin/firestore');

const router = express.Router();

const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_URL || 'http://localhost:5000';
const FREE_DAILY_LIMIT = 50;

// POST /api/translate
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLang, messagePath } = req.body;
    const uid = req.auth.uid;

    if (!text || !targetLang) {
      return res.status(400).json({ error: 'text and targetLang required' });
    }

    // Check cache on message doc if messagePath provided
    if (messagePath) {
      const msgSnap = await db.doc(messagePath).get();
      const cached = msgSnap.data()?.translations?.[targetLang];
      if (cached) {
        return res.json({ translatedText: cached, cached: true });
      }
    }

    // Check quota for non-SuperShy users
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const isSuperShy = userData.isSuperShy === true;
    const today = new Date().toISOString().slice(0, 10);

    if (!isSuperShy) {
      const translationDate = userData.translationDate || '';
      const translationsToday = translationDate === today ? (userData.translationsToday || 0) : 0;
      if (translationsToday >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          error: 'Daily translation limit reached',
          limit: FREE_DAILY_LIMIT,
          upgradePrompt: true,
        });
      }
    }

    // Call LibreTranslate
    const ltResp = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: 'auto',
        target: targetLang,
      }),
    });

    if (!ltResp.ok) {
      const err = await ltResp.text();
      console.error('LibreTranslate error:', err);
      return res.status(502).json({ error: 'Translation service unavailable' });
    }

    const ltData = await ltResp.json();
    const translatedText = ltData.translatedText;
    const detectedSourceLang = ltData.detectedLanguage?.language || 'unknown';

    // Cache translation on message doc
    if (messagePath) {
      db.doc(messagePath).update({
        [`translations.${targetLang}`]: translatedText,
      }).catch(err => console.error('Cache translation error:', err));
    }

    // Increment daily counter (non-SuperShy only)
    if (!isSuperShy) {
      db.doc(`users/${uid}`).update({
        translationsToday: userData.translationDate === today
          ? FieldValue.increment(1)
          : 1,
        translationDate: today,
      }).catch(err => console.error('Quota update error:', err));
    }

    res.json({ translatedText, detectedSourceLang, cached: false });
  } catch (err) {
    console.error('Translate error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// GET /api/translate/quota
router.get('/translate/quota', async (req, res) => {
  try {
    const uid = req.auth.uid;
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.data() || {};
    const isSuperShy = userData.isSuperShy === true;
    const today = new Date().toISOString().slice(0, 10);
    const translationsToday = userData.translationDate === today
      ? (userData.translationsToday || 0) : 0;

    res.json({
      used: translationsToday,
      limit: isSuperShy ? -1 : FREE_DAILY_LIMIT,
      unlimited: isSuperShy,
    });
  } catch (err) {
    console.error('Quota check error:', err);
    res.status(500).json({ error: 'Failed to check quota' });
  }
});

module.exports = router;
```

**Step 2: Mount route in Express index.js**

In `express-api/src/index.js`, add after the storage route:
```javascript
app.use('/api', require('./routes/translate'));
```

**Step 3: Add LIBRETRANSLATE_URL to .env on the server**

Add to the VM's `.env` file:
```
LIBRETRANSLATE_URL=http://<arm-vm-ip>:5000
```

**Step 4: Commit**

```bash
git add express-api/src/routes/translate.js express-api/src/index.js
git commit -m "feat: add /api/translate endpoint with quota tracking"
```

---

### Task 11: Create TranslationRepository (KMP)

**Files:**
- Create: `shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/TranslationRepository.kt`
- Create: `app/src/main/java/com/shyden/shytalk/data/repository/TranslationRepositoryImpl.kt`
- Create: `app/src/test/java/com/shyden/shytalk/data/repository/TranslationRepositoryImplTest.kt`
- Modify: `app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt`

**Step 1: Create interface**

`TranslationRepository.kt`:
```kotlin
package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

data class TranslationResult(
    val translatedText: String,
    val detectedSourceLang: String,
    val cached: Boolean
)

data class TranslationQuota(
    val used: Int,
    val limit: Int,
    val unlimited: Boolean
)

interface TranslationRepository {
    suspend fun translate(text: String, targetLang: String, messagePath: String?): Resource<TranslationResult>
    suspend fun getQuota(): Resource<TranslationQuota>
}
```

**Step 2: Create implementation**

`TranslationRepositoryImpl.kt`:
```kotlin
package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class TranslationRepositoryImpl(
    private val api: WorkerApiClient
) : TranslationRepository {

    override suspend fun translate(
        text: String, targetLang: String, messagePath: String?
    ): Resource<TranslationResult> = try {
        val body = JSONObject().apply {
            put("text", text)
            put("targetLang", targetLang)
            if (messagePath != null) put("messagePath", messagePath)
        }
        val resp = api.post("/api/translate", body)
        Resource.Success(TranslationResult(
            translatedText = resp.getString("translatedText"),
            detectedSourceLang = resp.optString("detectedSourceLang", "unknown"),
            cached = resp.optBoolean("cached", false)
        ))
    } catch (e: Exception) {
        Resource.Error(e.message ?: "Translation failed")
    }

    override suspend fun getQuota(): Resource<TranslationQuota> = try {
        val resp = api.get("/api/translate/quota")
        Resource.Success(TranslationQuota(
            used = resp.getInt("used"),
            limit = resp.getInt("limit"),
            unlimited = resp.getBoolean("unlimited")
        ))
    } catch (e: Exception) {
        Resource.Error(e.message ?: "Failed to check quota")
    }
}
```

**Step 3: Write tests**

```kotlin
class TranslationRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var repo: TranslationRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = TranslationRepositoryImpl(api)
    }

    @Test
    fun `translate returns parsed result`() = runTest {
        coEvery { api.post("/api/translate", any()) } returns JSONObject().apply {
            put("translatedText", "Hello")
            put("detectedSourceLang", "ko")
            put("cached", false)
        }
        val result = repo.translate("안녕하세요", "en", null)
        assertTrue(result is Resource.Success)
        assertEquals("Hello", (result as Resource.Success).data.translatedText)
    }

    @Test
    fun `translate failure returns Error`() = runTest {
        coEvery { api.post("/api/translate", any()) } throws RuntimeException("Network error")
        val result = repo.translate("test", "en", null)
        assertTrue(result is Resource.Error)
    }

    @Test
    fun `getQuota returns parsed quota`() = runTest {
        coEvery { api.get("/api/translate/quota") } returns JSONObject().apply {
            put("used", 10)
            put("limit", 50)
            put("unlimited", false)
        }
        val result = repo.getQuota()
        assertTrue(result is Resource.Success)
        assertEquals(10, (result as Resource.Success).data.used)
    }
}
```

**Step 4: Register in Koin**

In `AppKoinModule.kt`, add to the repositories section:
```kotlin
singleOf(::TranslationRepositoryImpl) bind TranslationRepository::class
```

**Step 5: Add FakeTranslationRepository for E2E tests**

Create `app/src/androidTest/java/com/shyden/shytalk/fake/FakeTranslationRepository.kt`:
```kotlin
class FakeTranslationRepository : TranslationRepository {
    override suspend fun translate(text: String, targetLang: String, messagePath: String?) =
        Resource.Success(TranslationResult("[Translated] $text", "en", false))
    override suspend fun getQuota() =
        Resource.Success(TranslationQuota(0, 50, false))
}
```

Register in `TestKoinModule.kt`.

**Step 6: Run tests**

Run: `./gradlew test --tests "*.TranslationRepositoryImplTest"`
Expected: PASS

**Step 7: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/TranslationRepository.kt \
       app/src/main/java/com/shyden/shytalk/data/repository/TranslationRepositoryImpl.kt \
       app/src/test/java/com/shyden/shytalk/data/repository/TranslationRepositoryImplTest.kt \
       app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt \
       app/src/androidTest/java/com/shyden/shytalk/fake/FakeTranslationRepository.kt \
       app/src/androidTest/java/com/shyden/shytalk/di/TestKoinModule.kt
git commit -m "feat: add TranslationRepository with quota support"
```

---

## Phase 4: Message Translation UI

### Task 12: Add translate button to message bubbles

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/MessageBubble.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateMessageBubble.kt`

**Step 1: Add translate callback to MessageBubble**

Add a parameter `onTranslate: ((String) -> Unit)? = null` to the MessageBubble composable.

For TEXT type messages, add a small globe IconButton after the message text:
```kotlin
if (onTranslate != null && message.type == MessageType.TEXT) {
    IconButton(
        onClick = { onTranslate(message.messageId) },
        modifier = Modifier.size(20.dp)
    ) {
        Icon(
            Icons.Default.Translate,
            contentDescription = stringResource(Res.string.translate),
            modifier = Modifier.size(14.dp)
        )
    }
}
```

If the message has a translation to show (passed as a parameter `translatedText: String? = null`):
```kotlin
if (translatedText != null) {
    Text(
        text = translatedText,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 4.dp)
    )
}
```

**Step 2: Same pattern for PrivateMessageBubble**

Add `onTranslate` and `translatedText` parameters. Add the globe button and translated text display.

**Step 3: Build to verify**

Run: `./gradlew :shared:compileKotlinAndroid`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/MessageBubble.kt \
       shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateMessageBubble.kt
git commit -m "feat: add translate button and translated text display to message bubbles"
```

---

### Task 13: Wire translation into RoomViewModel and PrivateChatViewModel

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomViewModel.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatViewModel.kt`

**Step 1: Add translation state and methods to RoomViewModel**

Add to RoomUiState:
```kotlin
val translatedMessages: Map<String, String> = emptyMap(), // messageId -> translatedText
val translationLoading: Set<String> = emptySet(), // messageIds currently translating
```

Add method:
```kotlin
fun translateMessage(messageId: String, text: String) {
    if (_uiState.value.translatedMessages.containsKey(messageId)) {
        // Toggle off — hide translation
        _uiState.update { it.copy(
            translatedMessages = it.translatedMessages - messageId
        ) }
        return
    }
    val targetLang = LanguagePreference.get()
    val roomId = _uiState.value.roomId
    _uiState.update { it.copy(translationLoading = it.translationLoading + messageId) }
    viewModelScope.launch {
        val messagePath = "rooms/$roomId/messages/$messageId"
        when (val result = translationRepository.translate(text, targetLang, messagePath)) {
            is Resource.Success -> _uiState.update { it.copy(
                translatedMessages = it.translatedMessages + (messageId to result.data.translatedText),
                translationLoading = it.translationLoading - messageId
            ) }
            is Resource.Error -> _uiState.update { it.copy(
                translationLoading = it.translationLoading - messageId
            ) }
            is Resource.Loading -> {}
        }
    }
}
```

**Step 2: Same pattern for PrivateChatViewModel**

Add `translatedMessages` and `translationLoading` to PrivateChatUiState. Add `translateMessage()` method using the conversation message path.

**Step 3: Inject TranslationRepository into both ViewModels via Koin**

Update constructor parameters and Koin viewModel declarations.

**Step 4: Wire in the screen composables**

In the screen where MessageBubble/PrivateMessageBubble is called, pass `onTranslate` and `translatedText` from the ViewModel state.

**Step 5: Commit**

```bash
git commit -m "feat: wire message translation into room and chat ViewModels"
```

---

### Task 14: Add per-room/conversation auto-translate toggle

**Files:**
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomViewModel.kt`
- Modify: `shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatViewModel.kt`
- Modify: Room settings UI and conversation settings UI

**Step 1: Add auto-translate state**

In RoomUiState:
```kotlin
val autoTranslateEnabled: Boolean = false,
```

**Step 2: Add toggle method**

```kotlin
fun toggleAutoTranslate() {
    val roomId = _uiState.value.roomId
    val newValue = !_uiState.value.autoTranslateEnabled
    _uiState.update { it.copy(autoTranslateEnabled = newValue) }
    // Persist locally
    LanguagePreference.setAutoTranslate(roomId, newValue) // Add this method to LanguagePreference
}
```

**Step 3: Auto-translate incoming messages**

In the room message observer, when a new message arrives and auto-translate is on:
```kotlin
if (_uiState.value.autoTranslateEnabled && user?.isSuperShy == true) {
    translateMessage(message.messageId, message.text)
}
```

**Step 4: Add auto-translate toggle to room menu / conversation settings**

Only visible if user is SuperShy. Switch component with label from string resources.

**Step 5: Same pattern for PrivateChatViewModel**

**Step 6: Commit**

```bash
git commit -m "feat: add per-room auto-translate toggle for SuperShy users"
```

---

## Phase 5: LibreTranslate Infrastructure

### Task 15: Provision Oracle ARM VM and install LibreTranslate

This is infrastructure work, not code. Steps:

1. Retry creating ARM VM via OCI CLI (same pattern as x86 VM creation)
2. If successful: SSH in, install Python 3, pip install libretranslate
3. Start LibreTranslate: `libretranslate --host 0.0.0.0 --port 5000`
4. Set up PM2 or systemd to keep it running
5. Configure security: only allow traffic from the x86 API VM's private IP (not public)
6. Add `LIBRETRANSLATE_URL=http://<arm-private-ip>:5000` to Express API `.env`
7. Restart Express API

**Fallback**: If ARM unavailable, run LibreTranslate on the existing x86 VM using swap. Add to PM2 ecosystem config as a second process with `max_memory_restart: '300M'`.

---

## Phase 6: Final Integration & Testing

### Task 16: Run all tests

Run: `./gradlew test`
Expected: All tests pass

### Task 17: Update FakePresenceService and other test doubles

Ensure all fake repositories in `app/src/androidTest/java/com/shyden/shytalk/fake/` are updated with any new interface methods.

### Task 18: Deploy to server and test end-to-end

1. Deploy updated Express API to Oracle VM
2. Deploy admin panel to Cloudflare Pages
3. Build and install Android app on test device
4. Verify: language picker works, messages translate, quota tracking works, auto-translate works for SuperShy

### Task 19: Commit, PR, merge, release

Follow standard release process:
1. Run all tests
2. Write release notes (non-technical!)
3. Create branch, commit, push
4. Open PR, merge
5. Publish to Play Store internal track

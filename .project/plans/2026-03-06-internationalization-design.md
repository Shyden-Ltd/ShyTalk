# Internationalization & Message Translation Design

## Problem

ShyTalk is a language learning app, but all UI content is hardcoded in English. Users need:
1. The entire app UI displayed in their chosen language
2. The ability to translate chat messages (room, DM, group) into their language

## Decisions

- **Language selection**: Default to device locale, changeable in settings. Stored in Firestore (server-side) and local preferences (offline/pre-login).
- **UI strings**: Compose Multiplatform `composeResources` with per-locale `strings.xml` files. Initial translations generated via LibreTranslate batch scripts.
- **Message translation**: LibreTranslate self-hosted on a dedicated Oracle ARM VM (Always Free). Express API proxies requests via `POST /api/translate`.
- **Quota**: Free users get 50 translations/day. SuperShy users get unlimited + per-room/conversation auto-translate.
- **Caching**: Translated messages cached server-side in Firestore (on the message document) to avoid re-translating the same message.

## Architecture

### 1. User Language Preference

Add `language: String` field to the User model (ISO 639-1 code, e.g., `"en"`, `"es"`, `"ar"`).

- Stored in Firestore (`users/{uid}.language`)
- Also stored locally via KMP expect/actual (SharedPreferences on Android, UserDefaults on iOS)
- Default: device locale on first sign-up
- Changeable in App Settings (language picker screen)
- Server uses this for push notification text, system messages, etc.

### 2. Static UI Strings

Extract all ~600+ hardcoded strings into Compose Multiplatform string resources:

```
shared/src/commonMain/composeResources/
  values/strings.xml              # English (default/fallback)
  values-es/strings.xml           # Spanish
  values-ar/strings.xml           # Arabic
  values-ja/strings.xml           # Japanese
  values-ko/strings.xml           # Korean
  values-zh/strings.xml           # Chinese
  ...                             # Any language supported by LibreTranslate
```

Usage: `Text(stringResource(Res.string.tap_to_join))`

The app resolves strings based on the user's chosen language (not device locale). Falls back to English for unsupported languages.

Initial translations for all languages are generated via LibreTranslate batch scripts, which read the English `strings.xml` and produce locale variants.

### 3. Translation Server (LibreTranslate)

A dedicated Oracle Cloud ARM VM (VM.Standard.A1.Flex, 2 OCPUs, 12GB RAM — Always Free) runs LibreTranslate.

- Internal URL: `http://<arm-vm-ip>:5000`
- Not publicly exposed — only the Express API server calls it
- LibreTranslate Docker image or pip install

If ARM instances remain unavailable, fallback options (in priority order):
1. Retry daily until ARM instance is available
2. Run on current x86 VM using swap (slower, ~1-2s per translation)
3. Use MyMemory free API as temporary bridge (50K chars/day)

### 4. Express API Translate Endpoint

```
POST /api/translate
Authorization: Bearer <firebase-id-token>

Request:  { "text": "안녕하세요", "targetLang": "en", "messageId": "msg-123", "messagePath": "rooms/room-1/messages/msg-123" }
Response: { "translatedText": "Hello", "detectedSourceLang": "ko", "cached": false }
```

Logic:
1. Authenticate user
2. Check if `translations.{targetLang}` already exists on the message doc → return cached
3. Check daily quota (free users: 50/day, SuperShy: unlimited)
4. If over quota → return 429 with upgrade prompt
5. Call LibreTranslate → get translation
6. Store in Firestore: `{messagePath}.translations.{targetLang} = translatedText`
7. Increment user's daily translation counter
8. Return translated text

Daily counter stored at: `users/{uid}.translationsToday` + `users/{uid}.translationDate` (reset when date changes).

### 5. Message Document Schema Change

Room messages (`rooms/{roomId}/messages/{messageId}`):
```
{
  text: "안녕하세요",
  senderId: "user-1",
  ...existing fields...,
  translations: {          // NEW — added on first translation request
    "en": "Hello",
    "es": "Hola"
  }
}
```

Same pattern for private messages (`conversations/{convId}/messages/{messageId}`).

### 6. Client-Side UX

#### Tap to Translate (all users)
- Each message bubble shows a small globe icon if the message appears to be in a different language than the user's
- Language detection: simple heuristic (if message contains non-Latin chars for Latin-language users, or vice versa) — or use LibreTranslate's `/detect` endpoint
- Tapping the globe calls `/api/translate`
- Translated text appears below the original with a "Translated from [language]" label
- Tapping again hides the translation
- Translations cached in-memory in the ViewModel (no re-call on scroll)

#### Auto-Translate (SuperShy only)
- Toggle per room/conversation (stored locally):
  - Key pattern: `auto_translate:{roomId}` or `auto_translate:{conversationId}`
  - Accessible from room menu / conversation settings
- When enabled, ViewModel calls `/api/translate` for each incoming message
- Translated text replaces the original in the UI
- Small indicator: "Translated" label — tap to see original
- Does not count against daily quota (SuperShy = unlimited)

#### Quota Exhausted UX
- When a free user hits 50 translations, the translate button shows a tooltip: "Daily limit reached. Upgrade to SuperShy for unlimited translations."
- The globe icon greys out for the rest of the day

### 7. Data Flow

```
Incoming message arrives in ViewModel
    │
    ├─ Auto-translate ON for this room? (SuperShy only, local pref)
    │   └─ YES → POST /api/translate { text, targetLang, messageId, messagePath }
    │           └─ Show translated text (tap to see original)
    │
    └─ NO → Show original text with globe icon
            └─ User taps globe
                └─ POST /api/translate { text, targetLang, messageId, messagePath }
                    ├─ Quota OK → Show translation below original
                    └─ Quota exceeded → Show upgrade prompt
```

### 8. Settings Screen Addition

New section in App Settings: **Language**
- Language picker (shows all available languages with native names)
- Selected language updates Firestore + local preferences
- App UI reloads in the new language immediately

### 9. Infrastructure

| Component | Host | Cost |
|---|---|---|
| Express API (`/api/translate`) | Oracle x86 VM (existing) | $0 |
| LibreTranslate | Oracle ARM VM (new, Always Free) | $0 |
| Translation cache | Firestore (existing) | $0 (Spark free tier) |
| UI string resources | Bundled in app | $0 |

### 10. Scope Exclusions

- RTL layout support (future work — Arabic, Hebrew, etc.)
- Voice message translation / transcription
- Room name / description translation
- Push notification translation (use user's language for server-generated notifications — future)
- Translation quality review / editing

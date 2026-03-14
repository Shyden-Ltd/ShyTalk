# Apple Sign-In Setup — Firebase Console + Apple Developer

## Prerequisites

These manual steps must be completed before Apple Sign-In will work on Android (or iOS).

---

## 1. Apple Developer Console

### Create Two Service IDs (Dev + Prod)

You need **one Service ID per Firebase project** because each has a different OAuth callback URL.

**Dev Service ID:**
1. Go to https://developer.apple.com/account/resources/identifiers/list/serviceId
2. Click **+** to register a new Service ID
3. **Description:** `ShyTalk Dev Sign In`
4. **Identifier:** `com.shyden.shytalk.dev.signin`
5. Click **Continue** → **Register**

**Prod Service ID:**
1. Click **+** again to register a second Service ID
2. **Description:** `ShyTalk Sign In`
3. **Identifier:** `com.shyden.shytalk.signin`
4. Click **Continue** → **Register**

### Create a Private Key (shared between dev and prod)

The same `.p8` key works for both Firebase projects — you only need one.

1. Go to https://developer.apple.com/account/resources/authkeys/list
2. Click **+** to create a new key
3. **Key Name:** `ShyTalk Firebase Auth`
4. Enable **Sign In with Apple** checkbox
5. Click **Configure** → select `com.shyden.shytalk` as the Primary App ID
6. Click **Save** → **Continue** → **Register**
7. **Download the `.p8` key file** — you can only download it once. Store it securely.
8. Note the **Key ID** shown on the page

### Note Your Team ID

1. Go to https://developer.apple.com/account
2. Your **Team ID** is shown in the top-right under your name (10-character alphanumeric)

---

## 2. Firebase Console — Dev Project (`shytalk-dev`)

1. Go to https://console.firebase.google.com/project/shytalk-dev/authentication/providers
2. Click **Add new provider** → **Apple**
3. Enable the toggle
4. Fill in:
   - **Service ID:** `com.shyden.shytalk.dev.signin` ← the DEV Service ID
   - **Apple Team ID:** Your 10-character Team ID
   - **Key ID:** The Key ID from the `.p8` key
   - **Private Key:** Paste the contents of the `.p8` file
5. Copy the **Authorization callback URL** shown at the bottom (looks like `https://shytalk-dev.firebaseapp.com/__/auth/handler`)
6. Click **Save**

### Configure Dev Service ID in Apple Developer

1. Go back to Apple Developer Console → Service IDs → click `com.shyden.shytalk.dev.signin`
2. Enable **Sign In with Apple** checkbox
3. Click **Configure**
4. **Primary App ID:** Select `com.shyden.shytalk`
5. **Domains:** Add `shytalk-dev.firebaseapp.com`
6. **Return URLs:** Add the callback URL from step 5 above (`https://shytalk-dev.firebaseapp.com/__/auth/handler`)
7. Click **Save** → **Continue** → **Save**

---

## 3. Firebase Console — Prod Project (`shytalk-7ba69`)

1. Go to https://console.firebase.google.com/project/shytalk-7ba69/authentication/providers
2. Click **Add new provider** → **Apple**
3. Enable the toggle
4. Fill in:
   - **Service ID:** `com.shyden.shytalk.signin` ← the PROD Service ID
   - **Apple Team ID:** Same Team ID
   - **Key ID:** Same Key ID
   - **Private Key:** Same `.p8` file contents
5. Copy the **Authorization callback URL** (looks like `https://shytalk-7ba69.firebaseapp.com/__/auth/handler`)
6. Click **Save**

### Configure Prod Service ID in Apple Developer

1. Go back to Apple Developer Console → Service IDs → click `com.shyden.shytalk.signin`
2. Enable **Sign In with Apple** checkbox
3. Click **Configure**
4. **Primary App ID:** Select `com.shyden.shytalk`
5. **Domains:** Add `shytalk-7ba69.firebaseapp.com`
6. **Return URLs:** Add the callback URL from step 5 above (`https://shytalk-7ba69.firebaseapp.com/__/auth/handler`)
7. Click **Save** → **Continue** → **Save**

---

## 4. iOS App IDs (for Phase 2)

When you build the iOS app, you'll also need:

**Dev iOS App:**
1. Go to https://developer.apple.com/account/resources/identifiers/list
2. Register App ID: `com.shyden.shytalk.dev` (matches the dev build flavor)
3. Enable **Sign In with Apple** capability

**Prod iOS App:**
1. Register App ID: `com.shyden.shytalk` (matches the prod bundle ID)
2. Enable **Sign In with Apple** capability

These App IDs are needed for native Apple Sign-In on iOS (ASAuthorizationController). Android only uses the Service IDs via Firebase OAuthProvider.

---

## 5. Summary — What Goes Where

| Item | Dev | Prod |
|------|-----|------|
| **Service ID** | `com.shyden.shytalk.dev.signin` | `com.shyden.shytalk.signin` |
| **Firebase project** | `shytalk-dev` | `shytalk-7ba69` |
| **Callback URL** | `https://shytalk-dev.firebaseapp.com/__/auth/handler` | `https://shytalk-7ba69.firebaseapp.com/__/auth/handler` |
| **Domain** | `shytalk-dev.firebaseapp.com` | `shytalk-7ba69.firebaseapp.com` |
| **Private Key (.p8)** | Shared — same key for both | Shared — same key for both |
| **Team ID** | Same | Same |
| **Key ID** | Same | Same |

---

## 6. Verify

### Dev build:
1. Build and run: `./gradlew installDevDebug`
2. Tap **Sign in with Apple** on the sign-in screen
3. Chrome Custom Tab opens → Apple sign-in page → authenticate
4. App should sign in and proceed to main screen

### Prod build:
1. Build and run: `./gradlew installProdRelease`
2. Same test — verify Apple Sign-In works against the prod Firebase project

---

## Troubleshooting

- **"invalid_client" error:** The Service ID in Firebase Console doesn't match what's registered in Apple Developer, OR the Team ID / Key ID / private key is wrong
- **"redirect_uri_mismatch":** The Return URL in the Apple Service ID config doesn't match Firebase's callback URL. Check for trailing slashes, http vs https, exact domain match.
- **Redirect loop:** Same as above — callback URL mismatch
- **Works on dev but not prod (or vice versa):** You're using the wrong Service ID. Dev Firebase must use the dev Service ID, prod must use the prod one.
- **Custom Tab doesn't open:** Chrome may not be installed — the system default browser will be used instead (still works, just different UI)
- **Auth succeeds but identity resolution fails:** The Express API identity system needs to handle the "apple" provider — check `express-api/src/routes/identity.js`
- **Apple only returns name/email on first sign-in:** This is by design. Apple only provides the user's name and email the very first time they authorize your app. Subsequent sign-ins only return the user ID.

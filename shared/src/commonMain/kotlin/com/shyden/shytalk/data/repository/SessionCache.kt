package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage

/**
 * A resolved identity, cached across process death (SHY-0143).
 *
 * The IDENTITY — [firebaseUid] and [uniqueId] — is non-null and non-blank by
 * construction, so consumers never have to decide what half an identity means.
 * [cohort] is separate: it is metadata, and null simply means "not known yet".
 */
data class CachedSession(
    val firebaseUid: String,
    val uniqueId: String,
    /**
     * Optional. The identity is the uid/uniqueId pair; the cohort is metadata
     * that some callers (a PIN unlock) simply do not have. Treating it as part
     * of the identity is what made a successful unlock erase the record.
     */
    val cohort: String?,
)

/**
 * Persists `{firebaseUid, uniqueId, cohort}` so a cold start can key its reads
 * on the correct `uniqueId` before any of them are issued.
 *
 * **The problem.** `AuthRepository.currentUserId` returns
 * `resolvedUniqueId ?: firebaseUid` — by documented contract it falls back to
 * the raw Firebase UID until identity resolution completes. The only code that
 * ever set `resolvedUniqueId` on a returning-user path was `AuthViewModel.init`,
 * and an `AuthViewModel` is constructed solely inside the Sign-In / e-mail-OTP
 * route composables. SHY-0187 stopped routing cold starts through Sign-In, so a
 * restored session now reaches Main with every read keyed on the Firebase UID:
 * `users/<firebaseUid>` instead of `users/<uniqueId>`, the SHY-0139 wrong-key
 * hazard. Reading this cache before the routing decision is what puts the real
 * uniqueId in place first.
 *
 * **Why not reuse `AppLockRepository.storedUniqueId`.** That already persists a
 * uniqueId to this same storage, but it is not bound to a Firebase
 * user, so it cannot answer "is this identity the one the live session belongs
 * to?". The binding is not hypothetical: on iOS the Keychain **survives app
 * deletion**, so a reinstall can inherit the previous account's credential.
 * Serving that would be a cross-account read, not a stale one.
 *
 * **A routing hint, never an authorisation.** Nothing here grants access to
 * anything. Cohort segregation is enforced by the custom claims in the Firebase
 * JWT and the Firestore rules that read them; the cached cohort only lets the
 * shell render without a round-trip, and the cold-start sequencer still gates
 * every cohort-scoped read behind `getIdToken(forceRefresh = true)`. If this
 * cache were wholly wrong, the worst case is a wrong-looking shell over data the
 * server refuses to return.
 *
 * **At rest.** Backed by [SecureStorage], which is the iOS Keychain but on
 * Android is plain `SharedPreferences` with `MODE_PRIVATE` — see
 * `SecureStorage.android.kt` for why (AndroidX deprecated
 * `EncryptedSharedPreferences`, and the app's `minSdk = 28` guarantees
 * file-based encryption). So on Android the protection is the OS sandbox plus
 * device FBE, NOT an app-level cipher, and the story's "encrypted at rest"
 * Security AC is met only in that sense. An earlier version of this comment
 * claimed AES-256-GCM; it was copied from a stale KDoc and was never true of
 * this storage. Nothing secret lives here in any case — a uniqueId is the
 * public account number every other user sees, and the cohort is metadata.
 */
class SessionCache(
    private val storage: SecureStorage,
) {
    /**
     * Reads the cached identity, but only if it belongs to [liveFirebaseUid].
     *
     * The uid comparison lives HERE rather than at the call sites on purpose: a
     * `read()` that returned the row and left callers to check the binding would
     * be one forgotten comparison away from a cross-account read, and there is
     * no reading of this cache for which skipping that check is correct.
     *
     * Returns null — a plain miss, never a partial record — when there is no
     * live user, when any field is absent or blank, or when the stored uid is
     * not the live one. Every miss routes the caller into the ordinary
     * resolve-then-route path, which is exactly today's behaviour.
     *
     * The blank checks on the two uids are deliberately redundant, and mutation
     * testing says so plainly: dropping either one alone leaves the suite green,
     * because the other still makes the degenerate blank-equals-blank match
     * impossible. Both are kept — the property is what is under test, being
     * over-protected costs nothing, and the four reads then share one shape
     * instead of one of them being subtly special.
     */
    fun read(liveFirebaseUid: String?): CachedSession? {
        val liveUid = liveFirebaseUid?.takeIf { it.isNotBlank() } ?: return null

        val storedUid = storage.getString(KEY_FIREBASE_UID)?.takeIf { it.isNotBlank() } ?: return null
        val uniqueId = storage.getString(KEY_UNIQUE_ID)?.takeIf { it.isNotBlank() } ?: return null

        if (storedUid != liveUid) return null

        return CachedSession(
            firebaseUid = storedUid,
            uniqueId = uniqueId,
            cohort = storage.getString(KEY_COHORT)?.takeIf { it.isNotBlank() },
        )
    }

    /**
     * Writes the identity through to storage — or clears it.
     *
     * The rule turns on WHAT is missing, and getting that distinction wrong is
     * what broke the feature once already:
     *
     *  - **No uid or no uniqueId** ⇒ [clear]. There is no identity to route on,
     *    and leaving the previous one behind for the next launch to trust is
     *    worse than an extra resolve-then-route.
     *  - **A different uid** ⇒ [clear] first, so the incoming record cannot
     *    inherit a field from the account it replaces.
     *  - **No cohort** ⇒ write the identity anyway and leave any known cohort
     *    alone. Cohort is not identity; its only consumer outside these
     *    repositories is the dev-only `PreviewWatermark`, and routing never
     *    reads it.
     *
     * That last case is the one that mattered. Because the write-through fires
     * from each property setter independently, `LockScreenViewModel` — which
     * knows the uniqueId it just verified a PIN against and no cohort — used to
     * drive this straight into the erase branch. A successful unlock wiped the
     * cache, so with App-Lock on by default the steady state became miss → Lock
     * → PIN → wipe → miss → Lock, permanently.
     */
    fun write(
        firebaseUid: String?,
        uniqueId: String?,
        cohort: String?,
    ) {
        val uid = firebaseUid?.takeIf { it.isNotBlank() }
        val unique = uniqueId?.takeIf { it.isNotBlank() }

        // No identity to cache. Erasing rather than no-op'ing is what keeps a
        // signed-out session, or a half-torn-down one, from leaving a record
        // behind for the next launch to trust.
        if (uid == null || unique == null) {
            clear()
            return
        }

        // A different account: drop everything the previous one left, including
        // its cohort, so the new record cannot inherit a stale field. This is
        // the case the old blanket erase-on-partial rule existed to cover — it
        // was right about the danger and wrong about its scope.
        if (storage.getString(KEY_FIREBASE_UID) != uid) clear()

        storage.putString(KEY_FIREBASE_UID, uid)
        storage.putString(KEY_UNIQUE_ID, unique)

        // Written when known, LEFT ALONE when not. A caller holding only the
        // uniqueId — `LockScreenViewModel`, which knows the id it just verified
        // a PIN against and nothing else — must not degrade a cohort that
        // sign-in already established.
        cohort?.takeIf { it.isNotBlank() }?.let { storage.putString(KEY_COHORT, it) }
    }

    /**
     * Forgets the cached identity. Called on sign-out, so no uniqueId or cohort
     * is left on disk afterwards.
     *
     * Removes its own three keys rather than calling `storage.clear()`: this
     * storage is shared with `AppLockRepositoryImpl`, and wiping it would take
     * the user's PIN credential with it — turning sign-out into "forget this
     * device" and stranding the user at re-registration.
     */
    fun clear() {
        storage.remove(KEY_FIREBASE_UID)
        storage.remove(KEY_UNIQUE_ID)
        storage.remove(KEY_COHORT)
    }

    companion object {
        /** Distinct from `AppLockRepositoryImpl`'s keys, which share this storage. */
        const val KEY_FIREBASE_UID = "session_cache_firebase_uid"
        const val KEY_UNIQUE_ID = "session_cache_unique_id"
        const val KEY_COHORT = "session_cache_cohort"
    }
}

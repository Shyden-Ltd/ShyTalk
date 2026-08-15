package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage

/**
 * A resolved identity, cached across process death (SHY-0143).
 *
 * Every field is non-null and non-blank by construction — [SessionCache] never
 * hands out a partial record, so consumers never have to decide what half an
 * identity means.
 */
data class CachedSession(
    val firebaseUid: String,
    val uniqueId: String,
    val cohort: String,
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
 * uniqueId to this same encrypted storage, but it is not bound to a Firebase
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
 * Backed by [SecureStorage] — `EncryptedSharedPreferences` (AES-256-GCM) on
 * Android, the Keychain on iOS — so the uniqueId and cohort are encrypted at
 * rest as the story's security AC requires.
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
        val cohort = storage.getString(KEY_COHORT)?.takeIf { it.isNotBlank() } ?: return null

        if (storedUid != liveUid) return null

        return CachedSession(firebaseUid = storedUid, uniqueId = uniqueId, cohort = cohort)
    }

    /**
     * Writes the identity through to encrypted storage — or clears it.
     *
     * Identity is assembled in stages: `resolvedUniqueId` is set when the
     * backend resolves it, `resolvedCohort` only once the User doc loads. So
     * this is called at moments when the record may still be incomplete, and
     * what it does then is the whole design:
     *
     * An incomplete record [clear]s rather than no-ops. A no-op would leave the
     * PREVIOUS user's complete row in place while the caller believes it has
     * just cached the current one — the cache would then confidently serve the
     * wrong account on the next launch. Erasing costs one extra
     * resolve-then-route and cannot be wrong.
     */
    fun write(
        firebaseUid: String?,
        uniqueId: String?,
        cohort: String?,
    ) {
        val uid = firebaseUid?.takeIf { it.isNotBlank() }
        val unique = uniqueId?.takeIf { it.isNotBlank() }
        val effectiveCohort = cohort?.takeIf { it.isNotBlank() }

        if (uid == null || unique == null || effectiveCohort == null) {
            clear()
            return
        }

        storage.putString(KEY_FIREBASE_UID, uid)
        storage.putString(KEY_UNIQUE_ID, unique)
        storage.putString(KEY_COHORT, effectiveCohort)
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

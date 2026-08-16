package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.core.util.logW
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

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
     * The blank checks on the two uids remain deliberately redundant — dropping
     * either alone leaves the suite green, because the other still makes the
     * degenerate blank-equals-blank match impossible. They cost nothing and keep
     * the reads one shape.
     */
    fun read(liveFirebaseUid: String?): CachedSession? {
        // The pre-I6 three-key format. `clear()` also removes these, but on the
        // real upgrade path clear() is NEVER called: a cold start reads a miss,
        // routes to Lock, and the PIN unlock's write-through only ever writes.
        // So the sweep has to happen on the read that every launch performs, or
        // the old keys survive indefinitely — on iOS, past app deletion.
        sweepLegacyKeys()

        val liveUid = liveFirebaseUid?.takeIf { it.isNotBlank() } ?: return null

        // No separate blank-string branch: `Json.parseToJsonElement("")` throws,
        // and the catch below already routes that to the same miss. A branch
        // whose only observable difference is a log string is a branch whose
        // test cannot fail.
        val raw = storage.getString(KEY_SESSION) ?: return null

        // The ENTIRE decode is inside the try, field reads included.
        // `JsonElement.jsonPrimitive` throws when the element is not a
        // primitive, so a record like `{"uniqueId":["10000005"]}` — valid JSON,
        // wrong shape — would otherwise propagate out of `read()` into
        // MainActivity's LaunchedEffect and iOS's produceState and crash the
        // launch, with the bad record surviving to crash the next one too. On
        // iOS the Keychain outlives the app, so "it will sort itself out" does
        // not apply.
        //
        // Anything unreadable is a miss, never a partial identity, and it is
        // erased so it cannot be re-parsed on every launch forever.
        return try {
            val record = Json.parseToJsonElement(raw) as? JsonObject ?: return unusableRecord("not a JSON object")

            fun field(name: String) = record[name]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

            val storedUid = field(FIELD_FIREBASE_UID) ?: return unusableRecord("no usable firebaseUid")
            val uniqueId = field(FIELD_UNIQUE_ID) ?: return unusableRecord("no usable uniqueId")

            // NOT a discard: a record for a different account is perfectly
            // well-formed and belongs to whoever it names. Erasing it here
            // would throw away the previous user's identity every time the
            // current one launches.
            if (storedUid != liveUid) return null

            CachedSession(
                firebaseUid = storedUid,
                uniqueId = uniqueId,
                cohort = field(FIELD_COHORT),
            )
        } catch (e: IllegalArgumentException) {
            unusableRecord("unreadable (${e.message})")
        }
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

        val effectiveCohort = cohort?.takeIf { it.isNotBlank() }

        val record =
            JsonObject(
                buildMap {
                    put(FIELD_FIREBASE_UID, JsonPrimitive(uid))
                    put(FIELD_UNIQUE_ID, JsonPrimitive(unique))
                    if (effectiveCohort != null) put(FIELD_COHORT, JsonPrimitive(effectiveCohort))
                },
            )

        // ONE key, ONE write, and — deliberately — no read beforehand.
        //
        // The previous shape wrote three keys in sequence, so two interleaved
        // write-throughs for different accounts could land `{uid_A,
        // uniqueId_B}`: a COMPLETE-looking record that `read` would serve. A
        // single key makes the loser's record vanish whole rather than mix.
        //
        // An intermediate version carried an existing cohort forward for the
        // same uid, which made this a read-modify-write and reintroduced the
        // problem as a lost update — needing a lock that commonMain cannot
        // cheaply have, since the callers are property setters and cannot
        // suspend. Dropping the carry-forward costs a cohort on the unlock
        // path only, and the cohort's sole consumer outside these repositories
        // is the dev-only PreviewWatermark. Trading invisible metadata for a
        // whole class of concurrency bug is the right way round.
        storage.putString(KEY_SESSION, record.toString())
    }

    /** Removes the superseded three-key record if any of it is still present. */
    private fun sweepLegacyKeys() {
        if (storage.getString(LEGACY_KEY_FIREBASE_UID) == null &&
            storage.getString(LEGACY_KEY_UNIQUE_ID) == null &&
            storage.getString(LEGACY_KEY_COHORT) == null
        ) {
            return
        }
        logW(TAG, "Removing a superseded three-key session record")
        storage.remove(LEGACY_KEY_FIREBASE_UID)
        storage.remove(LEGACY_KEY_UNIQUE_ID)
        storage.remove(LEGACY_KEY_COHORT)
    }

    /**
     * Reports an unusable record as a miss.
     *
     * Deliberately does NOT erase it. An earlier version did, then a
     * compare-and-delete version tried to make that safe — and a threaded test
     * showed it is not: `getString` followed by `clear()` is a read-then-write
     * with a window in between, so a `write()` landing there still loses its
     * brand-new record. Exactly the TOCTOU shape SHY-0298's gh-pages cap had.
     *
     * `read()` is now a pure read, which closes the class of bug rather than
     * narrowing it. The cost is that a permanently malformed record is
     * re-parsed once per launch until the next `write()` overwrites it or a
     * sign-out clears it — one failed JSON parse, against losing a good
     * record. Not a close call.
     */
    private fun unusableRecord(why: String): CachedSession? {
        logW(TAG, "Ignoring the stored session record — $why")
        return null
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
        storage.remove(KEY_SESSION)
        // The three-key format this replaced (SHY-0143, pre-I6). Removed here
        // so an upgrade over a populated cache cannot leave the old keys on
        // disk forever — on iOS the Keychain outlives the app itself.
        storage.remove(LEGACY_KEY_FIREBASE_UID)
        storage.remove(LEGACY_KEY_UNIQUE_ID)
        storage.remove(LEGACY_KEY_COHORT)
    }

    companion object {
        private const val TAG = "SessionCache"

        /**
         * The whole record, as one value. Distinct from
         * `AppLockRepositoryImpl`'s keys, which share this storage.
         */
        const val KEY_SESSION = "session_cache_record"

        internal const val FIELD_FIREBASE_UID = "firebaseUid"
        internal const val FIELD_UNIQUE_ID = "uniqueId"
        internal const val FIELD_COHORT = "cohort"

        /** Superseded by [KEY_SESSION]; cleared on sign-out so nothing lingers. */
        const val LEGACY_KEY_FIREBASE_UID = "session_cache_firebase_uid"
        const val LEGACY_KEY_UNIQUE_ID = "session_cache_unique_id"
        const val LEGACY_KEY_COHORT = "session_cache_cohort"
    }
}

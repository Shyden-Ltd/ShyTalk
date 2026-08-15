package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * SHY-0143 — the cold-start identity cache.
 *
 * Drives the REAL [SessionCache] over the REAL [SecureStorage] actual. No
 * double stands in for either: on the JVM target `SecureStorage` is a genuine
 * in-memory key-value store with the same read/write/remove semantics the
 * Android (`SharedPreferences`, MODE_PRIVATE) and iOS (Keychain) actuals
 * provide, so
 * everything with a decision in it — completeness, uid binding, corruption
 * handling — is exercised for real.
 *
 * This lives in `jvmTest` rather than `commonTest` for a mechanical reason: the
 * `expect class SecureStorage` declares no constructor and the Android actual
 * needs a `Context`, so only a platform test source set can build one.
 * `:shared:jvmTest` compiles and runs both source sets, so nothing is lost —
 * `LockScreenViewModelTest` sits here for the same reason.
 *
 * **Why the cache exists at all.** Every screen behind the launch gate keys its
 * reads on `AuthRepository.currentUserId`, which falls back to the raw Firebase
 * UID until `resolvedUniqueId` is set. Nothing on a cold start that routes
 * straight to Main sets it, so the uniqueId has to come off disk before the
 * routing decision is made. `AppLockRepository.storedUniqueId` already persists
 * a uniqueId, but it is not bound to a Firebase user — which is precisely the
 * hole this type closes, and matters most on iOS, where the Keychain survives
 * app deletion and can hand a reinstalled app the previous account's credential.
 */
class SessionCacheContractTest {
    private lateinit var storage: SecureStorage
    private lateinit var cache: SessionCache

    @BeforeTest
    fun setup() {
        storage = SecureStorage()
        cache = SessionCache(storage)
    }

    /** Builds a raw stored record, so tests can drive storage directly. */
    private fun json(fields: Map<String, String>): String =
        fields.entries.joinToString(prefix = "{", postfix = "}") { (k, v) -> "\"$k\":\"$v\"" }

    // ── Round-trip ────────────────────────────────────────────────────────

    @Test
    fun `a written session reads back field for field`() {
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        val read = assertNotNull(cache.read("fb-uid-1"), "a complete write must be readable")
        assertEquals("fb-uid-1", read.firebaseUid)
        assertEquals("10000005", read.uniqueId)
        assertEquals("adult", read.cohort)
    }

    @Test
    fun `a rewritten session replaces the previous one rather than merging`() {
        // Account switch on the same device: signing in as someone else must
        // not leave the previous user's uniqueId reachable under the new uid.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
        cache.write(firebaseUid = "fb-uid-2", uniqueId = "10000009", cohort = "minor")

        assertNull(cache.read("fb-uid-1"), "the superseded uid must no longer resolve")
        val read = assertNotNull(cache.read("fb-uid-2"))
        assertEquals("10000009", read.uniqueId)
        assertEquals("minor", read.cohort)
    }

    // ── The uid binding (AC: cached identity for a different uid) ─────────

    @Test
    fun `a session cached for a different Firebase uid is not trusted`() {
        // Account switch, or an iOS reinstall inheriting the old Keychain item.
        // Handing back the stored uniqueId here would key every read on the
        // PREVIOUS account — a cross-account read, not merely a stale one.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        assertNull(cache.read("fb-uid-2"), "a uid mismatch must read as a miss, not as the stored row")
    }

    @Test
    fun `a null or blank live uid never matches a stored session`() {
        // Signed out, or Firebase has not restored a user yet. Neither is a
        // licence to hand out an identity — and a blank-vs-blank comparison
        // must not be allowed to "match".
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        assertNull(cache.read(null), "no live user ⇒ no cached identity")
        assertNull(cache.read(""), "a blank uid must not match")
        assertNull(cache.read("   "), "a whitespace uid must not match")
    }

    // ── Completeness (AC: corrupted / partial entry) ──────────────────────

    // ── The identity is {firebaseUid, uniqueId}. Cohort is metadata. ──────

    @Test
    fun `a caller that does not know the cohort still caches the identity`() {
        // The bug this pins: cohort used to be part of the identity, so a
        // caller holding only the uniqueId drove `write` into its erase branch.
        // `LockScreenViewModel` is exactly that caller — it knows the uniqueId
        // it just verified a PIN against and has no cohort — so a successful
        // unlock WIPED the cache. With App-Lock on by default that made the
        // steady state: miss → Lock → PIN → wipe → miss → Lock, forever.
        //
        // Cohort is not identity. Its only consumer outside these repositories
        // is the dev-only PreviewWatermark; routing never reads it, and cohort
        // segregation is enforced by the JWT claims and the rules that read
        // them. Requiring it here bought nothing and cost the whole feature.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = null)

        val read = assertNotNull(cache.read("fb-uid-1"), "the identity is complete without a cohort")
        assertEquals("10000005", read.uniqueId)
        assertNull(read.cohort)
    }

    @Test
    fun `a cohort-less write preserves a cohort already known for the same account`() {
        // Sign-in caches the cohort; a later PIN unlock knows only the
        // uniqueId. Overwriting the cohort with nothing would quietly degrade
        // the record on every unlock.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = null)

        assertEquals("adult", assertNotNull(cache.read("fb-uid-1")).cohort)
    }

    @Test
    fun `a cohort-less write for a DIFFERENT account does not inherit the old cohort`() {
        // The reason the erase branch existed in the first place. Keeping it
        // for the account-change case is right; applying it to every partial
        // write was not.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.write(firebaseUid = "fb-uid-2", uniqueId = "10000009", cohort = null)

        assertNull(cache.read("fb-uid-1"), "the superseded account must be gone")
        val read = assertNotNull(cache.read("fb-uid-2"))
        assertEquals("10000009", read.uniqueId)
        assertNull(read.cohort, "a new account must not inherit the previous one's cohort")
    }

    @Test
    fun `hydrating both fields in sequence never leaves the cache erased in between`() {
        // The cold-start hydration assigns resolvedUniqueId then resolvedCohort,
        // and each assignment writes through. Under the old rule the first
        // assignment erased the record it had just read, leaving a window in
        // which process death lost it. There is now no such window.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = null)
        assertNotNull(cache.read("fb-uid-1"), "the record must survive the first assignment")
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        assertEquals("adult", assertNotNull(cache.read("fb-uid-1")).cohort)
    }

    @Test
    fun `a partial write persists nothing at all`() {
        // Half a record is not a usable routing hint, and a half-trusted route
        // is the failure mode this story exists to remove. Writing a partial
        // record must leave NOTHING behind — not a partial row for a later read
        // to reject, which would leave the decision to whoever reads next.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = null, cohort = "adult")

        assertNull(cache.read("fb-uid-1"), "an identity-less write must not be readable")
        assertNull(storage.getString(SessionCache.KEY_SESSION), "nor may a record linger in storage")
    }

    @Test
    fun `a partial write also erases a previously complete session`() {
        // Ordering trap: identity is assembled in stages (uniqueId lands before
        // cohort). If a later partial write silently no-ops, the cache keeps
        // serving the PREVIOUS user's complete row while the app believes it
        // just cached the current one.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
        cache.write(firebaseUid = "fb-uid-2", uniqueId = null, cohort = "minor")

        assertNull(cache.read("fb-uid-1"), "the stale complete row must be gone")
        assertNull(cache.read("fb-uid-2"), "and the identity-less one was never cached")
    }

    @Test
    fun `every single-field omission is rejected`() {
        // Exhaustive over which field is missing, so no one field is special-cased.
        // Cohort is deliberately absent from this list — omitting it is legal
        // and is covered by `a caller that does not know the cohort still
        // caches the identity` above. Only the identity fields are required.
        val omissions =
            listOf(
                Triple(null, "10000005", "adult"),
                Triple("fb-uid-1", null, "adult"),
            )
        omissions.forEach { (uid, unique, cohort) ->
            setup()
            cache.write(firebaseUid = uid, uniqueId = unique, cohort = cohort)
            assertNull(
                cache.read(uid ?: "fb-uid-1"),
                "an entry missing one field must not be readable (uid=$uid unique=$unique cohort=$cohort)",
            )
        }
    }

    @Test
    fun `blank and whitespace-only fields count as missing`() {
        // `EncryptedSharedPreferences` and the Keychain both round-trip an empty
        // string happily, so "present" is not the same as "usable". An empty
        // uniqueId would build the Firestore path `users/` — a read against the
        // whole collection rather than a document.
        listOf("", "   ").forEach { blank ->
            setup()
            cache.write(firebaseUid = "fb-uid-1", uniqueId = blank, cohort = "adult")
            assertNull(cache.read("fb-uid-1"), "a blank uniqueId ('$blank') must not be readable")
            assertNull(storage.getString(SessionCache.FIELD_COHORT), "nor may its cohort be published alone")

            setup()
            cache.write(firebaseUid = blank, uniqueId = "10000005", cohort = "adult")
            assertNull(cache.read(blank), "a blank firebaseUid ('$blank') must not be readable")
        }
    }

    @Test
    fun `a record missing an identity field reads as a miss`() {
        // Storage-level corruption is now a corrupt RECORD rather than a lost
        // key, because the whole session is one value. Each identity field is
        // dropped independently to prove no single survivor is enough.
        listOf(SessionCache.FIELD_FIREBASE_UID, SessionCache.FIELD_UNIQUE_ID).forEach { missing ->
            setup()
            val fields =
                mapOf(
                    SessionCache.FIELD_FIREBASE_UID to "fb-uid-1",
                    SessionCache.FIELD_UNIQUE_ID to "10000005",
                    SessionCache.FIELD_COHORT to "adult",
                ).filterKeys { it != missing }
            storage.putString(SessionCache.KEY_SESSION, json(fields))

            assertNull(cache.read("fb-uid-1"), "a record missing '$missing' must read as a miss")
        }
    }

    @Test
    fun `a record with a BLANK identity field reads as a miss`() {
        // `write` refuses blanks, so none reach storage through the front door.
        // These guards exist for what `write` cannot police — a value already
        // on disk from another app version, or a Keychain item edited out of
        // band. Driving storage directly is the only way to reach that path.
        listOf("", "   ").forEach { blank ->
            listOf(SessionCache.FIELD_FIREBASE_UID, SessionCache.FIELD_UNIQUE_ID).forEach { field ->
                setup()
                val fields =
                    mapOf(
                        SessionCache.FIELD_FIREBASE_UID to "fb-uid-1",
                        SessionCache.FIELD_UNIQUE_ID to "10000005",
                        SessionCache.FIELD_COHORT to "adult",
                    ) + (field to blank)
                storage.putString(SessionCache.KEY_SESSION, json(fields))

                assertNull(cache.read("fb-uid-1"), "a blank '$field' ('$blank') must read as a miss")
            }
        }
    }

    @Test
    fun `a blank cohort inside an otherwise good record is simply absent`() {
        // Cohort is metadata. A blank one must NOT invalidate the identity —
        // that conflation is what wiped the cache on every PIN unlock.
        storage.putString(
            SessionCache.KEY_SESSION,
            json(
                mapOf(
                    SessionCache.FIELD_FIREBASE_UID to "fb-uid-1",
                    SessionCache.FIELD_UNIQUE_ID to "10000005",
                    SessionCache.FIELD_COHORT to "   ",
                ),
            ),
        )

        val read = assertNotNull(cache.read("fb-uid-1"), "a blank cohort must not cost the identity")
        assertEquals("10000005", read.uniqueId)
        assertNull(read.cohort)
    }

    @Test
    fun `a record whose field is not a string reads as a miss instead of throwing`() {
        // Valid JSON, wrong shape. `JsonElement.jsonPrimitive` THROWS on a
        // non-primitive, and `read()` is called from MainActivity's
        // LaunchedEffect and iOS's produceState — so this escaping meant a
        // crash at launch, repeated on every launch because the bad record
        // survived. On iOS the Keychain outlives the app.
        listOf(
            """{"firebaseUid":"fb-uid-1","uniqueId":["10000005"]}""",
            """{"firebaseUid":{"x":1},"uniqueId":"10000005"}""",
            """{"firebaseUid":"fb-uid-1","uniqueId":null}""",
            """{"firebaseUid":"fb-uid-1","uniqueId":"10000005","cohort":[1,2]}""",
        ).forEach { record ->
            setup()
            storage.putString(SessionCache.KEY_SESSION, record)

            assertNull(cache.read("fb-uid-1"), "a wrong-shaped record ($record) must be a miss, not a throw")
            assertNull(storage.getString(SessionCache.KEY_SESSION), "and it must be erased, not re-parsed forever")
        }
    }

    @Test
    fun `a record for a DIFFERENT account is a miss but is NOT erased`() {
        // The one non-erasing miss. A well-formed record belongs to whoever it
        // names; erasing it because someone else launched would throw away the
        // previous user's identity on every account switch.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        assertNull(cache.read("fb-uid-2"))
        assertNotNull(storage.getString(SessionCache.KEY_SESSION), "the other account's record must survive")
        assertNotNull(cache.read("fb-uid-1"), "and still be readable by its owner")
    }

    @Test
    fun `an unparseable record reads as a miss and is erased`() {
        listOf("not json at all", "{\"firebaseUid\": ", "[]", "42").forEach { garbage ->
            setup()
            storage.putString(SessionCache.KEY_SESSION, garbage)

            assertNull(cache.read("fb-uid-1"), "garbage ('$garbage') must read as a miss")
            assertNull(
                storage.getString(SessionCache.KEY_SESSION),
                "and must be ERASED — the test name said so while asserting nothing of the kind, " +
                    "so `[]` and `42` sat on disk being re-parsed on every launch",
            )
        }
    }

    @Test
    fun `a legacy three-key record is not readable`() {
        // Pre-I6 installs have the old shape on disk. It must read as a miss
        // rather than as a partially-understood identity — the next sign-in
        // rewrites it in the current format.
        storage.putString(SessionCache.LEGACY_KEY_FIREBASE_UID, "fb-uid-1")
        storage.putString(SessionCache.LEGACY_KEY_UNIQUE_ID, "10000005")
        storage.putString(SessionCache.LEGACY_KEY_COHORT, "adult")

        assertNull(cache.read("fb-uid-1"), "the superseded format must not be trusted")
    }

    // ── Clearing (AC: sign-out leaves nothing on disk) ────────────────────

    @Test
    fun `clear removes the session and leaves no field behind`() {
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.clear()

        assertNull(cache.read("fb-uid-1"), "a cleared session must not be readable")
        assertNull(storage.getString(SessionCache.KEY_SESSION), "no record may survive sign-out")
        // The pre-I6 three-key format. An upgrade over a populated cache must
        // not leave those behind — on iOS the Keychain outlives the app.
        assertNull(storage.getString(SessionCache.LEGACY_KEY_FIREBASE_UID))
        assertNull(storage.getString(SessionCache.LEGACY_KEY_UNIQUE_ID))
        assertNull(storage.getString(SessionCache.LEGACY_KEY_COHORT))
    }

    @Test
    fun `clear is safe to call when nothing is cached`() {
        // Sign-out runs on paths that never signed in (a failed restore, a
        // forced sign-out at launch). It must not throw.
        cache.clear()
        cache.clear()

        assertNull(cache.read("fb-uid-1"))
    }

    @Test
    fun `clear does not disturb the App-Lock credential sharing the same storage`() {
        // `SessionCache` and `AppLockRepositoryImpl` write to one SecureStorage
        // instance. A `storage.clear()` implementation would pass every test
        // above while destroying the user's PIN credential — turning sign-out
        // into "forget the device", and stranding the user at re-registration.
        val appLock = AppLockRepositoryImpl(storage)
        appLock.setCredential(uniqueId = "10000005", deviceId = "dev-1", localPinHash = "hash")
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.clear()

        assertEquals("10000005", appLock.storedUniqueId, "clearing the session must not clear the App-Lock credential")
        assertEquals("dev-1", appLock.storedDeviceId)
        assertEquals("hash", appLock.localPinHash)
    }
}

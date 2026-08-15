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
        assertNull(storage.getString(SessionCache.KEY_UNIQUE_ID), "nor may its fields linger in storage")
        assertNull(storage.getString(SessionCache.KEY_FIREBASE_UID))
        assertNull(storage.getString(SessionCache.KEY_COHORT))
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
            assertNull(storage.getString(SessionCache.KEY_COHORT), "nor may its cohort be published alone")

            setup()
            cache.write(firebaseUid = blank, uniqueId = "10000005", cohort = "adult")
            assertNull(cache.read(blank), "a blank firebaseUid ('$blank') must not be readable")
        }
    }

    @Test
    fun `a session whose fields are BLANKED underneath it reads as a miss`() {
        // Found by mutation: dropping the read-side blank guard left the suite
        // green, because `write` already refuses blanks so none ever reach
        // storage through the front door. The read guard exists for what `write`
        // cannot police — a value already on disk from another app version, a
        // half-finished migration, a Keychain item edited out of band. This
        // drives storage directly, which is the only way to reach that path.
        listOf("", "   ").forEach { blank ->
            listOf(SessionCache.KEY_FIREBASE_UID, SessionCache.KEY_UNIQUE_ID).forEach { key ->
                setup()
                cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
                assertNotNull(cache.read("fb-uid-1"), "precondition: the row must start out readable")

                storage.putString(key, blank)

                assertNull(
                    cache.read("fb-uid-1"),
                    "a blanked '$key' ('$blank') must read as a miss, not as a usable identity",
                )
            }
        }
    }

    @Test
    fun `a blank uid on disk cannot match a blank live uid`() {
        // The degenerate match: if both guards were dropped, a blanked stored
        // uid and a blank live uid would compare EQUAL and hand out the row.
        // Neither side may be allowed to reach the comparison.
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
        storage.putString(SessionCache.KEY_FIREBASE_UID, "")

        assertNull(cache.read(""), "blank must never equal blank here")
    }

    @Test
    fun `a session whose fields are removed underneath it reads as a miss`() {
        // Storage-level corruption: a partially-cleared keychain, an interrupted
        // migration, a user clearing app data on one platform only. Each field
        // is removed independently to prove no single survivor is enough.
        listOf(SessionCache.KEY_FIREBASE_UID, SessionCache.KEY_UNIQUE_ID).forEach { key ->
            setup()
            cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
            assertNotNull(cache.read("fb-uid-1"), "precondition: the row must start out readable")

            storage.remove(key)

            assertNull(cache.read("fb-uid-1"), "losing '$key' must read as a miss, not a partial identity")
        }

        // A lost cohort is survivable — the identity is still whole, and the
        // cohort is metadata. Asserted rather than left implied, so a future
        // change that starts routing on the cohort has to come here first.
        setup()
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")
        storage.remove(SessionCache.KEY_COHORT)
        val survivor = assertNotNull(cache.read("fb-uid-1"), "a lost cohort must not lose the identity")
        assertEquals("10000005", survivor.uniqueId)
        assertNull(survivor.cohort)
    }

    // ── Clearing (AC: sign-out leaves nothing on disk) ────────────────────

    @Test
    fun `clear removes the session and leaves no field behind`() {
        cache.write(firebaseUid = "fb-uid-1", uniqueId = "10000005", cohort = "adult")

        cache.clear()

        assertNull(cache.read("fb-uid-1"), "a cleared session must not be readable")
        assertNull(storage.getString(SessionCache.KEY_FIREBASE_UID), "no uniqueId or cohort may survive sign-out")
        assertNull(storage.getString(SessionCache.KEY_UNIQUE_ID))
        assertNull(storage.getString(SessionCache.KEY_COHORT))
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

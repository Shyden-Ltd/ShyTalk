package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0500 — on iPhone the launch decision ran before Firebase had restored
 * the persisted user.
 *
 * The iOS SDK loads its current user from the keychain asynchronously; the
 * Android SDK does it synchronously. So `MainViewController` read
 * `currentUser == null`, missed the identity cache (keyed by that uid), and
 * decided "sign-in first" for a signed-in person — the exact launch this story
 * removes, on one platform only (J40 on the iPhone, 2026-09-04: `immediate:
 * destination=SignIn` for a signed-in, cached identity).
 *
 * The fix is a wait for what the SDK PERSISTED — a keychain read, never the
 * network — before the immediate decision. Pinned at the source, next to the
 * SHY-0187 wiring pins.
 */
class IosColdStartWaitsForThePersistedSessionPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("settings.gradle.kts not found above ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "moved: $relative")
        return f.readText()
    }

    private val controller = "shared/src/iosMain/kotlin/com/shyden/shytalk/MainViewController.kt"
    private val iosRepo = "shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosAuthRepositoryImpl.kt"
    private val contract = "shared/src/commonMain/kotlin/com/shyden/shytalk/data/repository/AuthRepository.kt"

    private val androidRepo = "app/src/main/java/com/shyden/shytalk/data/repository/AuthRepositoryImpl.kt"

    @Test
    fun `the contract names the wait, so both platforms speak the same word`() {
        assertTrue(
            Regex("suspend fun awaitPersistedSession\\(\\)").containsMatchIn(read(contract)),
            "AuthRepository must declare awaitPersistedSession()",
        )
    }

    @Test
    fun `the contract has no silent default, so every platform must say how long its SDK takes`() {
        // A `{}` body on the interface let a platform that forgot the wait
        // compile and draw sign-in for a signed-in person (review, 2026-09-04).
        // Android's answer is a documented no-op — its SDK restores the user
        // synchronously — written where the compiler can see it is deliberate.
        assertFalse(
            Regex("suspend fun awaitPersistedSession\\(\\)\\s*\\{").containsMatchIn(read(contract)),
            "AuthRepository must not default awaitPersistedSession() to nothing",
        )
        assertTrue(
            read(androidRepo).contains("override suspend fun awaitPersistedSession()"),
            "the Android repository must state its (synchronous) answer explicitly",
        )
    }

    @Test
    fun `iOS waits on the SDK's auth-state flow, which is the keychain load and not the network`() {
        val src = read(iosRepo)
        assertTrue(
            src.contains("override suspend fun awaitPersistedSession()"),
            "IosAuthRepositoryImpl must override awaitPersistedSession()",
        )
        assertTrue(
            src.contains("authStateChanged"),
            "the iOS wait must be the SDK's own auth-state emission",
        )
        assertTrue(
            src.contains("withTimeoutOrNull"),
            "the wait must be bounded: a launch may never hang on it",
        )
    }

    @Test
    fun `a null emission is the SDK reporting no persisted user, not a timeout`() {
        // `first()` returns null on every signed-out start — that IS the report
        // arriving. Reading the emission's value as "did it arrive" logged a
        // timeout that never happened on every signed-out launch (review,
        // 2026-09-04). The timeout is told apart by what the bounded block
        // RETURNS, never by what the SDK emitted.
        val src = read(iosRepo)
        assertFalse(src.contains("restored == null"), "the emission's value must not stand in for whether it arrived")
        val wait = src.indexOf("withTimeoutOrNull(PERSISTED_SESSION_TIMEOUT_MS)")
        assertTrue(wait >= 0, "the wait must be the bounded one")
        val block = src.substring(wait, minOf(wait + 300, src.length))
        assertTrue(block.contains("auth.authStateChanged.first()"), "the block must still wait on the SDK's emission")
        assertTrue(block.contains("?: false"), "only the TIMEOUT may read as 'not reported'")
    }

    @Test
    fun `the iOS cold start waits BEFORE it reads the identity cache and decides`() {
        val src = read(controller)
        val wait = src.indexOf("awaitPersistedSession()")
        val cacheRead = src.indexOf("sessionCache.read(authRepo.currentFirebaseUid)")
        val decide = src.indexOf("sequencer.immediateDestination()")
        assertTrue(wait >= 0, "$controller must call awaitPersistedSession()")
        assertTrue(cacheRead >= 0 && decide >= 0, "the pin is not reading the cold-start block it expects")
        assertTrue(wait < cacheRead, "the wait must come before the cache read it makes possible")
        assertTrue(wait < decide, "the wait must come before the immediate decision")
    }
}

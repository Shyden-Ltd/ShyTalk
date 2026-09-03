package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
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

    @Test
    fun `the contract names the wait, so both platforms speak the same word`() {
        assertTrue(
            Regex("suspend fun awaitPersistedSession\\(\\)").containsMatchIn(read(contract)),
            "AuthRepository must declare awaitPersistedSession()",
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

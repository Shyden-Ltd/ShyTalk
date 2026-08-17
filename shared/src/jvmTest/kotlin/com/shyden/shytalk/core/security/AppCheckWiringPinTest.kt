package com.shyden.shytalk.core.security

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0300 — the App Check wiring, pinned PER PLATFORM in the same test.
 *
 * Every earlier single-platform pin on this epic turned out to be green
 * against the wrong file, so each assertion here iterates both platforms and
 * names the one that failed. A pin that checks Android and infers iOS is a pin
 * that ships iOS unattested.
 *
 * These read source off disk. `shared/build.gradle.kts` declares those paths
 * as `jvmTest` inputs — without that, Gradle treats jvmTest as up-to-date when
 * only the app-module or iosMain files change and skips the pin entirely,
 * reporting BUILD SUCCESSFUL having run nothing.
 */
class AppCheckWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root not found")
    }

    /** The two public-GET paths, one per platform. Both must attach the token. */
    private val publicGetSites =
        mapOf(
            "android" to "app/src/main/java/com/shyden/shytalk/data/remote/WorkerApiClient.kt",
            "ios" to "shared/src/iosMain/kotlin/com/shyden/shytalk/data/remote/IosApiClient.kt",
        )

    private fun sourceOf(rel: String): String {
        val f = File(repoRoot(), rel)
        assertTrue(f.exists(), "$rel is missing — the pin is reading a path that no longer exists")
        return f.readText()
    }

    /**
     * Lines that are neither comments nor imports.
     *
     * Comments are excluded because a KDoc mention is not a code reference
     * ([[feedback-comments-are-not-code-references]]). IMPORTS are excluded
     * because of a live near-miss: the first version of this pin asserted only
     * that `APP_CHECK_HEADER` appeared somewhere in the file, and deleting the
     * entire `header(APP_CHECK_HEADER, it)` call from IosApiClient left the
     * pin GREEN — it was matching `import …APP_CHECK_HEADER`. An import is a
     * declaration of availability, not of use
     * ([[feedback-substring-is-not-existence]]).
     */
    private fun codeLines(rel: String): List<String> =
        sourceOf(rel)
            .lines()
            .filterNot {
                val t = it.trimStart()
                t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")
            }

    @Test
    fun `both platforms attach the App Check header on the public GET path`() {
        publicGetSites.forEach { (platform, rel) ->
            val code = codeLines(rel)
            // `header(APP_CHECK_HEADER` — the CALL, not the name. Both
            // platforms spell the attach as `header(NAME, value)`.
            assertTrue(
                code.any { it.contains("header(APP_CHECK_HEADER") },
                "$platform ($rel) must attach APP_CHECK_HEADER on its public GET",
            )
            assertTrue(
                code.any { it.contains("appCheckTokenProvider.currentToken()") },
                "$platform ($rel) must obtain the token from AppCheckTokenProvider",
            )
        }
    }

    @Test
    fun `neither platform hardcodes the header name`() {
        // A literal on one side and the constant on the other is the drift
        // this constant exists to prevent, and it fails as a 401 for every
        // user of that platform once enforcement is on — which looks nothing
        // like a typo.
        publicGetSites.forEach { (platform, rel) ->
            val offenders =
                codeLines(rel).filter { it.contains("X-Firebase-AppCheck", ignoreCase = true) }
            assertEquals(
                emptyList(),
                offenders,
                "$platform ($rel) must use the APP_CHECK_HEADER constant, not the literal",
            )
        }
    }

    @Test
    fun `the header constant is defined once, in commonMain`() {
        val rel = "shared/src/commonMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.kt"
        assertTrue(
            sourceOf(rel).contains("""const val APP_CHECK_HEADER: String = "X-Firebase-AppCheck""""),
            "$rel must define the header both clients and the server agree on",
        )
    }

    @Test
    fun `the header matches what the SERVER reads`() {
        // The two halves of this story are in different languages and
        // different test suites; nothing else compares them. A mismatch is
        // silent until enforcement, then total.
        val server = sourceOf("express-api/src/middleware/app-check.js")
        val kotlin =
            sourceOf(
                "shared/src/commonMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.kt",
            )
        // requireNotNull, not assertTrue: it carries a contract, so the
        // comparison below sees non-null types. It also fails LOUDLY if the
        // regex stops matching — a pin that silently compares null to null
        // would pass forever.
        val serverHeader =
            requireNotNull(
                Regex("""APP_CHECK_HEADER\s*=\s*'([^']+)'""").find(server)?.groupValues?.get(1),
            ) { "could not read the server's header constant" }
        val clientHeader =
            requireNotNull(
                Regex("""APP_CHECK_HEADER:\s*String\s*=\s*"([^"]+)"""")
                    .find(kotlin)
                    ?.groupValues
                    ?.get(1),
            ) { "could not read the client's header constant" }

        assertEquals(
            serverHeader,
            clientHeader.lowercase(),
            "client and server disagree about the App Check header name",
        )
    }

    @Test
    fun `every platform provides an actual for the token provider`() {
        // An `expect` with a missing `actual` fails to compile, so the risk is
        // not absence — it is an actual that exists and does nothing. Each is
        // checked for the substance the platform needs.
        // codeLines, NOT the raw source. Both of these files DOCUMENT the very
        // thing being asserted in their KDoc, so a raw `contains` matches the
        // comment and passes with the code mutated away — which is exactly
        // what happened: flipping `getAppCheckToken(false)` to `(true)` left
        // this test green because the sentence above the call still said
        // `false` ([[feedback-comments-are-not-code-references]]).
        val android =
            codeLines(
                "shared/src/androidMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.android.kt",
            )
        assertTrue(
            android.any { it.contains("getAppCheckToken(false)") },
            "Android must request a CACHED token — `true` forces a refresh and puts " +
                "a Play Integrity round trip on the cold-start critical path",
        )

        // SHY-0306: the registration entry point must live in AppCheckBridge.kt,
        // NOT in AppCheckTokenProvider.ios.kt where it started. Kotlin/Native
        // names a file's top-level facade after the file, so a `.ios.kt` file
        // exports to Swift as `AppCheckTokenProvider_iosKt` — a name no caller
        // guesses, and AppDelegate called `AppCheckTokenProviderKt`. Every iOS
        // build failed with "type has no member". This pin previously asserted
        // the function was in the `.ios.kt` file, i.e. it encoded the broken
        // location as the contract.
        val iosBridge =
            codeLines(
                "shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckBridge.kt",
            )
        assertTrue(
            iosBridge.any { it.contains("fun registerAppCheckBridge(") },
            "iOS must expose a bridge for Swift to register — the Firebase iOS SDK has no KMP binding",
        )

        val iosActual =
            codeLines(
                "shared/src/iosMain/kotlin/com/shyden/shytalk/core/security/AppCheckTokenProvider.ios.kt",
            )
        assertTrue(
            iosActual.none { it.contains("fun registerAppCheckBridge(") },
            "registerAppCheckBridge must NOT live in a *.ios.kt file — its Swift facade would " +
                "become AppCheckTokenProvider_iosKt and AppDelegate could not call it (SHY-0306)",
        )
    }

    @Test
    fun `Android installs the provider before Koin starts`() {
        // The cold-start ban gate is the first unauthenticated call and it
        // runs before routing. Installing after it would mean the one request
        // attestation exists to protect goes out unattested, on every launch.
        val app = sourceOf("app/src/main/java/com/shyden/shytalk/ShyTalkApp.kt")
        val install = app.indexOf("AppCheckInstaller.install(")
        val koin = app.indexOf("startKoin {")
        assertTrue(install > -1, "ShyTalkApp must install App Check")
        assertTrue(koin > -1, "ShyTalkApp must start Koin")
        assertTrue(install < koin, "App Check must be installed BEFORE Koin starts")
    }

    /** AppDelegate.swift's code lines. Its doc comments quote the very calls
     * these assertions look for, so a raw `contains` matches the prose and
     * passes with the call deleted — which is exactly what happened twice
     * while writing this file. */
    private fun swiftCodeLines(): List<String> =
        File(repoRoot(), "iosApp/iosApp/AppDelegate.swift")
            .readLines()
            .filterNot {
                val t = it.trimStart()
                t.startsWith("//") || t.startsWith("///") || t.startsWith("*") || t.startsWith("/*")
            }

    @Test
    fun `iOS registers the bridge and installs a provider at launch`() {
        // The Kotlin `actual` returns null until Swift registers, and null is
        // fail-open — so an iOS build that never registers is not a crash, not
        // a test failure, and not visible anywhere. It just quietly ships
        // unattested. This is the only thing that would catch it before a
        // device run.
        val swift = swiftCodeLines()
        assertTrue(
            swift.any { it.contains("registerAppCheckBridge(") },
            "AppDelegate.swift must register the App Check bridge with Kotlin",
        )
        assertTrue(
            swift.any { it.contains("setAppCheckProviderFactory(") },
            "AppDelegate.swift must install an App Check provider factory",
        )
        assertTrue(
            swift.any { it.contains("AppCheckBridge") && it.contains("final class AppDelegate") },
            "AppDelegate must declare conformance to AppCheckBridge",
        )
    }

    @Test
    fun `iOS asks for a CACHED token, like Android`() {
        // Same critical-path rule as `getAppCheckToken(false)` on Android. The
        // two platforms express it differently, which is exactly how one of
        // them ends up forcing a refresh and nobody notices.
        assertTrue(
            swiftCodeLines().any { it.contains("token(forcingRefresh: false)") },
            "iOS must request a cached token — forcing a refresh puts an App Attest " +
                "round trip in front of the cold-start ban check",
        )
    }

    @Test
    fun `the iOS debug provider is compiled out of release builds`() {
        // `AppCheckDebugProviderFactory` mints a token for anyone holding the
        // debug secret. A runtime branch would leave the class in the binary;
        // `#if DEBUG` removes it.
        val swift = File(repoRoot(), "iosApp/iosApp/AppDelegate.swift").readText()
        val debugIdx = swift.indexOf("AppCheckDebugProviderFactory")
        assertTrue(debugIdx > -1, "the iOS debug provider must be declared somewhere")
        val guardIdx = swift.lastIndexOf("#if DEBUG", debugIdx)
        val endIdx = swift.indexOf("#endif", debugIdx)
        assertTrue(
            guardIdx in 0 until debugIdx && endIdx > debugIdx,
            "AppCheckDebugProviderFactory must sit inside a #if DEBUG block",
        )
    }

    @Test
    fun `the debug provider is confined to debug variants`() {
        // `firebase-appcheck-debug` mints a token for anyone holding the debug
        // secret. On a release classpath it defeats the control completely.
        val gradle = sourceOf("app/build.gradle.kts")
        val debugLines =
            gradle.lines().filter { it.contains("firebase.appcheck.debug") && !it.trimStart().startsWith("//") }
        assertTrue(debugLines.isNotEmpty(), "the debug App Check provider must be declared somewhere")
        assertTrue(
            debugLines.all { it.contains("debugImplementation") },
            "the debug provider must use debugImplementation, got: $debugLines",
        )
        // And the installer must not reference it directly, or release builds
        // would need it on the classpath to compile.
        val installer =
            sourceOf(
                "shared/src/androidMain/kotlin/com/shyden/shytalk/core/security/AppCheckInstaller.kt",
            )
        assertTrue(
            !installer.contains("import com.google.firebase.appcheck.debug"),
            "the installer must reach the debug provider reflectively, never by import",
        )
    }
}

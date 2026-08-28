package com.shyden.shytalk.core.push

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SHY-0244 — the manifest flag and the registration call path must agree.
 *
 * Firebase Messaging's two registration models are mutually exclusive and
 * chosen by a manifest flag. `FirebaseMessaging.register()` throws
 * `IllegalStateException` unless `firebase_messaging_installation_id_enabled`
 * is set, and `getToken()` throws when it IS set.
 *
 * So a mismatch between the manifest and the code is not a subtle
 * misbehaviour: it is a throw, on a user's device, at registration time. It
 * would not fail a build, would not fail a unit test that mocks Firebase, and
 * the first symptom is a user who never receives a notification.
 *
 * This is a source-and-manifest scan on purpose. Nothing is mocked, and no
 * Firebase runtime is needed, so it runs in the ordinary unit suite on every
 * PR — which is the point: the guard has to be somewhere that always runs.
 */
class PushRegistrationManifestGuardTest {
    private val repoRoot = File(System.getProperty("user.dir")!!).let { if (it.name == "app") it.parentFile!! else it }
    private val manifest = File(repoRoot, "app/src/main/AndroidManifest.xml")
    private val identifiers =
        File(repoRoot, "app/src/main/java/com/shyden/shytalk/core/push/AndroidPushIdentifiers.kt")

    @Test
    fun `the source files this guard reads actually exist`() {
        // Without this the whole guard would pass vacuously after a rename —
        // a scan of an empty string finds no violations.
        assertTrue("AndroidManifest.xml not found at ${manifest.path}", manifest.isFile)
        assertTrue("AndroidPushIdentifiers.kt not found at ${identifiers.path}", identifiers.isFile)
    }

    @Test
    fun `the app calls register(), so the manifest MUST enable installation IDs`() {
        // Anchored on a real CALL, not on the text ".register()" appearing
        // anywhere: that string also occurs inside this file's own error
        // message, so a loose match would keep passing after the call itself
        // was deleted -- a guard that cannot fail is not a guard.
        val callsRegister =
            identifiers
                .readLines()
                .map { it.substringBefore("//") }
                .filterNot { it.trimStart().startsWith("*") }
                .map { it.replace(Regex("\"[^\"]*\""), "") } // drop string literals
                .any { it.contains("FirebaseMessaging.getInstance().register()") }

        assertTrue(
            "AndroidPushIdentifiers no longer calls FirebaseMessaging.register(). If the app " +
                "moved back to the token model this guard must be updated deliberately, not " +
                "left passing by accident.",
            callsRegister,
        )

        val xml = manifest.readText().replace(Regex("<!--.*?-->", RegexOption.DOT_MATCHES_ALL), "")
        val declared =
            Regex(
                """<meta-data[^>]*android:name\s*=\s*"firebase_messaging_installation_id_enabled"[^>]*android:value\s*=\s*"([^"]*)"""",
                RegexOption.DOT_MATCHES_ALL,
            ).find(xml)?.groupValues?.get(1)

        assertTrue(
            "AndroidPushIdentifiers calls FirebaseMessaging.register(), which THROWS " +
                "IllegalStateException unless the manifest enables the installation-ID model. " +
                "Add this inside <application> in app/src/main/AndroidManifest.xml:\n" +
                "    <meta-data android:name=\"firebase_messaging_installation_id_enabled\" " +
                "android:value=\"true\" />\n" +
                "Found instead: ${declared ?: "no such meta-data at all"}",
            declared == "true",
        )
    }

    @Test
    fun `the deprecated token API is not called anywhere in the app`() {
        // getToken() throws once the flag is set, so a straggler call site is a
        // crash waiting for whichever screen reaches it first. It also fails
        // the build under -Werror, but only if something references it — a
        // string in a comment or a new file could reintroduce it quietly.
        val offenders =
            File(repoRoot, "app/src/main/java")
                .walkTopDown()
                .filter { it.isFile && it.extension == "kt" }
                .filter { file ->
                    file.readText().lines().any { line ->
                        !line.trimStart().startsWith("//") &&
                            !line.trimStart().startsWith("*") &&
                            (line.contains("getInstance().token") || line.contains(".deleteToken("))
                    }
                }.map { it.relativeTo(repoRoot).path }
                .toList()

        assertTrue(
            "These files still use the deprecated token API, which throws once " +
                "firebase_messaging_installation_id_enabled is set: $offenders",
            offenders.isEmpty(),
        )
    }
}

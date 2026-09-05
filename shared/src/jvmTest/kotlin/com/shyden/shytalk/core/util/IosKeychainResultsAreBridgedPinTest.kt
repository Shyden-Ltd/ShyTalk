package com.shyden.shytalk.core.util

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0500 — the iPhone never had a session record to draw from.
 *
 * `SecItemCopyMatching` hands back a CoreFoundation reference. Kotlin/Native
 * models that as a raw `CPointer`, so `pointer as? NSData` is a Kotlin class
 * check on the wrapper: it is never an NSData, and the cast is null on every
 * call. The compiler said exactly that (CAST_NEVER_SUCCEEDS) and the warning
 * was suppressed rather than heeded. Every Keychain read on iOS therefore
 * missed — the identity cache (`read: miss — no stored record` right after a
 * sign-in, J40 on the iPhone 2026-09-05), the App-Lock PIN (`Migration:
 * authenticated user without PIN` on every launch) — and the key-pair export
 * in CryptoKeyPair fell to the same cast on `SecKeyCopyExternalRepresentation`
 * and `SecKeyCreateSignature`.
 *
 * The bridge is `CFBridgingRelease`: it turns the +1 CF reference into the
 * Objective-C object it toll-free bridges to and gives the CF side back.
 * Pinned at the source because no JVM test can execute iosMain and the
 * simulator is retired here; the device proof is J40's
 * `immediate: destination=Main` on the iPhone.
 */
class IosKeychainResultsAreBridgedPinTest {
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

    private val secureStorage = "shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/SecureStorage.ios.kt"
    private val keyPair = "shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/CryptoKeyPair.ios.kt"

    @Test
    fun `the keychain read bridges the CF result before treating it as data`() {
        val src = read(secureStorage)
        assertTrue(
            src.contains("CFBridgingRelease(result.value) as? NSData"),
            "SecureStorage.ios.kt must bridge SecItemCopyMatching's result with CFBridgingRelease",
        )
        assertFalse(
            src.contains("CAST_NEVER_SUCCEEDS"),
            "SecureStorage.ios.kt silences a cast the compiler says never succeeds — that is the defect",
        )
    }

    @Test
    fun `a keychain read that fails for a reason other than absence says so`() {
        val src = read(secureStorage)
        assertTrue(src.contains("errSecItemNotFound"), "absence must be told apart from a failed read")
        assertTrue(
            Regex("""status != errSecSuccess[\s\S]{0,200}logW\(""").containsMatchIn(src),
            "a failed SecItemCopyMatching must be logged with its OSStatus, not read as a miss",
        )
    }

    @Test
    fun `a keychain write that fails says so`() {
        val src = read(secureStorage)
        assertTrue(
            Regex("""val \w+ = SecItemAdd\(""").containsMatchIn(src),
            "SecItemAdd's status must be kept, not discarded",
        )
        assertTrue(
            Regex("""SecItemAdd\([\s\S]{0,300}logW\(""").containsMatchIn(src),
            "a failed SecItemAdd must be logged with its OSStatus",
        )
    }

    @Test
    fun `the key pair bridges the Security framework results the same way`() {
        val src = read(keyPair)
        assertTrue(
            src.contains("CFBridgingRelease(SecKeyCopyExternalRepresentation("),
            "CryptoKeyPair.ios.kt must bridge the public-key export with CFBridgingRelease",
        )
        assertTrue(
            Regex("""CFBridgingRelease\(\s*SecKeyCreateSignature\(""").containsMatchIn(src),
            "CryptoKeyPair.ios.kt must bridge the signature with CFBridgingRelease",
        )
        assertFalse(
            src.contains("CAST_NEVER_SUCCEEDS"),
            "CryptoKeyPair.ios.kt silences a cast the compiler says never succeeds — that is the defect",
        )
    }

    @Test
    fun `no Security framework result is cast to NSData without the bridge`() {
        for (relative in listOf(secureStorage, keyPair)) {
            // Comments may describe the anti-pattern; only code is judged.
            val code = read(relative).replace(Regex("""/\*[\s\S]*?\*/"""), "").replace(Regex("""//.*"""), "")
            val collapsed = code.replace(Regex("""\s+"""), "")
            assertFalse(
                Regex("""(SecItemCopyMatching|SecKeyCopyExternalRepresentation|SecKeyCreateSignature)\([^)]*\)as\?NSData""")
                    .containsMatchIn(collapsed),
                "$relative casts a raw Security-framework result straight to NSData",
            )
            var at = collapsed.indexOf("as?NSData")
            assertTrue(at >= 0, "$relative no longer narrows to NSData at all — re-pin the bridge")
            while (at >= 0) {
                val before = collapsed.substring(maxOf(0, at - 200), at)
                assertTrue(before.contains("CFBridgingRelease("), "$relative: the `as? NSData` at offset $at is not bridged")
                at = collapsed.indexOf("as?NSData", at + 1)
            }
        }
    }

    @Test
    fun `the public-key export refuses a missing public key instead of handing NULL to Security`() {
        val src = read(keyPair)
        val start = src.indexOf("actual fun getPublicKeyBase64(): String? {")
        assertTrue(start >= 0, "CryptoKeyPair.ios.kt no longer defines getPublicKeyBase64 — re-pin")
        val body = src.substring(start, src.indexOf("\n    }\n", start))
        val copy = body.indexOf("SecKeyCopyPublicKey(privateKey)")
        val export = body.indexOf("SecKeyCopyExternalRepresentation(publicKey")
        assertTrue(copy >= 0 && export > copy, "getPublicKeyBase64 must copy the public key before exporting it")
        val guard = body.indexOf("if (publicKey == null)")
        assertTrue(
            guard in (copy + 1) until export,
            "SecKeyCopyPublicKey can return NULL: getPublicKeyBase64 must return null before " +
                "SecKeyCopyExternalRepresentation is handed the missing key",
        )
        val released = body.indexOf("CFRelease(privateKey)", guard)
        assertTrue(released in (guard + 1) until export, "the early return must release the private key it copied")
    }
}

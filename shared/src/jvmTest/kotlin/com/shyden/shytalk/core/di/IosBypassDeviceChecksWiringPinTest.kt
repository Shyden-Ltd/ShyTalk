package com.shyden.shytalk.core.di

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Source pin for the SHY-0151 iOS device-check enforcement wiring.
 *
 * The pure-logic layers are unit-covered (BuildVariantTest for the flag
 * storage/getter; AppEnvironmentTests for the per-variant Swift mapping),
 * but the CROSS-LANGUAGE DI wiring that actually delivered the bug — the
 * `iOSApp.swift` → `doInitKoin(bypassDeviceChecks:)` → Koin
 * `named("bypassDeviceChecks")` chain — has no `iosTest` source set to
 * cover it (none exists in this repo). This host-JVM pin reads the real
 * source files and fails if either end regresses to a hardcoded value —
 * the exact failure mode SHY-0151 fixed (IosPlatformModule hardcoded the
 * bypass to `true` for every iOS build, TestFlight included).
 *
 * A dropped argument fails SAFE (Kotlin default is `false` = enforce),
 * but a hardcoded `true` fails EXACTLY like the original bug, silently —
 * so that specific string is what this pin forbids.
 */
class IosBypassDeviceChecksWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root (settings.gradle.kts) not found from ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "expected source file to exist: $relative")
        return f.readText()
    }

    @Test
    fun `iOS DI binds the bypass flag to BuildVariant, never a hardcoded literal`() {
        val di = read("shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt")
        // The binding must resolve from BuildVariant (variant-driven, fail-closed).
        assertTrue(
            Regex("""single\(named\("bypassDeviceChecks"\)\)\s*\{\s*BuildVariant\.bypassDeviceChecks\s*\}""")
                .containsMatchIn(di),
            "IosPlatformModule must bind named(\"bypassDeviceChecks\") to BuildVariant.bypassDeviceChecks",
        )
        // The original bug: a hardcoded `{ true }` for this qualifier. Forbid it.
        assertFalse(
            Regex("""named\("bypassDeviceChecks"\)\)\s*\{\s*true\s*\}""").containsMatchIn(di),
            "IosPlatformModule must NOT hardcode named(\"bypassDeviceChecks\") to `true` " +
                "(the SHY-0151 regression: every iOS build, TestFlight included, would skip " +
                "SHY-0170 device-lock + SHY-0149 ban checks)",
        )
    }

    @Test
    fun `Swift boot passes the resolved bypass flag into doInitKoin, never a hardcoded literal`() {
        val app = read("iosApp/iosApp/iOSApp.swift")
        assertTrue(
            Regex("""bypassDeviceChecks:\s*env\.bypassDeviceChecks""").containsMatchIn(app),
            "iOSApp.swift must forward env.bypassDeviceChecks into doInitKoin",
        )
        assertFalse(
            Regex("""bypassDeviceChecks:\s*(true|false)\b""").containsMatchIn(app),
            "iOSApp.swift must NOT hardcode the bypassDeviceChecks argument — it must come " +
                "from AppEnvironment.resolve so .dev/.release enforce and only .local bypasses",
        )
    }
}

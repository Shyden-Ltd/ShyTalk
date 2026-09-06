package com.shyden.shytalk.core.di

import com.shyden.shytalk.testsupport.RepoSource.read
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Source pin for SHY-0526: iOS Debug configurations bypass the auth-stage
 * device checks the way Android's `buildTypes.debug` does, and Release
 * configurations never can.
 *
 * The runtime side is unit-tested in `AppEnvironmentTests` (the resolve rule
 * for every variant × `isDebugBuild`, and `isDebugBuild == true` under the
 * test build's DEBUG condition). What a Swift test cannot prove is the
 * Release side, because a test bundle never runs under a Release
 * configuration. This host-JVM pin reads `project.pbxproj` and fails if any
 * `Release*` build configuration defines the `DEBUG` compilation condition,
 * the one thing that would make `isDebugBuild` true in a distributable build.
 * It also pins the two source anchors: the flag is derived from `#if DEBUG`,
 * and the boot code passes it through unchanged.
 */
class IosDebugBuildBypassPinTest {
    @Test
    fun `isDebugBuild is derived from the DEBUG compilation condition`() {
        val env = read("iosApp/iosApp/AppEnvironment.swift")
        assertTrue(
            Regex("""static var isDebugBuild: Bool \{\s*#if DEBUG\s*return true\s*#else\s*return false\s*#endif\s*\}""")
                .containsMatchIn(env),
            "AppEnvironment.isDebugBuild must be `#if DEBUG` → true, else false",
        )
    }

    @Test
    fun `Swift boot passes isDebugBuild through, never a literal`() {
        val boot = read("iosApp/iosApp/iOSApp.swift")
        assertTrue(
            Regex(
                """AppEnvironment\.resolve\(\s*variant: variant,\s*personasPassword: personasPassword,\s*""" +
                    """isDebugBuild: AppEnvironment\.isDebugBuild\s*\)""",
            ).containsMatchIn(boot),
            "iOSApp.swift must call resolve(variant:personasPassword:isDebugBuild: AppEnvironment.isDebugBuild)",
        )
        assertFalse(
            Regex("""isDebugBuild:\s*(true|false)""").containsMatchIn(boot),
            "no literal isDebugBuild at the boot call site",
        )
    }

    @Test
    fun `no Release build configuration defines DEBUG, and Debug-Dev does`() {
        val pbxproj = read("iosApp/iosApp.xcodeproj/project.pbxproj")
        // `buildSettings = {` occurs only inside XCBuildConfiguration objects; an xcconfig-backed
        // configuration carries a `baseConfigurationReference` line before it, so the parse is
        // anchored on the settings block itself and proven complete against the `isa` count.
        val configurationCount = Regex("""isa = XCBuildConfiguration;""").findAll(pbxproj).count()
        val blocks =
            Regex(
                """buildSettings = \{(.*?)\};\s*name = "?([^";]+)"?;""",
                RegexOption.DOT_MATCHES_ALL,
            ).findAll(pbxproj).map { it.groupValues[2] to it.groupValues[1] }.toList()
        assertTrue(configurationCount >= 10, "anchor: expected at least 10 XCBuildConfiguration objects, found $configurationCount")
        assertEquals(configurationCount, blocks.size, "anchor: every XCBuildConfiguration block must parse")
        assertTrue(blocks.any { (name, _) -> name.startsWith("Release") }, "anchor: at least one Release* configuration parsed")

        val debugCondition = Regex("""SWIFT_ACTIVE_COMPILATION_CONDITIONS = "?[^";]*\bDEBUG\b""")
        val releaseWithDebug = blocks.filter { (name, settings) -> name.startsWith("Release") && debugCondition.containsMatchIn(settings) }
        assertEquals(
            emptyList<String>(),
            releaseWithDebug.map { it.first },
            "Release* configurations must never define DEBUG: that would ship the device-check bypass",
        )
        assertTrue(
            blocks.any { (name, settings) -> name == "Debug-Dev" && debugCondition.containsMatchIn(settings) },
            "anchor: Debug-Dev must define DEBUG (the runner's real-iPhone configuration)",
        )
    }
}

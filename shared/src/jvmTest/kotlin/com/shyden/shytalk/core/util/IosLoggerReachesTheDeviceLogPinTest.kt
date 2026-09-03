package com.shyden.shytalk.core.util

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0500 — "which launch path was taken, and why, is visible in a device
 * log without attaching a debugger."
 *
 * On iPhone that was not true. The iOS logger wrote to stdout, which only a
 * debugger or `devicectl --console` can see: a full device syslog capture
 * across a launch held 35,833 lines and not one from ColdStartSequencer
 * (2026-09-04). NSLog goes through the unified log, which `idevicesyslog`
 * streams over USB with nothing attached — the same route the Swift side
 * already uses.
 *
 * Pinned at the source, the way the platform wiring pins are: a swap back to
 * println would compile, run, and leave the phone silent again.
 */
class IosLoggerReachesTheDeviceLogPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("settings.gradle.kts not found above ${System.getProperty("user.dir")}")
    }

    private val source: String by lazy {
        val f = File(repoRoot(), "shared/src/iosMain/kotlin/com/shyden/shytalk/core/util/Logger.ios.kt")
        assertTrue(f.exists(), "the iOS logger has moved: ${f.path}")
        f.readText()
    }

    @Test
    fun `the iOS logger still declares every level, so the pin is reading the real file`() {
        val levels = listOf("logD", "logI", "logW", "logE", "logF")
        val declared = levels.filter { Regex("actual fun $it\\(").containsMatchIn(source) }
        assertEquals(levels, declared, "Logger.ios.kt no longer declares every level")
    }

    @Test
    fun `every level reaches the unified log through NSLog, never stdout`() {
        assertTrue(source.contains("import platform.Foundation.NSLog"), "Logger.ios.kt must import NSLog")
        assertTrue(Regex("NSLog\\(").containsMatchIn(source), "Logger.ios.kt must log through NSLog")
        assertFalse(
            Regex("\\bprintln\\(").containsMatchIn(source),
            "Logger.ios.kt writes to stdout, which no device log carries — use NSLog",
        )
    }

    @Test
    fun `every level goes through one sink the Swift app can point at the unified log`() {
        // NSLog reaches the device log, but its message arrives REDACTED as
        // <private> (3,688 lines from the app on 2026-09-04, every message a
        // <private>). os_log with a %{public} format is what shows the words,
        // and only Swift can call os_log -- so the Kotlin side owns a sink and
        // the Swift app installs the public writer into it at startup.
        assertTrue(source.contains("object IosLogSink"), "Logger.ios.kt must declare IosLogSink")
        assertTrue(
            Regex("var write: \\(String\\) -> Unit").containsMatchIn(source),
            "IosLogSink must expose a replaceable `write` so Swift can install os_log",
        )
        assertTrue(source.contains("IosLogSink.write(line)"), "emit must hand every line to the sink")
        val levels = source.split("actual fun ").drop(1)
        assertEquals(5, levels.size, "the pin must be reading five level implementations")
        levels.forEach { body ->
            assertTrue(body.contains("emit("), "a level bypasses the sink:\n${body.take(120)}")
        }
    }

    @Test
    fun `the Swift app installs a PUBLIC os_log writer, so the words are readable on the device log`() {
        val swift = File(repoRoot(), "iosApp/iosApp/iOSApp.swift")
        assertTrue(swift.exists(), "the app entry point has moved: ${swift.path}")
        val src = swift.readText()
        assertTrue(src.contains("IosLogSink.shared.write"), "iOSApp.swift must install the log sink")
        assertTrue(src.contains("%{public}@"), "the installed writer must log with a %{public} format")
        assertTrue(Regex("os_log\\(").containsMatchIn(src), "the installed writer must be os_log")
    }

    @Test
    fun `a percent sign in a message is data, not a format directive`() {
        // NSLog takes a FORMAT. "50% done" through it unescaped is undefined
        // behaviour at best and a crash at worst, so the line is escaped first.
        assertTrue(
            source.contains("replace(\"%\", \"%%\")"),
            "Logger.ios.kt must escape % before handing a message to NSLog",
        )
    }
}

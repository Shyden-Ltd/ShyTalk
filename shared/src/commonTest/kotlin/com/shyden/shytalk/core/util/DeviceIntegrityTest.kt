package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0146 — every branch of the integrity decision, with the probes injected.
 *
 * The point of splitting the decision out of `iosMain` is exactly this: a
 * jailbroken iPhone is a device nobody has to hand, so the logic that decides
 * what to do with a jailbreak indicator must be testable without one.
 */
class DeviceIntegrityTest {
    private val noFiles: (String) -> Boolean = { false }
    private val noWrite: (String) -> Boolean = { false }
    private val cleanEnv = emptyMap<String, String>()

    // ── the clean device: the case that must never be blocked ──

    @Test
    fun `a stock device with no indicators is not unsafe`() {
        assertFalse(DeviceIntegrity.isUnsafe(noFiles, noWrite, cleanEnv))
    }

    @Test
    fun `a stock device is not blocked even with the gate enforced`() {
        assertFalse(
            DeviceIntegrity.isBlocked(
                bypassIntegrityGate = false,
                fileExists = noFiles,
                writeProbe = noWrite,
                env = cleanEnv,
            ),
        )
    }

    @Test
    fun `an ordinary unrelated file present does not trip the check`() {
        // Guards the zero-false-positive bar: only the listed artefacts count.
        val exists: (String) -> Boolean = { it == "/private/var/mobile/Library/Preferences" }
        assertFalse(DeviceIntegrity.isJailbroken(exists))
    }

    // ── jailbreak indicators ──

    @Test
    fun `every listed jailbreak path is detected on its own`() {
        // Each entry must matter by itself; a path that never fires is dead
        // weight pretending to be coverage.
        DeviceIntegrity.JAILBREAK_PATHS.forEach { path ->
            assertTrue(
                DeviceIntegrity.isJailbroken { it == path },
                "expected $path to be treated as a jailbreak indicator",
            )
        }
    }

    @Test
    fun `the jailbreak path list is non-empty — the check cannot be vacuous`() {
        assertTrue(DeviceIntegrity.JAILBREAK_PATHS.size >= 5)
    }

    @Test
    fun `writing outside the sandbox is unsafe`() {
        assertTrue(DeviceIntegrity.canEscapeSandbox { true })
        assertTrue(DeviceIntegrity.isUnsafe(noFiles, { true }, cleanEnv))
    }

    // ── simulator ──

    @Test
    fun `every simulator env key is detected on its own`() {
        DeviceIntegrity.SIMULATOR_ENV_KEYS.forEach { key ->
            assertTrue(
                DeviceIntegrity.isSimulator(mapOf(key to "iPhone 17 Pro")),
                "expected $key to identify the Simulator",
            )
        }
    }

    @Test
    fun `a blank simulator env value does not count`() {
        // An empty variable is not evidence of anything.
        assertFalse(DeviceIntegrity.isSimulator(mapOf("SIMULATOR_DEVICE_NAME" to "")))
        assertFalse(DeviceIntegrity.isSimulator(mapOf("SIMULATOR_DEVICE_NAME" to "   ")))
    }

    @Test
    fun `an unrelated env var does not identify the simulator`() {
        assertFalse(DeviceIntegrity.isSimulator(mapOf("HOME" to "/var/mobile")))
    }

    // ── the gate ──

    @Test
    fun `the bypass lets an unsafe device through`() {
        assertTrue(
            DeviceIntegrity
                .isBlocked(
                    bypassIntegrityGate = true,
                    fileExists = { true },
                    writeProbe = { true },
                    env = mapOf("SIMULATOR_DEVICE_NAME" to "iPhone 17 Pro"),
                ).not(),
        )
    }

    @Test
    fun `with the gate enforced an unsafe device is blocked`() {
        assertTrue(
            DeviceIntegrity.isBlocked(
                bypassIntegrityGate = false,
                fileExists = { it == "/Applications/Cydia.app" },
                writeProbe = noWrite,
                env = cleanEnv,
            ),
        )
    }

    @Test
    fun `the simulator is blocked when the gate is enforced — Android parity`() {
        assertTrue(
            DeviceIntegrity.isBlocked(
                bypassIntegrityGate = false,
                fileExists = noFiles,
                writeProbe = noWrite,
                env = mapOf("SIMULATOR_UDID" to "34ABECC1-37A6-44F0-BECB-4891D292315A"),
            ),
        )
    }
}

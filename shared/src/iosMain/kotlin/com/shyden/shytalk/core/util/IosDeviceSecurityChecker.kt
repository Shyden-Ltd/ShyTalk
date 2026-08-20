@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.BuildVariant
import platform.Foundation.NSFileManager
import platform.Foundation.NSProcessInfo

/**
 * SHY-0146 — the iOS half of the pre-auth device-integrity gate: the real
 * probes. Every decision lives in [DeviceIntegrity] (commonMain) so it can be
 * unit-tested without a jailbroken phone.
 *
 * Android parity: `DeviceSecurityChecker` + `UnsafeDeviceGate`, applied at
 * `MainActivity` before the route decision.
 */
object IosDeviceSecurityChecker {
    /**
     * Every probe is LENIENT on error. A filesystem call that throws means "no
     * indicator", never "unsafe" — a transient error must not block a
     * legitimate device, which is how Android treats a check error and what the
     * zero-false-positive bar requires.
     */
    private inline fun lenient(probe: () -> Boolean): Boolean =
        try {
            probe()
        } catch (e: Throwable) {
            logI("IosDeviceSecurityChecker", "integrity probe failed, treating as clean: ${e.message}")
            false
        }

    private fun fileExists(path: String): Boolean = lenient { NSFileManager.defaultManager.fileExistsAtPath(path) }

    /**
     * Attempts a write OUTSIDE the app sandbox and cleans up after itself. A
     * sandboxed app cannot do this; a jailbroken one can. The file is removed
     * whether or not the write succeeded, so a repeat run cannot see its own
     * leftovers and report a false positive.
     */
    private fun canWriteOutsideSandbox(path: String): Boolean =
        lenient {
            // createFileAtPath returns false rather than throwing when the
            // sandbox denies it, which is the normal path on a stock device.
            val wrote = NSFileManager.defaultManager.createFileAtPath(path, contents = null, attributes = null)
            if (wrote) {
                lenient { NSFileManager.defaultManager.removeItemAtPath(path, null) }
            }
            wrote
        }

    private fun environment(): Map<String, String> =
        lenientMap {
            NSProcessInfo.processInfo.environment
                .entries
                .mapNotNull { (k, v) ->
                    val key = k as? String ?: return@mapNotNull null
                    val value = v as? String ?: return@mapNotNull null
                    key to value
                }.toMap()
        }

    private inline fun lenientMap(block: () -> Map<String, String>): Map<String, String> =
        try {
            block()
        } catch (e: Throwable) {
            logI("IosDeviceSecurityChecker", "environment probe failed, treating as clean: ${e.message}")
            emptyMap()
        }

    /** True when any integrity indicator is present. */
    fun isUnsafe(): Boolean =
        DeviceIntegrity.isUnsafe(
            fileExists = ::fileExists,
            writeProbe = ::canWriteOutsideSandbox,
            env = environment(),
        )

    /**
     * Should startup be blocked? Reads the build-flavour-resolved bypass, which
     * defaults to false (ENFORCE) so a build that never initialises it is gated
     * rather than waved through.
     */
    fun isBlocked(): Boolean =
        DeviceIntegrity.isBlocked(
            bypassIntegrityGate = BuildVariant.bypassIntegrityGate,
            fileExists = ::fileExists,
            writeProbe = ::canWriteOutsideSandbox,
            env = environment(),
        )
}

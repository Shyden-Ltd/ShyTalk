package com.shyden.shytalk.core.util

/**
 * SHY-0146 — the pure decision half of the pre-auth device-integrity gate.
 *
 * The PROBES (does this file exist? what is in the environment?) are
 * platform-specific and live in `iosMain`'s `IosDeviceSecurityChecker`. The
 * DECISION lives here, in `commonMain`, taking probe results as parameters — so
 * every branch is unit-testable on the JVM without a jailbroken phone, which is
 * a device nobody has to hand.
 *
 * Mirrors Android's `DeviceSecurityChecker` + `UnsafeDeviceGate` pair.
 */
object DeviceIntegrity {
    /**
     * Paths that do not exist on a stock iOS install. Deliberately CONSERVATIVE:
     * the story's bar is ZERO false positives, and a legitimate App Store user
     * wrongly blocked is far worse than a jailbroken one let through. Every
     * entry here is a jailbreak artefact, not merely an unusual file.
     */
    val JAILBREAK_PATHS: List<String> =
        listOf(
            "/Applications/Cydia.app",
            "/Applications/Sileo.app",
            "/Applications/Zebra.app",
            "/Library/MobileSubstrate/MobileSubstrate.dylib",
            "/Library/MobileSubstrate/DynamicLibraries",
            "/usr/sbin/sshd",
            "/usr/libexec/ssh-keysign",
            "/etc/apt",
            "/private/var/lib/apt",
            "/private/var/lib/cydia",
            "/private/var/stash",
            "/bin/bash",
            "/bin/sh",
        )

    /**
     * A path OUTSIDE the app sandbox. A sandboxed app cannot create this; a
     * jailbroken one can. Probed by attempting a write, never by reading.
     */
    const val SANDBOX_ESCAPE_PROBE_PATH: String = "/private/shytalk_sandbox_probe"

    /**
     * Environment keys the iOS Simulator sets and a real device never does.
     * `SIMULATOR_DEVICE_NAME` is the load-bearing one; the others are kept as
     * corroboration so a single renamed key cannot silently disable detection.
     */
    val SIMULATOR_ENV_KEYS: List<String> =
        listOf("SIMULATOR_DEVICE_NAME", "SIMULATOR_UDID", "SIMULATOR_ROOT", "SIMULATOR_MODEL_IDENTIFIER")

    /** True when any known jailbreak artefact is present. */
    fun isJailbroken(fileExists: (String) -> Boolean): Boolean = JAILBREAK_PATHS.any(fileExists)

    /** True when the app can write outside its sandbox — only possible jailbroken. */
    fun canEscapeSandbox(writeProbe: (String) -> Boolean): Boolean = writeProbe(SANDBOX_ESCAPE_PROBE_PATH)

    /** True when running on the iOS Simulator rather than a physical device. */
    fun isSimulator(env: Map<String, String>): Boolean = SIMULATOR_ENV_KEYS.any { env[it]?.isNotBlank() == true }

    /**
     * The full verdict. Any single positive indicator is enough — the indicator
     * set is conservative precisely so that OR-ing them is safe.
     */
    fun isUnsafe(
        fileExists: (String) -> Boolean,
        writeProbe: (String) -> Boolean,
        env: Map<String, String>,
    ): Boolean = isJailbroken(fileExists) || canEscapeSandbox(writeProbe) || isSimulator(env)

    /**
     * Should startup be blocked?
     *
     * Fail-CLOSED on the gate but LENIENT on probe errors: a probe that throws
     * is treated as "no indicator" by its caller, so a transient filesystem
     * error never blocks a legitimate device — matching how Android treats a
     * check error. The bypass is build-flavour-resolved
     * ([com.shyden.shytalk.core.BuildVariant.bypassIntegrityGate]), defaulting
     * to false so a platform that never initialises it gets ENFORCEMENT.
     */
    fun isBlocked(
        bypassIntegrityGate: Boolean,
        fileExists: (String) -> Boolean,
        writeProbe: (String) -> Boolean,
        env: Map<String, String>,
    ): Boolean {
        if (bypassIntegrityGate) return false
        return isUnsafe(fileExists, writeProbe, env)
    }
}

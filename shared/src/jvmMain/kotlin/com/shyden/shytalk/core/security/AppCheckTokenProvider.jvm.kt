package com.shyden.shytalk.core.security

/**
 * Host-JVM actual. There is no attestation on a desktop JVM — there is no app
 * install to attest — so this always reports "no token" and the server treats
 * such a caller exactly as it treats a device that could not attest.
 *
 * This is not a stub standing in for a real collaborator: on this platform
 * there is no collaborator, and "unavailable" is the honest answer rather than
 * a placeholder for one.
 */
actual class AppCheckTokenProvider {
    actual suspend fun currentToken(): String? = null
}

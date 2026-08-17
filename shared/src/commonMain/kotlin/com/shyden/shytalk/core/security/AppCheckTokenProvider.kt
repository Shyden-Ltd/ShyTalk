package com.shyden.shytalk.core.security

/**
 * Supplies the Firebase App Check token that attests this install is genuine
 * (SHY-0300).
 *
 * ## Why this returns null instead of throwing
 *
 * Attestation can fail for reasons that have nothing to do with the caller
 * being illegitimate: Play Integrity throttles on the free tier, App Attest is
 * unsupported below iOS 14, the device may be offline, and Google has
 * incidents. On the cold-start path this provider feeds, the alternative to
 * "no token" is "the user cannot open the app" — and locking a legitimate user
 * out of their own app because a third party is having a bad minute is worse
 * than the abuse attestation prevents.
 *
 * So every failure is a `null`, logged, and the request goes out unattested.
 * The SERVER decides what that means, and during the monitor phase it means
 * nothing at all. The refusal is the server's call to make because only the
 * server can be reconfigured without shipping a release.
 *
 * ## Why it is not on the critical path
 *
 * [currentToken] must never block the cold start waiting for attestation.
 * Implementations return whatever token is already cached and refresh in the
 * background; a cold start that has not obtained one yet sends none, which is
 * exactly the fail-open case above.
 */
expect class AppCheckTokenProvider {
    /**
     * The current App Check token, or null when one is not available for any
     * reason. Never throws.
     */
    suspend fun currentToken(): String?
}

/**
 * The header both platforms' public-GET paths attach the token to, and the one
 * `express-api/src/middleware/app-check.js` reads. Defined once in commonMain
 * so the two clients cannot drift from each other or from the server — a
 * mismatched header spells "missing" on the server, which during enforcement
 * is a 401 for every user of that platform and looks nothing like a typo.
 */
const val APP_CHECK_HEADER: String = "X-Firebase-AppCheck"

package com.shyden.shytalk.navigation

import com.shyden.shytalk.data.repository.BanStatus

/**
 * SHY-0143 — the cold-start startup sequence, with its two security gates in
 * the right ORDER.
 *
 * [resolveColdStartDestination] decides correctly given the facts. This decides
 * *when the facts are obtained*, which is where the real defect lived: the ban
 * checks were not missing, they ran on the sign-in path, too late to affect a
 * cold start that never signs in.
 *
 * Two orderings carry the security, and both are enforced here rather than by
 * convention:
 *
 *  1. **[checkBans] → route decision.** A ban learned after routing is a ban
 *     that already admitted the user to the room list.
 *  2. **[refreshToken] → [startCohortScopedReads].** A restored session's token
 *     carries LAST session's cohort claim. Firing a cohort-scoped read before
 *     `getIdToken(forceRefresh = true)` returns is the SHY-0132/0137
 *     cross-cohort leak. The refresh is the cheap primitive that re-reads
 *     custom claims; the full `pm-lock-check` reconcile stays a background
 *     concern and must NOT gate the shell.
 *
 * Collaborators are injected as functions, not interfaces, for one reason: the
 * thing worth testing is the sequence, and a function is the smallest surface
 * that lets a test observe it. Everything here is platform-free so Android and
 * iOS run the identical sequence.
 */
class ColdStartSequencer(
    private val checkBans: suspend () -> BanState,
    private val refreshToken: suspend () -> Boolean,
    /**
     * Whether the platform still holds a signed-in user, asked only AFTER a
     * failed [refreshToken].
     *
     * This is the signal that separates "the token was revoked" from "we could
     * not reach the network". Firebase clears its local `currentUser` when a
     * refresh token is genuinely revoked, so a session that is still alive
     * after a failed refresh failed for transport reasons. Classifying on the
     * error itself was the alternative and it is worse: `firebaseCall` maps
     * every exception to `Resource.Error`, and matching exception type names
     * across two platforms is exactly the stringly-typed contract that drifts.
     */
    private val isSessionAlive: () -> Boolean,
    private val startCohortScopedReads: () -> Unit,
    private val signOut: suspend () -> Unit,
    private val launchState: () -> LaunchState,
) {
    /**
     * The ban facts from the most recent [run], for the screen that renders
     * them.
     *
     * `BanScreen` takes `(banType, reason, expiresAt)`. A sequencer that
     * returned only *which* screen would force the ban destination to render a
     * bare "you are banned" — and a user caught by an IP/subnet/ASN rule they
     * did not cause would have no idea whether it lasts an hour or forever, or
     * how to appeal. A correct gate that cannot explain itself is an unusable
     * one.
     *
     * Read-only to callers, and only ever written by [run].
     */
    var lastBan: BanState = BanState()
        private set

    /**
     * Whether the cohort claim in the current token was CONFIRMED fresh.
     *
     * The nav graphs gate their user-flag subscription on this, and that is not
     * belt-and-braces: returning a non-`Main` destination does not stop the
     * graph mounting, and both graphs subscribe to `users/<id>` the instant
     * they compose. So "the sequencer returned early" and "nothing reads" were
     * two different claims, and only the first was true. False unless a refresh
     * actually completed — a ban, a Lock start, or an unverifiable refresh all
     * leave it false.
     */
    var cohortVerified: Boolean = false
        private set

    /**
     * Runs the sequence and returns the destination to start at.
     *
     * Deliberately returns the destination rather than navigating: routing is
     * the caller's job on each platform, and keeping the decision returnable is
     * what makes the whole sequence testable without a UI.
     */
    suspend fun run(): Screen {
        // GATE 1 — bans, before anything else can observe or render state.
        val bans = checkBans()
        lastBan = bans
        val state = launchState()
        val destination =
            resolveColdStartDestination(
                deviceBanned = bans.deviceBanned,
                networkBanned = bans.networkBanned,
                hasStoredCredential = state.hasStoredCredential,
                isAppLockEnabled = state.isAppLockEnabled,
                isLockRequired = state.isLockRequired,
                isAuthenticated = state.isAuthenticated,
                hasResolvedUser = state.hasResolvedUser,
            )

        // Anything that is not Main renders no cohort-scoped data, so there is
        // nothing to gate and no token worth refreshing. Returning early keeps
        // a banned start from touching the network at all.
        if (destination != Screen.Main) return destination

        // GATE 2 — the cohort claim must be CURRENT before a single
        // cohort-scoped read is issued.
        if (refreshToken()) {
            cohortVerified = true
            startCohortScopedReads()
            return Screen.Main
        }

        // The refresh failed, and WHY decides everything.
        if (!isSessionAlive()) {
            // Firebase dropped the local user, so the refresh token really is
            // expired or revoked. The claim can never be confirmed and the
            // session is already gone; signing out makes that explicit.
            signOut()
            return Screen.SignIn
        }

        // The session survives, so the failure was transport — offline, a
        // timeout, a blip. Signing out here is what turned "rotate the phone in
        // airplane mode" into "you are logged out". Render the shell, leave the
        // session alone, and issue nothing: `cohortVerified` stays false, so the
        // graphs hold their cohort-scoped subscription until a later refresh
        // confirms the claim.
        return Screen.Main
    }
}

/**
 * The outcome of the pre-routing ban check.
 *
 * Two booleans rather than an enum with a `NONE` member: the two bans are
 * independent facts that can both be true, and modelling them as mutually
 * exclusive is what would let one silently mask the other.
 */
data class BanState(
    val deviceBanned: Boolean = false,
    val networkBanned: Boolean = false,
    /** Operator-supplied explanation, surfaced verbatim on the ban screen. */
    val reason: String? = null,
    /** ISO-8601 expiry, or null for a permanent ban. */
    val expiresAt: String? = null,
)

/**
 * The already-known repository facts [resolveLaunchDestination] needs.
 *
 * Grouped into one value so the sequencer reads them at a single, explicit
 * point in the sequence rather than sampling each one wherever it happens to
 * be needed — a routing decision assembled from facts read at different
 * instants is a decision no test can pin.
 */
data class LaunchState(
    val hasStoredCredential: Boolean,
    val isAppLockEnabled: Boolean,
    val isLockRequired: Boolean,
    val isAuthenticated: Boolean,
    val hasResolvedUser: Boolean,
)

/**
 * Maps the server's [BanStatus] onto the cold-start [BanState].
 *
 * The classification rule is not new — `AuthViewModel.checkAndApplyBan()`
 * already treats `banType == "device"` as a device ban and everything else as
 * network. It lives here so both call sites share one definition rather than
 * drifting into disagreeing about what a ban means.
 *
 * **Fails closed on purpose.** An unrecognised or absent `banType` on a banned
 * status maps to a NETWORK ban, not to "no ban". A future server-side ban type
 * this client has never heard of must still block; mapping the unknown to
 * "allowed" would turn a new ban category into a silent bypass, which is the
 * exact class of hole this story exists to close.
 *
 * `isBanned` is authoritative: a lifted ban can still carry its old `banType`,
 * and reading the type without the flag would lock out a user whose ban was
 * just removed.
 */
fun BanStatus.toBanState(): BanState =
    when {
        !isBanned -> BanState()

        banType == "device" ->
            BanState(deviceBanned = true, reason = reason, expiresAt = expiresAt)

        else ->
            BanState(networkBanned = true, reason = reason, expiresAt = expiresAt)
    }

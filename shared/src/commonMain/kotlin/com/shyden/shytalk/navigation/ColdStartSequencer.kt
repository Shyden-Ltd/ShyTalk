package com.shyden.shytalk.navigation

import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.data.repository.BanStatus
import kotlinx.coroutines.CancellationException

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
     * Its ONE consumer is the background cohort reconcile: reconciling makes
     * sense only when the claim was confirmed fresh, because the reconcile's
     * whole job is to act on a claim it can trust.
     *
     * It briefly also gated the nav graphs' user-flag subscription. That was
     * wrong twice over — reading one's own user document is not a cross-cohort
     * read, so the cohort claim never gated it; and this is a one-shot value
     * written once per process, so on the App-Lock and sign-in paths it stayed
     * false forever and the suspension listener never subscribed at all. The
     * graphs key on `resolvedUniqueId` instead.
     *
     * False unless a refresh actually completed — a ban, a Lock start, or an
     * unverifiable refresh all leave it false.
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

        // SHY-0497: the inputs AND the verdict, on one line.
        //
        // The app has been seen on Home immediately after a sign-out that
        // completed cleanly (firebase user=null), and the activity is recreated
        // at that moment because it declares no configChanges. Which branch
        // below sends it to Main is the open question, and it cannot be
        // answered from the outside -- every one of these values is read here
        // and nowhere else.
        logD(
            COLD_START_TAG,
            "decision: destination=$destination deviceBanned=${bans.deviceBanned} " +
                "networkBanned=${bans.networkBanned} storedCredential=${state.hasStoredCredential} " +
                "appLock=${state.isAppLockEnabled} lockRequired=${state.isLockRequired} " +
                "authenticated=${state.isAuthenticated} resolvedUser=${state.hasResolvedUser}",
        )

        // Anything that is not Main renders no cohort-scoped data, so there is
        // nothing to gate and no token worth refreshing. Returning early keeps
        // a banned start from touching the network at all.
        if (destination != Screen.Main) return destination

        // GATE 2 — the cohort claim must be CURRENT before a single
        // cohort-scoped read is issued.
        if (refreshToken()) {
            logD(COLD_START_TAG, "token refreshed; staying on Main")
            cohortVerified = true
            startCohortScopedReads()
            return Screen.Main
        }

        // The refresh failed, and WHY decides everything.
        logD(COLD_START_TAG, "token refresh FAILED; sessionAlive=${isSessionAlive()}")
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
        // SHY-0497 candidate: this is the only path that returns Main without a
        // live auth confirmation, and it does so on purpose -- signing out on a
        // transport blip is what turned "rotate the phone in airplane mode"
        // into "you are logged out".
        logD(COLD_START_TAG, "refresh failed but session alive; rendering Main unverified")
        return Screen.Main
    }
}

private const val COLD_START_TAG = "ColdStartSequencer"

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

/**
 * The background cohort reconcile, for a cold start that reached Main
 * (SHY-0143, I5).
 *
 * [ColdStartSequencer]'s GATE 2 refreshes the ID token, which re-reads whatever
 * custom claim the server has already minted. It does NOT make the server
 * RECOMPUTE the cohort — that is `pm-lock-check`'s job, and it ran only on the
 * sign-in path. Post-SHY-0187 a returning user never signs in, so a user whose
 * birthday passed stayed in the minor cohort until they happened to sign in
 * again. In a minors-facing app that is a safety gap, not a staleness one.
 *
 * **Deliberately not part of [ColdStartSequencer.run].** The story requires
 * this to run AFTER the shell is shown, off the critical path — it is a
 * server-side recompute and can be slow. Callers LAUNCH it; nothing awaits it,
 * and nothing routes on it.
 *
 * Failure is non-fatal by design and matches the sign-in path's posture: a
 * reconcile that cannot reach the server is not evidence of anything. The
 * cohort claim already in the token continues to govern, and Firestore rules
 * remain the enforcement layer either way.
 *
 * @return true when a fresh claim was minted AND the token was rotated to pick
 *   it up — the only outcome in which the client's view of the cohort changed.
 */
suspend fun reconcileCohortInBackground(
    uniqueId: String,
    checkPmLock: suspend (String) -> Boolean,
    refreshToken: suspend () -> Boolean,
    log: (String) -> Unit = {},
): Boolean {
    if (uniqueId.isBlank()) {
        // Nothing to reconcile against. Reaching here with a blank id would
        // mean routing had already gone wrong.
        log("cohort reconcile skipped — no resolved uniqueId")
        return false
    }

    // The catch is deliberately broad. It used to name IllegalStateException
    // only, which is a shape the production lambdas cannot even produce — they
    // map `Resource` to `Boolean` — so it caught nothing real while a genuine
    // failure (any other exception, or anything at all from `refreshToken`)
    // escaped into `lifecycleScope.launch` on Android and `produceState` on
    // iOS. An uncaught coroutine exception there crashes the app, which is the
    // opposite of the "non-fatal by design" this function documents.
    //
    // CancellationException is deliberately NOT swallowed: it is structured
    // concurrency doing its job, not a reconcile failure.
    return try {
        if (!checkPmLock(uniqueId)) return false

        // The server minted a new claim, so the token in hand is stale by
        // exactly one cohort flip. Rotating it here is what closes the window
        // that would otherwise stay open until Firebase's ~1h auto-refresh.
        val rotated = refreshToken()
        if (!rotated) log("cohort claim minted but the token refresh failed (non-fatal)")
        rotated
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log("cohort reconcile failed (non-fatal): ${e.message}")
        false
    }
}

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
 * SHY-0500 draws the shell BEFORE [confirm] runs, so ordering 2 can no longer
 * ride on when the NavHost mounts. [ColdStartClaimGate] carries it instead:
 * [immediateDestination] engages the gate when it draws the room list, a
 * verdict from [confirm] settles it (a ban and a throw deliberately do not —
 * see [confirm]), and the cohort-scoped readers wait on it.
 *
 * Collaborators are injected as functions, not interfaces, for one reason: the
 * thing worth testing is the sequence, and a function is the smallest surface
 * that lets a test observe it. Everything here is platform-free so Android and
 * iOS run the identical sequence.
 */
class ColdStartSequencer(
    /**
     * SHY-0500 — engaged while the room list is drawn on an unconfirmed claim,
     * settled by a verdict from [confirm] (a ban and a throw keep it engaged —
     * see [confirm]). The cohort-scoped readers wait on the same instance,
     * which is why it comes from the caller rather than being made here.
     */
    private val claimGate: ColdStartClaimGate,
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
     * The ban facts from the most recent [confirm], for the screen that renders
     * them.
     *
     * `BanScreen` takes `(banType, reason, expiresAt)`. A sequencer that
     * returned only *which* screen would force the ban destination to render a
     * bare "you are banned" — and a user caught by an IP/subnet/ASN rule they
     * did not cause would have no idea whether it lasts an hour or forever, or
     * how to appeal. A correct gate that cannot explain itself is an unusable
     * one.
     *
     * Read-only to callers, and only ever written by [confirm].
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

    /** The destination chosen by [immediateDestination], for [confirm] to reason about. */
    private var drawnFirst: Screen? = null

    /**
     * The local facts [immediateDestination] routed on, kept so [confirm] can ask
     * the SAME shared resolver what those facts mean once the bans are known.
     *
     * Re-reading them would be the bug: a decision assembled from facts sampled at
     * two different instants is a decision no test can pin.
     */
    private var drawnFrom: LaunchState? = null

    /**
     * What to draw BEFORE anything is awaited. Performs no I/O whatsoever.
     *
     * SHY-0500. The old `run()` awaited a ban check and a token refresh — two network round
     * trips — before returning any destination, and nothing rendered until it
     * did. On a slow connection that is a spinner; on a dead one it is a spinner
     * for the length of a timeout. EPIC-0004 exists to remove exactly that, and
     * SHY-0143 reintroduced it in the act of securing the routing.
     *
     * The question "is there a session" is LOCAL — Firebase either holds a user
     * or it does not — so it is answered here, immediately, and drawn. Everything
     * that needs the network happens in [confirm], behind the screen the person
     * is already looking at.
     *
     * Deliberately excludes the ban inputs: they are not known yet, and waiting
     * for them is the thing being removed. [confirm] still enforces them, and a
     * shell rendered before the verdict shows none of the person's data because
     * cohort-scoped reads do not start until the claim is confirmed.
     *
     * Engages the [ColdStartClaimGate] when it draws the room list, and ONLY
     * [confirm] settles it — so a host must call [confirm] next, with no
     * suspension point in between (a cancelled launch between the two would
     * leave the gate engaged; `LaunchRedirectIsAOneShotPinTest` pins both
     * hosts). A new draw also supersedes an earlier one that never got to
     * confirm: the gate reflects what is on screen NOW, not a run that a
     * recreated host abandoned.
     */
    fun immediateDestination(): Screen {
        val state = launchState()
        val destination =
            resolveLaunchDestination(
                hasStoredCredential = state.hasStoredCredential,
                isAppLockEnabled = state.isAppLockEnabled,
                isLockRequired = state.isLockRequired,
                isAuthenticated = state.isAuthenticated,
                hasResolvedUser = state.hasResolvedUser,
            )
        drawnFirst = destination
        drawnFrom = state
        if (destination == Screen.Main) {
            // The room list is about to be drawn on LAST session's claim. Hold
            // its cohort-scoped reads until confirm() has refreshed it.
            claimGate.begin()
        } else {
            // Nothing cohort-scoped is drawn — and this draw supersedes any
            // earlier one that a torn-down host never got to confirm.
            claimGate.settle()
        }
        logD(COLD_START_TAG, "immediate: destination=$destination (no I/O)")
        return destination
    }

    /**
     * Confirms — over the network — the screen [immediateDestination] already
     * drew, and says whether it must change.
     *
     * The gate ORDER from SHY-0143 is unchanged and still carries the security:
     * bans are resolved before the session is touched, and the cohort claim is
     * refreshed before a single cohort-scoped read is issued.
     *
     * What changed is only WHEN the person sees something, not what is enforced.
     *
     * Settles the [ColdStartClaimGate] on a VERDICT that leaves something to
     * read with — a confirmed claim, a dead session (nothing left to read
     * with; the next sign-in mints a fresh claim), a transport failure (the
     * claim cannot be refreshed offline and the cached room list is all there
     * is). Two outcomes keep it engaged, and fail closed:
     *
     *  - a BAN: the room list drawn underneath must never read on the claim
     *    this confirmation did not refresh. The host settles the gate once the
     *    ban screen has replaced that room list (both hosts are pinned to do
     *    so after they navigate);
     *  - a THROW: there is no verdict at all. The exception propagates to the
     *    host, the reads stay held, and the next draw supersedes the gate
     *    ([immediateDestination] resets it). Releasing here would be a
     *    cohort-scoped read with no ban verdict on an unconfirmed claim.
     *
     * Requires [immediateDestination] to have run: there is nothing to confirm
     * before something was drawn, and guessing here would decide from facts
     * sampled at a different instant than the ones drawn on.
     */
    suspend fun confirm(): ColdStartConfirmation {
        val drawn =
            checkNotNull(drawnFirst) {
                "confirm() before immediateDestination(): nothing has been drawn to confirm"
            }
        val state =
            checkNotNull(drawnFrom) {
                "immediateDestination() drew $drawn without recording the facts it drew on"
            }
        val outcome = confirmDrawn(drawn, state)
        val banned = outcome is ColdStartConfirmation.Redirect && outcome.screen.isBanScreen()
        if (!banned) claimGate.settle()
        return outcome
    }

    private suspend fun confirmDrawn(
        drawn: Screen,
        state: LaunchState,
    ): ColdStartConfirmation {
        // GATE 1 — bans, before anything can observe or render the person's data.
        val bans = checkBans()
        lastBan = bans

        // Asked of the SHARED resolver rather than re-decided here, so "a ban
        // beats every other input" has exactly one definition and both platforms
        // still route through it.
        val withBans =
            resolveColdStartDestination(
                deviceBanned = bans.deviceBanned,
                networkBanned = bans.networkBanned,
                hasStoredCredential = state.hasStoredCredential,
                isAppLockEnabled = state.isAppLockEnabled,
                isLockRequired = state.isLockRequired,
                isAuthenticated = state.isAuthenticated,
                hasResolvedUser = state.hasResolvedUser,
            )
        if (withBans != drawn) {
            logD(COLD_START_TAG, "confirm: bans move $drawn -> $withBans")
            return ColdStartConfirmation.Redirect(withBans, null)
        }

        // Nothing to confirm for a start that was never heading to the room list:
        // no session to validate, and no cohort-scoped data to gate.
        if (drawn != Screen.Main) return ColdStartConfirmation.Stay

        // GATE 2 — the cohort claim must be CURRENT before any cohort-scoped read.
        if (refreshToken()) {
            logD(COLD_START_TAG, "confirmed: claim refreshed, reads starting")
            cohortVerified = true
            startCohortScopedReads()
            return ColdStartConfirmation.Stay
        }

        logD(COLD_START_TAG, "confirm: refresh FAILED; sessionAlive=${isSessionAlive()}")
        if (!isSessionAlive()) {
            // Firebase dropped the local user, so the refresh token really is
            // expired or revoked. Sign out and say why — SHY-0500 requires the
            // person be told to sign in again rather than silently deposited on
            // the sign-in screen.
            signOut()
            return ColdStartConfirmation.Redirect(Screen.SignIn, LaunchRedirectReason.SESSION_EXPIRED)
        }

        // The session survives, so the failure was transport. Signing out here is
        // what turned "rotate the phone in airplane mode" into "you are logged
        // out". Stay put, issue nothing: `cohortVerified` stays false.
        logD(COLD_START_TAG, "confirm: transport failure, staying unverified")
        return ColdStartConfirmation.Stay
    }
}

private const val COLD_START_TAG = "ColdStartSequencer"

/** The two destinations a ban verdict can name — the ONLY outcomes that keep the claim gate engaged. */
private fun Screen.isBanScreen(): Boolean = this == Screen.BanDevice || this == Screen.BanNetwork

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
 * **Deliberately not part of the cold-start sequence itself.** The story requires
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

/**
 * What [ColdStartSequencer.confirm] decided about the screen already drawn.
 *
 * A sealed type rather than a nullable [Screen] so "nothing changes" is a value
 * somebody has to handle, not an absence that is easy to forget.
 */
sealed interface ColdStartConfirmation {
    /** The screen already drawn was right. Leave it alone. */
    data object Stay : ColdStartConfirmation

    /**
     * Move to [screen]. [reason] is shown to the person when there is one —
     * a ban screen explains itself, a bounce to sign-in does not.
     */
    data class Redirect(
        val screen: Screen,
        val reason: LaunchRedirectReason?,
    ) : ColdStartConfirmation
}

/**
 * Why somebody was moved off the screen they were already looking at.
 *
 * An enum rather than a message: the copy belongs in the resource bundle where
 * it can be translated, and a reason code cannot arrive on screen untranslated.
 */
enum class LaunchRedirectReason {
    /** The stored session is expired or revoked — they must sign in again. */
    SESSION_EXPIRED,
}

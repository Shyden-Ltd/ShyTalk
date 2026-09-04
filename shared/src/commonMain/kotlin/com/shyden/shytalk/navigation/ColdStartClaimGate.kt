package com.shyden.shytalk.navigation

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first

/**
 * SHY-0500 — holds cohort-scoped reads while a restored session's claim
 * refresh is in flight.
 *
 * Before SHY-0500 the ordering "cohort claim refreshed BEFORE any cohort-scoped
 * read" was structural: the NavHost could not mount until
 * [ColdStartSequencer.run] returned, and the room list subscribes at mount. The
 * shell is drawn first now, so that ordering has to be carried by something
 * other than when the NavHost happens to mount. This is that something.
 *
 * The sequencer [begin]s the gate when it draws the room list from a stored
 * session, and a cohort-scoped reader calls [awaitSettled] before subscribing.
 * What [settle]s it, exactly:
 *
 *  - a STAY from the confirmation — the screen drawn was right. Its reads
 *    proceed on the refreshed claim, or, when the network could not be
 *    reached, on the cached room list (the claim cannot be refreshed offline;
 *    the same as before SHY-0500, and the background reconcile and the SDK's
 *    own refresh correct the claim once the network is back);
 *  - the HOST, after it has navigated on a REDIRECT — a ban, or a dead session
 *    just signed out. The room list drawn underneath stays mounted until then,
 *    and its reads must fire neither on a claim the confirmation did not
 *    refresh nor against a session that no longer exists; `popUpTo(0)` clears
 *    that room list and its ViewModel first, and the host settles afterwards
 *    so nothing is left waiting for a later sign-in;
 *  - the NEXT draw — [ColdStartSequencer.immediateDestination] resets the gate
 *    to whatever it is drawing now, so a launch that was cancelled or threw
 *    before it could settle cannot hold a later launch's room list.
 *
 * A THROW inside the confirmation leaves it engaged, on purpose: there is no
 * verdict, so there is nothing to release the reads on; the exception reaches
 * the host and the next draw supersedes the gate.
 *
 * Open at rest. A fresh sign-in, a PIN unlock and an offline launch never go
 * through [begin], so nothing they do waits here. That is the SHY-0024 lesson:
 * a once-per-process flag that stayed set after a normal sign-in is what turned
 * "gate the cold start" into "the room list never loads".
 *
 * One instance per process, provided by Koin, so the sequencer that begins it
 * and the ViewModel that waits on it are looking at the same gate.
 */
class ColdStartClaimGate {
    private val _refreshInFlight = MutableStateFlow(false)

    /** True between [begin] and [settle]; observable for tests and diagnostics. */
    val refreshInFlight: StateFlow<Boolean> = _refreshInFlight.asStateFlow()

    /** The room list is about to be drawn on a claim that is not yet confirmed. */
    fun begin() {
        _refreshInFlight.value = true
    }

    /**
     * The confirmation has returned, whatever it decided. Idempotent, and
     * harmless without a matching [begin], so the sequencer can call it from a
     * `finally` without first asking whether the gate was ever engaged.
     */
    fun settle() {
        _refreshInFlight.value = false
    }

    /** Returns at once when the gate is open; otherwise suspends until [settle]. */
    suspend fun awaitSettled() {
        refreshInFlight.first { inFlight -> !inFlight }
    }
}

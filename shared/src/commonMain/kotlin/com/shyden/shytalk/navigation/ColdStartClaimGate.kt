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
 *  - a CONFIRMED claim — the reads proceed on the refreshed claim;
 *  - a DEAD session — it has been signed out, there is no claim left to read
 *    with, and the next sign-in mints a fresh one;
 *  - a TRANSPORT failure — the claim cannot be refreshed offline, and the room
 *    list serves the cache it was authorised to fill last time (the same as
 *    before SHY-0500; the background reconcile and the SDK's own refresh
 *    correct the claim once the network is back);
 *  - the NEXT draw — [ColdStartSequencer.immediateDestination] resets the gate
 *    to whatever it is drawing now, so a launch that was cancelled or threw
 *    before it could settle cannot hold a later launch's room list.
 *
 * Two outcomes leave it engaged, on purpose. A BAN: the room list drawn
 * underneath must never read on the claim the confirmation did not refresh,
 * so the gate stays engaged until the host has navigated to the ban screen —
 * which pops that room list and its ViewModel — and settles it afterwards, so
 * nothing is left waiting for a later sign-in. A THROW inside the
 * confirmation: there is no verdict, so there is nothing to release the reads
 * on; the exception reaches the host and the next draw supersedes the gate.
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

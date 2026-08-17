package com.shyden.shytalk.core

/**
 * Runtime QA-context slots feeding the preview watermark (SHY-0205).
 *
 * Deliberately SEPARATE from [BuildVariant]: that object's contract is
 * "set once at boot, immutable snapshot", while these slots are
 * runtime-mutable by design — journey markers come and go as the
 * manual-qa-runner drives scenarios, the current route changes with
 * navigation, and server-health reports stream in on a poll. Keeping
 * them here preserves BuildVariant's immutability promise.
 *
 * Writers:
 * - [setCurrentRoute] — `SharedNavGraph`'s existing back-stack collector,
 *   preview builds only.
 * - [setJourneyMarker] — test channels (web `window.__journey_marker`
 *   equivalent for the apps arrives with SHY-0206's broadcast/deep-link
 *   channels; the slot + rendering land first so the channels are a
 *   pure producer change).
 * - [reportServerHealth] — the watermark's health poll
 *   (`AppConfigService.checkBackendHealth` every 30s on preview builds).
 *
 * Reader: `PreviewWatermark`'s 2s refresh tick. `@Volatile` gives the
 * same happens-before edge BuildVariant's holder relies on — writes land
 * on whatever thread the producer runs, reads happen on the Compose
 * frame, and a stale-by-one-tick value is harmless for a QA overlay.
 */
object QaContext {
    @kotlin.concurrent.Volatile
    var journeyMarker: String? = null
        private set

    @kotlin.concurrent.Volatile
    var currentRoute: String? = null
        private set

    @kotlin.concurrent.Volatile
    var serverSha: String? = null
        private set

    /** null = no health report yet; true/false = last completed poll's verdict. */
    @kotlin.concurrent.Volatile
    var serverOk: Boolean? = null
        private set

    /** Blank markers coerce to null so the watermark line hides cleanly. */
    fun setJourneyMarker(marker: String?) {
        journeyMarker = marker?.takeIf { it.isNotBlank() }
    }

    /** Blank routes coerce to null so the locale line stands alone. */
    fun setCurrentRoute(route: String?) {
        currentRoute = route?.takeIf { it.isNotBlank() }
    }

    /**
     * Records the latest completed health poll. A failed poll (or one
     * without a sha) RETAINS the last known [serverSha] — "which backend
     * did I last reach" stays diagnosable while the red dot signals the
     * current reachability — and always updates [serverOk].
     */
    fun reportServerHealth(
        sha: String?,
        ok: Boolean,
    ) {
        sha?.takeIf { it.isNotBlank() }?.let { serverSha = it }
        serverOk = ok
    }

    /** Test hygiene + sign-out-of-QA-mode hook: every slot back to unknown. */
    fun reset() {
        journeyMarker = null
        currentRoute = null
        serverSha = null
        serverOk = null
    }
}

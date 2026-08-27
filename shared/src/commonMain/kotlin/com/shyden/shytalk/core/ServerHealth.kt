package com.shyden.shytalk.core

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.BackendHealthStatus

/** Outcome of one completed health poll, as the watermark consumes it. */
data class ServerHealthVerdict(
    val sha: String?,
    val ok: Boolean,
)

/**
 * Maps a completed `AppConfigService.checkBackendHealth()` result onto
 * the watermark's server slots (SHY-0205).
 *
 * Both platform impls catch transport failures into a SUCCESS carrying
 * `status = "degraded"` (so their startup callers can branch on one
 * shape), which means "Resource.Success" is NOT the same as "backend
 * reachable" — only `status == "ok"` is. Anything else — degraded,
 * Error, a Loading that should never reach here — reads as a red dot,
 * so a stuck or misclassified poll can never fake green.
 *
 * This is also where the server's vocabulary for "I do not know my own
 * build" is translated into ours. See [SERVER_UNKNOWN_SHA].
 */
object ServerHealth {
    /**
     * What `/api/health` puts in the `sha` field when it cannot identify
     * its own build — no `DEPLOYED_SHA` env var and no `.deployed-sha`
     * file, which is the normal state of a local stack
     * (`express-api/src/index.js`, `resolveDeployedSha`).
     *
     * It has to be rejected explicitly rather than left to a
     * blank/null check, because it is a NON-empty string that is
     * exactly as long as the 7 characters `WatermarkFormat` allows a
     * short sha. It therefore survived truncation intact and rendered
     * as `api unknown` next to a GREEN health dot — a line whose two
     * halves appear to contradict each other, when in fact the dot
     * meant "reachable" and the word meant "no build id". Reported by
     * the operator against journey J38, 2026-08-22.
     */
    const val SERVER_UNKNOWN_SHA: String = "unknown"

    fun verdict(result: Resource<BackendHealthStatus>): ServerHealthVerdict =
        when (result) {
            is Resource.Success ->
                ServerHealthVerdict(
                    sha = result.data.sha?.let(::normaliseSha),
                    ok = result.data.status == "ok",
                )

            else -> ServerHealthVerdict(sha = null, ok = false)
        }

    /**
     * Absence — blank, or the [SERVER_UNKNOWN_SHA] sentinel in any case
     * or padding — becomes null so downstream slots render their own
     * "unknown" marker rather than the server's word. Matched whole:
     * a real sha merely BEGINNING with those letters is a build we can
     * identify and is kept.
     */
    private fun normaliseSha(raw: String): String? {
        val trimmed = raw.trim()
        return trimmed.takeIf {
            it.isNotEmpty() && !it.equals(SERVER_UNKNOWN_SHA, ignoreCase = true)
        }
    }
}

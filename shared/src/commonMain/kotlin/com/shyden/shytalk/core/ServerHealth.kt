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
 */
object ServerHealth {
    fun verdict(result: Resource<BackendHealthStatus>): ServerHealthVerdict =
        when (result) {
            is Resource.Success ->
                ServerHealthVerdict(
                    sha = result.data.sha?.takeIf { it.isNotBlank() },
                    ok = result.data.status == "ok",
                )

            else -> ServerHealthVerdict(sha = null, ok = false)
        }
}

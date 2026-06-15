package com.shyden.shytalk.navigation

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE

/**
 * SHY-0097 — the server-authorized warning-acknowledge + routing decision,
 * shared by BOTH nav graphs (Android [com.shyden.shytalk.navigation] `NavGraph`
 * and iOS [SharedNavGraph]).
 *
 * It exists as a single function so the safety contract lives in exactly one
 * place: a warned user must reach Main **only** once the server has actually
 * cleared the warning. Duplicating this across the two graphs is how the
 * original silent failure happened (the Android graph navigated optimistically
 * then got bounced straight back by the reactive moderation gate).
 *
 * Contract:
 *  - No authenticated user → [onError] (and log); the acknowledge endpoint is
 *    never called (nothing to acknowledge).
 *  - [acknowledge] returns [Resource.Success] → [onSuccess] (navigate to Main).
 *  - Any non-success result ([Resource.Error]/[Resource.Loading]) → [onError]
 *    (stay on the warning screen + surface the failure) and log it. The result
 *    is **never** swallowed — that swallow is the bug this ticket fixes.
 *
 * @param userId the caller's id, or null when no user is signed in.
 * @param acknowledge the narrow capability this needs — typically
 *   `userRepository::acknowledgeWarning`. Taking the function (not the whole
 *   repository) keeps the routing logic unit-testable with a plain lambda.
 * @param onSuccess invoked exactly once on a cleared warning (navigate to Main).
 * @param onError invoked exactly once on any failure (keep + show error).
 */
suspend fun acknowledgeWarningAndRoute(
    userId: String?,
    acknowledge: suspend (userId: String) -> Resource<Unit>,
    onSuccess: () -> Unit,
    onError: () -> Unit,
) {
    if (userId == null) {
        logE("WarningAck", "acknowledge skipped: no authenticated user")
        onError()
        return
    }
    // Success → navigate; anything else (Error/Loading) → keep the user here and
    // surface the failure. The result is logged (with the cause), never swallowed.
    val result = acknowledge(userId)
    if (result is Resource.Success) {
        onSuccess()
    } else {
        val detail = (result as? Resource.Error)?.message ?: "non-success result"
        logE("WarningAck", "acknowledge failed for user=$userId: $detail")
        onError()
    }
}

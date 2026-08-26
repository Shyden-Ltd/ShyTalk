package com.shyden.shytalk.core.model

/**
 * A report a person filed about a message or another person.
 *
 * Lived inside `ReportReviewViewModel.kt` until SHY-0460 removed that screen —
 * the model is used by the repository, its JSON parser and both platform
 * implementations, none of which have anything to do with the screen it
 * happened to share a file with. It sits with the other models now.
 *
 * The queue a moderator actually works through is the web admin console; this
 * is the shape the app sends INTO it.
 */
data class Report(
    val reportId: String = "",
    val reporterId: String = "",
    val reporterName: String = "",
    val reporterUniqueId: Long = 0L,
    val reportedUserId: String = "",
    val reportedUserName: String = "",
    val reportedUserUniqueId: Long = 0L,
    val conversationId: String = "",
    val messageId: String = "",
    val messageText: String = "",
    val reason: String = "",
    val description: String = "",
    val type: String = "", // "message" or "user"
    val timestamp: Long = 0,
    val status: String = "pending", // pending, resolved
)

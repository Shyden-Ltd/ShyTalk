package com.shyden.shytalk.core.model

/**
 * Notification model for roadmap/suggestion updates.
 * Represents an in-app notification displayed in the notification bell dropdown.
 */
data class RoadmapNotification(
    val id: String = "",
    val uid: String = "",
    val type: String = "",
    val title: String = "",
    val body: String = "",
    val relatedId: String = "",
    val isRead: Boolean = false,
    val createdAt: Long = 0,
) {
    companion object {
        val VALID_TYPES =
            setOf(
                "roadmap_update",
                "suggestion_accepted",
                "suggestion_planned",
                "suggestion_completed",
                "suggestion_rejected",
                "suggestion_merged",
                "comment",
            )

        fun fromMap(
            map: Map<String, Any?>,
            id: String = "",
        ): RoadmapNotification =
            RoadmapNotification(
                id = id,
                uid = (map["uid"] as? String) ?: (map["uid"] as? Number)?.toString() ?: "",
                type = (map["type"] as? String) ?: "",
                title = (map["title"] as? String) ?: "",
                body = (map["body"] as? String) ?: "",
                relatedId = (map["relatedId"] as? String) ?: "",
                isRead = (map["isRead"] as? Boolean) ?: false,
                createdAt = (map["createdAt"] as? Number)?.toLong() ?: 0L,
            )
    }

    val sourceLabel: String
        get() = if (type.startsWith("roadmap")) "Roadmap" else "Suggestions"

    val isRoadmapType: Boolean
        get() = type == "roadmap_update"

    val isSuggestionType: Boolean
        get() = type.startsWith("suggestion_")
}

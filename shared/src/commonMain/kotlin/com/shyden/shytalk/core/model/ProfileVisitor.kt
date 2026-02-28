package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

data class ProfileVisitor(
    val visitorId: String = "",
    val visitCount: Long = 0,
    val lastVisitedAt: Long = 0,
    val firstVisitedAt: Long = 0
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "visitorId" to visitorId,
        "visitCount" to visitCount,
        "lastVisitedAt" to lastVisitedAt,
        "firstVisitedAt" to firstVisitedAt
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): ProfileVisitor = ProfileVisitor(
            visitorId = map["visitorId"] as? String ?: "",
            visitCount = (map["visitCount"] as? Long) ?: 0,
            lastVisitedAt = timestampToMillis(map["lastVisitedAt"]),
            firstVisitedAt = timestampToMillis(map["firstVisitedAt"])
        )
    }
}

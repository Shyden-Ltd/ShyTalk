package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.timestampToMillis

data class MuteInfo(
    val odId: String = "",
    val mutedBy: String = "",
    val mutedByName: String = "",
    val reason: String? = null,
    val mutedAt: Long = 0,
    val expiresAt: Long? = null,
    val isActive: Boolean = true,
) {
    fun toMap(): Map<String, Any?> =
        mapOf(
            "mutedBy" to mutedBy,
            "mutedByName" to mutedByName,
            "reason" to reason,
            "mutedAt" to mutedAt,
            "expiresAt" to expiresAt,
            "isActive" to isActive,
        )

    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            odId: String,
        ): MuteInfo =
            MuteInfo(
                odId = odId,
                mutedBy = map["mutedBy"] as? String ?: "",
                mutedByName = map["mutedByName"] as? String ?: "",
                reason = map["reason"] as? String,
                mutedAt = (map["mutedAt"] as? Long) ?: map["mutedAt"]?.let { timestampToMillis(it) } ?: 0L,
                expiresAt = map["expiresAt"]?.let { (it as? Long) ?: timestampToMillis(it) },
                isActive = map["isActive"].asBool(true),
            )
    }
}

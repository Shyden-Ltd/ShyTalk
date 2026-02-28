package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

enum class SeatRequestStatus {
    PENDING,
    APPROVED,
    DENIED
}

data class SeatRequest(
    val requestId: String = "",
    val userId: String = "",
    val userName: String = "",
    val seatIndex: Int = -1,
    val status: SeatRequestStatus = SeatRequestStatus.PENDING,
    val createdAt: Long = currentTimeMillis(),
    val resolvedBy: String? = null,
    val resolvedAt: Long? = null
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "requestId" to requestId,
        "userId" to userId,
        "userName" to userName,
        "seatIndex" to seatIndex,
        "status" to status.name,
        "createdAt" to createdAt,
        "resolvedBy" to resolvedBy,
        "resolvedAt" to resolvedAt
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, requestId: String): SeatRequest = SeatRequest(
            requestId = requestId,
            userId = map["userId"] as? String ?: "",
            userName = map["userName"] as? String ?: "",
            seatIndex = (map["seatIndex"] as? Long)?.toInt() ?: -1,
            status = (map["status"] as? String)?.let {
                try { SeatRequestStatus.valueOf(it) } catch (_: Exception) { SeatRequestStatus.PENDING }
            } ?: SeatRequestStatus.PENDING,
            createdAt = timestampToMillis(map["createdAt"]),
            resolvedBy = map["resolvedBy"] as? String,
            resolvedAt = map["resolvedAt"]?.let { timestampToMillis(it) }
        )
    }
}

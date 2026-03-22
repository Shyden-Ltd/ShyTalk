package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

data class BackpackItem(
    val giftId: String = "",
    val quantity: Int = 0,
    val lastAcquired: Long = 0,
    val expiresAt: Long = 0,
) {
    val isExpired: Boolean get() = expiresAt > 0 && expiresAt < currentTimeMillis()
    val isExpiring: Boolean get() = expiresAt > 0 && !isExpired
    val remainingMs: Long get() = if (expiresAt > 0) (expiresAt - currentTimeMillis()).coerceAtLeast(0) else Long.MAX_VALUE

    fun toMap(): Map<String, Any?> =
        mapOf(
            "quantity" to quantity,
            "lastAcquired" to lastAcquired,
            "expiresAt" to expiresAt,
        )

    companion object {
        fun fromMap(
            map: Map<String, Any?>,
            giftId: String,
        ): BackpackItem =
            BackpackItem(
                giftId = giftId,
                quantity = (map["quantity"] as? Number)?.toInt() ?: 0,
                lastAcquired = map["lastAcquired"]?.let { timestampToMillis(it) } ?: 0,
                expiresAt = map["expiresAt"]?.let { timestampToMillis(it) } ?: 0,
            )
    }
}

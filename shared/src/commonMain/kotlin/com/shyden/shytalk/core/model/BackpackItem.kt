package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis

data class BackpackItem(
    val giftId: String = "",
    val quantity: Int = 0,
    val lastAcquired: Long = 0
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "quantity" to quantity,
        "lastAcquired" to lastAcquired
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, giftId: String): BackpackItem = BackpackItem(
            giftId = giftId,
            quantity = (map["quantity"] as? Long)?.toInt() ?: 0,
            lastAcquired = map["lastAcquired"]?.let { timestampToMillis(it) } ?: 0
        )
    }
}

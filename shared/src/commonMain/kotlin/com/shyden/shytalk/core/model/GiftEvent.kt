package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis
import kotlin.random.Random

data class GiftEvent(
    val senderId: String = "",
    val senderName: String = "",
    val recipientId: String = "",
    val recipientName: String = "",
    val giftId: String = "",
    val giftName: String = "",
    val coinValue: Int = 0,
    val timestamp: Long = 0,
    val eventId: Long = Random.nextLong()
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): GiftEvent = GiftEvent(
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            recipientId = map["recipientId"] as? String ?: "",
            recipientName = map["recipientName"] as? String ?: "",
            giftId = map["giftId"] as? String ?: "",
            giftName = map["giftName"] as? String ?: "",
            coinValue = (map["coinValue"] as? Long)?.toInt() ?: 0,
            timestamp = map["timestamp"]?.let { timestampToMillis(it) } ?: 0
        )
    }
}

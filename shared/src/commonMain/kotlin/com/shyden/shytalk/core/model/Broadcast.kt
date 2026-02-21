package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis

enum class BroadcastType { GIFT_SEND, GACHA_WIN }

data class Broadcast(
    val id: String = "",
    val type: BroadcastType = BroadcastType.GIFT_SEND,
    val senderName: String = "",
    val senderPhotoUrl: String? = null,
    val recipientName: String = "",
    val giftName: String = "",
    val giftIconUrl: String = "",
    val giftCoinValue: Int = 0,
    val timestamp: Long = 0
) {
    companion object {
        fun fromMap(map: Map<String, Any?>, id: String): Broadcast = Broadcast(
            id = id,
            type = (map["type"] as? String)?.let {
                try { BroadcastType.valueOf(it) } catch (_: Exception) { BroadcastType.GIFT_SEND }
            } ?: BroadcastType.GIFT_SEND,
            senderName = map["senderName"] as? String ?: "",
            senderPhotoUrl = map["senderPhotoUrl"] as? String,
            recipientName = map["recipientName"] as? String ?: "",
            giftName = map["giftName"] as? String ?: "",
            giftIconUrl = map["giftIconUrl"] as? String ?: "",
            giftCoinValue = (map["giftCoinValue"] as? Long)?.toInt() ?: 0,
            timestamp = map["timestamp"]?.let { timestampToMillis(it) } ?: 0
        )
    }
}

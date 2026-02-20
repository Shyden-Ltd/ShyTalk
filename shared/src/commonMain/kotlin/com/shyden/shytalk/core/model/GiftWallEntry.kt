package com.shyden.shytalk.core.model

data class GiftSender(
    val userId: String = "",
    val count: Int = 0
)

data class GiftWallEntry(
    val giftId: String = "",
    val receivedCount: Int = 0,
    val senders: Map<String, Int> = emptyMap(),
    val topSenderId: String? = null,
    val topSenderCount: Int = 0
) {
    companion object {
        fun fromMap(map: Map<String, Any?>, giftId: String): GiftWallEntry = GiftWallEntry(
            giftId = giftId,
            receivedCount = (map["receivedCount"] as? Long)?.toInt() ?: 0,
            senders = (map["senders"] as? Map<*, *>)?.mapNotNull { (k, v) ->
                val key = k as? String ?: return@mapNotNull null
                val value = (v as? Long)?.toInt() ?: return@mapNotNull null
                key to value
            }?.toMap() ?: emptyMap(),
            topSenderId = map["topSenderId"] as? String,
            topSenderCount = (map["topSenderCount"] as? Long)?.toInt() ?: 0
        )
    }
}

data class GiftRankEntry(
    val userId: String = "",
    val count: Int = 0,
    val displayName: String = "",
    val profilePhotoUrl: String? = null
)

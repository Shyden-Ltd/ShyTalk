package com.shyden.shytalk.core.model

data class GachaGift(
    val giftId: String = "",
    val giftName: String = "",
    val bracket: GiftBracket = GiftBracket.COMMON,
    val coinValue: Int = 0,
    val iconUrl: String = ""
)

data class GachaResult(
    val gifts: List<GachaGift> = emptyList(),
    val coinsSpent: Int = 0,
    val newBalance: Long = 0,
    val newPityCounter: Int = 0,
    val newLuckScore: Int = 0
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): GachaResult = GachaResult(
            gifts = (map["gifts"] as? List<*>)?.mapNotNull { item ->
                val m = item as? Map<*, *> ?: return@mapNotNull null
                GachaGift(
                    giftId = m["giftId"] as? String ?: "",
                    giftName = m["giftName"] as? String ?: "",
                    bracket = (m["bracket"] as? String)?.let {
                        try { GiftBracket.valueOf(it) } catch (_: Exception) { GiftBracket.COMMON }
                    } ?: GiftBracket.COMMON,
                    coinValue = (m["coinValue"] as? Long)?.toInt() ?: 0,
                    iconUrl = m["iconUrl"] as? String ?: ""
                )
            } ?: emptyList(),
            coinsSpent = (map["coinsSpent"] as? Long)?.toInt() ?: 0,
            newBalance = (map["newBalance"] as? Long) ?: 0,
            newPityCounter = (map["newPityCounter"] as? Long)?.toInt() ?: 0,
            newLuckScore = (map["newLuckScore"] as? Long)?.toInt() ?: 0
        )
    }
}

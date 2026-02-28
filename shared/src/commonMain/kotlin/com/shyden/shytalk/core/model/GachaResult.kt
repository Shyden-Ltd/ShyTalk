package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class GachaGift(
    val giftId: String = "",
    val giftName: String = "",
    val coinValue: Int = 0,
    val iconUrl: String = ""
)

data class GachaResult(
    val gifts: List<GachaGift> = emptyList(),
    val coinsSpent: Int = 0,
    val newBalance: Long = 0,
    val newPityCounter: Int = 0,
    val newLuckScore: Int = 0,
    val priceChanged: Boolean = false,
    val currentPullCosts: Map<Int, Int>? = null
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): GachaResult {
            val rawCosts = map["currentPullCosts"]
            val parsedCosts = if (rawCosts is Map<*, *>) {
                rawCosts.entries.mapNotNull { (k, v) ->
                    val key = k?.toString()?.toIntOrNull()
                    val value = (v as? Number)?.toInt()
                    if (key != null && value != null) key to value else null
                }.toMap()
            } else null

            return GachaResult(
                gifts = (map["gifts"] as? List<*>)?.mapNotNull { item ->
                    val m = item as? Map<*, *> ?: return@mapNotNull null
                    GachaGift(
                        giftId = m["giftId"] as? String ?: "",
                        giftName = m["giftName"] as? String ?: "",
                        coinValue = (m["coinValue"] as? Number)?.toInt() ?: 0,
                        iconUrl = m["iconUrl"] as? String ?: ""
                    )
                } ?: emptyList(),
                coinsSpent = (map["coinsSpent"] as? Number)?.toInt() ?: 0,
                newBalance = (map["newBalance"] as? Number)?.toLong() ?: 0,
                newPityCounter = (map["newPityCounter"] as? Number)?.toInt() ?: 0,
                newLuckScore = (map["newLuckScore"] as? Number)?.toInt() ?: 0,
                priceChanged = map["priceChanged"].asBool(),
                currentPullCosts = parsedCosts
            )
        }
    }
}

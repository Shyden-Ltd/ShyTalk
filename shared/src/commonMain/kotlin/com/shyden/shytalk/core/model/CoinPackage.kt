package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class CoinPackage(
    val id: String = "",
    val productId: String = "",
    val coins: Int = 0,
    val bonusCoins: Int = 0,
    val displayPrice: String = "",
    val order: Int = 0,
    val isActive: Boolean = true
) {
    val totalCoins: Int get() = coins + bonusCoins

    companion object {
        fun fromMap(map: Map<String, Any?>, id: String): CoinPackage = CoinPackage(
            id = id,
            productId = map["productId"] as? String ?: "",
            coins = (map["coins"] as? Long)?.toInt() ?: 0,
            bonusCoins = (map["bonusCoins"] as? Long)?.toInt() ?: 0,
            displayPrice = map["displayPrice"] as? String ?: "",
            order = (map["order"] as? Long)?.toInt() ?: 0,
            isActive = map["isActive"].asBool(true)
        )
    }
}

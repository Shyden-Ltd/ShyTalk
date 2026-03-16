package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool

data class DailyRewardResult(
    val coinsAwarded: Int = 0,
    val newStreak: Int = 0,
    val isMilestone: Boolean = false,
    val newBalance: Long = 0,
    val giftId: String? = null,
    val giftQuantity: Int = 0,
) {
    val isGiftReward: Boolean get() = giftId != null

    companion object {
        fun fromMap(map: Map<String, Any?>): DailyRewardResult =
            DailyRewardResult(
                coinsAwarded = (map["coinsAwarded"] as? Number)?.toInt() ?: 0,
                newStreak = (map["newStreak"] as? Number)?.toInt() ?: 0,
                isMilestone = map["isMilestone"].asBool(),
                newBalance = (map["newBalance"] as? Number)?.toLong() ?: 0,
                giftId = map["giftId"] as? String,
                giftQuantity = (map["giftQuantity"] as? Number)?.toInt() ?: 0,
            )
    }
}

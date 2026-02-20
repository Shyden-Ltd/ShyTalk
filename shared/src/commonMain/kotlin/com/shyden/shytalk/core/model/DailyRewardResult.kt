package com.shyden.shytalk.core.model

data class DailyRewardResult(
    val coinsAwarded: Int = 0,
    val newStreak: Int = 0,
    val isMilestone: Boolean = false,
    val newBalance: Long = 0
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): DailyRewardResult = DailyRewardResult(
            coinsAwarded = (map["coinsAwarded"] as? Long)?.toInt() ?: 0,
            newStreak = (map["newStreak"] as? Long)?.toInt() ?: 0,
            isMilestone = map["isMilestone"] as? Boolean ?: false,
            newBalance = (map["newBalance"] as? Long) ?: 0
        )
    }
}

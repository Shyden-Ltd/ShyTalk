package com.shyden.shytalk.core.model

data class EconomyConfig(
    val beanConversionRate: Double = 0.6,
    val pullCosts: Map<Int, Int> = emptyMap(),
    val broadcastSendThreshold: Int = 5000,
    val broadcastWinThreshold: Int = 5000,
    val maxRoomDurationMinutes: Int = 360,
    val superShyRoomDurationMinutes: Int = 720,
    val normalSeatCount: Int = 5,
    val wheelInnerThreshold: Int = 18888,
    val dailyBase: Int = 50,
    val milestoneRewards: Map<Int, MilestoneReward> = emptyMap()
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): EconomyConfig {
            val beanRate = (map["beanConversionRate"] as? Number)?.toDouble() ?: 0.6

            val rawPullCosts = map["pullCosts"]
            val pullCosts = if (rawPullCosts is Map<*, *>) {
                rawPullCosts.entries.mapNotNull { (k, v) ->
                    val key = k?.toString()?.toIntOrNull()
                    val value = (v as? Number)?.toInt()
                    if (key != null && value != null) key to value else null
                }.toMap()
            } else {
                emptyMap()
            }

            val rawMilestones = map["milestoneRewards"]
            val milestoneRewards = if (rawMilestones is Map<*, *>) {
                rawMilestones.entries.mapNotNull { (k, v) ->
                    val day = k?.toString()?.toIntOrNull()
                    val rewardMap = v as? Map<*, *>
                    if (day != null && rewardMap != null) {
                        @Suppress("UNCHECKED_CAST")
                        day to MilestoneReward.fromMap(rewardMap as Map<String, Any?>)
                    } else null
                }.toMap()
            } else {
                emptyMap()
            }

            return EconomyConfig(
                beanConversionRate = beanRate,
                pullCosts = pullCosts,
                broadcastSendThreshold = (map["broadcastSendThreshold"] as? Number)?.toInt() ?: 5000,
                broadcastWinThreshold = (map["broadcastWinThreshold"] as? Number)?.toInt() ?: 5000,
                maxRoomDurationMinutes = (map["maxRoomDurationMinutes"] as? Number)?.toInt() ?: 360,
                superShyRoomDurationMinutes = (map["superShyRoomDurationMinutes"] as? Number)?.toInt() ?: 720,
                normalSeatCount = (map["normalSeatCount"] as? Number)?.toInt() ?: 5,
                wheelInnerThreshold = (map["wheelInnerThreshold"] as? Number)?.toInt() ?: 18888,
                dailyBase = (map["dailyBase"] as? Number)?.toInt() ?: 50,
                milestoneRewards = milestoneRewards
            )
        }
    }
}

package com.shyden.shytalk.core.model

data class EconomyConfig(
    val beanConversionRate: Double = 0.6,
    val pullCosts: Map<Int, Int> = emptyMap(),
    val broadcastSendThreshold: Int = 5000,
    val broadcastWinThreshold: Int = 5000
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

            return EconomyConfig(
                beanConversionRate = beanRate,
                pullCosts = pullCosts,
                broadcastSendThreshold = (map["broadcastSendThreshold"] as? Number)?.toInt() ?: 5000,
                broadcastWinThreshold = (map["broadcastWinThreshold"] as? Number)?.toInt() ?: 5000
            )
        }
    }
}

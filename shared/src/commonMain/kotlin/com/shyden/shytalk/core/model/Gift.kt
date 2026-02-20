package com.shyden.shytalk.core.model

enum class GiftBracket {
    COMMON, UNCOMMON, RARE, EPIC, LEGENDARY
}

data class Gift(
    val id: String = "",
    val name: String = "",
    val coinValue: Int = 0,
    val beanValue: Int = 0,
    val baseDropRate: Double = 0.0,
    val bracket: GiftBracket = GiftBracket.COMMON,
    val animationUrl: String = "",
    val soundUrl: String = "",
    val iconUrl: String = "",
    val order: Int = 0,
    val broadcastEnabled: Boolean = false
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "name" to name,
        "coinValue" to coinValue,
        "beanValue" to beanValue,
        "baseDropRate" to baseDropRate,
        "bracket" to bracket.name,
        "animationUrl" to animationUrl,
        "soundUrl" to soundUrl,
        "iconUrl" to iconUrl,
        "order" to order,
        "broadcastEnabled" to broadcastEnabled
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, id: String): Gift = Gift(
            id = id,
            name = map["name"] as? String ?: "",
            coinValue = (map["coinValue"] as? Long)?.toInt() ?: 0,
            beanValue = (map["beanValue"] as? Long)?.toInt() ?: 0,
            baseDropRate = (map["baseDropRate"] as? Double) ?: 0.0,
            bracket = (map["bracket"] as? String)?.let {
                try { GiftBracket.valueOf(it) } catch (_: Exception) { GiftBracket.COMMON }
            } ?: GiftBracket.COMMON,
            animationUrl = map["animationUrl"] as? String ?: "",
            soundUrl = map["soundUrl"] as? String ?: "",
            iconUrl = map["iconUrl"] as? String ?: "",
            order = (map["order"] as? Long)?.toInt() ?: 0,
            broadcastEnabled = map["broadcastEnabled"] as? Boolean ?: false
        )
    }
}

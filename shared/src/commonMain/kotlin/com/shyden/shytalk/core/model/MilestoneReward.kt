package com.shyden.shytalk.core.model

data class MilestoneReward(
    val type: String = "coins", // "coins" or "gift"
    val amount: Int = 0,
    val giftId: String? = null,
    val quantity: Int = 1
) {
    companion object {
        fun fromMap(map: Map<String, Any?>): MilestoneReward {
            return MilestoneReward(
                type = (map["type"] as? String) ?: "coins",
                amount = (map["amount"] as? Number)?.toInt() ?: 0,
                giftId = map["giftId"] as? String,
                quantity = (map["quantity"] as? Number)?.toInt() ?: 1
            )
        }
    }
}

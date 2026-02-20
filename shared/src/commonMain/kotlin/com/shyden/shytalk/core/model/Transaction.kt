package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.timestampToMillis

enum class TransactionType {
    PURCHASE, GACHA_PULL, GIFT_SENT, GIFT_RECEIVED, BEAN_REDEEM, DAILY_REWARD, SUBSCRIPTION,
    ADMIN_ADJUSTMENT, ADMIN_BACKPACK
}

enum class CurrencyType {
    COINS, BEANS
}

data class Transaction(
    val id: String = "",
    val type: TransactionType = TransactionType.PURCHASE,
    val amount: Long = 0,
    val currency: CurrencyType = CurrencyType.COINS,
    val balanceAfter: Long = 0,
    val giftId: String? = null,
    val giftName: String? = null,
    val recipientId: String? = null,
    val senderId: String? = null,
    val pullCount: Int? = null,
    val details: String? = null,
    val timestamp: Long = 0
) {
    companion object {
        fun fromMap(map: Map<String, Any?>, id: String): Transaction = Transaction(
            id = id,
            type = (map["type"] as? String)?.let {
                try { TransactionType.valueOf(it) } catch (_: Exception) { TransactionType.PURCHASE }
            } ?: TransactionType.PURCHASE,
            amount = (map["amount"] as? Number)?.toLong() ?: 0,
            currency = (map["currency"] as? String)?.let {
                try { CurrencyType.valueOf(it) } catch (_: Exception) { CurrencyType.COINS }
            } ?: CurrencyType.COINS,
            balanceAfter = (map["balanceAfter"] as? Number)?.toLong() ?: 0,
            giftId = map["giftId"] as? String,
            giftName = map["giftName"] as? String,
            recipientId = map["recipientId"] as? String,
            senderId = map["senderId"] as? String,
            pullCount = (map["pullCount"] as? Number)?.toInt(),
            details = map["details"] as? String,
            timestamp = map["timestamp"]?.let { timestampToMillis(it) } ?: 0
        )
    }
}

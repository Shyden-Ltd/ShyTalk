package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toList
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject

class EconomyRepositoryImpl(
    private val api: WorkerApiClient
) : EconomyRepository {

    override fun observeBalance(): Flow<Long> = flow {
        while (true) {
            try {
                val json = api.get("/api/economy/balance")
                emit(json.optLong("coins", 0))
            } catch (_: Exception) { }
            delay(5_000)
        }
    }

    override fun observeEconomyConfig(): Flow<EconomyConfig> = flow {
        val json = api.get("/api/config/economy")
        val data = json.optJSONObject("value")
        if (data != null) {
            emit(EconomyConfig.fromMap(data.toMap()))
        }
    }

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> = firebaseCall("Failed to claim daily reward") {
        val json = api.post("/api/economy/daily-reward")
        DailyRewardResult.fromMap(json.toMap())
    }

    override suspend fun pullGacha(pullCount: Int, expectedCost: Int): Resource<GachaResult> = firebaseCall("Failed to pull gacha") {
        val body = JSONObject().apply {
            put("pullCount", pullCount)
            put("expectedCost", expectedCost)
        }
        val json = api.post("/api/economy/gacha", body)
        GachaResult.fromMap(json.toMap())
    }

    override suspend fun sendGift(recipientId: String, giftId: String, quantity: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val body = JSONObject().apply {
                put("recipientId", recipientId)
                put("giftId", giftId)
                put("quantity", quantity)
            }
            api.post("/api/economy/gift", body).toMap()
        }

    override suspend fun sendGiftDirect(recipientId: String, giftId: String, quantity: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val body = JSONObject().apply {
                put("recipientId", recipientId)
                put("giftId", giftId)
                put("quantity", quantity)
            }
            api.post("/api/economy/gift-direct", body).toMap()
        }

    override suspend fun sendGiftBatch(
        recipientIds: List<String>,
        giftId: String,
        quantity: Int,
        fromBackpack: Boolean
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift batch") {
            val body = JSONObject().apply {
                put("recipientIds", JSONArray(recipientIds))
                put("giftId", giftId)
                put("quantity", quantity)
                put("fromBackpack", fromBackpack)
            }
            api.post("/api/economy/gift-batch", body).toMap()
        }

    override suspend fun sendEntireBackpack(recipientId: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send entire backpack") {
            val body = JSONObject().apply {
                put("recipientId", recipientId)
            }
            api.post("/api/economy/backpack-send", body).toMap()
        }

    override suspend fun redeemBeans(amount: Long): Resource<Map<String, Any?>> =
        firebaseCall("Failed to redeem beans") {
            val body = JSONObject().apply {
                put("amount", amount)
            }
            api.post("/api/economy/redeem-beans", body).toMap()
        }

    override suspend fun purchaseCoins(productId: String, purchaseToken: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate purchase") {
            val body = JSONObject().apply {
                put("productId", productId)
                put("purchaseToken", purchaseToken)
                put("isSubscription", false)
            }
            api.post("/api/economy/purchase", body).toMap()
        }

    override suspend fun purchaseSubscription(productId: String, purchaseToken: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate subscription") {
            val body = JSONObject().apply {
                put("productId", productId)
                put("purchaseToken", purchaseToken)
                put("isSubscription", true)
            }
            api.post("/api/economy/purchase", body).toMap()
        }

    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> = firebaseCall("Failed to get coin packages") {
        val arr = api.getArray("/api/coin-packages")
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            CoinPackage.fromMap(obj.toMap(), obj.getString("id"))
        }.sortedBy { it.order }
    }

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> = firebaseCall("Failed to load transactions") {
        val arr = api.getArray("/api/economy/transactions?limit=$limit")
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Transaction.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> = firebaseCall("Failed to load transactions") {
        val path = if (filterType != null) "/api/economy/transactions?limit=200&type=$filterType"
                   else "/api/economy/transactions?limit=200"
        val arr = api.getArray(path)
        (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Transaction.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to add test coins") {
            val body = JSONObject().apply {
                put("amount", amount)
            }
            api.post("/api/economy/test-coins", body).toMap()
        }

    override suspend fun claimSuperShyTrial(): Resource<Map<String, Any?>> =
        firebaseCall("Failed to claim trial") {
            api.post("/api/economy/trial-claim").toMap()
        }

    override suspend fun activateSuperShyTrial(): Resource<Map<String, Any?>> =
        firebaseCall("Failed to activate trial") {
            api.post("/api/economy/trial-activate").toMap()
        }
}

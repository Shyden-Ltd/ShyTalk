package com.shyden.shytalk.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.MilestoneReward
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

class EconomyRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
    private val auth: FirebaseAuth,
) : EconomyRepository {
    // Real-time balance from Firestore user doc
    override fun observeBalance(): Flow<Long> =
        callbackFlow {
            val uid =
                auth.currentUser?.uid ?: run {
                    close()
                    return@callbackFlow
                }
            val listener =
                firestore
                    .document("users/$uid")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val coins = snapshot.getLong("shyCoins") ?: 0L
                        trySend(coins)
                    }
            awaitClose { listener.remove() }
        }

    // Real-time economy config from Firestore (falls back to defaults if doc missing)
    override fun observeEconomyConfig(): Flow<EconomyConfig> =
        callbackFlow {
            val defaultConfig =
                EconomyConfig(
                    pullCosts = mapOf(1 to 10, 10 to 100, 100 to 1000),
                    dailyBase = 50,
                    beanConversionRate = 0.6,
                    broadcastSendThreshold = 0,
                    broadcastWinThreshold = 5000,
                    milestoneRewards =
                        mapOf(
                            7 to MilestoneReward(amount = 100),
                            14 to MilestoneReward(amount = 200),
                            30 to MilestoneReward(amount = 500),
                            60 to MilestoneReward(amount = 1000),
                            90 to MilestoneReward(amount = 2000),
                        ),
                )
            val listener =
                firestore
                    .document("config/economy")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val data = snapshot.data
                        if (!snapshot.exists() || data == null) {
                            trySend(defaultConfig)
                            return@addSnapshotListener
                        }
                        val config = EconomyConfig.fromMap(data)
                        // Fall back to defaults if pullCosts is empty
                        if (config.pullCosts.isEmpty()) {
                            trySend(defaultConfig)
                        } else {
                            trySend(config)
                        }
                    }
            awaitClose { listener.remove() }
        }

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> =
        firebaseCall("Failed to claim daily reward") {
            val json = api.post("/api/economy/daily-reward")
            DailyRewardResult.fromMap(json.toMap())
        }

    override suspend fun pullGacha(
        pullCount: Int,
        expectedCost: Int,
    ): Resource<GachaResult> =
        firebaseCall("Failed to pull gacha") {
            val body =
                JSONObject().apply {
                    put("pullCount", pullCount)
                    put("expectedCost", expectedCost)
                }
            val json = api.post("/api/economy/gacha", body)
            GachaResult.fromMap(json.toMap())
        }

    override suspend fun sendGift(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val body =
                JSONObject().apply {
                    put("recipientId", recipientId)
                    put("giftId", giftId)
                    put("quantity", quantity)
                }
            api.post("/api/economy/gift", body).toMap()
        }

    override suspend fun sendGiftDirect(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val body =
                JSONObject().apply {
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
        fromBackpack: Boolean,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift batch") {
            val body =
                JSONObject().apply {
                    put("recipientIds", JSONArray(recipientIds))
                    put("giftId", giftId)
                    put("quantity", quantity)
                    put("fromBackpack", fromBackpack)
                }
            api.post("/api/economy/gift-batch", body).toMap()
        }

    override suspend fun sendEntireBackpack(recipientId: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send entire backpack") {
            val body =
                JSONObject().apply {
                    put("recipientId", recipientId)
                }
            api.post("/api/economy/backpack-send", body).toMap()
        }

    override suspend fun redeemBeans(amount: Long): Resource<Map<String, Any?>> =
        firebaseCall("Failed to redeem beans") {
            val body =
                JSONObject().apply {
                    put("amount", amount)
                }
            api.post("/api/economy/redeem-beans", body).toMap()
        }

    override suspend fun purchaseCoins(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate purchase") {
            val body =
                JSONObject().apply {
                    put("productId", productId)
                    put("purchaseToken", purchaseToken)
                    put("isSubscription", false)
                }
            api.post("/api/economy/purchase", body).toMap()
        }

    override suspend fun purchaseSubscription(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate subscription") {
            val body =
                JSONObject().apply {
                    put("productId", productId)
                    put("purchaseToken", purchaseToken)
                    put("isSubscription", true)
                }
            api.post("/api/economy/purchase", body).toMap()
        }

    // Coin packages from Firestore
    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> =
        firebaseCall("Failed to get coin packages") {
            val snapshot = firestore.collection("coinPackages").get().await()
            snapshot.documents
                .mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    CoinPackage.fromMap(data, doc.id)
                }.sortedBy { it.order }
        }

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> =
        firebaseCall("Failed to load transactions") {
            val uid = auth.currentUser?.uid ?: throw Exception("Not authenticated")
            val snapshot =
                firestore
                    .collection("users/$uid/transactions")
                    .orderBy("timestamp", com.google.firebase.firestore.Query.Direction.DESCENDING)
                    .limit(limit.toLong())
                    .get()
                    .await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                Transaction.fromMap(data, doc.id)
            }
        }

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> =
        firebaseCall("Failed to load transactions") {
            val uid = auth.currentUser?.uid ?: throw Exception("Not authenticated")
            var query =
                firestore
                    .collection("users/$uid/transactions")
                    .orderBy("timestamp", com.google.firebase.firestore.Query.Direction.DESCENDING)
                    .limit(200)
            if (filterType != null) {
                query = query.whereEqualTo("type", filterType)
            }
            val snapshot = query.get().await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                Transaction.fromMap(data, doc.id)
            }
        }

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to add test coins") {
            val body =
                JSONObject().apply {
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

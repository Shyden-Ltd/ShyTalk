package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.core.model.MilestoneReward
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// ── EconomyRepository ───────────────────────────────────────────

class IosEconomyRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
    private val authRepository: AuthRepository,
) : EconomyRepository {
    override fun observeBalance(): Flow<Long> {
        val uniqueId = authRepository.currentUserId ?: return emptyFlow()
        return firestore
            .collection("users")
            .document(uniqueId)
            .snapshots
            .map { snapshot ->
                if (!snapshot.exists) {
                    0L
                } else {
                    (snapshot.dataMap()["shyCoins"] as? Number)?.toLong() ?: 0L
                }
            }
    }

    override fun observeEconomyConfig(): Flow<EconomyConfig> {
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
        return firestore
            .collection("config")
            .document("economy")
            .snapshots
            .map { snapshot ->
                if (!snapshot.exists) return@map defaultConfig
                val data = snapshot.dataMap()
                val config = EconomyConfig.fromMap(data)
                if (config.pullCosts.isEmpty()) defaultConfig else config
            }
    }

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> =
        firebaseCall("Failed to claim daily reward") {
            val json = api.post("/api/economy/daily-reward")
            DailyRewardResult.fromMap(jsonToMap(json))
        }

    override suspend fun pullGacha(
        pullCount: Int,
        expectedCost: Int,
    ): Resource<GachaResult> =
        firebaseCall("Failed to pull gacha") {
            val json =
                api.post(
                    "/api/economy/gacha",
                    JsonObject(
                        mapOf(
                            "pullCount" to JsonPrimitive(pullCount),
                            "expectedCost" to JsonPrimitive(expectedCost),
                        ),
                    ),
                )
            GachaResult.fromMap(jsonToMap(json))
        }

    override suspend fun sendGift(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val json =
                api.post(
                    "/api/economy/gift",
                    JsonObject(
                        mapOf(
                            "recipientId" to JsonPrimitive(recipientId),
                            "giftId" to JsonPrimitive(giftId),
                            "quantity" to JsonPrimitive(quantity),
                        ),
                    ),
                )
            jsonToMap(json)
        }

    override suspend fun sendGiftDirect(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val json =
                api.post(
                    "/api/economy/gift-direct",
                    JsonObject(
                        mapOf(
                            "recipientId" to JsonPrimitive(recipientId),
                            "giftId" to JsonPrimitive(giftId),
                            "quantity" to JsonPrimitive(quantity),
                        ),
                    ),
                )
            jsonToMap(json)
        }

    override suspend fun sendGiftBatch(
        recipientIds: List<String>,
        giftId: String,
        quantity: Int,
        fromBackpack: Boolean,
    ): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift batch") {
            val json =
                api.post(
                    "/api/economy/gift-batch",
                    JsonObject(
                        mapOf(
                            "recipientIds" to JsonArray(recipientIds.map { JsonPrimitive(it) }),
                            "giftId" to JsonPrimitive(giftId),
                            "quantity" to JsonPrimitive(quantity),
                            "fromBackpack" to JsonPrimitive(fromBackpack),
                        ),
                    ),
                )
            jsonToMap(json)
        }

    override suspend fun sendEntireBackpack(recipientId: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send entire backpack") {
            val json =
                api.post(
                    "/api/economy/backpack-send",
                    JsonObject(mapOf("recipientId" to JsonPrimitive(recipientId))),
                )
            jsonToMap(json)
        }

    override suspend fun redeemBeans(amount: Long): Resource<Map<String, Any?>> =
        firebaseCall("Failed to redeem beans") {
            val json =
                api.post(
                    "/api/economy/redeem-beans",
                    JsonObject(mapOf("amount" to JsonPrimitive(amount))),
                )
            jsonToMap(json)
        }

    override suspend fun purchaseCoins(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> =
        // iOS uses StoreKit, not Google Play tokens — stub until StoreKit integration
        Resource.Error("iOS purchases not yet implemented (needs StoreKit)")

    override suspend fun purchaseSubscription(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> = Resource.Error("iOS subscriptions not yet implemented (needs StoreKit)")

    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> =
        firebaseCall("Failed to get coin packages") {
            val snapshot = firestore.collection("coinPackages").get()
            snapshot.documents
                .mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        CoinPackage.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }.sortedBy { it.order }
        }

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> =
        firebaseCall("Failed to load transactions") {
            val uid = authRepository.currentUserId ?: throw Exception("Not authenticated")
            val snapshot =
                firestore
                    .collection("users/$uid/transactions")
                    .orderBy("timestamp", Direction.DESCENDING)
                    .limit(limit)
                    .get()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    Transaction.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        }

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> =
        firebaseCall("Failed to load transactions") {
            val uid = authRepository.currentUserId ?: throw Exception("Not authenticated")
            var query =
                firestore
                    .collection("users/$uid/transactions")
                    .orderBy("timestamp", Direction.DESCENDING)
                    .limit(200)
            if (filterType != null) {
                query = query.where { "type" equalTo filterType }
            }
            val snapshot = query.get()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    Transaction.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        }

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to add test coins") {
            val json =
                api.post(
                    "/api/economy/test-coins",
                    JsonObject(mapOf("amount" to JsonPrimitive(amount))),
                )
            jsonToMap(json)
        }

    override suspend fun claimSuperShyTrial(): Resource<Map<String, Any?>> =
        firebaseCall("Failed to claim trial") {
            jsonToMap(api.post("/api/economy/trial-claim"))
        }

    override suspend fun activateSuperShyTrial(): Resource<Map<String, Any?>> =
        firebaseCall("Failed to activate trial") {
            jsonToMap(api.post("/api/economy/trial-activate"))
        }

    private fun jsonToMap(json: JsonObject): Map<String, Any?> =
        json.entries.associate { (k, v) ->
            k to
                when (v) {
                    is JsonPrimitive ->
                        when {
                            v.isString -> v.content
                            v.content == "true" || v.content == "false" -> v.content.toBoolean()
                            v.content.contains('.') -> v.content.toDoubleOrNull()
                            else -> v.content.toLongOrNull() ?: v.content
                        }

                    else -> v.toString()
                }
        }
}

// ── GiftRepository ──────────────────────────────────────────────

class IosGiftRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : GiftRepository {
    override fun observeGiftCatalog(): Flow<List<Gift>> =
        firestore
            .collection("gifts")
            .where { "showInStore" equalTo true }
            .snapshots
            .map { snapshot ->
                snapshot.documents
                    .mapNotNull { doc ->
                        try {
                            val data = doc.dataMap()
                            Gift.fromMap(data, doc.id)
                        } catch (e: Exception) {
                            null
                        }
                    }.sortedBy { it.order }
            }

    override fun observeAllGifts(): Flow<List<Gift>> =
        firestore
            .collection("gifts")
            .snapshots
            .map { snapshot ->
                snapshot.documents
                    .mapNotNull { doc ->
                        try {
                            val data = doc.dataMap()
                            Gift.fromMap(data, doc.id)
                        } catch (e: Exception) {
                            null
                        }
                    }.sortedBy { it.order }
            }

    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> =
        firestore
            .collection("users/$userId/backpack")
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        BackpackItem.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> =
        firestore
            .collection("users/$userId/giftWall")
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        GiftWallEntry.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

    override fun observeBroadcasts(): Flow<List<Broadcast>> =
        firestore
            .collection("broadcasts")
            .orderBy("timestamp", Direction.DESCENDING)
            .limit(50)
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        Broadcast.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

    override suspend fun getGiftWallSenders(
        userId: String,
        giftId: String,
    ): List<GiftSender> {
        val doc = firestore.collection("users/$userId/giftWall").document(giftId).get()
        if (!doc.exists) return emptyList()
        val data = doc.dataMap()
        val senders = data["senders"] as? List<*> ?: return emptyList()
        return senders.mapNotNull { sender ->
            val map = sender as? Map<*, *> ?: return@mapNotNull null
            GiftSender(
                userId = map["senderId"] as? String ?: "",
                count = (map["sendCount"] as? Number)?.toInt() ?: 0,
            )
        }
    }

    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> {
        val doc = firestore.collection("giftRankings").document(giftId).get()
        if (!doc.exists) return emptyList()
        val data = doc.dataMap()
        val rankings = data["rankings"] as? List<*> ?: return emptyList()
        return rankings.mapNotNull { entry ->
            val map = entry as? Map<*, *> ?: return@mapNotNull null
            GiftRankEntry(
                userId = map["userId"] as? String ?: "",
                count = (map["count"] as? Number)?.toInt() ?: 0,
                displayName = map["displayName"] as? String ?: "",
                profilePhotoUrl = map["profilePhotoUrl"] as? String,
            )
        }
    }
}

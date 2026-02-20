package com.shyden.shytalk.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class EconomyRepositoryImpl(
    private val firestore: FirebaseFirestore,
    private val functions: FirebaseFunctions
) : EconomyRepository {

    override fun observeBalance(): Flow<Long> = callbackFlow {
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid == null) { close(); return@callbackFlow }
        val reg = firestore.collection("users").document(uid)
            .addSnapshotListener { snap, _ ->
                val coins = snap?.getLong("shyCoins")
                if (coins != null) trySend(coins)
            }
        awaitClose { reg.remove() }
    }

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> = firebaseCall("Failed to claim daily reward") {
        val result = functions.getHttpsCallable("claimDailyReward")
            .call()
            .await()
        @Suppress("UNCHECKED_CAST")
        val data = result.data as Map<String, Any?>
        DailyRewardResult.fromMap(data)
    }

    override suspend fun pullGacha(pullCount: Int): Resource<GachaResult> = firebaseCall("Failed to pull gacha") {
        val result = functions.getHttpsCallable("pullGacha")
            .call(mapOf("pullCount" to pullCount))
            .await()
        @Suppress("UNCHECKED_CAST")
        val data = result.data as Map<String, Any?>
        GachaResult.fromMap(data)
    }

    override suspend fun sendGift(recipientId: String, giftId: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to send gift") {
            val result = functions.getHttpsCallable("sendGift")
                .call(mapOf("recipientId" to recipientId, "giftId" to giftId))
                .await()
            @Suppress("UNCHECKED_CAST")
            result.data as Map<String, Any?>
        }

    override suspend fun redeemBeans(amount: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to redeem beans") {
            val result = functions.getHttpsCallable("redeemBeans")
                .call(mapOf("amount" to amount))
                .await()
            @Suppress("UNCHECKED_CAST")
            result.data as Map<String, Any?>
        }

    override suspend fun purchaseCoins(productId: String, purchaseToken: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate purchase") {
            val result = functions.getHttpsCallable("validatePurchase")
                .call(mapOf(
                    "productId" to productId,
                    "purchaseToken" to purchaseToken,
                    "isSubscription" to false
                ))
                .await()
            @Suppress("UNCHECKED_CAST")
            result.data as Map<String, Any?>
        }

    override suspend fun purchaseSubscription(productId: String, purchaseToken: String): Resource<Map<String, Any?>> =
        firebaseCall("Failed to validate subscription") {
            val result = functions.getHttpsCallable("validatePurchase")
                .call(mapOf(
                    "productId" to productId,
                    "purchaseToken" to purchaseToken,
                    "isSubscription" to true
                ))
                .await()
            @Suppress("UNCHECKED_CAST")
            result.data as Map<String, Any?>
        }

    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> = firebaseCall("Failed to get coin packages") {
        val snapshot = firestore.collection("coinPackages")
            .whereEqualTo("isActive", true)
            .get()
            .await()
        snapshot.documents.mapNotNull { doc ->
            val data = doc.data ?: return@mapNotNull null
            CoinPackage.fromMap(data, doc.id)
        }.sortedBy { it.order }
    }

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> = firebaseCall("Failed to load transactions") {
        val userId = FirebaseAuth.getInstance().currentUser?.uid
            ?: throw Exception("Not authenticated")
        val snapshot = firestore.collection("users").document(userId)
            .collection("transactions")
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .limit(limit.toLong())
            .get()
            .await()
        snapshot.documents.mapNotNull { doc ->
            val data = doc.data ?: return@mapNotNull null
            Transaction.fromMap(data, doc.id)
        }
    }

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> = firebaseCall("Failed to load transactions") {
        val userId = FirebaseAuth.getInstance().currentUser?.uid
            ?: throw Exception("Not authenticated")
        var query: Query = firestore.collection("users").document(userId)
            .collection("transactions")
        if (filterType != null) {
            query = query.whereEqualTo("type", filterType)
        }
        val snapshot = query.get().await()
        snapshot.documents.mapNotNull { doc ->
            val data = doc.data ?: return@mapNotNull null
            Transaction.fromMap(data, doc.id)
        }.sortedByDescending { it.timestamp }
    }

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> =
        firebaseCall("Failed to add test coins") {
            val userId = FirebaseAuth.getInstance().currentUser?.uid
                ?: throw Exception("Not authenticated")
            val userRef = firestore.collection("users").document(userId)
            userRef.update("shyCoins", FieldValue.increment(amount.toLong())).await()
            val txData = mapOf(
                "type" to "PURCHASE",
                "amount" to amount,
                "currency" to "COINS",
                "timestamp" to System.currentTimeMillis(),
                "details" to "Test purchase (+$amount coins)"
            )
            userRef.collection("transactions").add(txData).await()
            mapOf("success" to true, "coinsAdded" to amount)
        }
}

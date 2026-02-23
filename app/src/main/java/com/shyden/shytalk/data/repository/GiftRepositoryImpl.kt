package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class GiftRepositoryImpl(
    private val firestore: FirebaseFirestore
) : GiftRepository {

    override fun observeGiftCatalog(): Flow<List<Gift>> = callbackFlow {
        val listener = firestore.collection("gifts")
            .whereEqualTo("showInStore", true)
            .orderBy("order")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val gifts = snapshot?.documents?.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Gift.fromMap(data, doc.id)
                } ?: emptyList()
                trySend(gifts)
            }
        awaitClose { listener.remove() }
    }

    override fun observeAllGifts(): Flow<List<Gift>> = callbackFlow {
        val listener = firestore.collection("gifts")
            .orderBy("order")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val gifts = snapshot?.documents?.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Gift.fromMap(data, doc.id)
                } ?: emptyList()
                trySend(gifts)
            }
        awaitClose { listener.remove() }
    }

    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> = callbackFlow {
        val listener = firestore.collection("users").document(userId)
            .collection("backpack")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val items = snapshot?.documents?.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    BackpackItem.fromMap(data, doc.id)
                } ?: emptyList()
                trySend(items)
            }
        awaitClose { listener.remove() }
    }

    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> = callbackFlow {
        val listener = firestore.collection("users").document(userId)
            .collection("giftWall")
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val entries = snapshot?.documents?.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    GiftWallEntry.fromMap(data, doc.id)
                } ?: emptyList()
                trySend(entries)
            }
        awaitClose { listener.remove() }
    }

    override fun observeBroadcasts(): Flow<List<Broadcast>> = callbackFlow {
        val listener = firestore.collection("broadcasts")
            .orderBy("timestamp", Query.Direction.DESCENDING)
            .limit(10)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val broadcasts = snapshot?.documents?.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Broadcast.fromMap(data, doc.id)
                } ?: emptyList()
                trySend(broadcasts)
            }
        awaitClose { listener.remove() }
    }

    override suspend fun getGiftWallSenders(userId: String, giftId: String): List<GiftSender> {
        val doc = firestore.collection("users").document(userId)
            .collection("giftWall").document(giftId).get().await()
        if (!doc.exists()) return emptyList()
        val data = doc.data ?: return emptyList()
        val senders = data["senders"] as? Map<*, *> ?: return emptyList()
        return senders.mapNotNull { (k, v) ->
            val key = k as? String ?: return@mapNotNull null
            val value = (v as? Long)?.toInt() ?: return@mapNotNull null
            GiftSender(userId = key, count = value)
        }.sortedByDescending { it.count }
    }

    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> {
        val doc = firestore.collection("giftRankings").document(giftId).get().await()
        if (!doc.exists()) return emptyList()
        val data = doc.data ?: return emptyList()
        val rankings = data["rankings"] as? List<*> ?: return emptyList()
        return rankings.mapNotNull { item ->
            val m = item as? Map<*, *> ?: return@mapNotNull null
            GiftRankEntry(
                userId = m["userId"] as? String ?: return@mapNotNull null,
                count = (m["count"] as? Long)?.toInt() ?: 0,
                displayName = m["displayName"] as? String ?: "",
                profilePhotoUrl = m["profilePhotoUrl"] as? String
            )
        }
    }
}

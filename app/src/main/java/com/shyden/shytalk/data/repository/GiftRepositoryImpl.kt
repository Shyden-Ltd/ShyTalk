package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class GiftRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore
) : GiftRepository {

    // Gift catalog — real-time from Firestore
    override fun observeGiftCatalog(): Flow<List<Gift>> = callbackFlow {
        val listener = firestore.collection("gifts")
            .whereEqualTo("showInStore", true)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val gifts = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Gift.fromMap(data, doc.id)
                }.sortedBy { it.order }
                trySend(gifts)
            }
        awaitClose { listener.remove() }
    }

    // All gifts (admin/gacha) — real-time from Firestore
    override fun observeAllGifts(): Flow<List<Gift>> = callbackFlow {
        val listener = firestore.collection("gifts")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val gifts = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Gift.fromMap(data, doc.id)
                }.sortedBy { it.order }
                trySend(gifts)
            }
        awaitClose { listener.remove() }
    }

    // Backpack — real-time from Firestore subcollection
    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> = callbackFlow {
        val listener = firestore.collection("users/$userId/backpack")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val items = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    BackpackItem.fromMap(data, doc.id)
                }
                trySend(items)
            }
        awaitClose { listener.remove() }
    }

    // Gift wall — real-time from Firestore subcollection
    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> = callbackFlow {
        val listener = firestore.collection("users/$userId/giftWall")
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val entries = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    GiftWallEntry.fromMap(data, doc.id)
                }
                trySend(entries)
            }
        awaitClose { listener.remove() }
    }

    // Broadcasts — real-time from Firestore (replaces 120s polling)
    override fun observeBroadcasts(): Flow<List<Broadcast>> = callbackFlow {
        val listener = firestore.collection("broadcasts")
            .orderBy("timestamp", com.google.firebase.firestore.Query.Direction.DESCENDING)
            .limit(50)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) return@addSnapshotListener
                val broadcasts = snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Broadcast.fromMap(data, doc.id)
                }
                trySend(broadcasts)
            }
        awaitClose { listener.remove() }
    }

    // Gift wall senders — from Firestore (embedded in gift wall doc)
    override suspend fun getGiftWallSenders(userId: String, giftId: String): List<GiftSender> {
        val doc = firestore.document("users/$userId/giftWall/$giftId").get().await()
        val data = doc.data ?: return emptyList()
        val senders = data["senders"] as? List<*> ?: return emptyList()
        return senders.mapNotNull { sender ->
            val map = sender as? Map<*, *> ?: return@mapNotNull null
            GiftSender(
                userId = map["senderId"] as? String ?: "",
                count = (map["sendCount"] as? Number)?.toInt() ?: 0
            )
        }
    }

    // Gift ranking — from Firestore
    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> {
        val doc = firestore.document("giftRankings/$giftId").get().await()
        val data = doc.data ?: return emptyList()
        val rankings = data["rankings"] as? List<*> ?: return emptyList()
        return rankings.mapNotNull { entry ->
            val map = entry as? Map<*, *> ?: return@mapNotNull null
            GiftRankEntry(
                userId = map["userId"] as? String ?: "",
                count = (map["count"] as? Number)?.toInt() ?: 0,
                displayName = map["displayName"] as? String ?: "",
                profilePhotoUrl = map["profilePhotoUrl"] as? String
            )
        }
    }
}

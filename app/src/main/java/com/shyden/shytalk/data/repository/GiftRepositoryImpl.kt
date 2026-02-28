package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.json.JSONObject

class GiftRepositoryImpl(
    private val api: WorkerApiClient
) : GiftRepository {

    override fun observeGiftCatalog(): Flow<List<Gift>> = flow {
        val arr = api.getArray("/api/gifts")
        val gifts = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Gift.fromMap(obj.toMap(), obj.getString("id"))
        }
        emit(gifts)
    }

    override fun observeAllGifts(): Flow<List<Gift>> = flow {
        val arr = api.getArray("/api/gifts/all")
        val gifts = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Gift.fromMap(obj.toMap(), obj.getString("id"))
        }
        emit(gifts)
    }

    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> = flow {
        val arr = api.getArray("/api/users/$userId/backpack")
        val items = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            BackpackItem.fromMap(obj.toMap(), obj.optString("gift_id", ""))
        }
        emit(items)
    }

    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> = flow {
        val arr = api.getArray("/api/users/$userId/gift-wall")
        val entries = (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            GiftWallEntry.fromMap(obj.toMap(), obj.optString("gift_id", ""))
        }
        emit(entries)
    }

    override fun observeBroadcasts(): Flow<List<Broadcast>> = flow {
        // Initial fetch
        emit(fetchBroadcasts())
        // Poll every 30 seconds for new broadcasts
        while (true) {
            delay(30_000)
            try {
                emit(fetchBroadcasts())
            } catch (_: Exception) {
                // Silently skip failed polls — UI retains last known state
            }
        }
    }

    private suspend fun fetchBroadcasts(): List<Broadcast> {
        val arr = api.getArray("/api/broadcasts")
        return (0 until arr.length()).mapNotNull { i ->
            val obj = arr.getJSONObject(i)
            Broadcast.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun getGiftWallSenders(userId: String, giftId: String): List<GiftSender> {
        val arr = api.getArray("/api/users/$userId/gift-wall/$giftId/senders")
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            GiftSender(
                userId = obj.optString("sender_id", ""),
                count = obj.optInt("send_count", 0)
            )
        }
    }

    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> {
        val json = api.get("/api/gift-rankings/$giftId")
        val rankings = json.optJSONArray("rankings") ?: return emptyList()
        return (0 until rankings.length()).mapNotNull { i ->
            val obj = rankings.getJSONObject(i)
            GiftRankEntry(
                userId = obj.optString("userId", ""),
                count = obj.optInt("count", 0),
                displayName = obj.optString("displayName", ""),
                profilePhotoUrl = if (obj.has("profilePhotoUrl") && !obj.isNull("profilePhotoUrl")) obj.getString("profilePhotoUrl") else null
            )
        }
    }
}

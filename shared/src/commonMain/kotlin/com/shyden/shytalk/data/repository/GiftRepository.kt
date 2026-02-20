package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import kotlinx.coroutines.flow.Flow

interface GiftRepository {
    fun observeGiftCatalog(): Flow<List<Gift>>
    fun observeBackpack(userId: String): Flow<List<BackpackItem>>
    fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>>
    fun observeBroadcasts(): Flow<List<Broadcast>>
    suspend fun getGiftWallSenders(userId: String, giftId: String): List<GiftSender>
    suspend fun getGiftRanking(giftId: String): List<GiftRankEntry>
}

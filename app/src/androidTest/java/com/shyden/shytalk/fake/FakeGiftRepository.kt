package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeGiftRepository : GiftRepository {
    val catalog = MutableStateFlow(TestData.sampleGifts)
    val backpack = MutableStateFlow<List<BackpackItem>>(emptyList())
    val giftWall = MutableStateFlow<List<GiftWallEntry>>(emptyList())
    val broadcasts = MutableStateFlow<List<Broadcast>>(emptyList())

    override fun observeGiftCatalog(): Flow<List<Gift>> = catalog
    override fun observeAllGifts(): Flow<List<Gift>> = catalog
    override fun observeBackpack(userId: String): Flow<List<BackpackItem>> = backpack
    override fun observeGiftWall(userId: String): Flow<List<GiftWallEntry>> = giftWall
    override fun observeBroadcasts(): Flow<List<Broadcast>> = broadcasts
    override suspend fun getGiftWallSenders(userId: String, giftId: String): List<GiftSender> = emptyList()
    override suspend fun getGiftRanking(giftId: String): List<GiftRankEntry> = emptyList()
}

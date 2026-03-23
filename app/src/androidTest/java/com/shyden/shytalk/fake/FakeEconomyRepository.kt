package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeEconomyRepository : EconomyRepository {
    val balance = MutableStateFlow(1000L)
    val config = MutableStateFlow(EconomyConfig())
    var dailyRewardResult = DailyRewardResult(coinsAwarded = 50, newStreak = 1, newBalance = 1050)

    override fun observeBalance(): Flow<Long> = balance

    override fun observeEconomyConfig(): Flow<EconomyConfig> = config

    override suspend fun claimDailyReward(): Resource<DailyRewardResult> {
        balance.value = dailyRewardResult.newBalance
        return Resource.Success(dailyRewardResult)
    }

    override suspend fun pullGacha(
        pullCount: Int,
        expectedCost: Int,
    ): Resource<GachaResult> = Resource.Success(GachaResult(coinsSpent = expectedCost, newBalance = balance.value - expectedCost))

    override suspend fun sendGift(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true, "giftName" to "Gift", "quantity" to quantity))

    override suspend fun sendGiftDirect(
        recipientId: String,
        giftId: String,
        quantity: Int,
    ): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true, "giftName" to "Gift", "quantity" to quantity))

    override suspend fun sendGiftBatch(
        recipientIds: List<String>,
        giftId: String,
        quantity: Int,
        fromBackpack: Boolean,
    ): Resource<Map<String, Any?>> =
        Resource.Success(
            mapOf(
                "success" to true,
                "giftName" to "Gift",
                "quantity" to quantity,
                "totalRecipients" to recipientIds.size,
                "totalItems" to quantity * recipientIds.size,
            ),
        )

    override suspend fun sendEntireBackpack(recipientId: String): Resource<Map<String, Any?>> =
        Resource.Success(mapOf("success" to true, "totalItemsSent" to 0))

    override suspend fun redeemBeans(amount: Long): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))

    override suspend fun purchaseCoins(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))

    override suspend fun purchaseSubscription(
        productId: String,
        purchaseToken: String,
    ): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))

    override suspend fun getCoinPackages(): Resource<List<CoinPackage>> = Resource.Success(emptyList())

    override suspend fun getRecentTransactions(limit: Int): Resource<List<Transaction>> = Resource.Success(TestData.sampleTransactions)

    override suspend fun getAllTransactions(filterType: String?): Resource<List<Transaction>> =
        Resource.Success(TestData.sampleTransactions)

    override suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))

    override suspend fun claimSuperShyTrial(): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))

    override suspend fun activateSuperShyTrial(): Resource<Map<String, Any?>> = Resource.Success(mapOf("success" to true))
}

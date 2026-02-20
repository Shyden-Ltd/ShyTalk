package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface EconomyRepository {
    fun observeBalance(): Flow<Long>
    suspend fun claimDailyReward(): Resource<DailyRewardResult>
    suspend fun pullGacha(pullCount: Int): Resource<GachaResult>
    suspend fun sendGift(recipientId: String, giftId: String): Resource<Map<String, Any?>>
    suspend fun redeemBeans(amount: Int): Resource<Map<String, Any?>>
    suspend fun purchaseCoins(productId: String, purchaseToken: String): Resource<Map<String, Any?>>
    suspend fun purchaseSubscription(productId: String, purchaseToken: String): Resource<Map<String, Any?>>
    suspend fun getCoinPackages(): Resource<List<CoinPackage>>
    suspend fun getRecentTransactions(limit: Int = 10): Resource<List<Transaction>>
    suspend fun getAllTransactions(filterType: String? = null): Resource<List<Transaction>>
    suspend fun addTestCoins(amount: Int): Resource<Map<String, Any?>>
}

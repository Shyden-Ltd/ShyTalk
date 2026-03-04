package com.shyden.shytalk.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class EconomyRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var auth: FirebaseAuth
    private lateinit var repo: EconomyRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        auth = mockk(relaxed = true)
        repo = EconomyRepositoryImpl(api, firestore, auth)
    }

    // region observeEconomyConfig — reads from Firestore (tested via integration tests)

    // endregion

    // region getCoinPackages — reads from Firestore (tested via integration tests)

    // endregion

    // region claimDailyReward

    @Test
    fun `claimDailyReward returns parsed result`() = runTest {
        coEvery { api.post("/api/economy/daily-reward", any()) } returns JSONObject().apply {
            put("coinsAwarded", 50)
            put("newStreak", 5)
            put("isMilestone", false)
            put("newBalance", 1050)
        }

        val result = repo.claimDailyReward()

        assertTrue(result is Resource.Success)
        val data = (result as Resource.Success).data
        assertEquals(50, data.coinsAwarded)
        assertEquals(5, data.newStreak)
        assertFalse(data.isMilestone)
        assertEquals(1050L, data.newBalance)
    }

    @Test
    fun `claimDailyReward failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/daily-reward", any()) } throws RuntimeException("Already claimed")

        val result = repo.claimDailyReward()

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region pullGacha

    @Test
    fun `pullGacha returns parsed gacha result`() = runTest {
        coEvery { api.post("/api/economy/gacha", any()) } returns JSONObject().apply {
            put("gifts", JSONArray().apply {
                put(JSONObject().apply {
                    put("giftId", "rose")
                    put("giftName", "Rose")
                    put("coinValue", 100)
                    put("iconUrl", "https://img.com/rose.png")
                })
            })
            put("coinsSpent", 10)
            put("newBalance", 990)
            put("newPityCounter", 1)
            put("newLuckScore", 0)
        }

        val result = repo.pullGacha(1, 10)

        assertTrue(result is Resource.Success)
        val data = (result as Resource.Success).data
        assertEquals(1, data.gifts.size)
        assertEquals("rose", data.gifts[0].giftId)
        assertEquals(10, data.coinsSpent)
        assertEquals(990L, data.newBalance)
    }

    @Test
    fun `pullGacha failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/gacha", any()) } throws RuntimeException("Insufficient coins")

        val result = repo.pullGacha(1, 10)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendGift

    @Test
    fun `sendGift calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/gift", any()) } returns JSONObject().apply {
            put("success", true)
            put("beanReward", 60)
        }

        val result = repo.sendGift("recipient-1", "rose", 2)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/gift", any()) }
    }

    @Test
    fun `sendGift failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/gift", any()) } throws RuntimeException("Not in backpack")

        val result = repo.sendGift("recipient-1", "gift-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendGiftDirect

    @Test
    fun `sendGiftDirect calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/gift-direct", any()) } returns JSONObject().apply {
            put("success", true)
            put("beanReward", 30)
            put("coinsSpent", 100)
        }

        val result = repo.sendGiftDirect("recipient-1", "rose", 1)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/gift-direct", any()) }
    }

    @Test
    fun `sendGiftDirect failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/gift-direct", any()) } throws RuntimeException("Insufficient coins")

        val result = repo.sendGiftDirect("recipient-1", "gift-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendGiftBatch

    @Test
    fun `sendGiftBatch calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/gift-batch", any()) } returns JSONObject().apply {
            put("success", true)
            put("totalSent", 6)
            put("recipientCount", 3)
        }

        val result = repo.sendGiftBatch(listOf("r1", "r2", "r3"), "rose", 2, true)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/gift-batch", any()) }
    }

    @Test
    fun `sendGiftBatch failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/gift-batch", any()) } throws RuntimeException("Batch failed")

        val result = repo.sendGiftBatch(listOf("r1", "r2"), "gift-1", 1, false)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendEntireBackpack

    @Test
    fun `sendEntireBackpack calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/backpack-send", any()) } returns JSONObject().apply {
            put("success", true)
            put("totalItemsSent", 15)
            put("totalBeanReward", 300)
        }

        val result = repo.sendEntireBackpack("recipient-1")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/backpack-send", any()) }
    }

    @Test
    fun `sendEntireBackpack failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/backpack-send", any()) } throws RuntimeException("Backpack is empty")

        val result = repo.sendEntireBackpack("recipient-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region redeemBeans

    @Test
    fun `redeemBeans calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/redeem-beans", any()) } returns JSONObject().apply {
            put("coinsReceived", 100)
            put("newCoinBalance", 1100)
            put("newBeanBalance", 0)
        }

        val result = repo.redeemBeans(100)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/redeem-beans", any()) }
    }

    @Test
    fun `redeemBeans failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/redeem-beans", any()) } throws RuntimeException("Insufficient beans")

        val result = repo.redeemBeans(100)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region purchaseCoins

    @Test
    fun `purchaseCoins calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/purchase", any()) } returns JSONObject().apply {
            put("success", true)
            put("coinsAdded", 100)
            put("newBalance", 1100)
        }

        val result = repo.purchaseCoins("coins_100", "purchase-token-1")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/purchase", any()) }
    }

    @Test
    fun `purchaseCoins failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/purchase", any()) } throws RuntimeException("Purchase failed")

        val result = repo.purchaseCoins("coins_100", "token")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region purchaseSubscription

    @Test
    fun `purchaseSubscription calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/purchase", any()) } returns JSONObject().apply {
            put("success", true)
            put("tier", "monthly")
        }

        val result = repo.purchaseSubscription("super_shy_monthly", "sub-token-1")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/purchase", any()) }
    }

    @Test
    fun `purchaseSubscription failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/purchase", any()) } throws RuntimeException("Subscription failed")

        val result = repo.purchaseSubscription("super_shy_monthly", "token")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region getRecentTransactions — reads from Firestore (tested via integration tests)

    // endregion

    // region getAllTransactions — reads from Firestore (tested via integration tests)

    // endregion

    // region addTestCoins

    @Test
    fun `addTestCoins calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/test-coins", any()) } returns JSONObject().apply {
            put("success", true)
            put("coinsAdded", 1000)
            put("newBalance", 2000)
        }

        val result = repo.addTestCoins(1000)

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/test-coins", any()) }
    }

    @Test
    fun `addTestCoins failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/test-coins", any()) } throws RuntimeException("Not allowed")

        val result = repo.addTestCoins(100)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region claimSuperShyTrial

    @Test
    fun `claimSuperShyTrial calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/trial-claim", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.claimSuperShyTrial()

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/trial-claim", any()) }
    }

    @Test
    fun `claimSuperShyTrial failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/trial-claim", any()) } throws RuntimeException("Already claimed")

        val result = repo.claimSuperShyTrial()

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region activateSuperShyTrial

    @Test
    fun `activateSuperShyTrial calls correct endpoint`() = runTest {
        coEvery { api.post("/api/economy/trial-activate", any()) } returns JSONObject().apply {
            put("success", true)
            put("newTier", "trial")
            put("newExpiry", 1702000000000L)
        }

        val result = repo.activateSuperShyTrial()

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/economy/trial-activate", any()) }
    }

    @Test
    fun `activateSuperShyTrial failure returns Error`() = runTest {
        coEvery { api.post("/api/economy/trial-activate", any()) } throws RuntimeException("No trial")

        val result = repo.activateSuperShyTrial()

        assertTrue(result is Resource.Error)
    }

    // endregion
}

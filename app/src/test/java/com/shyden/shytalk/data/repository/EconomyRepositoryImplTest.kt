package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.HttpsCallableReference
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class EconomyRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var functions: FirebaseFunctions
    private lateinit var repo: EconomyRepositoryImpl

    private lateinit var coinPackagesCollection: CollectionReference

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        functions = mockk(relaxed = true)
        coinPackagesCollection = mockk(relaxed = true)

        every { firestore.collection("coinPackages") } returns coinPackagesCollection

        repo = EconomyRepositoryImpl(firestore, functions)
    }

    // ── Cloud Function call tests ─────────────────────────────────────
    // HttpsCallableResult.getData() is final and can't be mocked with MockK.
    // We test failure paths (which don't parse the result) and Firestore-only paths.

    @Test
    fun `claimDailyReward failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call() } returns Tasks.forException(RuntimeException("Already claimed"))
        every { functions.getHttpsCallable("claimDailyReward") } returns callable

        val result = repo.claimDailyReward()

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `pullGacha failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Insufficient coins"))
        every { functions.getHttpsCallable("pullGacha") } returns callable

        val result = repo.pullGacha(1, 10)

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `sendGift failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Not in backpack"))
        every { functions.getHttpsCallable("sendGift") } returns callable

        val result = repo.sendGift("recipient-1", "gift-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `sendGiftDirect failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Insufficient coins"))
        every { functions.getHttpsCallable("sendGiftDirect") } returns callable

        val result = repo.sendGiftDirect("recipient-1", "gift-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `redeemBeans failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Insufficient beans"))
        every { functions.getHttpsCallable("redeemBeans") } returns callable

        val result = repo.redeemBeans(100)

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `purchaseCoins failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Purchase failed"))
        every { functions.getHttpsCallable("validatePurchase") } returns callable

        val result = repo.purchaseCoins("coins_100", "token")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `purchaseSubscription failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Subscription failed"))
        every { functions.getHttpsCallable("validatePurchase") } returns callable

        val result = repo.purchaseSubscription("super_shy_monthly", "token")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `sendEntireBackpack failure returns Error`() = runTest {
        val callable = mockk<HttpsCallableReference>()
        every { callable.call(any()) } returns Tasks.forException(RuntimeException("Backpack is empty"))
        every { functions.getHttpsCallable("sendEntireBackpack") } returns callable

        val result = repo.sendEntireBackpack("recipient-1")

        assertTrue(result is Resource.Error)
    }

    // ── Firestore-only tests ──────────────────────────────────────────

    @Test
    fun `getCoinPackages returns sorted active packages`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot>()

        val doc1 = mockk<DocumentSnapshot>()
        every { doc1.id } returns "pkg1"
        every { doc1.data } returns mapOf(
            "productId" to "coins_500", "coins" to 500L, "bonusCoins" to 50L,
            "displayPrice" to "$4.99", "order" to 2L, "isActive" to true
        )

        val doc2 = mockk<DocumentSnapshot>()
        every { doc2.id } returns "pkg2"
        every { doc2.data } returns mapOf(
            "productId" to "coins_100", "coins" to 100L, "bonusCoins" to 0L,
            "displayPrice" to "$0.99", "order" to 1L, "isActive" to true
        )

        every { snapshot.documents } returns listOf(doc1, doc2)
        every { coinPackagesCollection.whereEqualTo("isActive", true) } returns query
        every { query.get() } returns Tasks.forResult(snapshot)

        val result = repo.getCoinPackages()

        assertTrue(result is Resource.Success)
        val packages = (result as Resource.Success).data
        assertEquals(2, packages.size)
        assertEquals("coins_100", packages[0].productId)
        assertEquals("coins_500", packages[1].productId)
    }

    @Test
    fun `getCoinPackages returns empty on no active packages`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot>()

        every { snapshot.documents } returns emptyList()
        every { coinPackagesCollection.whereEqualTo("isActive", true) } returns query
        every { query.get() } returns Tasks.forResult(snapshot)

        val result = repo.getCoinPackages()

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }

    @Test
    fun `getCoinPackages returns Error on exception`() = runTest {
        val query = mockk<Query>(relaxed = true)
        every { coinPackagesCollection.whereEqualTo("isActive", true) } returns query
        every { query.get() } returns Tasks.forException(RuntimeException("Connection failed"))

        val result = repo.getCoinPackages()

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `getCoinPackages skips docs with null data`() = runTest {
        val query = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot>()

        val doc1 = mockk<DocumentSnapshot>()
        every { doc1.id } returns "pkg1"
        every { doc1.data } returns null

        val doc2 = mockk<DocumentSnapshot>()
        every { doc2.id } returns "pkg2"
        every { doc2.data } returns mapOf(
            "productId" to "coins_100", "coins" to 100L, "bonusCoins" to 0L,
            "displayPrice" to "$0.99", "order" to 1L, "isActive" to true
        )

        every { snapshot.documents } returns listOf(doc1, doc2)
        every { coinPackagesCollection.whereEqualTo("isActive", true) } returns query
        every { query.get() } returns Tasks.forResult(snapshot)

        val result = repo.getCoinPackages()

        assertTrue(result is Resource.Success)
        assertEquals(1, (result as Resource.Success).data.size)
    }
}

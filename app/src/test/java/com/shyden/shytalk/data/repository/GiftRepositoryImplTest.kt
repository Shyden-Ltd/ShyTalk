package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GiftRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: GiftRepositoryImpl

    private lateinit var usersCollection: CollectionReference
    private lateinit var giftRankingsCollection: CollectionReference

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        usersCollection = mockk(relaxed = true)
        giftRankingsCollection = mockk(relaxed = true)

        every { firestore.collection("users") } returns usersCollection
        every { firestore.collection("giftRankings") } returns giftRankingsCollection

        repo = GiftRepositoryImpl(firestore)
    }

    private fun mockGiftWallDoc(userId: String, giftId: String, exists: Boolean, data: Map<String, Any?>? = null): DocumentSnapshot {
        val userDoc = mockk<DocumentReference>(relaxed = true)
        val giftWallCollection = mockk<CollectionReference>(relaxed = true)
        val giftWallDoc = mockk<DocumentReference>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>()

        every { usersCollection.document(userId) } returns userDoc
        every { userDoc.collection("giftWall") } returns giftWallCollection
        every { giftWallCollection.document(giftId) } returns giftWallDoc
        every { snapshot.exists() } returns exists
        every { snapshot.data } returns data
        every { giftWallDoc.get() } returns Tasks.forResult(snapshot)

        return snapshot
    }

    private fun mockRankingDoc(giftId: String, exists: Boolean, data: Map<String, Any?>? = null): DocumentSnapshot {
        val rankingDoc = mockk<DocumentReference>(relaxed = true)
        val snapshot = mockk<DocumentSnapshot>()

        every { giftRankingsCollection.document(giftId) } returns rankingDoc
        every { snapshot.exists() } returns exists
        every { snapshot.data } returns data
        every { rankingDoc.get() } returns Tasks.forResult(snapshot)

        return snapshot
    }

    @Test
    fun `getGiftWallSenders returns sorted senders when doc exists`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", true, mapOf(
            "receivedCount" to 10L,
            "senders" to mapOf("alice" to 5L, "bob" to 8L, "charlie" to 2L)
        ))

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertEquals(3, senders.size)
        assertEquals("bob", senders[0].userId)
        assertEquals(8, senders[0].count)
        assertEquals("alice", senders[1].userId)
        assertEquals(5, senders[1].count)
        assertEquals("charlie", senders[2].userId)
        assertEquals(2, senders[2].count)
    }

    @Test
    fun `getGiftWallSenders returns empty when doc does not exist`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", false)

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertTrue(senders.isEmpty())
    }

    @Test
    fun `getGiftWallSenders returns empty when data is null`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", true, null)

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertTrue(senders.isEmpty())
    }

    @Test
    fun `getGiftWallSenders returns empty when senders field missing`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", true, mapOf(
            "receivedCount" to 10L
        ))

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertTrue(senders.isEmpty())
    }

    @Test
    fun `getGiftRanking returns parsed list when doc exists`() = runTest {
        mockRankingDoc("gift-1", true, mapOf(
            "rankings" to listOf(
                mapOf("userId" to "u1", "count" to 100L, "displayName" to "Top User", "profilePhotoUrl" to "https://photo.url"),
                mapOf("userId" to "u2", "count" to 50L, "displayName" to "Second", "profilePhotoUrl" to null)
            ),
            "totalSent" to 500L
        ))

        val ranking = repo.getGiftRanking("gift-1")

        assertEquals(2, ranking.size)
        assertEquals("u1", ranking[0].userId)
        assertEquals(100, ranking[0].count)
        assertEquals("Top User", ranking[0].displayName)
        assertEquals("https://photo.url", ranking[0].profilePhotoUrl)
        assertEquals("u2", ranking[1].userId)
        assertEquals(50, ranking[1].count)
    }

    @Test
    fun `getGiftRanking returns empty when doc does not exist`() = runTest {
        mockRankingDoc("gift-1", false)

        val ranking = repo.getGiftRanking("gift-1")

        assertTrue(ranking.isEmpty())
    }

    @Test
    fun `getGiftRanking returns empty when rankings field missing`() = runTest {
        mockRankingDoc("gift-1", true, mapOf("totalSent" to 500L))

        val ranking = repo.getGiftRanking("gift-1")

        assertTrue(ranking.isEmpty())
    }

    @Test
    fun `getGiftRanking returns empty when data is null`() = runTest {
        mockRankingDoc("gift-1", true, null)

        val ranking = repo.getGiftRanking("gift-1")

        assertTrue(ranking.isEmpty())
    }

    @Test
    fun `getGiftWallSenders handles non-Long sender counts`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", true, mapOf(
            "senders" to mapOf("alice" to 5L, "bob" to "not a number", "charlie" to null)
        ))

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertEquals(1, senders.size)
        assertEquals("alice", senders[0].userId)
        assertEquals(5, senders[0].count)
    }

    @Test
    fun `getGiftWallSenders handles empty senders map`() = runTest {
        mockGiftWallDoc("user-1", "gift-1", true, mapOf(
            "senders" to emptyMap<String, Any>()
        ))

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertTrue(senders.isEmpty())
    }

    @Test
    fun `getGiftRanking skips entries with missing userId`() = runTest {
        mockRankingDoc("gift-1", true, mapOf(
            "rankings" to listOf(
                mapOf("userId" to "u1", "count" to 100L, "displayName" to "User 1"),
                mapOf("count" to 50L, "displayName" to "Missing UID"),
                mapOf("userId" to null, "count" to 30L)
            )
        ))

        val ranking = repo.getGiftRanking("gift-1")

        assertEquals(1, ranking.size)
        assertEquals("u1", ranking[0].userId)
    }

    @Test
    fun `getGiftRanking handles entries with missing optional fields`() = runTest {
        mockRankingDoc("gift-1", true, mapOf(
            "rankings" to listOf(
                mapOf("userId" to "u1")
            )
        ))

        val ranking = repo.getGiftRanking("gift-1")

        assertEquals(1, ranking.size)
        assertEquals("u1", ranking[0].userId)
        assertEquals(0, ranking[0].count)
        assertEquals("", ranking[0].displayName)
        assertEquals(null, ranking[0].profilePhotoUrl)
    }

    @Test
    fun `getGiftRanking skips non-map entries in rankings list`() = runTest {
        mockRankingDoc("gift-1", true, mapOf(
            "rankings" to listOf(
                "not a map",
                42L,
                mapOf("userId" to "u1", "count" to 10L)
            )
        ))

        val ranking = repo.getGiftRanking("gift-1")

        assertEquals(1, ranking.size)
        assertEquals("u1", ranking[0].userId)
    }
}

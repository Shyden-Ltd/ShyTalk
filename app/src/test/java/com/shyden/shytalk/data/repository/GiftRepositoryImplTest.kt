package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for [GiftRepositoryImpl].
 *
 * All methods in this repository are Firestore-based. The real-time [Flow] methods
 * (observeGiftCatalog, observeAllGifts, observeBackpack, observeGiftWall, observeBroadcasts)
 * use addSnapshotListener and are exercised via integration tests. The two suspend methods
 * ([getGiftWallSenders] and [getGiftRanking]) are fully unit-testable here.
 */
class GiftRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: GiftRepositoryImpl

    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockCollRef: CollectionReference
    private lateinit var mockDocSnapshot: DocumentSnapshot

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        mockDocSnapshot = mockk(relaxed = true)

        every { firestore.document(any()) } returns mockDocRef
        every { firestore.collection(any()) } returns mockCollRef
        every { mockDocRef.get() } returns Tasks.forResult(mockDocSnapshot)
        every { mockDocSnapshot.data } returns null

        repo = GiftRepositoryImpl(api, firestore)
    }

    // ── getGiftWallSenders ────────────────────────────────────────────────

    @Test
    fun `getGiftWallSenders returns Success with gift sender list`() =
        runTest {
            val senderList =
                listOf(
                    mapOf("senderId" to "user-1", "sendCount" to 3L),
                    mapOf("senderId" to "user-2", "sendCount" to 1L),
                )
            every { mockDocSnapshot.data } returns mapOf("senders" to senderList)

            val result = repo.getGiftWallSenders("target-user", "gift-id-1")

            assertEquals(2, result.size)
            assertEquals("user-1", result[0].userId)
            assertEquals(3, result[0].count)
            assertEquals("user-2", result[1].userId)
            assertEquals(1, result[1].count)
        }

    @Test
    fun `getGiftWallSenders returns empty list when document has no data`() =
        runTest {
            every { mockDocSnapshot.data } returns null

            val result = repo.getGiftWallSenders("target-user", "missing-gift")

            assertTrue(result.isEmpty())
        }

    @Test
    fun `getGiftWallSenders returns empty list when senders field is missing`() =
        runTest {
            every { mockDocSnapshot.data } returns mapOf("someOtherField" to "value")

            val result = repo.getGiftWallSenders("target-user", "gift-id-1")

            assertTrue(result.isEmpty())
        }

    @Test
    fun `getGiftWallSenders returns Error on Firestore exception`() =
        runTest {
            every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Firestore unavailable"))

            val result = runCatching { repo.getGiftWallSenders("target-user", "gift-id-1") }

            assertTrue("Expected exception but got success", result.isFailure)
        }

    // ── getGiftRanking ────────────────────────────────────────────────────

    @Test
    fun `getGiftRanking returns Success with ranking list`() =
        runTest {
            val rankingList =
                listOf(
                    mapOf(
                        "userId" to "user-1",
                        "count" to 10L,
                        "displayName" to "Alice",
                        "profilePhotoUrl" to "https://img.example.com/alice.jpg",
                    ),
                    mapOf(
                        "userId" to "user-2",
                        "count" to 5L,
                        "displayName" to "Bob",
                        "profilePhotoUrl" to null,
                    ),
                )
            every { mockDocSnapshot.data } returns mapOf("rankings" to rankingList)

            val result = repo.getGiftRanking("gift-id-1")

            assertEquals(2, result.size)
            assertEquals("user-1", result[0].userId)
            assertEquals(10, result[0].count)
            assertEquals("Alice", result[0].displayName)
            assertEquals("https://img.example.com/alice.jpg", result[0].profilePhotoUrl)
            assertEquals("user-2", result[1].userId)
            assertEquals("Bob", result[1].displayName)
        }

    @Test
    fun `getGiftRanking returns empty list when document has no data`() =
        runTest {
            every { mockDocSnapshot.data } returns null

            val result = repo.getGiftRanking("missing-gift")

            assertTrue(result.isEmpty())
        }

    @Test
    fun `getGiftRanking returns Error on Firestore exception`() =
        runTest {
            every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Firestore unavailable"))

            val result = runCatching { repo.getGiftRanking("gift-id-1") }

            assertTrue("Expected exception but got success", result.isFailure)
        }
}

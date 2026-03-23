package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BannerRepositoryImplTest {
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: BannerRepositoryImpl

    private lateinit var mockCollRef: CollectionReference
    private lateinit var mockQuery: Query
    private lateinit var mockQuerySnapshot: QuerySnapshot

    // Freeze "now" once per test class to avoid drift between calls
    // The implementation calls System.currentTimeMillis() internally, so we keep a wide buffer (±100s).
    private val now = System.currentTimeMillis()

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        mockQuery = mockk(relaxed = true)
        mockQuerySnapshot = mockk(relaxed = true)

        every { firestore.collection("banners") } returns mockCollRef
        every { mockCollRef.whereEqualTo("isActive", true) } returns mockQuery
        every { mockQuery.get() } returns Tasks.forResult(mockQuerySnapshot)

        repo = BannerRepositoryImpl(firestore)
    }

    private fun makeDoc(
        id: String,
        startDate: Long = 0L,
        endDate: Long = Long.MAX_VALUE,
        sortOrder: Int = 0,
    ): DocumentSnapshot {
        val doc = mockk<DocumentSnapshot>(relaxed = true)
        every { doc.id } returns id
        every { doc.data } returns
            mapOf(
                "isActive" to true,
                "startDate" to startDate,
                "endDate" to endDate,
                "imageUrl" to "https://img.example.com/$id.jpg",
                "actionType" to "NONE",
                "sortOrder" to sortOrder.toLong(),
            )
        return doc
    }

    // ── Date-window filtering ──────────────────────────────────────────────

    @Test
    fun `getActiveBanners excludes banner with future startDate`() =
        runTest {
            val futureStart = now + 100_000L // starts 100 s from now
            val doc = makeDoc("future-banner", startDate = futureStart)
            every { mockQuerySnapshot.documents } returns listOf(doc)

            val result = repo.getActiveBanners()

            assertTrue("Expected empty list but got $result", result.isEmpty())
        }

    @Test
    fun `getActiveBanners excludes banner with past endDate`() =
        runTest {
            val pastEnd = now - 100_000L // ended 100 s ago
            val doc = makeDoc("expired-banner", endDate = pastEnd)
            every { mockQuerySnapshot.documents } returns listOf(doc)

            val result = repo.getActiveBanners()

            assertTrue("Expected empty list but got $result", result.isEmpty())
        }

    @Test
    fun `getActiveBanners includes banner with zero startDate`() =
        runTest {
            val doc = makeDoc("no-start-banner", startDate = 0L)
            every { mockQuerySnapshot.documents } returns listOf(doc)

            val result = repo.getActiveBanners()

            assertEquals(1, result.size)
            assertEquals("no-start-banner", result[0].id)
        }

    @Test
    fun `getActiveBanners includes banner with MAX_VALUE endDate`() =
        runTest {
            val doc = makeDoc("no-end-banner", endDate = Long.MAX_VALUE)
            every { mockQuerySnapshot.documents } returns listOf(doc)

            val result = repo.getActiveBanners()

            assertEquals(1, result.size)
            assertEquals("no-end-banner", result[0].id)
        }

    // ── Sorting ───────────────────────────────────────────────────────────

    @Test
    fun `getActiveBanners sorts results by sortOrder`() =
        runTest {
            val doc1 = makeDoc("banner-c", sortOrder = 30)
            val doc2 = makeDoc("banner-a", sortOrder = 10)
            val doc3 = makeDoc("banner-b", sortOrder = 20)
            every { mockQuerySnapshot.documents } returns listOf(doc1, doc2, doc3)

            val result = repo.getActiveBanners()

            assertEquals(listOf("banner-a", "banner-b", "banner-c"), result.map { it.id })
        }

    // ── Edge cases ────────────────────────────────────────────────────────

    @Test
    fun `getActiveBanners returns empty list when no banners match`() =
        runTest {
            every { mockQuerySnapshot.documents } returns emptyList()

            val result = repo.getActiveBanners()

            assertTrue(result.isEmpty())
        }

    @Test
    fun `getActiveBanners returns Error on Firestore exception`() =
        runTest {
            every { mockQuery.get() } returns Tasks.forException(RuntimeException("Firestore unavailable"))

            val result = runCatching { repo.getActiveBanners() }

            assertTrue("Expected exception but got success", result.isFailure)
        }
}

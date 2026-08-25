package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Banners come from the API now (EPIC-0006), so this tests a different job.
 *
 * It used to mock Firestore and assert the DATE FILTERING — future startDate
 * excluded, expired endDate excluded — because the phone did that work. The
 * phone does not any more: `GET /api/banners/active` filters and orders
 * server-side, and `express-api/tests/routes/banners.test.js` covers it there
 * ("filters out banners with a future startDate", "filters out banners with an
 * expired endDate", "includes a banner whose startDate is in the past and
 * endDate is in the future").
 *
 * That matters. Moving logic to the server without moving its tests loses the
 * coverage silently — the suite stays green because the assertions went with
 * the code, not because anything is still checked.
 *
 * What is left here is what the client still owns: ask the right endpoint, turn
 * the response into Banners, keep display order a property of the list, and
 * survive a malformed row.
 */
class BannerRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var repo: BannerRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = BannerRepositoryImpl(api)
    }

    private fun banner(
        id: String,
        sortOrder: Int = 0,
        imageUrl: String = "https://example.test/$id.png",
    ): JSONObject =
        JSONObject().apply {
            put("id", id)
            put("title", "Banner $id")
            put("imageUrl", imageUrl)
            put("actionType", "NONE")
            put("sortOrder", sortOrder)
        }

    private fun respondWith(vararg items: JSONObject) {
        val arr = JSONArray()
        items.forEach { arr.put(it) }
        coEvery { api.getArray(any()) } returns arr
    }

    @Test
    fun `getActiveBanners asks the API, not Firestore`() =
        runTest {
            respondWith(banner("a"))
            repo.getActiveBanners()
            coVerify { api.getArray("/api/banners/active") }
        }

    @Test
    fun `getActiveBanners maps the response into Banners`() =
        runTest {
            respondWith(banner("promo-1"), banner("promo-2"))
            val result = repo.getActiveBanners()
            assertEquals(2, result.size)
            assertEquals(listOf("promo-1", "promo-2"), result.map { it.id })
        }

    @Test
    fun `getActiveBanners orders by sortOrder`() =
        runTest {
            // Ordered by the server too, but asserted here so display order is a
            // property of this list rather than of the transport that fetched it.
            respondWith(
                banner("banner-c", sortOrder = 3),
                banner("banner-a", sortOrder = 1),
                banner("banner-b", sortOrder = 2),
            )
            val result = repo.getActiveBanners()
            assertEquals(listOf("banner-a", "banner-b", "banner-c"), result.map { it.id })
        }

    @Test
    fun `getActiveBanners returns empty when the API returns nothing`() =
        runTest {
            respondWith()
            assertTrue(repo.getActiveBanners().isEmpty())
        }

    @Test
    fun `getActiveBanners skips a row with no id rather than inventing one`() =
        runTest {
            // A banner with no document id cannot be acted on or dismissed, and a
            // blank id would collide with the next one. Dropped, not defaulted.
            val bad = JSONObject().apply { put("title", "no id") }
            respondWith(bad, banner("good"))
            val result = repo.getActiveBanners()
            assertEquals(listOf("good"), result.map { it.id })
        }
}

package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class GiftRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var repo: GiftRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = GiftRepositoryImpl(api)
    }

    // ── Gift catalog ────────────────────────────────────────────────────

    @Test
    fun `observeGiftCatalog returns parsed gifts from API`() = runTest {
        val arr = JSONArray().apply {
            put(JSONObject().apply {
                put("id", "gift-1")
                put("name", "Rose")
                put("coinValue", 100)
                put("showInStore", true)
            })
            put(JSONObject().apply {
                put("id", "gift-2")
                put("name", "Crown")
                put("coinValue", 500)
                put("showInStore", true)
            })
        }
        coEvery { api.getArray("/api/gifts") } returns arr

        val gifts = repo.observeGiftCatalog().first()

        assertEquals(2, gifts.size)
        assertEquals("Rose", gifts[0].name)
        assertEquals(100, gifts[0].coinValue)
        assertEquals("Crown", gifts[1].name)
    }

    @Test
    fun `observeAllGifts returns all gifts from API`() = runTest {
        val arr = JSONArray().apply {
            put(JSONObject().apply {
                put("id", "gift-1")
                put("name", "Rose")
                put("coinValue", 100)
            })
        }
        coEvery { api.getArray("/api/gifts/all") } returns arr

        val gifts = repo.observeAllGifts().first()

        assertEquals(1, gifts.size)
        assertEquals("gift-1", gifts[0].id)
    }

    // ── Gift rankings ───────────────────────────────────────────────────

    @Test
    fun `getGiftRanking returns parsed ranking from API`() = runTest {
        val json = JSONObject().apply {
            put("rankings", JSONArray().apply {
                put(JSONObject().apply {
                    put("userId", "u1")
                    put("count", 100)
                    put("displayName", "Top User")
                    put("profilePhotoUrl", "https://photo.url")
                })
                put(JSONObject().apply {
                    put("userId", "u2")
                    put("count", 50)
                    put("displayName", "Second")
                })
            })
        }
        coEvery { api.get("/api/gift-rankings/gift-1") } returns json

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
    fun `getGiftRanking returns empty when no rankings`() = runTest {
        coEvery { api.get("/api/gift-rankings/gift-1") } returns JSONObject()

        val ranking = repo.getGiftRanking("gift-1")

        assertTrue(ranking.isEmpty())
    }

    // ── Gift wall senders (now via Worker API) ──────────────────────────

    @Test
    fun `getGiftWallSenders returns senders from API`() = runTest {
        val arr = JSONArray().apply {
            put(JSONObject().apply {
                put("sender_id", "alice")
                put("send_count", 5)
            })
            put(JSONObject().apply {
                put("sender_id", "bob")
                put("send_count", 8)
            })
        }
        coEvery { api.getArray("/api/users/user-1/gift-wall/gift-1/senders") } returns arr

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertEquals(2, senders.size)
        assertEquals("alice", senders[0].userId)
        assertEquals(5, senders[0].count)
        assertEquals("bob", senders[1].userId)
        assertEquals(8, senders[1].count)
    }

    @Test
    fun `getGiftWallSenders returns empty when API returns empty array`() = runTest {
        coEvery { api.getArray("/api/users/user-1/gift-wall/gift-1/senders") } returns JSONArray()

        val senders = repo.getGiftWallSenders("user-1", "gift-1")

        assertTrue(senders.isEmpty())
    }
}

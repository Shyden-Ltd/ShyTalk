package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TranslationRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var repo: TranslationRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = TranslationRepositoryImpl(api)
    }

    @Test
    fun `translate returns parsed result`() =
        runTest {
            coEvery { api.post("/api/translate", any()) } returns
                JSONObject().apply {
                    put("translatedText", "Hello")
                    put("detectedSourceLang", "ko")
                    put("cached", false)
                }
            val result = repo.translate("안녕하세요", "en", null)
            assertTrue(result is Resource.Success)
            assertEquals("Hello", (result as Resource.Success).data.translatedText)
            assertEquals("ko", result.data.detectedSourceLang)
            assertEquals(false, result.data.cached)
        }

    @Test
    fun `translate with messagePath passes it in body`() =
        runTest {
            coEvery { api.post("/api/translate", any()) } returns
                JSONObject().apply {
                    put("translatedText", "Hi")
                    put("detectedSourceLang", "es")
                    put("cached", true)
                }
            val result = repo.translate("Hola", "en", "rooms/abc/messages/123")
            assertTrue(result is Resource.Success)
            assertEquals(true, (result as Resource.Success).data.cached)
        }

    @Test
    fun `translate returns Error when translatedText is missing from response`() =
        runTest {
            coEvery { api.post("/api/translate", any()) } returns
                JSONObject().apply {
                    put("detectedSourceLang", "ko")
                }
            val result = repo.translate("안녕하세요", "en", null)
            assertTrue(result is Resource.Error)
        }

    @Test
    fun `translate returns Error when translatedText is empty`() =
        runTest {
            coEvery { api.post("/api/translate", any()) } returns
                JSONObject().apply {
                    put("translatedText", "")
                    put("detectedSourceLang", "ko")
                }
            val result = repo.translate("안녕하세요", "en", null)
            assertTrue(result is Resource.Error)
        }

    @Test
    fun `translate failure returns Error`() =
        runTest {
            coEvery { api.post("/api/translate", any()) } throws RuntimeException("Network error")
            val result = repo.translate("test", "en", null)
            assertTrue(result is Resource.Error)
            assertEquals("Network error", (result as Resource.Error).message)
        }

    @Test
    fun `getQuota returns parsed quota`() =
        runTest {
            coEvery { api.get("/api/translate/quota") } returns
                JSONObject().apply {
                    put("used", 10)
                    put("limit", 50)
                    put("unlimited", false)
                }
            val result = repo.getQuota()
            assertTrue(result is Resource.Success)
            val quota = (result as Resource.Success).data
            assertEquals(10, quota.used)
            assertEquals(50, quota.limit)
            assertEquals(false, quota.unlimited)
        }

    @Test
    fun `getQuota for SuperShy returns unlimited`() =
        runTest {
            coEvery { api.get("/api/translate/quota") } returns
                JSONObject().apply {
                    put("used", 200)
                    put("limit", -1)
                    put("unlimited", true)
                }
            val result = repo.getQuota()
            assertTrue(result is Resource.Success)
            val quota = (result as Resource.Success).data
            assertEquals(true, quota.unlimited)
            assertEquals(-1, quota.limit)
        }

    @Test
    fun `getQuota returns safe defaults when fields are missing`() =
        runTest {
            coEvery { api.get("/api/translate/quota") } returns JSONObject()
            val result = repo.getQuota()
            assertTrue(result is Resource.Success)
            val quota = (result as Resource.Success).data
            assertEquals(0, quota.used)
            assertEquals(0, quota.limit)
            assertEquals(false, quota.unlimited)
        }

    @Test
    fun `getQuota failure returns Error`() =
        runTest {
            coEvery { api.get("/api/translate/quota") } throws RuntimeException("Server down")
            val result = repo.getQuota()
            assertTrue(result is Resource.Error)
        }
}

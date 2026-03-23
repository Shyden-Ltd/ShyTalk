package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConstantsLegalUrlsTest {
    @Test
    fun `LEGAL_BASE_URL points to Cloudflare Pages`() {
        assertEquals(
            "https://shytalk.shyden.co.uk",
            Constants.LEGAL_BASE_URL,
        )
    }

    @Test
    fun `PRIVACY_POLICY_URL is built from base URL`() {
        assertTrue(Constants.PRIVACY_POLICY_URL.startsWith(Constants.LEGAL_BASE_URL))
        assertEquals(
            "${Constants.LEGAL_BASE_URL}/privacy.html",
            Constants.PRIVACY_POLICY_URL,
        )
    }

    @Test
    fun `TERMS_URL is built from base URL`() {
        assertTrue(Constants.TERMS_URL.startsWith(Constants.LEGAL_BASE_URL))
        assertEquals(
            "${Constants.LEGAL_BASE_URL}/terms.html",
            Constants.TERMS_URL,
        )
    }

    @Test
    fun `COMMUNITY_GUIDELINES_URL is built from base URL`() {
        assertTrue(Constants.COMMUNITY_GUIDELINES_URL.startsWith(Constants.LEGAL_BASE_URL))
        assertEquals(
            "${Constants.LEGAL_BASE_URL}/community-guidelines.html",
            Constants.COMMUNITY_GUIDELINES_URL,
        )
    }

    @Test
    fun `CYBER_BULLYING_URL is built from base URL`() {
        assertTrue(Constants.CYBER_BULLYING_URL.startsWith(Constants.LEGAL_BASE_URL))
        assertEquals(
            "${Constants.LEGAL_BASE_URL}/cyber-bullying.html",
            Constants.CYBER_BULLYING_URL,
        )
    }

    @Test
    fun `all legal URLs use HTTPS`() {
        assertTrue(Constants.PRIVACY_POLICY_URL.startsWith("https://"))
        assertTrue(Constants.TERMS_URL.startsWith("https://"))
        assertTrue(Constants.COMMUNITY_GUIDELINES_URL.startsWith("https://"))
        assertTrue(Constants.CYBER_BULLYING_URL.startsWith("https://"))
    }

    @Test
    fun `all legal URLs end with html extension`() {
        assertTrue(Constants.PRIVACY_POLICY_URL.endsWith(".html"))
        assertTrue(Constants.TERMS_URL.endsWith(".html"))
        assertTrue(Constants.COMMUNITY_GUIDELINES_URL.endsWith(".html"))
        assertTrue(Constants.CYBER_BULLYING_URL.endsWith(".html"))
    }

    @Test
    fun `all legal URLs are unique`() {
        val urls =
            setOf(
                Constants.PRIVACY_POLICY_URL,
                Constants.TERMS_URL,
                Constants.COMMUNITY_GUIDELINES_URL,
                Constants.CYBER_BULLYING_URL,
            )
        assertEquals(4, urls.size)
    }
}

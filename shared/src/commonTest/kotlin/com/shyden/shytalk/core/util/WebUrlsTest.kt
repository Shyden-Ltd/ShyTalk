package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0182 — the app must open the ENVIRONMENT-correct web pages, in the
 * app's language, NEVER crossing environments ([[feedback-web-urls-env-derived-never-cross]]).
 *
 * This is the operator-mandated cross-environment-CONTAMINATION suite: for
 * every environment, every web URL builds from THAT env's host, carries the
 * app locale as `?lang=`, and — the negative half — yields ZERO other-env
 * hosts across every (doc × locale) pair. Value-level and exhaustive.
 */
class WebUrlsTest {
    // The 20 translated locales + the `en` base — the full set the app ships
    // (matches SHY-0181's resolver). Region-less codes, as LanguagePreference stores them.
    private val allLocales =
        listOf(
            "en",
            "ar",
            "de",
            "es",
            "fr",
            "hi",
            "id",
            "it",
            "ja",
            "km",
            "ko",
            "nl",
            "pl",
            "pt",
            "ru",
            "sv",
            "th",
            "tr",
            "uk",
            "vi",
            "zh",
        )

    private val allDocs = WebUrls.LegalDoc.entries

    // ── baseUrl: exact host per environment ─────────────────────────────

    @Test
    fun `prod environment resolves the prod web host`() {
        assertEquals("https://shytalk.shyden.co.uk", WebUrls.baseUrl("prod"))
    }

    @Test
    fun `dev environment resolves the dev web host`() {
        assertEquals("https://dev.shytalk.shyden.co.uk", WebUrls.baseUrl("dev"))
    }

    @Test
    fun `local environment resolves the default local host when no override`() {
        assertEquals("http://localhost:8888", WebUrls.baseUrl("local"))
    }

    @Test
    fun `local environment honors an on-device host override`() {
        // The real device reaches the local server over the adb-reverse / LAN
        // bridge, not the Mac's literal localhost — the caller injects it.
        assertEquals("http://10.0.2.2:8888", WebUrls.baseUrl("local", localHost = "http://10.0.2.2:8888"))
    }

    @Test
    fun `local host override with a trailing slash is normalized`() {
        assertEquals("http://192.168.1.5:8888", WebUrls.baseUrl("local", localHost = "http://192.168.1.5:8888/"))
    }

    @Test
    fun `a blank local override falls back to the default local host`() {
        assertEquals("http://localhost:8888", WebUrls.baseUrl("local", localHost = "   "))
    }

    // ── baseUrl: fail closed + loud on an unknown environment ────────────

    @Test
    fun `an unknown environment fails loud, never silently crossing to prod`() {
        val ex = assertFailsWith<IllegalArgumentException> { WebUrls.baseUrl("staging") }
        // The message names the offending env and does NOT hand back a prod URL.
        assertTrue(ex.message!!.contains("staging"))
        assertFalse(ex.message!!.contains("shytalk.shyden.co.uk"))
    }

    @Test
    fun `an empty environment fails loud`() {
        assertFailsWith<IllegalArgumentException> { WebUrls.baseUrl("") }
    }

    // ── legal(): exact URL per (doc × env × locale) ─────────────────────

    @Test
    fun `legal URLs use the real Cloudflare page filenames`() {
        assertEquals("privacy.html", WebUrls.LegalDoc.PRIVACY.page)
        assertEquals("terms.html", WebUrls.LegalDoc.TERMS.page)
        assertEquals("community-guidelines.html", WebUrls.LegalDoc.COMMUNITY.page)
        assertEquals("cyber-bullying.html", WebUrls.LegalDoc.CYBER_BULLYING.page)
    }

    @Test
    fun `dev privacy in French is the exact dev host, page and lang`() {
        assertEquals(
            "https://dev.shytalk.shyden.co.uk/privacy.html?lang=fr",
            WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = "dev", locale = "fr"),
        )
    }

    @Test
    fun `prod terms in Arabic is the exact prod host, page and lang`() {
        assertEquals(
            "https://shytalk.shyden.co.uk/terms.html?lang=ar",
            WebUrls.legal(WebUrls.LegalDoc.TERMS, environment = "prod", locale = "ar"),
        )
    }

    @Test
    fun `local community-guidelines carries the injected host, page and lang`() {
        assertEquals(
            "http://10.0.2.2:8888/community-guidelines.html?lang=ja",
            WebUrls.legal(
                WebUrls.LegalDoc.COMMUNITY,
                environment = "local",
                locale = "ja",
                localHost = "http://10.0.2.2:8888",
            ),
        )
    }

    @Test
    fun `every (doc x env x locale) builds the exact expected URL`() {
        val expectedHost = mapOf("prod" to "https://shytalk.shyden.co.uk", "dev" to "https://dev.shytalk.shyden.co.uk")
        for (env in listOf("prod", "dev")) {
            for (doc in allDocs) {
                for (locale in allLocales) {
                    assertEquals(
                        "${expectedHost[env]}/${doc.page}?lang=$locale",
                        WebUrls.legal(doc, environment = env, locale = locale),
                        "wrong URL for $doc / $env / $locale",
                    )
                }
            }
        }
    }

    // ── The CONTAMINATION guarantee (operator-mandated negatives) ────────

    // The URL authority — the host[:port] between `://` and the first `/`.
    // Compared EXACTLY, because the prod host `shytalk.shyden.co.uk` is a
    // strict SUFFIX of the dev host `dev.shytalk.shyden.co.uk`; a bare
    // substring check would false-positive a "leak" on every dev URL.
    private fun authorityOf(url: String): String = url.substringAfter("://").substringBefore("/")

    @Test
    fun `each environment's URLs carry ONLY that environment's host authority`() {
        val authorityByEnv =
            mapOf(
                "prod" to "shytalk.shyden.co.uk",
                "dev" to "dev.shytalk.shyden.co.uk",
                "local" to "localhost:8888",
            )
        for ((env, ownAuthority) in authorityByEnv) {
            val foreignAuthorities = authorityByEnv.filterKeys { it != env }.values
            for (doc in allDocs) {
                for (locale in allLocales) {
                    val url = WebUrls.legal(doc, environment = env, locale = locale)
                    assertEquals(ownAuthority, authorityOf(url), "$env URL '$url' has the wrong host authority")
                    // …and therefore matches NONE of the other environments' authorities.
                    for (foreign in foreignAuthorities) {
                        assertFalse(authorityOf(url) == foreign, "cross-env leak: $env URL '$url' resolves to '$foreign'")
                    }
                }
            }
        }
    }

    @Test
    fun `a dev build never emits the prod host across the whole legal surface`() {
        for (doc in allDocs) {
            for (locale in allLocales) {
                val url = WebUrls.legal(doc, environment = "dev", locale = locale)
                assertTrue(url.startsWith("https://dev.shytalk.shyden.co.uk/"), "dev URL off-host: $url")
                // The prod host is a strict substring of the dev host, so guard on the
                // scheme+host boundary, not a bare contains.
                assertFalse(url.startsWith("https://shytalk.shyden.co.uk/"), "dev build leaked prod host: $url")
            }
        }
    }

    @Test
    fun `the lang parameter always equals the app locale exactly`() {
        for (env in listOf("prod", "dev")) {
            for (locale in allLocales) {
                val url = WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = env, locale = locale)
                assertEquals("lang=$locale", url.substringAfter("?"), "wrong lang param for $env/$locale")
            }
        }
    }

    // ── local web host derived from the injected API base URL ────────────

    @Test
    fun `local web host swaps the API port 3000 for the web port 8888`() {
        assertEquals("http://10.0.2.2:8888", WebUrls.localWebHostFromApi("http://10.0.2.2:3000"))
        assertEquals("http://192.168.1.5:8888", WebUrls.localWebHostFromApi("http://192.168.1.5:3000"))
        assertEquals("http://localhost:8888", WebUrls.localWebHostFromApi("http://localhost:3000/"))
    }

    @Test
    fun `local web host derivation returns null for a blank or absent API url`() {
        assertEquals(null, WebUrls.localWebHostFromApi(null))
        assertEquals(null, WebUrls.localWebHostFromApi(""))
        assertEquals(null, WebUrls.localWebHostFromApi("   "))
    }

    @Test
    fun `a derived local host flows through legal() to a reachable web URL`() {
        val host = WebUrls.localWebHostFromApi("http://10.0.2.2:3000")
        assertEquals(
            "http://10.0.2.2:8888/terms.html?lang=de",
            WebUrls.legal(WebUrls.LegalDoc.TERMS, environment = "local", locale = "de", localHost = host),
        )
    }

    // ── isSameOrigin: the WebView nav-gate (SECURITY) ────────────────────

    @Test
    fun `same host, different page is same-origin (in-page navigation allowed)`() {
        val loaded = WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = "dev", locale = "en")
        assertTrue(WebUrls.isSameOrigin(loaded, "https://dev.shytalk.shyden.co.uk/terms.html"))
        assertTrue(WebUrls.isSameOrigin(loaded, "https://DEV.SHYTALK.SHYDEN.CO.UK/terms.html")) // host case-insensitive
    }

    @Test
    fun `a plainly different host is NOT same-origin`() {
        val loaded = "https://dev.shytalk.shyden.co.uk/privacy.html?lang=en"
        assertFalse(WebUrls.isSameOrigin(loaded, "https://evil.example.com/"))
        assertFalse(WebUrls.isSameOrigin(loaded, "https://shytalk.shyden.co.uk/terms.html")) // prod ≠ dev
    }

    @Test
    fun `userinfo-embedded host does NOT bypass the gate`() {
        // `https://dev.shytalk.shyden.co.uk@evil.com/` prefix-matches the loaded
        // origin but its REAL host is evil.com — the old startsWith gate allowed it.
        val loaded = "https://dev.shytalk.shyden.co.uk/privacy.html"
        assertFalse(WebUrls.isSameOrigin(loaded, "https://dev.shytalk.shyden.co.uk@evil.com/"))
        assertFalse(WebUrls.isSameOrigin(loaded, "https://dev.shytalk.shyden.co.uk:443@evil.com/x"))
    }

    @Test
    fun `a suffix-domain host does NOT bypass the gate`() {
        // `dev.shytalk.shyden.co.uk.evil.com` prefix-matches but is evil.com's subdomain.
        val loaded = "https://dev.shytalk.shyden.co.uk/privacy.html"
        assertFalse(WebUrls.isSameOrigin(loaded, "https://dev.shytalk.shyden.co.uk.evil.com/"))
        assertFalse(WebUrls.isSameOrigin(loaded, "https://dev.shytalk.shyden.co.uk-evil.com/"))
    }

    @Test
    fun `a different scheme is NOT same-origin`() {
        val loaded = "https://dev.shytalk.shyden.co.uk/privacy.html"
        assertFalse(WebUrls.isSameOrigin(loaded, "http://dev.shytalk.shyden.co.uk/terms.html"))
    }

    @Test
    fun `a different port is NOT same-origin`() {
        val loaded = "http://10.0.2.2:8888/privacy.html"
        assertTrue(WebUrls.isSameOrigin(loaded, "http://10.0.2.2:8888/terms.html"))
        assertFalse(WebUrls.isSameOrigin(loaded, "http://10.0.2.2:3000/terms.html"))
    }

    @Test
    fun `non-http(s) and malformed request URLs fail closed`() {
        val loaded = "https://dev.shytalk.shyden.co.uk/privacy.html"
        assertFalse(WebUrls.isSameOrigin(loaded, "javascript:alert(1)"))
        assertFalse(WebUrls.isSameOrigin(loaded, "data:text/html,<script>alert(1)</script>"))
        assertFalse(WebUrls.isSameOrigin(loaded, "about:blank"))
        assertFalse(WebUrls.isSameOrigin(loaded, "intent://evil#Intent;scheme=https;end"))
        assertFalse(WebUrls.isSameOrigin(loaded, "not-a-url"))
        assertFalse(WebUrls.isSameOrigin(loaded, ""))
    }

    @Test
    fun `a malformed LOADED url also fails closed`() {
        // Defensive: even if the page was somehow loaded from a junk URL, gate closed.
        assertFalse(WebUrls.isSameOrigin("garbage", "https://dev.shytalk.shyden.co.uk/x.html"))
    }

    @Test
    fun `every legal URL is same-origin with a sibling page but not the other env`() {
        for (env in listOf("prod", "dev")) {
            val loaded = WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = env, locale = "en")
            val sameHostSibling = WebUrls.legal(WebUrls.LegalDoc.TERMS, environment = env, locale = "de")
            assertTrue(WebUrls.isSameOrigin(loaded, sameHostSibling), "$env sibling should be same-origin")
            val otherEnv = if (env == "prod") "dev" else "prod"
            val crossEnv = WebUrls.legal(WebUrls.LegalDoc.TERMS, environment = otherEnv, locale = "de")
            assertFalse(WebUrls.isSameOrigin(loaded, crossEnv), "$env must not be same-origin as $otherEnv")
        }
    }

    // ── legal(): locale validation ───────────────────────────────────────

    @Test
    fun `a blank locale fails loud rather than emitting a lang-less URL`() {
        assertFailsWith<IllegalArgumentException> {
            WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = "dev", locale = "  ")
        }
    }
}

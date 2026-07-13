package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.BuildVariant
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
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

    // The *ForCurrentBuild tests mutate the process-global BuildVariant +
    // LanguagePreference; reset both after EVERY test so a set state can't leak
    // into another test ([[feedback-test-isolation-no-leaks]] HARD rule).
    @AfterTest
    fun resetGlobalState() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "?", deviceInfo = "?")
        BuildVariant.initApiBaseUrl(null)
        BuildVariant.initDevWebAuthPassword(null)
        LanguagePreference.set("en")
    }

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
    fun `local web host derivation returns a non-3000 URL unchanged (documented passthrough)`() {
        // Pins the current contract: only the `:3000`→`:8888` port swap is applied;
        // a URL without `:3000` passes through untouched. Safe in production (the
        // caller only invokes this for `local`, whose API URL always carries :3000),
        // but pinned so a future refactor that routes a non-:3000 URL here is a
        // conscious decision, not a silent surprise.
        assertEquals(
            "https://dev-api.shytalk.shyden.co.uk",
            WebUrls.localWebHostFromApi("https://dev-api.shytalk.shyden.co.uk"),
        )
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

    // ── devWebBasicAuth: dev-page credential (fail-closed) ───────────────

    @Test
    fun `dev build presents the credential to its own dev host`() {
        assertEquals(
            "shytalk-app" to "s3cret",
            WebUrls.devWebBasicAuth("dev", challengingHost = "dev.shytalk.shyden.co.uk", password = "s3cret"),
        )
        // Host comparison is case-insensitive (DNS).
        assertEquals(
            "shytalk-app" to "s3cret",
            WebUrls.devWebBasicAuth("dev", challengingHost = "DEV.SHYTALK.SHYDEN.CO.UK", password = "s3cret"),
        )
    }

    @Test
    fun `prod and local never present a credential`() {
        assertEquals(null, WebUrls.devWebBasicAuth("prod", "dev.shytalk.shyden.co.uk", "s3cret"))
        assertEquals(null, WebUrls.devWebBasicAuth("local", "dev.shytalk.shyden.co.uk", "s3cret"))
    }

    @Test
    fun `a missing or blank password authenticates nothing (fail-closed)`() {
        assertEquals(null, WebUrls.devWebBasicAuth("dev", "dev.shytalk.shyden.co.uk", null))
        assertEquals(null, WebUrls.devWebBasicAuth("dev", "dev.shytalk.shyden.co.uk", ""))
    }

    @Test
    fun `the secret is NEVER sent to a host other than the dev web host`() {
        // Defends against handing the dev password to an off-site redirect's challenger.
        for (host in listOf(
            "evil.com",
            "dev-api.shytalk.shyden.co.uk",
            "shytalk.shyden.co.uk",
            "dev.shytalk.shyden.co.uk.evil.com",
            null,
        )) {
            assertEquals(null, WebUrls.devWebBasicAuth("dev", host, "s3cret"), "leaked secret to host=$host")
        }
    }

    // ── legalForCurrentBuild: the LIVE wiring the app screens call ───────
    // These drive the real BuildVariant + LanguagePreference so a broken wire
    // (wrong env field, dropped local-host derivation, wrong locale source)
    // is caught — the pure legal() tests above would stay green through it.

    @Test
    fun `legalForCurrentBuild on a dev build uses the dev host and the app locale`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        LanguagePreference.set("fr")
        assertEquals(
            "https://dev.shytalk.shyden.co.uk/privacy.html?lang=fr",
            WebUrls.legalForCurrentBuild(WebUrls.LegalDoc.PRIVACY),
        )
    }

    @Test
    fun `legalForCurrentBuild on a prod build uses the prod host (no cross-env)`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "1.0")
        LanguagePreference.set("ar")
        assertEquals(
            "https://shytalk.shyden.co.uk/terms.html?lang=ar",
            WebUrls.legalForCurrentBuild(WebUrls.LegalDoc.TERMS),
        )
    }

    @Test
    fun `legalForCurrentBuild on a local build derives the reachable host from the API bridge`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0")
        BuildVariant.initApiBaseUrl("http://10.0.2.2:3000")
        LanguagePreference.set("de")
        assertEquals(
            "http://10.0.2.2:8888/community-guidelines.html?lang=de",
            WebUrls.legalForCurrentBuild(WebUrls.LegalDoc.COMMUNITY),
        )
    }

    @Test
    fun `legalForCurrentBuild on a local build with no API url falls back to the default local host`() {
        BuildVariant.initBuildInfo(environment = "local", buildVersion = "1.0")
        // apiBaseUrl left null → localWebHostFromApi(null) → default local host.
        LanguagePreference.set("en")
        assertEquals(
            "http://localhost:8888/cyber-bullying.html?lang=en",
            WebUrls.legalForCurrentBuild(WebUrls.LegalDoc.CYBER_BULLYING),
        )
    }

    // ── devWebBasicAuthForCurrentBuild: live BuildVariant wiring ─────────

    @Test
    fun `devWebBasicAuthForCurrentBuild returns creds on a dev build with the secret set`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        assertEquals(
            "shytalk-app" to "s3cret",
            WebUrls.devWebBasicAuthForCurrentBuild("dev.shytalk.shyden.co.uk"),
        )
    }

    @Test
    fun `devWebBasicAuthForCurrentBuild returns null on a prod build even if a secret leaked in`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret") // defence-in-depth: env gate still wins
        assertNull(WebUrls.devWebBasicAuthForCurrentBuild("dev.shytalk.shyden.co.uk"))
    }

    @Test
    fun `devWebBasicAuthForCurrentBuild returns null on a dev build with no secret provisioned`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        // devWebAuthPassword left null (secret not baked into this build).
        assertNull(WebUrls.devWebBasicAuthForCurrentBuild("dev.shytalk.shyden.co.uk"))
    }

    // ── webViewAuthChallengeAction: iOS WKWebView challenge disposition ──
    // The pure decision the iOS delegate translates into completionHandler
    // dispositions. Mirrors Android's onReceivedHttpAuthRequest (proceed/cancel)
    // AND adds the iOS-only third case: a non-Basic challenge (TLS server-trust)
    // must fall through to PerformDefault, never be cancelled.

    @Test
    fun `a Basic-auth challenge on a dev build with the secret uses the credential`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.UseCredential("shytalk-app", "s3cret"),
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = true,
                challengingHost = "dev.shytalk.shyden.co.uk",
            ),
        )
    }

    @Test
    fun `a Basic-auth challenge from a NON-dev host is cancelled (secret never leaks off-host)`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        // An off-site redirect challenges us — the dev secret is gated to our host.
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.Cancel,
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = true,
                challengingHost = "evil.example.com",
            ),
        )
    }

    @Test
    fun `a Basic-auth challenge on a PROD build is cancelled even if a secret leaked in`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret") // env gate still wins
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.Cancel,
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = true,
                challengingHost = "dev.shytalk.shyden.co.uk",
            ),
        )
    }

    @Test
    fun `a Basic-auth challenge on a dev build with no secret is cancelled`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        // devWebAuthPassword left null — nothing to answer with.
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.Cancel,
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = true,
                challengingHost = "dev.shytalk.shyden.co.uk",
            ),
        )
    }

    @Test
    fun `a NON-Basic challenge falls through to default handling even when creds are available`() {
        // A TLS server-trust challenge on a dev build with the secret set: we
        // must NOT answer it with the Basic password and must NOT cancel it
        // (that would break HTTPS) — the platform validates the certificate.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.PerformDefault,
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = false,
                challengingHost = "dev.shytalk.shyden.co.uk",
            ),
        )
    }

    @Test
    fun `a NON-Basic challenge on a prod build also falls through to default handling`() {
        BuildVariant.initBuildInfo(environment = "prod", buildVersion = "1.0")
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.PerformDefault,
            WebUrls.webViewAuthChallengeAction(
                isBasicAuthChallenge = false,
                challengingHost = "shytalk.shyden.co.uk",
            ),
        )
    }

    @Test
    fun `a Basic-auth challenge with a null challenging host is cancelled`() {
        // The nullable-host boundary pinned at THIS function (not only via the
        // composed devWebBasicAuth): a challenge with no host can't be our dev
        // host, so no credential is offered.
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.Cancel,
            WebUrls.webViewAuthChallengeAction(isBasicAuthChallenge = true, challengingHost = null),
        )
    }

    @Test
    fun `a Basic-auth challenge with a blank challenging host is cancelled`() {
        BuildVariant.initBuildInfo(environment = "dev", buildVersion = "1.0")
        BuildVariant.initDevWebAuthPassword("s3cret")
        assertEquals(
            WebUrls.WebViewAuthChallengeAction.Cancel,
            WebUrls.webViewAuthChallengeAction(isBasicAuthChallenge = true, challengingHost = ""),
        )
    }

    @Test
    fun `UseCredential toString redacts the password (never logs the dev secret)`() {
        // Security AC: the dev-page credential must never be logged. The
        // data-class auto-toString would print the password verbatim; the
        // override masks it, so a future debug log of the action can't leak it.
        val rendered = WebUrls.WebViewAuthChallengeAction.UseCredential("shytalk-app", "s3cret").toString()
        assertFalse(rendered.contains("s3cret"), "toString leaked the password: $rendered")
        assertTrue(rendered.contains("shytalk-app"), "toString should still name the username")
        assertTrue(rendered.contains("***"), "toString should mark the password redacted")
    }

    // ── shouldAllowWebViewNavigation: iOS nav-gate (initial-load aware) ──
    // iOS WKWebView calls its nav-policy delegate for the FIRST programmatic
    // load too (Android's shouldOverrideUrlLoading does not) — so a null current
    // URL means "initial load" and must be allowed, else the page never appears.

    @Test
    fun `the initial load is allowed (no page displayed yet)`() {
        assertTrue(
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = null,
                targetUrl = "https://dev.shytalk.shyden.co.uk/privacy.html?lang=en",
            ),
        )
    }

    @Test
    fun `same-origin in-page navigation is allowed`() {
        assertTrue(
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = "https://dev.shytalk.shyden.co.uk/privacy.html",
                targetUrl = "https://dev.shytalk.shyden.co.uk/terms.html",
            ),
        )
    }

    @Test
    fun `off-origin navigation is blocked`() {
        assertFalse(
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = "https://dev.shytalk.shyden.co.uk/privacy.html",
                targetUrl = "https://evil.example.com/phish.html",
            ),
        )
    }

    @Test
    fun `a userinfo-injection target is blocked (not treated as same-origin)`() {
        // The exact bypass isSameOrigin closes: `host@evil.com` starts with the
        // loaded host but is really evil.com.
        assertFalse(
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = "https://dev.shytalk.shyden.co.uk/privacy.html",
                targetUrl = "https://dev.shytalk.shyden.co.uk@evil.example.com/phish.html",
            ),
        )
    }

    @Test
    fun `a null target on a loaded page is blocked (fail closed)`() {
        assertFalse(
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = "https://dev.shytalk.shyden.co.uk/privacy.html",
                targetUrl = null,
            ),
        )
    }

    @Test
    fun `both current and target null takes the initial-load branch (pins check order)`() {
        // With nothing loaded yet the initial-load allowance wins over the
        // loaded-page fail-closed rule — this is the ONLY input that distinguishes
        // the two early-return checks, so it pins their order against a reorder
        // mutant that the other nav cases can't see.
        assertTrue(
            WebUrls.shouldAllowWebViewNavigation(currentUrl = null, targetUrl = null),
        )
    }

    // ── legal(): locale validation ───────────────────────────────────────

    @Test
    fun `a blank locale fails loud rather than emitting a lang-less URL`() {
        assertFailsWith<IllegalArgumentException> {
            WebUrls.legal(WebUrls.LegalDoc.PRIVACY, environment = "dev", locale = "  ")
        }
    }
}

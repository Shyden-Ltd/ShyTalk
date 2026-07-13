package com.shyden.shytalk.core.util

import com.shyden.shytalk.core.BuildVariant

/**
 * Builds every web URL the app opens from the build's OWN environment, so a
 * dev/local build never opens prod pages (or vice-versa) — the hard rule
 * [[feedback-web-urls-env-derived-never-cross]]. Web hosts derive from the
 * same `BuildVariant.environment` string that already drives `apiBaseUrl`.
 *
 * SHY-0182. Pure + synchronous (no network round-trip to resolve host/locale)
 * so the cross-environment-contamination suite can pin every (env × locale).
 *
 * The legacy `Constants.LEGAL_BASE_URL` hardcoded the prod host — every non-prod
 * build silently opened prod legal pages. Callers now go through [legal] /
 * [legalForCurrentBuild] instead of the removed `Constants.*_URL` constants.
 */
object WebUrls {
    /** Canonical prod web host (Cloudflare Pages project `shytalk-site`). */
    const val PROD_HOST: String = "https://shytalk.shyden.co.uk"

    /** Canonical dev web host (Cloudflare Pages project `shytalk-site-dev`). */
    const val DEV_HOST: String = "https://dev.shytalk.shyden.co.uk"

    /** The dev web host authority (no scheme) — the ONLY host the app hands its Basic-auth secret to. */
    const val DEV_HOST_AUTHORITY: String = "dev.shytalk.shyden.co.uk"

    /**
     * Username in the dev-page Basic-auth handshake. The edge middleware
     * (`functions/_lib/lockdown.js`) ignores the username and checks only the
     * password, so any non-empty value works; a fixed placeholder keeps it
     * identifiable in access logs.
     */
    const val DEV_WEB_AUTH_USERNAME: String = "shytalk-app"

    /**
     * Fallback local web host when the caller injects none. The local server
     * (`local/serve-web.js`) listens on :8888; a real device reaches it over
     * the adb-reverse / LAN bridge, so the caller SHOULD pass the reachable
     * host — this default only covers the emulator/Mac-localhost case.
     */
    const val DEFAULT_LOCAL_HOST: String = "http://localhost:8888"

    /**
     * The legal documents the app links to, each pinned to its REAL published
     * Cloudflare Pages filename (not the story shorthand). Adding a doc here is
     * the single edit needed to cover it in every environment + locale.
     */
    enum class LegalDoc(
        val page: String,
    ) {
        PRIVACY("privacy.html"),
        TERMS("terms.html"),
        COMMUNITY("community-guidelines.html"),
        CYBER_BULLYING("cyber-bullying.html"),
    }

    /**
     * The web host base for [environment] (`"local"` / `"dev"` / `"prod"`).
     *
     * Fails **closed + loud** on any other value: it throws rather than fall
     * back to a prod URL, because a silent prod fallback is exactly the
     * cross-environment leak this class exists to prevent. In practice
     * `BuildVariant.environment` is coerced to one of the three, so an unknown
     * value signals a programming error, which should surface — not hide.
     *
     * @param localHost on-device-reachable local host (e.g. `http://10.0.2.2:8888`);
     *   blank/null falls back to [DEFAULT_LOCAL_HOST]. Ignored for dev/prod.
     */
    fun baseUrl(
        environment: String,
        localHost: String? = null,
    ): String =
        when (environment) {
            "prod" -> PROD_HOST

            "dev" -> DEV_HOST

            "local" -> (localHost?.takeIf { it.isNotBlank() } ?: DEFAULT_LOCAL_HOST).trimEnd('/')

            else ->
                throw IllegalArgumentException(
                    "WebUrls: refusing unknown environment '$environment' — would risk crossing environments",
                )
        }

    /**
     * Full URL for [doc] on [environment]'s host, carrying `?lang=<locale>` so
     * SHY-0181's site-wide resolver renders it in the app language.
     *
     * @param locale the app locale (e.g. from `LanguagePreference.get()`);
     *   must be non-blank (a lang-less URL would defeat the whole point).
     */
    fun legal(
        doc: LegalDoc,
        environment: String,
        locale: String,
        localHost: String? = null,
    ): String {
        require(locale.isNotBlank()) { "WebUrls.legal: locale must not be blank" }
        return "${baseUrl(environment, localHost)}/${doc.page}?lang=${locale.trim()}"
    }

    /**
     * Convenience for the app's Compose screens: builds [doc]'s URL from the
     * live [BuildVariant.environment] + [LanguagePreference.get]. Kept thin so
     * the pure [legal] carries all the logic + the exhaustive test coverage.
     *
     * For a `local` build it derives the on-device-reachable web host from the
     * already-injected [BuildVariant.apiBaseUrl] (via [localWebHostFromApi]),
     * so a real device hits the same bridge the API uses rather than the Mac's
     * literal `localhost`.
     */
    fun legalForCurrentBuild(doc: LegalDoc): String {
        val localHost =
            if (BuildVariant.environment == "local") localWebHostFromApi(BuildVariant.apiBaseUrl) else null
        return legal(doc, BuildVariant.environment, LanguagePreference.get(), localHost)
    }

    /**
     * True iff [requestUrl] has the SAME origin (scheme + host + port) as
     * [loadedUrl]. The Android WebView nav-gate uses this to keep in-page
     * navigation on the host the legal page was loaded from, for ANY
     * environment — replacing the old hardcoded-prod `startsWith(LEGAL_BASE_URL)`.
     *
     * SECURITY: this is an EXACT component comparison, deliberately NOT a
     * `startsWith` prefix match. A prefix check treats
     * `https://host@evil.com/` and `https://host.evil.com/` as same-origin
     * (both literally start with `https://host`), which would let an
     * attacker-controlled link navigate the JS-enabled WebView off-origin.
     * We reject any userinfo (`@` in the authority) and any non-http(s)
     * scheme, and fail CLOSED (return false → block) on any parse failure.
     * [[feedback-no-string-ordering-for-security-decisions]]
     */
    fun isSameOrigin(
        loadedUrl: String,
        requestUrl: String,
    ): Boolean {
        val loaded = originComponents(loadedUrl) ?: return false
        val request = originComponents(requestUrl) ?: return false
        return loaded == request
    }

    /**
     * Whether the WKWebView should ALLOW a navigation to [targetUrl] while the
     * currently-displayed page is [currentUrl]. This is the iOS counterpart of
     * the Android nav-gate, which is a straight [isSameOrigin] call — but iOS
     * WKWebView invokes its navigation-policy delegate for the FIRST programmatic
     * load too (Android's `shouldOverrideUrlLoading` does not). Before anything
     * is committed [currentUrl] is null; that initial load MUST be allowed or the
     * page never appears. Every subsequent navigation is the same same-origin
     * gate (stay on the host the legal page loaded from, block off-origin links),
     * and a null/unparseable [targetUrl] fails CLOSED (block).
     */
    fun shouldAllowWebViewNavigation(
        currentUrl: String?,
        targetUrl: String?,
    ): Boolean {
        if (currentUrl == null) return true // initial load — nothing displayed yet
        if (targetUrl == null) return false // fail closed
        return isSameOrigin(currentUrl, targetUrl)
    }

    /**
     * The normalized `scheme://authority` origin of [url] (scheme + authority
     * lowercased, port retained), or null when [url] is not a plain http(s)
     * URL or carries userinfo — cases that must never match a legitimate
     * loaded legal page and so fail closed. The authority is the run of
     * characters after `://` up to the first `/`, `?` or `#`.
     */
    private fun originComponents(url: String): String? {
        val schemeSep = url.indexOf("://")
        if (schemeSep <= 0) return null
        val scheme = url.substring(0, schemeSep).lowercase()
        if (scheme != "http" && scheme != "https") return null
        val authority = url.substring(schemeSep + 3).takeWhile { it != '/' && it != '?' && it != '#' }
        if (authority.isEmpty() || '@' in authority) return null
        return "$scheme://${authority.lowercase()}"
    }

    /**
     * The Basic-auth credential (username to password) the app must present to
     * a dev-web Basic-auth challenge from [challengingHost], or null to send
     * NONE. Fails closed on every axis:
     *  - only `dev` builds ever authenticate (prod web is public; local isn't gated);
     *  - the secret goes ONLY to our own dev host [DEV_HOST_AUTHORITY] — a
     *    challenge from any other host (e.g. after an off-site redirect) gets
     *    nothing, so the secret can't leak to an attacker-controlled challenger;
     *  - a blank/absent [password] (build without the secret) authenticates nothing.
     *
     * @param challengingHost the host issuing the 401 (Android's
     *   `onReceivedHttpAuthRequest` host arg / WKWebView challenge host).
     */
    fun devWebBasicAuth(
        environment: String,
        challengingHost: String?,
        password: String?,
    ): Pair<String, String>? {
        if (environment != "dev") return null
        if (password.isNullOrEmpty()) return null
        if (challengingHost?.lowercase() != DEV_HOST_AUTHORITY) return null
        return DEV_WEB_AUTH_USERNAME to password
    }

    /**
     * Convenience over [devWebBasicAuth] reading the live [BuildVariant]
     * ([BuildVariant.environment] + [BuildVariant.devWebAuthPassword]); the
     * platform WebView auth-challenge handler calls this with the challenging host.
     */
    fun devWebBasicAuthForCurrentBuild(challengingHost: String?): Pair<String, String>? =
        devWebBasicAuth(BuildVariant.environment, challengingHost, BuildVariant.devWebAuthPassword)

    /**
     * What a WKWebView auth-challenge delegate should do, decided here in
     * commonMain so the iOS delegate is a thin, on-device-untestable-glue-free
     * translation into `completionHandler` dispositions (this decision carries
     * the unit-test coverage). Android needs no equivalent type — its
     * `onReceivedHttpAuthRequest` only fires for HTTP auth, so proceed/cancel
     * suffices; iOS funnels EVERY challenge (including TLS server-trust) through
     * one delegate method, hence the third [PerformDefault] case.
     */
    sealed interface WebViewAuthChallengeAction {
        /** Answer a dev-web Basic-auth challenge with these credentials. */
        data class UseCredential(
            val username: String,
            val password: String,
        ) : WebViewAuthChallengeAction

        /**
         * A Basic-auth challenge we will NOT answer — cancel it. Fails closed:
         * no native login prompt, and the dev secret never reaches a challenger
         * we don't trust (wrong host / prod build / no secret).
         */
        data object Cancel : WebViewAuthChallengeAction

        /**
         * NOT a Basic-auth challenge (TLS server-trust, client cert, …) — let
         * the platform handle it. Cancelling here would break HTTPS.
         */
        data object PerformDefault : WebViewAuthChallengeAction
    }

    /**
     * The [WebViewAuthChallengeAction] for a WKWebView auth challenge:
     *  - a Basic-auth challenge ([isBasicAuthChallenge] true) →
     *    [WebViewAuthChallengeAction.UseCredential] when
     *    [devWebBasicAuthForCurrentBuild] grants one for [challengingHost]
     *    (dev build, our dev host, secret present), else
     *    [WebViewAuthChallengeAction.Cancel];
     *  - any non-Basic challenge → [WebViewAuthChallengeAction.PerformDefault],
     *    so certificate validation is never subverted.
     */
    fun webViewAuthChallengeAction(
        isBasicAuthChallenge: Boolean,
        challengingHost: String?,
    ): WebViewAuthChallengeAction {
        if (!isBasicAuthChallenge) return WebViewAuthChallengeAction.PerformDefault
        val credential =
            devWebBasicAuthForCurrentBuild(challengingHost)
                ?: return WebViewAuthChallengeAction.Cancel
        return WebViewAuthChallengeAction.UseCredential(credential.first, credential.second)
    }

    /**
     * Derives the local WEB host from the local API base URL by swapping the
     * API port (3000) for the web-server port (8888). Reuses whatever bridge
     * host the API already resolved (`localhost`, `10.0.2.2`, a LAN IP), so
     * the web host is reachable from the same device. Returns null for a
     * blank/absent API URL (caller then falls back to [DEFAULT_LOCAL_HOST]).
     */
    internal fun localWebHostFromApi(apiBaseUrl: String?): String? {
        if (apiBaseUrl.isNullOrBlank()) return null
        return apiBaseUrl.trimEnd('/').replace(":3000", ":8888")
    }
}

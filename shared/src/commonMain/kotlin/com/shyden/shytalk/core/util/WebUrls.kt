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

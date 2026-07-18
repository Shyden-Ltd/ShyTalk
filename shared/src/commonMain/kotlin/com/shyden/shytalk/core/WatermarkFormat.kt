package com.shyden.shytalk.core

/**
 * The compact watermark's assembled text content (SHY-0205).
 *
 * [title] and [statusLine] always render; [detailLines] is the
 * conditional remainder in display order. The composable (and the web
 * counterpart's mirrored logic) renders exactly this — keeping assembly
 * here makes the layout contract unit-testable on the JVM despite the
 * repo having no Compose screenshot framework yet (SHY-0179).
 */
data class WatermarkContent(
    val title: String,
    val statusLine: String,
    val detailLines: List<String>,
)

/**
 * Pure formatting for the compact preview watermark. No BuildVariant /
 * QaContext reads in here — callers pass plain values so every rule
 * (truncation, dirty star, conditional lines, line budget) is testable
 * without platform state.
 *
 * Compactness contract (operator ruling 2026-07-18): the badge must not
 * eat the app. Enforced shape:
 * - title + status + ≤7 detail lines ⇒ [MAX_LINES_FULL] total,
 *   [MAX_LINES_IDLE] when signed out with no journey running;
 * - pair related facts on one line (`env · version · api`, `UID · cohort`,
 *   `locale · route`) instead of one line each;
 * - lines with nothing to say disappear entirely (never a blank or a
 *   dangling `·`).
 */
object WatermarkFormat {
    /** Branch display budget — long story-branch names middle-truncate. */
    const val MAX_BRANCH_CHARS: Int = 24

    /** Title + status + 7 detail lines, everything known + journey running. */
    const val MAX_LINES_FULL: Int = 9

    /** Signed out, no journey, no route: title + status + 5 detail lines. */
    const val MAX_LINES_IDLE: Int = 7

    private const val SHA_DISPLAY_CHARS = 7
    private const val UNKNOWN = "?"

    /**
     * Middle-truncates [value] to at most [max] chars, keeping head and
     * tail around a single `…`. Head gets the extra char on odd budgets —
     * branch prefixes (`story/SHY-NNNN-`) carry the identifying part.
     */
    fun truncateMiddle(
        value: String,
        max: Int,
    ): String {
        if (value.length <= max) return value
        val keepEnd = (max - 1) / 2
        val keepStart = max - 1 - keepEnd
        return value.take(keepStart) + "…" + value.takeLast(keepEnd)
    }

    /** Assembles the full watermark content from plain values. */
    @Suppress("LongParameterList")
    fun content(
        environment: String,
        buildVersion: String,
        gitBranch: String,
        gitSha: String,
        gitDirty: Boolean,
        builtAt: String,
        deviceInfo: String,
        uniqueId: String?,
        cohort: String?,
        displayName: String?,
        locale: String?,
        route: String?,
        journeyMarker: String?,
        serverSha: String?,
    ): WatermarkContent {
        val serverPart = serverSha?.takeIf { it.isNotBlank() }?.take(SHA_DISPLAY_CHARS) ?: UNKNOWN
        val statusLine = "$environment · $buildVersion · api $serverPart"

        val shaPart =
            when {
                gitSha == UNKNOWN || gitSha.isBlank() -> UNKNOWN
                gitDirty -> gitSha.take(SHA_DISPLAY_CHARS) + "*"
                else -> gitSha.take(SHA_DISPLAY_CHARS)
            }
        val shaLine = if (builtAt == UNKNOWN || builtAt.isBlank()) shaPart else "$shaPart · $builtAt"

        val uidLine =
            when {
                uniqueId.isNullOrBlank() -> "UID: -"
                cohort.isNullOrBlank() -> "UID: $uniqueId"
                else -> "UID: $uniqueId · $cohort"
            }

        val localeRouteLine =
            listOfNotNull(
                locale?.takeIf { it.isNotBlank() },
                route?.takeIf { it.isNotBlank() },
            ).joinToString(" · ").takeIf { it.isNotEmpty() }

        val detailLines =
            listOfNotNull(
                truncateMiddle(gitBranch.ifBlank { UNKNOWN }, MAX_BRANCH_CHARS),
                shaLine,
                deviceInfo,
                uidLine,
                displayName?.takeIf { it.isNotBlank() }?.let { "Name: $it" },
                localeRouteLine,
                journeyMarker?.takeIf { it.isNotBlank() }?.let { "▶ $it" },
            )

        return WatermarkContent(
            title = "ShyTalk Preview",
            statusLine = statusLine,
            detailLines = detailLines,
        )
    }
}

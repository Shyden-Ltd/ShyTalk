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
 * How much of the badge to render.
 *
 * - [FULL] — what BOTH surfaces render. The badge carries the build, the
 *   account and the tester's name, and the last of those is the point:
 *   it is a leak-attribution mark, so a build that turns up somewhere it
 *   should not can be traced to whoever it was given to. The web matrix
 *   runner also reads the UID line straight off its screenshots.
 * - [COMPACT] — a trimmed form, currently asked for by NOBODY. It was the
 *   phone badge between 2026-08-23 and 2026-08-25 (SHY-0430), because at
 *   FULL the badge reached down into the duplicate-request screen's body
 *   copy that journey J38 step 10 asserts on.
 *
 * That is no longer how the height is solved, and the reversal is worth
 * stating because the original reasoning reads convincingly. Operator,
 * 2026-08-25: shrinking a debug surface so it stays out of a screenshot,
 * or so a journey assertion is easier, is the wrong trade —
 *
 *   "you need to be able to prove the app is working without affecting
 *    the watermark."
 *
 * Height is dealt with in the LINE SPACING instead, which costs no field.
 * See PreviewWatermark's WATERMARK_LINE_HEIGHT_SP.
 *
 * Deliberately has no default anywhere. A surface should have to say what
 * it wants, so a change of mind like this one is visible at the call site.
 */
enum class WatermarkVerbosity {
    FULL,
    COMPACT,
}

/**
 * Pure formatting for the compact preview watermark. No BuildVariant /
 * QaContext reads in here — callers pass plain values so every rule
 * (truncation, dirty star, conditional lines, line budget) is testable
 * without platform state.
 *
 * Compactness contract (operator ruling 2026-07-18): the badge must not
 * eat the app. Enforced shape:
 * - [WatermarkVerbosity.COMPACT] — title + status + build identity +
 *   account ⇒ [MAX_LINES_COMPACT] total. What the phone renders
 *   (SHY-0430).
 * - [WatermarkVerbosity.FULL] — title + status + ≤7 detail lines ⇒
 *   [MAX_LINES_FULL] total, [MAX_LINES_IDLE] when signed out with no
 *   journey running. What the web badge renders.
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

    /**
     * [WatermarkVerbosity.COMPACT]: title + status + build identity +
     * account. Four lines is half the height FULL occupied, which on the
     * reported screen clears the heading and the body paragraph entirely.
     */
    const val MAX_LINES_COMPACT: Int = 4

    private const val SHA_DISPLAY_CHARS = 7
    private const val UNKNOWN = "?"

    /**
     * Middle-truncates [value] to at most [max] chars, keeping head and
     * tail around a single `…`. Head gets the extra char on odd budgets —
     * branch prefixes (`story/SHY-NNNN-`) carry the identifying part.
     *
     * Operates on UTF-16 units (like the JS mirror's `slice`): BMP text
     * (incl. CJK) truncates cleanly; a branch name containing non-BMP
     * characters could split a surrogate at the cut — accepted for a
     * QA badge over git refs, which are overwhelmingly ASCII.
     * Degenerate budgets (`max` ≤ 1) collapse to the ellipsis alone
     * rather than throwing (the JS mirror silently degrades the same way).
     */
    fun truncateMiddle(
        value: String,
        max: Int,
    ): String {
        if (value.length <= max) return value
        if (max <= 1) return "…"
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
        verbosity: WatermarkVerbosity,
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
            when (verbosity) {
                // WHICH BUILD and WHICH ACCOUNT. Nothing else earns a line
                // of somebody else's screen.
                //
                // Both are load-bearing rather than nice to have. The sha is
                // the only evidence of the binary actually INSTALLED —
                // reading git in the worktree proves what was BUILT. And the
                // device journeys parse the account line: `signInAs` and
                // J38's "the phone is signed in as the account we seeded"
                // step both read `UID: <digits>` straight out of this badge,
                // so it is a contract with the runner, not decoration.
                //
                // Dropped, with reasons:
                //   branch  — the sha identifies the build authoritatively;
                //             a branch name moves and does not.
                //   device  — the run report's header names it.
                //   NAME    — REVERSED 2026-08-25. Dropped here as a privacy
                //             slip — "a real person's display name burned
                //             into every frame". That was wrong about what
                //             the field is FOR. Operator: "This is designed
                //             on purpose, in case a tester leaks the
                //             application. I need to be able to see easily
                //             who it was." Dropping it removed the only way
                //             to trace a leaked recording to a tester.
                //   locale
                //   /route  — useful while debugging by hand, not worth
                //             covering copy on an unattended walk.
                //   marker  — no producer sets it on device; SHY-0206's
                //             channels never landed.
                WatermarkVerbosity.COMPACT -> listOf(shaLine, uidLine)

                WatermarkVerbosity.FULL ->
                    listOfNotNull(
                        truncateMiddle(gitBranch.ifBlank { UNKNOWN }, MAX_BRANCH_CHARS),
                        shaLine,
                        deviceInfo,
                        uidLine,
                        displayName?.takeIf { it.isNotBlank() }?.let { "Name: $it" },
                        localeRouteLine,
                        journeyMarker?.takeIf { it.isNotBlank() }?.let { "▶ $it" },
                    )
            }

        return WatermarkContent(
            title = "ShyTalk Preview",
            statusLine = statusLine,
            detailLines = detailLines,
        )
    }
}

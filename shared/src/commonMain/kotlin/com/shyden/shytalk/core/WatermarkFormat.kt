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
 * How much of the badge to render (SHY-0430).
 *
 * The badge is drawn OVER the app, so every line it adds is a line of
 * the product's own copy somebody cannot read. Which lines are worth
 * that depends entirely on the surface:
 *
 * - [FULL] — the web badge. A browser window has room to spare beside
 *   the content, and the web matrix runner reads the UID line straight
 *   off its screenshots to tell a signed-out cell from a broken one.
 * - [COMPACT] — the phone badge. On a handset the eight-line form
 *   reached down into body copy: on the duplicate-request screen it
 *   covered the "goes to the back of the queue" sentence that journey
 *   J38 step 10 asserts on, so the frame could not evidence the claim
 *   pinned to it (operator, 2026-08-22). It keeps which build and which
 *   account, and nothing else — see [WatermarkFormat.content].
 *
 * Deliberately has no default anywhere. The two surfaces have drifted
 * apart on purpose, and a default is how they would silently drift
 * back together.
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
                //   NAME    — the longest line in the badge, and the one
                //             that forced its width. It is also the only
                //             genuinely personal field: on a non-seed device
                //             it burns a real person's display name into
                //             every frame of whatever the recording is
                //             shared with. The account id above identifies
                //             them for support purposes without doing that.
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

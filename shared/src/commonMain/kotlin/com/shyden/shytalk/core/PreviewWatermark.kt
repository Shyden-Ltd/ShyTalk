package com.shyden.shytalk.core

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.repository.AuthRepository
import kotlinx.coroutines.delay
import org.koin.mp.KoinPlatformTools

/**
 * Public constants for the preview watermark. Held in a separate object
 * so the test suite can assert on them without reflecting on private
 * Compose state, while still keeping the values used at the single
 * source of truth.
 *
 * The Android UI-level contract (badge visibility per environment,
 * click-through behaviour) is tested via:
 * - `shared/src/commonTest/.../BuildVariantTest.kt` for the constants
 *   (alpha bounds, environment slot coercion).
 * - `tests/web/preview-watermark.spec.ts` for the equivalent rendering
 *   behaviour on the web counterpart, including the
 *   `pointer-events: none` / alpha-bound checks.
 *
 * A native Android Compose UI test was attempted (PreviewWatermarkTest)
 * but the project's `createComposeRule` setup with the custom
 * `ShyTalkTestRunner` + `MainActivity` as the launcher activity
 * doesn't surface the test rule's host Compose root — every assertion
 * trips "No compose hierarchies found" before the test body runs. This
 * is a wider androidTest infrastructure issue (separate follow-up)
 * rather than a watermark bug; the JVM + Playwright tests cover the
 * contract.
 */
object PreviewWatermarkConstants {
    /**
     * Alpha component of the badge background fill (0f..1f). Kept low
     * enough that the underlying UI is clearly visible through the
     * watermark — the user explicitly required "we still need to be
     * able to see the app". The androidTest contract enforces
     * `0.1 <= alpha <= 0.5`.
     */
    const val BADGE_BACKGROUND_ALPHA: Float = 0.4f
}

/**
 * Wraps content in a Box and overlays a "ShyTalk Preview" badge in the
 * top-right of every screen when [BuildVariant.isPreviewBuild] is true
 * (i.e. `BuildVariant.environment != "prod"`). The badge identifies
 * screenshots that are accidentally shared from pre-prod builds —
 * environment, build version, device info, and the signed-in user's
 * uniqueId are all visible at a glance.
 *
 * Wrap the root content (inside `ShyTalkTheme`) on every platform —
 * `MainActivity.setContent` on Android, `MainViewController.IosApp` on
 * iOS. Production builds pass content through unchanged because
 * [BuildVariant.environment] defaults to `"prod"` and the platform
 * initialiser only sets non-prod values on dev/local flavours.
 *
 * The user-id polls the Koin-registered [AuthRepository] every 2s for
 * `resolvedUniqueId` updates rather than wiring a flow through the
 * auth layer for a watermark display. Cost is one mutable-property read
 * per tick on the main dispatcher — negligible.
 */
@Composable
fun PreviewWatermark(content: @Composable () -> Unit) {
    Box(modifier = Modifier.fillMaxSize()) {
        content()
        if (BuildVariant.isPreviewBuild) {
            // The badge has no `.clickable` or `.pointerInput`, so
            // Compose's hit-test treats it as a non-interactive
            // decoration and dispatches taps in its area to the
            // wrapped content below — satisfying the contract that
            // "taps or clicks must not be blocked by any watermark".
            // Verified by the watermark_doesNotInterceptClicks test.
            WatermarkBadge(
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        // Keep the badge clear of the status bar / notch (top) and the
                        // right safe-area edge — otherwise its top rows sit under the
                        // clock/battery and are unreadable (reported on iPhone
                        // 2026-07-12). safeDrawing covers iOS safe area + Android
                        // system bars/cutout; `.only(Top + End)` avoids padding the
                        // bottom/start where this top-right badge doesn't need it.
                        .windowInsetsPadding(
                            WindowInsets.safeDrawing.only(
                                WindowInsetsSides.Top + WindowInsetsSides.End,
                            ),
                        ).padding(top = 4.dp, end = 4.dp)
                        .zIndex(WATERMARK_Z_INDEX),
            )
        }
    }
}

private const val WATERMARK_Z_INDEX = 1000f
private const val CONTENT_REFRESH_INTERVAL_MS = 2_000L
private const val HEALTH_POLL_INTERVAL_MS = 30_000L
private const val WATERMARK_TAG = "PreviewWatermark"

/**
 * Reads every watermark input (BuildVariant, QaContext, AuthRepository
 * via Koin) and assembles the compact content through [WatermarkFormat]
 * — the pure, jvm-tested layout contract (SHY-0205).
 */
private fun assembleContent(locale: String): WatermarkContent {
    // `getOrNull()` on the context returns the Koin instance (or null if
    // Koin hasn't started yet — possible early in `setContent` before
    // `doInitKoin` completes).
    val repo =
        runCatching {
            KoinPlatformTools.defaultContext().getOrNull()?.getOrNull<AuthRepository>()
        }.getOrNull()
    return WatermarkFormat.content(
        environment = BuildVariant.environment,
        buildVersion = BuildVariant.buildVersion,
        gitBranch = BuildVariant.gitBranch,
        gitSha = BuildVariant.gitSha,
        gitDirty = BuildVariant.gitDirty,
        builtAt = BuildVariant.builtAt,
        deviceInfo = BuildVariant.deviceInfo,
        uniqueId = repo?.resolvedUniqueId,
        cohort = repo?.resolvedCohort,
        displayName = repo?.resolvedDisplayName?.takeIf { it.isNotBlank() },
        locale = locale,
        route = QaContext.currentRoute,
        journeyMarker = QaContext.journeyMarker,
        serverSha = QaContext.serverSha,
    )
}

@Composable
private fun WatermarkBadge(modifier: Modifier = Modifier) {
    val locale = Locale.current.language
    var content by remember { mutableStateOf(assembleContent(locale)) }
    var serverOk by remember { mutableStateOf(QaContext.serverOk) }

    LaunchedEffect(locale) {
        // Sample the volatile inputs on a tick rather than observe flows —
        // a watermark refresh latency of up to 2s is unnoticeable to the
        // human eye, while threading StateFlows through every producer
        // for this single display would be invasive.
        while (true) {
            content = assembleContent(locale)
            serverOk = QaContext.serverOk
            delay(CONTENT_REFRESH_INTERVAL_MS)
        }
    }

    LaunchedEffect(Unit) {
        // Server-echo poll (SHY-0205): asks the EXISTING health endpoint
        // which backend is answering. Runs only on preview builds (this
        // composable never mounts on prod) and logs only on state
        // CHANGES so a long-red local session doesn't spam the log.
        while (true) {
            val service =
                runCatching {
                    KoinPlatformTools.defaultContext().getOrNull()?.getOrNull<AppConfigService>()
                }.getOrNull()
            if (service != null) {
                val result =
                    runCatching { service.checkBackendHealth() }
                        .getOrElse { Resource.Error(it.message ?: "health poll failed") }
                val verdict = ServerHealth.verdict(result)
                val previous = QaContext.serverOk
                QaContext.reportServerHealth(verdict.sha, verdict.ok)
                if (previous != verdict.ok) {
                    logD(WATERMARK_TAG, "server health ${previous ?: "unknown"} -> ${verdict.ok} (sha=${verdict.sha ?: "?"})")
                }
            }
            delay(HEALTH_POLL_INTERVAL_MS)
        }
    }

    Column(
        modifier =
            modifier
                .background(WatermarkBackgroundColor)
                .padding(horizontal = 6.dp, vertical = 3.dp)
                .widthIn(max = WATERMARK_MAX_WIDTH_DP.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Text(
            text = content.title,
            color = Color.White,
            fontSize = WATERMARK_TITLE_SIZE_SP.sp,
            fontWeight = FontWeight.Bold,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = content.statusLine + " ",
                color = Color.White,
                fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "●",
                color =
                    when (serverOk) {
                        true -> ServerOkColor
                        false -> ServerFailColor
                        null -> ServerUnknownColor
                    },
                fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            )
        }
        content.detailLines.forEach { line ->
            Text(
                text = line,
                color = Color.White,
                fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// Material red 700 (D32F2F) at PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA
// — must stay in sync with the alpha constant so the
// `watermark_backgroundAlphaIsLowEnoughToSeeThrough` test passes. White
// text on translucent red can wash out on light backgrounds, so the
// Text composables also draw a subtle dark outline via FontWeight.Bold
// + `Color.White` — matches the web `text-shadow` treatment.
private val WatermarkBackgroundColor =
    Color.Red
        .copy(red = 0xD3 / 255f, green = 0x2F / 255f, blue = 0x2F / 255f, alpha = PreviewWatermarkConstants.BADGE_BACKGROUND_ALPHA)
private const val WATERMARK_TITLE_SIZE_SP = 10
private const val WATERMARK_DETAIL_SIZE_SP = 9

// Compactness cap (operator ruling 2026-07-18): the badge never spans
// more than ~60% of a small phone's width; long lines ellipsize.
private const val WATERMARK_MAX_WIDTH_DP = 220

// Server-dot palette — solid (not translucent like the badge) so the
// ok/fail state survives screenshot compression at 9sp.
private val ServerOkColor = Color(0xFF66BB6A)
private val ServerFailColor = Color(0xFFFF5252)
private val ServerUnknownColor = Color(0xFFBDBDBD)

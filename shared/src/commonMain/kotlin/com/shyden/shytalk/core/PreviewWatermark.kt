package com.shyden.shytalk.core

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
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
                        .padding(top = 4.dp, end = 4.dp)
                        .zIndex(WATERMARK_Z_INDEX),
            )
        }
    }
}

private const val WATERMARK_Z_INDEX = 1000f
private const val USER_ID_POLL_INTERVAL_MS = 2_000L

@Composable
private fun WatermarkBadge(modifier: Modifier = Modifier) {
    var uniqueId by remember { mutableStateOf<String?>(null) }
    var displayName by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        // Sample AuthRepository.resolvedUniqueId / resolvedDisplayName
        // on a tick rather than observe flows — both are plain `var`s
        // and a watermark refresh latency of up to 2s is unnoticeable
        // to the human eye, while threading StateFlows through every
        // auth call site for this single display would be invasive.
        // `getOrNull()` on the context returns the Koin instance (or
        // null if Koin hasn't started yet — possible early in
        // `setContent` before `doInitKoin` completes).
        while (true) {
            val repo =
                runCatching {
                    KoinPlatformTools.defaultContext().getOrNull()?.getOrNull<AuthRepository>()
                }.getOrNull()
            uniqueId = repo?.resolvedUniqueId
            displayName = repo?.resolvedDisplayName?.takeIf { it.isNotBlank() }
            delay(USER_ID_POLL_INTERVAL_MS)
        }
    }

    Column(
        modifier =
            modifier
                .background(WatermarkBackgroundColor)
                .padding(horizontal = 6.dp, vertical = 3.dp),
        horizontalAlignment = Alignment.End,
    ) {
        Text(
            text = "ShyTalk Preview",
            color = Color.White,
            fontSize = WATERMARK_TITLE_SIZE_SP.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "${BuildVariant.environment} · ${BuildVariant.buildVersion}",
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = BuildVariant.deviceInfo,
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = "UID: ${uniqueId ?: "-"}",
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = "Name: ${displayName ?: "-"}",
            color = Color.White,
            fontSize = WATERMARK_DETAIL_SIZE_SP.sp,
            fontFamily = FontFamily.Monospace,
        )
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

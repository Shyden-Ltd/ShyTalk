package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Source pin for SHY-0268: every surface that renders the 18+
 * [com.shyden.shytalk.feature.ageverification.AgeRestrictionDialog] must
 * be able to reach the verification submit screen.
 *
 * Two distinct failure modes shipped together, from the same cause:
 *  - Room/Gacha CTA — wired, but the Android graph never registered the
 *    destination, so "Verify now" crashed the process. Guarded by
 *    [NavGraphDestinationCompletenessTest].
 *  - DM CTA (chat screen + the in-room PM bottom sheet) — the callback
 *    parameter carried a silent `= {}` default, so the call sites that
 *    forgot to pass it compiled cleanly and produced a dead-end button:
 *    the dialog dismissed and nothing happened.
 *
 * The dead-end class is closed by DELETING the default rather than by
 * pinning each call site: with no default, the Kotlin compiler refuses
 * any call site that omits the callback, which is a stronger and
 * self-maintaining guarantee than a substring assertion. This pin exists
 * to stop a well-meaning refactor from reintroducing the default (and to
 * pin the forwarding hops that the compiler cannot infer intent for).
 */
class AgeVerificationCtaWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root (settings.gradle.kts) not found from ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "expected source file to exist: $relative")
        return f.readText()
    }

    /** Matches `onNavigateToAgeVerification: () -> Unit = {}` in any spacing. */
    private val silentDefault = Regex("""onNavigateToAgeVerification\s*:\s*\(\s*\)\s*->\s*Unit\s*=""")

    @Test
    fun `room screen requires an age verification callback with no silent default`() {
        val src = read(ROOM_SCREEN)
        assertTrue(
            "onNavigateToAgeVerification" in src,
            "$ROOM_SCREEN must accept onNavigateToAgeVerification — it renders the Gacha 18+ gate",
        )
        assertFalse(
            silentDefault.containsMatchIn(src),
            "$ROOM_SCREEN must NOT default onNavigateToAgeVerification. A default lets a call " +
                "site silently omit the wiring and ship a dead-end 'Verify now' button; without " +
                "one the compiler enforces every call site (SHY-0268)",
        )
    }

    @Test
    fun `private chat screen requires an age verification callback with no silent default`() {
        val src = read(PRIVATE_CHAT_SCREEN)
        assertTrue(
            "onNavigateToAgeVerification" in src,
            "$PRIVATE_CHAT_SCREEN must accept onNavigateToAgeVerification — it renders the DM 18+ gate",
        )
        assertFalse(
            silentDefault.containsMatchIn(src),
            "$PRIVATE_CHAT_SCREEN must NOT default onNavigateToAgeVerification (SHY-0268)",
        )
    }

    @Test
    fun `pm bottom sheet forwards the age verification callback to both chat views`() {
        val src = read(PM_BOTTOM_SHEET)
        // One declaration on PmBottomSheet, one on each private sheet view,
        // plus one forward per view into PrivateChatScreen.
        val occurrences = Regex("onNavigateToAgeVerification").findAll(src).count()
        assertTrue(
            occurrences >= PM_SHEET_MIN_OCCURRENCES,
            "$PM_BOTTOM_SHEET must declare AND forward onNavigateToAgeVerification through both " +
                "the 1:1 and group sheet views (found $occurrences references, expected at least " +
                "$PM_SHEET_MIN_OCCURRENCES). The in-room PM sheet renders the same 18+ gate as the " +
                "full-screen chat, so its CTA must reach the same destination (SHY-0268)",
        )
    }

    @Test
    fun `room screen forwards its age verification callback into the pm bottom sheet`() {
        val src = read(ROOM_SCREEN)
        val sheetCall = src.substringAfter("PmBottomSheet(", "").substringBefore("\n                    )")
        assertTrue(
            "onNavigateToAgeVerification" in sheetCall,
            "$ROOM_SCREEN must pass onNavigateToAgeVerification into PmBottomSheet — the DM gate " +
                "opened from inside a room otherwise dead-ends (SHY-0268)",
        )
    }

    private companion object {
        const val ROOM_SCREEN = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomScreen.kt"
        const val PRIVATE_CHAT_SCREEN =
            "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatScreen.kt"
        const val PM_BOTTOM_SHEET =
            "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PmBottomSheet.kt"

        /** 1 PmBottomSheet param + (1 param + 1 forward) per sheet chat view. */
        const val PM_SHEET_MIN_OCCURRENCES = 5
    }
}

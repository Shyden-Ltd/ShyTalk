package com.shyden.shytalk.feature.support

import com.shyden.shytalk.testsupport.RepoSource.read
import com.shyden.shytalk.testsupport.RepoSource.repoRoot
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The guide may only teach routes that exist — SHY-0437.
 *
 * A step naming a control that is not there is worse than no step. It arrives
 * at the end of an interaction that began with somebody struggling to report,
 * and sends them looking for a button we invented.
 *
 * **A room cannot be reported.** `reportRoom`, `report_room`, `reportedRoom`
 * and `roomReport` return zero matches across the app, the API and the admin
 * dashboard. SHY-0439's copy as dictated says it is better to report "the user,
 * message or room directly"; the room half of that does not exist, so it is not
 * taught and not promised. SHY-0440 holds the decision. If room reporting is
 * built, this test is where the new step is registered.
 */
class ReportGuideTeachesRealRoutesTest {
    /**
     * Comments name the things they explain.
     *
     * The guide's own KDoc lists `reportRoom` / `report_room` / `reportedRoom` /
     * `roomReport` precisely to record that none of them exist — and a scan that
     * cannot tell prose from code reads that as proof they do.
     */
    internal fun withoutComments(text: String): String =
        text
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }

    private val guideSource: String
        get() = read("shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportPage.kt")

    private val english: String
        get() = read("shared/src/commonMain/composeResources/values/strings.xml")

    /**
     * Each step, and the component that has to exist for it to be true.
     *
     * Paired here so a step cannot be added without naming what makes it
     * honest, and a component cannot be deleted without this failing.
     */
    private val stepsAndTheirRoutes =
        mapOf(
            "report_guide_step_profile" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/profile/ProfileScreen.kt",
            "report_guide_step_room_card" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/UserCardPopup.kt",
            "report_guide_step_message" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatScreen.kt",
        )

    @Test
    fun `every step the guide renders is one of the steps checked here`() {
        // Derived from the source, so a fourth step added to the screen without
        // a route to justify it fails rather than going unchecked.
        val rendered =
            Regex("""Res\.string\.(report_guide_step_[a-z_]+)""")
                .findAll(guideSource)
                .map { it.groupValues[1] }
                .toSet()
        assertEquals(stepsAndTheirRoutes.keys, rendered)
    }

    @Test
    fun `every step names a screen that opens a report`() {
        val broken =
            stepsAndTheirRoutes.entries.filterNot { (_, path) ->
                val source = read(path)
                source.contains("ReportUserDialog") || source.contains("ReportMessageDialog")
            }
        assertEquals(emptyList(), broken.map { it.key })
    }

    @Test
    fun `the room-card step is true because that popup really offers Report`() {
        val popup = read("shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/components/UserCardPopup.kt")
        assertTrue(popup.contains("Res.string.report"), "the user card no longer offers a Report row")
    }

    @Test
    fun `the profile step is true because the profile really offers Report`() {
        val profile = read("shared/src/commonMain/kotlin/com/shyden/shytalk/feature/profile/ProfileScreen.kt")
        assertTrue(profile.contains("onReportUser"), "the profile no longer offers a Report control")
    }

    @Test
    fun `the message step is true in a room as well as a private chat`() {
        // One sentence covers both, so both have to hold.
        val room = read("shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomScreen.kt")
        assertTrue(room.contains("ReportMessageDialog"), "a room message can no longer be reported")
    }

    /**
     * The guide teaches no route to report a ROOM, because there is none.
     *
     * Scoped to the guide's own strings rather than the whole file: "room"
     * appears legitimately in the step about reporting a message sent IN a room.
     */
    @Test
    fun `no step claims a room can be reported`() {
        val guideStrings =
            Regex("""<string name="(report_guide_[a-z_]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
                .findAll(english)
                .associate { it.groupValues[1] to it.groupValues[2] }
        assertTrue(guideStrings.isNotEmpty(), "no guide strings found -- the scan is looking in the wrong place")

        val claimsRoomReporting =
            guideStrings.filterValues { text ->
                Regex("""report (the |a |that )?room""", RegexOption.IGNORE_CASE).containsMatchIn(text)
            }
        assertEquals(emptyMap(), claimsRoomReporting)
    }

    @Test
    fun `room reporting still does not exist, so the omission is still correct`() {
        // The day this fails, room reporting has been built (SHY-0440) and the
        // guide should gain a step rather than this test being deleted.
        val roots =
            listOf("app/src/main", "shared/src/commonMain", "express-api/src", "public/admin/js")
                .map { File(repoRoot(), it) }
                .filter { it.exists() }
        assertTrue(roots.size >= 3, "the scan reached only ${roots.size} roots")

        val hits =
            roots
                .flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension in setOf("kt", "js") }.toList() }
                .filter { file ->
                    Regex("""\b(reportRoom|report_room|reportedRoom|roomReport)\b""")
                        .containsMatchIn(withoutComments(file.readText()))
                }.map { it.name }
        assertEquals(emptyList(), hits)
    }

    @Test
    fun `the room-reporting scan reads code, not the comment that says there is none`() {
        assertEquals(
            emptyList(),
            Regex("""\breportRoom\b""")
                .findAll(withoutComments("// reportRoom does not exist"))
                .map { it.value }
                .toList(),
        )
        assertEquals(
            listOf("reportRoom"),
            Regex("""\breportRoom\b""").findAll(withoutComments("fun reportRoom() {}")).map { it.value }.toList(),
        )
    }

    @Test
    fun `the escape hatch is rendered, and is not gated behind the steps`() {
        // "The route to a ticket is visible from the start, not hidden behind
        // finishing the guide -- somebody in distress must never feel trapped."
        assertTrue(
            guideSource.contains("TAG_SUPPORT_CONTACT_ANYWAY"),
            "the guide no longer offers a way to raise a ticket",
        )
        assertTrue(
            guideSource.contains("verticalScroll"),
            "the guide must scroll, or the escape hatch can be off-screen with no way to reach it",
        )
    }
}

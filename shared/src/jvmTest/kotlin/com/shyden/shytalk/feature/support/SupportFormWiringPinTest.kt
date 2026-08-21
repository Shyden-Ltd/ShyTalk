package com.shyden.shytalk.feature.support

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * SHY-0385 — pins that the support form is actually WIRED, not merely written.
 *
 * `SupportFormViewModelTest` proves the ViewModel sends the category and context
 * it is given, by constructing it directly:
 *
 * ```kotlin
 * SupportFormViewModel(repo, context = mapOf("feature" to "gacha"))
 * ```
 *
 * Production never constructs it that way. Koin does, and the binding was
 * `viewModel { SupportFormViewModel(get()) }` — no parameters — while all three
 * entry points resolved it with a bare `koinViewModel()`. So every ticket was
 * raised with `category = null` and `context = emptyMap()`, the server's
 * `CONTEXT_ALLOWED_FIELDS` allowlist filtered an empty object on every request,
 * and admins triaged with no data. The unit tests stayed green throughout,
 * because they exercised a construction path the app never takes.
 *
 * This is that gap closed: the unit tests prove the behaviour, this proves
 * production reaches it.
 *
 * Every file read here lives in `commonMain`, which is a compile input to
 * `jvmTest` — so editing one re-runs this pin. A pin over `app/` or `iosMain/`
 * would need an explicit `inputs` entry in `shared/build.gradle.kts` to avoid
 * being skipped as up-to-date.
 */
class SupportFormWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root not found")
    }

    /**
     * Code only: a KDoc mention is not a call, and an import is a declaration of
     * availability rather than of use. Both have made an earlier pin in this repo
     * pass against code that had been deleted.
     */
    private fun codeOf(rel: String): String {
        val f = File(repoRoot(), rel)
        assertTrue(f.exists(), "$rel is missing — this pin is reading a path that no longer exists")
        return f
            .readText()
            .lines()
            .filterNot {
                val t = it.trimStart()
                t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import ")
            }.joinToString(" ") { it.trim() }
            .replace(Regex("\\s+"), " ")
    }

    /**
     * Hosts that must be able to route somebody to support.
     *
     * SHY-0387 moved the form from a dialog to a page, so these screens no longer
     * resolve the ViewModel — they navigate, and the nav graph resolves it. The
     * compiler now enforces the wiring itself, because each callback is
     * NON-DEFAULTED. That is stronger than a pin.
     *
     * So this pin guards the GUARD: it fails if anybody gives those parameters a
     * default, which would silently restore the dead-button shape SHY-0384 was
     * filed for.
     */
    private val nonDefaultedHosts =
        mapOf(
            "room" to "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomScreen.kt",
            "private chat" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatScreen.kt",
            "pm sheet" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PmBottomSheet.kt",
            "settings" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/AppSettingsScreen.kt",
            "screen params" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/PlatformScreens.kt",
        )

    private val navGraph =
        "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt"

    @Test
    fun `the route to support is never optional`() {
        for ((where, rel) in nonDefaultedHosts) {
            val code = codeOf(rel)
            assertTrue(
                code.contains("onNavigateToSupport"),
                "$rel ($where) no longer offers a route to support — this pin would pass vacuously",
            )
            assertTrue(
                !Regex("onNavigateToSupport:\\s*\\([^)]*\\)\\s*->\\s*Unit\\s*=").containsMatchIn(code),
                "$rel ($where) gives onNavigateToSupport a DEFAULT. A default lets a host ship " +
                    "without a route out, which is the dead \"Contact support\" button SHY-0384 " +
                    "was filed for. Keep the compiler as the enforcement.",
            )
        }
    }

    @Test
    fun `the nav graph resolves the form with the category and context of where they came from`() {
        val code = codeOf(navGraph)
        assertTrue(
            code.contains("SupportPage("),
            "$navGraph no longer hosts SupportPage — this pin would pass vacuously",
        )
        assertTrue(
            Regex("parametersOf\\(\\s*source\\.category,\\s*source\\.context\\(\\)").containsMatchIn(code),
            "$navGraph resolves SupportPage without the source's category and context, so every " +
                "ticket would carry defaults and an admin could not tell where it came from",
        )
    }

    @Test
    fun `an unrecognised source still opens support`() {
        val code = codeOf(navGraph)
        assertTrue(
            code.contains("SupportSource.fromWire("),
            "$navGraph does not go through SupportSource.fromWire, so a deeplink from an older " +
                "build would fail to open support at all rather than opening it generically",
        )
    }

    private val page =
        "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportPage.kt"

    @Test
    fun `every way out of the page resets the form`() {
        val code = codeOf(page)
        assertTrue(
            code.contains("viewModel.reset()"),
            "$page never resets. The ViewModel outlives the page, so leaving it " +
                "leaves it holding submitted = true and the next visit shows the confirmation " +
                "instead of a form.",
        )
        // Four ways out: the confirmation's button and dismiss-request, and the
        // form's button and dismiss-request. Any one of them still calling
        // `onDismiss` directly skips the reset.
        for (leak in listOf("onClick = onBack", "IconButton(onClick = onBack")) {
            assertTrue(
                !code.contains(leak),
                "$page still has `$leak`, which leaves the page without resetting it",
            )
        }
    }

    @Test
    fun `an already-open request is shown as information, not as the person's mistake`() {
        val code = codeOf(page)
        assertTrue(
            code.contains("state.alreadyHasOpenTicket"),
            "$page ignores alreadyHasOpenTicket entirely, so the flag is dead state and the " +
                "person is told they made an error when they did not",
        )
        // Anchored to the Send button's own `enabled` expression. A whole-file
        // `contains` passed this assertion with the guard deleted, because the
        // same substring also appears on the field's `isError` line — the exact
        // defect class this file exists to catch, found by mutating the dialog.
        val sendButton =
            code
                .substringAfter("onClick = viewModel::submit,", "")
                .substringBefore("testTag(TAG_SUPPORT_SEND)", "")
        assertTrue(
            sendButton.isNotEmpty(),
            "$page: could not isolate the Send button's attributes — the pin cannot see what " +
                "it is meant to check",
        )
        assertTrue(
            sendButton.contains("!state.alreadyHasOpenTicket"),
            "$page leaves Send enabled while a request is already open, so the only thing the " +
                "button can do is earn the same refusal again. Found: `$sendButton`",
        )
    }

    /**
     * The two platform repositories, each reduced to the `raiseTicket` body.
     *
     * Both are declared as `jvmTest` inputs in `shared/build.gradle.kts`. Neither
     * is compiled into this source set, so without that declaration Gradle would
     * call jvmTest up-to-date when only one of them changed — and the parity pin
     * would be skipped at exactly the moment it matters.
     */
    private fun raiseTicketBodies(): Map<String, String> {
        val android =
            codeOf("app/src/main/java/com/shyden/shytalk/data/repository/SupportRepositoryImpl.kt")
        val iosFile =
            codeOf("shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosSmallRepositories.kt")
        val iosStart = iosFile.indexOf("class IosSupportRepositoryImpl")
        assertTrue(
            iosStart >= 0,
            "IosSupportRepositoryImpl is gone from IosSmallRepositories.kt — this pin would pass vacuously",
        )
        return mapOf("android" to android, "ios" to iosFile.substring(iosStart))
    }

    @Test
    fun `neither platform reports a success that carries no ticket id`() {
        for ((platform, body) in raiseTicketBodies()) {
            assertTrue(
                body.contains("ticketId.isBlank()"),
                "$platform reports a 2xx with no ticketId as a raised ticket. A captive portal " +
                    "answers 200 with its own login page, so the person is told their message " +
                    "arrived when the server never saw it.",
            )
            val branch = body.substringAfter("ticketId.isBlank()").substringBefore("} else {")
            assertTrue(
                branch.contains("RaiseTicketOutcome.Failed"),
                "$platform recognises the missing ticketId but does not fail on it: $branch",
            )
        }
    }

    @Test
    fun `neither platform lets an unexpected failure escape and crash the app`() {
        for ((platform, body) in raiseTicketBodies()) {
            assertTrue(
                body.contains("catch (e: Exception)"),
                "$platform has no terminal catch. Android's JSONException on a non-JSON 2xx and " +
                    "iOS's Ktor transport errors are neither ApiException nor IOException, so " +
                    "they leave viewModelScope.launch uncaught and take the app down.",
            )
        }
    }

    @Test
    fun `cancellation is rethrown above the terminal catch on both platforms`() {
        for ((platform, body) in raiseTicketBodies()) {
            val cancellation = body.indexOf("catch (e: CancellationException)")
            val terminal = body.indexOf("catch (e: Exception)")
            assertTrue(
                cancellation >= 0,
                "$platform swallows cancellation into its broad catch, so dismissing the dialog " +
                    "mid-send is reported to the person as an error",
            )
            assertTrue(
                terminal < 0 || cancellation < terminal,
                "$platform catches Exception before CancellationException, so the broad catch " +
                    "wins and cancellation is reported as a failure",
            )
        }
    }

    // The settings-is-not-an-age-refusal assertion moved to SupportSourceTest when
    // SHY-0387 turned the three inline context maps into `SupportSource`. It is a
    // better test there: real logic with a real assertion, rather than a regex over
    // Compose source that could only ever prove the literal was present.
}

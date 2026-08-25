package com.shyden.shytalk.feature.support

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
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
        // An ALLOWLIST, not a denylist. This used to blacklist the one spelling
        // `onClick = onBack`, which caught only the leak somebody had already
        // thought of -- and then false-fired the moment an unrelated composable
        // on this page took a parameter of the same name (SHY-0396).
        //
        // The real invariant is narrower and checkable: `onBack` is the page's
        // only way out, so it may be DECLARED once and CALLED once, inside
        // `leave`. Any third use is an exit that skips the reset.
        val uses = Regex("\\bonBack\\b").findAll(code).count()
        assertEquals(
            2,
            uses,
            "$page uses `onBack` $uses times. It may appear exactly twice -- the parameter, and " +
                "the single call inside `leave` -- because every other exit has to reset first. " +
                "A third use is a way off this page that leaves the ViewModel holding " +
                "submitted = true, so the next visit opens on the old confirmation.",
        )
    }

    /**
     * SHY-0396, and the reason this pin was INVERTED rather than deleted.
     *
     * SHY-0385 disabled Send while a request was open, and this pin used to
     * demand exactly that. The operator's correction on 2026-08-21: a second
     * request must never be blocked, because somebody with an open ticket may
     * have a completely different problem and refusing them means the new
     * problem reaches nobody.
     *
     * So the assertion now runs the other way. A disabled Send is the defect,
     * and this is what stops it coming back — including under a renamed flag,
     * which is why the check is on the button's own `enabled` expression rather
     * than on any particular field name.
     */
    @Test
    fun `Send is never disabled by having a request already open`() {
        val code = codeOf(page)
        // Anchored to the Send button's own `enabled` expression. A whole-file
        // `contains` passed the previous version of this assertion with the
        // guard deleted, because the same substring also appeared on the field's
        // `isError` line — the exact defect class this file exists to catch.
        val sendButton =
            code
                .substringAfter("onClick = viewModel::submit,", "")
                .substringBefore("testTag(TAG_SUPPORT_SEND)", "")
        assertTrue(
            sendButton.isNotEmpty(),
            "$page: could not isolate the Send button's attributes — the pin cannot see what " +
                "it is meant to check",
        )
        assertEquals(
            "enabled = !state.isSubmitting,",
            sendButton.substringAfter("enabled = ", "").let { "enabled = " + it.substringBefore(",") + "," },
            "$page gates Send on something other than a send already being in flight. SHY-0396: " +
                "Send is HOW somebody reaches the duplicate choice, so anything else in that " +
                "expression blocks a genuinely different problem from ever being reported. " +
                "Found: `$sendButton`",
        )
        assertTrue(
            !code.contains("alreadyHasOpenTicket"),
            "$page still refers to alreadyHasOpenTicket. SHY-0396 removed that flag along with " +
                "the server's 409; a surviving reference means the refusal is still wired.",
        )
    }

    /**
     * The three answers the operator asked for, and the summaries that make the
     * question answerable.
     *
     * "Is this the same problem?" cannot be answered against a ticket id, so the
     * choice screen showing the person's OWN words is not decoration — it is the
     * whole basis of the decision.
     */
    @Test
    fun `somebody with a request already open gets all three choices`() {
        val code = codeOf(page)
        val required =
            mapOf(
                "the warning itself, with how many are open" to "support_open_requests_one",
                "the plural form of that count" to "support_open_requests_many",
                "the back-of-the-queue reminder" to "support_duplicate_reminder",
                "it is the problem I already reported" to "support_duplicate_same",
                "it is a new problem" to "support_duplicate_new",
                "go back" to "support_duplicate_back",
                "their own words, to recognise it by" to "ticket.summary",
            )
        for ((why, needle) in required) {
            assertTrue(
                code.contains(needle),
                "$page never renders `$needle` — $why is missing from the duplicate choice, " +
                    "so the person cannot answer the question they are being asked",
            )
        }
        for (
        (why, call) in
        mapOf(
            "adding to the open one" to "viewModel::addToOpenTicket",
            "raising a separate one" to "viewModel::sendAsNewProblem",
            "going back" to "viewModel::dismissDuplicateChoice",
        )
        ) {
            assertTrue(
                code.contains(call),
                "$page never calls `$call`, so $why is a button that does nothing — the exact " +
                    "shape of the dead Contact-support button SHY-0384 was filed for",
            )
        }
    }

    /**
     * The ten-file cap, at the surface a person actually meets.
     *
     * The bound is enforced in three places — the ViewModel refuses an eleventh,
     * the route refuses an eleventh key, and the picker button stops offering.
     * The first two have tests; this pins the third, which is the only one
     * anybody SEES. Without it the control keeps inviting a file it will then
     * refuse, which is a worse experience than saying no in advance.
     */
    @Test
    fun `the add-file control stops offering once ten are attached`() {
        val code = codeOf(page)
        val addFile =
            code
                .substringAfter("onClick = launchPicker,", "")
                .substringBefore("testTag(TAG_SUPPORT_ADD_FILE)", "")
        assertTrue(
            addFile.isNotEmpty(),
            "$page: could not isolate the add-file button — the pin cannot see what it checks",
        )
        assertTrue(
            addFile.contains("attachments.size < MAX_ATTACHMENTS"),
            "$page keeps offering to add files past the cap. Found: `$addFile`",
        )
    }

    /**
     * The message bound is shown as it is used, not discovered at Send.
     *
     * Operator, 2026-08-22: 1,000 characters, counted live. A bound somebody
     * only meets when they press Send is a bound that costs them the message
     * they just wrote.
     */
    @Test
    fun `the character count is on the field and updates as they type`() {
        val code = codeOf(page)
        assertTrue(
            code.contains("TAG_SUPPORT_CHAR_COUNT"),
            "$page shows no character count, so the 1,000 bound is invisible until Send",
        )
        assertTrue(
            code.contains("state.characterCount") && code.contains("SUPPORT_MESSAGE_MAX_LENGTH"),
            "$page's count is not driven by the field's own state, so it cannot be live",
        )
        assertTrue(
            code.contains("state.isOverCharacterLimit"),
            "$page does not mark the field when the bound is passed",
        )
    }

    /**
     * SHY-0419, pinned so it cannot come back a third time.
     *
     * The first fix extended the scroll range so Send could be REACHED. It was
     * still DRAWN under the keyboard at rest: on a real iPhone the keyboard
     * covered y 609-854 with Send at y 675, and tapping the button's own centre
     * typed a "y" into the message instead of sending — the stray character
     * shipped in the ticket. Reachable-after-scrolling is not the same as
     * usable, and nothing on the screen tells anybody to scroll.
     *
     * Send therefore belongs in the Scaffold's bottomBar, above the keyboard,
     * where its position does not depend on how long the form has grown.
     */
    @Test
    fun `Send is pinned above the keyboard, not left at the bottom of the form`() {
        val code = codeOf(page)
        val bottomBar =
            code
                .substringAfter("bottomBar = {", "")
                .substringBefore(") { padding ->", "")
        assertTrue(
            bottomBar.isNotEmpty(),
            "$page has no bottomBar — Send is back inside the scrolling form, where a keyboard " +
                "covers it (SHY-0419)",
        )
        assertTrue(
            bottomBar.contains("TAG_SUPPORT_SEND"),
            "$page does not put Send in the bottomBar. Found there: `$bottomBar`",
        )
        // The keyboard is accounted for ONCE, by the Scaffold. Padding the
        // button itself put the keyboard into the bar's measured height, which
        // Scaffold then subtracts from the content — and on iOS, where the
        // inset is already consumed upstream, that removed it twice and
        // collapsed the form to a 28 pt strip while Send still looked correct.
        assertTrue(
            code.contains("WindowInsets.ime.union(WindowInsets.navigationBars)"),
            "$page does not lift the Scaffold above BOTH the keyboard and the navigation bar, " +
                "so a pinned Send sits under one of them",
        )
        assertTrue(
            !bottomBar.contains("imeBottom"),
            "$page lifts the Send bar by hand as well as via the Scaffold. That double-counts " +
                "the keyboard against the content — the form collapses while Send looks fine. " +
                "Found: `$bottomBar`",
        )
    }

    /**
     * Send must clear the SYSTEM NAVIGATION BAR too, not only the keyboard.
     *
     * Found on a real OnePlus, on video, at step 12 of J38. With the keyboard
     * OPEN, `imePadding()` lifted the Scaffold and Send was reachable — which is
     * why the first Send in the journey passed. With the keyboard CLOSED the IME
     * inset is 0, the bar sat flush to the window bottom, and Android painted
     * the back/home/recents icons over the lower half of the button. The
     * button's tappable centre coincided with HOME, so pressing Send went to the
     * launcher instead of submitting.
     *
     * Nothing in an assertion could see it: the button existed, carried the
     * right tag, reported sane bounds and was "visible". Only the pixels showed
     * the nav bar on top of it. That is precisely why the walks are recorded.
     *
     * `union` rather than a second padding call, because this screen's whole
     * inset history is about counting an inset EXACTLY ONCE (SHY-0419, three
     * readings). `union` takes the larger per side: the nav bar when the
     * keyboard is down, the keyboard when it is up — which already spans the
     * nav bar region. Adding `navigationBarsPadding()` to the bar as well would
     * float Send a nav-bar's height above the keyboard whenever it is open.
     *
     * MainScreen is unaffected: its bottomBar is a Material3 `NavigationBar`,
     * which consumes system-bar insets itself. This screen hand-rolls a
     * `Surface`, which does not.
     */
    @Test
    fun `Send clears the navigation bar, not just the keyboard`() {
        val code = codeOf(page)
        assertTrue(
            code.contains("WindowInsets.navigationBars"),
            "$page never mentions the navigation bar. With the keyboard closed the pinned Send " +
                "bar sits flush to the window bottom and Android draws back/home/recents over " +
                "it — tapping Send's centre hits HOME and leaves the app.",
        )
        // ONCE, at the Scaffold. A second application on the bar itself is the
        // double-count that collapsed this form before.
        val bottomBar =
            code
                .substringAfter("bottomBar = {", "")
                .substringBefore(") { padding ->", "")
        assertTrue(
            !bottomBar.contains("navigationBarsPadding") &&
                !bottomBar.contains("WindowInsets.navigationBars"),
            "$page pads the Send bar for the navigation bar as well as the Scaffold. That " +
                "double-counts it, floating Send above the keyboard. Found: `$bottomBar`",
        )
    }

    /**
     * SHY-0396's UX clause: "it appears before they have typed the whole thing
     * again, not after they press send".
     *
     * A warning that only arrives at Send costs somebody the effort of writing
     * out a problem they had already reported. This pins that the form itself
     * says what is open, on sight.
     */
    @Test
    fun `what is already open is stated before anybody starts typing`() {
        val code = codeOf(page)
        val beforeTheField =
            code
                .substringAfter("support_form_hint", "")
                .substringBefore("OutlinedTextField", "")
        assertTrue(
            beforeTheField.isNotEmpty(),
            "$page: could not isolate what renders above the message field — the pin cannot see " +
                "what it is meant to check",
        )
        assertTrue(
            beforeTheField.contains("OpenRequestsNotice"),
            "$page only warns about an open request once Send is pressed, so somebody types " +
                "their whole problem out again before being told they had already reported it. " +
                "Found above the field: `$beforeTheField`",
        )
        assertTrue(
            code.contains("state.openTickets.isNotEmpty()"),
            "$page shows the notice unconditionally, so somebody with nothing open is warned " +
                "about a request they do not have",
        )
    }

    /**
     * The confirmation has to say WHICH of the two things happened.
     *
     * Somebody who chose "it is the problem I already reported" and is then told
     * "we have your message" cannot tell whether their words reached the ticket
     * they picked or started a new one.
     */
    @Test
    fun `the confirmation distinguishes a new request from an addition`() {
        val code = codeOf(page)
        assertTrue(
            code.contains("support_form_added") && code.contains("support_form_sent"),
            "$page shows one confirmation for both routes, so adding to an open request is " +
                "indistinguishable from raising a new one",
        )
        assertTrue(
            code.contains("addedToExisting"),
            "$page never reads addedToExisting, so the two confirmations cannot differ",
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

    /**
     * SHY-0396 removed the 409 from the server. A client still mapping it would
     * be dead code today and a re-armed refusal the moment anybody reinstated
     * the status on any route — so it is pinned out on BOTH platforms at once,
     * which is how the original 409 handling drifted apart in the first place.
     */
    @Test
    fun `neither platform still treats a conflict as a refusal to raise`() {
        for ((platform, body) in raiseTicketBodies()) {
            assertTrue(
                !body.contains("409") && !body.contains("AlreadyOpen"),
                "$platform still maps a conflict to a refusal. SHY-0396: a second request is " +
                    "never refused, and the client must not resurrect the block the operator " +
                    "asked us to remove.",
            )
        }
    }

    @Test
    fun `both platforms can find out what is already open, and add to it`() {
        for ((platform, body) in raiseTicketBodies()) {
            assertTrue(
                body.contains("/api/support-tickets/mine/open"),
                "$platform cannot list open requests, so the duplicate warning never appears " +
                    "there and that platform silently keeps SHY-0385's behaviour",
            )
            assertTrue(
                body.contains("/messages"),
                "$platform cannot add to an open request, so \"it is the problem I already " +
                    "reported\" drops the person's message on that platform",
            )
        }
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

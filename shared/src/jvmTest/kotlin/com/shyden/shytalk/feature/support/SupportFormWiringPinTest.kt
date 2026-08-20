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

    /** The three places a person can open the support form. */
    private val entryPoints =
        mapOf(
            "room (age gate on Lucky Spin)" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/room/RoomScreen.kt",
            "private chat (age gate on messages)" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/messaging/PrivateChatScreen.kt",
            "settings (the general way in)" to
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/AppSettingsScreen.kt",
        )

    private val viewModelModule =
        "shared/src/commonMain/kotlin/com/shyden/shytalk/core/di/ViewModelModule.kt"

    @Test
    fun `the Koin binding accepts the category and context parameters`() {
        val code = codeOf(viewModelModule)
        assertTrue(
            code.contains("SupportFormViewModel("),
            "$viewModelModule no longer binds SupportFormViewModel — this pin would pass vacuously",
        )
        assertTrue(
            Regex("params\\s*->\\s*SupportFormViewModel\\(").containsMatchIn(code),
            "$viewModelModule binds SupportFormViewModel without `params ->`, so the category and " +
                "context arguments can only ever take their defaults (null, emptyMap()). " +
                "Follow the house form used by RoomViewModel: `viewModel { params -> … }`.",
        )
    }

    @Test
    fun `every entry point resolves the form with its own category and context`() {
        for ((where, rel) in entryPoints) {
            val code = codeOf(rel)
            assertTrue(
                code.contains("SupportFormViewModel"),
                "$rel ($where) no longer references SupportFormViewModel — this pin would pass vacuously",
            )
            // Between naming the type and handing it to the dialog, the resolution
            // must carry parameters. A bare `koinViewModel()` is the defect.
            val match = Regex("SupportFormViewModel\\s*=(.*?)SupportFormDialog\\(").find(code)
            assertTrue(
                match != null,
                "$rel ($where): could not find the SupportFormViewModel resolution ahead of " +
                    "SupportFormDialog( — the pin cannot see what it is meant to check",
            )
            val resolution = match.groupValues[1]
            assertTrue(
                resolution.contains("parametersOf("),
                "$rel ($where) resolves SupportFormViewModel with a bare koinViewModel(), so its " +
                    "ticket carries no category and no context and an admin cannot tell where it " +
                    "came from. Pass `koinViewModel { parametersOf(category, context) }`.",
            )
        }
    }

    private val dialog =
        "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportFormDialog.kt"

    @Test
    fun `every way out of the dialog resets the form`() {
        val code = codeOf(dialog)
        assertTrue(
            code.contains("viewModel.reset()"),
            "$dialog never resets. The ViewModel is scoped to the SCREEN, so closing the dialog " +
                "leaves it holding submitted = true and the next visit shows the confirmation " +
                "instead of a form.",
        )
        // Four ways out: the confirmation's button and dismiss-request, and the
        // form's button and dismiss-request. Any one of them still calling
        // `onDismiss` directly skips the reset.
        for (leak in listOf("onClick = onDismiss", "onDismissRequest = onDismiss")) {
            assertTrue(
                !code.contains(leak),
                "$dialog still has `$leak`, which closes the dialog without resetting it",
            )
        }
    }

    @Test
    fun `an already-open request is shown as information, not as the person's mistake`() {
        val code = codeOf(dialog)
        assertTrue(
            code.contains("state.alreadyHasOpenTicket"),
            "$dialog ignores alreadyHasOpenTicket entirely, so the flag is dead state and the " +
                "person is told they made an error when they did not",
        )
        assertTrue(
            code.contains("!state.alreadyHasOpenTicket"),
            "$dialog leaves Send enabled while a request is already open, so the only thing the " +
                "button can do is earn the same refusal again",
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

    @Test
    fun `the settings entry point is not miscategorised as an age refusal`() {
        val settings = codeOf(entryPoints.getValue("settings (the general way in)"))
        val resolution =
            Regex("SupportFormViewModel\\s*=(.*?)SupportFormDialog\\(")
                .find(settings)
                ?.groupValues
                ?.get(1)
                .orEmpty()
        assertTrue(
            resolution.contains("SupportCategory.Other"),
            "Settings is the general way in — somebody arriving there was not refused anything, " +
                "so filing their ticket under Age would mislead the admin triaging it. " +
                "Expected SupportCategory.Other, got: $resolution",
        )
    }
}

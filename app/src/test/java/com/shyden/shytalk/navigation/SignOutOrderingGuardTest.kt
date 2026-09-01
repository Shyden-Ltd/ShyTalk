package com.shyden.shytalk.navigation

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SHY-0497 — sign-out must FINISH before the app navigates to the sign-in screen.
 *
 * Observed on dev driving J12: sign-out reached the sign-in screen, and the very
 * next step found the app back on Home, fully signed in. Nothing in the walk
 * navigated there.
 *
 * The story guessed at a persisted session being restored. It is not that.
 * Nothing is restored — the sign-out simply has not happened yet:
 *
 *  1. `onSignOut` launches `authRepository.signOut()` on a process-scoped
 *     coroutine and returns immediately.
 *  2. The nav graph navigates to `Screen.SignIn` on the next line.
 *  3. `SignInScreen` composes a fresh `AuthViewModel`, whose `init` asks
 *     `authRepository.isAuthenticated` — which is `auth.currentUser != null`,
 *     and is STILL NON-NULL because step 1 has not completed.
 *  4. init sets `isAuthenticated = true`, and the auth gate in `SignInScreen`
 *     leaves for Main.
 *
 * The person is back inside the account they just left. On a platform with a
 * minor cohort, handing the phone over at that moment is a safeguarding
 * problem, not a UX one.
 *
 * `SignOutCoordinator` already types this correctly — its `signOut` parameter is
 * `suspend () -> Unit`, so it CAN be awaited. Both nav graphs subverted it by
 * passing a lambda whose body is a `() -> Unit` that launches and returns. The
 * coordinator dutifully awaited a function that finished instantly without
 * signing anybody out.
 *
 * So the fix is a type, not new machinery: `onSignOut` is `suspend`, and the
 * race stops being representable. This guard keeps it that way — the signature
 * is the fix, and a signature is exactly the kind of thing a later refactor
 * quietly reverts.
 */
class SignOutOrderingGuardTest {
    private val repoRoot =
        File(System.getProperty("user.dir")!!).let { if (it.name == "app") it.parentFile!! else it }

    private val androidGraph =
        File(repoRoot, "app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt")

    private val sharedGraph =
        File(
            repoRoot,
            "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt",
        )

    private val mainActivity =
        File(repoRoot, "app/src/main/java/com/shyden/shytalk/MainActivity.kt")

    @Test
    fun `the files this guard reads actually exist`() {
        // Anchors. A renamed file would otherwise leave every assertion below
        // passing over an empty string.
        listOf(androidGraph, sharedGraph, mainActivity).forEach {
            assertTrue("missing: ${it.path}", it.isFile)
        }
    }

    @Test
    fun `both nav graphs still navigate to SignIn after signing out`() {
        // The other half of the anchor: if this navigation moves elsewhere, the
        // signature assertions below are guarding a sequence that no longer
        // exists, and the real one is unguarded.
        listOf(androidGraph, sharedGraph).forEach {
            assertTrue(
                "${it.name} no longer navigates to SignIn — this guard may be watching the wrong file",
                it.readText().contains("navigate(Screen.SignIn.route)"),
            )
        }
    }

    @Test
    fun `onSignOut is suspend in both nav graphs`() {
        listOf(androidGraph, sharedGraph).forEach { file ->
            assertTrue(
                "${file.name} declares onSignOut as a non-suspending lambda. It cannot be awaited, " +
                    "so navigation to SignIn races the sign-out and SignInScreen sees a user who " +
                    "is still signed in (SHY-0497).",
                Regex("""onSignOut:\s*suspend\s*\(\)\s*->\s*Unit""").containsMatchIn(file.readText()),
            )
        }
    }

    @Test
    fun `MainActivity waits for the process-scoped sign-out rather than firing it`() {
        // Process-scoped is right and stays: sign-out must survive the Activity
        // the navigation destroys. But it must also be WAITED for, or the
        // scoping is the only thing that changed.
        val src = mainActivity.readText()
        assertTrue(
            "MainActivity still launches authRepository.signOut() without joining it, so onSignOut " +
                "returns before anybody is signed out (SHY-0497).",
            Regex("""\.join\(\)""").containsMatchIn(src),
        )
        assertTrue(
            "the sign-out should still outlive this Activity",
            src.contains("ProcessLifecycleOwner"),
        )
    }
}

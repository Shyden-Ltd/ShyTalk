package com.shyden.shytalk.core.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SHY-0444 — a screen that answers "there is no picture" must also answer
 * "the picture did not arrive".
 *
 * [RemoteImageGuardTest] stopped screens falling through to Coil's broken-image
 * state. It did not catch the subtler half, which shipped anyway: seven screens
 * hand-rolled a *good* empty state behind `if (iconUrl.isNotBlank())` and left
 * the FAILED-load case to the generic surface tint. The gift wall was the
 * clearest — a gift with no icon drew a tinted circle with its initials, and a
 * gift whose icon 404'd drew a flat grey square.
 *
 * Those two are the same thing to the person holding the phone, which is what
 * the story asked for: "identical to a gift with no icon at all".
 *
 * Worth recording how it stayed hidden: `RemoteImage`'s KDoc, and
 * [RemoteImageGuardTest]'s own failure message, BOTH stated that the gift wall
 * passed its initials as `error`. Neither was true. Three documents asserting a
 * behaviour is not a test of it.
 *
 * The rule is mechanical: a file that branches on a blank image URL and also
 * draws a remote image must go through [RemoteImageWithFallback], which renders
 * the screen's own fallback UNDER a transparent-on-failure image — so the two
 * states are identical by construction rather than by two implementations
 * staying in step.
 */
class RemoteImageFallbackGuardTest {
    private val repoRoot =
        File(System.getProperty("user.dir")!!).let { if (it.name == "app") it.parentFile!! else it }

    private val roots =
        listOf(File(repoRoot, "shared/src/commonMain"), File(repoRoot, "app/src/main"))

    /** The component that layers a fallback under the image — it IS the fix. */
    private val component = "shared/src/commonMain/kotlin/com/shyden/shytalk/core/ui/RemoteImage.kt"

    /**
     * The defect, as a shape: a branch on an image URL whose very next line
     * opens a plain [RemoteImage].
     *
     * Adjacency is the whole point. An earlier draft asked only whether a file
     * contained a URL branch AND a `RemoteImage` call anywhere in it, which
     * flagged `if (coverUrl != null && !uiState.isEditing)` — a branch deciding
     * whether the cover is TAPPABLE, nothing to do with fallbacks. A guard that
     * reports things nobody can fix gets switched off.
     *
     * Matching the null forms as well as the blank ones matters: four of the
     * twelve sites were `if (photoUrl != null)`, and a sweep that had only
     * looked for `isNotBlank()` would have left the avatars behind.
     *
     * The condition is matched loosely on purpose. An earlier draft tried to
     * balance parentheses with `[^)]*` and silently matched NOTHING, because
     * `isNotBlank()` closes a paren of its own — a guard that scans the whole
     * tree and reports nothing looks exactly like a guard that passes.
     */
    private val urlBranch = Regex("""^\s*if \(.*[Uu]rl\b.*\) \{\s*$""")

    private val plainRemoteImage = Regex("""^\s*RemoteImage\($""")

    /**
     * Whether the branch opened at [ifLine] has an `else`.
     *
     * This is what separates the defect from its look-alike. The defect is
     * "you chose what to draw when the URL is empty and left the FAILED case
     * generic" — it needs a chosen alternative to be inconsistent WITH.
     *
     * `PrivateMessageBubble` asks
     * `if (type == STICKER && !stickerUrl.isNullOrEmpty())` with no else: an
     * absent sticker URL means the message is not a sticker, not that something
     * else should be drawn. Flagging it would be asking for a fallback that
     * should not exist.
     */
    private fun hasElseBranch(
        lines: List<String>,
        ifLine: Int,
    ): Boolean {
        val indent = lines[ifLine].takeWhile { it == ' ' }
        for (i in ifLine + 1 until lines.size) {
            if (lines[i] == "$indent} else {") return true
            if (lines[i] == "$indent}") return false
        }
        return false
    }

    private fun kotlinSources() =
        roots.flatMap { root ->
            if (!root.isDirectory) {
                emptyList()
            } else {
                root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            }
        }

    /**
     * The file's lines with comments BLANKED rather than removed.
     *
     * Dropping them shifts every line after the first comment, so the numbers
     * this guard reports would not be the numbers in the file — sending whoever
     * reads the failure to the wrong place, which is worse than reporting none.
     */
    private fun code(file: File) =
        file.readText().lines().map {
            val t = it.trimStart()
            if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it
        }

    @Test
    fun `the scan actually reaches the source tree`() {
        roots.forEach { assertTrue("missing source root: ${it.path}", it.isDirectory) }
        assertTrue("scanned no Kotlin sources at all", kotlinSources().count() > 100)
    }

    @Test
    fun `the guard's own pattern matches the shape it exists to find`() {
        // Without this the regex could be quietly wrong and the sweep would
        // report a clean tree it never actually examined.
        listOf(
            "                if (gift.iconUrl.isNotBlank()) {",
            "    if (photoUrl != null) {",
            "            if (url != null && url.isNotBlank()) {",
            "                if (message.giftIconUrl.isNotEmpty()) {",
        ).forEach { assertTrue("should match: $it", urlBranch.containsMatchIn(it)) }
        assertTrue(plainRemoteImage.containsMatchIn("                RemoteImage("))
    }

    @Test
    fun `the guard's pattern does NOT match branches that are about something else`() {
        // The other half. A guard that flagged every url null-check would be
        // turned off rather than obeyed.
        listOf(
            "                if (description.isNotBlank()) {",
            // `imageUrls` asks whether a message HAS attachments — a different
            // question, and the \b after `Url` is what keeps it out.
            "                    if (message.imageUrls.isNotEmpty()) {",
        ).forEach { assertTrue("should NOT match: $it", !urlBranch.containsMatchIn(it)) }

        // A url branch whose body is NOT an image is not this defect. Adjacency
        // is what excludes it, which is why the pair is asserted and not the
        // condition alone: this one decides whether the cover is TAPPABLE.
        val tappableCover =
            listOf(
                "            if (coverUrl != null && !uiState.isEditing) {",
                "                Modifier.clickable { onTapPhoto(coverUrl) }",
            )
        assertTrue(urlBranch.containsMatchIn(tappableCover[0]))
        assertTrue(!plainRemoteImage.containsMatchIn(tappableCover[1]))

        // And a url branch with NO else is not this defect either: there is no
        // chosen alternative for the failed case to be inconsistent with.
        val stickerOrNothing =
            listOf(
                "        if (message.type == STICKER && !message.stickerUrl.isNullOrEmpty()) {",
                "            RemoteImage(",
                "            )",
                "        }",
            )
        assertTrue(urlBranch.containsMatchIn(stickerOrNothing[0]))
        assertTrue(plainRemoteImage.containsMatchIn(stickerOrNothing[1]))
        assertTrue("a branch with no else must not be flagged", !hasElseBranch(stickerOrNothing, 0))
        // RemoteImageWithFallback is the fix, never the offence.
        assertTrue(!plainRemoteImage.containsMatchIn("        RemoteImageWithFallback("))
    }

    @Test
    fun `the layering component exists and takes a composable fallback`() {
        val f = File(repoRoot, component)
        assertTrue("RemoteImage.kt is missing at $component", f.isFile)
        val src = f.readText()
        assertTrue(
            "RemoteImageWithFallback is missing — the guard below would pass while protecting nothing",
            src.contains("fun RemoteImageWithFallback("),
        )
        assertTrue(
            "RemoteImageWithFallback must take the fallback as composable content",
            Regex("""fallback:\s*@Composable""").containsMatchIn(src),
        )
    }

    @Test
    fun `no screen answers the empty case without answering the failed case`() {
        val offenders =
            kotlinSources()
                .filter { it.relativeTo(repoRoot).path != component }
                .flatMap { file ->
                    val lines = code(file)
                    lines.indices
                        .filter { i ->
                            urlBranch.containsMatchIn(lines[i]) &&
                                i + 1 < lines.size &&
                                plainRemoteImage.containsMatchIn(lines[i + 1]) &&
                                hasElseBranch(lines, i)
                        }.map { "${file.relativeTo(repoRoot).path}:${it + 1}" }
                }.sorted()

        assertTrue(
            "These draw a chosen fallback when an image URL is absent but leave the FAILED-load " +
                "case to the generic surface tint, so the same absence looks like two different " +
                "things. Use RemoteImageWithFallback, which draws the screen's own fallback under " +
                "the image and makes both states identical by construction:\n" +
                offenders.joinToString("\n") { "  $it" },
            offenders.isEmpty(),
        )
    }
}

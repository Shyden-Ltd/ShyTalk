package com.shyden.shytalk.core.util

import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Every client-built query string goes through the ONE shared encoder.
 *
 * SHY-0143. The two platforms had drifted onto different encoders for the same
 * call: Android's `URLEncoder.encode` and Ktor's `encodeURLQueryComponent()`
 * with default arguments — and that default leaves `& = # + ?` literal
 * (measured on ktor-http 3.5.2). So a value containing `&` split the query and
 * one containing `#` truncated at the fragment, and the server answered about
 * something other than what was asked, with a 200.
 *
 * The Android unit test for that encoding passed the whole time, because it
 * only ever tested Android. That is the shape a per-platform fix produces, so
 * this pin is per-PROJECT: no source file may interpolate a value straight
 * into a query string, on either platform.
 */
class QueryEncodingWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root not found")
    }

    /** Every Kotlin source that ships in a client. */
    private fun clientSources(): List<File> =
        listOf("app/src/main", "shared/src/commonMain", "shared/src/androidMain", "shared/src/iosMain")
            .map { File(repoRoot(), it) }
            .filter { it.exists() }
            .flatMap { it.walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }

    @Test
    fun `no client source puts an unencoded value into a query string`() {
        // Whole-FILE, not line-by-line, and anchored on the query parameter
        // itself rather than on proximity to "/api/".
        //
        // The first version of this pin was defeated by shapes already in the
        // repo, which mutation testing showed: it required a quote or paren
        // immediately before `api/` (so `"$workerUrl/api/…"` was never
        // scanned), it scanned single lines (so a URL concatenated across
        // three lines was invisible), and it required `=$` (so string
        // concatenation was invisible). Two of the five call sites this story
        // fixed had no protection at all — including the iOS one, on the
        // platform with no host tests.
        val offenders = mutableListOf<String>()

        clientSources().forEach { file ->
            val text = file.readText()

            // Locals proven safe by assignment: `val x = encodeUrlQueryComponent(…)`.
            // This is what makes the check about the VALUE rather than about
            // an encode call happening to sit nearby — an earlier version
            // looked backwards for the function name and passed whenever one
            // existed, so removing the encoding from the interpolation while
            // leaving the assignment above it went undetected at 2 of 4 sites.
            val safeLocals =
                Regex("""val\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*encodeUrlQueryComponent\(""")
                    .findAll(text)
                    .map { it.groupValues[1] }
                    .toSet()

            Regex("""[?&][A-Za-z0-9_]+=""").findAll(text).forEach { m ->
                val after = text.substring(m.range.last + 1, minOf(m.range.last + 200, text.length))
                val line = text.substring(0, m.range.first).count { it == '\n' } + 1

                // `${'$'}{ … }` — the expression itself must encode.
                Regex("""^\$\{([^}]*)}""").find(after)?.let { braced ->
                    if (!braced.groupValues[1].contains("encodeUrlQueryComponent")) {
                        offenders.add("${file.relativeTo(repoRoot())}:$line  ${m.value}\${...}")
                    }
                    return@forEach
                }

                // `${'$'}name` — the identifier must be a proven-safe local.
                Regex("""^\$([A-Za-z_][A-Za-z0-9_]*)""").find(after)?.let { bare ->
                    val name = bare.groupValues[1]
                    if (name !in safeLocals) {
                        offenders.add("${file.relativeTo(repoRoot())}:$line  ${m.value}$$name")
                    }
                    return@forEach
                }

                // `" + expr` — string concatenation.
                Regex("""^"\s*\+\s*([A-Za-z_][A-Za-z0-9_.]*)""").find(after)?.let { cat ->
                    val expr = cat.groupValues[1]
                    if (!expr.contains("encodeUrlQueryComponent") && expr !in safeLocals) {
                        offenders.add("${file.relativeTo(repoRoot())}:$line  ${m.value}\" + $expr")
                    }
                }
            }
        }

        assertTrue(
            offenders.isEmpty(),
            "these put a dynamic value into a query string without encodeUrlQueryComponent() — " +
                "a value containing '&' or '#' changes which request the SERVER sees, and " +
                "server-side validation cannot tell, because what arrives is well-formed:\n" +
                offenders.joinToString("\n"),
        )
    }

    @Test
    fun `both platforms' ban-status call uses the shared encoder`() {
        // The specific call this story turns on, pinned by name so a future
        // edit cannot quietly revert one platform.
        listOf(
            "app/src/main/java/com/shyden/shytalk/data/repository/DeviceRepositoryImpl.kt",
            "shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosSmallRepositories.kt",
        ).forEach { rel ->
            // Skip comment lines. Both files DOCUMENT the endpoint above the
            // call, and anchoring on the first textual match landed in the
            // KDoc — the "a comment is not a code reference" trap, in a pin
            // written to catch exactly that class of thing.
            val callLines =
                File(repoRoot(), rel)
                    .readLines()
                    .filterNot { it.trimStart().startsWith("//") || it.trimStart().startsWith("*") }
                    .filter { it.contains("/api/ban-status") }
            assertTrue(callLines.isNotEmpty(), "$rel must call /api/ban-status outside a comment")
            assertTrue(
                callLines.all { it.contains("encodeUrlQueryComponent") },
                "$rel must build the ban-status query with the shared encoder, got: $callLines",
            )
        }
    }
}

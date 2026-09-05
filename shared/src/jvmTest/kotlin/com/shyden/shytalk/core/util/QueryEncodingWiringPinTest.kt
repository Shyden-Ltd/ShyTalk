package com.shyden.shytalk.core.util

import com.shyden.shytalk.testsupport.RepoSource.repoRoot
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
    /** Every Kotlin source that ships in a client. */
    private fun clientSources(): List<File> =
        listOf("app/src/main", "shared/src/commonMain", "shared/src/androidMain", "shared/src/iosMain")
            .map { File(repoRoot(), it) }
            .filter { it.exists() }
            .flatMap { it.walkTopDown().filter { f -> f.isFile && f.extension == "kt" }.toList() }

    /**
     * The scan, extracted so the pin can be tested on fixture text.
     *
     * A pin with no test of its own is how the previous version shipped
     * missing 2 of the 5 shapes it claimed to protect.
     */
    internal fun scan(
        label: String,
        text: String,
    ): List<String> {
        val offenders = mutableListOf<String>()

        // Locals proven safe by assignment: `val x = encodeUrlQueryComponent(…)`.
        val safeLocals =
            Regex("""val\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*encodeUrlQueryComponent\(""")
                .findAll(text)
                .map { it.groupValues[1] }
                .toSet()

        Regex("""[?&][A-Za-z0-9_]+=""").findAll(text).forEach { m ->
            val after = text.substring(m.range.last + 1, minOf(m.range.last + 400, text.length))
            val line = text.substring(0, m.range.first).count { it == '\n' } + 1

            fun flag(why: String) = offenders.add("$label:$line  ${m.value} — $why")

            // A literal value (`?env=prod`) is fine and needs no encoding.
            val dynamic = after.startsWith("$") || Regex("""^"\s*\+""").containsMatchIn(after)
            if (!dynamic) return@forEach

            val recognised =
                when {
                    // `${ … }` — the expression itself must encode.
                    Regex("""^\$\{([^}]*)}""").find(after)?.let {
                        if (!it.groupValues[1].contains("encodeUrlQueryComponent")) flag("unencoded \${...}")
                        true
                    } == true -> true

                    // `$name` — must be a local proven safe by assignment.
                    Regex("""^\$([A-Za-z_][A-Za-z0-9_]*)""").find(after)?.let {
                        if (it.groupValues[1] !in safeLocals) flag("unencoded \$${it.groupValues[1]}")
                        true
                    } == true -> true

                    // `" + expr` — concatenation, parenthesised or not.
                    Regex("""^"\s*\+\s*\(?\s*([A-Za-z_][A-Za-z0-9_.]*)""").find(after)?.let {
                        val expr = it.groupValues[1]
                        if (!expr.contains("encodeUrlQueryComponent") && expr !in safeLocals) {
                            flag("unencoded concatenation of $expr")
                        }
                        true
                    } == true -> true

                    else -> false
                }

            // FAIL-CLOSED. The previous version silently PASSED anything it
            // did not recognise, which is the posture that let two shapes
            // through. An unrecognised dynamic value is reported, so the
            // pin has to be taught the shape rather than quietly ignoring it.
            if (!recognised) flag("unrecognised dynamic value — teach the pin this shape")
        }
        return offenders
    }

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
        val offenders =
            clientSources().flatMap { file ->
                scan(file.relativeTo(repoRoot()).toString(), file.readText())
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
    fun `the pin catches the shapes that defeated its predecessors`() {
        // A pin with no test of its own is how the previous two versions
        // shipped: the first missed 2 of the 5 live call sites, the second
        // missed 2 of 4 mutation probes. These are the exact shapes.
        fun offenders(src: String) = scan("fixture", src)

        // Round 6's escapes.
        assertTrue(
            offenders("""api.get("/x?key=" + key)""").isNotEmpty(),
            "plain concatenation must be caught",
        )
        assertTrue(
            offenders("""api.get("${'$'}base/api/x?key=${'$'}key")""").isNotEmpty(),
            "a base-URL prefix must not hide the parameter",
        )

        // Round 7's escapes.
        assertTrue(
            offenders("""api.get("/x?key=" + (key))""").isNotEmpty(),
            "PARENTHESISED concatenation must be caught",
        )
        assertTrue(
            offenders("""api.get("/x?key=" + someObj.field)""").isNotEmpty(),
            "a property access must be caught",
        )

        // The fail-closed default: a shape the pin does not recognise is
        // REPORTED, not silently accepted.
        assertTrue(
            offenders("""api.get("/x?key=" + when (a) { else -> b })""").isNotEmpty(),
            "an unrecognised dynamic shape must be reported, not passed",
        )

        // And the safe shapes must NOT be reported, or the pin becomes noise
        // that people learn to ignore.
        assertTrue(offenders("""api.get("/x?env=prod")""").isEmpty(), "a literal value is fine")
        assertTrue(
            offenders("""api.get("/x?key=${'$'}{encodeUrlQueryComponent(key)}")""").isEmpty(),
            "an inline encode is fine",
        )
        assertTrue(
            offenders(
                """
                val encodedKey = encodeUrlQueryComponent(key)
                api.get("/x?key=${'$'}encodedKey")
                """.trimIndent(),
            ).isEmpty(),
            "a local proven safe by assignment is fine",
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

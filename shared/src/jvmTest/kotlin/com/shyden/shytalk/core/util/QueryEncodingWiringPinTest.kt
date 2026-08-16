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
    fun `no client source interpolates a raw value into a query string`() {
        // `?name=$value` or `&name=$value` with a bare `$` — i.e. the value
        // reaches the URL exactly as held. `${encodeUrlQueryComponent(x)}` and
        // `$encodedThing` are fine; the pattern below requires the interpolated
        // identifier NOT to be an encode call and NOT to be named as encoded.
        val raw = Regex("""[?&][A-Za-z0-9_]+=\$\{?(?!encodeUrlQueryComponent)([A-Za-z_][A-Za-z0-9_]*)""")
        // Scoped to API calls. A `market://details?id=…` Play Store deep link
        // is not a request this app makes, and its value is BuildConfig —
        // flagging it would be noise that teaches people to ignore the pin.
        val apiCall = Regex("""["(]/?api/""")
        val offenders = mutableListOf<String>()

        clientSources().forEach { file ->
            file.readLines().forEachIndexed { i, line ->
                if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return@forEachIndexed
                if (!apiCall.containsMatchIn(line)) return@forEachIndexed
                raw.findAll(line).forEach { m ->
                    val name = m.groupValues[1]
                    // A local already named for being encoded is the other
                    // legitimate shape (`val uid = encodeUrlQueryComponent(...)`).
                    if (!name.lowercase().contains("encoded") && !name.lowercase().startsWith("enc")) {
                        offenders.add("${file.relativeTo(repoRoot())}:${i + 1}  ${line.trim()}")
                    }
                }
            }
        }

        assertTrue(
            offenders.isEmpty(),
            "these interpolate a raw value into a query string — route them through " +
                "encodeUrlQueryComponent(), or a value containing '&' or '#' changes which " +
                "request the SERVER sees:\n" + offenders.joinToString("\n"),
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

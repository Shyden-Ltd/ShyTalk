package com.shyden.shytalk.feature.support

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * No screen offers a mailbox nobody reads.
 *
 * SHY-0422. Four strings told people to email shytalk.help@gmail.com, and
 * Settings printed the same address beside "Contact us" in link colour. There
 * is no support mailbox — operator, 2026-08-20 — so every one of those was an
 * instruction to send a message into nothing.
 *
 * Translated copy is the reason this is a pin rather than a unit test. The
 * address lived in every locale file; removing it from the English one and
 * calling it done is exactly the mistake that leaves 20 languages still
 * pointing at the void. The scan covers all of them, and asserts it FOUND
 * them, because a scan that silently matches no files passes forever.
 */
class SupportContactRouteWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root not found")
    }

    private fun localeFiles(): List<File> =
        File(repoRoot(), "shared/src/commonMain/composeResources")
            .listFiles()
            .orEmpty()
            .filter { it.isDirectory && it.name.startsWith("values") }
            .mapNotNull { File(it, "strings.xml").takeIf(File::exists) }
            .sortedBy { it.parentFile.name }

    /**
     * Extracted so the pin can be shown to catch something. An address is any
     * `x@y.tld` — naming only the one address we removed would let the next
     * unmonitored mailbox in without a word.
     */
    internal fun addressesIn(xml: String): List<String> =
        Regex("""[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}""").findAll(xml).map { it.value }.toList()

    @Test
    fun `the scan reaches every locale, so a silent zero-file pass is impossible`() {
        val locales = localeFiles()
        assertTrue(
            // Five since SHY-0289; hardcoded so a zero-file scan cannot pass.
            locales.size >= 5,
            "expected at least 5 locale files, found ${locales.size}: ${locales.map { it.parentFile.name }}",
        )
        assertTrue(
            locales.any { it.parentFile.name == "values" },
            "the base (English) locale was not among ${locales.map { it.parentFile.name }}",
        )
    }

    @Test
    fun `the scan can actually see an address`() {
        val fixture = """<string name="x">For support, contact shytalk.help@gmail.com</string>"""
        assertEquals(listOf("shytalk.help@gmail.com"), addressesIn(fixture))
    }

    @Test
    fun `a domain on its own is not mistaken for an address`() {
        val fixture = """<string name="x">For support, visit shyden.co.uk</string>"""
        assertEquals(emptyList(), addressesIn(fixture))
    }

    @Test
    fun `no locale offers an email address`() {
        val offenders =
            localeFiles().flatMap { file ->
                addressesIn(file.readText()).map { "${file.parentFile.name}: $it" }
            }
        assertEquals(emptyList(), offenders)
    }

    /**
     * The four strings the story named. If one is renamed or deleted, this
     * fails rather than quietly reducing what the pin above covers.
     */
    @Test
    fun `the four surfaces that used to print the address still exist`() {
        val english = File(repoRoot(), "shared/src/commonMain/composeResources/values/strings.xml").readText()
        val missing =
            listOf(
                "support_contact",
                // `contact_support_help` was here. Its SCREEN was deleted on
                // 2026-08-25 (operator: "we should only have 1 screen, saying
                // that we cannot connect"), so the surface this pin protected
                // no longer exists to print an address on. Removed rather than
                // renamed — OneConnectionFailureScreenTest now asserts the
                // whole thing stays gone, string included.
                // Was `contact_support_hint`, renamed 2026-08-25. The SURFACE is
                // what this pin protects — the line under Retry on SignIn — and
                // it still exists and still prints no address. Only its name and
                // its job changed: it told people the fault was ours, and it now
                // tells them what to try. The rename is deliberate; the pin
                // failing on it is the pin working.
                "connection_tips",
                "device_locked_description",
            ).filterNot { english.contains("""<string name="$it">""") }
        assertEquals(emptyList(), missing)
    }

    /**
     * A screen that cannot reach Settings must not be told to go there.
     *
     * `support_contact` — "go to Settings and choose Contact us" — was shared by
     * WarningScreen and SuspensionScreen. The warned person acknowledges and
     * lands back in the app, so Settings is one tap away. The suspended person
     * is on a terminal screen whose only controls are Sign in, Sign out and the
     * appeal box; for them that sentence names a place they cannot get to.
     * They were split, and this keeps them split.
     */
    @Test
    fun `the suspension screen does not send people to Settings`() {
        val screen =
            File(
                repoRoot(),
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/suspension/SuspensionScreen.kt",
            ).readText()
        assertTrue(
            screen.contains("Res.string.suspension_support_contact"),
            "SuspensionScreen no longer uses its own contact string",
        )
        assertEquals(
            emptyList(),
            Regex("""Res\.string\.support_contact\b""").findAll(withoutComments(screen)).map { it.value }.toList(),
        )
    }

    @Test
    fun `every locale carries both contact strings, not just English`() {
        val missing =
            localeFiles().flatMap { file ->
                listOf("support_contact", "suspension_support_contact")
                    .filterNot { file.readText().contains("""<string name="$it">""") }
                    .map { "${file.parentFile.name}: $it" }
            }
        assertEquals(emptyList(), missing)
    }

    /**
     * Kotlin comments are stripped before scanning. Two KDoc lines document
     * address handling by quoting an example — `"user@mailinator.com"` in the
     * disposable-domain check, `"te*t@example.com"` in the censor helper — and
     * a pin that cannot tell documentation from copy gets its exemption list
     * grown until it catches nothing.
     */
    internal fun withoutComments(source: String): String =
        source
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }

    /**
     * The seeded dev personas sign in with `<role>@shytalk.dev` addresses. They
     * are account identifiers on a domain that serves no mail and is offered to
     * nobody, so they are not a contact route. Any OTHER address in a string
     * literal is copy until proven otherwise.
     */
    private val devPersonaDomain = "@shytalk.dev"

    internal fun copyAddressesIn(source: String): List<String> =
        Regex(""""[^"\n]*"""")
            .findAll(withoutComments(source))
            .map { it.value }
            .flatMap { addressesIn(it).asSequence() }
            .filterNot { it.endsWith(devPersonaDomain) }
            .toList()

    @Test
    fun `the source scan catches an address offered in copy`() {
        val fixture = """val hint = "For support, contact shytalk.help@gmail.com""""
        assertEquals(listOf("shytalk.help@gmail.com"), copyAddressesIn(fixture))
    }

    @Test
    fun `an address quoted in documentation is not copy`() {
        val line = """/** Censor an email address for display (e.g. "te*t@example.com"). */"""
        assertEquals(emptyList(), copyAddressesIn(line))
        assertEquals(emptyList(), copyAddressesIn("""// see "user@mailinator.com" for the shape"""))
    }

    @Test
    fun `a seeded dev persona account is not a contact route`() {
        val fixture = """DevPersona("P-12", "admin@shytalk.dev", "Greta", Cohort.ADULT)"""
        assertEquals(emptyList(), copyAddressesIn(fixture))
    }

    @Test
    fun `the dev-domain exemption does not swallow a real address beside it`() {
        val fixture = """listOf("admin@shytalk.dev", "shytalk.help@gmail.com")"""
        assertEquals(listOf("shytalk.help@gmail.com"), copyAddressesIn(fixture))
    }

    /** Settings printed the address beside the row as if it were a mailto. */
    @Test
    fun `no client source hardcodes an email address in UI copy`() {
        val sources =
            listOf("app/src/main", "shared/src/commonMain", "shared/src/androidMain", "shared/src/iosMain")
                .map { File(repoRoot(), it) }
                .filter { it.exists() }
                .flatMap { root -> root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }
        assertTrue(sources.size > 100, "expected the whole client tree, scanned only ${sources.size} files")

        val offenders = sources.flatMap { file -> copyAddressesIn(file.readText()).map { "${file.name}: $it" } }
        assertEquals(emptyList(), offenders)
    }
}

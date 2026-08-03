package com.shyden.shytalk.resources

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.ExperimentalResourceApi
import org.jetbrains.compose.resources.getString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale

/**
 * SHY-0271 — every string resource, resolved through the REAL Compose
 * pipeline, on a REAL device.
 *
 * The operator read `Driver\'s license` off the age-verification screen. The
 * file-level guard in `express-api/tests/scripts/locale-string-content.test.js`
 * catches that pattern in the source XML, but it can only ever be a PROXY for
 * the question that actually matters: what does Compose Multiplatform DO with
 * an escape sequence?
 *
 * `Res.allStringResources` answers it directly. This resolves all ~838 keys via
 * `getString` — the same path `stringResource` uses — and asserts on the value a
 * user would actually read. A test written against the files can be fooled by a
 * new escape family nobody thought to grep for; this one cannot, because it
 * inspects the output rather than the input.
 *
 * It also settles empirically whether `\uXXXX` survives to the screen, which
 * decides the fate of `Loading…` on the starting screen.
 */
@OptIn(ExperimentalResourceApi::class)
@RunWith(AndroidJUnit4::class)
class StringResourceContentTest {
    private fun resolveAll(): Map<String, String> =
        runBlocking {
            Res.allStringResources.mapValues { (_, res) -> getString(res) }
        }

    /** Which locale this run actually verified — a green result is otherwise ambiguous. */
    private val resolvedLocale: String get() = Locale.getDefault().toLanguageTag()

    private companion object {
        // Hoisted: constructing this inside a filter recompiles it once per string.
        val MARKUP = Regex("</?(?:div|span|p|br|b|i|html|body)\\b", RegexOption.IGNORE_CASE)
        val ENTITY = Regex("&[a-zA-Z#][a-zA-Z0-9]*;")
    }

    @Test
    fun theWholeCorpusWasActuallyResolved() {
        // Vacuous-pass guard. An empty or truncated map would make every
        // assertion below pass while checking nothing — the exact shape of
        // failure this story exists to eliminate.
        val all = resolveAll()
        assertEquals(
            "resource count changed — update this number deliberately, do not weaken it",
            838,
            all.size,
        )
        assertTrue("every resource resolved to a non-null value", all.values.all { it.isNotEmpty() })
    }

    @Test
    fun noStringResourceRendersABackslash() {
        // Deliberately ANY backslash, not an enumerated list of escapes. A
        // predicate that names the sequences it knows about can only catch
        // yesterday's defect; `\'` was missed for exactly that reason, and
        // `\"`, `…` and `\“` are all the same mistake wearing a different
        // character. No user-facing copy in this app legitimately contains a
        // backslash, so the strict rule is also the correct one.
        val offenders =
            resolveAll()
                .filterValues { it.contains('\\') }
                .map { (key, value) -> "$key = $value" }
                .sorted()
        assertEquals("resolved locale: $resolvedLocale", emptyList<String>(), offenders)
    }

    @Test
    fun noStringResourceIsBlankOrLeaksMarkup() {
        val offenders =
            resolveAll()
                .filterValues { it.isBlank() || MARKUP.containsMatchIn(it) }
                .map { (key, value) -> "$key = $value" }
                .sorted()
        assertEquals("resolved locale: $resolvedLocale", emptyList<String>(), offenders)
    }

    @Test
    fun noStringResourceRendersAnUndecodedEntity() {
        // Settles for entities what this file already settled for backslashes:
        // does Compose decode `&amp;` and friends, or do they reach the screen?
        // Four locales legitimately contain `&amp;` in their terms copy, so if
        // CMP decodes entities this passes and proves it; if it does not, it
        // has caught `Terms &amp; Conditions` shipping. Either answer is worth
        // knowing, and neither can be settled by reading the files.
        val offenders =
            resolveAll()
                .filterValues { ENTITY.containsMatchIn(it) }
                .map { (key, value) -> "$key = $value" }
                .sorted()
        assertEquals("resolved locale: $resolvedLocale", emptyList<String>(), offenders)
    }
}

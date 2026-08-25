package com.shyden.shytalk.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The colour Android paints before Compose draws (SHY-0443).
 *
 * `Theme.ShyTalk` was `Theme.AppCompat.Light.NoActionBar`, whose
 * `windowBackground` is white. `ShyTalkTheme` follows the system through
 * `isSystemInDarkTheme()`, so on a phone in dark mode the launch window
 * painted WHITE and the first Compose frame then painted `#141218` over it —
 * a flash on every cold start, which the operator saw and no assertion did.
 *
 * Read from the resource FILES rather than through a resource id, because
 * this is a build-time declaration and the app module has no Robolectric.
 * Every read below anchors first: a renamed or moved file fails the test
 * loudly rather than passing on a string it never found.
 */
class LaunchWindowBackgroundTest {
    private val res = File("src/main/res")

    private fun read(relative: String): String {
        val file = File(res, relative)
        assertTrue(
            "expected $relative to exist at ${file.absolutePath} — if it moved, this guard must move with it",
            file.isFile,
        )
        return file.readText()
    }

    @Test
    fun `the launch theme is not a light theme`() {
        // The defect itself. Any `.Light.` parent brings a white
        // windowBackground back with it.
        val themes = read("values/themes.xml")
        val parent = Regex("""<style name="Theme\.ShyTalk"\s+parent="([^"]+)"""").find(themes)
        assertTrue("no Theme.ShyTalk style found in values/themes.xml", parent != null)
        val parentName = parent!!.groupValues[1]
        assertTrue(
            "Theme.ShyTalk inherits $parentName — a Light parent paints a WHITE launch window " +
                "behind an app that follows the system theme",
            !parentName.contains(".Light."),
        )
    }

    @Test
    fun `the launch theme states its window background rather than inheriting one`() {
        val themes = read("values/themes.xml")
        assertTrue(
            "Theme.ShyTalk does not set android:windowBackground, so the flash colour is " +
                "whatever the parent theme happens to use rather than what the app paints",
            themes.contains("""<item name="android:windowBackground">@color/shytalk_window_background</item>"""),
        )
    }

    @Test
    fun `the dark window background is the colour measured on the device`() {
        // Sampled from an on-device screenshot of the real app in dark mode
        // (journey J38, OnePlus CPH2653, 2026-08-22) at four separate empty
        // points, all #141218 — Material 3's baseline dark surface, which is
        // what darkColorScheme() resolves to while ShyTalkTheme sets no
        // explicit `background`.
        val night = read("values-night/colors.xml")
        val value = Regex("""<color name="shytalk_window_background">([^<]+)</color>""").find(night)
        assertTrue("values-night/colors.xml does not define shytalk_window_background", value != null)
        assertEquals(
            "the dark launch window must match the first Compose frame exactly, not merely be dark",
            "#FF141218",
            value!!.groupValues[1].uppercase(),
        )
    }

    @Test
    fun `both themes define the colour, so neither mode falls back`() {
        // A colour defined only under values-night leaves light mode with no
        // resource at all, which is a build failure; defined only under
        // values leaves dark mode painting the LIGHT colour, which is the
        // original defect wearing a different name.
        listOf("values/colors.xml", "values-night/colors.xml").forEach { path ->
            assertTrue(
                "$path does not define shytalk_window_background",
                read(path).contains("""<color name="shytalk_window_background">"""),
            )
        }
    }
}

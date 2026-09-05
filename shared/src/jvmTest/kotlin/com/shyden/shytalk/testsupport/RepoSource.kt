package com.shyden.shytalk.testsupport

import java.io.File
import kotlin.test.assertTrue

/**
 * Reads a source file by its repository-relative path for the source-anchored
 * "pin" tests: behaviours that only show on a phone (iOS accessibility,
 * Keychain bridging) and cannot execute under the JVM are pinned at the
 * source, with the file's existence asserted so a move fails loudly instead
 * of passing on an empty read.
 */
object RepoSource {
    fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("settings.gradle.kts not found above ${System.getProperty("user.dir")}")
    }

    fun read(relative: String): String {
        val file = File(repoRoot(), relative)
        assertTrue(file.exists(), "moved: $relative")
        return file.readText()
    }
}

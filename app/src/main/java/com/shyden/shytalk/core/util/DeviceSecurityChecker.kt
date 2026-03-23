package com.shyden.shytalk.core.util

import android.os.Build
import java.io.File

object DeviceSecurityChecker {
    fun isRooted(): Boolean = hasSuBinary() || hasRootManagementApps() || hasTestKeys() || isSystemWritable()

    fun isEmulator(): Boolean =
        checkBuildFingerprint() ||
            checkBuildModel() ||
            checkBuildHardware() ||
            checkBuildProduct() ||
            checkManufacturer() ||
            hasEmulatorFiles()

    fun isUnsafe(): Boolean = isRooted() || isEmulator()

    // --- Root checks ---

    private fun hasSuBinary(): Boolean {
        val paths =
            arrayOf(
                "/system/bin/su",
                "/system/xbin/su",
                "/sbin/su",
                "/vendor/bin/su",
            )
        return paths.any { File(it).exists() }
    }

    private fun hasRootManagementApps(): Boolean {
        val packages =
            arrayOf(
                "com.topjohnwu.magisk",
                "eu.chainfire.supersu",
                "com.kingroot.kinguser",
            )
        return try {
            val runtime = Runtime.getRuntime()
            packages.any { pkg ->
                val process = runtime.exec(arrayOf("pm", "path", pkg))
                try {
                    process.inputStream.bufferedReader().use { it.readLine() != null }
                } finally {
                    process.waitFor()
                    process.destroy()
                }
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun hasTestKeys(): Boolean = Build.TAGS?.contains("test-keys") == true

    private fun isSystemWritable(): Boolean =
        try {
            val mount = Runtime.getRuntime().exec("mount")
            try {
                val output = mount.inputStream.bufferedReader().use { it.readText() }
                mount.waitFor()
                output.lines().any { line ->
                    line.contains(" /system") && line.contains("rw")
                }
            } finally {
                mount.destroy()
            }
        } catch (_: Exception) {
            false
        }

    // --- Emulator checks ---

    private fun checkBuildFingerprint(): Boolean {
        val fp = Build.FINGERPRINT?.lowercase() ?: return false
        return fp.contains("generic") || fp.contains("sdk") || fp.contains("google_sdk")
    }

    private fun checkBuildModel(): Boolean {
        val model = Build.MODEL?.lowercase() ?: return false
        return model.contains("emulator") ||
            model.contains("android sdk") ||
            model.contains("google_sdk")
    }

    private fun checkBuildHardware(): Boolean {
        val hw = Build.HARDWARE?.lowercase() ?: return false
        return hw.contains("goldfish") || hw.contains("ranchu")
    }

    private fun checkBuildProduct(): Boolean {
        val product = Build.PRODUCT?.lowercase() ?: return false
        return product.contains("sdk") || product.contains("vbox") || product.contains("emulator")
    }

    private fun checkManufacturer(): Boolean = Build.MANUFACTURER?.equals("Genymotion", ignoreCase = true) == true

    private fun hasEmulatorFiles(): Boolean = File("/dev/qemu_pipe").exists() || File("/dev/goldfish_pipe").exists()
}

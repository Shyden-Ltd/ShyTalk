plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.multiplatform.library)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.kotlin.compose)
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
        // Enforce our-code warnings-as-errors (#24c finale): any Kotlin
        // compiler warning across shared (commonMain / jvm / android / iOS)
        // now fails the build. Our Kotlin is warning-clean. The remaining iOS
        // build warnings (pod deprecations, the gitlive cinterop import, the
        // Xcode-26.3 Metal-toolchain ld: quirk) are upstream/environment and
        // are NOT Kotlin-compiler warnings, so this gate does not touch them —
        // they are tracked as upstream debt instead.
        allWarningsAsErrors = true
    }

    // JVM target exists solely to run commonTest on Windows/Linux/CI
    jvm()

    android {
        namespace = "com.shyden.shytalk.shared"
        compileSdk {
            version =
                release(36) {
                    minorApiLevel = 1
                }
        }
        minSdk = 28

        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
        }

        // Run commonTest on the android target's host (local JVM) as well —
        // clears the KMP "commonTest source directory exists, but android host
        // tests are not enabled" notice AND adds real coverage of the androidMain
        // actuals (e.g. Logger.android.kt), which jvm() never exercises.
        // isReturnDefaultValues stubs android.jar calls (android.util.Log) the
        // same way app/build.gradle.kts does, so the suite runs without
        // Robolectric.
        withHostTest {
            isReturnDefaultValues = true
        }
    }

    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach { target ->
        target.binaries.framework {
            baseName = "shared"
            isStatic = true
        }
    }

    sourceSets {
        commonTest.dependencies {
            implementation(libs.kotlin.test)
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.koin.test)
        }

        val androidHostTest by getting {
            dependencies {
                implementation(libs.mockk)
            }
        }

        @Suppress("DEPRECATION")
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.material3)
            implementation(compose.materialIconsExtended)
            implementation(compose.ui)
            api(compose.components.resources)
            implementation(libs.kotlinx.coroutines.core)
            implementation(libs.kotlinx.datetime)
            implementation(libs.kotlinx.serialization.json)
            implementation(libs.androidx.lifecycle.viewmodel)
            implementation(libs.androidx.lifecycle.runtime.compose)
            implementation(libs.koin.compose.viewmodel)
            implementation(libs.coil3.compose)
            implementation(libs.coil3.network.ktor)
            implementation(libs.jetbrains.navigation.compose)
        }

        androidMain.dependencies {
            implementation(libs.firebase.common)
            implementation(libs.ktor.client.okhttp)
            implementation(libs.lottie.compose)
            implementation(libs.androidx.security.crypto)
            implementation(libs.androidx.biometric)
            // Required by GoogleSignInHelper.android.kt actual —
            // CredentialManager + GoogleIdTokenCredential. Same versions
            // already declared in app/build.gradle.kts; pulled in here
            // so the shared module can compile its iOS-parity actual.
            implementation(libs.androidx.credentials)
            implementation(libs.androidx.credentials.play.services)
            implementation(libs.google.id)
            // Required by DevSignInHelper.android.kt actual —
            // FirebaseAuth + Tasks await() adapter for the local-emulator
            // sign-in path. firebase-auth pulls its version from the BOM
            // (matching the app module's pinned versions).
            implementation(project.dependencies.platform(libs.firebase.bom))
            implementation(libs.firebase.auth)
            implementation(libs.kotlinx.coroutines.play.services)
        }

        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
            implementation(libs.ktor.client.core)
            implementation(libs.ktor.client.content.negotiation)
            implementation(libs.ktor.serialization.json)
            implementation(libs.gitlive.firebase.app)
            implementation(libs.gitlive.firebase.auth)
            implementation(libs.gitlive.firebase.firestore)
            implementation(libs.gitlive.firebase.database)
        }
    }
}

compose.resources {
    publicResClass = true
    packageOfResClass = "com.shyden.shytalk.resources"
    generateResClass = always
}

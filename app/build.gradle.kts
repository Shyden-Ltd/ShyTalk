plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
    alias(libs.plugins.play.publisher)
}

play {
    serviceAccountCredentials.set(rootProject.file("play-service-account.json"))
    track.set("internal")
    defaultToAppBundles.set(true)
    releaseStatus.set(com.github.triplet.gradle.androidpublisher.ReleaseStatus.DRAFT)
}

android {
    namespace = "com.shyden.shytalk"
    compileSdk {
        version = release(36)
    }

    defaultConfig {
        applicationId = "com.shyden.shytalk"
        minSdk = 28
        targetSdk = 36
        versionCode = 44
        versionName = "0.44"

        testInstrumentationRunner = "com.shyden.shytalk.ShyTalkTestRunner"

        ndk {
            debugSymbolLevel = "SYMBOL_TABLE"
        }

        buildConfigField(
            "String",
            "LIVEKIT_SERVER_URL",
            "\"${System.getenv("LIVEKIT_URL") ?: ""}\""
        )
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore.jks")
            storePassword = "2gXnsQ2YVDNVlUr28kTRuW99"
            keyAlias = "shytalk"
            keyPassword = "2gXnsQ2YVDNVlUr28kTRuW99"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
        managedDevices {
            localDevices {
                create("pixel4a") {
                    device = "Pixel 4a"
                    apiLevel = 34
                    systemImageSource = "aosp-atd"
                }
                create("pixel8") {
                    device = "Pixel 8"
                    apiLevel = 34
                    systemImageSource = "aosp-atd"
                }
                create("pixel9ProXL") {
                    device = "Pixel 9 Pro XL"
                    apiLevel = 34
                    systemImageSource = "aosp-atd"
                }
                create("pixelTablet") {
                    device = "Pixel Tablet"
                    apiLevel = 34
                    systemImageSource = "aosp-atd"
                }
            }
        }
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    // Shared KMP module
    implementation(project(":shared"))

    // AndroidX Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.appcompat)

    // Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)

    // Navigation
    implementation(libs.androidx.navigation.compose)

    // Koin
    implementation(libs.koin.android)
    implementation(libs.koin.compose.viewmodel)

    // Firebase
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.functions)
    implementation(libs.firebase.storage)
    implementation(libs.firebase.database)
    implementation(libs.firebase.messaging)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // Credential Manager (Google Sign-In)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.google.id)

    // Coil (comes transitively from :shared, but app-specific screens still need it)
    implementation(libs.coil3.compose)
    implementation(libs.coil3.gif)

    // Image Cropper
    implementation(libs.android.image.cropper)

    // LiveKit
    implementation(libs.livekit.android)

    // Lottie
    implementation(libs.lottie.compose)

    // Google Play Billing
    implementation(libs.billing)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation("io.insert-koin:koin-test:4.1.1")
    androidTestImplementation("io.insert-koin:koin-test-junit4:4.1.1")
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation("androidx.navigation:navigation-testing:2.9.7")
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}

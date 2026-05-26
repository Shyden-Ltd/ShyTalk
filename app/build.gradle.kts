plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.google.services)
    alias(libs.plugins.play.publisher)
    jacoco
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
        version =
            release(36) {
                minorApiLevel = 1
            }
    }

    defaultConfig {
        applicationId = "com.shyden.shytalk"
        minSdk = 28
        targetSdk = 36
        versionCode = 168
        versionName = "0.97.7"

        testInstrumentationRunner = "com.shyden.shytalk.ShyTalkTestRunner"

        ndk {
            debugSymbolLevel = "SYMBOL_TABLE"
        }
    }

    flavorDimensions += "env"
    productFlavors {
        create("dev") {
            dimension = "env"
            applicationIdSuffix = ".dev"
            val buildNum =
                System.getenv("GITHUB_RUN_NUMBER")
                    ?: providers
                        .exec { commandLine("git", "rev-parse", "--short", "HEAD") }
                        .standardOutput.asText
                        .get()
                        .trim()
            versionNameSuffix = "-b$buildNum"
            buildConfigField("String", "API_BASE_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
            buildConfigField("String", "WORKER_URL", "\"https://dev-api.shytalk.shyden.co.uk\"")
            buildConfigField("String", "LIVEKIT_SERVER_URL", "\"${System.getenv("LIVEKIT_URL") ?: ""}\"")
            buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "false")
            // Anti-emulator + anti-root screen gate. ON in prod by default;
            // OFF in dev so autonomous QA + manual testers can use the
            // Android emulator (which MainActivity blocks via
            // DeviceSecurityChecker.isUnsafe()). Distinct from
            // BYPASS_DEVICE_CHECKS which gates auth-stage device-binding
            // checks. Hackability note: this is a const-folded boolean
            // baked into the APK; defence-in-depth, not load-bearing.
            // The real cross-cohort + suspension enforcement lives in
            // Firestore rules + Express middleware (server-side).
            buildConfigField("Boolean", "BYPASS_EMULATOR_GATE", "true")
            buildConfigField("String", "WEB_CLIENT_ID", "\"881846974606-kv99pjv92i6me0emb2j3uacbhnqqvfj4.apps.googleusercontent.com\"")
            buildConfigField("String", "RTDB_URL", "\"https://shytalk-dev-default-rtdb.europe-west1.firebasedatabase.app\"")
            buildConfigField("String", "EMAIL_LINK_DOMAIN", "\"dev.shytalk.shyden.co.uk\"")
            buildConfigField("String", "LOCAL_HOST", "\"\"")
            // Dev sign-in shortcut — sourced from env vars + gradle props,
            // empty by default so a CI-built APK without the env exposes no
            // credential. An operator building locally for QA exports:
            //   DEV_QA_EMAIL=…  DEV_QA_PASSWORD=…  ./gradlew assembleDevDebug
            // (or `-PDEV_QA_EMAIL=… -PDEV_QA_PASSWORD=…` on the gradle CLI).
            // SignInScreen renders the Dev Sign-In button on dev flavor when
            // these are non-empty (per BuildVariant.isDevSignInAvailable).
            // The credentials must correspond to an existing dev Firebase
            // Auth account — see scripts/seed-dev-fixtures.mjs / dev smoke
            // account documentation for provisioning.
            buildConfigField(
                "String",
                "LOCAL_DEV_EMAIL",
                "\"${(project.findProperty("DEV_QA_EMAIL") as? String) ?: System.getenv("DEV_QA_EMAIL") ?: ""}\"",
            )
            buildConfigField(
                "String",
                "LOCAL_DEV_PASSWORD",
                "\"${(project.findProperty("DEV_QA_PASSWORD") as? String) ?: System.getenv("DEV_QA_PASSWORD") ?: ""}\"",
            )
            // Shared password for the 17 test personas (P-02..P-19) baked
            // into dev/local builds for the in-screen persona picker. Same
            // sourcing semantics as LOCAL_DEV_PASSWORD above but a separate
            // value because the picker uses email-per-persona + shared
            // password whereas the single-account shortcut uses one
            // email/password pair. Operator-opt-in:
            //   DEV_QA_PERSONAS_PASSWORD=<openssl rand -base64 24> \
            //   ./gradlew assembleDevDebug
            // Empty → picker UI never renders (fail-closed). The personas'
            // emails are public (committed in DevPersonas.kt) — only the
            // password is sensitive. Must match the value used by the
            // express-api provisioner (PERSONAS_PASSWORD env var) that
            // created the personas' Firebase Auth accounts.
            buildConfigField(
                "String",
                "DEV_QA_PERSONAS_PASSWORD",
                "\"${(project.findProperty("DEV_QA_PERSONAS_PASSWORD") as? String) ?: System.getenv("DEV_QA_PERSONAS_PASSWORD") ?: ""}\"",
            )
        }
        create("prod") {
            dimension = "env"
            buildConfigField("String", "API_BASE_URL", "\"https://api.shytalk.shyden.co.uk\"")
            buildConfigField("String", "WORKER_URL", "\"https://api.shytalk.shyden.co.uk\"")
            buildConfigField("String", "LIVEKIT_SERVER_URL", "\"${System.getenv("LIVEKIT_URL") ?: ""}\"")
            buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "false")
            // Anti-emulator + anti-root screen gate is ENABLED in prod —
            // the only flavor that ships to real users. See dev flavor
            // for hackability notes (defence-in-depth, server-side gates
            // remain enforced regardless of this flag).
            buildConfigField("Boolean", "BYPASS_EMULATOR_GATE", "false")
            buildConfigField("String", "WEB_CLIENT_ID", "\"517834977595-cdu78p6q7vg57utpsvtik04c195lbh8b.apps.googleusercontent.com\"")
            buildConfigField("String", "RTDB_URL", "\"https://shytalk-7ba69-default-rtdb.asia-southeast1.firebasedatabase.app\"")
            buildConfigField("String", "EMAIL_LINK_DOMAIN", "\"shytalk.shyden.co.uk\"")
            buildConfigField("String", "LOCAL_HOST", "\"\"")
            buildConfigField("String", "LOCAL_DEV_EMAIL", "\"\"")
            buildConfigField("String", "LOCAL_DEV_PASSWORD", "\"\"")
            // Prod never bakes the persona-picker password — production
            // builds must not expose any test-account shortcut.
            buildConfigField("String", "DEV_QA_PERSONAS_PASSWORD", "\"\"")
        }
        create("local") {
            dimension = "env"
            applicationIdSuffix = ".local"
            // Host alias — defaults to 10.0.2.2 (Android emulator's loopback to host machine).
            // For physical devices: build with `-PlocalHost=localhost` and run
            //   adb reverse tcp:3000 tcp:3000   (Express API)
            //   adb reverse tcp:7880 tcp:7880   (LiveKit)
            //   adb reverse tcp:9000 tcp:9000   (Firebase RTDB emulator)
            // This tunnels the device's localhost to the laptop's localhost.
            val localHostAlias = (project.findProperty("localHost") as String?) ?: "10.0.2.2"
            buildConfigField("String", "API_BASE_URL", "\"http://$localHostAlias:3000\"")
            buildConfigField("String", "WORKER_URL", "\"http://$localHostAlias:3000\"")
            buildConfigField("String", "LIVEKIT_SERVER_URL", "\"ws://$localHostAlias:7880\"")
            buildConfigField("String", "RTDB_URL", "\"http://$localHostAlias:9000\"")
            buildConfigField("String", "LOCAL_HOST", "\"$localHostAlias\"")
            buildConfigField("String", "EMAIL_LINK_DOMAIN", "\"localhost\"")
            // Local flavour talks to Firebase emulators which don't have a
            // real Google OAuth web client. Empty string here coerces to
            // null in `BuildVariant.googleWebClientId` (per the
            // `takeIf { it.isNotEmpty() }` guard), and SignInScreen hides
            // the Google button when `BuildVariant.isGoogleSignInAvailable`
            // is false. Was `"placeholder-local"` — that produced a cryptic
            // Google framework error when tapped on local builds.
            buildConfigField("String", "WEB_CLIENT_ID", "\"\"")
            buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
            // Local flavor — emulator gate disabled (same rationale as dev:
            // tests + manual QA need to run on the Android emulator against
            // local Firebase emulators).
            buildConfigField("Boolean", "BYPASS_EMULATOR_GATE", "true")
            // Dev sign-in shortcut — only present on local-emulator builds.
            // Empty on dev / prod so reverse-engineering the production APK
            // can't extract a usable seed credential. Mirrors `local/seed.js`
            // (the source of truth for the credential).
            buildConfigField("String", "LOCAL_DEV_EMAIL", "\"claude-test@shytalk.dev\"")
            buildConfigField("String", "LOCAL_DEV_PASSWORD", "\"localdev123\"")
            // Local flavor talks to Firebase emulators which seed the 17
            // test personas via local/seed.js with a fixed dev password.
            // Hardcoded here so the persona picker works out-of-the-box
            // when an operator runs `./gradlew installLocalDebug` against
            // a freshly started emulator stack — no env var needed.
            buildConfigField("String", "DEV_QA_PERSONAS_PASSWORD", "\"localdev123\"")
        }
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("keystore.jks")
            val keystorePassword =
                project.findProperty("KEYSTORE_PASSWORD")?.toString()
                    ?: System.getenv("KEYSTORE_PASSWORD")
                    ?: ""
            storePassword = keystorePassword
            keyAlias = "shytalk"
            keyPassword = keystorePassword
        }
    }

    buildTypes {
        debug {
            buildConfigField("Boolean", "BYPASS_DEVICE_CHECKS", "true")
            // Any *-debug build (devDebug, prodDebug, localDebug) also
            // bypasses the emulator gate. Production users only ever get
            // the *-release variant via Play Store, so this is a debugger-
            // ergonomics override that never reaches end users.
            buildConfigField("Boolean", "BYPASS_EMULATOR_GATE", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
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
    sourceSets {
        getByName("androidTest") {
            assets.directories.add("src/androidTest/assets")
        }
    }

    // Workaround: KMP android library plugin doesn't auto-package Compose resources as assets
    @Suppress("DEPRECATION")
    sourceSets.getByName("main").assets.srcDir(
        File(
            project(":shared")
                .layout.buildDirectory
                .get()
                .asFile,
            "generated/compose/resourceGenerator/androidAssetsForApp",
        ),
    )
    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.all {
            // Restart test JVM every 40 classes to reset global state
            // (Dispatchers.Main) and prevent cross-class contamination
            it.forkEvery = 40
        }
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

// Enforce our-code warnings-as-errors on the Android app module — the sibling
// of shared's allWarningsAsErrors (#852). The app module is verified
// warning-clean across its main, unit-test, and androidTest Kotlin
// compilations; this gate keeps it that way: any Kotlin compiler warning in
// app/ now fails the build. Android-SDK / library deprecations that surface
// here must be fixed (or the dependency upgraded), never suppressed.
kotlin {
    compilerOptions {
        allWarningsAsErrors.set(true)
    }
}

// Workaround: Copy compose resources with the correct package-prefixed path for Android assets
val copyComposeResources =
    tasks.register<Copy>("copySharedComposeResourcesToAssets") {
        val sharedBuildDir =
            project(":shared")
                .layout.buildDirectory
                .get()
                .asFile
        from(File(sharedBuildDir, "generated/compose/resourceGenerator/preparedResources/commonMain/composeResources"))
        into(File(sharedBuildDir, "generated/compose/resourceGenerator/androidAssetsForApp/composeResources/com.shyden.shytalk.resources"))
    }

project(":shared").afterEvaluate {
    val sharedProject = this
    copyComposeResources.configure {
        dependsOn(sharedProject.tasks.named("prepareComposeResourcesTaskForCommonMain"))
        dependsOn(sharedProject.tasks.named("convertXmlValueResourcesForCommonMain"))
        dependsOn(sharedProject.tasks.named("copyNonXmlValueResourcesForCommonMain"))
    }
}

afterEvaluate {
    listOf(
        "mergeDevDebugAssets",
        "mergeDevReleaseAssets",
        "mergeProdDebugAssets",
        "mergeProdReleaseAssets",
        "mergeLocalDebugAssets",
        "mergeLocalReleaseAssets",
    ).forEach { taskName ->
        tasks.findByName(taskName)?.dependsOn(copyComposeResources)
    }
    // Lint vital tasks also read the Compose resources assets directory
    tasks
        .matching { it.name.contains("lintVital", ignoreCase = true) }
        .configureEach { dependsOn(copyComposeResources) }
}

dependencies {
    // Shared KMP module
    implementation(project(":shared"))

    // AndroidX Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.process)
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

    // Firebase (Auth + Firestore + FCM + RTDB — free Spark plan)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.database)
    implementation(libs.firebase.messaging)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    // Credential Manager (Google Sign-In)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.google.id)

    // OkHttp (explicit dep for StorageRepositoryImpl; also brought transitively by ktor-client-okhttp)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

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

    // Chrome Custom Tabs (required for Firebase OAuthProvider to use in-app browser)
    implementation("androidx.browser:browser:1.10.0")

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    // Provides real org.json.JSONObject impl (the Android SDK version is a stub in JVM unit tests)
    testImplementation("org.json:json:20260522")
    testImplementation("com.squareup.okhttp3:okhttp:4.12.0")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation("io.insert-koin:koin-test:4.2.1")
    androidTestImplementation("io.insert-koin:koin-test-junit4:4.2.1")
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation("androidx.navigation:navigation-testing:2.9.8")
    androidTestImplementation(libs.allure.kotlin.android)
    androidTestImplementation(libs.allure.kotlin.junit4)
    androidTestImplementation(libs.cucumber.android)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}

// ── Jacoco coverage for SonarCloud ──────────────────────────────
android.testOptions.unitTests.all {
    it.extensions.configure(JacocoTaskExtension::class.java) {
        isIncludeNoLocationClasses = true
        excludes = listOf("jdk.internal.*")
    }
}

tasks.register<JacocoReport>("jacocoDevDebugUnitTestReport") {
    dependsOn("testDevDebugUnitTest")
    reports {
        xml.required.set(true)
        html.required.set(true)
        xml.outputLocation.set(layout.buildDirectory.file("reports/jacoco/devDebug/jacoco.xml"))
    }
    val debugTree =
        fileTree("${layout.buildDirectory.get()}/intermediates/built_in_kotlinc/devDebug/compileDevDebugKotlin/classes") {
            exclude("**/R.class", "**/R$*.class", "**/BuildConfig.*", "**/Manifest*.*", "**/ComposableSingletons*")
        }
    val mainSrc = files("$projectDir/src/main/java")
    sourceDirectories.setFrom(mainSrc)
    classDirectories.setFrom(debugTree)
    executionData.setFrom(
        fileTree(layout.buildDirectory) {
            include("jacoco/testDevDebugUnitTest.exec")
        },
    )
}

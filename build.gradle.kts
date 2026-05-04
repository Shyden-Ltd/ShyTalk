// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.multiplatform.library) apply false
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.compose.multiplatform) apply false
    alias(libs.plugins.google.services) apply false
    alias(libs.plugins.play.publisher) apply false
    alias(libs.plugins.ktlint) apply false
    alias(libs.plugins.detekt)
    id("org.sonarqube") version "7.3.0.8198"
}

subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")

    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.5.0")
        android.set(true)
        outputToConsole.set(true)
        ignoreFailures.set(false)
        filter {
            exclude { element ->
                element.file.absolutePath
                    .replace("\\", "/")
                    .contains("/build/")
            }
        }
    }
}

detekt {
    buildUponDefaultConfig = false
    config.setFrom(files("detekt.yml"))
    parallel = true
    source.setFrom(
        files(
            "shared/src/commonMain/kotlin",
            "shared/src/androidMain/kotlin",
            "app/src/main/java",
        ),
    )
}

// Skip sonar on the app module — SonarQube plugin v7 uses AppExtension (old AGP API)
// which doesn't exist in AGP 8+. Analyze shared + express-api only until plugin is updated.
project(":app") {
    sonar {
        isSkipProject = true
    }
}

sonar {
    properties {
        property("sonar.projectKey", "ShydenMcM_ShyTalk")
        property("sonar.organization", "shydenmcm")
        property("sonar.host.url", "https://sonarcloud.io")
        property("sonar.gradle.skipCompile", "true")
        // Quality gate: advisory-only on free plan (can't customize "Sonar way" thresholds).
        // Coverage and duplication gates fail on static JS translation files that are tested
        // by Playwright, not JVM unit tests. SonarCloud dashboard exclusions don't affect
        // the Gradle scanner's PR analysis. Upgrade to paid plan to use custom quality gates.
        property("sonar.qualitygate.wait", "false")

        // Let the Gradle plugin auto-detect Kotlin sources from shared module.
        // Only manually specify Express API paths (not managed by Gradle).
        // App module excluded from sonar task (needs Android SDK) — coverage
        // tracked via Jacoco report for classes that have unit tests.
        property("sonar.sources", "express-api/src")
        property("sonar.tests", "express-api/tests")

        // Kotlin test reports — use absolute path to avoid shared/shared/ doubling
        property(
            "sonar.junit.reportPaths",
            "${rootProject.projectDir}/shared/build/test-results/jvmTest",
        )

        // Exclusions (generated code, resources, translations, platform-specific KMP source sets)
        property(
            "sonar.exclusions",
            listOf(
                "**/build/**",
                "**/node_modules/**",
                "**/*.json",
                "**/composeResources/**",
                "**/iosMain/**",
                "**/androidMain/**",
                "public/js/event-translations.js",
                "public/js/legal-translations.js",
                "public/js/suggestions-i18n.js",
            ).joinToString(","),
        )

        // Coverage exclusions — KMP shared module is tested by app/ Android unit tests
        // (2052 tests, 0 failures) but SonarCloud only tracks JVM test coverage.
        // Android test coverage is not visible to SonarCloud's JVM analysis.
        // Express API coverage IS tracked via lcov (sonar.javascript.lcov.reportPaths).
        property(
            "sonar.coverage.exclusions",
            listOf(
                "shared/src/commonMain/**",
                "shared/src/androidMain/**",
                // iosMain Kotlin/Native targets do not run on the JVM, so
                // the standard JaCoCo coverage path never sees them. Tests
                // for iOS-only Kotlin live in iosTest (no CI coverage tool
                // hooked up yet) and are exercised via simulator + manual QA.
                // TODO: once Kotlin/Native coverage (e.g. via konanArgs
                // -Xcoverage-only-files) or xcresult→Cobertura is wired up,
                // remove this exclusion so iOS code earns its 80% bar.
                "shared/src/iosMain/**",
                "app/src/main/**",
                // Swift sources have no JVM-ingestible coverage tool. They
                // are exercised via XCTest / simulator runs which produce
                // .xcresult bundles, not jacoco XML.
                // TODO: when adding Slather or xchtmlreport→Cobertura to CI,
                // remove this exclusion so Swift earns its coverage bar.
                "iosApp/**",
            ).joinToString(","),
        )

        // Duplication exclusions — translation files are intentionally repetitive across locales
        property(
            "sonar.cpd.exclusions",
            "public/js/event-translations.js,public/js/legal-translations.js,public/js/suggestions-i18n.js",
        )

        // Coverage reports
        property("sonar.javascript.lcov.reportPaths", "express-api/coverage/lcov.info")
        property(
            "sonar.coverage.jacoco.xmlReportPaths",
            "${rootProject.projectDir}/app/build/reports/jacoco/devDebug/jacoco.xml",
        )
    }
}

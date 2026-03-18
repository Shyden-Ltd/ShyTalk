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
    id("org.sonarqube") version "7.2.3.7755"
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
                element.file.absolutePath.replace("\\", "/").contains("/build/")
            }
        }
    }
}

detekt {
    buildUponDefaultConfig = false
    config.setFrom(files("detekt.yml"))
    parallel = true
    source.setFrom(files(
        "shared/src/commonMain/kotlin",
        "shared/src/androidMain/kotlin",
        "app/src/main/java",
    ))
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

        // Kotlin sources (app excluded — see skip above)
        property("sonar.sources", listOf(
            "shared/src/commonMain/kotlin",
            "shared/src/androidMain/kotlin",
            "express-api/src",
        ).joinToString(","))

        // Test sources (app excluded — see skip above)
        property("sonar.tests", listOf(
            "shared/src/commonTest/kotlin",
            "shared/src/jvmTest/kotlin",
            "express-api/tests",
        ).joinToString(","))

        // Kotlin test reports
        property("sonar.junit.reportPaths",
            "shared/build/test-results/jvmTest"
        )

        // Exclusions (generated code, resources)
        property("sonar.exclusions", listOf(
            "**/build/**",
            "**/node_modules/**",
            "**/*.json",
            "**/composeResources/**",
        ).joinToString(","))

        // Coverage reports
        property("sonar.javascript.lcov.reportPaths", "express-api/coverage/lcov.info")
    }
}

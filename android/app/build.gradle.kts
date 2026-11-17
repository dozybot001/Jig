plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

// The version has one source: package.json at the repository root (AGENTS.md, "版本与更新记录").
val yewVersion: String = Regex(""""version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"""")
    .find(rootProject.file("../package.json").readText())
    ?.groupValues?.drop(1)?.joinToString(".")
    ?: error("package.json has no version")
val yewVersionCode: Int = yewVersion.split(".").map(String::toInt).let { (major, minor, patch) ->
    major * 10000 + minor * 100 + patch
}

// The About page's build number is the short commit the package was built from (AGENTS.md).
val yewBuild: String = providers.exec { commandLine("git", "rev-parse", "--short", "HEAD") }
    .standardOutput.asText.map { it.trim() }.getOrElse("dev")

android {
    namespace = "cn.tenonai.apps.yew"
    compileSdk = 37
    buildToolsVersion = "37.0.0"

    defaultConfig {
        applicationId = "cn.tenonai.apps.yew"
        minSdk = 26
        targetSdk = 37
        versionCode = yewVersionCode
        versionName = yewVersion
        buildConfigField("String", "BUILD", "\"$yewBuild\"")
    }

    androidResources {
        // The app is written in English and Simplified Chinese; other translations in libraries are dropped.
        localeFilters += listOf("en", "zh-rCN")
        generateLocaleConfig = false
    }

    buildTypes {
        debug {
            // A debug build sits beside the released app and is signed with the debug key.
            applicationIdSuffix = ".debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // The adaptive icon stays in mipmap-anydpi-v26, where the build tools look for it.
        disable += "ObsoleteSdkInt"
    }

    testOptions {
        unitTests.all {
            // The policy text is read where it is, so the test fails when the app's copy falls behind.
            it.systemProperty("yew.root", rootProject.file("..").path)
        }
    }
}

// Every resolved version is written to app/gradle.lockfile; a build fails if one drifts from it.
dependencyLocking {
    lockAllConfigurations()
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.material3)
    implementation(libs.compose.ui)
    implementation(libs.activity.compose)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.coroutines.android)
    implementation(libs.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.bouncycastle)
    implementation(libs.zxing.core)

    constraints {
        implementation(libs.guava) { because("the version CameraX asks for has GHSA-xxph-c9ww-hj94") }
    }

    testImplementation(libs.junit)
}

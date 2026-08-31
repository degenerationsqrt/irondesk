plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "app.irondesk.mobile.preview"
    compileSdk = 36

    defaultConfig {
        // This package is intentionally disposable. Do not register it in Play.
        applicationId = "app.irondesk.mobile.preview"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-internal"

        buildConfigField("boolean", "INTERNAL_PREVIEW", "true")
        buildConfigField("String", "BACKEND_SYSTEM", "\"Supabase\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isReturnDefaultValues = true }
}

// A Play-uploadable variant must not exist until the permanent package, signing,
// secure auth, Supabase sync, native integration, and physical-device gates pass.
androidComponents {
    beforeVariants(selector().withBuildType("release")) { variant ->
        variant.enable = false
    }
}

dependencies {
    implementation(libs.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.coroutines.android)

    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}

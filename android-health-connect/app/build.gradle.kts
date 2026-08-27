plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "app.irondesk.health"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.irondesk.health"
        minSdk = 28
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"

        // The IronDesk deployment this app pairs with. Override with
        // -PirondeskBaseUrl=... for a self-hosted or preview deployment.
        val baseUrl = (project.findProperty("irondeskBaseUrl") as String?)
            ?: "https://irondeskpro.lovable.app"
        buildConfigField("String", "IRONDESK_BASE_URL", "\"$baseUrl\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // No signingConfig here on purpose: sign with your own upload key
            // (Android Studio → Build → Generate Signed Bundle/APK) or Play App Signing.
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    implementation(libs.health.connect)
    implementation(libs.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
}

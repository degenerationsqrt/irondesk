// Root build script. Plugins are declared here without applying them so the
// :app module can apply the same resolved versions.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}

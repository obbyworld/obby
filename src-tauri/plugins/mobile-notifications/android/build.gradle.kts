plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "world.obby.notifications"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("proguard-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    implementation("org.unifiedpush.android:connector:3.3.5")
    implementation("org.unifiedpush.android:embedded-fcm-distributor:3.1.0")
    // The app compiles with Kotlin 2.1, which reads metadata up to 2.2.
    implementation("org.jetbrains.kotlin:kotlin-stdlib") { version { strictly("2.2.10") } }
    implementation(project(":tauri-android"))
}

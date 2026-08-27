# OkHttp ships its own rules; these silence the optional platform hooks R8 warns about.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

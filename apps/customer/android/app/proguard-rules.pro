# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- R8 baseline keeps (added with minification; see gradle.properties) ---------------
# Rely on libraries' bundled consumer rules first (React Native / react-android, Hermes,
# Expo modules, @sentry/react-native and Firebase Messaging via expo-notifications all ship
# their own). The rules below only cover native-side classes that are looked up from C++/JNI
# by name, which R8 cannot see being used and would otherwise rename or strip.

# Hermes / fbjni: classes resolved by name from native code via JNI.
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# react-native-worklets (required by reanimated 4): its HybridData/JNI classes are
# instantiated from native code. The com.swmansion.reanimated.** keep above covers reanimated.
-keep class com.swmansion.worklets.** { *; }

# Add any project specific keep options here:

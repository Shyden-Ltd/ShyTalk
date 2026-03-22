# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve line number information for readable stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Firestore model classes (deserialized via reflection)
-keep class com.shyden.shytalk.core.model.** { *; }

# Remote data classes that may be serialized/deserialized
-keep class com.shyden.shytalk.data.remote.** { *; }

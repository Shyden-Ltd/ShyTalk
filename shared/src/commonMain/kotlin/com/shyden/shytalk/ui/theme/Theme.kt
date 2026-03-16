package com.shyden.shytalk.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

val DarkColorScheme =
    darkColorScheme(
        primary = ShyTalkPrimaryDark,
        onPrimary = ShyTalkOnPrimaryDark,
        primaryContainer = ShyTalkPrimaryContainerDark,
        secondary = ShyTalkSecondaryDark,
        tertiary = ShyTalkTertiaryDark,
    )

val LightColorScheme =
    lightColorScheme(
        primary = ShyTalkPrimary,
        onPrimary = ShyTalkOnPrimary,
        primaryContainer = ShyTalkPrimaryContainer,
        secondary = ShyTalkSecondary,
        tertiary = ShyTalkTertiary,
        error = ShyTalkError,
    )

@Composable
expect fun ShyTalkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
)

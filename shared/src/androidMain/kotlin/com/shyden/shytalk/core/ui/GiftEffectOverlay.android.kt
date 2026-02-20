package com.shyden.shytalk.core.ui

import android.media.MediaPlayer
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.airbnb.lottie.compose.LottieAnimation
import com.airbnb.lottie.compose.LottieCompositionSpec
import com.airbnb.lottie.compose.animateLottieCompositionAsState
import com.airbnb.lottie.compose.rememberLottieComposition
import kotlinx.coroutines.delay

@Composable
actual fun GiftEffectOverlay(
    animationUrl: String,
    soundUrl: String,
    isVisible: Boolean,
    onFinished: () -> Unit,
    modifier: Modifier
) {
    AnimatedVisibility(
        visible = isVisible,
        enter = fadeIn(),
        exit = fadeOut(),
        modifier = modifier
    ) {
        val context = LocalContext.current
        val composition by rememberLottieComposition(LottieCompositionSpec.Url(animationUrl))
        val progress by animateLottieCompositionAsState(
            composition = composition,
            iterations = 1,
            isPlaying = isVisible
        )

        // Play sound effect
        if (isVisible && soundUrl.isNotBlank()) {
            val mediaPlayer = remember(soundUrl) {
                try {
                    MediaPlayer().apply {
                        setDataSource(soundUrl)
                        prepareAsync()
                        setOnPreparedListener { start() }
                    }
                } catch (_: Exception) { null }
            }

            DisposableEffect(soundUrl) {
                onDispose {
                    try {
                        mediaPlayer?.release()
                    } catch (_: Exception) {}
                }
            }
        }

        // Auto-dismiss after animation completes
        LaunchedEffect(progress) {
            if (progress >= 1f) {
                delay(300)
                onFinished()
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.3f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() }
                ) { onFinished() },
            contentAlignment = Alignment.Center
        ) {
            LottieAnimation(
                composition = composition,
                progress = { progress }
            )
        }
    }
}

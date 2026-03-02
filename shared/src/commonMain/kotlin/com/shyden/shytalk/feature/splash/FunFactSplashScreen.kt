package com.shyden.shytalk.feature.splash

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.FunFact

@Composable
fun FunFactSplashScreen(
    warmUpComplete: Boolean,
    funFacts: List<FunFact>,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier
) {
    val subtitle = remember(funFacts) {
        funFacts.randomOrNull()?.let { fact ->
            if (fact.emoji.isNotBlank()) "${fact.emoji} ${fact.text}" else fact.text
        } ?: "Voice chat rooms, reimagined."
    }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(32.dp))

            AnimatedVisibility(
                visible = warmUpComplete,
                enter = fadeIn()
            ) {
                Button(
                    onClick = onContinue,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Continue")
                }
            }
        }
    }
}

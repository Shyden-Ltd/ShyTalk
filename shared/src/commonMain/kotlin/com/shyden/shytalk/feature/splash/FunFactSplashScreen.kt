package com.shyden.shytalk.feature.splash

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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

@Composable
fun FunFactSplashScreen(
    warmUpComplete: Boolean,
    funFacts: List<FunFact>,
    onContinue: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val fallbackTagline = stringResource(Res.string.splash_tagline)
    val subtitle =
        remember(funFacts, fallbackTagline) {
            funFacts.randomOrNull()?.let { fact ->
                if (fact.emoji.isNotBlank()) "${fact.emoji} ${fact.text}" else fact.text
            } ?: fallbackTagline
        }

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.testTag("splash_title"),
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag("splash_subtitle"),
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onContinue,
                enabled = warmUpComplete,
                modifier = Modifier.fillMaxWidth().testTag("splash_continueButton"),
            ) {
                Text(if (warmUpComplete) stringResource(Res.string.continue_button) else stringResource(Res.string.getting_ready))
            }
        }
    }
}

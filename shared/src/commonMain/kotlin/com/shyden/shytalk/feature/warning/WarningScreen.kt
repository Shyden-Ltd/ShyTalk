package com.shyden.shytalk.feature.warning

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.audio.EmergencyTonePlayer
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.i_understand_and_accept
import com.shyden.shytalk.resources.official_warning
import com.shyden.shytalk.resources.police_duck
import com.shyden.shytalk.resources.police_duck_description
import com.shyden.shytalk.resources.support_contact
import com.shyden.shytalk.resources.view_community_standards
import com.shyden.shytalk.resources.warning_consequence
import com.shyden.shytalk.resources.warning_reviewed
import com.shyden.shytalk.resources.warning_reviewed_for_reason
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource

@Composable
fun WarningScreen(
    reason: String?,
    onAccept: () -> Unit,
    onViewCommunityStandards: () -> Unit,
) {
    DisposableEffect(Unit) {
        EmergencyTonePlayer.play()
        onDispose { EmergencyTonePlayer.stop() }
    }

    Surface(modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = maxHeight)
                        .padding(32.dp)
                        .verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Image(
                    painter = painterResource(Res.drawable.police_duck),
                    contentDescription = stringResource(Res.string.police_duck_description),
                    modifier =
                        Modifier
                            .size(160.dp)
                            .clip(CircleShape),
                )

                Spacer(modifier = Modifier.height(24.dp))

                Text(
                    text = stringResource(Res.string.official_warning),
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.testTag("warning_title"),
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text =
                        if (!reason.isNullOrBlank() && !reason.equals("other", ignoreCase = true)) {
                            stringResource(Res.string.warning_reviewed_for_reason, reason)
                        } else {
                            stringResource(Res.string.warning_reviewed)
                        },
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = stringResource(Res.string.warning_consequence),
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(modifier = Modifier.height(24.dp))

                TextButton(
                    onClick = onViewCommunityStandards,
                    modifier = Modifier.testTag("warning_communityStandardsLink"),
                ) {
                    Text(stringResource(Res.string.view_community_standards))
                }

                Spacer(modifier = Modifier.height(16.dp))

                Button(
                    onClick = onAccept,
                    // Tag aligned with manual-qa corpus (j10:29, j11:67):
                    // warning_acknowledgeButton, not warning_acceptButton.
                    modifier = Modifier.fillMaxWidth().testTag("warning_acknowledgeButton"),
                ) {
                    Text(stringResource(Res.string.i_understand_and_accept))
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = stringResource(Res.string.support_contact),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

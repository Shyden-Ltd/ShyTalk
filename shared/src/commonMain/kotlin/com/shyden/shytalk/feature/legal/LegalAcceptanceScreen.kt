package com.shyden.shytalk.feature.legal

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

const val CURRENT_LEGAL_VERSION = 6

@Composable
fun LegalAcceptanceScreen(
    onAccept: () -> Unit,
    onViewPrivacyPolicy: () -> Unit,
    onViewCommunityStandards: () -> Unit,
    onViewTerms: () -> Unit,
    onViewCyberBullyingPolicy: () -> Unit,
) {
    var privacyChecked by remember { mutableStateOf(false) }
    var communityChecked by remember { mutableStateOf(false) }
    var termsChecked by remember { mutableStateOf(false) }
    var cyberBullyingChecked by remember { mutableStateOf(false) }

    val allChecked = privacyChecked && communityChecked && termsChecked && cyberBullyingChecked

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(24.dp)
                    .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            Text(
                text = stringResource(Res.string.welcome_to_shytalk),
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(Res.string.review_and_accept_policies),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Privacy Policy. testTag is the scenario-facing name
            // ("legal_acceptPrivacyCheckbox") rather than the
            // implementation-derived legal_checkbox_PrivacyPolicy so the
            // manual-qa runner can find it without name-translation.
            LegalCheckRow(
                title = stringResource(Res.string.privacy_policy),
                checked = privacyChecked,
                onCheckedChange = { privacyChecked = it },
                onViewDocument = onViewPrivacyPolicy,
                checkboxTestTag = "legal_acceptPrivacyCheckbox",
            )

            Spacer(modifier = Modifier.height(16.dp))

            LegalCheckRow(
                title = stringResource(Res.string.community_standards),
                checked = communityChecked,
                onCheckedChange = { communityChecked = it },
                onViewDocument = onViewCommunityStandards,
                checkboxTestTag = "legal_acceptCommunityCheckbox",
            )

            Spacer(modifier = Modifier.height(16.dp))

            LegalCheckRow(
                title = stringResource(Res.string.terms_and_conditions),
                checked = termsChecked,
                onCheckedChange = { termsChecked = it },
                onViewDocument = onViewTerms,
                checkboxTestTag = "legal_acceptTermsCheckbox",
            )

            Spacer(modifier = Modifier.height(16.dp))

            LegalCheckRow(
                title = stringResource(Res.string.cyber_bullying_policy),
                checked = cyberBullyingChecked,
                onCheckedChange = { cyberBullyingChecked = it },
                onViewDocument = onViewCyberBullyingPolicy,
                checkboxTestTag = "legal_acceptCyberBullyingCheckbox",
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = onAccept,
                enabled = allChecked,
                // Renamed from "legal_acceptButton" to match scenario corpus.
                // Same node, scenario-aligned tag.
                modifier = Modifier.fillMaxWidth().testTag("legal_continueButton"),
            ) {
                Text(stringResource(Res.string.accept_all_and_continue))
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun LegalCheckRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    onViewDocument: () -> Unit,
    checkboxTestTag: String? = null,
) {
    // Caller-provided testTag wins (j01 scenarios use specific names);
    // fall back to the original derived form for compat with any test
    // that still references the legal_checkbox_X shape.
    val derivedTag = title.replace("\\s+".toRegex(), "").replace("&", "And")
    val resolvedTag = checkboxTestTag ?: "legal_checkbox_$derivedTag"
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(resolvedTag),
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = stringResource(Res.string.i_have_read_and_agree),
            style = MaterialTheme.typography.bodyMedium,
        )
        TextButton(onClick = onViewDocument) {
            Text(title)
        }
    }
}

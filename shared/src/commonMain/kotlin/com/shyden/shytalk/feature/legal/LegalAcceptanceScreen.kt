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

const val CURRENT_LEGAL_VERSION = 5

@Composable
fun LegalAcceptanceScreen(
    onAccept: () -> Unit,
    onViewPrivacyPolicy: () -> Unit,
    onViewCommunityStandards: () -> Unit,
    onViewTerms: () -> Unit,
    onViewCyberBullyingPolicy: () -> Unit
) {
    var privacyChecked by remember { mutableStateOf(false) }
    var communityChecked by remember { mutableStateOf(false) }
    var termsChecked by remember { mutableStateOf(false) }
    var cyberBullyingChecked by remember { mutableStateOf(false) }

    val allChecked = privacyChecked && communityChecked && termsChecked && cyberBullyingChecked

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp)
                .verticalScroll(rememberScrollState())
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            Text(
                text = "Welcome to ShyTalk",
                style = MaterialTheme.typography.headlineMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Please review and accept our policies to continue.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Privacy Policy
            LegalCheckRow(
                title = "Privacy Policy",
                checked = privacyChecked,
                onCheckedChange = { privacyChecked = it },
                onViewDocument = onViewPrivacyPolicy
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Community Standards
            LegalCheckRow(
                title = "Community Standards",
                checked = communityChecked,
                onCheckedChange = { communityChecked = it },
                onViewDocument = onViewCommunityStandards
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Terms & Conditions
            LegalCheckRow(
                title = "Terms & Conditions",
                checked = termsChecked,
                onCheckedChange = { termsChecked = it },
                onViewDocument = onViewTerms
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Cyber Bullying Policy
            LegalCheckRow(
                title = "Cyber Bullying Policy",
                checked = cyberBullyingChecked,
                onCheckedChange = { cyberBullyingChecked = it },
                onViewDocument = onViewCyberBullyingPolicy
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = onAccept,
                enabled = allChecked,
                modifier = Modifier.fillMaxWidth().testTag("legal_acceptButton")
            ) {
                Text("Accept All & Continue")
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
    onViewDocument: () -> Unit
) {
    val tag = title.replace("\\s+".toRegex(), "").replace("&", "And")
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag("legal_checkbox_$tag")
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = "I have read and agree to the ",
            style = MaterialTheme.typography.bodyMedium
        )
        TextButton(onClick = onViewDocument) {
            Text(title)
        }
    }
}

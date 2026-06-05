package com.shyden.shytalk.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.notifications_disabled_banner_action
import com.shyden.shytalk.resources.notifications_disabled_banner_title
import org.jetbrains.compose.resources.stringResource

/**
 * Surfaces when the OS push permission is DENIED — closes
 * AppDelegate.swift:38's TODO(v2). Tapping the action defers to the
 * [PushPermissionStore]'s registered bridge, which opens the platform's
 * per-app notification settings page (no-op on platforms that haven't
 * registered a bridge yet).
 *
 * Non-dismissible: the denied state is persistent until the user changes
 * it in Settings, so a transient dismiss would create a misleading
 * "all good" UI for users who can't actually receive notifications.
 */
@Composable
fun PushPermissionDeniedBanner(
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(Res.string.notifications_disabled_banner_title)
    val action = stringResource(Res.string.notifications_disabled_banner_action)
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        modifier =
            modifier
                .fillMaxWidth()
                .testTag("pushDeniedBanner")
                .clickable(onClick = onOpenSettings)
                .semantics(mergeDescendants = true) {
                    role = Role.Button
                    contentDescription = "$title. $action"
                },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = Icons.Default.NotificationsOff,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(Modifier.width(10.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = action,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
                fontWeight = FontWeight.Bold,
                textDecoration = TextDecoration.Underline,
            )
        }
    }
}

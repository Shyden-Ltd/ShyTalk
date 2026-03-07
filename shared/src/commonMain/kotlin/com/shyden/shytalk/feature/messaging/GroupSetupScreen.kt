package com.shyden.shytalk.feature.messaging

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.GroupRole
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSetupScreen(
    selectedIds: String,
    onNavigateBack: () -> Unit,
    onGroupCreated: (String) -> Unit,
    onPickGroupPhoto: (() -> Unit)? = null,
    viewModel: GroupSetupViewModel = koinViewModel(key = selectedIds) { parametersOf(selectedIds) }
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showPermissions by remember { mutableStateOf(false) }
    var showSystemMessages by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.createdConversationId) {
        uiState.createdConversationId?.let { onGroupCreated(it) }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                title = { Text(stringResource(Res.string.new_group)) }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState())
        ) {
            // Group photo placeholder (clickable)
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .align(Alignment.CenterHorizontally)
                    .clip(CircleShape)
                    .clickable(enabled = onPickGroupPhoto != null) {
                        onPickGroupPhoto?.invoke()
                    }
            ) {
                if (uiState.groupPhotoBytes != null) {
                    AsyncImage(
                        model = uiState.groupPhotoBytes,
                        contentDescription = stringResource(Res.string.group),
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Icon(
                            Icons.Default.Group,
                            contentDescription = stringResource(Res.string.group),
                            modifier = Modifier.padding(20.dp),
                            tint = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
                // Camera overlay
                if (onPickGroupPhoto != null) {
                    Surface(
                        modifier = Modifier
                            .size(28.dp)
                            .align(Alignment.BottomEnd),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primary
                    ) {
                        Icon(
                            Icons.Default.CameraAlt,
                            contentDescription = null,
                            modifier = Modifier.padding(5.dp),
                            tint = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Group name
            OutlinedTextField(
                value = uiState.groupName,
                onValueChange = { viewModel.setGroupName(it) },
                label = { Text(stringResource(Res.string.group_name_required)) },
                modifier = Modifier.fillMaxWidth().testTag("groupSetup_nameField"),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Group description
            OutlinedTextField(
                value = uiState.groupDescription,
                onValueChange = { viewModel.setGroupDescription(it) },
                label = { Text(stringResource(Res.string.description_optional)) },
                modifier = Modifier.fillMaxWidth(),
                maxLines = 4,
                supportingText = {
                    Text("${uiState.groupDescription.length}/${Constants.MAX_GROUP_DESCRIPTION_LENGTH}")
                }
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(8.dp))

            // Participants with role assignment
            Text(
                text = stringResource(Res.string.participants),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))

            // Creator (owner)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        modifier = Modifier.padding(8.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                Text(
                    text = stringResource(Res.string.you),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f)
                )
                RoleBadge(role = GroupRole.OWNER)
            }

            // Selected users with role chips
            uiState.selectedUsers.forEach { user ->
                val role = uiState.roles[user.uid] ?: GroupRole.MEMBER
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val photoUrl = user.photoUrl
                    if (photoUrl != null) {
                        AsyncImage(
                            model = photoUrl,
                            contentDescription = user.displayName,
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Surface(
                            modifier = Modifier.size(40.dp),
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer
                        ) {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.padding(8.dp),
                                tint = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = user.displayName,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    RoleBadge(
                        role = role,
                        onClick = { viewModel.cycleRole(user.uid) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()

            // Permissions section (collapsible)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showPermissions = !showPermissions }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(Res.string.permissions),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (showPermissions) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            AnimatedVisibility(visible = showPermissions) {
                Column {
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_send),
                        currentLevel = uiState.permissions.whoCanSend,
                        onLevelChanged = { viewModel.updatePermission("whoCanSend", it) }
                    )
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_add_members),
                        currentLevel = uiState.permissions.whoCanAddMembers,
                        onLevelChanged = { viewModel.updatePermission("whoCanAddMembers", it) }
                    )
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_edit_info),
                        currentLevel = uiState.permissions.whoCanEditInfo,
                        onLevelChanged = { viewModel.updatePermission("whoCanEditInfo", it) }
                    )
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_delete_messages),
                        currentLevel = uiState.permissions.whoCanDeleteMessages,
                        onLevelChanged = { viewModel.updatePermission("whoCanDeleteMessages", it) }
                    )
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_mute_members),
                        currentLevel = uiState.permissions.whoCanMuteMembers,
                        onLevelChanged = { viewModel.updatePermission("whoCanMuteMembers", it) }
                    )
                    PermissionLevelSelector(
                        label = stringResource(Res.string.perm_who_can_remove_members),
                        currentLevel = uiState.permissions.whoCanRemoveMembers,
                        onLevelChanged = { viewModel.updatePermission("whoCanRemoveMembers", it) }
                    )
                }
            }

            HorizontalDivider()

            // System messages section (collapsible)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { showSystemMessages = !showSystemMessages }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = stringResource(Res.string.system_messages),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (showSystemMessages) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            AnimatedVisibility(visible = showSystemMessages) {
                Column {
                    SystemMessageToggle(stringResource(Res.string.sys_member_joins), uiState.systemMessageConfig.showJoins) {
                        viewModel.toggleSystemMessage("showJoins")
                    }
                    SystemMessageToggle(stringResource(Res.string.sys_member_leaves), uiState.systemMessageConfig.showLeaves) {
                        viewModel.toggleSystemMessage("showLeaves")
                    }
                    SystemMessageToggle(stringResource(Res.string.sys_role_changes), uiState.systemMessageConfig.showRoleChanges) {
                        viewModel.toggleSystemMessage("showRoleChanges")
                    }
                    SystemMessageToggle(stringResource(Res.string.sys_permission_changes), uiState.systemMessageConfig.showPermissionChanges) {
                        viewModel.toggleSystemMessage("showPermissionChanges")
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Create button
            Button(
                onClick = { viewModel.createGroup() },
                modifier = Modifier.fillMaxWidth().testTag("groupSetup_createButton"),
                enabled = uiState.groupName.isNotBlank() && !uiState.isCreating
            ) {
                if (uiState.isCreating) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                } else {
                    Icon(Icons.Default.Check, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(Res.string.create_group))
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
fun RoleBadge(
    role: GroupRole,
    onClick: (() -> Unit)? = null
) {
    val (color, icon, label) = when (role) {
        GroupRole.OWNER -> Triple(Color(0xFFFFD700), Icons.Default.Star, stringResource(Res.string.role_owner))
        GroupRole.ADMIN -> Triple(Color(0xFFFFC107), Icons.Default.Shield, stringResource(Res.string.role_admin))
        GroupRole.MOD -> Triple(Color(0xFF009688), Icons.Default.Star, stringResource(Res.string.role_mod))
        GroupRole.MEMBER -> Triple(MaterialTheme.colorScheme.outline, null, stringResource(Res.string.role_member))
    }

    AssistChip(
        onClick = onClick ?: {},
        label = { Text(label, style = MaterialTheme.typography.labelSmall) },
        leadingIcon = icon?.let {
            {
                Icon(
                    it,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp),
                    tint = color
                )
            }
        },
        colors = AssistChipDefaults.assistChipColors(
            labelColor = color
        ),
        enabled = onClick != null
    )
}

@Composable
fun PermissionLevelSelector(
    label: String,
    currentLevel: GroupPermissions.PermissionLevel,
    onLevelChanged: (GroupPermissions.PermissionLevel) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { expanded = true }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = currentLevel.displayName,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary
            )
        }

        Box {
            Text(
                text = stringResource(Res.string.change),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary
            )
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                GroupPermissions.PermissionLevel.entries.forEach { level ->
                    DropdownMenuItem(
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(
                                    selected = level == currentLevel,
                                    onClick = null
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(level.displayName)
                            }
                        },
                        onClick = {
                            onLevelChanged(level)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun SystemMessageToggle(
    label: String,
    isEnabled: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f)
        )
        Switch(
            checked = isEnabled,
            onCheckedChange = { onToggle() }
        )
    }
}

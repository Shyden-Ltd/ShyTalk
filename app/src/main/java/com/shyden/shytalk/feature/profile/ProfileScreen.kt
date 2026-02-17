package com.shyden.shytalk.feature.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import com.shyden.shytalk.core.crop.CropContract
import com.shyden.shytalk.core.crop.CropInput
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.util.calculateAge
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.ui.components.FlagBadge
import com.shyden.shytalk.ui.theme.CnyGold
import com.shyden.shytalk.ui.theme.SpeakingGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    userId: String? = null,
    showBackButton: Boolean = true,
    onNavigateBack: () -> Unit = {},
    onNavigateToUserProfile: ((String) -> Unit)? = null,
    onNavigateToFollowList: ((String, String) -> Unit)? = null,
    onNavigateToSettings: (() -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
    viewModel: ProfileViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    // Edit mode state
    var editDisplayName by remember(uiState.user, uiState.isEditing) {
        mutableStateOf(uiState.user?.displayName ?: "")
    }
    var editDescription by remember(uiState.user, uiState.isEditing) {
        mutableStateOf(uiState.user?.description ?: "")
    }
    var editNationality by remember(uiState.user, uiState.isEditing) {
        mutableStateOf(uiState.user?.nationality)
    }
    var showCountryPicker by remember { mutableStateOf(false) }
    var showBlockDialog by remember { mutableStateOf(false) }
    var fullscreenPhotoUrl by rememberSaveable { mutableStateOf<String?>(null) }

    // Photo picking + cropping
    var pendingCropType by remember { mutableStateOf<String?>(null) }

    val imageContext = LocalContext.current
    val cropLauncher = rememberLauncherForActivityResult(CropContract()) { uri ->
        if (uri != null) {
            val imageData = try {
                imageContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (_: Exception) {
                null
            }
            if (imageData != null) {
                when (pendingCropType) {
                    "profile" -> viewModel.uploadProfilePhoto(imageData)
                    "cover" -> viewModel.uploadCoverPhoto(imageData)
                }
            }
        }
    }

    val pickerLauncher = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri != null) {
            val input = when (pendingCropType) {
                "profile" -> CropInput(uri, 1, 1, "oval", 80, "Crop Profile Photo")
                else -> CropInput(uri, 16, 9, "rectangle", 80, "Crop Cover Photo")
            }
            cropLauncher.launch(input)
        }
    }

    fun launchPhotoPicker(type: String) {
        pendingCropType = type
        pickerLauncher.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly))
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Load profile for the current or specified user
    LaunchedEffect(userId) {
        viewModel.loadProfile(userId)
    }

    val user = uiState.user
    val isOwn = uiState.isOwnProfile

    // If this is embedded in a tab (no scaffold needed), just render the content
    if (!showBackButton) {
        Box(modifier = modifier) {
            ProfileContent(
                uiState = uiState,
                isOwn = isOwn,
                editDisplayName = editDisplayName,
                onEditDisplayNameChange = { editDisplayName = it },
                editDescription = editDescription,
                onEditDescriptionChange = { editDescription = it },
                editNationality = editNationality,
                onShowCountryPicker = { showCountryPicker = true },
                onToggleEditing = { viewModel.toggleEditing() },
                onSaveEdits = {
                    viewModel.saveProfileEdits(editDisplayName, editDescription, editNationality)
                },
                onPickProfilePhoto = { launchPhotoPicker("profile") },
                onPickCoverPhoto = { launchPhotoPicker("cover") },
                onTapPhoto = { fullscreenPhotoUrl = it },
                onBlockToggle = { showBlockDialog = true },
                onFollowToggle = {
                    val targetId = uiState.user?.uid ?: return@ProfileContent
                    if (uiState.isFollowingTarget) viewModel.unfollowUser(targetId)
                    else viewModel.followUser(targetId)
                },
                onNavigateToFollowList = onNavigateToFollowList,
                onNavigateToRoom = onNavigateToRoom,
                snackbarHostState = snackbarHostState,
                modifier = Modifier.fillMaxSize()
            )
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier.align(Alignment.BottomCenter)
            )
        }
    } else {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbarHostState) },
            topBar = {
                TopAppBar(
                    title = { Text("Profile") },
                    navigationIcon = {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                )
            }
        ) { padding ->
            ProfileContent(
                uiState = uiState,
                isOwn = isOwn,
                editDisplayName = editDisplayName,
                onEditDisplayNameChange = { editDisplayName = it },
                editDescription = editDescription,
                onEditDescriptionChange = { editDescription = it },
                editNationality = editNationality,
                onShowCountryPicker = { showCountryPicker = true },
                onToggleEditing = { viewModel.toggleEditing() },
                onSaveEdits = {
                    viewModel.saveProfileEdits(editDisplayName, editDescription, editNationality)
                },
                onPickProfilePhoto = { launchPhotoPicker("profile") },
                onPickCoverPhoto = { launchPhotoPicker("cover") },
                onTapPhoto = { fullscreenPhotoUrl = it },
                onBlockToggle = { showBlockDialog = true },
                onFollowToggle = {
                    val targetId = uiState.user?.uid ?: return@ProfileContent
                    if (uiState.isFollowingTarget) viewModel.unfollowUser(targetId)
                    else viewModel.followUser(targetId)
                },
                onNavigateToFollowList = onNavigateToFollowList,
                onNavigateToRoom = onNavigateToRoom,
                snackbarHostState = snackbarHostState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )
        }
    }

    // Country picker dialog
    if (showCountryPicker) {
        CountryPickerDialog(
            selectedCode = editNationality,
            onSelect = { code ->
                editNationality = code
                showCountryPicker = false
            },
            onDismiss = { showCountryPicker = false }
        )
    }

    // Block/Unblock confirmation dialog
    if (showBlockDialog && user != null) {
        val isBlocked = uiState.isBlockedByViewer
        AlertDialog(
            onDismissRequest = { showBlockDialog = false },
            title = { Text(if (isBlocked) "Unblock ${user.displayName}?" else "Block ${user.displayName}?") },
            text = {
                Text(
                    if (isBlocked) "They will be able to view your profile again."
                    else "They won't be able to view your profile."
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    showBlockDialog = false
                    if (isBlocked) {
                        viewModel.unblockUser(user.uid)
                    } else {
                        viewModel.blockUser(user.uid)
                    }
                }) {
                    Text(if (isBlocked) "Unblock" else "Block")
                }
            },
            dismissButton = {
                TextButton(onClick = { showBlockDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Fullscreen photo viewer
    AnimatedVisibility(
        visible = fullscreenPhotoUrl != null,
        enter = fadeIn(),
        exit = fadeOut()
    ) {
        fullscreenPhotoUrl?.let { url ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.9f))
                    .clickable { fullscreenPhotoUrl = null },
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = url,
                    contentDescription = "Full screen photo",
                    modifier = Modifier.fillMaxWidth(),
                    contentScale = ContentScale.Fit
                )
                IconButton(
                    onClick = { fullscreenPhotoUrl = null },
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(16.dp)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Close",
                        tint = Color.White
                    )
                }
            }
        }
    }
}

@Composable
private fun ProfileContent(
    uiState: ProfileUiState,
    isOwn: Boolean,
    editDisplayName: String,
    onEditDisplayNameChange: (String) -> Unit,
    editDescription: String,
    onEditDescriptionChange: (String) -> Unit,
    editNationality: String?,
    onShowCountryPicker: () -> Unit,
    onToggleEditing: () -> Unit,
    onSaveEdits: () -> Unit,
    onPickProfilePhoto: () -> Unit,
    onPickCoverPhoto: () -> Unit,
    onTapPhoto: (String) -> Unit,
    onBlockToggle: () -> Unit,
    onFollowToggle: () -> Unit = {},
    onNavigateToFollowList: ((String, String) -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier
) {
    val user = uiState.user

    if (uiState.isLoading) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    // Blocked by target - show blocked message with name and ID
    if (uiState.isBlockedByTarget) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.Block,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(16.dp))
                if (user != null) {
                    Text(
                        text = user.displayName,
                        style = MaterialTheme.typography.titleLarge,
                        textAlign = TextAlign.Center
                    )
                    if (user.uniqueId != 0L) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "ID: ${user.uniqueId}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                }
                Text(
                    text = "This profile is not available",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "You have been blocked by this user",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            }
        }
        return
    }

    if (user == null) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Profile not found", style = MaterialTheme.typography.bodyLarge)
        }
        return
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        // Cover photo area
        val coverUrl = user.coverPhotoUrl
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .then(
                    if (coverUrl != null && !uiState.isEditing)
                        Modifier.clickable { onTapPhoto(coverUrl) }
                    else Modifier
                )
        ) {
            if (coverUrl != null) {
                AsyncImage(
                    model = coverUrl,
                    contentDescription = "Cover photo",
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.horizontalGradient(
                                colors = listOf(
                                    MaterialTheme.colorScheme.primary,
                                    MaterialTheme.colorScheme.tertiary
                                )
                            )
                        )
                )
            }

            // Camera overlay for editing cover
            if (isOwn && uiState.isEditing) {
                IconButton(
                    onClick = onPickCoverPhoto,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(8.dp)
                ) {
                    Surface(
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f)
                    ) {
                        Icon(
                            Icons.Default.CameraAlt,
                            contentDescription = "Change cover photo",
                            modifier = Modifier.padding(8.dp)
                        )
                    }
                }
            }
        }

        // Profile photo + follow stats (overlapping cover)
        val activeRoomId = uiState.activeRoomId
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-50).dp)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            // Follow stats — positioned slightly below center to sit under the cover edge
            if (!uiState.isEditing) {
                val followingHidden = !isOwn && uiState.hideFollowing
                Row(
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .padding(top = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    Column(
                        modifier = Modifier.clickable(enabled = !followingHidden) {
                            onNavigateToFollowList?.invoke(user.uid, "following")
                        },
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = if (followingHidden) "-" else "${uiState.followingCount}",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = if (followingHidden) "Following (Private)" else "Following",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Column(
                        modifier = Modifier.clickable {
                            onNavigateToFollowList?.invoke(user.uid, "followers")
                        },
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "${uiState.followerCount}",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Followers",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .then(
                        if (activeRoomId != null && onNavigateToRoom != null)
                            Modifier.clickable { onNavigateToRoom(activeRoomId) }
                        else Modifier
                    )
            ) {
                val photoUrl = user.photoUrl
                if (photoUrl != null) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = "Profile photo",
                        modifier = Modifier
                            .size(100.dp)
                            .clip(CircleShape)
                            .then(
                                if (!uiState.isEditing && activeRoomId == null)
                                    Modifier.clickable { onTapPhoto(photoUrl) }
                                else Modifier
                            ),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Surface(
                        modifier = Modifier.size(100.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = "Profile photo",
                            modifier = Modifier.padding(24.dp),
                            tint = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }

                // Voice room indicator overlay
                if (activeRoomId != null) {
                    VoiceWaveOverlay(
                        modifier = Modifier.size(100.dp).clip(CircleShape)
                    )
                }

                // Camera overlay for editing profile photo
                if (isOwn && uiState.isEditing) {
                    IconButton(
                        onClick = onPickProfilePhoto,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .size(32.dp)
                    ) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f)
                        ) {
                            Icon(
                                Icons.Default.CameraAlt,
                                contentDescription = "Change profile photo",
                                modifier = Modifier
                                    .padding(4.dp)
                                    .size(20.dp)
                            )
                        }
                    }
                }

                // Upload indicator
                if (uiState.isUploadingPhoto) {
                    CircularProgressIndicator(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .size(40.dp),
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                // Nationality flag badge on profile photo
                if (!uiState.isEditing && user.nationality != null) {
                    FlagBadge(
                        countryCode = user.nationality!!,
                        badgeSize = 28.dp,
                        modifier = Modifier.align(Alignment.BottomEnd)
                    )
                }
            }
        }

        // CNY badge
        Text(
            text = "\uD83D\uDC0E 2026",
            style = MaterialTheme.typography.labelSmall,
            color = CnyGold,
            modifier = Modifier
                .offset(y = (-40).dp)
                .padding(start = 130.dp)
        )

        // Profile info section
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-34).dp)
                .padding(horizontal = 16.dp)
        ) {
            if (uiState.isEditing) {
                // Edit mode
                OutlinedTextField(
                    value = editDisplayName,
                    onValueChange = { if (it.length <= 20) onEditDisplayNameChange(it) },
                    label = { Text("Display Name") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    supportingText = { Text("${editDisplayName.length}/20") }
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Unique ID (read-only even in edit mode)
                if (user.uniqueId != 0L) {
                    Text(
                        text = "ID: ${user.uniqueId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                // Nationality picker
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(onClick = onShowCountryPicker),
                    shape = MaterialTheme.shapes.small,
                    tonalElevation = 1.dp
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val natCode = editNationality
                        Text(
                            text = if (natCode != null) {
                                "${flagEmojiForCode(natCode)} ${countryNameForCode(natCode) ?: natCode}"
                            } else {
                                "Select nationality"
                            },
                            style = MaterialTheme.typography.bodyLarge
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = editDescription,
                    onValueChange = { if (it.length <= 200) onEditDescriptionChange(it) },
                    label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 5,
                    supportingText = { Text("${editDescription.length}/200") }
                )

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onToggleEditing,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Cancel")
                    }
                    Button(
                        onClick = onSaveEdits,
                        enabled = editDisplayName.isNotBlank() && !uiState.isLoading,
                        modifier = Modifier.weight(1f)
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                        } else {
                            Text("Save")
                        }
                    }
                }
            } else {
                // View mode
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = user.displayName,
                        style = MaterialTheme.typography.headlineMedium
                    )
                    if (uiState.isOnline) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(SpeakingGreen)
                        )
                    }
                }

                if (user.uniqueId != 0L) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "ID: ${user.uniqueId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                val age = user.dateOfBirth?.let { calculateAge(it) }
                val shouldShowAge = age != null && (isOwn || !user.hideAge)
                if (shouldShowAge) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "$age years old",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                user.description?.takeIf { it.isNotBlank() }?.let { desc ->
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = desc,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                if (isOwn) {
                    // Edit profile button
                    OutlinedButton(
                        onClick = onToggleEditing,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Edit Profile")
                    }

                } else {
                    // Follow/Unfollow button for other users
                    if (uiState.isFollowingTarget) {
                        OutlinedButton(
                            onClick = onFollowToggle,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.PersonRemove, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Unfollow")
                        }
                    } else {
                        Button(
                            onClick = onFollowToggle,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Follow")
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    // Block/Unblock button for other users
                    val isBlocked = uiState.isBlockedByViewer
                    OutlinedButton(
                        onClick = onBlockToggle,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = if (isBlocked) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(
                            Icons.Default.Block,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (isBlocked) "Unblock" else "Block")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

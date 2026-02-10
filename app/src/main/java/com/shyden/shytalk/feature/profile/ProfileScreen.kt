package com.shyden.shytalk.feature.profile

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.core.content.ContextCompat
import com.canhub.cropper.CropImageContract
import com.canhub.cropper.CropImageContractOptions
import com.canhub.cropper.CropImageOptions
import com.canhub.cropper.CropImageView
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
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Person
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    userId: String? = null,
    showBackButton: Boolean = true,
    onNavigateBack: () -> Unit = {},
    onSignOut: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    viewModel: ProfileViewModel = hiltViewModel()
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
    var fullscreenPhotoUrl by remember { mutableStateOf<String?>(null) }

    // Photo pickers with cropping
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val profilePhotoCropper = rememberLauncherForActivityResult(
        contract = CropImageContract()
    ) { result ->
        if (result.isSuccessful) {
            result.uriContent?.let { viewModel.uploadProfilePhoto(it) }
        }
    }
    val coverPhotoCropper = rememberLauncherForActivityResult(
        contract = CropImageContract()
    ) { result ->
        if (result.isSuccessful) {
            result.uriContent?.let { viewModel.uploadCoverPhoto(it) }
        }
    }

    val profileCropOptions = CropImageContractOptions(
        uri = null,
        cropImageOptions = CropImageOptions(
            guidelines = CropImageView.Guidelines.ON,
            aspectRatioX = 1,
            aspectRatioY = 1,
            fixAspectRatio = true,
            cropShape = CropImageView.CropShape.OVAL,
            outputCompressQuality = 80,
            activityBackgroundColor = AndroidColor.BLACK,
            toolbarColor = AndroidColor.DKGRAY,
            toolbarTintColor = AndroidColor.WHITE,
            toolbarBackButtonColor = AndroidColor.WHITE,
            activityTitle = "Crop Profile Photo"
        )
    )
    val coverCropOptions = CropImageContractOptions(
        uri = null,
        cropImageOptions = CropImageOptions(
            guidelines = CropImageView.Guidelines.ON,
            aspectRatioX = 16,
            aspectRatioY = 9,
            fixAspectRatio = true,
            cropShape = CropImageView.CropShape.RECTANGLE,
            outputCompressQuality = 80,
            activityBackgroundColor = AndroidColor.BLACK,
            toolbarColor = AndroidColor.DKGRAY,
            toolbarTintColor = AndroidColor.WHITE,
            toolbarBackButtonColor = AndroidColor.WHITE,
            activityTitle = "Crop Cover Photo"
        )
    )

    // Track which photo type triggered the permission request
    var pendingPhotoType by remember { mutableStateOf<String?>(null) }

    val storagePermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            when (pendingPhotoType) {
                "profile" -> profilePhotoCropper.launch(profileCropOptions)
                "cover" -> coverPhotoCropper.launch(coverCropOptions)
            }
        } else {
            scope.launch {
                snackbarHostState.showSnackbar("Storage permission is required to select a photo")
            }
        }
        pendingPhotoType = null
    }

    fun launchPhotoPicker(type: String) {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        val alreadyGranted = ContextCompat.checkSelfPermission(context, permission) ==
                PackageManager.PERMISSION_GRANTED
        if (alreadyGranted) {
            when (type) {
                "profile" -> profilePhotoCropper.launch(profileCropOptions)
                "cover" -> coverPhotoCropper.launch(coverCropOptions)
            }
        } else {
            pendingPhotoType = type
            storagePermissionLauncher.launch(permission)
        }
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
                onSignOut = onSignOut,
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
                onSignOut = onSignOut,
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
    onSignOut: (() -> Unit)?,
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

    // Blocked by target - show blocked message
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
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(180.dp)
                .then(
                    if (user.coverPhotoUrl != null && !uiState.isEditing)
                        Modifier.clickable { onTapPhoto(user.coverPhotoUrl) }
                    else Modifier
                )
        ) {
            if (user.coverPhotoUrl != null) {
                AsyncImage(
                    model = user.coverPhotoUrl,
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

        // Profile photo (overlapping cover)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-50).dp)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            Box {
                val photoUrl = user.profilePhotoUrl ?: user.avatarUrl
                if (photoUrl != null) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = "Profile photo",
                        modifier = Modifier
                            .size(100.dp)
                            .clip(CircleShape)
                            .then(
                                if (!uiState.isEditing)
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
            }
        }

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
                    onValueChange = onEditDisplayNameChange,
                    label = { Text("Display Name") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
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
                        Text(
                            text = if (editNationality != null) {
                                "${flagEmojiForCode(editNationality)} ${countryNameForCode(editNationality) ?: editNationality}"
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
                Text(
                    text = user.displayName,
                    style = MaterialTheme.typography.headlineMedium
                )

                if (user.uniqueId != 0L) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "ID: ${user.uniqueId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (user.nationality != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "${flagEmojiForCode(user.nationality)} ${countryNameForCode(user.nationality) ?: ""}",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }

                if (!user.description.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = user.description,
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

                    // Sign out button
                    if (onSignOut != null) {
                        Spacer(modifier = Modifier.height(32.dp))
                        OutlinedButton(
                            onClick = onSignOut,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = MaterialTheme.colorScheme.error
                            )
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Logout,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Sign Out")
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    val uriHandler = LocalUriHandler.current
                    TextButton(
                        onClick = { uriHandler.openUri("https://shydenmcm.github.io/ShyTalk/privacy-policy.html") },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Privacy Policy", style = MaterialTheme.typography.bodySmall)
                    }
                } else {
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

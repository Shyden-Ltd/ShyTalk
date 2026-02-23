package com.shyden.shytalk.feature.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import com.shyden.shytalk.core.crop.CropContract
import com.shyden.shytalk.core.crop.CropInput
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.AccountBalanceWallet
import android.content.Intent
import org.koin.compose.koinInject
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.ui.SuperShyGold
import com.shyden.shytalk.core.util.calculateAge
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.feature.messaging.ReportUserDialog
import com.shyden.shytalk.feature.shop.SuperShyBottomSheet
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.ui.components.FlagBadge
import com.shyden.shytalk.ui.theme.CnyGold
import com.shyden.shytalk.ui.theme.SpeakingGreen
import kotlinx.coroutines.launch

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
    onNavigateToChat: ((String) -> Unit)? = null,
    onNavigateToWallet: (() -> Unit)? = null,
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
    var showReportDialog by remember { mutableStateOf(false) }
    var fullscreenPhotoUrl by rememberSaveable { mutableStateOf<String?>(null) }
    val reportEvidenceList = remember { mutableListOf<Pair<ByteArray, String>>() }
    var reportEvidenceVersion by remember { mutableStateOf(0) }
    var isCompressingEvidence by remember { mutableStateOf(false) }
    val evidenceScope = rememberCoroutineScope()

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

    val reportEvidencePickerLauncher = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        if (uri != null) {
            val mimeType = imageContext.contentResolver.getType(uri) ?: "image/jpeg"
            if (mimeType.startsWith("video/")) {
                isCompressingEvidence = true
                evidenceScope.launch {
                    val result = com.shyden.shytalk.core.util.VideoCompressor.compressVideo(
                        imageContext, uri, Constants.EVIDENCE_VIDEO_TARGET_BYTES, mimeType
                    )
                    isCompressingEvidence = false
                    if (result != null && result.first.size <= Constants.EVIDENCE_MAX_SIZE_BYTES) {
                        reportEvidenceList.add(result)
                        reportEvidenceVersion++
                    } else {
                        snackbarHostState.showSnackbar("Video is too large to upload. Please use a shorter clip.")
                    }
                }
            } else {
                val bytes = imageContext.contentResolver.openInputStream(uri)?.readBytes()
                if (bytes != null) {
                    if (bytes.size <= Constants.EVIDENCE_MAX_SIZE_BYTES) {
                        reportEvidenceList.add(bytes to mimeType)
                        reportEvidenceVersion++
                    } else {
                        evidenceScope.launch {
                            snackbarHostState.showSnackbar("File is too large. Maximum size is 10 MB.")
                        }
                    }
                }
            }
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

    LaunchedEffect(uiState.reportSubmitted) {
        if (uiState.reportSubmitted) {
            showReportDialog = false
            reportEvidenceList.clear()
            reportEvidenceVersion++
            snackbarHostState.showSnackbar("Thank you for your report. We will review it shortly.")
            viewModel.clearReportSubmitted()
        }
    }

    // Load profile for the current or specified user
    LaunchedEffect(userId) {
        viewModel.loadProfile(userId)
    }

    val user = uiState.user
    val isOwn = uiState.isOwnProfile

    // Test purchase for Super Shy — bypasses BillingClient, calls validatePurchase directly
    val onTestPurchaseSuperShy: (String) -> Unit = { productId ->
        viewModel.testPurchaseSuperShy(productId)
    }

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
                onReportUser = { showReportDialog = true },
                onFollowToggle = {
                    val targetId = uiState.user?.uid ?: return@ProfileContent
                    if (uiState.isFollowingTarget) viewModel.unfollowUser(targetId)
                    else viewModel.followUser(targetId)
                },
                onNavigateToFollowList = onNavigateToFollowList,
                onNavigateToRoom = onNavigateToRoom,
                onNavigateToChat = onNavigateToChat,
                onNavigateToWallet = onNavigateToWallet,
                onTestPurchaseSuperShy = onTestPurchaseSuperShy,
                onClaimTrial = { viewModel.claimSuperShyTrial() },
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
                    },
                    actions = {
                        val context = LocalContext.current
                        IconButton(onClick = {
                            val user = uiState.user ?: return@IconButton
                            val shareText = "Check out ${user.displayName}'s profile on ShyTalk!\nhttps://shytalk.shyden.co.uk/profile/${user.uid}"
                            val sendIntent = Intent().apply {
                                action = Intent.ACTION_SEND
                                putExtra(Intent.EXTRA_TEXT, shareText)
                                type = "text/plain"
                            }
                            context.startActivity(Intent.createChooser(sendIntent, "Share Profile"))
                        }) {
                            Icon(Icons.Default.Share, contentDescription = "Share profile")
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
                onReportUser = { showReportDialog = true },
                onFollowToggle = {
                    val targetId = uiState.user?.uid ?: return@ProfileContent
                    if (uiState.isFollowingTarget) viewModel.unfollowUser(targetId)
                    else viewModel.followUser(targetId)
                },
                onNavigateToFollowList = onNavigateToFollowList,
                onNavigateToRoom = onNavigateToRoom,
                onNavigateToChat = onNavigateToChat,
                onNavigateToWallet = onNavigateToWallet,
                onTestPurchaseSuperShy = onTestPurchaseSuperShy,
                onClaimTrial = { viewModel.claimSuperShyTrial() },
                snackbarHostState = snackbarHostState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            )
        }
    }

    // Report user dialog
    if (showReportDialog && user != null) {
        ReportUserDialog(
            userName = user.displayName,
            onDismiss = {
                if (!uiState.isSubmittingReport) {
                    showReportDialog = false
                    reportEvidenceList.clear()
                    reportEvidenceVersion++
                }
            },
            onSubmit = { reason, description ->
                viewModel.reportUser(reason, description, reportEvidenceList.toList())
            },
            evidenceItems = reportEvidenceList.map { it.first }.also { _ -> reportEvidenceVersion },
            onAddEvidence = {
                reportEvidencePickerLauncher.launch(
                    PickVisualMediaRequest(PickVisualMedia.ImageAndVideo)
                )
            },
            onRemoveEvidence = { index ->
                if (index in reportEvidenceList.indices) {
                    reportEvidenceList.removeAt(index)
                    reportEvidenceVersion++
                }
            },
            isSubmitting = uiState.isSubmittingReport,
            isCompressing = isCompressingEvidence,
            errorMessage = uiState.reportError
        )
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

@OptIn(ExperimentalMaterial3Api::class)
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
    onReportUser: () -> Unit = {},
    onFollowToggle: () -> Unit = {},
    onNavigateToFollowList: ((String, String) -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    onNavigateToChat: ((String) -> Unit)? = null,
    onNavigateToWallet: (() -> Unit)? = null,
    onTestPurchaseSuperShy: ((String) -> Unit)? = null,
    onClaimTrial: (() -> Unit)? = null,
    snackbarHostState: SnackbarHostState,
    modifier: Modifier = Modifier
) {
    val user = uiState.user
    var showSuperShySheet by remember { mutableStateOf(false) }

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
                        textAlign = TextAlign.Center,
                        modifier = Modifier.testTag("profile_displayName")
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
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedButton(
                    onClick = onReportUser,
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(
                        Icons.Default.Flag,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Report User")
                }
            }
        }
        return
    }

    // Suspended target user - show suspended message
    if (uiState.isTargetSuspended && !isOwn) {
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
                    text = "Account Suspended",
                    style = MaterialTheme.typography.titleLarge,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "This user's account has been suspended.",
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

    // Gift Wall ViewModel for tab
    val giftWallViewModel: GiftWallViewModel = koinViewModel(
        key = user.uid
    ) { org.koin.core.parameter.parametersOf(user.uid) }
    val giftWallState by giftWallViewModel.uiState.collectAsStateWithLifecycle()

    // Backpack (own profile only)
    val giftingViewModel: GiftingViewModel? = if (isOwn) koinInject() else null
    val giftingState = giftingViewModel?.uiState?.collectAsStateWithLifecycle()

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

            // Follow stats overlay at bottom of cover photo
            if (!uiState.isEditing) {
                val followingHidden = !isOwn && uiState.hideFollowing
                Row(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .background(Color.Black.copy(alpha = 0.45f))
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(24.dp)
                ) {
                    // Following
                    Column(
                        modifier = Modifier.clickable(enabled = !followingHidden) {
                            onNavigateToFollowList?.invoke(user.uid, "following")
                        },
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = if (followingHidden) "-" else "${uiState.followingCount}",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White
                        )
                        Text(
                            text = if (followingHidden) "Following (Private)" else "Following",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.8f)
                        )
                    }
                    // Followers
                    Column(
                        modifier = Modifier.clickable {
                            onNavigateToFollowList?.invoke(user.uid, "followers")
                        },
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "${uiState.followerCount}",
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White
                        )
                        Text(
                            text = "Followers",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.8f)
                        )
                    }
                    // Stalkers (own profile only)
                    if (isOwn) {
                        Column(
                            modifier = Modifier.clickable {
                                onNavigateToFollowList?.invoke(user.uid, "stalkers")
                            },
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            BadgedBox(
                                badge = {
                                    if (uiState.newStalkerCount > 0) {
                                        val pulse = rememberInfiniteTransition(label = "stalkerBadge")
                                        val scale by pulse.animateFloat(
                                            initialValue = 1f,
                                            targetValue = 1.3f,
                                            animationSpec = infiniteRepeatable(
                                                animation = tween(1000),
                                                repeatMode = RepeatMode.Reverse
                                            ),
                                            label = "stalkerScale"
                                        )
                                        Badge(
                                            modifier = Modifier
                                                .offset(y = (-4).dp)
                                                .graphicsLayer {
                                                    scaleX = scale
                                                    scaleY = scale
                                                }
                                        ) {
                                            Text("${uiState.newStalkerCount}")
                                        }
                                    }
                                }
                            ) {
                                Text(
                                    text = "${uiState.stalkerCount}",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White
                                )
                            }
                            Text(
                                text = "Stalkers",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.White.copy(alpha = 0.8f)
                            )
                        }
                    }
                }
            }
        }

        // Profile photo (overlapping cover)
        val activeRoomId = uiState.activeRoomId
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-50).dp)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.CenterStart
        ) {
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
                val nationality = user.nationality
                if (!uiState.isEditing && nationality != null) {
                    FlagBadge(
                        countryCode = nationality,
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
                    modifier = Modifier.fillMaxWidth()
                ) {
                    StyledDisplayName(
                        displayName = user.displayName,
                        isSuperShy = user.isSuperShy,
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.testTag("profile_displayName")
                    )
                    if (uiState.isOnline) {
                        Spacer(modifier = Modifier.width(8.dp))
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(SpeakingGreen)
                        )
                    }
                    Spacer(modifier = Modifier.weight(1f))
                    if (isOwn) {
                        Surface(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .clickable { onToggleEditing() },
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer,
                            shadowElevation = 2.dp
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    Icons.Default.Edit,
                                    contentDescription = "Edit profile",
                                    modifier = Modifier.size(18.dp),
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
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

                // Collapsible description
                user.description?.takeIf { it.isNotBlank() }?.let { desc ->
                    Spacer(modifier = Modifier.height(12.dp))
                    var expanded by rememberSaveable { mutableStateOf(false) }
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .animateContentSize()
                    ) {
                        Text(
                            text = desc,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = if (expanded) Int.MAX_VALUE else 2,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (desc.length > 80) {
                            Text(
                                text = if (expanded) "less" else "more",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.clickable { expanded = !expanded }
                            )
                        }
                    }
                }

                // Super Shy + Wallet buttons (own profile only)
                if (isOwn) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Super Shy button
                        val superShyActive = user.isSuperShy
                        Button(
                            onClick = { showSuperShySheet = true },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = if (superShyActive) SuperShyGold
                                else MaterialTheme.colorScheme.surfaceVariant,
                                contentColor = if (superShyActive) Color.Black
                                else MaterialTheme.colorScheme.onSurfaceVariant
                            ),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(
                                Icons.Filled.Star,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            if (superShyActive) {
                                val label = if (user.superShyTier == "lifetime") {
                                    "Super Shy \u2726 Lifetime"
                                } else {
                                    val daysLeft = user.superShyExpiry?.let {
                                        ((it - currentTimeMillis()) / 86_400_000).toInt()
                                    }
                                    if (daysLeft != null && daysLeft > 0) "Super Shy \u2726 ${daysLeft}d"
                                    else "Super Shy"
                                }
                                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            } else {
                                Text("Get Super Shy")
                            }
                        }

                        // Wallet button
                        Button(
                            onClick = { onNavigateToWallet?.invoke() },
                            modifier = Modifier.weight(1f).testTag("profile_walletButton"),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary
                            ),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(
                                Icons.Filled.AccountBalanceWallet,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                "Wallet \u00B7 ${formatBalance(user.shyCoins)}",
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                if (!isOwn) {
                    // Follow/Unfollow + Message buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (uiState.isFollowingTarget) {
                            OutlinedButton(
                                onClick = onFollowToggle,
                                modifier = Modifier.weight(1f).testTag("profile_followButton")
                            ) {
                                Icon(Icons.Default.PersonRemove, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Unfollow")
                            }
                        } else {
                            Button(
                                onClick = onFollowToggle,
                                modifier = Modifier.weight(1f).testTag("profile_followButton")
                            ) {
                                Icon(Icons.Default.PersonAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Follow")
                            }
                        }
                        if (onNavigateToChat != null) {
                            OutlinedButton(
                                onClick = { onNavigateToChat(user.uid) },
                                modifier = Modifier.weight(1f).testTag("profile_messageButton")
                            ) {
                                Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Message")
                            }
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

                    Spacer(modifier = Modifier.height(8.dp))

                    // Report button for other users
                    OutlinedButton(
                        onClick = onReportUser,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(
                            Icons.Default.Flag,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Report")
                    }
                }

                // Gift Wall / Backpack Tabs
                Spacer(modifier = Modifier.height(16.dp))
                val tabCount = if (isOwn) 2 else 1
                var selectedTab by rememberSaveable { mutableIntStateOf(0) }
                PrimaryTabRow(selectedTabIndex = selectedTab) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("Gift Wall") }
                    )
                    if (isOwn) {
                        Tab(
                            selected = selectedTab == 1,
                            onClick = { selectedTab = 1 },
                            text = { Text("Backpack") }
                        )
                    }
                }

                when (selectedTab) {
                    0 -> GiftWallContent(
                        state = giftWallState,
                        onSelectGift = { giftWallViewModel.selectGift(it) },
                        onDismissDetails = { giftWallViewModel.dismissDetails() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(400.dp)
                    )
                    1 -> if (isOwn && giftingState != null) {
                        BackpackContent(
                            backpackItems = giftingState.value.backpackItems,
                            giftCatalog = giftingState.value.giftCatalog,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(400.dp)
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    // Super Shy bottom sheet
    if (showSuperShySheet) {
        SuperShyBottomSheet(
            user = user,
            onTestPurchase = if (onTestPurchaseSuperShy != null) { productId ->
                showSuperShySheet = false
                onTestPurchaseSuperShy(productId)
            } else null,
            onClaimTrial = onClaimTrial,
            onDismiss = { showSuperShySheet = false }
        )
    }
}

private fun formatBalance(value: Long): String = "%,d".format(value)

@Composable
private fun BackpackContent(
    backpackItems: List<BackpackItem>,
    giftCatalog: List<Gift>,
    modifier: Modifier = Modifier
) {
    val ownedGifts = remember(backpackItems, giftCatalog) {
        backpackItems
            .filter { it.quantity > 0 }
            .mapNotNull { item ->
                giftCatalog.find { it.id == item.giftId }?.let { gift -> gift to item.quantity }
            }
            .sortedByDescending { it.first.coinValue }
    }

    if (ownedGifts.isEmpty()) {
        Box(modifier = modifier, contentAlignment = Alignment.Center) {
            Text(
                text = "Your backpack is empty.\nWin gifts from Lucky Spin!",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    } else {
        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = modifier
        ) {
            items(ownedGifts, key = { it.first.id }) { (gift, quantity) ->
                BackpackItemCell(gift = gift, quantity = quantity)
            }
        }
    }
}

@Composable
private fun BackpackItemCell(
    gift: Gift,
    quantity: Int,
    modifier: Modifier = Modifier
) {
    val cellColor = MaterialTheme.colorScheme.onSurface

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(12.dp))
            .background(cellColor.copy(alpha = 0.06f))
            .border(1.dp, cellColor.copy(alpha = 0.15f), RoundedCornerShape(12.dp))
            .padding(8.dp)
    ) {
        Box(contentAlignment = Alignment.TopEnd) {
            if (gift.iconUrl.isNotBlank()) {
                AsyncImage(
                    model = gift.iconUrl,
                    contentDescription = gift.name,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape),
                    contentScale = ContentScale.Crop
                )
            } else {
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = CircleShape,
                    color = cellColor.copy(alpha = 0.10f)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = gift.name.take(2).uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = cellColor
                        )
                    }
                }
            }
            // Quantity badge
            if (quantity > 1) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = "$quantity",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White,
                            fontSize = 9.sp
                        )
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = gift.name,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
    }
}

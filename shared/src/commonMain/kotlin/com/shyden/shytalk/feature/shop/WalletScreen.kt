package com.shyden.shytalk.feature.shop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

@Suppress("kotlin:S6615")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WalletScreen(
    viewModel: WalletViewModel,
    onNavigateBack: () -> Unit,
    onNavigateToTransactions: () -> Unit,
    onPurchasePackage: (CoinPackage) -> Unit,
    _onPurchaseSubscription: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearError()
        }
    }

    LaunchedEffect(state.successMessage) {
        state.successMessage?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearSuccess()
        }
    }

    Scaffold(
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.wallet)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.go_back))
                    }
                },
                actions = {
                    IconButton(
                        onClick = onNavigateToTransactions,
                        modifier = Modifier.testTag("wallet_transactionsButton"),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ReceiptLong, contentDescription = stringResource(Res.string.transaction_history))
                    }
                },
            )
        },
        modifier = modifier,
    ) { padding ->
        if (state.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(padding),
            ) {
                PrimaryTabRow(selectedTabIndex = selectedTab) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text(stringResource(Res.string.shy_coins)) },
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text(stringResource(Res.string.shy_beans)) },
                    )
                }

                when (selectedTab) {
                    0 ->
                        CoinsTab(
                            coinBalance = state.coinBalance,
                            coinPackages = state.coinPackages,
                            isPurchasing = state.isPurchasing,
                            onPurchasePackage = onPurchasePackage,
                        )

                    1 ->
                        BeansTab(
                            beanBalance = state.beanBalance,
                            isPurchasing = state.isPurchasing,
                            onRedeem = { amount -> viewModel.redeemBeans(amount) },
                        )
                }
            }
        }
    }
}

@Composable
private fun CoinsTab(
    coinBalance: Long,
    coinPackages: List<CoinPackage>,
    isPurchasing: Boolean,
    onPurchasePackage: (CoinPackage) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
    ) {
        BalanceCard(
            label = stringResource(Res.string.shy_coins),
            amount = coinBalance,
            icon = "\uD83E\uDE99",
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.fillMaxWidth().testTag("wallet_balance"),
        )

        Spacer(modifier = Modifier.height(16.dp))

        // wallet_buyCoinsButton: cohort-gated surface. j01/j02/j04
        // scenarios assert this is VISIBLE for adults (post-verification)
        // and HIDDEN for minors / pending verification. The tag goes on
        // the section header so existence-checks pass when the whole
        // buy-coins UI is rendered. The per-package buy itself is
        // tagged separately via CoinPackageCard if needed.
        Text(
            stringResource(Res.string.buy_shy_coins),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.testTag("wallet_buyCoinsButton"),
        )
        Spacer(modifier = Modifier.height(8.dp))

        // Grid rendered inline to avoid nested scrollable issues
        val rows = coinPackages.chunked(2)
        rows.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { pkg ->
                    Box(modifier = Modifier.weight(1f)) {
                        CoinPackageCard(
                            pkg = pkg,
                            enabled = !isPurchasing,
                            onClick = { onPurchasePackage(pkg) },
                        )
                    }
                }
                if (row.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

@Suppress("kotlin:S3776")
@Composable
private fun BeansTab(
    beanBalance: Long,
    isPurchasing: Boolean,
    onRedeem: (Long) -> Unit,
) {
    val presets = listOf(100L, 500L, 1_000L, 2_000L, 5_000L)
    var confirmAmount by remember { mutableStateOf<Long?>(null) }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
    ) {
        BalanceCard(
            label = stringResource(Res.string.shy_beans),
            amount = beanBalance,
            icon = "\uD83E\uDED8",
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(20.dp))

        Text(stringResource(Res.string.redeem_shy_beans), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            stringResource(Res.string.bean_redeem_description),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(12.dp))

        // Preset buttons in 2-column grid
        val rows = (presets + -1L).chunked(2) // -1 sentinel for "Redeem All"
        rows.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { preset ->
                    val isRedeemAll = preset == -1L
                    val amount = if (isRedeemAll) beanBalance else preset
                    val label = if (isRedeemAll) stringResource(Res.string.redeem_all) else formatNumber(preset)
                    val hasBonus = amount >= 2_000
                    val enabled = !isPurchasing && amount > 0 && amount <= beanBalance

                    Button(
                        onClick = { confirmAmount = amount },
                        enabled = enabled,
                        modifier = Modifier.weight(1f).height(56.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor =
                                    if (hasBonus && enabled) {
                                        Color(0xFF4CAF50)
                                    } else {
                                        MaterialTheme.colorScheme.primary
                                    },
                            ),
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(label, fontWeight = FontWeight.Bold)
                            if (hasBonus) {
                                Text(
                                    "+10%",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (enabled) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                // Pad last row if odd
                if (row.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        Spacer(modifier = Modifier.height(16.dp))
    }

    // Confirmation dialog
    confirmAmount?.let { amount ->
        val coins = if (amount >= 2_000) (amount * 1.1).toLong() else amount
        AlertDialog(
            onDismissRequest = { confirmAmount = null },
            title = { Text(stringResource(Res.string.confirm_redemption)) },
            text = {
                Text(stringResource(Res.string.redeem_beans_for_coins, formatNumber(amount), formatNumber(coins)))
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmAmount = null
                    onRedeem(amount)
                }) {
                    Text(stringResource(Res.string.redeem))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmAmount = null }) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun BalanceCard(
    label: String,
    amount: Long,
    icon: String,
    containerColor: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = containerColor),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(icon, style = MaterialTheme.typography.headlineMedium)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = formatNumber(amount),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun CoinPackageCard(
    pkg: CoinPackage,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().height(80.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text("${pkg.coins}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            if (pkg.bonusCoins > 0) {
                Text(
                    stringResource(Res.string.bonus_coins, pkg.bonusCoins),
                    color = Color(0xFF4CAF50),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(pkg.displayPrice, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * Lightweight coin-purchase content for use inside a ModalBottomSheet.
 * Keeps the user in the room while purchasing coins.
 */
@Composable
fun CoinPurchaseSheetContent(
    coinBalance: Long,
    coinPackages: List<CoinPackage>,
    isPurchasing: Boolean,
    onPurchasePackage: (CoinPackage) -> Unit,
    _onDismiss: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(16.dp),
    ) {
        BalanceCard(
            label = stringResource(Res.string.shy_coins),
            amount = coinBalance,
            icon = "\uD83E\uDE99",
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(stringResource(Res.string.buy_shy_coins), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(8.dp))

        val sheetRows = coinPackages.chunked(2)
        sheetRows.forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                row.forEach { pkg ->
                    Box(modifier = Modifier.weight(1f)) {
                        CoinPackageCard(
                            pkg = pkg,
                            enabled = !isPurchasing,
                            onClick = { onPurchasePackage(pkg) },
                        )
                    }
                }
                if (row.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

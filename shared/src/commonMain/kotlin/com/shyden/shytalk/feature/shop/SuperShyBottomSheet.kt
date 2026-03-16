package com.shyden.shytalk.feature.shop

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.SuperShyGold
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuperShyBottomSheet(
    user: User,
    onPurchase: (String) -> Unit = {},
    onTestPurchase: ((String) -> Unit)? = null,
    onClaimTrial: (() -> Unit)? = null,
    isPurchasing: Boolean = false,
    onDismiss: () -> Unit,
) {
    val effectivePurchase: (String) -> Unit = onTestPurchase ?: onPurchase

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
                    .padding(bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Testing mode banner
            if (onTestPurchase != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors =
                        CardDefaults.cardColors(
                            containerColor = Color(0xFFFFF3E0),
                        ),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        stringResource(Res.string.testing_mode_super_shy),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFE65100),
                        modifier = Modifier.padding(12.dp),
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Header
            Icon(
                Icons.Filled.Star,
                contentDescription = null,
                tint = SuperShyGold,
                modifier = Modifier.size(40.dp),
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                stringResource(Res.string.super_shy),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = SuperShyGold,
            )
            Spacer(modifier = Modifier.height(16.dp))

            // Benefits list
            val benefits =
                listOf(
                    stringResource(Res.string.benefit_gold_name),
                    stringResource(Res.string.benefit_star_badge),
                    stringResource(Res.string.benefit_daily_bonus),
                    stringResource(Res.string.benefit_profile_frame),
                    stringResource(Res.string.benefit_extended_room),
                    stringResource(Res.string.benefit_full_room),
                )
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors =
                    CardDefaults.cardColors(
                        containerColor = SuperShyGold.copy(alpha = 0.08f),
                    ),
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        stringResource(Res.string.benefits),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    benefits.forEach { benefit ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(vertical = 4.dp),
                        ) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = SuperShyGold,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                benefit,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            if (user.isSuperShy && user.superShyTier == "lifetime") {
                // Lifetime — congratulations
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors =
                        CardDefaults.cardColors(
                            containerColor = SuperShyGold.copy(alpha = 0.15f),
                        ),
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            Icons.Filled.Shield,
                            contentDescription = null,
                            tint = SuperShyGold,
                            modifier = Modifier.size(32.dp),
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            stringResource(Res.string.super_shy_for_life),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            } else if (user.isSuperShy) {
                // Active non-lifetime — show current tier + expiry + upgrade option
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors =
                        CardDefaults.cardColors(
                            containerColor = SuperShyGold.copy(alpha = 0.1f),
                        ),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            stringResource(Res.string.currently_active),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            stringResource(Res.string.tier_label, user.superShyTier ?: "monthly"),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        user.superShyExpiry?.let { expiry ->
                            val daysLeft =
                                (
                                    (
                                        expiry -
                                            com.shyden.shytalk.core.util
                                                .currentTimeMillis()
                                    ) / 86_400_000
                                ).toInt()
                            if (daysLeft > 0) {
                                Text(
                                    stringResource(Res.string.days_remaining, daysLeft),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    stringResource(Res.string.upgrade_to_lifetime),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(8.dp))
                SuperShyPricingCard(
                    tier = stringResource(Res.string.tier_lifetime),
                    price = "$99.99",
                    description = stringResource(Res.string.one_time_payment),
                    onClick = { effectivePurchase("super_shy_lifetime") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isPurchasing,
                )
                if (isPurchasing) {
                    Spacer(modifier = Modifier.height(12.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = SuperShyGold,
                        strokeWidth = 2.dp,
                    )
                }
            } else {
                // Not Super Shy — show trial card + all pricing
                var claiming by remember { mutableStateOf(false) }
                var claimed by remember { mutableStateOf(false) }
                // Detect when claim succeeds (user object updates while we were claiming)
                if (claiming && user.hasClaimedSuperShyTrial && !claimed) {
                    claimed = true
                }
                if (onClaimTrial != null && (!user.hasClaimedSuperShyTrial || claimed)) {
                    Card(
                        onClick = {
                            if (!claiming && !claimed) {
                                claiming = true
                                onClaimTrial()
                            }
                        },
                        enabled = !claiming && !claimed,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        colors =
                            CardDefaults.cardColors(
                                containerColor = SuperShyGold.copy(alpha = 0.15f),
                            ),
                    ) {
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(
                                Icons.Filled.Shield,
                                contentDescription = null,
                                tint = SuperShyGold,
                                modifier = Modifier.size(24.dp),
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            when {
                                claimed -> {
                                    Text(
                                        stringResource(Res.string.claimed),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = SuperShyGold,
                                    )
                                    Text(
                                        stringResource(Res.string.claimed_activate_backpack),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        textAlign = TextAlign.Center,
                                    )
                                }
                                claiming -> {
                                    Text(
                                        stringResource(Res.string.claiming),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = SuperShyGold,
                                    )
                                }
                                else -> {
                                    Text(
                                        stringResource(Res.string.claim_30_days_free),
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                        color = SuperShyGold,
                                    )
                                    Text(
                                        stringResource(Res.string.tap_to_claim_backpack),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                    Spacer(modifier = Modifier.height(12.dp))
                }
                Text(
                    stringResource(Res.string.choose_a_plan),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    SuperShyPricingCard(
                        tier = stringResource(Res.string.tier_monthly),
                        price = "$4.99",
                        description = stringResource(Res.string.per_month),
                        onClick = { effectivePurchase("super_shy_monthly") },
                        modifier = Modifier.weight(1f),
                        enabled = !isPurchasing,
                    )
                    SuperShyPricingCard(
                        tier = stringResource(Res.string.tier_yearly),
                        price = "$39.99",
                        description = stringResource(Res.string.per_year),
                        onClick = { effectivePurchase("super_shy_yearly") },
                        modifier = Modifier.weight(1f),
                        enabled = !isPurchasing,
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                SuperShyPricingCard(
                    tier = stringResource(Res.string.tier_lifetime),
                    price = "$99.99",
                    description = stringResource(Res.string.one_time_payment),
                    onClick = { effectivePurchase("super_shy_lifetime") },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isPurchasing,
                )
                if (isPurchasing) {
                    Spacer(modifier = Modifier.height(12.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = SuperShyGold,
                        strokeWidth = 2.dp,
                    )
                }
            }
        }
    }
}

@Composable
private fun SuperShyPricingCard(
    tier: String,
    price: String,
    description: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Card(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                tier,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                price,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = SuperShyGold,
            )
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

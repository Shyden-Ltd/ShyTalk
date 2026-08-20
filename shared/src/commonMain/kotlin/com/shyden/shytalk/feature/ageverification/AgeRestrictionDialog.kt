package com.shyden.shytalk.feature.ageverification

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.age_restriction_dismiss
import com.shyden.shytalk.resources.age_restriction_needs_verification_body
import com.shyden.shytalk.resources.age_restriction_needs_verification_confirm
import com.shyden.shytalk.resources.age_restriction_needs_verification_title
import com.shyden.shytalk.resources.age_restriction_sub_eighteen_body
import com.shyden.shytalk.resources.age_restriction_sub_eighteen_title
import com.shyden.shytalk.resources.ok
import org.jetbrains.compose.resources.stringResource

/**
 * Two-variant alert dialog rendered when an [AgeRestrictionDialogState]
 * is non-Hidden.
 *
 * - [AgeRestrictionDialogState.NeedsVerification] → "Verify now" CTA
 *   that should route to the verification submit flow (PR 9).
 * - [AgeRestrictionDialogState.SubEighteen] → explanation only, no CTA
 *   (SHY-0384; SHY-0385 restores one pointing at a real support form).
 *   The user CANNOT enter the verification flow until they age in.
 *
 * Renders nothing on [AgeRestrictionDialogState.Hidden] — the host
 * Composable just holds onto the dialog and lets the state transition
 * make it appear.
 */
@Composable
fun AgeRestrictionDialog(
    state: AgeRestrictionDialogState,
    onDismiss: () -> Unit,
    onVerifyNow: () -> Unit,
) {
    when (state) {
        AgeRestrictionDialogState.Hidden -> Unit

        AgeRestrictionDialogState.NeedsVerification -> {
            AlertDialog(
                onDismissRequest = onDismiss,
                title = {
                    Text(
                        stringResource(Res.string.age_restriction_needs_verification_title),
                        fontWeight = FontWeight.Bold,
                    )
                },
                text = {
                    Text(
                        stringResource(Res.string.age_restriction_needs_verification_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            onDismiss()
                            onVerifyNow()
                        },
                        modifier = Modifier.testTag(TAG_NEEDS_VERIFICATION_CONFIRM),
                    ) {
                        Text(stringResource(Res.string.age_restriction_needs_verification_confirm))
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag(TAG_NEEDS_VERIFICATION_DISMISS),
                    ) {
                        Text(stringResource(Res.string.age_restriction_dismiss))
                    }
                },
            )
        }

        AgeRestrictionDialogState.SubEighteen -> {
            AlertDialog(
                onDismissRequest = onDismiss,
                title = {
                    Text(
                        stringResource(Res.string.age_restriction_sub_eighteen_title),
                        fontWeight = FontWeight.Bold,
                    )
                },
                text = {
                    Text(
                        stringResource(Res.string.age_restriction_sub_eighteen_body),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                },
                // SHY-0384: ONE action, and it closes.
                //
                // A "Contact support" button used to sit in the confirm slot,
                // running `onDismiss(); onContactSupport()` -- and every caller
                // passed a dismiss for onContactSupport, so it was behaviourally
                // identical to Cancel while the body text told people to use it.
                //
                // It sits in `confirmButton` rather than `dismissButton` because
                // Material3's AlertDialog requires confirmButton, and it is
                // labelled OK rather than Cancel: with nothing to confirm and
                // nothing to cancel, the only honest label is an acknowledgement.
                //
                // SHY-0385 restores a real support action here, pointing at the
                // ticket form.
                confirmButton = {
                    TextButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag(TAG_SUB_EIGHTEEN_DISMISS),
                    ) {
                        Text(stringResource(Res.string.ok))
                    }
                },
            )
        }
    }
}

const val TAG_NEEDS_VERIFICATION_CONFIRM = "ageRestriction_needsVerification_confirm"
const val TAG_NEEDS_VERIFICATION_DISMISS = "ageRestriction_needsVerification_dismiss"
const val TAG_SUB_EIGHTEEN_DISMISS = "ageRestriction_subEighteen_dismiss"

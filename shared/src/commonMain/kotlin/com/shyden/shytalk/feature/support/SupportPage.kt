package com.shyden.shytalk.feature.support

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.platform.PlatformMediaPicker
import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.OpenTicketSummary
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.close
import com.shyden.shytalk.resources.report_guide_intro
import com.shyden.shytalk.resources.report_guide_step_message
import com.shyden.shytalk.resources.report_guide_step_profile
import com.shyden.shytalk.resources.report_guide_step_room_card
import com.shyden.shytalk.resources.report_guide_stuck_action
import com.shyden.shytalk.resources.report_guide_stuck_body
import com.shyden.shytalk.resources.report_guide_stuck_title
import com.shyden.shytalk.resources.report_guide_title
import com.shyden.shytalk.resources.support_attachment_add
import com.shyden.shytalk.resources.support_attachment_limits
import com.shyden.shytalk.resources.support_attachment_remove
import com.shyden.shytalk.resources.support_attachments_label
import com.shyden.shytalk.resources.support_category_account
import com.shyden.shytalk.resources.support_category_age
import com.shyden.shytalk.resources.support_category_bug
import com.shyden.shytalk.resources.support_category_label
import com.shyden.shytalk.resources.support_category_other
import com.shyden.shytalk.resources.support_category_payment
import com.shyden.shytalk.resources.support_category_safety
import com.shyden.shytalk.resources.support_duplicate_back
import com.shyden.shytalk.resources.support_duplicate_new
import com.shyden.shytalk.resources.support_duplicate_reminder
import com.shyden.shytalk.resources.support_duplicate_same
import com.shyden.shytalk.resources.support_form_added
import com.shyden.shytalk.resources.support_form_character_count
import com.shyden.shytalk.resources.support_form_hint
import com.shyden.shytalk.resources.support_form_send
import com.shyden.shytalk.resources.support_form_sent
import com.shyden.shytalk.resources.support_form_title
import com.shyden.shytalk.resources.support_open_requests_many
import com.shyden.shytalk.resources.support_open_requests_more
import com.shyden.shytalk.resources.support_open_requests_one
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

/** Test tags — the journey suite addresses these rather than the label text. */
const val TAG_SUPPORT_INPUT = "support_input"
const val TAG_SUPPORT_SEND = "support_send"
const val TAG_SUPPORT_BACK = "support_back"
const val TAG_SUPPORT_ADD_FILE = "support_addFile"
const val TAG_SUPPORT_ATTACHMENT = "support_attachment"
const val TAG_SUPPORT_LIMITS = "support_limits"
const val TAG_SUPPORT_CHAR_COUNT = "support_charCount"
const val TAG_SUPPORT_CATEGORY = "support_category"

/** SHY-0437 — the report guide, and its escape hatch. */
const val TAG_SUPPORT_REPORT_GUIDE = "support_reportGuide"
const val TAG_SUPPORT_CONTACT_ANYWAY = "support_contactAnyway"

/** SHY-0396 — the three choices somebody gets when a request is already open. */
const val TAG_SUPPORT_DUPLICATE = "support_duplicate"
const val TAG_SUPPORT_ADD_TO_OPEN = "support_addToOpen"
const val TAG_SUPPORT_NEW_PROBLEM = "support_newProblem"
const val TAG_SUPPORT_DUPLICATE_BACK = "support_duplicateBack"
const val TAG_SUPPORT_OPEN_NOTICE = "support_openNotice"

/**
 * Contacting support — SHY-0387.
 *
 * A page rather than a dialog, because the operator saw SHY-0385's dialog on a
 * device and called it "very boring and plain", and because categories and
 * attachments do not fit in an AlertDialog without becoming cramped.
 *
 * Everything SHY-0385 established survives: the message is never cleared on
 * failure, an already-open request is information rather than the person's
 * error, and the form resets on the way out so a second visit starts fresh.
 *
 * The category picker is pre-selected from where they came from
 * ([SupportSource]), so somebody who was just refused does not have to describe
 * the refusal — but they can change it, which is the part SHY-0385 could not do.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupportPage(
    viewModel: SupportFormViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    // Every way out resets, so the next visit is a form and not the last
    // confirmation. The ViewModel outlives this page.
    val leave = {
        viewModel.reset()
        onBack()
    }

    // SHY-0419, third reading — and the last hand-rolled inset arithmetic on
    // this screen.
    //
    // Padding the Send button by the raw IME inset put the keyboard into the
    // bottomBar's MEASURED HEIGHT, which Scaffold then subtracts from the
    // content. On iOS the content region has already had the keyboard removed
    // further up, so it lost the keyboard TWICE and the whole form collapsed to
    // a 28 pt strip: 320 pt of inset taken off a 380 pt slot. Send looked right
    // the entire time, because the bar is not subject to the content inset.
    //
    // `imePadding()` on the Scaffold accounts for it exactly once on both
    // platforms. Where the inset is still available it lifts the whole Scaffold,
    // bars included; where a parent has already consumed it, it correctly adds
    // nothing — because the space is already gone.
    // ...and the navigation bar, which the third reading missed.
    //
    // Found on a real OnePlus, on video, at step 12 of J38. With the keyboard
    // OPEN this worked — which is why the first Send of the journey passed. With
    // the keyboard CLOSED the IME inset is 0, the pinned bar sat flush to the
    // window bottom, and Android drew back/home/recents over the lower half of
    // the button. Send's tappable centre coincided with HOME: pressing it left
    // the app for the launcher instead of submitting. No assertion could see it
    // — the button existed, had its tag, reported sane bounds and was "visible".
    //
    // `union` keeps the count at ONE, which is the whole lesson of the three
    // readings above: it takes the larger inset per side, so the navigation bar
    // applies when the keyboard is down and the keyboard applies when it is up
    // (already spanning the navigation bar's region). Padding the bar separately
    // would float Send a navigation bar's height above the keyboard.
    //
    // SHY-0431. The inset above used to sit on the Scaffold's own modifier, which
    // shrinks the whole Scaffold -- BACKGROUND included. Android hides that,
    // because the system navigation bar paints the band itself; iOS paints
    // nothing below it, so the bottom 34pt of the Support screen was pure black
    // (luma 2, against the bar's own 35) while every other screen ran edge to
    // edge. The iOS convention is the opposite: background to the edge, CONTENT
    // inset. So the same union now pads the bar's content and the two bar-less
    // branches, and the Surface behind it reaches the bottom of the screen.
    val bottomInset = WindowInsets.ime.union(WindowInsets.navigationBars)

    Scaffold(
        // Explicitly zero, so the body's bottom padding is the bottom bar's
        // height and nothing else. Scaffold otherwise reports EITHER the bar's
        // height OR this value depending on which layout branch it takes, and a
        // screen should not depend on which one that is. The branches with no
        // bottom bar apply `bottomInset` themselves, below.
        contentWindowInsets = WindowInsets(0),
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.support_form_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = leave, modifier = Modifier.testTag(TAG_SUPPORT_BACK)) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(Res.string.close),
                        )
                    }
                },
            )
        },
        bottomBar = {
            // Send is PINNED above the keyboard rather than left at the bottom
            // of a scrolling form — SHY-0419, which came back.
            //
            // The first fix extended the scroll range so Send could be REACHED.
            // It was still DRAWN under the keyboard at rest, and on a real
            // iPhone the keyboard covered y 609-854 with Send at y 675: tapping
            // the button's own centre typed a "y" into the message instead of
            // sending, and the stray character shipped in the ticket. "Scroll
            // first" is not something the screen tells anybody to do.
            //
            // A pinned bar is length-independent: it holds however long the form
            // grows and whatever size keyboard the person uses.
            if (!state.submitted && !state.awaitingDuplicateChoice && !state.showReportGuide) {
                // The Surface takes no inset: it is the background, and it is
                // meant to reach the bottom edge (SHY-0431).
                Surface(tonalElevation = 3.dp) {
                    Button(
                        onClick = viewModel::submit,
                        // SHY-0396: never disabled for an already-open request.
                        // Send is how somebody REACHES the choice, so disabling
                        // it here is what blocked a genuinely different problem
                        // from ever being reported.
                        enabled = !state.isSubmitting,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                // Send itself stays clear of the home indicator
                                // and the navigation bar -- SHY-0428, which this
                                // must not undo.
                                .windowInsetsPadding(bottomInset)
                                .padding(16.dp)
                                .testTag(TAG_SUPPORT_SEND),
                    ) {
                        if (state.isSubmitting) {
                            CircularProgressIndicator(modifier = Modifier.height(18.dp))
                        } else {
                            Text(stringResource(Res.string.support_form_send))
                        }
                    }
                }
            }
        },
    ) { padding ->
        if (state.submitted) {
            SentConfirmation(
                // No bottom bar on this branch, so the inset is applied here.
                modifier = Modifier.padding(padding).windowInsetsPadding(bottomInset),
                addedToExisting = state.addedToExisting,
                onClose = leave,
            )
            return@Scaffold
        }

        // SHY-0419. `imePadding()` did nothing here, in either modifier order and
        // even after scrolling -- but the inset itself is fine: a probe on a real
        // iPhone read WindowInsets.ime.getBottom() as 0 with the keyboard closed
        // and 960 with it open. The difference is that `imePadding()` is
        // `windowInsetsPadding(WindowInsets.ime)`, which respects insets a parent
        // has already CONSUMED, while the raw read does not. Something above this
        // Column consumes the IME inset, so the modifier applied zero. Reading the
        // raw value and padding by it sidesteps that entirely.
        //
        // Without it the Send button sat at y=616 under a keyboard starting at
        // y=609, with no way to reach it: tapping outside, tapping between
        // sections and the iOS swipe-down convention all left the keyboard up, and
        // the page did not scroll. Somebody could fill this form in and never send
        // it.
        // SHY-0396. Asked BEFORE anything is sent, and it replaces the form
        // rather than floating over it: a dialog above a form with the keyboard
        // up is the exact geometry that made Send unreachable on iOS (SHY-0419).
        // SHY-0437. "Safety & another user" is the one category that does not
        // lead straight to the form: the support queue is not a reporting
        // system, and somebody in genuine distress picks the option that says
        // "Safety" and gets the least effective route we have.
        //
        // It REPLACES the form rather than sitting above it, for the same
        // reason the duplicate choice does -- something floating over a form
        // with the keyboard up is the geometry that made Send unreachable on
        // iOS (SHY-0419).
        if (state.showReportGuide) {
            ReportGuide(
                // No bottom bar on this branch either.
                modifier = Modifier.padding(padding).windowInsetsPadding(bottomInset),
                onContactSupportAnyway = viewModel::contactSupportAnyway,
            )
            return@Scaffold
        }

        if (state.awaitingDuplicateChoice) {
            DuplicateChoice(
                // No bottom bar on this branch either.
                modifier = Modifier.padding(padding).windowInsetsPadding(bottomInset),
                openTickets = state.openTickets,
                // The COUNT, not the length of the capped list (SHY-0424).
                openRequestsTotal = state.openRequestsTotal,
                busy = state.isSubmitting,
                error = state.error?.resolve(),
                onAddToOpen = viewModel::addToOpenTicket,
                onNewProblem = viewModel::sendAsNewProblem,
                onGoBack = viewModel::dismissDuplicateChoice,
            )
            return@Scaffold
        }

        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    // `padding` ALREADY reserves the bottom bar, and that bar
                    // measures itself including the keyboard lift. Adding
                    // `imeBottom` here too counted the keyboard TWICE and pushed
                    // the entire form off the screen — the page rendered as a
                    // blank area above a pinned Send button. Every test still
                    // passed, because a form that is laid out off-screen still
                    // exists in the tree.
                    .padding(padding)
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
        ) {
            Text(stringResource(Res.string.support_form_hint), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(20.dp))

            // SHY-0396's UX clause: the warning has to arrive BEFORE somebody
            // types the whole thing again, not after they press Send. So what
            // they already have open is stated here, on sight. The three choices
            // still wait for Send -- "it is the problem I already reported" needs
            // the words it is going to add.
            if (state.openTickets.isNotEmpty()) {
                OpenRequestsNotice(
                    total = state.openTickets.size,
                    shown = state.openTicketsPreview,
                    beyond = state.openTicketsBeyondPreview,
                )
                Spacer(Modifier.height(20.dp))
            }

            CategoryPicker(
                selected = state.category,
                enabled = !state.isSubmitting,
                onSelect = viewModel::selectCategory,
            )
            Spacer(Modifier.height(20.dp))

            OutlinedTextField(
                value = state.message,
                onValueChange = viewModel::updateMessage,
                enabled = !state.isSubmitting,
                isError = state.error != null || state.isOverCharacterLimit,
                minLines = 5,
                supportingText = {
                    // Live, and on the field itself. A bound somebody only
                    // discovers when they press Send is a bound that costs them
                    // the message they just wrote.
                    Text(
                        stringResource(
                            Res.string.support_form_character_count,
                            state.characterCount,
                            SUPPORT_MESSAGE_MAX_LENGTH,
                        ),
                        color =
                            if (state.isOverCharacterLimit) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        modifier = Modifier.testTag(TAG_SUPPORT_CHAR_COUNT),
                    )
                },
                modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_INPUT),
            )
            Spacer(Modifier.height(20.dp))

            Attachments(
                attachments = state.attachments,
                isAttaching = state.isAttaching,
                enabled = !state.isSubmitting,
                onPicked = viewModel::attach,
                onUnsupported = viewModel::refuseAttachmentType,
                onRemove = viewModel::removeAttachment,
            )

            state.error?.let { error ->
                Spacer(Modifier.height(12.dp))
                Text(
                    error.resolve(),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * How to report somebody, before offering them a ticket — SHY-0437.
 *
 * Operator, 2026-08-22: *"instead of allowing them to submit a ticket when they
 * choose that option, we give them step-by-step guide... After that, they can
 * still choose to submit a support ticket, if they're having problems trying to
 * report."*
 *
 * **Only routes that exist are taught.** A room cannot be reported —
 * `reportRoom`, `report_room`, `reportedRoom` and `roomReport` return zero
 * matches across the app, the API and the dashboard — so no step mentions one.
 * A guide that sends somebody looking for a control that is not there, at the
 * end of an interaction that began with them struggling to report, is worse
 * than no guide. If SHY-0440 builds room reporting, this gains a step.
 *
 * **The illustrations are the app's own icons, not screenshots.** Screenshots
 * of four routes across 21 locales is 84 assets that go stale the first time a
 * screen changes, and an asset that fails to load leaves a gap. These are drawn
 * from the same `Icons` the real controls use, so they cannot drift from what
 * the person is looking at, carry no embedded text to translate, contain no
 * real person's name or picture by construction, and cannot fail to load. The
 * steps read correctly with the icons ignored entirely.
 *
 * **The escape hatch is visible from the start**, not gated behind reaching the
 * bottom. Somebody in distress must never feel walled off from help.
 */
@Composable
private fun ReportGuide(
    modifier: Modifier = Modifier,
    onContactSupportAnyway: () -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .testTag(TAG_SUPPORT_REPORT_GUIDE),
    ) {
        Text(
            stringResource(Res.string.report_guide_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(Res.string.report_guide_intro),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(20.dp))

        ReportGuideStep(1, Icons.Filled.Flag, Res.string.report_guide_step_profile)
        ReportGuideStep(2, Icons.Filled.Person, Res.string.report_guide_step_room_card)
        ReportGuideStep(3, Icons.AutoMirrored.Filled.Message, Res.string.report_guide_step_message)

        Spacer(Modifier.height(24.dp))

        // Set apart, and reachable without reading a word above it.
        Card {
            Column(modifier = Modifier.padding(16.dp)) {
                Text(
                    stringResource(Res.string.report_guide_stuck_title),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    stringResource(Res.string.report_guide_stuck_body),
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = onContactSupportAnyway,
                    modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_CONTACT_ANYWAY),
                ) {
                    Text(stringResource(Res.string.report_guide_stuck_action))
                }
            }
        }
    }
}

/**
 * One numbered step.
 *
 * The number carries real information here — these are three different places
 * to report from, and somebody works down them until one matches where they saw
 * it. The icon is decorative: `contentDescription` is null so a screen reader
 * reads the instruction once rather than announcing a flag before it.
 */
@Composable
private fun ReportGuideStep(
    number: Int,
    icon: ImageVector,
    text: StringResource,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            "$number.",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.width(24.dp),
        )
        Icon(
            icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(end = 12.dp).height(20.dp),
        )
        Text(stringResource(text), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun SentConfirmation(
    modifier: Modifier,
    addedToExisting: Boolean,
    onClose: () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Two different things happened and they need two different sentences.
        // Somebody who chose "it is the problem I already reported" and is then
        // told "we have your message" cannot tell where their words went.
        Text(
            stringResource(
                if (addedToExisting) Res.string.support_form_added else Res.string.support_form_sent,
            ),
            style = MaterialTheme.typography.bodyLarge,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onClose, modifier = Modifier.testTag(TAG_SUPPORT_BACK)) {
            Text(stringResource(Res.string.close))
        }
    }
}

/**
 * How many requests are open, as a sentence — SHY-0396.
 *
 * Two strings rather than one with a number in it for the singular: "You already
 * have 1 request open" reads as a machine talking. The project has no plural
 * resources, so this is the honest way to get a natural singular in 21
 * languages.
 */
@Composable
private fun openRequestsHeading(count: Int): String =
    if (count == 1) {
        stringResource(Res.string.support_open_requests_one)
    } else {
        stringResource(Res.string.support_open_requests_many, count)
    }

/**
 * What you already told us, shown before you start typing — SHY-0396.
 *
 * Information, not an obstacle: nothing here is a button and nothing here stops
 * a send. Somebody who reads it and still means to raise a separate problem
 * carries straight on, which is the whole point of the story.
 */
@Composable
private fun OpenRequestsNotice(
    total: Int,
    shown: List<OpenTicketSummary>,
    beyond: Int,
) {
    Card(modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_OPEN_NOTICE)) {
        Column(Modifier.padding(16.dp)) {
            Text(
                openRequestsHeading(total),
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
            for (ticket in shown) {
                Spacer(Modifier.height(8.dp))
                Text(
                    supportCategoryLabel(ticket.category),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(ticket.summary, style = MaterialTheme.typography.bodySmall)
            }
            // Counted, never silently dropped: telling somebody with five open
            // requests about two would be a smaller lie than the refusal this
            // story removed, but a lie all the same. The choice screen still
            // lists every one, because that is where they are chosen between.
            if (beyond > 0) {
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(Res.string.support_open_requests_more, beyond),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * "You already have a request open" — SHY-0396.
 *
 * The operator's correction, 2026-08-21: never refuse a second request. Somebody
 * with an open ticket may have a completely different problem, and refusing them
 * means the new problem reaches nobody.
 *
 * So this warns and then hands the decision back, with the three answers they
 * asked for — add it to the one that is open, raise a separate one, or go back —
 * and the reminder about why a duplicate is the slow option. The summaries are
 * the person's OWN words, which is what makes "is this the same problem?"
 * answerable at all.
 */
@Composable
private fun DuplicateChoice(
    modifier: Modifier,
    openTickets: List<OpenTicketSummary>,
    openRequestsTotal: Int,
    busy: Boolean,
    error: String?,
    onAddToOpen: (String) -> Unit,
    onNewProblem: () -> Unit,
    onGoBack: () -> Unit,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .testTag(TAG_SUPPORT_DUPLICATE),
    ) {
        Text(
            openRequestsHeading(openRequestsTotal),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            stringResource(Res.string.support_duplicate_reminder),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))

        Text(
            stringResource(Res.string.support_duplicate_same),
            style = MaterialTheme.typography.titleSmall,
        )
        Spacer(Modifier.height(8.dp))
        for (ticket in openTickets) {
            Card(
                onClick = { onAddToOpen(ticket.ticketId) },
                enabled = !busy,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .testTag("$TAG_SUPPORT_ADD_TO_OPEN${ticket.ticketId}"),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        supportCategoryLabel(ticket.category),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(ticket.summary, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onNewProblem,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_NEW_PROBLEM),
        ) {
            if (busy) {
                CircularProgressIndicator(modifier = Modifier.height(18.dp))
            } else {
                Text(stringResource(Res.string.support_duplicate_new))
            }
        }
        Spacer(Modifier.height(8.dp))
        TextButton(
            onClick = onGoBack,
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_DUPLICATE_BACK),
        ) {
            Text(stringResource(Res.string.support_duplicate_back))
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun CategoryPicker(
    selected: SupportCategory,
    enabled: Boolean,
    onSelect: (SupportCategory) -> Unit,
) {
    Text(stringResource(Res.string.support_category_label), style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(8.dp))
    Column(Modifier.selectableGroup()) {
        // Declaration order IS the order offered — the operator's approved set,
        // with the honest catch-all last.
        for (category in SupportCategory.entries) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = category == selected,
                            enabled = enabled,
                            role = Role.RadioButton,
                            onClick = { onSelect(category) },
                        ).testTag("$TAG_SUPPORT_CATEGORY${category.wireValue}"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = category == selected, onClick = null, enabled = enabled)
                Spacer(Modifier.height(0.dp))
                Text(supportCategoryLabel(category), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun Attachments(
    attachments: List<PendingAttachment>,
    isAttaching: Boolean,
    enabled: Boolean,
    onPicked: (String, AttachmentType, ByteArray, Long?) -> Unit,
    onUnsupported: () -> Unit,
    onRemove: (String) -> Unit,
) {
    Text(stringResource(Res.string.support_attachments_label), style = MaterialTheme.typography.titleSmall)
    // Stated BEFORE anybody picks. Learning a video was too long only after
    // choosing it — and on a phone connection, only after waiting for it —
    // is the frustration these limits are supposed to prevent, not cause.
    Text(
        stringResource(Res.string.support_attachment_limits),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag(TAG_SUPPORT_LIMITS),
    )
    Spacer(Modifier.height(8.dp))

    for (attachment in attachments) {
        Row(
            modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_ATTACHMENT),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(attachment.displayName, style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { onRemove(attachment.r2Key) }, enabled = enabled) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.support_attachment_remove))
            }
        }
    }

    PlatformMediaPicker(
        maxCount = MAX_ATTACHMENTS,
        onMediaSelected = { picked ->
            for (media in picked) {
                // Refused HERE rather than after the bytes have gone. The picker
                // can hand back a type the server will not take.
                val type = AttachmentType.fromContentType(media.contentType)
                if (type == null) {
                    onUnsupported()
                } else {
                    onPicked(media.displayName, type, media.bytes, media.durationMs)
                }
            }
        },
    ) { launchPicker ->
        OutlinedButton(
            onClick = launchPicker,
            enabled = enabled && !isAttaching && attachments.size < MAX_ATTACHMENTS,
            modifier = Modifier.testTag(TAG_SUPPORT_ADD_FILE),
        ) {
            if (isAttaching) {
                CircularProgressIndicator(modifier = Modifier.height(16.dp))
            } else {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text(stringResource(Res.string.support_attachment_add))
            }
        }
    }
}

/**
 * The label for a category, from resources.
 *
 * Never the enum name: that is the bug SHY-0390 records, where a sibling report
 * dialog rendered its reasons as raw English for every reader.
 */
@Composable
private fun supportCategoryLabel(category: SupportCategory): String =
    when (category) {
        SupportCategory.Account -> stringResource(Res.string.support_category_account)
        SupportCategory.Age -> stringResource(Res.string.support_category_age)
        SupportCategory.Payment -> stringResource(Res.string.support_category_payment)
        SupportCategory.Safety -> stringResource(Res.string.support_category_safety)
        SupportCategory.Bug -> stringResource(Res.string.support_category_bug)
        SupportCategory.Other -> stringResource(Res.string.support_category_other)
    }

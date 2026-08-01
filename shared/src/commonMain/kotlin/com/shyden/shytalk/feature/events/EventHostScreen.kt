package com.shyden.shytalk.feature.events

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.model.EventState
import com.shyden.shytalk.core.model.EventSummary
import com.shyden.shytalk.core.model.InviteStatus
import com.shyden.shytalk.core.model.ScheduledEvent
import org.koin.compose.viewmodel.koinViewModel

/**
 * The event host's home (SHY-0267, j16).
 *
 * Everything a host does to a show lives here: start it, see who answered,
 * rotate performers through the seat, watch what the night is making, and close
 * it. The corresponding API has existed for six phases with no screen — a write
 * path nobody could reach.
 *
 * TAGGED FOR THE JOURNEY CORPUS. Every control carries a testTag naming the
 * PERSON or the event it acts on (`eventHost_promote_<uniqueId>`), not a generic
 * one. j16 asserts "Tariq taps Promote Selma"; a shared tag would let that step
 * promote whoever happened to be first and report a pass.
 */
@Composable
fun EventHostScreen(
    onOpenRoom: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: EventHostViewModel = koinViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    // Starting an event navigates into its room. Consumed via `roomOpened()` so
    // a rotation does not re-open a room the host has already left.
    LaunchedEffect(state.roomToOpen) {
        state.roomToOpen?.let {
            onOpenRoom(it)
            viewModel.roomOpened()
        }
    }

    Column(
        modifier = modifier.fillMaxSize().testTag("eventHost_screen").padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = "Events",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.testTag("eventHost_title"),
        )

        state.error?.let { message ->
            // Shown, not swallowed. A promote that failed quietly leaves the host
            // tapping a name that never moves.
            Surface(
                color = MaterialTheme.colorScheme.errorContainer,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth().testTag("eventHost_error"),
            ) {
                Text(
                    text = message,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.padding(12.dp),
                )
            }
        }

        if (state.isLoading && state.hosting.isEmpty() && state.performing.isEmpty()) {
            CircularProgressIndicator(modifier = Modifier.testTag("eventHost_loading"))
            return@Column
        }

        val active = state.activeEvent
        if (active != null) {
            LivePanel(state = state, viewModel = viewModel)
            return@Column
        }

        if (state.hosting.isEmpty() && state.performing.isEmpty() && state.invites.isEmpty()) {
            // An empty state that SAYS it is empty. A blank screen is
            // indistinguishable from one that failed to load.
            Text(
                text = "You have no events scheduled.",
                modifier = Modifier.testTag("eventHost_emptyState"),
            )
        }

        LazyColumn(
            modifier = Modifier.fillMaxWidth().testTag("eventHost_list"),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.invites.isNotEmpty()) {
                item {
                    Text("Invitations", fontWeight = FontWeight.Bold)
                }
                items(state.invites, key = { it.eventId }) { invite ->
                    EventInviteRow(
                        invite = invite,
                        onAccept = { viewModel.accept(invite.eventId) },
                        onDecline = { viewModel.decline(invite.eventId) },
                        onOpenRoom = onOpenRoom,
                    )
                }
            }

            if (state.hosting.isNotEmpty()) {
                item { Text("Hosting", fontWeight = FontWeight.Bold) }
                items(state.hosting, key = { it.eventId }) { event ->
                    EventRow(
                        event = event,
                        // Only a host gets Start. A performer seeing a control
                        // they cannot use would get a 403 after the tap instead
                        // of never being offered it.
                        canStart = event.state == EventState.SCHEDULED,
                        onOpen = { viewModel.select(event.eventId) },
                        onStart = { viewModel.start(event.eventId) },
                    )
                }
            }

            if (state.performing.isNotEmpty()) {
                item { Text("Performing in", fontWeight = FontWeight.Bold) }
                items(state.performing, key = { it.eventId }) { event ->
                    EventRow(
                        event = event,
                        canStart = false,
                        onOpen = { event.roomId?.let(onOpenRoom) },
                        onStart = {},
                    )
                }
            }
        }
    }
}

@Composable
private fun EventRow(
    event: ScheduledEvent,
    canStart: Boolean,
    onOpen: () -> Unit,
    onStart: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
        // Per-event, so a scenario naming "Saturday Showcase" can find that row
        // rather than whichever row rendered first.
        modifier = Modifier.fillMaxWidth().testTag("eventHost_event_${event.eventId}"),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(event.title, fontWeight = FontWeight.Bold)
                Text(
                    text = "${event.startsAt} · ${event.state.name}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("eventHost_eventState_${event.eventId}"),
                )
            }
            OutlinedButton(
                onClick = onOpen,
                modifier = Modifier.testTag("eventHost_open_${event.eventId}"),
            ) {
                Text("Open")
            }
            if (canStart) {
                Button(
                    onClick = onStart,
                    modifier = Modifier.testTag("eventHost_startButton_${event.eventId}"),
                ) {
                    Text("Start event")
                }
            }
        }
    }
}

/**
 * The live panel: who is on the roster, who is on stage, what the night is
 * making, and the control that ends it.
 */
@Composable
private fun LivePanel(
    state: EventHostUiState,
    viewModel: EventHostViewModel,
) {
    val event = state.activeEvent ?: return

    Column(
        modifier = Modifier.fillMaxWidth().testTag("eventHost_livePanel"),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(event.title, style = MaterialTheme.typography.titleMedium)

        if (state.canStart) {
            Button(
                onClick = { viewModel.start(event.eventId) },
                modifier = Modifier.fillMaxWidth().testTag("eventHost_startButton"),
            ) {
                Text("Start event")
            }
        }

        Text("Roster", fontWeight = FontWeight.Bold)
        Column(
            modifier = Modifier.fillMaxWidth().testTag("eventHost_rosterPanel"),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            state.roster.forEach { member ->
                RosterRow(
                    member = member,
                    isLive = state.isLive,
                    onPromote = { viewModel.promote(member.uniqueId) },
                    onDemote = { viewModel.demote(member.uniqueId) },
                )
            }
        }

        state.summary?.let { EventTotals(it) }

        if (state.isLive) {
            OutlinedButton(
                onClick = { viewModel.close() },
                modifier = Modifier.fillMaxWidth().testTag("eventHost_endEventButton"),
            ) {
                Text("End event")
            }
        }

        state.closedSummary?.let { EventClosedSummary(summary = it, viewerId = viewModel.currentUserId) }
    }
}

@Composable
private fun RosterRow(
    member: RosterMember,
    isLive: Boolean,
    onPromote: () -> Unit,
    onDemote: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                // Per-member. j16 asserts "Selma listed as waiting", and a shared
                // tag would satisfy that with anyone's row.
                .testTag("eventHost_rosterMember_${member.uniqueId}")
                .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(member.uniqueId)
            Text(
                // The ANSWER, in words a host reads: waiting / accepted /
                // declined, plus "performing" for whoever is on stage. A name
                // with no answer is a person who might not turn up.
                text =
                    when {
                        member.isPerforming -> "performing"
                        member.status == InviteStatus.PENDING -> "waiting"
                        member.status == InviteStatus.ACCEPTED -> "accepted"
                        else -> "declined"
                    },
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("eventHost_rosterStatus_${member.uniqueId}"),
            )
        }
        if (isLive) {
            if (member.isPerforming) {
                OutlinedButton(
                    onClick = onDemote,
                    modifier = Modifier.testTag("eventHost_demote_${member.uniqueId}"),
                ) {
                    Text("Demote")
                }
            } else if (member.status == InviteStatus.ACCEPTED) {
                // Only someone who ACCEPTED can be promoted. Offering it for a
                // declined member invites a refusal the host cannot act on.
                Button(
                    onClick = onPromote,
                    modifier = Modifier.testTag("eventHost_promote_${member.uniqueId}"),
                ) {
                    Text("Promote")
                }
            }
        }
    }
}

/** Live event totals, as the host watches them move. */
@Composable
private fun EventTotals(summary: EventSummary) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().testTag("eventHost_totals"),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${summary.giftCount} gifts", modifier = Modifier.testTag("eventHost_giftCount"))
            Text("${summary.coinTotal} coins", modifier = Modifier.testTag("eventHost_coinTotal"))
            Text("${summary.beanTotal} beans", modifier = Modifier.testTag("eventHost_beanTotal"))
            summary.topContributorId?.let {
                Text(
                    "Top contributor: $it",
                    modifier = Modifier.testTag("eventHost_topContributor"),
                )
            }
        }
    }
}

/**
 * The closing recap, with the per-performer split.
 *
 * The viewer's OWN line is highlighted and tagged separately, because the
 * question a performer opens this screen to answer is "what did I earn", and
 * making them find their name in a list is a worse answer than showing it.
 */
@Composable
fun EventClosedSummary(
    summary: EventSummary,
    viewerId: String?,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier.fillMaxWidth().testTag("eventSummary_panel"),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Event closed", fontWeight = FontWeight.Bold)
            Text(
                "${summary.giftCount} gifts · ${summary.coinTotal} coins · ${summary.beanTotal} beans",
                modifier = Modifier.testTag("eventSummary_totals"),
            )

            summary.earningsFor(viewerId)?.let { mine ->
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = RoundedCornerShape(6.dp),
                    modifier = Modifier.fillMaxWidth().testTag("eventSummary_myEarnings"),
                ) {
                    Text(
                        "You earned ${mine.beanTotal} beans",
                        modifier = Modifier.padding(8.dp).testTag("eventSummary_myBeans"),
                    )
                }
            }

            Text("Per performer", fontWeight = FontWeight.Bold)
            summary.perPerformer.forEach { line ->
                Text(
                    "${line.uniqueId}: ${line.beanTotal} beans",
                    // Per performer, so a scenario asserting Selma's 255 cannot
                    // be satisfied by Theo's row.
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surface)
                            .testTag("eventSummary_performer_${line.uniqueId}"),
                )
            }
        }
    }
}

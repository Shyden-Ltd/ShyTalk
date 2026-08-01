package com.shyden.shytalk.feature.events

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.EventInvite
import com.shyden.shytalk.core.model.EventState

/**
 * "You are scheduled in Tariq's event" (SHY-0267, j16).
 *
 * The banner is a CALL TO ACTION, so it carries both answers. A notification
 * that only says "you were invited" leaves the performer hunting for the screen
 * where they can say yes, and leaves the host waiting on an answer that has no
 * button.
 *
 * Once the event is live it also carries the way in. j16: "Selma taps the
 * event-room link from the invite banner" — the moment the show starts, the
 * banner stops asking a question and starts being a door.
 */
@Composable
fun EventInviteBanner(
    invite: EventInvite,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onOpenRoom: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.tertiaryContainer,
        shape = RoundedCornerShape(8.dp),
        modifier =
            modifier
                .fillMaxWidth()
                // Per-event: a performer on two rosters gets two banners, and a
                // scenario accepting one must not be able to satisfy itself with
                // the other.
                .testTag("inviteBanner_${invite.eventId}"),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                // The host's NAME, not their id. The API sends it precisely so
                // this line can be rendered from one call.
                text = "You are scheduled in ${invite.hostName}'s event",
                fontWeight = FontWeight.Bold,
                modifier = Modifier.testTag("inviteBanner_text_${invite.eventId}"),
            )
            Text(
                text = "${invite.title} · ${invite.startsAt}",
                style = MaterialTheme.typography.bodySmall,
            )

            if (invite.state == EventState.LIVE && !invite.roomId.isNullOrBlank()) {
                TextButton(
                    onClick = { onOpenRoom(invite.roomId) },
                    modifier = Modifier.testTag("inviteBanner_eventRoomLink"),
                ) {
                    Text("Join the event room")
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = onAccept,
                    modifier = Modifier.testTag("inviteBanner_accept_${invite.eventId}"),
                ) {
                    Text("Accept")
                }
                OutlinedButton(
                    onClick = onDecline,
                    modifier = Modifier.testTag("inviteBanner_decline_${invite.eventId}"),
                ) {
                    Text("Decline")
                }
            }
        }
    }
}

/** The banner as it appears inside the events list. */
@Composable
internal fun EventInviteRow(
    invite: EventInvite,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onOpenRoom: (String) -> Unit,
) = EventInviteBanner(
    invite = invite,
    onAccept = onAccept,
    onDecline = onDecline,
    onOpenRoom = onOpenRoom,
)

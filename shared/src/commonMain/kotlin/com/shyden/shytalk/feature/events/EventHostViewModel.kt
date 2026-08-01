package com.shyden.shytalk.feature.events

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.EventInvite
import com.shyden.shytalk.core.model.EventState
import com.shyden.shytalk.core.model.EventSummary
import com.shyden.shytalk.core.model.InviteStatus
import com.shyden.shytalk.core.model.ScheduledEvent
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EventsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One row in the host's roster panel.
 *
 * Carries the ANSWER as well as the name, because "waiting" and "declined" are
 * the two facts a host actually needs before the doors open — a list of names
 * with no answers is a list of people who might not turn up.
 */
data class RosterMember(
    val uniqueId: String,
    val status: InviteStatus,
    val isPerforming: Boolean,
)

data class EventHostUiState(
    val isLoading: Boolean = true,
    val hosting: List<ScheduledEvent> = emptyList(),
    val performing: List<ScheduledEvent> = emptyList(),
    val invites: List<EventInvite> = emptyList(),
    /** The event whose live panel is open, if any. */
    val activeEvent: ScheduledEvent? = null,
    /** Live (or frozen, once closed) totals for [activeEvent]. */
    val summary: EventSummary? = null,
    /** Set once the host closes the event, so the panel can switch to the recap. */
    val closedSummary: EventSummary? = null,
    val error: String? = null,
    /** Set when starting an event succeeded, so the UI can open the room. */
    val roomToOpen: String? = null,
) {
    val roster: List<RosterMember>
        get() =
            activeEvent?.let { event ->
                event.roster.map { id ->
                    RosterMember(
                        uniqueId = id,
                        status = event.rosterStates[id] ?: InviteStatus.PENDING,
                        isPerforming = event.currentPerformerId == id,
                    )
                }
            } ?: emptyList()

    /** Can this event be started right now? */
    val canStart: Boolean
        get() = activeEvent?.state == EventState.SCHEDULED

    val isLive: Boolean
        get() = activeEvent?.state == EventState.LIVE
}

/**
 * The event host's screen state (SHY-0267, j16).
 *
 * REFRESH IS EXPLICIT, NOT A LISTENER. Everything here goes through the Express
 * API — there is no Firestore subscription — so the screen reloads after each
 * action rather than watching a document. That is slower than a live listener
 * and it is the rule: the API is the single place that decides who may do what,
 * and a client that subscribes to the database directly has gone around it.
 *
 * ERRORS ARE KEPT, NOT SWALLOWED. A promote that failed silently leaves the host
 * tapping a name that never moves, and no way to tell whether the tap registered.
 */
class EventHostViewModel(
    private val events: EventsRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(EventHostUiState())
    val uiState: StateFlow<EventHostUiState> = _uiState.asStateFlow()

    val currentUserId: String?
        get() = authRepository.currentUserId

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (val result = events.myEvents()) {
                is Resource.Success ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            hosting = result.data.hosting,
                            performing = result.data.performing,
                        )
                    }

                is Resource.Error -> failed(result.message)

                Resource.Loading -> Unit
            }
            loadInvites()
        }
    }

    private suspend fun loadInvites() {
        when (val result = events.pendingInvites()) {
            // An invite-load failure must NOT clear the events list that already
            // loaded — a half-failed refresh should lose the half that failed.
            is Resource.Success -> _uiState.update { it.copy(invites = result.data) }

            is Resource.Error -> logE("EventHost", "invites failed: ${result.message}")

            Resource.Loading -> Unit
        }
    }

    /** Open the live panel for one event. */
    fun select(eventId: String) {
        viewModelScope.launch {
            when (val result = events.event(eventId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(activeEvent = result.data, error = null) }
                    // Totals only exist once there is something to total, but the
                    // call is cheap and returns zeroes rather than failing.
                    loadSummary(eventId)
                }

                is Resource.Error -> failed(result.message)

                Resource.Loading -> Unit
            }
        }
    }

    private suspend fun loadSummary(eventId: String) {
        when (val result = events.summary(eventId)) {
            is Resource.Success -> _uiState.update { it.copy(summary = result.data) }

            // A host without a summary yet is normal; a host shown an error over
            // it would think the event was broken.
            is Resource.Error -> logE("EventHost", "summary failed: ${result.message}")

            Resource.Loading -> Unit
        }
    }

    fun start(eventId: String) {
        viewModelScope.launch {
            when (val result = events.start(eventId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(roomToOpen = result.data, error = null) }
                    select(eventId)
                    refresh()
                }

                is Resource.Error -> failed(result.message)

                Resource.Loading -> Unit
            }
        }
    }

    /** Acknowledge the room navigation so a rotation does not re-open it. */
    fun roomOpened() = _uiState.update { it.copy(roomToOpen = null) }

    fun promote(uniqueId: String) = seatChange(uniqueId, promote = true)

    fun demote(uniqueId: String) = seatChange(uniqueId, promote = false)

    private fun seatChange(
        uniqueId: String,
        promote: Boolean,
    ) {
        val eventId = _uiState.value.activeEvent?.eventId ?: return
        viewModelScope.launch {
            val result =
                if (promote) events.promote(eventId, uniqueId) else events.demote(eventId, uniqueId)
            when (result) {
                // Re-read rather than assume. A promote that the server refused
                // would otherwise leave the panel showing someone on stage who
                // is not, and the money follows the SERVER's answer.
                is Resource.Success -> select(eventId)

                is Resource.Error -> failed(result.message)

                Resource.Loading -> Unit
            }
        }
    }

    fun close() {
        val eventId = _uiState.value.activeEvent?.eventId ?: return
        viewModelScope.launch {
            when (val result = events.close(eventId)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(closedSummary = result.data, summary = result.data, error = null)
                    }
                    refresh()
                }

                is Resource.Error -> failed(result.message)

                Resource.Loading -> Unit
            }
        }
    }

    fun accept(eventId: String) = answerInvite(eventId, accept = true)

    fun decline(eventId: String) = answerInvite(eventId, accept = false)

    private fun answerInvite(
        eventId: String,
        accept: Boolean,
    ) {
        viewModelScope.launch {
            val result =
                if (accept) events.acceptInvite(eventId) else events.declineInvite(eventId)
            when (result) {
                is Resource.Success -> refresh()
                is Resource.Error -> failed(result.message)
                Resource.Loading -> Unit
            }
        }
    }

    fun schedule(
        title: String,
        startsAtIso: String,
        durationMin: Int,
        roster: List<String>,
    ) {
        viewModelScope.launch {
            when (val result = events.schedule(title, startsAtIso, durationMin, roster)) {
                is Resource.Success -> refresh()
                is Resource.Error -> failed(result.message)
                Resource.Loading -> Unit
            }
        }
    }

    fun dismissError() = _uiState.update { it.copy(error = null) }

    private fun failed(message: String) {
        logE("EventHost", message)
        _uiState.update { it.copy(isLoading = false, error = message) }
    }
}

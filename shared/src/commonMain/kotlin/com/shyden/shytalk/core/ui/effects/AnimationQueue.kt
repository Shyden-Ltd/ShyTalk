package com.shyden.shytalk.core.ui.effects

import com.shyden.shytalk.core.model.GiftEvent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AnimationQueue {
    private val queue = ArrayDeque<GiftEvent>()
    private val _currentEvent = MutableStateFlow<GiftEvent?>(null)
    val currentEvent: StateFlow<GiftEvent?> = _currentEvent.asStateFlow()

    fun enqueue(event: GiftEvent) {
        if (_currentEvent.value == null) {
            _currentEvent.value = event
        } else {
            queue.addLast(event)
        }
    }

    fun onAnimationFinished() {
        _currentEvent.value = if (queue.isNotEmpty()) queue.removeFirst() else null
    }
}

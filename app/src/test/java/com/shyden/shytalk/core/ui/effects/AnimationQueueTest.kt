package com.shyden.shytalk.core.ui.effects

import com.shyden.shytalk.core.model.GiftEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class AnimationQueueTest {
    private lateinit var queue: AnimationQueue

    private fun event(
        id: String = "gift",
        ts: Long = 0,
    ) = GiftEvent(
        giftId = id,
        giftName = id,
        timestamp = ts,
    )

    @Before
    fun setup() {
        queue = AnimationQueue()
    }

    @Test
    fun `initial currentEvent is null`() {
        assertNull(queue.currentEvent.value)
    }

    @Test
    fun `enqueue first event sets it as current`() {
        val e = event("rose")
        queue.enqueue(e)
        assertEquals(e, queue.currentEvent.value)
    }

    @Test
    fun `enqueue second event queues it without replacing current`() {
        val e1 = event("rose")
        val e2 = event("crown")
        queue.enqueue(e1)
        queue.enqueue(e2)
        assertEquals(e1, queue.currentEvent.value)
    }

    @Test
    fun `onAnimationFinished advances to next queued event`() {
        val e1 = event("rose")
        val e2 = event("crown")
        queue.enqueue(e1)
        queue.enqueue(e2)

        queue.onAnimationFinished()

        assertEquals(e2, queue.currentEvent.value)
    }

    @Test
    fun `onAnimationFinished clears current when queue is empty`() {
        val e = event("rose")
        queue.enqueue(e)

        queue.onAnimationFinished()

        assertNull(queue.currentEvent.value)
    }

    @Test
    fun `multiple events are processed in FIFO order`() {
        val e1 = event("rose", 1)
        val e2 = event("crown", 2)
        val e3 = event("dragon", 3)

        queue.enqueue(e1)
        queue.enqueue(e2)
        queue.enqueue(e3)

        assertEquals(e1, queue.currentEvent.value)

        queue.onAnimationFinished()
        assertEquals(e2, queue.currentEvent.value)

        queue.onAnimationFinished()
        assertEquals(e3, queue.currentEvent.value)

        queue.onAnimationFinished()
        assertNull(queue.currentEvent.value)
    }

    @Test
    fun `enqueue after drain starts new sequence`() {
        val e1 = event("rose")
        queue.enqueue(e1)
        queue.onAnimationFinished()
        assertNull(queue.currentEvent.value)

        val e2 = event("crown")
        queue.enqueue(e2)
        assertEquals(e2, queue.currentEvent.value)
    }

    @Test
    fun `onAnimationFinished on empty queue is safe`() {
        queue.onAnimationFinished()
        assertNull(queue.currentEvent.value)
    }
}

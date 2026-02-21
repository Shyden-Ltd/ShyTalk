package com.shyden.shytalk.data.repository

import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseReference
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class TypingRepositoryImplTest {

    private lateinit var database: FirebaseDatabase
    private lateinit var rootRef: DatabaseReference
    private lateinit var typingRef: DatabaseReference
    private lateinit var convRef: DatabaseReference
    private lateinit var userRef: DatabaseReference
    private lateinit var onDisconnectRef: com.google.firebase.database.OnDisconnect
    private lateinit var repo: TypingRepositoryImpl

    @Before
    fun setup() {
        database = mockk(relaxed = true)
        rootRef = mockk(relaxed = true)
        typingRef = mockk(relaxed = true)
        convRef = mockk(relaxed = true)
        userRef = mockk(relaxed = true)
        onDisconnectRef = mockk(relaxed = true)

        every { database.reference } returns rootRef
        every { rootRef.child("typing") } returns typingRef
        every { typingRef.child("conv-1") } returns convRef
        every { convRef.child("user-1") } returns userRef
        every { convRef.child("user-2") } returns userRef
        every { userRef.onDisconnect() } returns onDisconnectRef

        repo = TypingRepositoryImpl(database)
    }

    @Test
    fun `setTyping true sets value and registers onDisconnect`() {
        repo.setTyping("conv-1", "user-1", true)

        verify { userRef.setValue(true) }
        verify { userRef.onDisconnect() }
        verify { onDisconnectRef.removeValue() }
    }

    @Test
    fun `setTyping false removes value`() {
        repo.setTyping("conv-1", "user-1", false)

        verify { userRef.removeValue() }
        verify(exactly = 0) { userRef.setValue(any()) }
    }

    @Test
    fun `setTyping uses correct path`() {
        repo.setTyping("conv-1", "user-1", true)

        verify { rootRef.child("typing") }
        verify { typingRef.child("conv-1") }
        verify { convRef.child("user-1") }
    }

    @Test
    fun `observeTyping emits true when snapshot has true`() = runTest(UnconfinedTestDispatcher()) {
        val listenerSlot = slot<ValueEventListener>()
        every { userRef.addValueEventListener(capture(listenerSlot)) } returns mockk()

        var result = false
        val job = launch {
            result = repo.observeTyping("conv-1", "user-2").first()
        }

        // Simulate the callback
        val snapshot = mockk<DataSnapshot>()
        every { snapshot.getValue(Boolean::class.java) } returns true
        listenerSlot.captured.onDataChange(snapshot)

        assertTrue(result)
        job.cancel()
    }

    @Test
    fun `observeTyping emits false when snapshot is null`() = runTest(UnconfinedTestDispatcher()) {
        val listenerSlot = slot<ValueEventListener>()
        every { userRef.addValueEventListener(capture(listenerSlot)) } returns mockk()

        var result = true
        val job = launch {
            result = repo.observeTyping("conv-1", "user-2").first()
        }

        val snapshot = mockk<DataSnapshot>()
        every { snapshot.getValue(Boolean::class.java) } returns null
        listenerSlot.captured.onDataChange(snapshot)

        assertFalse(result)
        job.cancel()
    }
}

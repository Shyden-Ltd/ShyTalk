package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.EventListener
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Transaction
import com.google.firebase.firestore.WriteBatch
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.CapturingSlot
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PrivateMessageRepositoryImplTest {
    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: PrivateMessageRepositoryImpl
    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockCollRef: CollectionReference
    private lateinit var mockDocSnapshot: DocumentSnapshot
    private lateinit var mockBatch: WriteBatch

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        mockDocSnapshot = mockk(relaxed = true)
        mockBatch = mockk(relaxed = true)

        // Firestore path resolution
        every { firestore.document(any()) } returns mockDocRef
        every { firestore.collection(any()) } returns mockCollRef
        every { mockCollRef.document() } returns mockDocRef
        every { mockCollRef.document(any<String>()) } returns mockDocRef
        every { mockDocRef.id } returns "test-id"
        every { mockDocRef.collection(any()) } returns mockCollRef

        // Task-returning operations
        every { mockDocRef.set(any()) } returns Tasks.forResult(null)
        every { mockDocRef.set(any(), any<SetOptions>()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forResult(null)
        every { mockDocRef.delete() } returns Tasks.forResult(null)
        every { mockDocRef.get() } returns Tasks.forResult(mockDocSnapshot)
        every { mockCollRef.add(any()) } returns Tasks.forResult(mockDocRef)

        // DocumentSnapshot defaults
        every { mockDocSnapshot.exists() } returns false
        every { mockDocSnapshot.data } returns mapOf("text" to "old text")
        every { mockDocSnapshot.getString(any()) } returns "old text"

        // Batch operations
        every { firestore.batch() } returns mockBatch
        every { mockBatch.commit() } returns Tasks.forResult(null)

        // Transaction support (toggleReaction uses runTransaction)
        val mockTransaction = mockk<Transaction>(relaxed = true)
        every { mockTransaction.get(any()) } returns mockDocSnapshot
        every { mockTransaction.update(any(), any<String>(), any()) } returns mockTransaction
        every { firestore.runTransaction<Unit>(any()) } answers {
            val fn = firstArg<Transaction.Function<Unit>>()
            fn.apply(mockTransaction)
            Tasks.forResult(null)
        }

        val authRepository =
            mockk<AuthRepository> {
                every { currentUserId } returns "10000001"
            }
        repo = PrivateMessageRepositoryImpl(api, firestore, authRepository)
    }

    // region getOrCreateConversation — direct Firestore

    @Test
    fun `getOrCreateConversation returns Success when creating new`() =
        runTest {
            val result = repo.getOrCreateConversation("10000001", "10000002")
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `getOrCreateConversation returns Success when existing`() =
        runTest {
            every { mockDocSnapshot.exists() } returns true
            every { mockDocSnapshot.data } returns
                mapOf(
                    "participantIds" to listOf(10000001L, 10000002L),
                    "isGroup" to false,
                    "createdAt" to 1700000000000L,
                    "lastMessageAt" to 1700000000000L,
                    "isClosed" to false,
                )

            val result = repo.getOrCreateConversation("10000001", "10000002")
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `getOrCreateConversation stores participantIds as String values`() =
        runTest {
            val dataSlot = slot<Map<String, Any>>()
            every { mockDocRef.set(capture(dataSlot)) } returns Tasks.forResult(null)

            val result = repo.getOrCreateConversation("10000001", "10000002")
            assertTrue(result is Resource.Success)

            val participantIds = dataSlot.captured["participantIds"] as List<*>
            // SHY-0130 — participantIds MUST be Strings: the canonical type the
            // rule (`string(callerUniqueId()) in resource.data.participantIds`),
            // the model (`List<String>`), iOS, and Express (`.map(String)`) all
            // use. This test previously asserted Longs — it ENCODED the bug that
            // made Android-created threads unreadable by the string gate.
            assertTrue("participantIds[0] should be String", participantIds[0] is String)
            assertTrue("participantIds[1] should be String", participantIds[1] is String)
            assertEquals(listOf("10000001", "10000002"), participantIds)
        }

    @Test
    fun `getOrCreateConversation returns Error on exception`() =
        runTest {
            every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

            val result = repo.getOrCreateConversation("uid1", "uid2")
            assertTrue(result is Resource.Error)
        }

    @Test
    fun `getOrCreateConversation stores participantIds sorted regardless of argument order`() =
        runTest {
            // SHY-0130 — the stored `participantIds` must be the canonical SORTED
            // string list so all three platforms agree on the shape; passing the
            // ids in reverse must still produce ["10000001", "10000002"]. Guards a
            // regression that drops `.sorted()` (which the existing test, using
            // already-ordered args, would not catch). Identity is keyed off
            // Conversation.generateId, so order never affects dedup — this pins the
            // stored-array invariant only.
            val dataSlot = slot<Map<String, Any>>()
            every { mockDocRef.set(capture(dataSlot)) } returns Tasks.forResult(null)

            val result = repo.getOrCreateConversation("10000002", "10000001")
            assertTrue(result is Resource.Success)

            assertEquals(listOf("10000001", "10000002"), dataSlot.captured["participantIds"])
        }

    // endregion

    // region getConversations / prefetchConversations — SHY-0130 id-type + I3 observability

    /**
     * Wires `collection("conversations").whereArrayContains("participantIds", <captured>)
     * .orderBy(...)` to a fresh relaxed Query, capturing the array-contains value into
     * [uidSlot] so a test can assert it is a STRING (SHY-0130: never a Long).
     */
    private fun wireConversationsQuery(uidSlot: CapturingSlot<Any>): Query {
        val mockQuery = mockk<Query>(relaxed = true)
        every { mockCollRef.whereArrayContains(any<String>(), capture(uidSlot)) } returns mockQuery
        every { mockQuery.orderBy(any<String>(), any<Query.Direction>()) } returns mockQuery
        return mockQuery
    }

    /** A QuerySnapshot whose single document maps to a Conversation with [id]. */
    private fun singleConversationSnapshot(id: String): QuerySnapshot {
        val doc = mockk<DocumentSnapshot>(relaxed = true)
        every { doc.id } returns id
        every { doc.data } returns
            mapOf(
                "participantIds" to listOf("10000001", "10000002"),
                "isGroup" to false,
                "createdAt" to 1_000L,
                "lastMessageAt" to 2_000L,
                "isClosed" to false,
            )
        val snap = mockk<QuerySnapshot>(relaxed = true)
        every { snap.documents } returns listOf(doc)
        return snap
    }

    @Test
    fun `prefetchConversations does not query Firestore when currentUserId is null`() =
        runTest {
            val nullAuth = mockk<AuthRepository> { every { currentUserId } returns null }
            val repoNoUser = PrivateMessageRepositoryImpl(api, firestore, nullAuth)

            repoNoUser.prefetchConversations()

            io.mockk.verify(exactly = 0) { firestore.collection("conversations") }
        }

    @Test
    fun `prefetchConversations queries participantIds with a String uid`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            val emptySnap = mockk<QuerySnapshot>(relaxed = true)
            every { emptySnap.documents } returns emptyList()
            every { mockQuery.get() } returns Tasks.forResult(emptySnap)

            repo.prefetchConversations()

            // SHY-0130 — the bug coerced this to a Long via toLongOrNull().
            assertTrue("array-contains value must be a String", uidSlot.captured is String)
            assertEquals("10000001", uidSlot.captured)
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `prefetchConversations populates the cache which getConversations replays first`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            every { mockQuery.get() } returns Tasks.forResult(singleConversationSnapshot("conv-pref"))
            // getConversations registers a listener we never fire — the replayed
            // prefetch is the first (and only) emission collected.
            every { mockQuery.addSnapshotListener(any<EventListener<QuerySnapshot>>()) } returns
                mockk<ListenerRegistration>(relaxed = true)

            repo.prefetchConversations()

            var emitted: List<*>? = null
            val job =
                launch {
                    repo.getConversations("10000001").first {
                        emitted = it
                        true
                    }
                }
            advanceUntilIdle()

            assertEquals(1, emitted?.size)
            assertEquals("conv-pref", (emitted?.get(0) as Conversation).conversationId)
            job.cancel()
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `prefetchConversations swallows a Firestore exception and leaves the cache null`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            every { mockQuery.get() } returns Tasks.forException(RuntimeException("denied"))
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns
                mockk<ListenerRegistration>(relaxed = true)

            // Must not throw — the catch logs and leaves the cache null.
            repo.prefetchConversations()

            var emitted: List<*>? = null
            val job =
                launch {
                    repo.getConversations("10000001").first {
                        emitted = it
                        true
                    }
                }
            advanceUntilIdle()
            // No stale replay: the first emission is the LIVE listener's, proving the
            // failed prefetch left prefetchedConversations null.
            listenerSlot.captured.onEvent(singleConversationSnapshot("live-1"), null)
            advanceUntilIdle()
            assertEquals("live-1", (emitted?.get(0) as Conversation).conversationId)
            job.cancel()
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `getConversations propagates a listener error via close`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns
                mockk<ListenerRegistration>(relaxed = true)

            var caught: Throwable? = null
            val job =
                launch {
                    try {
                        repo.getConversations("10000001").first { false }
                    } catch (e: Throwable) {
                        caught = e
                    }
                }
            advanceUntilIdle()

            val error = mockk<FirebaseFirestoreException>(relaxed = true)
            every { error.message } returns "PERMISSION_DENIED"
            listenerSlot.captured.onEvent(null, error)
            advanceUntilIdle()

            // SHY-0130 I3 — a denied listen surfaces to the collector (was silently
            // swallowed as empty), and the String uid reached the query.
            assertTrue("error should propagate to the collector", caught is FirebaseFirestoreException)
            assertTrue("array-contains value must be a String", uidSlot.captured is String)
            job.cancel()
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `getConversations removes the listener after an error close`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            val registration = mockk<ListenerRegistration>(relaxed = true)
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns registration

            val job =
                launch {
                    try {
                        repo.getConversations("10000001").first { false }
                    } catch (_: Throwable) {
                    }
                }
            advanceUntilIdle()
            listenerSlot.captured.onEvent(null, mockk<FirebaseFirestoreException>(relaxed = true))
            advanceUntilIdle()

            // awaitClose cleanup still runs when the flow is closed via close(error).
            io.mockk.verify { registration.remove() }
            job.cancel()
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `getConversations ignores a null snapshot and keeps listening`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns
                mockk<ListenerRegistration>(relaxed = true)

            var emitted: List<*>? = null
            val job =
                launch {
                    repo.getConversations("10000001").first {
                        emitted = it
                        true
                    }
                }
            advanceUntilIdle()

            // A null snapshot with no error must NOT emit and must NOT crash; the flow
            // keeps listening and the next real snapshot is the first emission.
            listenerSlot.captured.onEvent(null, null)
            advanceUntilIdle()
            assertEquals("null snapshot must not emit", null, emitted)

            listenerSlot.captured.onEvent(singleConversationSnapshot("after-null"), null)
            advanceUntilIdle()
            assertEquals("after-null", (emitted?.get(0) as Conversation).conversationId)
            job.cancel()
        }

    @Test
    @OptIn(ExperimentalCoroutinesApi::class)
    fun `getConversations queries participantIds with a String uid and maps documents`() =
        runTest {
            val uidSlot = slot<Any>()
            val mockQuery = wireConversationsQuery(uidSlot)
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns
                mockk<ListenerRegistration>(relaxed = true)

            var emitted: List<*>? = null
            val job =
                launch {
                    repo.getConversations("10000001").first {
                        emitted = it
                        true
                    }
                }
            advanceUntilIdle()
            listenerSlot.captured.onEvent(singleConversationSnapshot("conv-live"), null)
            advanceUntilIdle()

            assertTrue("array-contains value must be a String", uidSlot.captured is String)
            assertEquals(1, emitted?.size)
            assertEquals("conv-live", (emitted?.get(0) as Conversation).conversationId)
            job.cancel()
        }

    // endregion

    // region sendTextMessage — Worker API (needs FCM push)

    @Test
    fun `sendTextMessage returns Success`() =
        runTest {
            coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns
                JSONObject().apply {
                    put("id", "msg-1")
                }

            val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `sendTextMessage returns Error on exception`() =
        runTest {
            coEvery { api.post("/api/conversations/conv-1/messages", any()) } throws RuntimeException("Fail")

            val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")
            assertTrue(result is Resource.Error)
        }

    // endregion

    // region sendImageMessage — Worker API

    @Test
    fun `sendImageMessage returns Success`() =
        runTest {
            coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns
                JSONObject().apply {
                    put("id", "msg-2")
                }

            val result =
                repo.sendImageMessage(
                    "conv-1",
                    "user-1",
                    "Alice",
                    listOf("https://img.example.com/1.jpg"),
                )
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region sendStickerMessage — Worker API

    @Test
    fun `sendStickerMessage returns Success`() =
        runTest {
            coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns
                JSONObject().apply {
                    put("id", "msg-sticker")
                }

            val result = repo.sendStickerMessage("conv-1", "user-1", "Alice", "https://sticker.url")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region sendRoomInviteMessage — Worker API

    @Test
    fun `sendRoomInviteMessage returns Success`() =
        runTest {
            coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns
                JSONObject().apply {
                    put("id", "msg-invite")
                }

            val result = repo.sendRoomInviteMessage("conv-1", "user-1", "Alice", "room-1", "Fun Room")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region editMessage — direct Firestore

    @Test
    fun `editMessage returns Success`() =
        runTest {
            val result = repo.editMessage("conv-1", "msg-1", "Updated text")
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `editMessage returns Error on exception`() =
        runTest {
            every { mockBatch.commit() } returns Tasks.forException(RuntimeException("Fail"))

            val result = repo.editMessage("conv-1", "msg-1", "Updated text")
            assertTrue(result is Resource.Error)

            // Restore default for subsequent tests
            every { mockBatch.commit() } returns Tasks.forResult(null)
        }

    // endregion

    // region markAsRead — direct Firestore

    @Test
    fun `markAsRead returns Success`() =
        runTest {
            val result = repo.markAsRead("conv-1", "user-1", "msg-5")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region resetUnreadCount — direct Firestore

    @Test
    fun `resetUnreadCount returns Success`() =
        runTest {
            val result = repo.resetUnreadCount("conv-1", "user-1")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region muteConversation — direct Firestore

    @Test
    fun `muteConversation returns Success`() =
        runTest {
            val result = repo.muteConversation("conv-1", "user-1", true)
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region pinConversation — direct Firestore

    @Test
    fun `pinConversation returns Success`() =
        runTest {
            val result = repo.pinConversation("conv-1", "user-1", true)
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region hideConversation — direct Firestore

    @Test
    fun `hideConversation returns Success`() =
        runTest {
            val result = repo.hideConversation("conv-1", "user-1")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region toggleReaction — direct Firestore

    @Test
    fun `toggleReaction returns Success`() =
        runTest {
            val result = repo.toggleReaction("conv-1", "msg-1", "\u2764\uFE0F", "user-1")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region recallMessage — direct Firestore

    @Test
    fun `recallMessage returns Success`() =
        runTest {
            val result = repo.recallMessage("conv-1", "msg-1")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region getMessages — real-time listener error handling

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `getMessages emits empty list and logs when listener receives error`() =
        runTest {
            val mockQuery = mockk<Query>(relaxed = true)
            val listenerSlot = slot<EventListener<QuerySnapshot>>()
            val mockRegistration = mockk<ListenerRegistration>(relaxed = true)

            every { firestore.collection("conversations/conv-1/messages") } returns mockCollRef
            every { mockCollRef.orderBy(any<String>(), any()) } returns mockQuery
            every { mockQuery.limitToLast(any()) } returns mockQuery
            every { mockQuery.addSnapshotListener(capture(listenerSlot)) } returns mockRegistration

            var emittedMessages: List<*>? = null
            val job =
                launch {
                    repo.getMessages("conv-1", 50).first { messages ->
                        emittedMessages = messages
                        true
                    }
                }

            // Let the callbackFlow start and register the snapshot listener
            advanceUntilIdle()

            // Simulate a PERMISSION_DENIED error from Firestore
            val error = mockk<FirebaseFirestoreException>(relaxed = true)
            every { error.message } returns "PERMISSION_DENIED"
            listenerSlot.captured.onEvent(null, error)

            advanceUntilIdle()

            // Should emit empty list instead of silently swallowing
            assertEquals(emptyList<Any>(), emittedMessages)
            job.cancel()
        }

    // endregion

    // region hideMessage — direct Firestore

    @Test
    fun `hideMessage returns Success`() =
        runTest {
            val result = repo.hideMessage("conv-1", "msg-1", "admin-1")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region createGroupConversation — direct Firestore

    @Test
    fun `createGroupConversation returns Success`() =
        runTest {
            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "adult",
                    participantIds = listOf("user-2", "user-3"),
                    groupName = "Test Group",
                )
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `createGroupConversation initial create writes participantIds with only creatorId (UK OSA PR 8 size-1 rule)`() =
        runTest {
            // Defensive pin on the load-bearing security invariant:
            // the initial doc.set() at create-time MUST NOT bulk-seed
            // additional participants. The firestore.rules layer
            // requires participantIds.size() == 1 on group create.
            // Captures the data map passed to set() and asserts the
            // size-1 invariant on the load-bearing field.
            val capturedData = slot<Map<String, Any?>>()
            every { mockDocRef.set(capture(capturedData)) } returns Tasks.forResult(null)

            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "adult",
                    participantIds = listOf("user-2", "user-3"),
                    groupName = "Test Group",
                )
            assertTrue(result is Resource.Success)

            @Suppress("UNCHECKED_CAST")
            val initialParticipants = capturedData.captured["participantIds"] as List<String>
            assertEquals(1, initialParticipants.size)
            assertEquals("user-1", initialParticipants[0])
        }

    @Test
    fun `createGroupConversation stamps cohort field on the doc (UK OSA PR 8 rules bind)`() =
        runTest {
            // firestore.rules requires the stamped cohort to match
            // the caller's JWT claim. A regression that omits the
            // field would fail the rule on the real backend.
            val capturedData = slot<Map<String, Any?>>()
            every { mockDocRef.set(capture(capturedData)) } returns Tasks.forResult(null)

            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "minor",
                    participantIds = listOf("user-2"),
                    groupName = "Cohort-stamped",
                )
            assertTrue(result is Resource.Success)
            assertEquals("minor", capturedData.captured["cohort"])
        }

    @Test
    fun `createGroupConversation calls update once per extra participant (one-at-a-time growth)`() =
        runTest {
            // Mirrors the rules' one-at-a-time per-add invariant: the
            // impl must NOT bulk-add via a single doc.set. Each extra
            // participant gets its own update + arrayUnion so the
            // per-add cohort `get()` in firestore.rules fires per id.
            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "adult",
                    participantIds = listOf("user-2", "user-3", "user-4"),
                    groupName = "Multi-add",
                )
            assertTrue(result is Resource.Success)

            io.mockk.verify(exactly = 3) {
                mockDocRef.update("participantIds", any())
            }
        }

    @Test
    fun `createGroupConversation per-participant add failure does not abort the call`() =
        runTest {
            // Partial-group is more useful than aborted-group: a
            // failed add for one member leaves an orphaned single-
            // member group the creator can re-add to. This is a
            // deliberate UX trade-off documented in the impl.
            every { mockDocRef.update("participantIds", any()) } returns
                Tasks.forException(RuntimeException("transient firestore error"))

            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "adult",
                    participantIds = listOf("user-2"),
                    groupName = "Partial-add",
                )
            // Despite the update failure, the create as a whole
            // succeeds — the initial doc.set is the load-bearing op.
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `createGroupConversation deduplicates creator from the extra-participants loop`() =
        runTest {
            // If the caller mistakenly includes the creator's id in
            // the participantIds list (common UX shape: ViewModel
            // passes the full member list), the loop must skip the
            // creator (already added at create time). Otherwise the
            // initial doc.set's [creator] + arrayUnion(creator) is a
            // no-op write that wastes a Firestore quota slot.
            val result =
                repo.createGroupConversation(
                    creatorId = "user-1",
                    cohort = "adult",
                    participantIds = listOf("user-1", "user-2"),
                    groupName = "Dedup-creator",
                )
            assertTrue(result is Resource.Success)
            // Only user-2 should trigger an update (user-1 dedup'd).
            io.mockk.verify(exactly = 1) {
                mockDocRef.update("participantIds", any())
            }
        }

    // endregion

    // region addGroupParticipant — direct Firestore

    @Test
    fun `addGroupParticipant returns Success`() =
        runTest {
            val result = repo.addGroupParticipant("conv-1", "user-new")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region removeGroupParticipant — direct Firestore

    @Test
    fun `removeGroupParticipant returns Success`() =
        runTest {
            val result = repo.removeGroupParticipant("conv-1", "user-old")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region updateGroupName — direct Firestore

    @Test
    fun `updateGroupName returns Success`() =
        runTest {
            val result = repo.updateGroupName("conv-1", "New Name")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region closeGroupConversation — direct Firestore

    @Test
    fun `closeGroupConversation returns Success`() =
        runTest {
            val result = repo.closeGroupConversation("conv-1")
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `closeGroupConversation returns Error on exception`() =
        runTest {
            every { mockDocRef.update(any<String>(), any()) } returns Tasks.forException(RuntimeException("Fail"))

            val result = repo.closeGroupConversation("conv-1")
            assertTrue(result is Resource.Error)
        }

    // endregion

    // region muteGroupMember — direct Firestore

    @Test
    fun `muteGroupMember returns Success`() =
        runTest {
            val result = repo.muteGroupMember("conv-1", "user-bad", 3600000L, "Spamming")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region unmuteGroupMember — direct Firestore

    @Test
    fun `unmuteGroupMember returns Success`() =
        runTest {
            val result = repo.unmuteGroupMember("conv-1", "user-bad")
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region updateGroupRoles — direct Firestore

    @Test
    fun `updateGroupRoles returns Success`() =
        runTest {
            val result = repo.updateGroupRoles("conv-1", listOf("admin-1"), listOf("mod-1"))
            assertTrue(result is Resource.Success)
        }

    // endregion

    // region transferOwnership — direct Firestore

    @Test
    fun `transferOwnership returns Success`() =
        runTest {
            val result = repo.transferOwnership("conv-1", "new-owner")
            assertTrue(result is Resource.Success)
        }

    // endregion
}

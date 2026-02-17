package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.currentTimeMillis
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.UUID

class SeatRequestRepositoryImpl(
    private val firestore: FirebaseFirestore
) : SeatRequestRepository {

    private fun requestsCollection(roomId: String) =
        firestore.collection("rooms").document(roomId).collection("seatRequests")

    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> = callbackFlow {
        val listener = requestsCollection(roomId)
            .whereEqualTo("status", SeatRequestStatus.PENDING.name)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val requests = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { SeatRequest.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(requests)
            }
        awaitClose { listener.remove() }
    }

    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int
    ): Resource<Unit> = firebaseCall("Failed to create seat request") {
        // Check if user already has a pending request
        val existing = requestsCollection(roomId)
            .whereEqualTo("userId", userId)
            .whereEqualTo("status", SeatRequestStatus.PENDING.name)
            .limit(1)
            .get()
            .await()
        if (!existing.isEmpty) {
            // Refresh the stale request so snapshot listeners re-fire for observers
            existing.documents.first().reference.update(
                mapOf(
                    "seatIndex" to seatIndex,
                    "userName" to userName,
                    "createdAt" to Timestamp.now()
                )
            ).await()
            return@firebaseCall
        }

        val requestId = UUID.randomUUID().toString()
        val request = SeatRequest(
            requestId = requestId,
            userId = userId,
            userName = userName,
            seatIndex = seatIndex,
            status = SeatRequestStatus.PENDING,
            createdAt = currentTimeMillis()
        )
        requestsCollection(roomId).document(requestId).set(request.toMap()).await()
    }

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<SeatRequest> = firebaseCall("Failed to approve request") {
        val docRef = requestsCollection(roomId).document(requestId)
        val resolvedAt = Timestamp.now()
        // Read + update in a single transaction (eliminates separate read-after-write)
        firestore.runTransaction { transaction ->
            val snapshot = transaction.get(docRef)
            val data = snapshot.data ?: throw Exception("Request not found")
            transaction.update(docRef, mapOf(
                "status" to SeatRequestStatus.APPROVED.name,
                "resolvedBy" to resolvedBy,
                "resolvedAt" to resolvedAt
            ))
            SeatRequest.fromMap(
                data + mapOf(
                    "status" to SeatRequestStatus.APPROVED.name,
                    "resolvedBy" to resolvedBy,
                    "resolvedAt" to resolvedAt
                ),
                snapshot.id
            )
        }.await()
    }

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<Unit> = firebaseCall("Failed to deny request") {
        requestsCollection(roomId).document(requestId).update(
            mapOf(
                "status" to SeatRequestStatus.DENIED.name,
                "resolvedBy" to resolvedBy,
                "resolvedAt" to Timestamp.now()
            )
        ).await()
    }

    override fun getRequestsByUser(roomId: String, userId: String): Flow<List<SeatRequest>> = callbackFlow {
        val listener = requestsCollection(roomId)
            .whereEqualTo("userId", userId)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val requests = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { SeatRequest.fromMap(it, doc.id) }
                }?.filter {
                    it.status == SeatRequestStatus.PENDING || it.status == SeatRequestStatus.APPROVED
                } ?: emptyList()
                trySend(requests)
            }
        awaitClose { listener.remove() }
    }

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to cancel approved request") {
        requestsCollection(roomId).document(requestId).update(
            mapOf(
                "status" to SeatRequestStatus.DENIED.name,
                "resolvedBy" to userId,
                "resolvedAt" to Timestamp.now()
            )
        ).await()
    }
}

package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.util.Resource
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject

class SeatRequestRepositoryImpl @Inject constructor(
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
    ): Resource<Unit> {
        return try {
            // Check if user already has a pending request
            val existing = requestsCollection(roomId)
                .whereEqualTo("userId", userId)
                .whereEqualTo("status", SeatRequestStatus.PENDING.name)
                .get()
                .await()
            if (!existing.isEmpty) return Resource.Success(Unit)

            val requestId = UUID.randomUUID().toString()
            val request = SeatRequest(
                requestId = requestId,
                userId = userId,
                userName = userName,
                seatIndex = seatIndex,
                status = SeatRequestStatus.PENDING,
                createdAt = Timestamp.now()
            )
            requestsCollection(roomId).document(requestId).set(request.toMap()).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to create seat request", e)
        }
    }

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<SeatRequest> {
        return try {
            val docRef = requestsCollection(roomId).document(requestId)
            docRef.update(
                mapOf(
                    "status" to SeatRequestStatus.APPROVED.name,
                    "resolvedBy" to resolvedBy,
                    "resolvedAt" to Timestamp.now()
                )
            ).await()
            val doc = docRef.get().await()
            val request = doc.data?.let { SeatRequest.fromMap(it, doc.id) }
                ?: return Resource.Error("Request not found")
            Resource.Success(request)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to approve request", e)
        }
    }

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String
    ): Resource<Unit> {
        return try {
            requestsCollection(roomId).document(requestId).update(
                mapOf(
                    "status" to SeatRequestStatus.DENIED.name,
                    "resolvedBy" to resolvedBy,
                    "resolvedAt" to Timestamp.now()
                )
            ).await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to deny request", e)
        }
    }
}

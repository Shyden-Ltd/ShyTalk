package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

class SeatRequestRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
) : SeatRequestRepository {
    // Real-time pending seat requests from Firestore
    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> =
        callbackFlow {
            val listener =
                firestore
                    .collection("rooms/$roomId/seatRequests")
                    .whereEqualTo("status", "PENDING")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val requests =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                SeatRequest.fromMap(data, doc.id)
                            }
                        trySend(requests)
                    }
            awaitClose { listener.remove() }
        }

    // Real-time seat requests by user from Firestore
    override fun getRequestsByUser(
        roomId: String,
        userId: String,
    ): Flow<List<SeatRequest>> =
        callbackFlow {
            val listener =
                firestore
                    .collection("rooms/$roomId/seatRequests")
                    .whereEqualTo("userId", userId)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val requests =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                SeatRequest.fromMap(data, doc.id)
                            }
                        trySend(requests)
                    }
            awaitClose { listener.remove() }
        }

    // Worker API — needs FCM push to room owner
    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to create seat request") {
            val body =
                JSONObject().apply {
                    put("userName", userName)
                    put("seatIndex", seatIndex)
                }
            api.post("/api/rooms/$roomId/seat-requests", body)
        }

    // Direct Firestore write — no push needed for approve/deny/cancel
    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<SeatRequest> =
        firebaseCall("Failed to approve request") {
            val timestamp = System.currentTimeMillis()
            firestore
                .document("rooms/$roomId/seatRequests/$requestId")
                .update(
                    mapOf(
                        "status" to "APPROVED",
                        "resolvedBy" to resolvedBy,
                        "resolvedAt" to timestamp,
                    ),
                ).await()

            val doc = firestore.document("rooms/$roomId/seatRequests/$requestId").get().await()
            val data = doc.data ?: throw Exception("Request not found")
            SeatRequest.fromMap(data, requestId)
        }

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to deny request") {
            firestore
                .document("rooms/$roomId/seatRequests/$requestId")
                .update(
                    mapOf(
                        "status" to "DENIED",
                        "resolvedBy" to resolvedBy,
                        "resolvedAt" to System.currentTimeMillis(),
                    ),
                ).await()
        }

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to cancel approved request") {
            firestore
                .document("rooms/$roomId/seatRequests/$requestId")
                .update(
                    mapOf(
                        "status" to "CANCELLED",
                        "resolvedAt" to System.currentTimeMillis(),
                    ),
                ).await()
        }
}

package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

class IosSeatRequestRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
) : SeatRequestRepository {
    override fun getPendingRequests(roomId: String): Flow<List<SeatRequest>> =
        firestore
            .collection("rooms/$roomId/seatRequests")
            .where { "status" equalTo "PENDING" }
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        SeatRequest.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

    override fun getRequestsByUser(
        roomId: String,
        userId: String,
    ): Flow<List<SeatRequest>> =
        firestore
            .collection("rooms/$roomId/seatRequests")
            .where { "userId" equalTo userId }
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        SeatRequest.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }

    override suspend fun createRequest(
        roomId: String,
        userId: String,
        userName: String,
        seatIndex: Int,
    ): Resource<Unit> =
        firebaseCall("Failed to create seat request") {
            api.post(
                "/api/rooms/$roomId/seat-requests",
                JsonObject(
                    mapOf(
                        "userName" to JsonPrimitive(userName),
                        "seatIndex" to JsonPrimitive(seatIndex),
                    ),
                ),
            )
        }

    override suspend fun approveRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<SeatRequest> =
        firebaseCall("Failed to approve request") {
            val timestamp = currentTimeMillis()
            firestore
                .collection("rooms/$roomId/seatRequests")
                .document(requestId)
                .updateFields {
                    "status" to "APPROVED"
                    "resolvedBy" to resolvedBy
                    "resolvedAt" to timestamp
                }
            val doc =
                firestore
                    .collection("rooms/$roomId/seatRequests")
                    .document(requestId)
                    .get()
            val data = doc.dataMap()
            SeatRequest.fromMap(data, requestId)
        }

    override suspend fun denyRequest(
        roomId: String,
        requestId: String,
        resolvedBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to deny request") {
            firestore
                .collection("rooms/$roomId/seatRequests")
                .document(requestId)
                .updateFields {
                    "status" to "DENIED"
                    "resolvedBy" to resolvedBy
                    "resolvedAt" to currentTimeMillis()
                }
        }

    override suspend fun cancelApprovedRequest(
        roomId: String,
        requestId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to cancel approved request") {
            firestore
                .collection("rooms/$roomId/seatRequests")
                .document(requestId)
                .updateFields {
                    "status" to "CANCELLED"
                    "resolvedAt" to currentTimeMillis()
                }
        }
}

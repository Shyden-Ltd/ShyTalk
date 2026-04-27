package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

// ── DeviceRepository ────────────────────────────────────────────

class IosDeviceRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
) : DeviceRepository {
    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> =
        firebaseCall("Failed to check device binding") {
            val doc = firestore.collection("deviceBindings").document(deviceId).get()
            if (!doc.exists) return@firebaseCall null
            val data = doc.dataMap()
            (data["uniqueId"] ?: data["userId"])?.toString()
        }

    override suspend fun bindDevice(
        deviceId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to bind device") {
            firestore
                .collection("deviceBindings")
                .document(deviceId)
                .set(mapOf("userId" to userId, "boundAt" to currentTimeMillis()))
        }

    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> =
        try {
            val body = JsonObject(mapOf("deviceId" to JsonPrimitive(deviceId)))
            val response = api.post("/api/device-info", body)
            val banObj = response["banStatus"]
            if (banObj != null) {
                val ban = (banObj as? kotlinx.serialization.json.JsonObject) ?: JsonObject(emptyMap())
                val isBanned = ban["isBanned"]?.jsonPrimitive?.boolean ?: false
                if (isBanned) {
                    Resource.Success(
                        BanStatus(
                            isBanned = true,
                            banType = ban["banType"]?.jsonPrimitive?.contentOrNull,
                            reason = ban["reason"]?.jsonPrimitive?.contentOrNull,
                            expiresAt = ban["expiresAt"]?.jsonPrimitive?.contentOrNull,
                        ),
                    )
                } else {
                    Resource.Success(BanStatus())
                }
            } else {
                Resource.Success(BanStatus())
            }
        } catch (e: Exception) {
            logW("DeviceRepository", "Ban check failed, allowing through: ${e.message}")
            Resource.Success(BanStatus())
        }
}

// ── NotificationRepository ──────────────────────────────────────

class IosNotificationRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
) : NotificationRepository {
    override suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall("Failed to save FCM token") {
            api.post("/api/notifications/token", JsonObject(mapOf("token" to JsonPrimitive(token))))
        }

    override suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove FCM token") {
            api.delete("/api/notifications/token", JsonObject(mapOf("token" to JsonPrimitive(token))))
        }

    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to update notification setting") {
            firestore.collection("users").document(userId).updateFields {
                "pmNotificationsEnabled" to enabled
            }
        }

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> =
        firebaseCall("Failed to get notification setting") {
            val doc = firestore.collection("users").document(userId).get()
            if (!doc.exists) return@firebaseCall true
            val data = doc.dataMap()
            (data["pmNotificationsEnabled"] as? Boolean) ?: true
        }
}

// ── ReportRepository ────────────────────────────────────────────

class IosReportRepositoryImpl(
    private val api: IosApiClient,
) : ReportRepository {
    override suspend fun reportMessage(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        messageId: String,
        messageText: String,
        reason: String,
        description: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit report") {
            api.post(
                "/api/reports",
                JsonObject(
                    mapOf(
                        "reportedUserId" to JsonPrimitive(reportedUserId),
                        "reportedUserName" to JsonPrimitive(reportedUserName),
                        "reportedUserUniqueId" to JsonPrimitive(reportedUserUniqueId),
                        "conversationId" to JsonPrimitive(conversationId),
                        "messageId" to JsonPrimitive(messageId),
                        "messageText" to JsonPrimitive(messageText),
                        "reason" to JsonPrimitive(reason),
                        "description" to JsonPrimitive(description),
                    ),
                ),
            )
        }

    override suspend fun reportUser(
        reporterId: String,
        reporterName: String,
        reporterUniqueId: Long,
        reportedUserId: String,
        reportedUserName: String,
        reportedUserUniqueId: Long,
        conversationId: String,
        reason: String,
        description: String,
        evidenceUrls: List<String>,
    ): Resource<Unit> =
        firebaseCall("Failed to submit report") {
            val fields =
                mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                    "reportedUserId" to JsonPrimitive(reportedUserId),
                    "reportedUserName" to JsonPrimitive(reportedUserName),
                    "reportedUserUniqueId" to JsonPrimitive(reportedUserUniqueId),
                    "conversationId" to JsonPrimitive(conversationId),
                    "reason" to JsonPrimitive(reason),
                    "description" to JsonPrimitive(description),
                )
            if (evidenceUrls.isNotEmpty()) {
                fields["evidenceUrls"] =
                    kotlinx.serialization.json.JsonArray(evidenceUrls.map { JsonPrimitive(it) })
            }
            api.post("/api/reports", JsonObject(fields))
        }

    override suspend fun getPendingReports(): Resource<List<com.shyden.shytalk.feature.messaging.Report>> = Resource.Success(emptyList())

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<Unit> =
        firebaseCall("Failed to resolve report") {
            api.post(
                "/api/reports/$reportId/resolve",
                JsonObject(mapOf("action" to JsonPrimitive(action))),
            )
        }
}

// ── TranslationRepository ───────────────────────────────────────

class IosTranslationRepositoryImpl(
    private val api: IosApiClient,
) : TranslationRepository {
    override suspend fun translate(
        text: String,
        targetLang: String,
        messagePath: String?,
    ): Resource<TranslationResult> =
        try {
            val fields =
                mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                    "text" to JsonPrimitive(text),
                    "targetLang" to JsonPrimitive(targetLang),
                )
            messagePath?.let { fields["messagePath"] = JsonPrimitive(it) }
            val resp = api.post("/api/translate", JsonObject(fields))
            val translated = resp["translatedText"]?.jsonPrimitive?.contentOrNull ?: ""
            if (translated.isEmpty()) throw Exception("Missing translatedText in response")
            Resource.Success(
                TranslationResult(
                    translatedText = translated,
                    detectedSourceLang = resp["detectedSourceLang"]?.jsonPrimitive?.contentOrNull ?: "unknown",
                    cached = resp["cached"]?.jsonPrimitive?.boolean ?: false,
                ),
            )
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Translation failed")
        }

    override suspend fun getQuota(): Resource<TranslationQuota> =
        try {
            val resp = api.get("/api/translate/quota")
            Resource.Success(
                TranslationQuota(
                    used = resp["used"]?.jsonPrimitive?.int ?: 0,
                    limit = resp["limit"]?.jsonPrimitive?.int ?: 0,
                    unlimited = resp["unlimited"]?.jsonPrimitive?.boolean ?: false,
                ),
            )
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Failed to check quota")
        }
}

// ── OtpRepository ───────────────────────────────────────────────

class IosOtpRepositoryImpl(
    private val api: IosApiClient,
) : OtpRepository {
    override suspend fun sendOtp(email: String): Result<Unit> =
        runCatching {
            @Suppress("UNUSED_VARIABLE")
            val ignored = api.postPublic("/api/auth/otp/send", JsonObject(mapOf("email" to JsonPrimitive(email))))
        }

    override suspend fun verifyOtp(
        email: String,
        code: String,
    ): Result<String> =
        runCatching {
            val response =
                api.postPublic(
                    "/api/auth/otp/verify",
                    JsonObject(mapOf("email" to JsonPrimitive(email), "code" to JsonPrimitive(code))),
                )
            response["customToken"]!!.jsonPrimitive.content
        }
}

// ── PinRepository ───────────────────────────────────────────────

class IosPinRepositoryImpl(
    private val api: IosApiClient,
) : PinRepository {
    override suspend fun setupPin(pin: String): Result<String> =
        runCatching {
            val response = api.post("/api/auth/pin/setup", JsonObject(mapOf("pin" to JsonPrimitive(pin))))
            response["pinHash"]!!.jsonPrimitive.content
        }

    override suspend fun verifyPin(
        uniqueId: String,
        deviceId: String,
        pin: String,
    ): Result<PinVerifyResult> =
        try {
            val response =
                api.postPublic(
                    "/api/auth/pin/verify",
                    JsonObject(
                        mapOf(
                            "uniqueId" to JsonPrimitive(uniqueId),
                            "deviceId" to JsonPrimitive(deviceId),
                            "pin" to JsonPrimitive(pin),
                        ),
                    ),
                )
            Result.success(PinVerifyResult(customToken = response["customToken"]!!.jsonPrimitive.content))
        } catch (e: ApiException) {
            when (e.statusCode) {
                401 -> Result.success(PinVerifyResult(attemptsRemaining = 0))

                423 ->
                    Result.success(
                        PinVerifyResult(locked = true, lockedUntil = 0, requiresReauth = true, attemptsRemaining = 0),
                    )

                else -> Result.failure(e)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }

    override suspend fun resetPin(newPin: String): Result<Unit> =
        runCatching {
            @Suppress("UNUSED_VARIABLE")
            val ignored = api.post("/api/auth/pin/reset", JsonObject(mapOf("pin" to JsonPrimitive(newPin))))
        }
}

// ── BiometricRepository ─────────────────────────────────────────

class IosBiometricRepositoryImpl(
    private val api: IosApiClient,
) : BiometricRepository {
    override suspend fun register(
        publicKeyBase64: String,
        deviceId: String,
    ): Result<Unit> =
        runCatching {
            @Suppress("UNUSED_VARIABLE")
            val ignored =
                api.post(
                    "/api/auth/biometric/register",
                    JsonObject(mapOf("publicKey" to JsonPrimitive(publicKeyBase64), "deviceId" to JsonPrimitive(deviceId))),
                )
        }

    override suspend fun getChallenge(
        uniqueId: String,
        deviceId: String,
    ): Result<String> =
        runCatching {
            val response = api.getPublic("/api/auth/biometric/challenge?uniqueId=$uniqueId&deviceId=$deviceId")
            response["challenge"]!!.jsonPrimitive.content
        }

    override suspend fun verify(
        uniqueId: String,
        deviceId: String,
        signatureBase64: String,
    ): Result<String> =
        runCatching {
            val response =
                api.postPublic(
                    "/api/auth/biometric/verify",
                    JsonObject(
                        mapOf(
                            "uniqueId" to JsonPrimitive(uniqueId),
                            "deviceId" to JsonPrimitive(deviceId),
                            "signature" to JsonPrimitive(signatureBase64),
                        ),
                    ),
                )
            response["customToken"]!!.jsonPrimitive.content
        }

    override suspend fun revoke(deviceId: String): Result<Unit> =
        runCatching {
            @Suppress("UNUSED_VARIABLE")
            val ignored = api.delete("/api/auth/biometric/$deviceId")
        }
}

// ── BannerRepository ────────────────────────────────────────────

class IosBannerRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> {
        val now = currentTimeMillis()
        val snapshot =
            firestore
                .collection("banners")
                .where { "isActive" equalTo true }
                .get()
        return snapshot.documents
            .mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    val startDate = (data["startDate"] as? Number)?.toLong() ?: 0L
                    val endDate = (data["endDate"] as? Number)?.toLong() ?: Long.MAX_VALUE
                    if (startDate > now || endDate < now) return@mapNotNull null
                    Banner.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }.sortedBy { it.sortOrder }
    }
}

// ── FunFactRepository ───────────────────────────────────────────

class IosFunFactRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : FunFactRepository {
    @kotlin.concurrent.Volatile
    private var memoryCache: List<FunFact>? = null

    override suspend fun syncFacts(): List<FunFact> {
        val snapshot = firestore.collection("funFacts").get()
        val facts =
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    FunFact.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        memoryCache = facts
        return facts
    }

    override fun getCachedFacts(): List<FunFact> = memoryCache ?: emptyList()
}

// ── StorageRepository ───────────────────────────────────────────

class IosStorageRepositoryImpl(
    private val api: IosApiClient,
) : StorageRepository {
    override suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String,
    ): Resource<String> = Resource.Error("Image upload not yet implemented on iOS")

    override suspend fun deleteImageByUrl(url: String) {
        try {
            val key = url.removePrefix("https://images.shytalk.shyden.co.uk/")
            api.delete("/api/storage/delete?key=$key")
        } catch (e: Exception) {
            logW("StorageRepository", "Best-effort image delete failed: ${e.message}")
        }
    }
}

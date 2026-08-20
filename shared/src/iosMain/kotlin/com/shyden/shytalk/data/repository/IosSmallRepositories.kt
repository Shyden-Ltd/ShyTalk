package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.encodeUrlQueryComponent
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.FirebaseFirestore
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// ── DeviceRepository ────────────────────────────────────────────

class IosDeviceRepositoryImpl(
    private val api: IosApiClient,
) : DeviceRepository {
    override suspend fun resolveDeviceLock(deviceId: String): Resource<DeviceLockStatus> =
        try {
            val body = JsonObject(mapOf("deviceId" to JsonPrimitive(deviceId)))
            val response = api.post("/api/devices/lock-check", body)
            val status =
                if (response["status"]?.jsonPrimitive?.contentOrNull == "locked") {
                    DeviceLockStatus.LOCKED
                } else {
                    DeviceLockStatus.ALLOWED
                }
            Resource.Success(status)
        } catch (e: Exception) {
            // Lenient: a lock-check outage must not lock out real users (logged).
            logW("DeviceRepository", "Device lock-check failed, allowing through: ${e.message}")
            Resource.Error("Device lock-check failed: ${e.message}")
        }

    /**
     * SHY-0143 — reads the UNAUTHENTICATED `/api/ban-status`, not
     * `/api/device-info`.
     *
     * `/api/device-info` sits behind `authMiddleware`, so with no Firebase
     * session `getIdToken()` threw before the request was built and the catch
     * below reported "not banned" — a banned user who was signed out reached
     * the sign-in screen, which the story's AC names as the thing that must
     * never happen. `/api/ban-status` answers the same question with no token,
     * and writes nothing (device-info upserts a binding and runs a cap
     * transaction, which has no business running on every cold start).
     */
    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> =
        try {
            val response = api.getPublic("/api/ban-status?deviceId=${encodeUrlQueryComponent(deviceId)}")
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
            // Surface as Error so the caller can log/telemeter. AuthViewModel
            // already treats Error leniently (see AuthViewModelBanTest.kt:144
            // "ban check error is lenient") — same user-facing outcome as
            // the prior Resource.Success(BanStatus()), but iOS no longer
            // hides the error signal from anything else that might want it.
            logW("DeviceRepository", "Ban check failed: ${e.message}")
            Resource.Error("Ban check failed: ${e.message}")
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
            // Routed through the Express API rather than a direct Firestore
            // write so the field is rate-limited (writeLimiter) and audited
            // consistently with other settings updates. Firestore rule blocks
            // direct client writes to pmNotificationsEnabled.
            api.patch(
                "/api/notifications/settings",
                JsonObject(mapOf("pmNotificationsEnabled" to JsonPrimitive(enabled))),
            )
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

    override suspend fun getPendingReports(): Resource<List<com.shyden.shytalk.feature.messaging.Report>> =
        firebaseCall("Failed to load reports") {
            val arr = api.getArray("/api/reports")
            arr.map { element -> parseReportFromApi(element.jsonObject) }
        }

    override suspend fun resolveReport(
        reportId: String,
        action: String,
    ): Resource<ResolveReportOutcome> =
        firebaseCall("Failed to resolve report") {
            val response =
                api.post(
                    "/api/reports/$reportId/resolve",
                    JsonObject(mapOf("action" to JsonPrimitive(action))),
                )
            parseResolveReportOutcome(response)
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
            val response =
                api.getPublic(
                    "/api/auth/biometric/challenge" +
                        "?uniqueId=${encodeUrlQueryComponent(uniqueId)}" +
                        "&deviceId=${encodeUrlQueryComponent(deviceId)}",
                )
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

// ── StorageRepository ───────────────────────────────────────────

class IosStorageRepositoryImpl(
    private val api: IosApiClient,
) : StorageRepository {
    override suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String,
    ): Resource<String> =
        try {
            val json =
                api.postMultipart(
                    path = "/api/storage/upload",
                    fileBytes = imageData,
                    fileName = "upload",
                    fileContentType = contentType,
                    formFields = mapOf("path" to path),
                )
            val url = json["url"]?.jsonPrimitive?.content
            if (url.isNullOrEmpty()) {
                logE("StorageRepository", "Upload response missing url field; raw=$json")
                Resource.Error("Upload response missing URL")
            } else {
                Resource.Success(url)
            }
        } catch (e: CancellationException) {
            // Don't swallow structured-concurrency cancellation.
            throw e
        } catch (e: Exception) {
            logE("StorageRepository", "Image upload failed", e)
            Resource.Error(e.message ?: "Failed to upload image", e)
        }

    override suspend fun deleteImageByUrl(url: String) {
        try {
            val key = url.removePrefix("https://images.shytalk.shyden.co.uk/")
            api.delete("/api/storage/delete?key=${encodeUrlQueryComponent(key)}")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW("StorageRepository", "Best-effort image delete failed", e)
        }
    }
}

// ── AgeVerificationRepository (PR 9) ───────────────────────────────

/**
 * iOS impl of the user-facing age-verification submit flow. Uses
 * [IosApiClient] for the two server-side calls and a fresh Ktor
 * [io.ktor.client.HttpClient] for the direct R2 PUT (the signed URL
 * IS the auth — no Bearer header to attach).
 */
class IosAgeVerificationRepositoryImpl(
    private val api: IosApiClient,
) : AgeVerificationRepository {
    override suspend fun requestUploadUrl(
        contentType: AgeVerificationRepository.ContentType,
    ): Resource<AgeVerificationRepository.UploadHandle> =
        firebaseCall("Failed to request upload URL") {
            val body =
                JsonObject(mapOf("contentType" to JsonPrimitive(contentType.wireValue)))
            val resp = api.post("/api/age-verification/upload-url", body)
            AgeVerificationRepository.UploadHandle(
                uploadUrl =
                    resp["uploadUrl"]?.jsonPrimitive?.contentOrNull
                        ?: throw RuntimeException("uploadUrl missing"),
                r2Key =
                    resp["r2Key"]?.jsonPrimitive?.contentOrNull
                        ?: throw RuntimeException("r2Key missing"),
                expiresInSec = resp["expiresInSec"]?.jsonPrimitive?.int ?: 300,
            )
        }

    override suspend fun uploadImage(
        uploadUrl: String,
        contentType: AgeVerificationRepository.ContentType,
        bytes: ByteArray,
    ): Resource<Unit> =
        firebaseCall("Failed to upload ID image") {
            val client = io.ktor.client.HttpClient()
            try {
                val response =
                    client.put(uploadUrl) {
                        contentType(
                            io.ktor.http.ContentType
                                .parse(contentType.wireValue),
                        )
                        setBody(bytes)
                    }
                if (response.status.value !in 200..299) {
                    throw RuntimeException("R2 PUT failed: HTTP ${response.status.value}")
                }
            } finally {
                client.close()
            }
        }

    override suspend fun submit(
        idMethod: AgeVerificationRepository.IdMethod,
        r2Key: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit verification") {
            val body =
                JsonObject(
                    mapOf(
                        "idMethod" to JsonPrimitive(idMethod.wireValue),
                        "r2Key" to JsonPrimitive(r2Key),
                    ),
                )
            api.post("/api/age-verification/submit", body)
        }
}

// ── SupportRepository (SHY-0385) ───────────────────────────────────

/**
 * iOS side of raising a support ticket.
 *
 * The 409 mapping is the only interesting part: the server refuses a second
 * ticket while one is still open, and that is not a failure a retry can fix.
 * Matched on `statusCode` rather than on the server's English message, so it
 * survives a rewording and works for somebody reading the app in any language.
 */
class IosSupportRepositoryImpl(
    private val api: IosApiClient,
) : SupportRepository {
    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
    ): RaiseTicketOutcome =
        try {
            val fields = mutableMapOf<String, JsonElement>("message" to JsonPrimitive(message))
            category?.let { fields["category"] = JsonPrimitive(it.wireValue) }
            if (context.isNotEmpty()) {
                fields["context"] = JsonObject(context.mapValues { JsonPrimitive(it.value) })
            }

            val resp = api.post("/api/support-tickets", JsonObject(fields))
            // `IosApiClient.parseResponse` answers an EMPTY object for a non-JSON
            // 2xx rather than throwing, so a captive portal's login page arrives
            // here as a success carrying no ticket id. Android reached the same
            // state down a different route; both platforms must refuse it, or the
            // person is told their message arrived when nothing was sent.
            val ticketId = resp["ticketId"]?.jsonPrimitive?.contentOrNull.orEmpty()
            if (ticketId.isBlank()) {
                logW(TAG_SUPPORT, "Support ticket: a 2xx response carried no ticketId")
                RaiseTicketOutcome.Failed("Support request did not come back with a ticket")
            } else {
                RaiseTicketOutcome.Raised(ticketId)
            }
        } catch (e: CancellationException) {
            // Never swallow cancellation -- it is control flow, not a failure.
            // It must stay ABOVE the broad catch below.
            throw e
        } catch (e: ApiException) {
            if (e.statusCode == HTTP_CONFLICT_SUPPORT) {
                RaiseTicketOutcome.AlreadyOpen
            } else {
                // ApiException.message is non-nullable on iOS, so no elvis here.
                RaiseTicketOutcome.Failed(e.message)
            }
        } catch (e: Exception) {
            // A Ktor transport failure is not an ApiException, so a dropped
            // connection used to escape this repository entirely and take the app
            // down from inside `viewModelScope.launch`. Android caught IOException
            // and iOS caught nothing -- the same hole, one platform wide.
            logW(TAG_SUPPORT, "Support ticket failed unexpectedly: ${e.message}")
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
        }
}

private const val HTTP_CONFLICT_SUPPORT = 409
private const val TAG_SUPPORT = "SupportRepository"

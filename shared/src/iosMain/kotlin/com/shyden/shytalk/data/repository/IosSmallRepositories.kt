package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.encodeUrlQueryComponent
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.jsonToMap
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.IosApiClient
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.contentType
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
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
) : NotificationRepository {
    /**
     * SHY-0244 — the body names the model, so the backend files the value in
     * the right store. The two identifier kinds are opaque strings the server
     * cannot tell apart, so the client is the only place that knows.
     */
    private fun body(identifier: PushIdentifier): JsonObject {
        val field = if (identifier.isInstallationId) "installationId" else "token"
        return JsonObject(mapOf(field to JsonPrimitive(identifier.value)))
    }

    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> =
        firebaseCall("Failed to save push identifier") {
            api.post("/api/notifications/token", body(identifier))
        }

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> =
        firebaseCall("Failed to remove push identifier") {
            api.delete("/api/notifications/token", body(identifier))
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
            // Through the API (EPIC-0006). The PATCH above was already behind it
            // and only this read was not — setter migrated, getter left on a
            // direct Firestore connection.
            //
            // `userId` is ignored deliberately: the endpoint answers for the
            // CALLER, because honouring an id here would let anybody read
            // anybody's settings.
            val json = api.get("/api/notifications/settings")
            (json["pmNotificationsEnabled"] as? JsonPrimitive)?.booleanOrNull ?: true
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

/**
 * Banners, through the API (EPIC-0006) — the iOS twin of BannerRepositoryImpl.
 *
 * Was a direct Firestore query that re-did on the phone what
 * `GET /api/banners/active` already does server-side: filter by isActive, drop
 * anything outside its date window, order by sortOrder. No new endpoint was
 * needed; only for somebody to notice the work was being done twice, over a
 * connection the app should not have had.
 */
class IosBannerRepositoryImpl(
    private val api: IosApiClient,
) : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> {
        val arr = api.getArray("/api/banners/active")
        return arr
            .mapNotNull { element ->
                try {
                    val obj = element.jsonObject
                    val id = (obj["id"] as? JsonPrimitive)?.contentOrNull
                    if (id.isNullOrEmpty()) return@mapNotNull null
                    Banner.fromMap(jsonToMap(obj), id)
                } catch (e: Exception) {
                    null
                }
            }
            // The server already orders by sortOrder; kept so display order is a
            // property of this list rather than of the transport that fetched it.
            .sortedBy { it.sortOrder }
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
 * SHY-0396 removed the 409 mapping that used to live here, in step with Android
 * and with the server. A second request is never refused now — refusing one
 * meant a genuinely DIFFERENT problem reached nobody. The form asks first, using
 * [openTickets], and [addToTicket] is the answer to "it is the problem I already
 * reported".
 */
class IosSupportRepositoryImpl(
    private val api: IosApiClient,
) : SupportRepository {
    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
        attachments: List<String>,
    ): RaiseTicketOutcome =
        try {
            val fields = mutableMapOf<String, JsonElement>("message" to JsonPrimitive(message))
            category?.let { fields["category"] = JsonPrimitive(it.wireValue) }
            // Same two fields Android fills in, for the same reason: an admin
            // should not have to ask which platform and which build.
            val enriched =
                context +
                    mapOf(
                        "platform" to "ios",
                        "appVersion" to
                            (
                                platform.Foundation.NSBundle.mainBundle
                                    .objectForInfoDictionaryKey("CFBundleShortVersionString") as? String
                                    ?: "unknown"
                            ),
                    )
            fields["context"] = JsonObject(enriched.mapValues { JsonPrimitive(it.value) })
            // Absent rather than empty, matching Android and every other optional
            // in this payload.
            if (attachments.isNotEmpty()) {
                fields["attachments"] = JsonArray(attachments.map { JsonPrimitive(it) })
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
            // ApiException.message is non-nullable on iOS, so no elvis here.
            RaiseTicketOutcome.Failed(e.message)
        } catch (e: Exception) {
            // A Ktor transport failure is not an ApiException, so a dropped
            // connection used to escape this repository entirely and take the app
            // down from inside `viewModelScope.launch`. Android caught IOException
            // and iOS caught nothing -- the same hole, one platform wide.
            logW(TAG_SUPPORT, "Support ticket failed unexpectedly: ${e.message}")
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
        }

    /**
     * SHY-0396 — what this person still has open, for the duplicate warning.
     *
     * Null on ANY failure, deliberately distinct from an empty list: the caller
     * has to tell "you have nothing open" from "we could not find out".
     */
    override suspend fun openTickets(): OpenTicketsView? =
        try {
            val resp = api.get("/api/support-tickets/mine/open")
            val rows = resp["tickets"] as? JsonArray ?: JsonArray(emptyList())
            // Absent rather than guessed: the server omits the count when it
            // could not determine one, and falling back to the list length is
            // the very defect SHY-0424 is about.
            val count = resp["openCount"]?.jsonPrimitive?.intOrNull
            val summaries =
                rows.mapNotNull { row ->
                    val obj = row as? JsonObject ?: return@mapNotNull null
                    val id = obj["ticketId"]?.jsonPrimitive?.contentOrNull.orEmpty()
                    // A row with no id is a row nothing can be added to, so it is
                    // dropped rather than offered as an unusable choice.
                    if (id.isBlank()) {
                        null
                    } else {
                        OpenTicketSummary(
                            ticketId = id,
                            category = SupportCategory.fromWire(obj["category"]?.jsonPrimitive?.contentOrNull),
                            summary = obj["summary"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        )
                    }
                }
            OpenTicketsView(summaries = summaries, openCount = count)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG_SUPPORT, "Could not list open support tickets: ${e.message}")
            null
        }

    override suspend fun addToTicket(
        ticketId: String,
        message: String,
    ): Boolean =
        try {
            api.post(
                "/api/support-tickets/$ticketId/messages",
                JsonObject(mapOf("message" to JsonPrimitive(message))),
            )
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // False rather than a throw: the caller keeps the person's text on
            // screen and lets them try again, which is the only useful response.
            logW(TAG_SUPPORT, "Could not add to support ticket $ticketId: ${e.message}")
            false
        }

    /**
     * SHY-0434 — a removed attachment must leave the object store.
     *
     * Best-effort by contract: `false` tells the caller it is still there, and
     * the caller still takes it off the form. Refusing to let go of a file
     * somebody has decided against would leave them unable to send at all.
     */
    override suspend fun deleteAttachment(r2Key: String): Boolean =
        try {
            api.delete("/api/support-tickets/attachments", JsonObject(mapOf("r2Key" to JsonPrimitive(r2Key))))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG_SUPPORT, "Attachment delete failed: ${e.message}")
            false
        }

    override suspend fun requestAttachmentUpload(contentType: AttachmentType): UploadHandle? =
        try {
            val body = JsonObject(mapOf("contentType" to JsonPrimitive(contentType.wireValue)))
            val resp = api.post("/api/support-tickets/upload-url", body)
            val uploadUrl = resp["uploadUrl"]?.jsonPrimitive?.contentOrNull
            val r2Key = resp["r2Key"]?.jsonPrimitive?.contentOrNull
            // `parseResponse` answers an EMPTY object for a non-JSON 2xx rather
            // than throwing, so a missing field here is indistinguishable from a
            // captive portal. Null either way -- there is no upload to attempt.
            if (uploadUrl.isNullOrEmpty() || r2Key.isNullOrEmpty()) {
                logW(TAG_SUPPORT, "Attachment upload URL response was missing its fields")
                null
            } else {
                UploadHandle(uploadUrl, r2Key, resp["expiresInSec"]?.jsonPrimitive?.int ?: 300)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG_SUPPORT, "Attachment upload URL refused: ${e.message}")
            null
        }

    override suspend fun uploadAttachment(
        uploadUrl: String,
        contentType: AttachmentType,
        bytes: ByteArray,
    ): Boolean {
        val client = io.ktor.client.HttpClient()
        return try {
            // The signed URL IS the auth -- no token. The Content-Type must match
            // what the URL was signed for or R2 refuses the object.
            val response =
                client.put(uploadUrl) {
                    contentType(
                        io.ktor.http.ContentType
                            .parse(contentType.wireValue),
                    )
                    setBody(bytes)
                }
            response.status.value in 200..299
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG_SUPPORT, "Attachment upload failed: ${e.message}")
            false
        } finally {
            client.close()
        }
    }
}

private const val TAG_SUPPORT = "SupportRepository"

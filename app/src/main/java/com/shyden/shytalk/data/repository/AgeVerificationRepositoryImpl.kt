package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.remote.executeAsync
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class AgeVerificationRepositoryImpl(
    private val api: WorkerApiClient,
    private val httpClient: OkHttpClient,
) : AgeVerificationRepository {
    override suspend fun requestUploadUrl(
        contentType: AgeVerificationRepository.ContentType,
    ): Resource<AgeVerificationRepository.UploadHandle> =
        firebaseCall("Failed to request upload URL") {
            val resp =
                api.post(
                    "/api/age-verification/upload-url",
                    JSONObject().put("contentType", contentType.wireValue),
                )
            AgeVerificationRepository.UploadHandle(
                uploadUrl = resp.getString("uploadUrl"),
                r2Key = resp.getString("r2Key"),
                expiresInSec = resp.optInt("expiresInSec", 300),
            )
        }

    override suspend fun uploadImage(
        uploadUrl: String,
        contentType: AgeVerificationRepository.ContentType,
        bytes: ByteArray,
    ): Resource<Unit> =
        firebaseCall("Failed to upload ID image") {
            // The signed URL IS the auth — no Bearer header. PUT the
            // bytes raw with the matching Content-Type so R2's signature
            // verification passes.
            val response =
                httpClient
                    .newCall(
                        Request
                            .Builder()
                            .url(uploadUrl)
                            .put(bytes.toRequestBody(contentType.wireValue.toMediaType()))
                            .build(),
                    ).executeAsync()
            response.use {
                if (!it.isSuccessful) {
                    throw RuntimeException("R2 PUT failed: HTTP ${it.code}")
                }
            }
        }

    override suspend fun submit(
        idMethod: AgeVerificationRepository.IdMethod,
        r2Key: String,
    ): Resource<Unit> =
        firebaseCall("Failed to submit verification") {
            api.post(
                "/api/age-verification/submit",
                JSONObject()
                    .put("idMethod", idMethod.wireValue)
                    .put("r2Key", r2Key),
            )
        }
}

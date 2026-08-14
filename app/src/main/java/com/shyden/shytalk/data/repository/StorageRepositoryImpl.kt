package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val R2_PUBLIC_BASE = "https://images.shytalk.shyden.co.uk"

class StorageRepositoryImpl(
    private val httpClient: OkHttpClient,
    private val workerUrl: String,
    private val auth: FirebaseAuth,
) : StorageRepository {
    companion object {
        private const val TAG = "StorageRepositoryImpl"
    }

    override suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String,
    ): Resource<String> {
        logI(TAG, "Uploading file: path=$path")
        return try {
            val idToken =
                auth.currentUser
                    ?.getIdToken(false)
                    ?.await()
                    ?.token
                    ?: return Resource.Error("Not signed in")
            val requestBody =
                MultipartBody
                    .Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart(
                        "file",
                        "upload",
                        imageData.toRequestBody(contentType.toMediaType()),
                    ).addFormDataPart("path", path)
                    .build()
            val response =
                httpClient
                    .newCall(
                        Request
                            .Builder()
                            .url("$workerUrl/api/storage/upload")
                            .header("Authorization", "Bearer $idToken")
                            .post(requestBody)
                            .build(),
                    ).executeAsync()
            response.use {
                if (!it.isSuccessful) {
                    return Resource.Error("Upload failed: HTTP ${it.code}")
                }
                val json = JSONObject(it.body.string())
                val url = json.optString("url", "")
                if (url.isEmpty()) return Resource.Error("Upload response missing URL")
                Resource.Success(url)
            }
        } catch (e: Exception) {
            logE(TAG, "Upload failed", e)
            Resource.Error(e.message ?: "Failed to upload image", e)
        }
    }

    override suspend fun deleteImageByUrl(url: String) {
        try {
            val key = url.removePrefix("$R2_PUBLIC_BASE/")
            val idToken =
                auth.currentUser
                    ?.getIdToken(false)
                    ?.await()
                    ?.token ?: return
            val encodedKey = URLEncoder.encode(key, "UTF-8")
            httpClient
                .newCall(
                    Request
                        .Builder()
                        .url("$workerUrl/api/storage/delete?key=$encodedKey")
                        .header("Authorization", "Bearer $idToken")
                        .delete()
                        .build(),
                ).executeAsync()
                .close()
        } catch (e: Exception) {
            Log.d(TAG, "Best-effort image delete failed", e)
        }
    }
}

private suspend fun Call.executeAsync(): Response =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) = cont.resumeWithException(e)

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) = cont.resume(response)
            },
        )
    }

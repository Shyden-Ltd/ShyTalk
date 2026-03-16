package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface StorageRepository {
    suspend fun uploadImage(
        userId: String,
        path: String,
        imageData: ByteArray,
        contentType: String = "image/jpeg",
    ): Resource<String>

    suspend fun deleteImageByUrl(url: String)
}

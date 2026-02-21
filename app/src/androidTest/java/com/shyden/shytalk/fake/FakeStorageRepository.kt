package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.StorageRepository

class FakeStorageRepository : StorageRepository {
    override suspend fun uploadImage(userId: String, path: String, imageData: ByteArray, contentType: String): Resource<String> =
        Resource.Success("https://fake-storage.example.com/$path")

    override suspend fun deleteImageByUrl(url: String) { /* no-op */ }
}

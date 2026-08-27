package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AgeVerificationRepository.ContentType
import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import com.shyden.shytalk.data.repository.AgeVerificationRepository.UploadHandle

/**
 * SHY-0474 — so the age-verification screen can be NAVIGATED to.
 *
 * `AgeVerificationSubmitViewModel` is registered in the real `ViewModelModule`
 * and was missing from `TestKoinModule`, so navigating to the screen threw
 * `NoDefinitionFoundException`. Registering the view model alone was not
 * enough: it takes an `AgeVerificationRepository`, which had no test binding
 * either, and Koin then failed one layer deeper with
 * `InstanceCreationException`.
 *
 * Every call refuses. Nothing here is a scenario -- the navigation tests only
 * need the screen to COMPOSE, and a fake that pretended uploads succeed would
 * invent a path no test asked for. `AgeVerificationSubmitScreenTest` builds its
 * own view model directly and is unaffected.
 */
class FakeAgeVerificationRepository : AgeVerificationRepository {
    override suspend fun requestUploadUrl(contentType: ContentType): Resource<UploadHandle> =
        Resource.Error("FakeAgeVerificationRepository: not exercised by this test")

    override suspend fun uploadImage(
        uploadUrl: String,
        contentType: ContentType,
        bytes: ByteArray,
    ): Resource<Unit> = Resource.Error("FakeAgeVerificationRepository: not exercised by this test")

    override suspend fun submit(
        idMethod: IdMethod,
        r2Key: String,
    ): Resource<Unit> = Resource.Error("FakeAgeVerificationRepository: not exercised by this test")
}

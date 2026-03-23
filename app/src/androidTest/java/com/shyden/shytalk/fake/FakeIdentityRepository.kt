package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.CreateUserResult
import com.shyden.shytalk.data.repository.IdentityRepository
import com.shyden.shytalk.data.repository.SignInResult

class FakeIdentityRepository : IdentityRepository {
    var resolveResult: Resource<SignInResult> = Resource.Success(SignInResult.Found(10000005))
    var createResult: Resource<CreateUserResult> = Resource.Success(CreateUserResult(10000005))
    var linkResult: Resource<Unit> = Resource.Success(Unit)
    var unlinkResult: Resource<Unit> = Resource.Success(Unit)
    var refreshResult: Resource<Unit> = Resource.Success(Unit)

    override suspend fun resolveIdentity(
        provider: String,
        identifier: String,
    ) = resolveResult

    override suspend fun createUser(
        provider: String,
        identifier: String,
        displayName: String?,
        email: String?,
        profilePhotoUrl: String?,
        dateOfBirth: Long?,
        language: String,
    ) = createResult

    override suspend fun linkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ) = linkResult

    override suspend fun unlinkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ) = unlinkResult

    override suspend fun forceRefreshToken() = refreshResult
}

package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * SHY-0102 — value matrix for the single fail-closed cohort resolver that every
 * OSA-segregated rooms `list` query pins. The fail-closed-to-"minor" default is
 * a UK OSA #17 security decision: an unresolved caller must NEVER widen access.
 */
class CohortResolverTest {
    private fun repoReturning(result: Resource<User>): UserRepository = mockk { coEvery { getUser(any()) } returns result }

    private fun user(
        cohortValue: String,
        overrideValue: String?,
    ): User =
        mockk {
            every { cohort } returns cohortValue
            every { cohortOverride } returns overrideValue
        }

    @Test
    fun `resolves a plain adult cohort`() =
        runTest {
            val repo = repoReturning(Resource.Success(user("adult", null)))
            assertEquals("adult", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `resolves a plain minor cohort`() =
        runTest {
            val repo = repoReturning(Resource.Success(user("minor", null)))
            assertEquals("minor", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `admin override wins over the base cohort`() =
        runTest {
            // A minor base with an admin adult override resolves adult — must
            // match the JWT claim the rule compares against (server mints from
            // effectiveCohort, which honours the override).
            val repo = repoReturning(Resource.Success(user("minor", "adult")))
            assertEquals("adult", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `an adult override-to-minor also wins`() =
        runTest {
            val repo = repoReturning(Resource.Success(user("adult", "minor")))
            assertEquals("minor", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `a corrupt cohort value fails closed to minor`() =
        runTest {
            val repo = repoReturning(Resource.Success(user("not-a-cohort", null)))
            assertEquals("minor", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `a failed user lookup fails closed to minor`() =
        runTest {
            val repo = repoReturning(Resource.Error("network down"))
            assertEquals("minor", repo.resolveEffectiveCohort("u1"))
        }

    @Test
    fun `a null userId fails closed to minor without a lookup`() =
        runTest {
            val repo = mockk<UserRepository>()
            assertEquals("minor", repo.resolveEffectiveCohort(null))
            coVerify(exactly = 0) { repo.getUser(any()) }
        }
}

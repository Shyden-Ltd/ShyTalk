package com.shyden.shytalk.core.util

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FirebaseCallTest {
    @Test
    fun `firebaseCall returns Success when block succeeds`() =
        runTest {
            val result = firebaseCall { "hello" }
            assertTrue(result is Resource.Success)
            assertEquals("hello", (result as Resource.Success).data)
        }

    @Test
    fun `firebaseCall returns Success with Unit for side-effect block`() =
        runTest {
            val result = firebaseCall { /* side effect */ }
            assertTrue(result is Resource.Success)
        }

    @Test
    fun `firebaseCall returns Error with exception message`() =
        runTest {
            val result = firebaseCall<String> { throw RuntimeException("boom") }
            assertTrue(result is Resource.Error)
            assertEquals("boom", (result as Resource.Error).message)
            assertNotNull(result.exception)
        }

    @Test
    fun `firebaseCall returns Error with fallback message when exception message is null`() =
        runTest {
            val result =
                firebaseCall<String>("Custom error") {
                    throw RuntimeException(null as String?)
                }
            assertTrue(result is Resource.Error)
            assertEquals("Custom error", (result as Resource.Error).message)
        }

    @Test
    fun `firebaseCall uses default fallback message`() =
        runTest {
            val result =
                firebaseCall<String> {
                    throw RuntimeException(null as String?)
                }
            assertTrue(result is Resource.Error)
            assertEquals("Operation failed", (result as Resource.Error).message)
        }

    @Test
    fun `firebaseCall handles IllegalStateException`() =
        runTest {
            val result = firebaseCall<String> { throw IllegalStateException("bad state") }
            assertTrue(result is Resource.Error)
            assertEquals("bad state", (result as Resource.Error).message)
        }
}

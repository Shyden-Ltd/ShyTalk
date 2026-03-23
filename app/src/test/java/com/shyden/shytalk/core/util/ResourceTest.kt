package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ResourceTest {
    @Test
    fun `Success holds data`() {
        val resource = Resource.Success("hello")
        assertEquals("hello", resource.data)
    }

    @Test
    fun `Error holds message without exception`() {
        val resource = Resource.Error("something failed")
        assertEquals("something failed", resource.message)
        assertNull(resource.exception)
    }

    @Test
    fun `Error holds message with exception`() {
        val ex = RuntimeException("boom")
        val resource = Resource.Error("something failed", ex)
        assertEquals("something failed", resource.message)
        assertSame(ex, resource.exception)
    }

    @Test
    fun `Loading is singleton`() {
        assertSame(Resource.Loading, Resource.Loading)
    }

    @Test
    fun `when expression covers all branches`() {
        val resources: List<Resource<String>> =
            listOf(
                Resource.Success("data"),
                Resource.Error("err"),
                Resource.Loading,
            )
        val results =
            resources.map { resource ->
                when (resource) {
                    is Resource.Success -> "success"
                    is Resource.Error -> "error"
                    is Resource.Loading -> "loading"
                }
            }
        assertEquals(listOf("success", "error", "loading"), results)
    }

    // ===== Edge cases =====

    @Test
    fun `Success can hold null data`() {
        val resource = Resource.Success<String?>(null)
        assertNull(resource.data)
    }

    @Test
    fun `Success can hold empty string`() {
        val resource = Resource.Success("")
        assertEquals("", resource.data)
    }

    @Test
    fun `Success can hold a list`() {
        val resource = Resource.Success(listOf(1, 2, 3))
        assertEquals(listOf(1, 2, 3), resource.data)
    }

    @Test
    fun `Success can hold an empty list`() {
        val resource = Resource.Success(emptyList<String>())
        assertTrue(resource.data.isEmpty())
    }

    @Test
    fun `Error with empty message`() {
        val resource = Resource.Error("")
        assertEquals("", resource.message)
    }

    @Test
    fun `Error with nested exception`() {
        val cause = IllegalArgumentException("root cause")
        val ex = RuntimeException("wrapper", cause)
        val resource = Resource.Error("failed", ex)
        assertSame(cause, resource.exception?.cause)
    }

    @Test
    fun `Success equality - same data are equal`() {
        val a = Resource.Success("hello")
        val b = Resource.Success("hello")
        assertEquals(a, b)
    }

    @Test
    fun `Success equality - different data are not equal`() {
        val a = Resource.Success("hello")
        val b = Resource.Success("world")
        assertTrue(a != b)
    }

    @Test
    fun `Error equality - same message and exception are equal`() {
        val ex = RuntimeException("boom")
        val a = Resource.Error("fail", ex)
        val b = Resource.Error("fail", ex)
        assertEquals(a, b)
    }

    @Test
    fun `Error equality - same message different exception are not equal`() {
        val a = Resource.Error("fail", RuntimeException("a"))
        val b = Resource.Error("fail", RuntimeException("b"))
        assertTrue(a != b)
    }

    @Test
    fun `Success copy creates modified instance`() {
        val original = Resource.Success("hello")
        val copied = original.copy(data = "world")
        assertEquals("world", copied.data)
        assertEquals("hello", original.data)
    }

    @Test
    fun `Error copy can change message`() {
        val original = Resource.Error("first")
        val copied = original.copy(message = "second")
        assertEquals("second", copied.message)
        assertEquals("first", original.message)
    }

    @Test
    fun `type checking with is operator`() {
        val success: Resource<Int> = Resource.Success(42)
        val error: Resource<Int> = Resource.Error("err")
        val loading: Resource<Int> = Resource.Loading

        assertTrue(success is Resource.Success)
        assertFalse(success is Resource.Error)
        assertFalse(success is Resource.Loading)

        assertFalse(error is Resource.Success)
        assertTrue(error is Resource.Error)
        assertFalse(error is Resource.Loading)

        assertFalse(loading is Resource.Success)
        assertFalse(loading is Resource.Error)
        assertTrue(loading is Resource.Loading)
    }

    @Test
    fun `Success hashCode is consistent with equals`() {
        val a = Resource.Success("test")
        val b = Resource.Success("test")
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun `nested Resource in Success`() {
        val inner = Resource.Success("inner")
        val outer: Resource<Resource<String>> = Resource.Success(inner)
        val innerResult = (outer as Resource.Success).data
        assertTrue(innerResult is Resource.Success)
        assertEquals("inner", (innerResult as Resource.Success).data)
    }
}

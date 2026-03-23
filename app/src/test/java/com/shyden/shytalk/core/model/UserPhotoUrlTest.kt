package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class UserPhotoUrlTest {
    @Test
    fun `photoUrl is null when both profilePhotoUrl and avatarUrl are null`() {
        val user = User(uid = "u1", profilePhotoUrl = null, avatarUrl = null)
        assertNull(user.photoUrl)
    }

    @Test
    fun `photoUrl returns profilePhotoUrl when only profilePhotoUrl is set`() {
        val user = User(uid = "u1", profilePhotoUrl = "https://img.com/profile.jpg", avatarUrl = null)
        assertEquals("https://img.com/profile.jpg", user.photoUrl)
    }

    @Test
    fun `photoUrl returns avatarUrl when only avatarUrl is set`() {
        val user = User(uid = "u1", profilePhotoUrl = null, avatarUrl = "https://img.com/avatar.jpg")
        assertEquals("https://img.com/avatar.jpg", user.photoUrl)
    }

    @Test
    fun `photoUrl prefers profilePhotoUrl when both are set`() {
        val user =
            User(
                uid = "u1",
                profilePhotoUrl = "https://img.com/profile.jpg",
                avatarUrl = "https://img.com/avatar.jpg",
            )
        assertEquals("https://img.com/profile.jpg", user.photoUrl)
    }

    @Test
    fun `fromMap populates avatarUrl from D1 response`() {
        val map =
            mapOf<String, Any?>(
                "avatarUrl" to "https://img.com/avatar.jpg",
                "profilePhotoUrl" to null,
            )
        val user = User.fromMap(map, "u1")
        assertEquals("https://img.com/avatar.jpg", user.avatarUrl)
        assertEquals("https://img.com/avatar.jpg", user.photoUrl)
    }

    @Test
    fun `fromMap populates both fields from D1 response with avatar_url fallback`() {
        val map =
            mapOf<String, Any?>(
                "profilePhotoUrl" to "https://img.com/profile.jpg",
                "avatarUrl" to "https://img.com/profile.jpg",
            )
        val user = User.fromMap(map, "u1")
        assertEquals("https://img.com/profile.jpg", user.profilePhotoUrl)
        assertEquals("https://img.com/profile.jpg", user.avatarUrl)
        assertEquals("https://img.com/profile.jpg", user.photoUrl)
    }

    @Test
    fun `fromMap with no photo fields returns null photoUrl`() {
        val map = mapOf<String, Any?>("displayName" to "TestUser")
        val user = User.fromMap(map, "u1")
        assertNull(user.photoUrl)
    }
}

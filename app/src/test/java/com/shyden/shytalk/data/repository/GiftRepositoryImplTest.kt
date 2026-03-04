package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.mockk
import org.junit.Before
import org.junit.Test

class GiftRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: GiftRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        repo = GiftRepositoryImpl(api, firestore)
    }

    // ── Gift catalog — reads from Firestore (tested via integration tests) ──

    // ── Gift rankings — reads from Firestore (tested via integration tests) ──

    // ── Gift wall senders — reads from Firestore (tested via integration tests) ──

    // ── Backpack / broadcasts / gift wall — reads from Firestore (tested via integration tests) ──
}

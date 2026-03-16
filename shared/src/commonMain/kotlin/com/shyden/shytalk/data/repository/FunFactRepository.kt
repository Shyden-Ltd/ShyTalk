package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.FunFact

interface FunFactRepository {
    suspend fun syncFacts(): List<FunFact>

    fun getCachedFacts(): List<FunFact>
}

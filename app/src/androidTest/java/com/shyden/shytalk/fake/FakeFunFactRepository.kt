package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.FunFact
import com.shyden.shytalk.data.repository.FunFactRepository

class FakeFunFactRepository : FunFactRepository {
    override suspend fun syncFacts(): List<FunFact> = emptyList()
    override fun getCachedFacts(): List<FunFact> = emptyList()
}

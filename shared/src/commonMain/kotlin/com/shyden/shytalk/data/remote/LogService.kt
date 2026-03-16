package com.shyden.shytalk.data.remote

interface LogService {
    suspend fun shipLogs(entries: List<LogEntry>)

    suspend fun sendDeviceInfo(info: Map<String, Any?>)

    suspend fun fetchLogConfig(): LogConfig
}

data class LogEntry(
    val level: String,
    val source: String,
    val message: String,
    val sessionTraceId: String,
    val userId: String?,
    val deviceId: String?,
    val context: Map<String, Any?> = emptyMap(),
    val appVersion: String? = null,
    val platform: String? = null,
    val osVersion: String? = null,
)

data class LogConfig(
    val levelPerSource: Map<String, String> = emptyMap(),
    val batchSettings: BatchSettings = BatchSettings(),
)

data class BatchSettings(
    val intervalSeconds: Int = 30,
    val wifiOnly: Boolean = false,
)

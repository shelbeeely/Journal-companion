package com.example.ai

import com.example.model.AiAvailabilityState
import kotlinx.coroutines.flow.Flow

sealed interface AiGenerationResult {
    data class Success(val text: String) : AiGenerationResult
    data class Unavailable(val reason: String) : AiGenerationResult
    data class NeedsDownload(val message: String) : AiGenerationResult
    data class BusyOrQuota(val message: String) : AiGenerationResult
    data object Cancelled : AiGenerationResult
    data class Failure(val message: String) : AiGenerationResult
}

interface OnDeviceAiClient {
    suspend fun checkAvailability(): AiAvailabilityState
    fun downloadModel(): Flow<AiAvailabilityState>
    suspend fun generate(
        systemInstruction: String,
        prompt: String,
        temperature: Float = 0.4f,
        maxOutputTokens: Int = 512,
    ): AiGenerationResult

    fun close() {}
}

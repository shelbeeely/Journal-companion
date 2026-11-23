package com.example.ai

import com.example.model.AiAvailabilityState
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.SystemInstruction
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Google's official ML Kit GenAI Prompt API backed by Android AICore (Gemini Nano).
 * Zero cloud calls, zero journal content logging.
 */
class MlKitPromptAiClient : OnDeviceAiClient {

    private var model: GenerativeModel? = null

    private fun getOrCreateModel(): GenerativeModel {
        return model ?: Generation.getClient().also { model = it }
    }

    override suspend fun checkAvailability(): AiAvailabilityState = withContext(Dispatchers.IO) {
        try {
            val status = withTimeoutOrNull(3000L) {
                getOrCreateModel().checkStatus()
            } ?: return@withContext AiAvailabilityState.Unavailable(
                "AICore check timed out on this device. Built-in templates are active.",
            )
            when (status) {
                FeatureStatus.AVAILABLE -> AiAvailabilityState.Available
                FeatureStatus.DOWNLOADABLE -> AiAvailabilityState.Downloadable(isDownloading = false)
                FeatureStatus.DOWNLOADING -> AiAvailabilityState.Downloadable(isDownloading = true)
                FeatureStatus.UNAVAILABLE -> AiAvailabilityState.Unavailable(
                    "AICore / Gemini Nano is unavailable on this device or build. Built-in templates are active.",
                )
                else -> AiAvailabilityState.Unavailable("AICore status unknown. Built-in templates are active.")
            }
        } catch (ce: CancellationException) {
            throw ce
        } catch (ge: GenAiException) {
            AiAvailabilityState.Unavailable(describeGenAiException(ge))
        } catch (t: Throwable) {
            AiAvailabilityState.Unavailable(
                t.message?.take(120) ?: "AICore service unavailable. Built-in templates are active.",
            )
        }
    }

    override fun downloadModel(): Flow<AiAvailabilityState> = flow {
        val client = getOrCreateModel()
        client.download().collect { status ->
            when (status) {
                is DownloadStatus.DownloadStarted -> {
                    emit(AiAvailabilityState.Downloadable(isDownloading = true, bytesDownloaded = 0L))
                }
                is DownloadStatus.DownloadProgress -> {
                    emit(
                        AiAvailabilityState.Downloadable(
                            isDownloading = true,
                            bytesDownloaded = status.totalBytesDownloaded,
                        ),
                    )
                }
                DownloadStatus.DownloadCompleted -> {
                    emit(AiAvailabilityState.Available)
                }
                is DownloadStatus.DownloadFailed -> {
                    emit(AiAvailabilityState.Error(describeGenAiException(status.e)))
                }
            }
        }
    }.catch { t ->
        if (t is CancellationException) throw t
        val msg = if (t is GenAiException) describeGenAiException(t) else "Model download failed."
        emit(AiAvailabilityState.Error(msg))
    }

    override suspend fun generate(
        systemInstruction: String,
        prompt: String,
        temperature: Float,
        maxOutputTokens: Int,
    ): AiGenerationResult {
        return try {
            val client = getOrCreateModel()
            when (client.checkStatus()) {
                FeatureStatus.AVAILABLE -> Unit
                FeatureStatus.DOWNLOADABLE -> return AiGenerationResult.NeedsDownload(
                    "Gemini Nano needs to download before on-device AI generation. Using built-in guidance.",
                )
                FeatureStatus.DOWNLOADING -> return AiGenerationResult.NeedsDownload(
                    "Gemini Nano is currently downloading. Using built-in guidance for now.",
                )
                else -> return AiGenerationResult.Unavailable(
                    "AICore is not available on this device. Using built-in templates.",
                )
            }

            val request = generateContentRequest(
                SystemInstruction(systemInstruction),
                TextPart(prompt),
            ) {
                this.temperature = temperature
                this.maxOutputTokens = maxOutputTokens
            }

            val response = client.generateContent(request)
            val text = response.candidates.firstOrNull()?.text?.trim().orEmpty()
            if (text.isEmpty()) {
                AiGenerationResult.Failure("On-device model returned an empty response.")
            } else {
                AiGenerationResult.Success(text)
            }
        } catch (ce: CancellationException) {
            AiGenerationResult.Cancelled
        } catch (ge: GenAiException) {
            mapGenAiException(ge)
        } catch (t: Throwable) {
            AiGenerationResult.Failure(t.message ?: "On-device generation failed.")
        }
    }

    override fun close() {
        runCatching { model?.close() }
        model = null
    }

    private fun mapGenAiException(e: GenAiException): AiGenerationResult {
        val desc = describeGenAiException(e)
        return when (e.errorCode) {
            9 -> AiGenerationResult.BusyOrQuota(desc) // BUSY / quota
            8, 16 -> AiGenerationResult.Unavailable(desc) // NOT_AVAILABLE / NOT_SUPPORTED
            else -> AiGenerationResult.Failure(desc)
        }
    }

    private fun describeGenAiException(e: GenAiException): String {
        return when (e.errorCode) {
            8 -> "AICore / Gemini Nano is not available on this device."
            9 -> "AICore is busy or reached its temporary inference quota. Please try again shortly."
            16 -> "This GenAI capability is not supported on this device."
            4 -> "Request could not be processed by on-device safety or policy checks."
            501 -> "Not enough free storage space to download Gemini Nano."
            else -> "AICore error (${e.errorCode}): ${e.message ?: "Using built-in templates."}"
        }
    }
}

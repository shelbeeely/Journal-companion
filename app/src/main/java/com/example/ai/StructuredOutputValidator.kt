package com.example.ai

import com.example.model.JournalCadence
import com.example.model.ProposedProjectSetup
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class RawAiProjectProposal(
    val title: String? = null,
    val writingGoal: String? = null,
    val audience: String? = null,
    val cadence: String? = null,
    val pageSizeLabel: String? = null,
    val entryLengthLabel: String? = null,
    val themes: List<String> = emptyList(),
    val tonePreferences: String? = null,
    val boundaries: String? = null,
    val firstPrompt: String? = null,
    val firstHints: List<String> = emptyList(),
)

@Serializable
data class RawAiPromptResponse(
    val prompt: String? = null,
    val topicTag: String? = null,
    val hints: List<String> = emptyList(),
)

@Serializable
data class RawAiHintResponse(
    val hint: String? = null,
)

@Serializable
data class RawAiDraftAssistResponse(
    val suggestion: String? = null,
)

object StructuredOutputValidator {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    fun extractJsonBlock(raw: String): String? {
        val trimmed = raw.trim()
        val stripped = trimmed
            .removePrefix("```json")
            .removePrefix("```JSON")
            .removePrefix("```")
            .removeSuffix("```")
            .trim()
        val start = stripped.indexOf('{')
        val end = stripped.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return stripped.substring(start, end + 1)
    }

    fun validateProjectProposal(rawText: String): ProposedProjectSetup? {
        val block = extractJsonBlock(rawText) ?: return null
        val parsed = runCatching { json.decodeFromString<RawAiProjectProposal>(block) }.getOrNull()
            ?: return null

        val cleanTitle = parsed.title?.trim()?.take(48).orEmpty()
        val cleanGoal = parsed.writingGoal?.trim()?.take(200).orEmpty()
        val cleanPrompt = parsed.firstPrompt?.trim()?.take(240).orEmpty()
        if (cleanTitle.isBlank() || cleanGoal.isBlank() || cleanPrompt.isBlank()) {
            return null
        }

        val normalizedCadence = when (parsed.cadence?.trim()?.lowercase()) {
            "daily" -> JournalCadence.DAILY
            "weekly" -> JournalCadence.WEEKLY
            "whenever", "whenever i open it", "as needed", "flexible" -> JournalCadence.WHENEVER
            else -> null
        }

        val cleanThemes = parsed.themes
            .map { it.trim() }
            .filter { it.isNotBlank() && !it.equals("unknown", ignoreCase = true) && !it.equals("none", ignoreCase = true) }
            .distinct()
            .take(6)

        val cleanHints = parsed.firstHints
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .take(2)

        val pageSize = cleanNullable(parsed.pageSizeLabel)
        val (lines, words) = estimatePageGrid(pageSize)

        return ProposedProjectSetup(
            title = ensureDiscreetTitle(cleanTitle),
            writingGoal = cleanGoal,
            audience = cleanNullable(parsed.audience),
            cadence = normalizedCadence,
            pageSizeLabel = pageSize,
            entryLengthLabel = cleanNullable(parsed.entryLengthLabel),
            linesPerPage = lines,
            wordsPerLine = words,
            themes = cleanThemes,
            tonePreferences = cleanNullable(parsed.tonePreferences),
            boundaries = cleanNullable(parsed.boundaries),
            firstPrompt = cleanPrompt,
            firstHints = cleanHints,
            usedAiCore = true,
        )
    }

    fun validatePromptResponse(rawText: String, recentPrompts: List<String>): Pair<String, Pair<String, List<String>>>? {
        val block = extractJsonBlock(rawText) ?: return null
        val parsed = runCatching { json.decodeFromString<RawAiPromptResponse>(block) }.getOrNull()
            ?: return null
        val prompt = parsed.prompt?.trim()?.take(260).orEmpty()
        if (prompt.length < 12) return null

        // Reject if practically identical to a recent prompt
        val normalizedNew = prompt.lowercase().replace(Regex("[^a-z0-9 ]"), "")
        val isDuplicate = recentPrompts.any { old ->
            val normalizedOld = old.lowercase().replace(Regex("[^a-z0-9 ]"), "")
            normalizedOld == normalizedNew || normalizedOld.contains(normalizedNew) || normalizedNew.contains(normalizedOld)
        }
        if (isDuplicate) return null

        val topic = parsed.topicTag?.trim()?.lowercase()?.ifBlank { "reflection" } ?: "reflection"
        val hints = parsed.hints.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(2)
        return prompt to (topic to hints)
    }

    fun validateHintResponse(rawText: String): String? {
        val block = extractJsonBlock(rawText)
        if (block != null) {
            val parsed = runCatching { json.decodeFromString<RawAiHintResponse>(block) }.getOrNull()
            val hint = parsed?.hint?.trim()?.take(220)
            if (!hint.isNullOrBlank()) return hint
        }
        val plain = rawText.trim().removeSurrounding("\"")
        return plain.takeIf { it.length in 10..220 && !it.startsWith("{") }
    }

    fun validateDraftSuggestion(rawText: String): String? {
        val block = extractJsonBlock(rawText)
        if (block != null) {
            val parsed = runCatching { json.decodeFromString<RawAiDraftAssistResponse>(block) }.getOrNull()
            val suggestion = parsed?.suggestion?.trim()?.take(1200)
            if (!suggestion.isNullOrBlank()) return suggestion
        }
        val plain = rawText.trim().removeSurrounding("\"")
        return plain.takeIf { it.length in 8..1200 && !it.startsWith("{") }
    }

    private fun cleanNullable(value: String?): String? {
        val trimmed = value?.trim().orEmpty()
        if (trimmed.isBlank()) return null
        val lower = trimmed.lowercase()
        if (lower in setOf("null", "none", "unset", "unknown", "n/a", "not specified", "unspecified")) {
            return null
        }
        return trimmed
    }

    private fun ensureDiscreetTitle(candidate: String): String {
        val sensitiveTerms = listOf("psych", "hospital", "ward", "clinic", "inpatient", "mental")
        return if (sensitiveTerms.any { candidate.contains(it, ignoreCase = true) }) {
            "Pocket Pages"
        } else {
            candidate
        }
    }

    fun estimatePageGrid(pageSizeLabel: String?): Pair<Int, Int> {
        if (pageSizeLabel.isNullOrBlank()) return 18 to 8
        val lower = pageSizeLabel.lowercase()
        return when {
            lower.contains("3.25") || lower.contains("3.5") || lower.contains("mini") || lower.contains("pocket") -> 14 to 6
            lower.contains("a6") -> 16 to 7
            lower.contains("a5") || lower.contains("5") -> 22 to 8
            else -> 18 to 8
        }
    }
}

package com.example.ai

import com.example.model.AiAvailabilityState
import com.example.model.DraftSuggestion
import com.example.model.JournalProject
import com.example.model.PromptContextPayload
import com.example.model.PromptHistoryItem
import com.example.model.ProposedProjectSetup
import com.example.model.SuggestionKind
import com.example.model.WizardSeedInputs
import kotlinx.coroutines.flow.Flow

data class GeneratedPromptResult(
    val promptText: String,
    val topicTag: String,
    val hints: List<String>,
    val usedAiCore: Boolean,
    val statusNote: String? = null,
)

data class GeneratedHintResult(
    val hintText: String,
    val usedAiCore: Boolean,
    val statusNote: String? = null,
)

/**
 * Coordinates ML Kit GenAI Prompt API (AICore) with strict privacy scoping,
 * structured output validation, and complete fallback to built-in templates.
 */
class JournalAiOrchestrator(
    private val aiClient: OnDeviceAiClient,
) {
    suspend fun checkAvailability(): AiAvailabilityState = aiClient.checkAvailability()

    fun downloadModel(): Flow<AiAvailabilityState> = aiClient.downloadModel()

    fun close() = aiClient.close()

    fun createA2uiAgentEngine(): com.example.a2ui.DeskA2uiAgentEngine = com.example.a2ui.DeskA2uiAgentEngine(aiClient)

    suspend fun proposeProjectSetup(
        brief: String,
        wizardInputs: WizardSeedInputs? = null,
    ): ProposedProjectSetup {
        val systemInstruction = """
            You configure private journaling projects on-device. Return ONLY valid JSON with no markdown or commentary.
            Rules:
            - Leave unknown fields null (never invent audience, cadence, or pageSizeLabel if not mentioned).
            - Keep title short, calm, and discreet (never put medical/hospital/sensitive terms or private names in title).
            - firstPrompt must be one concrete question answerable on paper without re-explaining sensitive context.
            - Respect any explicit user preferences provided below.
        """.trimIndent()

        val wizardSection = buildString {
            if (wizardInputs != null) {
                val lines = listOfNotNull(
                    wizardInputs.cadence?.let { "Desired cadence: ${it.displayName}" },
                    wizardInputs.audience?.takeIf { it.isNotBlank() }?.let { "Audience: $it" },
                    wizardInputs.pageSizeLabel?.takeIf { it.isNotBlank() }?.let { "Physical page size: $it" },
                    wizardInputs.tonePreferences?.takeIf { it.isNotBlank() }?.let { "Tone preference: $it" },
                    wizardInputs.boundaries?.takeIf { it.isNotBlank() }?.let { "Boundaries: $it" },
                )
                if (lines.isNotEmpty()) {
                    appendLine("\n## User Preferences Selected in Wizard")
                    lines.forEach { appendLine("- $it") }
                }
            }
        }

        val userPrompt = """
            Analyze this journaling brief and return JSON with exact keys:
            title (string), writingGoal (one sentence string), audience (string or null),
            cadence ("daily"|"weekly"|"whenever"|null), pageSizeLabel (string or null),
            entryLengthLabel (string or null), themes (array of short strings),
            tonePreferences (string or null), boundaries (string or null),
            firstPrompt (string), firstHints (array of 1-2 short hints: a sentence starter or smaller recall question).

            ## Brief
            $brief
            $wizardSection
        """.trimIndent()

        return when (val result = aiClient.generate(systemInstruction, userPrompt, temperature = 0.25f, maxOutputTokens = 512)) {
            is AiGenerationResult.Success -> {
                val validated = StructuredOutputValidator.validateProjectProposal(result.text)
                if (validated != null) {
                    if (wizardInputs != null) {
                        val mergedPage = wizardInputs.pageSizeLabel?.takeIf { it.isNotBlank() } ?: validated.pageSizeLabel
                        validated.copy(
                            cadence = wizardInputs.cadence ?: validated.cadence,
                            audience = wizardInputs.audience?.takeIf { it.isNotBlank() } ?: validated.audience,
                            pageSizeLabel = mergedPage,
                            linesPerPage = wizardInputs.linesPerPage ?: validated.linesPerPage,
                            wordsPerLine = wizardInputs.wordsPerLine ?: validated.wordsPerLine,
                            tonePreferences = wizardInputs.tonePreferences?.takeIf { it.isNotBlank() } ?: validated.tonePreferences,
                            boundaries = wizardInputs.boundaries?.takeIf { it.isNotBlank() } ?: validated.boundaries,
                        )
                    } else {
                        validated
                    }
                } else {
                    FallbackPromptEngine.proposeSetupFromBrief(
                        brief = brief,
                        statusNote = "AICore output failed validation; applied structured template proposal.",
                        wizardInputs = wizardInputs,
                    )
                }
            }
            is AiGenerationResult.NeedsDownload -> FallbackPromptEngine.proposeSetupFromBrief(brief, result.message, wizardInputs)
            is AiGenerationResult.Unavailable -> FallbackPromptEngine.proposeSetupFromBrief(brief, result.reason, wizardInputs)
            is AiGenerationResult.BusyOrQuota -> FallbackPromptEngine.proposeSetupFromBrief(brief, result.message, wizardInputs)
            is AiGenerationResult.Failure -> FallbackPromptEngine.proposeSetupFromBrief(
                brief,
                "AICore unavailable for this request (${result.message}); using built-in template.",
                wizardInputs,
            )
            AiGenerationResult.Cancelled -> FallbackPromptEngine.proposeSetupFromBrief(brief, "AI analysis cancelled; template ready.", wizardInputs)
        }
    }

    suspend fun generateNextPrompt(
        project: JournalProject,
        recentHistory: List<PromptHistoryItem>,
        optedInPastAnswers: List<String>,
        enabledContext: PromptContextPayload,
        previousTopicToAvoid: String? = null,
    ): GeneratedPromptResult {
        val recentPrompts = recentHistory.map { it.promptText }
        val recentTopics = recentHistory.map { it.topicTag }

        val systemInstruction = """
            You are a quiet, thoughtful journaling prompt designer for physical notebooks.
            Return ONLY valid JSON: {"prompt": "...", "topicTag": "...", "hints": ["...", "..."]}.
            Rules:
            - Ask ONE concrete question answerable on paper.
            - Vary topic and wording from recent prompts.
            - Use only supplied details; never invent memories, dialogue, feelings, or day events.
            - Never ask the user to re-explain sensitive background. Never guess what was written on paper.
        """.trimIndent()

        val prompt = buildString {
            appendLine("## Project Settings")
            appendLine("Goal: ${project.writingGoal}")
            project.audience?.let { appendLine("Audience: $it") }
            project.cadence?.let { appendLine("Cadence: ${it.displayName}") }
            project.estimatedWordsPerPage?.let { appendLine("Target page size: ${project.pageSizeLabel} (~$it words, advisory only)") }
            if (project.themes.isNotEmpty()) appendLine("Themes: ${project.themes.joinToString(", ")}")
            project.tonePreferences?.let { appendLine("Tone: $it") }
            project.boundaries?.let { appendLine("Boundaries: $it") }

            if (recentHistory.isNotEmpty()) {
                appendLine("\n## Recent Prompts to Avoid Repeating")
                recentHistory.take(8).forEach { appendLine("- [${it.topicTag}] ${it.promptText}") }
            }
            previousTopicToAvoid?.let { appendLine("Avoid topic: $it") }

            if (project.includePastAnswersInPrompts && optedInPastAnswers.isNotEmpty()) {
                appendLine("\n## Opted-In Previous Typed Notes")
                optedInPastAnswers.take(3).forEach { appendLine("- ${it.take(180)}") }
            }

            if (enabledContext.dateTimeText != null || enabledContext.weatherSummary != null) {
                appendLine("\n## Optional Enabled Context")
                enabledContext.dateTimeText?.let { appendLine("Date/Time: $it") }
                enabledContext.weatherSummary?.let { w ->
                    val ts = enabledContext.weatherFetchedTimestamp?.let { " (fetched $it)" }.orEmpty()
                    appendLine("Weather: $w$ts")
                }
            }
        }

        return when (val result = aiClient.generate(systemInstruction, prompt, temperature = 0.65f, maxOutputTokens = 280)) {
            is AiGenerationResult.Success -> {
                val parsed = StructuredOutputValidator.validatePromptResponse(result.text, recentPrompts)
                if (parsed != null) {
                    GeneratedPromptResult(
                        promptText = parsed.first,
                        topicTag = parsed.second.first,
                        hints = parsed.second.second,
                        usedAiCore = true,
                    )
                } else {
                    fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, "Used curated prompt fallback.")
                }
            }
            is AiGenerationResult.NeedsDownload -> fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, result.message)
            is AiGenerationResult.Unavailable -> fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, null)
            is AiGenerationResult.BusyOrQuota -> fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, result.message)
            is AiGenerationResult.Failure -> fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, result.message)
            AiGenerationResult.Cancelled -> fallbackPrompt(project, recentPrompts, recentTopics, enabledContext, previousTopicToAvoid, "Cancelled; kept local prompt.")
        }
    }

    suspend fun generateHint(
        project: JournalProject,
        currentPrompt: String,
        existingHints: List<String>,
    ): GeneratedHintResult {
        val systemInstruction = """
            Return ONLY JSON: {"hint": "..."}.
            Provide either one short sentence starter OR one smaller recall question directly relevant to the current prompt.
            Respect tone and boundaries. Never invent memories.
        """.trimIndent()

        val prompt = buildString {
            appendLine("## Prompt")
            appendLine(currentPrompt)
            project.tonePreferences?.let { appendLine("Tone: $it") }
            project.boundaries?.let { appendLine("Boundaries: $it") }
            if (existingHints.isNotEmpty()) {
                appendLine("Already shown hints (give a different angle):")
                existingHints.forEach { appendLine("- $it") }
            }
        }

        return when (val result = aiClient.generate(systemInstruction, prompt, temperature = 0.5f, maxOutputTokens = 140)) {
            is AiGenerationResult.Success -> {
                val validated = StructuredOutputValidator.validateHintResponse(result.text)
                if (validated != null && validated !in existingHints) {
                    GeneratedHintResult(hintText = validated, usedAiCore = true)
                } else {
                    GeneratedHintResult(
                        hintText = FallbackPromptEngine.generateFallbackHint(currentPrompt, existingHints),
                        usedAiCore = false,
                    )
                }
            }
            is AiGenerationResult.BusyOrQuota -> GeneratedHintResult(
                hintText = FallbackPromptEngine.generateFallbackHint(currentPrompt, existingHints),
                usedAiCore = false,
                statusNote = result.message,
            )
            else -> GeneratedHintResult(
                hintText = FallbackPromptEngine.generateFallbackHint(currentPrompt, existingHints),
                usedAiCore = false,
            )
        }
    }

    suspend fun helpStartDraft(
        project: JournalProject,
        currentPrompt: String,
    ): DraftSuggestion {
        val systemInstruction = """
            Return ONLY JSON: {"suggestion": "..."}.
            Write a gentle 1-2 sentence opening starter to help the user begin answering the prompt in their own voice.
            Leave room for the user to finish the thought. Never invent fake memories.
        """.trimIndent()

        val prompt = buildString {
            appendLine("Prompt: $currentPrompt")
            project.tonePreferences?.let { appendLine("Tone: $it") }
            project.boundaries?.let { appendLine("Boundaries: $it") }
        }

        return when (val result = aiClient.generate(systemInstruction, prompt, temperature = 0.5f, maxOutputTokens = 160)) {
            is AiGenerationResult.Success -> {
                val text = StructuredOutputValidator.validateDraftSuggestion(result.text)
                if (text != null) {
                    DraftSuggestion(SuggestionKind.HELP_START, text, usedAiCore = true)
                } else {
                    DraftSuggestion(
                        SuggestionKind.HELP_START,
                        FallbackPromptEngine.generateFallbackStart(project, currentPrompt),
                        usedAiCore = false,
                    )
                }
            }
            is AiGenerationResult.BusyOrQuota -> DraftSuggestion(
                SuggestionKind.HELP_START,
                FallbackPromptEngine.generateFallbackStart(project, currentPrompt),
                usedAiCore = false,
                note = result.message,
            )
            else -> DraftSuggestion(
                SuggestionKind.HELP_START,
                FallbackPromptEngine.generateFallbackStart(project, currentPrompt),
                usedAiCore = false,
            )
        }
    }

    suspend fun tightenDraft(
        project: JournalProject,
        currentPrompt: String,
        currentDraft: String,
    ): DraftSuggestion {
        val targetNote = project.estimatedWordsPerPage?.let { "Target around ~$it words if natural, without cutting core meaning." }.orEmpty()
        val systemInstruction = """
            Return ONLY JSON: {"suggestion": "..."}.
            Lightly tighten and clarify the user's draft while preserving their authentic voice, facts, and emotional warmth.
            Never invent details not in the draft. $targetNote
        """.trimIndent()

        val prompt = buildString {
            appendLine("Prompt: $currentPrompt")
            project.tonePreferences?.let { appendLine("Tone: $it") }
            appendLine("## User Draft")
            appendLine(currentDraft)
        }

        return when (val result = aiClient.generate(systemInstruction, prompt, temperature = 0.3f, maxOutputTokens = 320)) {
            is AiGenerationResult.Success -> {
                val text = StructuredOutputValidator.validateDraftSuggestion(result.text)
                if (text != null) {
                    DraftSuggestion(SuggestionKind.TIGHTEN_DRAFT, text, usedAiCore = true)
                } else {
                    DraftSuggestion(
                        SuggestionKind.TIGHTEN_DRAFT,
                        FallbackPromptEngine.generateFallbackTighten(currentDraft, project.estimatedWordsPerPage),
                        usedAiCore = false,
                    )
                }
            }
            is AiGenerationResult.BusyOrQuota -> DraftSuggestion(
                SuggestionKind.TIGHTEN_DRAFT,
                FallbackPromptEngine.generateFallbackTighten(currentDraft, project.estimatedWordsPerPage),
                usedAiCore = false,
                note = result.message,
            )
            else -> DraftSuggestion(
                SuggestionKind.TIGHTEN_DRAFT,
                FallbackPromptEngine.generateFallbackTighten(currentDraft, project.estimatedWordsPerPage),
                usedAiCore = false,
            )
        }
    }

    private fun fallbackPrompt(
        project: JournalProject,
        recentPrompts: List<String>,
        recentTopics: List<String>,
        enabledContext: PromptContextPayload,
        previousTopicToAvoid: String?,
        note: String?,
    ): GeneratedPromptResult {
        val (q, tag, hints) = FallbackPromptEngine.generateFallbackPrompt(
            project = project,
            recentPrompts = recentPrompts,
            recentTopics = recentTopics,
            enabledContext = enabledContext,
            previousTopicToAvoid = previousTopicToAvoid,
        )
        return GeneratedPromptResult(
            promptText = q,
            topicTag = tag,
            hints = hints,
            usedAiCore = false,
            statusNote = note,
        )
    }
}

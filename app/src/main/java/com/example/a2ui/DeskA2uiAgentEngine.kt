package com.example.a2ui

import com.example.ai.AiGenerationResult
import com.example.ai.OnDeviceAiClient
import com.example.ai.StructuredOutputValidator
import com.example.model.AiAvailabilityState
import com.example.model.DeskContextSnapshot
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

object DeskA2uiActions {
    const val USE_STARTER = "use_starter"
    const val NEXT_ANGLE = "next_angle"
    const val START_FOCUS = "start_focus"
    const val REFRESH_SURFACE = "refresh_surface"
    const val DISMISS_SURFACE = "dismiss_surface"
}

@Serializable
private data class RawAiDeskCues(
    val starterLine: String? = null,
    val recallCue: String? = null,
    val ambientCue: String? = null,
    val briefDigest: String? = null,
)

data class A2uiSynthesisBatch(
    val messages: List<String>,
    val usedAiCore: Boolean,
)

/**
 * Generates declarative A2UI v0.9.1 JSON protocol payloads (`createSurface`, `updateComponents`, `updateDataModel`)
 * using on-device AICore when ready, with instant deterministic A2UI payload fallback.
 */
class DeskA2uiAgentEngine(
    private val aiClient: OnDeviceAiClient? = null,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    suspend fun synthesizeSurface(
        snapshot: DeskContextSnapshot,
        surfaceId: String = "desk_proactive_surface",
        interactiveMode: Boolean = true,
        allowAiCore: Boolean = true,
    ): A2uiSynthesisBatch {
        var usedAi = false
        var aiStarter: String? = null
        var aiRecall: String? = null
        var aiAmbient: String? = null
        var aiBriefDigest: String? = null

        val client = aiClient
        if (allowAiCore && client != null) {
            val availability = runCatching { client.checkAvailability() }.getOrNull()
            if (availability == AiAvailabilityState.Available) {
                val synthesized = trySynthesizeCuesWithAiCore(snapshot)
                if (synthesized != null) {
                    usedAi = true
                    aiStarter = synthesized.starterLine?.takeIf { it.isNotBlank() }
                    aiRecall = synthesized.recallCue?.takeIf { it.isNotBlank() }
                    aiAmbient = synthesized.ambientCue?.takeIf { it.isNotBlank() }
                    aiBriefDigest = synthesized.briefDigest?.takeIf { it.isNotBlank() }
                }
            }
        }

        val messages = buildProtocolMessages(
            snapshot = snapshot,
            surfaceId = surfaceId,
            interactiveMode = interactiveMode,
            usedAiCore = usedAi,
            aiStarterOverride = aiStarter,
            aiRecallOverride = aiRecall,
            aiAmbientOverride = aiAmbient,
            aiBriefDigestOverride = aiBriefDigest,
        )
        return A2uiSynthesisBatch(messages = messages, usedAiCore = usedAi)
    }

    fun buildDeterministicMessages(
        snapshot: DeskContextSnapshot,
        surfaceId: String = "desk_proactive_surface",
        interactiveMode: Boolean = true,
    ): List<String> = buildProtocolMessages(
        snapshot = snapshot,
        surfaceId = surfaceId,
        interactiveMode = interactiveMode,
        usedAiCore = false,
        aiStarterOverride = null,
        aiRecallOverride = null,
        aiAmbientOverride = null,
        aiBriefDigestOverride = null,
    )

    private suspend fun trySynthesizeCuesWithAiCore(snapshot: DeskContextSnapshot): RawAiDeskCues? {
        val client = aiClient ?: return null
        val systemInstruction = """
            You power an on-device Android Jetpack Compose A2UI desk surface for physical notebook writers.
            Return ONLY JSON with optional short fields:
            {"starterLine":"...", "recallCue":"...", "ambientCue":"...", "briefDigest":"..."}
            Rules:
            - Keep each string calm, concrete, under 140 characters, ADHD-friendly, zero fluff.
            - Respect all boundaries and tone preferences.
            - Never invent memories or fake weather numbers.
        """.trimIndent()

        val prompt = buildString {
            appendLine("Question: ${snapshot.promptText}")
            appendLine("Goal: ${snapshot.writingGoal}")
            if (!snapshot.discreetMode) {
                snapshot.audience?.let { appendLine("Audience: $it") }
                snapshot.tonePreferences?.let { appendLine("Tone: $it") }
                snapshot.boundaries?.let { appendLine("Boundaries: $it") }
                if (snapshot.originalBrief.isNotBlank()) {
                    appendLine("Brief: ${snapshot.originalBrief.take(400)}")
                }
                snapshot.recentNoteExcerpt?.let { appendLine("Prior note: $it") }
            }
            if (snapshot.untappedThemes.isNotEmpty()) {
                appendLine("Untapped themes: ${snapshot.untappedThemes.joinToString(", ")}")
            }
            appendLine("Window: ${snapshot.writingWindowCue} (${snapshot.formattedTime})")
            snapshot.weatherSummary?.let { appendLine("Weather: $it") }
            snapshot.daylightSummary?.let { appendLine("Daylight: $it") }
        }

        return when (val res = client.generate(systemInstruction, prompt, temperature = 0.35f, maxOutputTokens = 220)) {
            is AiGenerationResult.Success -> {
                val block = StructuredOutputValidator.extractJsonBlock(res.text) ?: return null
                runCatching { json.decodeFromString<RawAiDeskCues>(block) }.getOrNull()
            }
            else -> null
        }
    }

    private fun buildProtocolMessages(
        snapshot: DeskContextSnapshot,
        surfaceId: String,
        interactiveMode: Boolean,
        usedAiCore: Boolean,
        aiStarterOverride: String?,
        aiRecallOverride: String?,
        aiAmbientOverride: String?,
        aiBriefDigestOverride: String?,
    ): List<String> {
        val eyebrowIntent = if (snapshot.discreetMode) "Quiet Desk Compass" else "Project Context"
        val goalText = snapshot.writingGoal.ifBlank { "Capture one grounded reflection on paper." }
        val audienceVal = if (snapshot.discreetMode) "" else snapshot.audience.orEmpty()
        val toneVal = if (snapshot.discreetMode) "" else snapshot.tonePreferences.orEmpty()
        val boundariesVal = if (snapshot.discreetMode) "" else snapshot.boundaries.orEmpty()
        val briefText = if (snapshot.discreetMode) {
            ""
        } else {
            aiBriefDigestOverride ?: snapshot.originalBrief.trim().take(280)
        }

        val starterVal = aiStarterOverride
            ?: snapshot.activeStarter
            ?: defaultStarterForSnapshot(snapshot)
        val recallVal = aiRecallOverride
            ?: snapshot.recallQuestion
            ?: defaultRecallForSnapshot(snapshot)

        val continuityTitle = when {
            snapshot.discreetMode -> "Discreet continuity"
            snapshot.recentNoteExcerpt != null -> "Thread from ${snapshot.recentNoteDayLabel ?: "recent note"}"
            snapshot.sessionNumber <= 1 -> "Fresh notebook start"
            else -> "Session #${snapshot.sessionNumber} continuity"
        }
        val continuityBody = when {
            snapshot.discreetMode -> "Brief, recipient, and draft excerpts are hidden while Discreet Mode is active."
            snapshot.recentNoteExcerpt != null && snapshot.includePastAnswersInPrompts ->
                "Recent thread: \"${snapshot.recentNoteExcerpt}\""
            snapshot.recentNoteExcerpt != null ->
                "Recent draft saved (${snapshot.recentNoteDayLabel ?: "earlier"}): \"${snapshot.recentNoteExcerpt}\""
            snapshot.sessionNumber <= 1 ->
                "Session #1 — put one honest scene on paper or capture an opening phrase."
            else ->
                "${snapshot.completedPagesCount} page${if (snapshot.completedPagesCount == 1) "" else "s"} completed so far."
        }

        val sessionTitle = "Session #${snapshot.sessionNumber} · ${snapshot.completedPagesCount} done"
        val cadenceSummary = when {
            snapshot.todayCompleted && snapshot.cadenceLabel != null -> "${snapshot.cadenceLabel} rhythm · Today complete"
            snapshot.cadenceLabel != null -> "${snapshot.cadenceLabel} rhythm · Ready for today's page"
            snapshot.todayCompleted -> "Today's page complete"
            else -> "Open notebook pace"
        }
        val pageEstimateSummary = snapshot.estimatedWordsPerPage?.let { est ->
            "${snapshot.pageSizeLabel ?: "Page"} · ~$est words (${snapshot.linesPerPage} lines × ${snapshot.wordsPerLine}w)"
        }.orEmpty()
        val progressFraction = snapshot.estimatedWordsPerPage?.let { est ->
            if (snapshot.draftWordCount > 0) (snapshot.draftWordCount.toFloat() / est.toFloat()).coerceIn(0f, 1f) else 0f
        } ?: 0f
        val draftProgressLabel = if (snapshot.draftWordCount > 0 && snapshot.estimatedWordsPerPage != null) {
            "Draft: ${snapshot.draftWordCount} / ~${snapshot.estimatedWordsPerPage} words"
        } else {
            ""
        }

        val dayWindow = "${snapshot.writingWindowCue} · ${snapshot.formattedTime}"
        val ambientDetail = aiAmbientOverride ?: listOfNotNull(
            snapshot.daylightSummary,
            snapshot.weatherSummary?.let { w -> if (snapshot.isWeatherStale) "$w (cached)" else w },
            snapshot.calendarRhythmLabel.takeIf { snapshot.daylightSummary == null && snapshot.weatherSummary == null },
        ).joinToString(" · ").ifBlank { snapshot.calendarRhythmLabel }
        val engineBadge = if (usedAiCore) "AICore A2UI" else "A2UI"

        val childIds = buildList {
            add("intent_card")
            add("starter_card")
            if (snapshot.untappedThemes.isNotEmpty() || snapshot.coveredThemes.isNotEmpty() || pageEstimateSummary.isNotBlank() || snapshot.sessionNumber > 1) {
                add("theme_pace_card")
            }
            add("ambient_window_card")
        }

        val componentsArray = buildJsonArray {
            add(
                buildJsonObject {
                    put("id", "root")
                    put("component", "DeskColumn")
                    put("children", JsonArray(childIds.map { JsonPrimitive(it) }))
                    put("spacingDp", "8")
                },
            )

            add(
                buildJsonObject {
                    put("id", "intent_card")
                    put("component", "DeskIntentCard")
                    put("eyebrow", pathRef("/desk/intent/eyebrow"))
                    put("goal", pathRef("/desk/intent/goal"))
                    put("audience", pathRef("/desk/intent/audience"))
                    put("tone", pathRef("/desk/intent/tone"))
                    put("boundaries", pathRef("/desk/intent/boundaries"))
                    put("briefHighlights", pathRef("/desk/intent/briefHighlights"))
                },
            )

            add(
                buildJsonObject {
                    put("id", "starter_card")
                    put("component", "DeskStarterCard")
                    put("eyebrow", pathRef("/desk/starter/eyebrow"))
                    put("starterText", pathRef("/desk/starter/starterText"))
                    put("recallQuestion", pathRef("/desk/starter/recallQuestion"))
                    put("continuityTitle", pathRef("/desk/starter/continuityTitle"))
                    put("continuityBody", pathRef("/desk/starter/continuityBody"))
                    put("interactiveMode", interactiveMode.toString())
                    putJsonObject("useStarterAction") {
                        putJsonObject("event") {
                            put("name", DeskA2uiActions.USE_STARTER)
                            putJsonObject("context") {
                                put("starterText", pathRef("/desk/starter/starterText"))
                            }
                        }
                    }
                    putJsonObject("nextAngleAction") {
                        putJsonObject("event") {
                            put("name", DeskA2uiActions.NEXT_ANGLE)
                        }
                    }
                    putJsonObject("startFocusAction") {
                        putJsonObject("event") {
                            put("name", DeskA2uiActions.START_FOCUS)
                        }
                    }
                },
            )

            if ("theme_pace_card" in childIds) {
                add(
                    buildJsonObject {
                        put("id", "theme_pace_card")
                        put("component", "DeskThemePace")
                        put("sessionTitle", pathRef("/desk/pace/sessionTitle"))
                        put("cadenceSummary", pathRef("/desk/pace/cadenceSummary"))
                        put("pageEstimateSummary", pathRef("/desk/pace/pageEstimateSummary"))
                        put("draftProgressLabel", pathRef("/desk/pace/draftProgressLabel"))
                        put("progressFraction", pathRef("/desk/pace/progressFraction"))
                        put("untappedThemesCsv", pathRef("/desk/pace/untappedThemesCsv"))
                        put("coveredThemesCsv", pathRef("/desk/pace/coveredThemesCsv"))
                    },
                )
            }

            add(
                buildJsonObject {
                    put("id", "ambient_window_card")
                    put("component", "DeskAmbientWindow")
                    put("dayWindow", pathRef("/desk/ambient/dayWindow"))
                    put("ambientDetail", pathRef("/desk/ambient/ambientDetail"))
                    put("engineBadge", pathRef("/desk/ambient/engineBadge"))
                    put("interactiveMode", interactiveMode.toString())
                    putJsonObject("refreshAction") {
                        putJsonObject("event") {
                            put("name", DeskA2uiActions.REFRESH_SURFACE)
                        }
                    }
                    putJsonObject("dismissAction") {
                        putJsonObject("event") {
                            put("name", DeskA2uiActions.DISMISS_SURFACE)
                        }
                    }
                },
            )
        }

        val createSurfaceJson = buildJsonObject {
            put("version", "v0.9")
            putJsonObject("createSurface") {
                put("surfaceId", surfaceId)
                put("catalogId", DeskA2uiCatalog.DESK_CATALOG_ID)
                put("sendDataModel", true)
            }
        }

        val updateComponentsJson = buildJsonObject {
            put("version", "v0.9")
            putJsonObject("updateComponents") {
                put("surfaceId", surfaceId)
                put("components", componentsArray)
            }
        }

        val updateDataModelJson = buildJsonObject {
            put("version", "v0.9")
            putJsonObject("updateDataModel") {
                put("surfaceId", surfaceId)
                put("path", "/desk")
                putJsonObject("value") {
                    putJsonObject("intent") {
                        put("eyebrow", eyebrowIntent)
                        put("goal", goalText)
                        put("audience", audienceVal)
                        put("tone", toneVal)
                        put("boundaries", boundariesVal)
                        put("briefHighlights", briefText)
                    }
                    putJsonObject("starter") {
                        put("eyebrow", "Momentum & Sparks")
                        put("starterText", starterVal)
                        put("recallQuestion", recallVal)
                        put("continuityTitle", continuityTitle)
                        put("continuityBody", continuityBody)
                    }
                    putJsonObject("pace") {
                        put("sessionTitle", sessionTitle)
                        put("cadenceSummary", cadenceSummary)
                        put("pageEstimateSummary", pageEstimateSummary)
                        put("draftProgressLabel", draftProgressLabel)
                        put("progressFraction", progressFraction.toString())
                        put("untappedThemesCsv", snapshot.untappedThemes.joinToString("|"))
                        put("coveredThemesCsv", snapshot.coveredThemes.joinToString("|"))
                    }
                    putJsonObject("ambient") {
                        put("dayWindow", dayWindow)
                        put("ambientDetail", ambientDetail)
                        put("engineBadge", engineBadge)
                    }
                }
            }
        }

        return listOf(
            json.encodeToString(JsonObject.serializer(), createSurfaceJson),
            json.encodeToString(JsonObject.serializer(), updateComponentsJson),
            json.encodeToString(JsonObject.serializer(), updateDataModelJson),
        )
    }

    private fun pathRef(path: String): JsonObject = buildJsonObject {
        put("path", path)
    }

    private fun defaultStarterForSnapshot(snapshot: DeskContextSnapshot): String {
        val themeHint = snapshot.untappedThemes.firstOrNull()
        return when {
            themeHint != null -> "One ordinary moment around $themeHint that stood out today was..."
            snapshot.sessionNumber == 1 -> "Start small on the page: Today, a detail worth keeping is..."
            else -> "Without overthinking it, one concrete thing I noticed is..."
        }
    }

    private fun defaultRecallForSnapshot(snapshot: DeskContextSnapshot): String {
        return when (snapshot.dayPartLabel.lowercase()) {
            "morning" -> "What is one small texture, sound, or routine from this morning?"
            "evening", "night" -> "What is one quiet moment from today you'd want to remember next week?"
            else -> "Who or what crossed your mind for a brief second today?"
        }
    }
}

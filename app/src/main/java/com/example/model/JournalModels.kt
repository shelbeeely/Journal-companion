package com.example.model

import kotlinx.serialization.Serializable

@Serializable
enum class JournalCadence(val displayName: String) {
    DAILY("Daily"),
    WEEKLY("Weekly"),
    WHENEVER("Whenever I open it"),
}

@Serializable
data class JournalProject(
    val id: Long = 0L,
    val title: String,
    val writingGoal: String,
    val originalBrief: String,
    val audience: String? = null,
    val cadence: JournalCadence? = null,
    val pageSizeLabel: String? = null,
    val entryLengthLabel: String? = null,
    val linesPerPage: Int = 14,
    val wordsPerLine: Int = 6,
    val themes: List<String> = emptyList(),
    val tonePreferences: String? = null,
    val boundaries: String? = null,
    val includePastAnswersInPrompts: Boolean = false,
    val showDateTimeCard: Boolean = true,
    val showWeatherCard: Boolean = true,
    val showSparksCard: Boolean = true,
    val showRhythmCard: Boolean = true,
    val showTimerCard: Boolean = true,
    val includeDateTimeInPrompt: Boolean = false,
    val includeWeatherInPrompt: Boolean = false,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
    val updatedAtEpochMs: Long = System.currentTimeMillis(),
) {
    val estimatedWordsPerPage: Int?
        get() = if (pageSizeLabel.isNullOrBlank()) null else (linesPerPage * wordsPerLine).coerceAtLeast(10)

    val showA2uiCompanionCard: Boolean
        get() = showSparksCard || showRhythmCard
}

@Serializable
data class ProposedProjectSetup(
    val title: String = "",
    val writingGoal: String = "",
    val audience: String? = null,
    val cadence: JournalCadence? = null,
    val pageSizeLabel: String? = null,
    val entryLengthLabel: String? = null,
    val linesPerPage: Int = 14,
    val wordsPerLine: Int = 6,
    val themes: List<String> = emptyList(),
    val tonePreferences: String? = null,
    val boundaries: String? = null,
    val firstPrompt: String = "",
    val firstHints: List<String> = emptyList(),
    val usedAiCore: Boolean = false,
    val statusNote: String? = null,
)

data class WizardSeedInputs(
    val cadence: JournalCadence? = null,
    val audience: String? = null,
    val pageSizeLabel: String? = null,
    val linesPerPage: Int? = null,
    val wordsPerLine: Int? = null,
    val tonePreferences: String? = null,
    val boundaries: String? = null,
)

@Serializable
data class JournalEntry(
    val id: Long = 0L,
    val projectId: Long,
    val dateIso: String,
    val promptText: String,
    val promptTopicTag: String = "general",
    val hints: List<String> = emptyList(),
    val draftText: String = "",
    val isCompleted: Boolean = false,
    val completedAtEpochMs: Long? = null,
    val updatedAtEpochMs: Long = System.currentTimeMillis(),
)

@Serializable
data class PromptHistoryItem(
    val id: Long = 0L,
    val projectId: Long,
    val dateIso: String,
    val promptText: String,
    val topicTag: String,
    val createdAtEpochMs: Long = System.currentTimeMillis(),
)

enum class SuggestionKind {
    HELP_START,
    TIGHTEN_DRAFT,
}

data class DraftSuggestion(
    val kind: SuggestionKind,
    val suggestedText: String,
    val usedAiCore: Boolean,
    val note: String? = null,
)

@Serializable
data class WeatherSnapshot(
    val cityLabel: String,
    val latitudeRounded: Double,
    val longitudeRounded: Double,
    val conditionLabel: String,
    val wmoCode: Int,
    val temperatureCelsius: Double,
    val highCelsius: Double,
    val lowCelsius: Double,
    val precipitationChancePercent: Int?,
    val precipitationPeriodLabel: String?,
    val fetchedAtEpochMs: Long,
    val feelsLikeCelsius: Double? = null,
    val windSpeedKmh: Double? = null,
    val sunriseIso: String? = null,
    val sunsetIso: String? = null,
    val uvIndexMax: Double? = null,
    val isDaytime: Boolean? = null,
) {
    fun isStale(nowEpochMs: Long = System.currentTimeMillis(), thresholdMs: Long = STALE_THRESHOLD_MS): Boolean {
        return (nowEpochMs - fetchedAtEpochMs) > thresholdMs
    }

    companion object {
        const val STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000L // 2 hours
    }
}

/**
 * Proactive summary surfaced immediately in Desk Mode without user action,
 * strictly respecting discreet boundaries and paper-mode honesty.
 */
data class ProactiveDeskPulse(
    val sessionNumber: Int = 1,
    val completedPagesCount: Int = 0,
    val currentAngleLabel: String = "Opening prompt",
    val untappedTheme: String? = null,
    val continuityCue: String = "Fresh session ready",
    val paceCue: String? = null,
    val starterPeek: String? = null,
    val draftWordCount: Int = 0,
    val daylightCue: String? = null,
)

enum class FocusPhase(val label: String) {
    FOCUS("Focus sprint"),
    BREAK("Short break"),
}

data class FocusTimerState(
    val phase: FocusPhase = FocusPhase.FOCUS,
    val presetMinutes: Int = 15,
    val remainingSeconds: Int = 15 * 60,
    val totalSeconds: Int = 15 * 60,
    val isRunning: Boolean = false,
    val completedFocusBlocksToday: Int = 0,
    val justFinishedPhase: FocusPhase? = null,
) {
    val progressFraction: Float
        get() = if (totalSeconds <= 0) 0f else ((totalSeconds - remainingSeconds).toFloat() / totalSeconds.toFloat()).coerceIn(0f, 1f)
}

/**
 * Extensible architecture for Desk Mode information cards.
 * Each card surfaces contextual or project-level data without altering the layout or privacy boundaries.
 */
sealed interface DeskCardSlot {
    val id: String
    val label: String
    val isVisible: Boolean
    val includeInPrompt: Boolean

    data class FocusTimerCard(
        override val isVisible: Boolean,
        val timerState: FocusTimerState,
    ) : DeskCardSlot {
        override val id: String = "focus_timer"
        override val label: String = "Focus Timer"
        override val includeInPrompt: Boolean = false
    }

    data class DateTimeCard(
        override val isVisible: Boolean,
        override val includeInPrompt: Boolean,
        val formattedDate: String,
        val formattedTime: String,
        val dayPartLabel: String,
        val writingWindowCue: String = "",
        val calendarRhythmLabel: String = "",
        val daylightSummary: String? = null,
    ) : DeskCardSlot {
        override val id: String = "date_time"
        override val label: String = "Date & Time"
    }

    data class WeatherCard(
        override val isVisible: Boolean,
        override val includeInPrompt: Boolean,
        val snapshot: WeatherSnapshot?,
        val isLoading: Boolean,
        val errorMessage: String?,
        val useCelsius: Boolean,
        val isStale: Boolean,
    ) : DeskCardSlot {
        override val id: String = "weather"
        override val label: String = "Weather"
    }

    data class SparksCard(
        override val isVisible: Boolean,
        val activeStarter: String?,
        val recallQuestion: String?,
        val continuityTitle: String,
        val continuityBody: String,
        val isPastNoteOptedIn: Boolean,
        val isGeneratingSpark: Boolean,
    ) : DeskCardSlot {
        override val id: String = "sparks"
        override val label: String = "Writing Sparks"
        override val includeInPrompt: Boolean = false
    }

    data class RhythmCard(
        override val isVisible: Boolean,
        val sessionNumber: Int,
        val completedCount: Int,
        val cadenceLabel: String?,
        val cadenceStatus: String,
        val coveredThemes: List<String>,
        val untappedThemes: List<String>,
        val pageSizeLabel: String?,
        val estimatedWordsPerPage: Int?,
        val linesPerPage: Int,
        val wordsPerLine: Int,
        val draftWordCount: Int,
    ) : DeskCardSlot {
        override val id: String = "rhythm"
        override val label: String = "Notebook Rhythm"
        override val includeInPrompt: Boolean = false
    }

    data class A2uiCompanionCard(
        override val isVisible: Boolean,
        val surfaceId: String = "desk_proactive_surface",
        val isDismissedForWindow: Boolean = false,
        val usedAiCore: Boolean = false,
        val dayPartLabel: String = "",
    ) : DeskCardSlot {
        override val id: String = "a2ui_companion"
        override val label: String = "A2UI Desk Companion"
        override val includeInPrompt: Boolean = false
    }
}

data class DeskContextSnapshot(
    val projectId: Long,
    val projectTitle: String,
    val writingGoal: String,
    val originalBrief: String,
    val audience: String?,
    val cadenceLabel: String?,
    val tonePreferences: String?,
    val boundaries: String?,
    val promptText: String,
    val promptTopicLabel: String,
    val activeStarter: String?,
    val recallQuestion: String?,
    val coveredThemes: List<String>,
    val untappedThemes: List<String>,
    val sessionNumber: Int,
    val completedPagesCount: Int,
    val todayCompleted: Boolean,
    val pageSizeLabel: String?,
    val estimatedWordsPerPage: Int?,
    val linesPerPage: Int,
    val wordsPerLine: Int,
    val draftWordCount: Int,
    val recentNoteExcerpt: String?,
    val recentNoteDayLabel: String?,
    val includePastAnswersInPrompts: Boolean,
    val dayPartLabel: String,
    val writingWindowCue: String,
    val calendarRhythmLabel: String,
    val formattedDate: String,
    val formattedTime: String,
    val daylightSummary: String?,
    val weatherSummary: String?,
    val isWeatherStale: Boolean,
    val discreetMode: Boolean,
)

data class PromptContextPayload(
    val dateTimeText: String? = null,
    val weatherSummary: String? = null,
    val weatherFetchedTimestamp: String? = null,
)

enum class AppThemeMode(val displayName: String) {
    SYSTEM("System"),
    LIGHT("Warm Light"),
    DARK("Soft Dark"),
}

enum class ScreenSaverMode(val displayName: String) {
    FULL_A2UI("Full A2UI Companion"),
    CLOCK_AND_WEATHER_ONLY("Clock & Weather Only"),
}

data class DeskUiPreferences(
    val lastActiveProjectId: Long? = null,
    val keepScreenAwakeInDeskMode: Boolean = true,
    val themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    val dimDeskModeEnabled: Boolean = false,
    val hideInRecentsEnabled: Boolean = true,
    val useCelsius: Boolean = false,
    val manualCityQuery: String? = null,
    val discreetDeskModeEnabled: Boolean = false,
    val screenSaverMode: ScreenSaverMode = ScreenSaverMode.FULL_A2UI,
    val screenSaverDimBrightness: Boolean = true,
)

sealed interface AiAvailabilityState {
    data object Checking : AiAvailabilityState
    data object Available : AiAvailabilityState
    data class Downloadable(val isDownloading: Boolean = false, val bytesDownloaded: Long = 0L) : AiAvailabilityState
    data class Unavailable(val reason: String) : AiAvailabilityState
    data class Error(val message: String) : AiAvailabilityState
}

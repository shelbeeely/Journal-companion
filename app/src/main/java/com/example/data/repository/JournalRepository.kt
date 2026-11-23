package com.example.data.repository

import com.example.ai.GeneratedHintResult
import com.example.ai.JournalAiOrchestrator
import com.example.data.local.JournalDao
import com.example.data.local.JournalEntryEntity
import com.example.data.local.JournalProjectEntity
import com.example.data.local.PromptHistoryEntity
import com.example.data.preferences.AppPreferencesRepository
import com.example.model.AiAvailabilityState
import com.example.model.AppThemeMode
import com.example.model.DeskUiPreferences
import com.example.model.DraftSuggestion
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.model.PromptContextPayload
import com.example.model.PromptHistoryItem
import com.example.model.ProposedProjectSetup
import com.example.model.ScreenSaverMode
import com.example.model.WeatherSnapshot
import com.example.model.WizardSeedInputs
import com.example.weather.WeatherRepository
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class JournalRepository(
    private val dao: JournalDao,
    private val preferences: AppPreferencesRepository,
    private val weatherRepository: WeatherRepository,
    private val aiOrchestrator: JournalAiOrchestrator,
    private val todayIsoProvider: () -> String = { LocalDate.now().toString() },
    private val nowEpochMsProvider: () -> Long = { System.currentTimeMillis() },
) {
    val projects: Flow<List<JournalProject>> = dao.observeProjects().map { list ->
        list.map { it.toDomain() }
    }

    val uiPreferences: Flow<DeskUiPreferences> = preferences.uiPreferences

    val cachedWeather: Flow<WeatherSnapshot?> = weatherRepository.cachedWeather

    fun currentDateIso(): String = todayIsoProvider()

    fun currentTimeEpochMs(): Long = nowEpochMsProvider()

    fun observeEntryForToday(projectId: Long, dateIso: String = todayIsoProvider()): Flow<JournalEntry?> {
        return dao.observeEntryForDate(projectId, dateIso).map { it?.toDomain() }
    }

    fun observeEntriesForProject(projectId: Long): Flow<List<JournalEntry>> {
        return dao.observeEntriesForProject(projectId).map { list -> list.map { it.toDomain() } }
    }

    fun observePromptHistory(projectId: Long): Flow<List<PromptHistoryItem>> {
        return dao.observePromptHistory(projectId).map { list -> list.map { it.toDomain() } }
    }

    suspend fun setLastActiveProject(projectId: Long?) = preferences.setLastActiveProjectId(projectId)

    suspend fun setKeepScreenAwake(enabled: Boolean) = preferences.setKeepScreenAwake(enabled)

    suspend fun setThemeMode(mode: AppThemeMode) = preferences.setThemeMode(mode)

    suspend fun setDimDeskMode(enabled: Boolean) = preferences.setDimDeskMode(enabled)

    suspend fun setHideInRecents(enabled: Boolean) = preferences.setHideInRecents(enabled)

    fun observeFocusBlocksToday(dateIso: String = todayIsoProvider()): Flow<Int> =
        preferences.observeFocusBlocksCountForDate(dateIso)

    suspend fun incrementFocusBlocksToday(dateIso: String = todayIsoProvider()) =
        preferences.incrementFocusBlocksCount(dateIso)

    suspend fun setUseCelsius(useCelsius: Boolean) = preferences.setUseCelsius(useCelsius)

    suspend fun setDiscreetDeskMode(enabled: Boolean) = preferences.setDiscreetDeskMode(enabled)

    suspend fun setScreenSaverMode(mode: ScreenSaverMode) = preferences.setScreenSaverMode(mode)

    suspend fun setScreenSaverDimBrightness(dim: Boolean) = preferences.setScreenSaverDimBrightness(dim)

    suspend fun checkAiAvailability(): AiAvailabilityState = aiOrchestrator.checkAvailability()

    fun downloadAiModel(): Flow<AiAvailabilityState> = aiOrchestrator.downloadModel()

    fun closeAi() = aiOrchestrator.close()

    fun createA2uiAgentEngine(): com.example.a2ui.DeskA2uiAgentEngine = aiOrchestrator.createA2uiAgentEngine()

    suspend fun analyzeBrief(
        brief: String,
        wizardInputs: WizardSeedInputs? = null,
    ): ProposedProjectSetup {
        return aiOrchestrator.proposeProjectSetup(brief, wizardInputs)
    }

    suspend fun createProjectFromSetup(
        originalBrief: String,
        setup: ProposedProjectSetup,
        includePastAnswersInPrompts: Boolean = false,
        showDateTimeCard: Boolean = true,
        showWeatherCard: Boolean = true,
        includeDateTimeInPrompt: Boolean = false,
        includeWeatherInPrompt: Boolean = false,
        showSparksCard: Boolean = true,
        showRhythmCard: Boolean = true,
        showTimerCard: Boolean = true,
    ): Long {
        val now = nowEpochMsProvider()
        val project = JournalProject(
            title = setup.title.trim().ifBlank { "Journal Project" },
            writingGoal = setup.writingGoal.trim().ifBlank { "Write one grounded reflection per session." },
            originalBrief = originalBrief.trim(),
            audience = setup.audience?.trim()?.takeIf { it.isNotBlank() },
            cadence = setup.cadence,
            pageSizeLabel = setup.pageSizeLabel?.trim()?.takeIf { it.isNotBlank() },
            entryLengthLabel = setup.entryLengthLabel?.trim()?.takeIf { it.isNotBlank() },
            linesPerPage = setup.linesPerPage.coerceIn(5, 60),
            wordsPerLine = setup.wordsPerLine.coerceIn(3, 20),
            themes = setup.themes.map { it.trim() }.filter { it.isNotBlank() },
            tonePreferences = setup.tonePreferences?.trim()?.takeIf { it.isNotBlank() },
            boundaries = setup.boundaries?.trim()?.takeIf { it.isNotBlank() },
            includePastAnswersInPrompts = includePastAnswersInPrompts,
            showDateTimeCard = showDateTimeCard,
            showWeatherCard = showWeatherCard,
            showSparksCard = showSparksCard,
            showRhythmCard = showRhythmCard,
            showTimerCard = showTimerCard,
            includeDateTimeInPrompt = includeDateTimeInPrompt,
            includeWeatherInPrompt = includeWeatherInPrompt,
            createdAtEpochMs = now,
            updatedAtEpochMs = now,
        )
        val newId = dao.insertProject(JournalProjectEntity.fromDomain(project))

        val dateIso = todayIsoProvider()
        val firstPrompt = setup.firstPrompt.trim().ifBlank {
            "What is one concrete detail from today worth putting down on paper?"
        }
        val firstEntry = JournalEntry(
            projectId = newId,
            dateIso = dateIso,
            promptText = firstPrompt,
            promptTopicTag = "opening_prompt",
            hints = setup.firstHints,
            draftText = "",
            isCompleted = false,
            updatedAtEpochMs = now,
        )
        dao.upsertEntry(JournalEntryEntity.fromDomain(firstEntry))
        dao.insertPromptHistory(
            PromptHistoryEntity(
                projectId = newId,
                dateIso = dateIso,
                promptText = firstPrompt,
                topicTag = "opening_prompt",
                createdAtEpochMs = now,
            ),
        )
        preferences.setLastActiveProjectId(newId)
        return newId
    }

    /**
     * Updates an existing project's brief and guidance settings while strictly preserving
     * all existing JournalEntry and PromptHistory records.
     */
    suspend fun updateProjectPreservingHistory(updated: JournalProject) {
        val stamped = updated.copy(updatedAtEpochMs = nowEpochMsProvider())
        dao.updateProject(JournalProjectEntity.fromDomain(stamped))
    }

    suspend fun deleteProject(projectId: Long) {
        dao.deleteProjectById(projectId)
    }

    /**
     * Ensures Today has a persisted prompt for [project] on [dateIso].
     * Reopening the same day returns the exact same question unless the user taps Try Another.
     */
    suspend fun ensureTodayEntry(
        project: JournalProject,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
        dateIso: String = todayIsoProvider(),
    ): JournalEntry {
        val existing = dao.getEntryForDate(project.id, dateIso)
        if (existing != null) {
            return existing.toDomain()
        }
        return generateAndPersistTodayPrompt(
            project = project,
            weather = weather,
            useCelsius = useCelsius,
            dateIso = dateIso,
            existingDraft = "",
            existingEntryId = 0L,
            previousTopicToAvoid = null,
        ).first
    }

    suspend fun tryAnotherPrompt(
        project: JournalProject,
        currentEntry: JournalEntry?,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
        dateIso: String = todayIsoProvider(),
    ): Pair<JournalEntry, String?> {
        return generateAndPersistTodayPrompt(
            project = project,
            weather = weather,
            useCelsius = useCelsius,
            dateIso = dateIso,
            existingDraft = currentEntry?.draftText.orEmpty(),
            existingEntryId = currentEntry?.id ?: 0L,
            previousTopicToAvoid = currentEntry?.promptTopicTag,
        )
    }

    private suspend fun generateAndPersistTodayPrompt(
        project: JournalProject,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
        dateIso: String,
        existingDraft: String,
        existingEntryId: Long,
        previousTopicToAvoid: String?,
    ): Pair<JournalEntry, String?> {
        val history = dao.getRecentPromptHistory(project.id, limit = 15).map { it.toDomain() }
        val optedInAnswers = if (project.includePastAnswersInPrompts) {
            dao.getRecentAnsweredEntries(project.id, limit = 4)
                .map { it.draftText.trim() }
                .filter { it.isNotBlank() }
        } else {
            emptyList()
        }

        val contextPayload = buildPromptContextPayload(project, weather, useCelsius)
        val generated = aiOrchestrator.generateNextPrompt(
            project = project,
            recentHistory = history,
            optedInPastAnswers = optedInAnswers,
            enabledContext = contextPayload,
            previousTopicToAvoid = previousTopicToAvoid,
        )

        val now = nowEpochMsProvider()
        val entry = JournalEntry(
            id = existingEntryId,
            projectId = project.id,
            dateIso = dateIso,
            promptText = generated.promptText,
            promptTopicTag = generated.topicTag,
            hints = generated.hints,
            draftText = existingDraft,
            isCompleted = false,
            completedAtEpochMs = null,
            updatedAtEpochMs = now,
        )
        val rowId = dao.upsertEntry(JournalEntryEntity.fromDomain(entry))
        dao.insertPromptHistory(
            PromptHistoryEntity(
                projectId = project.id,
                dateIso = dateIso,
                promptText = generated.promptText,
                topicTag = generated.topicTag,
                createdAtEpochMs = now,
            ),
        )
        return entry.copy(id = rowId) to generated.statusNote
    }

    suspend fun requestHint(project: JournalProject, entry: JournalEntry): GeneratedHintResult {
        val result = aiOrchestrator.generateHint(project, entry.promptText, entry.hints)
        val updatedHints = (entry.hints + result.hintText).distinct()
        val updatedEntry = entry.copy(
            hints = updatedHints,
            updatedAtEpochMs = nowEpochMsProvider(),
        )
        dao.upsertEntry(JournalEntryEntity.fromDomain(updatedEntry))
        return result
    }

    suspend fun saveDraftText(entry: JournalEntry, draftText: String) {
        val updated = entry.copy(
            draftText = draftText,
            updatedAtEpochMs = nowEpochMsProvider(),
        )
        dao.upsertEntry(JournalEntryEntity.fromDomain(updated))
    }

    suspend fun setEntryCompleted(entry: JournalEntry, completed: Boolean) {
        val now = nowEpochMsProvider()
        val updated = entry.copy(
            isCompleted = completed,
            completedAtEpochMs = if (completed) now else null,
            updatedAtEpochMs = now,
        )
        dao.upsertEntry(JournalEntryEntity.fromDomain(updated))
    }

    suspend fun requestHelpStart(project: JournalProject, entry: JournalEntry): DraftSuggestion {
        return aiOrchestrator.helpStartDraft(project, entry.promptText)
    }

    suspend fun requestTightenDraft(project: JournalProject, entry: JournalEntry, currentDraft: String): DraftSuggestion {
        return aiOrchestrator.tightenDraft(project, entry.promptText, currentDraft)
    }

    suspend fun refreshWeatherByCity(cityQuery: String): Result<WeatherSnapshot> {
        return weatherRepository.refreshByCity(cityQuery)
    }

    suspend fun refreshWeatherByCoordinates(lat: Double, lon: Double, cityLabel: String): Result<WeatherSnapshot> {
        return weatherRepository.refreshByCoordinates(lat, lon, cityLabel)
    }

    fun buildPromptContextPayload(
        project: JournalProject,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
    ): PromptContextPayload {
        val dateTimeText = if (project.includeDateTimeInPrompt) {
            val nowTime = LocalTime.now()
            val timeStr = nowTime.format(DateTimeFormatter.ofPattern("h:mm a"))
            val dayStr = LocalDate.now().format(DateTimeFormatter.ofPattern("EEEE, MMM d"))
            "$dayStr at $timeStr"
        } else {
            null
        }

        val (weatherSummary, weatherFetched) = if (project.includeWeatherInPrompt && weather != null) {
            val unit = if (useCelsius) "°C" else "°F"
            fun fmt(c: Double) = if (useCelsius) c.roundToInt() else ((c * 9.0 / 5.0) + 32.0).roundToInt()
            val precipPart = weather.precipitationChancePercent?.let { pct ->
                val period = weather.precipitationPeriodLabel?.let { " $it" }.orEmpty()
                ", $pct% precip$period"
            }.orEmpty()
            val summary = "${weather.conditionLabel}, ${fmt(weather.temperatureCelsius)}$unit " +
                "(high ${fmt(weather.highCelsius)}$unit / low ${fmt(weather.lowCelsius)}$unit$precipPart)"
            val fetchedStr = Instant.ofEpochMilli(weather.fetchedAtEpochMs)
                .atZone(ZoneId.systemDefault())
                .format(DateTimeFormatter.ofPattern("MMM d, h:mm a"))
            summary to fetchedStr
        } else {
            null to null
        }

        return PromptContextPayload(
            dateTimeText = dateTimeText,
            weatherSummary = weatherSummary,
            weatherFetchedTimestamp = weatherFetched,
        )
    }
}

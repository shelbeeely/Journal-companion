package com.example.ui

import android.app.Application
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.model.processor.A2uiSurfaceModel
import androidx.a2ui.model.processor.processInput
import androidx.a2ui.model.protocol.A2uiClientToServerMessage
import androidx.a2ui.model.protocol.A2uiUserAction
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.a2ui.DeskA2uiActions
import com.example.a2ui.DeskA2uiCatalog
import com.example.a2ui.DeskContextBuilder
import com.example.ai.JournalAiOrchestrator
import com.example.ai.MlKitPromptAiClient
import com.example.data.local.JournalDatabase
import com.example.data.preferences.AppPreferencesRepository
import com.example.data.repository.JournalRepository
import com.example.model.AiAvailabilityState
import com.example.model.AppThemeMode
import com.example.model.DeskCardSlot
import com.example.model.DeskContextSnapshot
import com.example.model.DeskUiPreferences
import com.example.model.DraftSuggestion
import com.example.model.FocusPhase
import com.example.model.FocusTimerState
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.model.ProactiveDeskPulse
import com.example.model.PromptHistoryItem
import com.example.model.ProposedProjectSetup
import com.example.model.ScreenSaverMode
import com.example.model.WeatherSnapshot
import com.example.model.WizardSeedInputs
import com.example.weather.LocationHelper
import com.example.weather.WeatherRepository
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class TodayDeskUiState(
    val isLoading: Boolean = true,
    val projects: List<JournalProject> = emptyList(),
    val activeProject: JournalProject? = null,
    val todayEntry: JournalEntry? = null,
    val draftText: String = "",
    val canUndoDraft: Boolean = false,
    val pendingSuggestion: DraftSuggestion? = null,
    val editableSuggestionText: String = "",
    val isGeneratingPrompt: Boolean = false,
    val isGeneratingHint: Boolean = false,
    val isGeneratingDraftAssist: Boolean = false,
    val statusBannerMessage: String? = null,
    val preferences: DeskUiPreferences = DeskUiPreferences(),
    val aiAvailability: AiAvailabilityState = AiAvailabilityState.Checking,
    val cards: List<DeskCardSlot> = emptyList(),
    val proactivePulse: ProactiveDeskPulse = ProactiveDeskPulse(),
    val focusTimer: FocusTimerState = FocusTimerState(),
    val projectEntries: List<JournalEntry> = emptyList(),
    val promptHistory: List<PromptHistoryItem> = emptyList(),
    val weatherLoading: Boolean = false,
    val weatherError: String? = null,
    val weatherSnapshot: WeatherSnapshot? = null,
    val openDraftDrawerNonce: Int = 0,
    val deskSnapshot: DeskContextSnapshot? = null,
)

data class ProjectEditorUiState(
    val editingProjectId: Long? = null,
    val wizardStep: Int = 0,
    val briefText: String = "",
    val wizardInputs: WizardSeedInputs = WizardSeedInputs(),
    val isAnalyzingBrief: Boolean = false,
    val proposedSetup: ProposedProjectSetup? = null,
    val includePastAnswersInPrompts: Boolean = false,
    val showDateTimeCard: Boolean = true,
    val showWeatherCard: Boolean = true,
    val includeDateTimeInPrompt: Boolean = false,
    val includeWeatherInPrompt: Boolean = false,
)

class MainViewModel @JvmOverloads constructor(
    application: Application,
    private val repository: JournalRepository = createDefaultRepository(application),
) : AndroidViewModel(application) {

    private val locationHelper by lazy { LocationHelper(application.applicationContext) }
    private val a2uiParser = A2uiMessageParser()
    private val a2uiProcessor = A2uiMessageProcessor(catalogs = DeskA2uiCatalog.allCatalogs())
    private val a2uiEngine = repository.createA2uiAgentEngine()

    val a2uiSurfaces: StateFlow<List<A2uiSurfaceModel>> = a2uiProcessor.activeSurfaces

    private val _selectedProjectId = MutableStateFlow<Long?>(null)
    private val _draftText = MutableStateFlow("")
    private val _undoStack = MutableStateFlow<List<String>>(emptyList())
    private val _pendingSuggestion = MutableStateFlow<DraftSuggestion?>(null)
    private val _editableSuggestionText = MutableStateFlow("")
    private val _isGeneratingPrompt = MutableStateFlow(false)
    private val _isGeneratingHint = MutableStateFlow(false)
    private val _isGeneratingDraftAssist = MutableStateFlow(false)
    private val _statusBanner = MutableStateFlow<String?>(null)
    private val _aiAvailability = MutableStateFlow<AiAvailabilityState>(AiAvailabilityState.Checking)
    private val _weatherLoading = MutableStateFlow(false)
    private val _weatherError = MutableStateFlow<String?>(null)
    private val _isBootstrapping = MutableStateFlow(true)
    private val _focusTimer = MutableStateFlow(FocusTimerState())
    private val _a2uiDismissedWindowKey = MutableStateFlow<String?>(null)
    private val _a2uiUsedAiCore = MutableStateFlow(false)
    private val _a2uiManualRefreshNonce = MutableStateFlow(0)
    private val _openDraftDrawerNonce = MutableStateFlow(0)

    private val _editorState = MutableStateFlow(ProjectEditorUiState())
    val editorState: StateFlow<ProjectEditorUiState> = _editorState.asStateFlow()

    private var draftSaveJob: Job? = null
    private var timerJob: Job? = null
    private var lastLoadedEntryKey: String? = null
    private var autoRefreshedCityKey: String? = null
    private var lastA2uiSignature: String? = null

    private val clockTicker = flow {
        while (true) {
            emit(System.currentTimeMillis())
            delay(30_000L)
        }
    }

    private val activeProjectFlow: StateFlow<JournalProject?> = combine(
        repository.projects,
        repository.uiPreferences,
        _selectedProjectId,
    ) { projects, prefs, explicitId ->
        val targetId = explicitId ?: prefs.lastActiveProjectId
        projects.firstOrNull { it.id == targetId } ?: projects.firstOrNull()
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(ExperimentalCoroutinesApi::class)
    private val todayEntryFlow: StateFlow<JournalEntry?> = activeProjectFlow
        .flatMapLatest { project ->
            if (project == null) flowOf(null)
            else repository.observeEntryForToday(project.id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    @OptIn(ExperimentalCoroutinesApi::class)
    private val projectEntriesFlow: StateFlow<List<JournalEntry>> = activeProjectFlow
        .flatMapLatest { project ->
            if (project == null) flowOf(emptyList())
            else repository.observeEntriesForProject(project.id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    private val promptHistoryFlow: StateFlow<List<PromptHistoryItem>> = activeProjectFlow
        .flatMapLatest { project ->
            if (project == null) flowOf(emptyList())
            else repository.observePromptHistory(project.id)
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val baseDataFlow = combine(
        repository.projects,
        activeProjectFlow,
        todayEntryFlow,
        repository.uiPreferences,
        repository.cachedWeather,
    ) { projects, activeProject, todayEntry, prefs, weather ->
        BaseDataBundle(projects, activeProject, todayEntry, prefs, weather)
    }

    private val transientFlagsFlow = combine(
        _draftText,
        _undoStack,
        _pendingSuggestion,
        _editableSuggestionText,
        _isGeneratingPrompt,
    ) { draft, undo, pending, editableSuggestion, genPrompt ->
        TransientBundle(draft, undo.isNotEmpty(), pending, editableSuggestion, genPrompt)
    }

    private val auxFlagsFlow = combine(
        _isGeneratingHint,
        _isGeneratingDraftAssist,
        _statusBanner,
        _aiAvailability,
        clockTicker,
    ) { genHint, genDraft, banner, aiState, nowMs ->
        AuxBundle(genHint, genDraft, banner, aiState, nowMs)
    }

    private val extrasFlow = combine(
        projectEntriesFlow,
        promptHistoryFlow,
        _weatherLoading,
        _weatherError,
        _isBootstrapping,
    ) { entries, history, wLoading, wError, booting ->
        ExtrasBundle(entries, history, wLoading, wError, booting)
    }

    private val a2uiMetaFlow = combine(
        _a2uiDismissedWindowKey,
        _a2uiUsedAiCore,
        _openDraftDrawerNonce,
    ) { dismissedKey, usedAi, draftNonce ->
        Triple(dismissedKey, usedAi, draftNonce)
    }

    val uiState: StateFlow<TodayDeskUiState> = combine(
        baseDataFlow,
        transientFlagsFlow,
        auxFlagsFlow,
        extrasFlow,
        combine(_focusTimer, a2uiMetaFlow) { timer, meta -> timer to meta },
    ) { base, transient, aux, extras, (focusTimer, a2uiMeta) ->
        val (dismissedKey, usedAiCore, draftNonce) = a2uiMeta
        val (cards, pulse, deskSnapshot) = buildProactiveDeskData(
            project = base.activeProject,
            todayEntry = base.todayEntry,
            entries = extras.entries,
            history = extras.history,
            draftText = transient.draftText,
            focusTimer = focusTimer,
            weather = base.weather,
            useCelsius = base.prefs.useCelsius,
            nowMs = aux.nowMs,
            weatherLoading = extras.weatherLoading,
            weatherError = extras.weatherError,
            discreetMode = base.prefs.discreetDeskModeEnabled,
            dismissedWindowKey = dismissedKey,
            a2uiUsedAiCore = usedAiCore,
        )

        TodayDeskUiState(
            isLoading = extras.isBootstrapping,
            projects = base.projects,
            activeProject = base.activeProject,
            todayEntry = base.todayEntry,
            draftText = transient.draftText,
            canUndoDraft = transient.canUndo,
            pendingSuggestion = transient.pendingSuggestion,
            editableSuggestionText = transient.editableSuggestionText,
            isGeneratingPrompt = transient.isGeneratingPrompt,
            isGeneratingHint = aux.isGeneratingHint,
            isGeneratingDraftAssist = aux.isGeneratingDraftAssist,
            statusBannerMessage = aux.statusBanner,
            preferences = base.prefs,
            aiAvailability = aux.aiAvailability,
            cards = cards,
            proactivePulse = pulse,
            focusTimer = focusTimer,
            projectEntries = extras.entries,
            promptHistory = extras.history,
            weatherLoading = extras.weatherLoading,
            weatherError = extras.weatherError,
            weatherSnapshot = base.weather,
            openDraftDrawerNonce = draftNonce,
            deskSnapshot = deskSnapshot,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), TodayDeskUiState())

    init {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.Default) {
            a2uiProcessor.collectMessages()
        }

        viewModelScope.launch {
            a2uiProcessor.outboundEvents.collect(::handleA2uiOutboundEvent)
        }

        // Quietly synthesize/refresh A2UI desk surface on open, project switch, day-part transition, or explicit Refresh
        viewModelScope.launch {
            combine(
                uiState,
                _a2uiManualRefreshNonce,
            ) { state, refreshNonce ->
                state.deskSnapshot to refreshNonce
            }.collect { (snapshot, refreshNonce) ->
                if (snapshot == null) return@collect
                val sig = listOf(
                    snapshot.projectId,
                    snapshot.promptText.hashCode(),
                    snapshot.activeStarter.hashCode(),
                    snapshot.dayPartLabel,
                    snapshot.todayCompleted,
                    snapshot.sessionNumber,
                    snapshot.discreetMode,
                    snapshot.weatherSummary.hashCode(),
                    snapshot.audience.hashCode(),
                    snapshot.boundaries.hashCode(),
                    refreshNonce,
                ).joinToString(":")

                if (lastA2uiSignature != sig) {
                    lastA2uiSignature = sig
                    val batch = a2uiEngine.synthesizeSurface(
                        snapshot = snapshot,
                        surfaceId = DESK_A2UI_SURFACE_ID,
                        interactiveMode = true,
                        allowAiCore = true,
                    )
                    _a2uiUsedAiCore.value = batch.usedAiCore
                    batch.messages.forEach { msg ->
                        a2uiProcessor.processInput(a2uiParser, msg)
                    }
                }
            }
        }

        // Render Desk Mode as soon as local DB emits; never block startup on AICore IPC
        viewModelScope.launch {
            runCatching { repository.projects.first() }
            _isBootstrapping.value = false
        }

        viewModelScope.launch {
            _aiAvailability.value = repository.checkAiAvailability()
        }

        viewModelScope.launch {
            repository.observeFocusBlocksToday().collect { count ->
                _focusTimer.update { it.copy(completedFocusBlocksToday = count) }
            }
        }

        // Automatically ensure Today's prompt exists when active project changes or a new day arrives
        viewModelScope.launch {
            combine(activeProjectFlow, repository.cachedWeather, repository.uiPreferences) { p, w, prefs ->
                Triple(p, w, prefs)
            }.collect { (project, weather, prefs) ->
                if (project != null) {
                    val ensured = repository.ensureTodayEntry(project, weather, prefs.useCelsius)
                    val key = "${project.id}:${ensured.dateIso}:${ensured.id}"
                    if (lastLoadedEntryKey != key) {
                        lastLoadedEntryKey = key
                        _draftText.value = ensured.draftText
                        _undoStack.value = emptyList()
                        _pendingSuggestion.value = null
                        _editableSuggestionText.value = ""
                    }
                } else {
                    lastLoadedEntryKey = null
                    _draftText.value = ""
                    _undoStack.value = emptyList()
                }
            }
        }

        // Proactively refresh saved weather city when Desk opens and cache is missing or stale
        viewModelScope.launch {
            combine(repository.uiPreferences, repository.cachedWeather) { prefs, weather ->
                prefs.manualCityQuery to weather
            }.collect { (savedCity, weather) ->
                val city = savedCity?.trim().orEmpty()
                if (city.isNotEmpty() && autoRefreshedCityKey != city && (weather == null || weather.isStale())) {
                    autoRefreshedCityKey = city
                    refreshWeatherByCity(city)
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        repository.closeAi()
    }

    fun selectProject(projectId: Long) {
        viewModelScope.launch {
            flushDraftNow()
            _selectedProjectId.value = projectId
            repository.setLastActiveProject(projectId)
        }
    }

    fun dismissBanner() {
        _statusBanner.value = null
    }

    fun checkAiStatus() {
        viewModelScope.launch {
            _aiAvailability.value = AiAvailabilityState.Checking
            _aiAvailability.value = repository.checkAiAvailability()
        }
    }

    fun startAiModelDownload() {
        viewModelScope.launch {
            repository.downloadAiModel().collect { state ->
                _aiAvailability.value = state
            }
        }
    }

    fun onDraftChanged(newText: String) {
        val current = _draftText.value
        if (newText == current) return
        // Record milestone undo snapshot when jump is significant or starting fresh
        if (_undoStack.value.isEmpty() || kotlin.math.abs(newText.length - current.length) > 12) {
            pushUndoSnapshot(current)
        }
        _draftText.value = newText

        val entry = uiState.value.todayEntry ?: return
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(450L)
            if (isActive) {
                repository.saveDraftText(entry, newText)
            }
        }
    }

    fun undoDraftChange() {
        val stack = _undoStack.value
        if (stack.isEmpty()) return
        val previous = stack.last()
        _undoStack.value = stack.dropLast(1)
        _draftText.value = previous
        uiState.value.todayEntry?.let { entry ->
            viewModelScope.launch { repository.saveDraftText(entry, previous) }
        }
    }

    private fun pushUndoSnapshot(text: String) {
        _undoStack.update { (it + text).takeLast(20) }
    }

    fun requestHint() {
        val project = uiState.value.activeProject ?: return
        val entry = uiState.value.todayEntry ?: return
        if (_isGeneratingHint.value) return

        viewModelScope.launch {
            _isGeneratingHint.value = true
            try {
                val res = repository.requestHint(project, entry)
                res.statusNote?.let { _statusBanner.value = it }
            } finally {
                _isGeneratingHint.value = false
            }
        }
    }

    fun tryAnotherPrompt() {
        val project = uiState.value.activeProject ?: return
        val entry = uiState.value.todayEntry
        if (_isGeneratingPrompt.value) return

        viewModelScope.launch {
            flushDraftNow()
            _isGeneratingPrompt.value = true
            try {
                val (_, note) = repository.tryAnotherPrompt(
                    project = project,
                    currentEntry = entry,
                    weather = uiState.value.weatherSnapshot,
                    useCelsius = uiState.value.preferences.useCelsius,
                )
                note?.let { _statusBanner.value = it }
            } finally {
                _isGeneratingPrompt.value = false
            }
        }
    }

    fun markDoneForToday(completed: Boolean = true) {
        val entry = uiState.value.todayEntry ?: return
        viewModelScope.launch {
            flushDraftNow()
            repository.setEntryCompleted(entry.copy(draftText = _draftText.value), completed)
            if (completed) {
                _statusBanner.value = "Saved today's page status."
            }
        }
    }

    fun requestHelpMeStart() {
        val project = uiState.value.activeProject ?: return
        val entry = uiState.value.todayEntry ?: return
        if (_isGeneratingDraftAssist.value) return

        viewModelScope.launch {
            _isGeneratingDraftAssist.value = true
            try {
                val suggestion = repository.requestHelpStart(project, entry)
                _pendingSuggestion.value = suggestion
                _editableSuggestionText.value = suggestion.suggestedText
                suggestion.note?.let { _statusBanner.value = it }
            } finally {
                _isGeneratingDraftAssist.value = false
            }
        }
    }

    fun requestTightenDraft() {
        val project = uiState.value.activeProject ?: return
        val entry = uiState.value.todayEntry ?: return
        val currentDraft = _draftText.value.trim()
        if (currentDraft.isEmpty()) {
            _statusBanner.value = "Write a few words in your draft first, then tap Tighten my draft."
            return
        }
        if (_isGeneratingDraftAssist.value) return

        viewModelScope.launch {
            _isGeneratingDraftAssist.value = true
            try {
                val suggestion = repository.requestTightenDraft(project, entry, currentDraft)
                _pendingSuggestion.value = suggestion
                _editableSuggestionText.value = suggestion.suggestedText
                suggestion.note?.let { _statusBanner.value = it }
            } finally {
                _isGeneratingDraftAssist.value = false
            }
        }
    }

    fun updateEditableSuggestion(newText: String) {
        _editableSuggestionText.value = newText
    }

    fun acceptSuggestion(appendInsteadOfReplace: Boolean = false) {
        val suggestionText = _editableSuggestionText.value.trim()
        if (suggestionText.isEmpty()) {
            dismissSuggestion()
            return
        }
        val current = _draftText.value
        pushUndoSnapshot(current)
        val updated = if (appendInsteadOfReplace && current.isNotBlank()) {
            "$current\n\n$suggestionText"
        } else {
            suggestionText
        }
        _draftText.value = updated
        _pendingSuggestion.value = null
        _editableSuggestionText.value = ""
        uiState.value.todayEntry?.let { entry ->
            viewModelScope.launch { repository.saveDraftText(entry, updated) }
        }
    }

    fun dismissSuggestion() {
        _pendingSuggestion.value = null
        _editableSuggestionText.value = ""
    }

    // --- Project Editor & Creation ---

    fun startNewProjectEditor(initialBrief: String = "") {
        _editorState.value = ProjectEditorUiState(
            editingProjectId = null,
            wizardStep = 0,
            briefText = initialBrief,
            wizardInputs = WizardSeedInputs(),
            proposedSetup = null,
        )
    }

    fun startEditingProject(project: JournalProject) {
        _editorState.value = ProjectEditorUiState(
            editingProjectId = project.id,
            wizardStep = 0,
            briefText = project.originalBrief,
            wizardInputs = WizardSeedInputs(
                cadence = project.cadence,
                audience = project.audience,
                pageSizeLabel = project.pageSizeLabel,
                linesPerPage = project.linesPerPage,
                wordsPerLine = project.wordsPerLine,
                tonePreferences = project.tonePreferences,
                boundaries = project.boundaries,
            ),
            proposedSetup = ProposedProjectSetup(
                title = project.title,
                writingGoal = project.writingGoal,
                audience = project.audience,
                cadence = project.cadence,
                pageSizeLabel = project.pageSizeLabel,
                entryLengthLabel = project.entryLengthLabel,
                linesPerPage = project.linesPerPage,
                wordsPerLine = project.wordsPerLine,
                themes = project.themes,
                tonePreferences = project.tonePreferences,
                boundaries = project.boundaries,
                firstPrompt = uiState.value.todayEntry?.promptText ?: "",
                firstHints = emptyList(),
            ),
            includePastAnswersInPrompts = project.includePastAnswersInPrompts,
            showDateTimeCard = project.showDateTimeCard,
            showWeatherCard = project.showWeatherCard,
            includeDateTimeInPrompt = project.includeDateTimeInPrompt,
            includeWeatherInPrompt = project.includeWeatherInPrompt,
        )
    }

    fun goToWizardStep(step: Int) {
        _editorState.update { it.copy(wizardStep = step.coerceIn(0, 3)) }
    }

    fun updateWizardInputs(transform: (WizardSeedInputs) -> WizardSeedInputs) {
        _editorState.update { state ->
            state.copy(wizardInputs = transform(state.wizardInputs))
        }
    }

    fun updateEditorBrief(text: String) {
        _editorState.update { it.copy(briefText = text) }
    }

    fun analyzeEditorBrief() {
        val current = _editorState.value
        val brief = current.briefText.trim()
        if (brief.isEmpty()) {
            _statusBanner.value = "Paste or type a short brief about what you want to journal."
            return
        }
        viewModelScope.launch {
            _editorState.update { it.copy(isAnalyzingBrief = true) }
            try {
                val proposed = repository.analyzeBrief(brief, current.wizardInputs)
                _editorState.update {
                    it.copy(
                        isAnalyzingBrief = false,
                        proposedSetup = proposed,
                        wizardStep = 3,
                    )
                }
            } catch (t: Throwable) {
                _editorState.update { it.copy(isAnalyzingBrief = false) }
                _statusBanner.value = t.message ?: "Could not analyze brief."
            }
        }
    }

    fun skipAiAndUseManualWizardSetup() {
        val current = _editorState.value
        val inputs = current.wizardInputs
        val pageSize = inputs.pageSizeLabel?.trim()?.takeIf { it.isNotBlank() }
        val (defaultLines, defaultWords) = com.example.ai.StructuredOutputValidator.estimatePageGrid(pageSize)
        _editorState.update {
            it.copy(
                wizardStep = 3,
                proposedSetup = ProposedProjectSetup(
                    title = "",
                    writingGoal = "",
                    audience = inputs.audience?.trim()?.takeIf { a -> a.isNotBlank() },
                    cadence = inputs.cadence,
                    pageSizeLabel = pageSize,
                    linesPerPage = inputs.linesPerPage ?: defaultLines,
                    wordsPerLine = inputs.wordsPerLine ?: defaultWords,
                    tonePreferences = inputs.tonePreferences?.trim()?.takeIf { t -> t.isNotBlank() },
                    boundaries = inputs.boundaries?.trim()?.takeIf { b -> b.isNotBlank() },
                    firstPrompt = "What is one concrete detail from today worth putting on paper?",
                    usedAiCore = false,
                    statusNote = "Manual setup selected—AI suggestions skipped.",
                ),
            )
        }
    }

    fun openManualSetupInEditor() {
        val existing = _editorState.value.proposedSetup
        if (existing != null) {
            _editorState.update { it.copy(wizardStep = 3) }
        } else {
            skipAiAndUseManualWizardSetup()
        }
    }

    fun updateProposedSetup(transform: (ProposedProjectSetup) -> ProposedProjectSetup) {
        _editorState.update { state ->
            val current = state.proposedSetup ?: ProposedProjectSetup()
            state.copy(proposedSetup = transform(current))
        }
    }

    fun updateEditorToggles(
        includePastAnswers: Boolean? = null,
        showDateTime: Boolean? = null,
        showWeather: Boolean? = null,
        includeDateTimeInPrompt: Boolean? = null,
        includeWeatherInPrompt: Boolean? = null,
    ) {
        _editorState.update { state ->
            state.copy(
                includePastAnswersInPrompts = includePastAnswers ?: state.includePastAnswersInPrompts,
                showDateTimeCard = showDateTime ?: state.showDateTimeCard,
                showWeatherCard = showWeather ?: state.showWeatherCard,
                includeDateTimeInPrompt = includeDateTimeInPrompt ?: state.includeDateTimeInPrompt,
                includeWeatherInPrompt = includeWeatherInPrompt ?: state.includeWeatherInPrompt,
            )
        }
    }

    fun saveEditorProject(onSaved: () -> Unit) {
        val editor = _editorState.value
        val setup = editor.proposedSetup ?: return
        viewModelScope.launch {
            val editingId = editor.editingProjectId
            if (editingId == null) {
                val createdId = repository.createProjectFromSetup(
                    originalBrief = editor.briefText,
                    setup = setup,
                    includePastAnswersInPrompts = editor.includePastAnswersInPrompts,
                    showDateTimeCard = editor.showDateTimeCard,
                    showWeatherCard = editor.showWeatherCard,
                    includeDateTimeInPrompt = editor.includeDateTimeInPrompt,
                    includeWeatherInPrompt = editor.includeWeatherInPrompt,
                )
                _selectedProjectId.value = createdId
            } else {
                val existing = uiState.value.projects.firstOrNull { it.id == editingId } ?: return@launch
                val updated = existing.copy(
                    title = setup.title.trim().ifBlank { existing.title },
                    writingGoal = setup.writingGoal.trim().ifBlank { existing.writingGoal },
                    originalBrief = editor.briefText.trim().ifBlank { existing.originalBrief },
                    audience = setup.audience?.trim()?.takeIf { it.isNotBlank() },
                    cadence = setup.cadence,
                    pageSizeLabel = setup.pageSizeLabel?.trim()?.takeIf { it.isNotBlank() },
                    entryLengthLabel = setup.entryLengthLabel?.trim()?.takeIf { it.isNotBlank() },
                    linesPerPage = setup.linesPerPage.coerceIn(5, 60),
                    wordsPerLine = setup.wordsPerLine.coerceIn(3, 20),
                    themes = setup.themes.map { it.trim() }.filter { it.isNotBlank() },
                    tonePreferences = setup.tonePreferences?.trim()?.takeIf { it.isNotBlank() },
                    boundaries = setup.boundaries?.trim()?.takeIf { it.isNotBlank() },
                    includePastAnswersInPrompts = editor.includePastAnswersInPrompts,
                    showDateTimeCard = editor.showDateTimeCard,
                    showWeatherCard = editor.showWeatherCard,
                    includeDateTimeInPrompt = editor.includeDateTimeInPrompt,
                    includeWeatherInPrompt = editor.includeWeatherInPrompt,
                )
                repository.updateProjectPreservingHistory(updated)
            }
            onSaved()
        }
    }

    fun updateActiveProjectSettings(transform: (JournalProject) -> JournalProject) {
        val current = uiState.value.activeProject ?: return
        viewModelScope.launch {
            repository.updateProjectPreservingHistory(transform(current))
        }
    }

    fun deleteProject(projectId: Long) {
        viewModelScope.launch {
            repository.deleteProject(projectId)
            if (_selectedProjectId.value == projectId) {
                _selectedProjectId.value = null
            }
            val remaining = uiState.value.projects.firstOrNull { it.id != projectId }
            repository.setLastActiveProject(remaining?.id)
        }
    }

    // --- Desk & Weather Settings ---

    fun setKeepScreenAwake(enabled: Boolean) {
        viewModelScope.launch { repository.setKeepScreenAwake(enabled) }
    }

    fun setThemeMode(mode: AppThemeMode) {
        viewModelScope.launch { repository.setThemeMode(mode) }
    }

    fun toggleLightDarkTheme(isCurrentlyDark: Boolean) {
        viewModelScope.launch {
            if (uiState.value.preferences.dimDeskModeEnabled) {
                repository.setDimDeskMode(false)
            }
            repository.setThemeMode(if (isCurrentlyDark) AppThemeMode.LIGHT else AppThemeMode.DARK)
        }
    }

    fun setDimDeskMode(enabled: Boolean) {
        viewModelScope.launch { repository.setDimDeskMode(enabled) }
    }

    fun setHideInRecents(enabled: Boolean) {
        viewModelScope.launch { repository.setHideInRecents(enabled) }
    }

    fun setUseCelsius(useCelsius: Boolean) {
        viewModelScope.launch { repository.setUseCelsius(useCelsius) }
    }

    fun setDiscreetDeskMode(enabled: Boolean) {
        viewModelScope.launch { repository.setDiscreetDeskMode(enabled) }
    }

    fun setScreenSaverMode(mode: ScreenSaverMode) {
        viewModelScope.launch { repository.setScreenSaverMode(mode) }
    }

    fun setScreenSaverDimBrightness(dim: Boolean) {
        viewModelScope.launch { repository.setScreenSaverDimBrightness(dim) }
    }

    fun refreshA2uiSurface() {
        _a2uiDismissedWindowKey.value = null
        _a2uiManualRefreshNonce.update { it + 1 }
    }

    fun restoreA2uiSurface() {
        _a2uiDismissedWindowKey.value = null
    }

    private fun handleA2uiOutboundEvent(event: A2uiClientToServerMessage) {
        val action = event as? A2uiUserAction ?: return
        val actionName = runCatching {
            action.javaClass.getMethod("getName").invoke(action) as? String
        }.getOrNull() ?: runCatching {
            action.javaClass.getMethod("getAction").invoke(action)?.let { inner ->
                inner.javaClass.getMethod("getName").invoke(inner) as? String
            }
        }.getOrNull() ?: return
        when (actionName) {
            DeskA2uiActions.USE_STARTER -> {
                val starter = uiState.value.deskSnapshot?.activeStarter
                    ?: uiState.value.proactivePulse.starterPeek
                    ?: return
                val current = _draftText.value
                pushUndoSnapshot(current)
                val nextDraft = if (current.isBlank()) starter else "$current\n\n$starter"
                _draftText.value = nextDraft
                _openDraftDrawerNonce.update { it + 1 }
                uiState.value.todayEntry?.let { entry ->
                    viewModelScope.launch { repository.saveDraftText(entry, nextDraft) }
                }
            }
            DeskA2uiActions.NEXT_ANGLE -> requestHint()
            DeskA2uiActions.START_FOCUS -> {
                if (!_focusTimer.value.isRunning) {
                    selectFocusPreset(10)
                    startFocusTimer()
                }
            }
            DeskA2uiActions.REFRESH_SURFACE -> refreshA2uiSurface()
            DeskA2uiActions.DISMISS_SURFACE -> {
                val snap = uiState.value.deskSnapshot
                val key = snap?.let { "${it.projectId}:${it.dayPartLabel}" }
                _a2uiDismissedWindowKey.value = key
            }
        }
    }

    fun refreshWeatherByCity(cityQuery: String) {
        viewModelScope.launch {
            _weatherLoading.value = true
            _weatherError.value = null
            val res = repository.refreshWeatherByCity(cityQuery)
            res.onFailure { err ->
                _weatherError.value = err.message ?: "Offline or unable to reach Open-Meteo."
            }
            _weatherLoading.value = false
        }
    }

    fun refreshWeatherUsingApproximateLocation() {
        viewModelScope.launch {
            _weatherLoading.value = true
            _weatherError.value = null
            val locResult = locationHelper.getApproximateLocation()
            locResult.onSuccess { approx ->
                val weatherRes = repository.refreshWeatherByCoordinates(
                    lat = approx.latitude,
                    lon = approx.longitude,
                    cityLabel = approx.cityLabel,
                )
                weatherRes.onFailure { err ->
                    _weatherError.value = err.message ?: "Could not fetch weather right now."
                }
            }.onFailure { err ->
                _weatherError.value = err.message ?: "Approximate location unavailable."
            }
            _weatherLoading.value = false
        }
    }

    // --- Pomodoro Focus Timer (tracks only interval count, never journal content) ---

    fun toggleFocusTimer() {
        if (_focusTimer.value.isRunning) {
            pauseFocusTimer()
        } else {
            startFocusTimer()
        }
    }

    fun selectFocusPreset(minutes: Int) {
        timerJob?.cancel()
        val secs = minutes.coerceIn(1, 90) * 60
        _focusTimer.update {
            it.copy(
                phase = FocusPhase.FOCUS,
                presetMinutes = minutes,
                remainingSeconds = secs,
                totalSeconds = secs,
                isRunning = false,
                justFinishedPhase = null,
            )
        }
    }

    fun startBreakTimer(minutes: Int = 5) {
        timerJob?.cancel()
        val secs = minutes.coerceIn(1, 30) * 60
        _focusTimer.update {
            it.copy(
                phase = FocusPhase.BREAK,
                remainingSeconds = secs,
                totalSeconds = secs,
                isRunning = true,
                justFinishedPhase = null,
            )
        }
        launchTickerLoop()
    }

    fun resetFocusTimer() {
        timerJob?.cancel()
        _focusTimer.update { state ->
            val secs = if (state.phase == FocusPhase.BREAK) 5 * 60 else state.presetMinutes * 60
            state.copy(
                remainingSeconds = secs,
                totalSeconds = secs,
                isRunning = false,
                justFinishedPhase = null,
            )
        }
    }

    fun dismissTimerCompletion() {
        _focusTimer.update { it.copy(justFinishedPhase = null) }
    }

    private fun startFocusTimer() {
        timerJob?.cancel()
        _focusTimer.update { state ->
            val resetRemaining = if (state.remainingSeconds <= 0) state.totalSeconds else state.remainingSeconds
            state.copy(remainingSeconds = resetRemaining, isRunning = true, justFinishedPhase = null)
        }
        launchTickerLoop()
    }

    private fun pauseFocusTimer() {
        timerJob?.cancel()
        _focusTimer.update { it.copy(isRunning = false) }
    }

    private fun launchTickerLoop() {
        timerJob = viewModelScope.launch {
            while (isActive) {
                delay(1000L)
                val current = _focusTimer.value
                if (!current.isRunning) break
                val next = (current.remainingSeconds - 1).coerceAtLeast(0)
                if (next == 0) {
                    val finishedPhase = current.phase
                    if (finishedPhase == FocusPhase.FOCUS) {
                        repository.incrementFocusBlocksToday()
                    }
                    val nextPhase = if (finishedPhase == FocusPhase.FOCUS) FocusPhase.BREAK else FocusPhase.FOCUS
                    val nextTotal = if (nextPhase == FocusPhase.BREAK) 5 * 60 else current.presetMinutes * 60
                    _focusTimer.update {
                        it.copy(
                            phase = nextPhase,
                            remainingSeconds = nextTotal,
                            totalSeconds = nextTotal,
                            isRunning = false,
                            justFinishedPhase = finishedPhase,
                        )
                    }
                    break
                } else {
                    _focusTimer.update { it.copy(remainingSeconds = next) }
                }
            }
        }
    }

    private suspend fun flushDraftNow() {
        draftSaveJob?.cancel()
        val entry = uiState.value.todayEntry ?: return
        val currentDraft = _draftText.value
        if (currentDraft != entry.draftText) {
            repository.saveDraftText(entry, currentDraft)
        }
    }

    private fun buildProactiveDeskData(
        project: JournalProject?,
        todayEntry: JournalEntry?,
        entries: List<JournalEntry>,
        history: List<PromptHistoryItem>,
        draftText: String,
        focusTimer: FocusTimerState,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
        nowMs: Long,
        weatherLoading: Boolean,
        weatherError: String?,
        discreetMode: Boolean,
        dismissedWindowKey: String?,
        a2uiUsedAiCore: Boolean,
    ): Triple<List<DeskCardSlot>, ProactiveDeskPulse, DeskContextSnapshot?> {
        if (project == null) return Triple(emptyList(), ProactiveDeskPulse(), null)

        val nowTime = LocalTime.now()
        val nowDate = LocalDate.now()
        val draftWords = draftText.trim().split(Regex("\\s+")).count { it.isNotBlank() }

        val snapshot = DeskContextBuilder.buildSnapshot(
            project = project,
            todayEntry = todayEntry,
            entries = entries,
            history = history,
            draftWordCount = draftWords,
            weather = weather,
            useCelsius = useCelsius,
            nowMs = nowMs,
            discreetMode = discreetMode,
            today = nowDate,
            nowTime = nowTime,
        )

        val focusTimerCard = DeskCardSlot.FocusTimerCard(
            isVisible = project.showTimerCard,
            timerState = focusTimer,
        )

        val dateTimeCard = DeskCardSlot.DateTimeCard(
            isVisible = project.showDateTimeCard,
            includeInPrompt = project.includeDateTimeInPrompt,
            formattedDate = snapshot.formattedDate,
            formattedTime = snapshot.formattedTime,
            dayPartLabel = snapshot.dayPartLabel,
            writingWindowCue = snapshot.writingWindowCue,
            calendarRhythmLabel = snapshot.calendarRhythmLabel,
            daylightSummary = snapshot.daylightSummary,
        )

        val weatherCard = DeskCardSlot.WeatherCard(
            isVisible = project.showWeatherCard,
            includeInPrompt = project.includeWeatherInPrompt,
            snapshot = weather,
            isLoading = weatherLoading,
            errorMessage = weatherError,
            useCelsius = useCelsius,
            isStale = snapshot.isWeatherStale,
        )

        val currentWindowKey = "${project.id}:${snapshot.dayPartLabel}"
        val a2uiCard = DeskCardSlot.A2uiCompanionCard(
            isVisible = project.showA2uiCompanionCard,
            surfaceId = DESK_A2UI_SURFACE_ID,
            isDismissedForWindow = dismissedWindowKey == currentWindowKey,
            usedAiCore = a2uiUsedAiCore,
            dayPartLabel = snapshot.dayPartLabel,
        )

        val continuityShort = when {
            discreetMode -> "Discreet view"
            snapshot.recentNoteDayLabel != null && snapshot.recentNoteExcerpt != null ->
                "Last: ${snapshot.recentNoteDayLabel} (note)"
            snapshot.recentNoteDayLabel != null -> "Last: ${snapshot.recentNoteDayLabel}"
            else -> "Day 1 · fresh start"
        }

        val paceCue = snapshot.estimatedWordsPerPage?.let { est ->
            val minLow = (est / 25).coerceAtLeast(2)
            val minHigh = (minLow + 2)
            "~${snapshot.linesPerPage} lines · ~${est}w (~$minLow–$minHigh min pen)"
        }

        val pulse = ProactiveDeskPulse(
            sessionNumber = snapshot.sessionNumber,
            completedPagesCount = snapshot.completedPagesCount,
            currentAngleLabel = snapshot.promptTopicLabel,
            untappedTheme = snapshot.untappedThemes.firstOrNull(),
            continuityCue = continuityShort,
            paceCue = paceCue,
            starterPeek = snapshot.activeStarter,
            draftWordCount = draftWords,
            daylightCue = snapshot.daylightSummary,
        )

        return Triple(
            listOf(focusTimerCard, dateTimeCard, weatherCard, a2uiCard),
            pulse,
            snapshot,
        )
    }

    private data class BaseDataBundle(
        val projects: List<JournalProject>,
        val activeProject: JournalProject?,
        val todayEntry: JournalEntry?,
        val prefs: DeskUiPreferences,
        val weather: WeatherSnapshot?,
    )

    private data class TransientBundle(
        val draftText: String,
        val canUndo: Boolean,
        val pendingSuggestion: DraftSuggestion?,
        val editableSuggestionText: String,
        val isGeneratingPrompt: Boolean,
    )

    private data class AuxBundle(
        val isGeneratingHint: Boolean,
        val isGeneratingDraftAssist: Boolean,
        val statusBanner: String?,
        val aiAvailability: AiAvailabilityState,
        val nowMs: Long,
    )

    private data class ExtrasBundle(
        val entries: List<JournalEntry>,
        val history: List<PromptHistoryItem>,
        val weatherLoading: Boolean,
        val weatherError: String?,
        val isBootstrapping: Boolean,
    )

    companion object {
        const val DESK_A2UI_SURFACE_ID = "desk_proactive_surface"

        fun createDefaultRepository(application: Application): JournalRepository {
            val db = JournalDatabase.getInstance(application)
            val prefs = AppPreferencesRepository(application)
            val weatherRepo = WeatherRepository(prefs)
            val orchestrator = JournalAiOrchestrator(MlKitPromptAiClient())
            return JournalRepository(
                dao = db.journalDao(),
                preferences = prefs,
                weatherRepository = weatherRepo,
                aiOrchestrator = orchestrator,
            )
        }
    }
}

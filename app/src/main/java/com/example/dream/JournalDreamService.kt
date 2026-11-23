package com.example.dream

import android.content.Intent
import android.service.dreams.DreamService
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.model.processor.A2uiSurfaceModel
import androidx.a2ui.model.processor.processInput
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.animateIntOffsetAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.a2ui.A2uiSurface
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import com.example.MainActivity
import com.example.a2ui.DeskA2uiAgentEngine
import com.example.a2ui.DeskA2uiCatalog
import com.example.a2ui.DeskContextBuilder
import com.example.ai.MlKitPromptAiClient
import com.example.data.local.JournalDatabase
import com.example.data.preferences.AppPreferencesRepository
import com.example.model.DeskContextSnapshot
import com.example.model.DeskUiPreferences
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.model.PromptHistoryItem
import com.example.model.ScreenSaverMode
import com.example.model.WeatherSnapshot
import com.example.ui.theme.JournalCompanionTheme
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class DreamAmbientUiState(
    val preferences: DeskUiPreferences = DeskUiPreferences(),
    val activeProject: JournalProject? = null,
    val todayEntry: JournalEntry? = null,
    val weather: WeatherSnapshot? = null,
    val formattedTime: String = "",
    val formattedDate: String = "",
    val daylightSummary: String? = null,
    val contextSnapshot: DeskContextSnapshot? = null,
)

/**
 * Android DreamService (Screen Saver) displaying a low-glare ambient companion
 * with live clock, cached weather, optional discreet or full project prompt,
 * and A2UI proactive desk cues with gentle OLED pixel-shift protection.
 */
class JournalDreamService : DreamService(), LifecycleOwner, SavedStateRegistryOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    private val savedStateRegistryController = SavedStateRegistryController.create(this)
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val parser = A2uiMessageParser()
    private val processor = A2uiMessageProcessor(catalogs = DeskA2uiCatalog.allCatalogs())
    private val aiClient by lazy { MlKitPromptAiClient() }
    private val agentEngine by lazy { DeskA2uiAgentEngine(aiClient) }

    private val _ambientState = MutableStateFlow(DreamAmbientUiState())
    private val _driftStep = mutableIntStateOf(0)
    private var driftJob: Job? = null
    private var lastSurfaceSignature: String? = null

    override val lifecycle: Lifecycle
        get() = lifecycleRegistry

    override val savedStateRegistry: SavedStateRegistry
        get() = savedStateRegistryController.savedStateRegistry

    @OptIn(ExperimentalCoroutinesApi::class)
    override fun onCreate() {
        super.onCreate()
        savedStateRegistryController.performRestore(null)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)

        serviceScope.launch(Dispatchers.Default) {
            processor.collectMessages()
        }
        serviceScope.launch(Dispatchers.Default) {
            processor.outboundEvents.collect { _ -> }
        }

        val dao = JournalDatabase.getInstance(applicationContext).journalDao()
        val prefsRepo = AppPreferencesRepository(applicationContext)

        val clockTicker = flow {
            while (true) {
                emit(System.currentTimeMillis())
                delay(30_000L)
            }
        }

        val activeProjectFlow = combine(
            dao.observeProjects(),
            prefsRepo.uiPreferences,
        ) { entities, prefs ->
            val projects = entities.map { it.toDomain() }
            val targetId = prefs.lastActiveProjectId
            projects.firstOrNull { it.id == targetId } ?: projects.firstOrNull()
        }

        val todayEntryFlow = activeProjectFlow.flatMapLatest { proj ->
            if (proj == null) flowOf<JournalEntry?>(null)
            else dao.observeEntryForDate(proj.id, LocalDate.now().toString()).let { flow ->
                kotlinx.coroutines.flow.flow {
                    flow.collect { emit(it?.toDomain()) }
                }
            }
        }

        val projectEntriesFlow = activeProjectFlow.flatMapLatest { proj ->
            if (proj == null) flowOf(emptyList<JournalEntry>())
            else kotlinx.coroutines.flow.flow {
                dao.observeEntriesForProject(proj.id).collect { list -> emit(list.map { it.toDomain() }) }
            }
        }

        val promptHistoryFlow = activeProjectFlow.flatMapLatest { proj ->
            if (proj == null) flowOf(emptyList<PromptHistoryItem>())
            else kotlinx.coroutines.flow.flow {
                dao.observePromptHistory(proj.id).collect { list -> emit(list.map { it.toDomain() }) }
            }
        }

        serviceScope.launch {
            combine(
                prefsRepo.uiPreferences,
                prefsRepo.cachedWeather,
                activeProjectFlow,
                todayEntryFlow,
                clockTicker,
            ) { prefs, weather, project, todayEntry, nowMs ->
                FiveTuple(prefs, weather, project, todayEntry, nowMs)
            }.combine(
                combine(projectEntriesFlow, promptHistoryFlow) { entries, history -> entries to history },
            ) { base, (entries, history) ->
                val nowTime = LocalTime.now()
                val today = LocalDate.now()
                val snapshot = base.project?.let { proj ->
                    val words = base.todayEntry?.draftText.orEmpty().trim().split(Regex("\\s+")).count { it.isNotBlank() }
                    DeskContextBuilder.buildSnapshot(
                        project = proj,
                        todayEntry = base.todayEntry,
                        entries = entries,
                        history = history,
                        draftWordCount = words,
                        weather = base.weather,
                        useCelsius = base.prefs.useCelsius,
                        nowMs = base.nowMs,
                        discreetMode = base.prefs.discreetDeskModeEnabled,
                        today = today,
                        nowTime = nowTime,
                    )
                }

                isScreenBright = !base.prefs.screenSaverDimBrightness

                DreamAmbientUiState(
                    preferences = base.prefs,
                    activeProject = base.project,
                    todayEntry = base.todayEntry,
                    weather = base.weather,
                    formattedTime = nowTime.format(DateTimeFormatter.ofPattern("h:mm a")),
                    formattedDate = today.format(DateTimeFormatter.ofPattern("EEEE, MMM d")),
                    daylightSummary = DeskContextBuilder.buildDaylightSummary(base.weather, today, nowTime),
                    contextSnapshot = snapshot,
                )
            }.collect { state ->
                _ambientState.value = state
                val snap = state.contextSnapshot
                if (snap != null && state.preferences.screenSaverMode == ScreenSaverMode.FULL_A2UI) {
                    val sig = "${snap.projectId}:${snap.promptText.hashCode()}:${snap.dayPartLabel}:${snap.discreetMode}:${snap.weatherSummary}:${snap.sessionNumber}"
                    if (lastSurfaceSignature != sig) {
                        lastSurfaceSignature = sig
                        val batch = agentEngine.synthesizeSurface(
                            snapshot = snap,
                            surfaceId = DREAM_SURFACE_ID,
                            interactiveMode = false,
                            allowAiCore = true,
                        )
                        batch.messages.forEach { msg ->
                            processor.processInput(parser, msg)
                        }
                    }
                }
            }
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = true
        isFullscreen = true
        isScreenBright = !_ambientState.value.preferences.screenSaverDimBrightness

        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_START)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)

        val composeView = ComposeView(this).apply {
            setViewTreeLifecycleOwner(this@JournalDreamService)
            setViewTreeSavedStateRegistryOwner(this@JournalDreamService)
            setContent {
                val state by _ambientState.collectAsState()
                val surfaces by processor.activeSurfaces.collectAsState()
                val drift by _driftStep

                JournalCompanionTheme(isDimDeskMode = true) {
                    DreamScreenSaverContent(
                        state = state,
                        a2uiSurfaces = surfaces,
                        driftStep = drift,
                        onWakeAndOpenDesk = {
                            wakeUp()
                            val intent = Intent(this@JournalDreamService, MainActivity::class.java).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            }
                            runCatching { startActivity(intent) }
                            finish()
                        },
                        onDismissDream = { finish() },
                    )
                }
            }
        }
        setContentView(composeView)
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        driftJob?.cancel()
        driftJob = serviceScope.launch {
            while (isActive) {
                delay(50_000L)
                _driftStep.intValue = (_driftStep.intValue + 1) % 6
            }
        }
    }

    override fun onDreamingStopped() {
        driftJob?.cancel()
        super.onDreamingStopped()
    }

    override fun onDetachedFromWindow() {
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_STOP)
        super.onDetachedFromWindow()
    }

    override fun onDestroy() {
        driftJob?.cancel()
        runCatching { aiClient.close() }
        serviceScope.cancel()
        lifecycleRegistry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        super.onDestroy()
    }

    private data class FiveTuple(
        val prefs: DeskUiPreferences,
        val weather: WeatherSnapshot?,
        val project: JournalProject?,
        val todayEntry: JournalEntry?,
        val nowMs: Long,
    )

    companion object {
        const val DREAM_SURFACE_ID = "dream_proactive_surface"
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DreamScreenSaverContent(
    state: DreamAmbientUiState,
    a2uiSurfaces: List<A2uiSurfaceModel>,
    driftStep: Int = 0,
    onWakeAndOpenDesk: () -> Unit,
    onDismissDream: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val offsets = listOf(
        IntOffset(0, 0),
        IntOffset(12, 8),
        IntOffset(-10, 10),
        IntOffset(8, -12),
        IntOffset(-12, -6),
        IntOffset(6, 12),
    )
    val targetOffset = offsets[driftStep.coerceIn(0, offsets.lastIndex)]
    val animatedOffset by animateIntOffsetAsState(
        targetValue = targetOffset,
        animationSpec = tween(durationMillis = 1200),
        label = "oled_drift_offset",
    )

    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismissDream,
            )
            .testTag("dream_screensaver_root"),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(24.dp)
                .offset { animatedOffset },
        ) {
            BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
                val isWide = maxWidth > maxHeight && maxWidth >= 540.dp
                val clockDisplay = state.formattedTime.ifBlank { "Desk Companion" }
                val dateDisplay = state.formattedDate
                val weather = state.weather
                val snap = state.contextSnapshot

                if (state.preferences.screenSaverMode == ScreenSaverMode.CLOCK_AND_WEATHER_ONLY || state.activeProject == null) {
                    Column(
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(horizontal = 16.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Outlined.Bedtime,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = "AMBIENT DESK",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            text = clockDisplay,
                            style = MaterialTheme.typography.displayLarge,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.testTag("dream_clock_text"),
                        )
                        if (dateDisplay.isNotBlank()) {
                            Text(
                                text = dateDisplay,
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Spacer(Modifier.height(12.dp))
                        DreamWeatherPill(
                            weather = weather,
                            useCelsius = state.preferences.useCelsius,
                            daylightSummary = state.daylightSummary,
                        )
                        Spacer(Modifier.height(20.dp))
                        OutlinedButton(
                            onClick = onWakeAndOpenDesk,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("dream_open_desk_button"),
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Open Journal Desk")
                        }
                    }
                } else if (isWide) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(24.dp),
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        Column(
                            verticalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxSize(),
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        text = clockDisplay,
                                        style = MaterialTheme.typography.displayMedium,
                                        color = MaterialTheme.colorScheme.onBackground,
                                        modifier = Modifier.testTag("dream_clock_text"),
                                    )
                                    Surface(
                                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
                                        shape = MaterialTheme.shapes.small,
                                    ) {
                                        Text(
                                            text = state.activeProject.title,
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurface,
                                            modifier = Modifier
                                                .padding(horizontal = 10.dp, vertical = 5.dp)
                                                .testTag("dream_project_title"),
                                        )
                                    }
                                }
                                if (dateDisplay.isNotBlank()) {
                                    Text(
                                        text = dateDisplay,
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                DreamWeatherPill(
                                    weather = weather,
                                    useCelsius = state.preferences.useCelsius,
                                    daylightSummary = state.daylightSummary,
                                )
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = "TODAY'S QUESTION",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.semantics { heading() },
                                )
                                Text(
                                    text = state.todayEntry?.promptText ?: state.activeProject.writingGoal,
                                    style = MaterialTheme.typography.headlineMedium,
                                    color = MaterialTheme.colorScheme.onBackground,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.testTag("dream_prompt_text"),
                                )
                                if (snap != null && !snap.discreetMode) {
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp),
                                    ) {
                                        snap.audience?.let { DreamTag("For: $it") }
                                        snap.tonePreferences?.let { DreamTag("Tone: $it") }
                                        snap.boundaries?.let { DreamTag("Guardrail: $it") }
                                    }
                                }
                            }

                            OutlinedButton(
                                onClick = onWakeAndOpenDesk,
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("dream_open_desk_button"),
                            ) {
                                Icon(Icons.Outlined.AutoStories, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text("Open Journal Desk")
                            }
                        }

                        val dreamSurface = a2uiSurfaces.firstOrNull { it.id == JournalDreamService.DREAM_SURFACE_ID }
                            ?: a2uiSurfaces.firstOrNull()
                        if (dreamSurface != null) {
                            Column(
                                modifier = Modifier
                                    .width(320.dp)
                                    .verticalScroll(rememberScrollState()),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                key(dreamSurface.id) {
                                    A2uiSurface(
                                        surfaceModel = dreamSurface,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .testTag("dream_a2ui_surface"),
                                    )
                                }
                            }
                        }
                    }
                } else {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(14.dp),
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState()),
                    ) {
                        Text(
                            text = clockDisplay,
                            style = MaterialTheme.typography.displayMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.testTag("dream_clock_text"),
                        )
                        if (dateDisplay.isNotBlank()) {
                            Text(
                                text = dateDisplay,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        DreamWeatherPill(
                            weather = weather,
                            useCelsius = state.preferences.useCelsius,
                            daylightSummary = state.daylightSummary,
                        )
                        Text(
                            text = state.todayEntry?.promptText ?: state.activeProject.writingGoal,
                            style = MaterialTheme.typography.headlineSmall,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.testTag("dream_prompt_text"),
                        )
                        val dreamSurface = a2uiSurfaces.firstOrNull { it.id == JournalDreamService.DREAM_SURFACE_ID }
                            ?: a2uiSurfaces.firstOrNull()
                        dreamSurface?.let { s ->
                            key(s.id) {
                                A2uiSurface(
                                    surfaceModel = s,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag("dream_a2ui_surface"),
                                )
                            }
                        }
                        OutlinedButton(
                            onClick = onWakeAndOpenDesk,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("dream_open_desk_button"),
                        ) {
                            Icon(Icons.Outlined.AutoStories, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Open Journal Desk")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DreamWeatherPill(
    weather: WeatherSnapshot?,
    useCelsius: Boolean,
    daylightSummary: String?,
) {
    if (weather == null && daylightSummary == null) return
    val text = buildString {
        if (weather != null) {
            val unit = if (useCelsius) "°C" else "°F"
            fun fmt(c: Double) = if (useCelsius) c.roundToInt() else ((c * 9.0 / 5.0) + 32.0).roundToInt()
            append("${weather.cityLabel}: ${fmt(weather.temperatureCelsius)}$unit ${weather.conditionLabel}")
        }
        daylightSummary?.let {
            if (isNotEmpty()) append(" · ")
            append(it)
        }
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
        shape = MaterialTheme.shapes.small,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        ) {
            Icon(
                imageVector = Icons.Outlined.WbSunny,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(15.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun DreamTag(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

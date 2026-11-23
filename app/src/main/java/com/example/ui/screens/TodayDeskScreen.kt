package com.example.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.ScreenLockPortrait
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.a2ui.model.processor.A2uiSurfaceModel
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.model.AppThemeMode
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.ui.TodayDeskUiState
import com.example.ui.components.DeskInfoCardList
import com.example.ui.components.DigitalDraftPanel
import com.example.ui.theme.isEffectiveDarkTheme
import kotlin.math.roundToInt

@Composable
fun TodayDeskScreen(
    uiState: TodayDeskUiState,
    onCreateFirstProject: () -> Unit,
    onSelectProject: (Long) -> Unit,
    onRequestHint: () -> Unit,
    onTryAnotherPrompt: () -> Unit,
    onToggleDoneForToday: (Boolean) -> Unit,
    onDraftChange: (String) -> Unit,
    onUndoDraft: () -> Unit,
    onHelpMeStart: () -> Unit,
    onTightenDraft: () -> Unit,
    onEditableSuggestionChange: (String) -> Unit,
    onAcceptSuggestionReplace: () -> Unit,
    onAcceptSuggestionInsert: () -> Unit,
    onDismissSuggestion: () -> Unit,
    onToggleDimMode: (Boolean) -> Unit,
    onToggleKeepAwake: (Boolean) -> Unit,
    onUpdatePageEstimate: (linesPerPage: Int, wordsPerLine: Int) -> Unit,
    onToggleCardIncludeInPrompt: (cardId: String, include: Boolean) -> Unit,
    onToggleCardVisible: (cardId: String, visible: Boolean) -> Unit,
    onRefreshWeather: () -> Unit,
    onSearchCityWeather: (String) -> Unit,
    onUseApproximateLocation: () -> Unit,
    onToggleFocusTimer: () -> Unit,
    onResetFocusTimer: () -> Unit,
    onSelectFocusPreset: (Int) -> Unit,
    onStartBreakTimer: () -> Unit,
    onDismissTimerCompletion: () -> Unit,
    onDismissBanner: () -> Unit,
    modifier: Modifier = Modifier,
    a2uiSurfaces: List<A2uiSurfaceModel> = emptyList(),
    onRestoreA2uiSurface: () -> Unit = {},
    onToggleDiscreetMode: (Boolean) -> Unit = {},
    onSetThemeMode: (AppThemeMode) -> Unit = {},
    onToggleLightDark: (Boolean) -> Unit = {},
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val keepAwakeEnabled = uiState.preferences.keepScreenAwakeInDeskMode && uiState.activeProject != null

    // Keep display awake ONLY while Desk Mode is open in foreground AND setting is enabled
    DisposableEffect(lifecycleOwner, keepAwakeEnabled) {
        val activity = context.findActivity()
        val window = activity?.window
        fun applyKeepScreenOn(on: Boolean) {
            if (window == null) return
            if (on) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> applyKeepScreenOn(keepAwakeEnabled)
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> applyKeepScreenOn(false)
                else -> Unit
            }
        }
        if (lifecycleOwner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            applyKeepScreenOn(keepAwakeEnabled)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            applyKeepScreenOn(false)
        }
    }

    if (uiState.isLoading) {
        Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    val activeProject = uiState.activeProject
    val todayEntry = uiState.todayEntry

    if (activeProject == null) {
        EmptyDeskState(
            onCreateFirstProject = onCreateFirstProject,
            modifier = modifier,
        )
        return
    }

    var showHints by rememberSaveable(activeProject.id, todayEntry?.promptText) { mutableStateOf(false) }
    var showDraftDrawer by rememberSaveable(activeProject.id) { mutableStateOf(false) }
    LaunchedEffect(uiState.openDraftDrawerNonce) {
        if (uiState.openDraftDrawerNonce > 0) {
            showDraftDrawer = true
        }
    }
    var showCardsPanel by rememberSaveable(activeProject.id) { mutableStateOf(true) }
    var showEstimatorDialog by rememberSaveable { mutableStateOf(false) }
    var showProjectPickerDialog by rememberSaveable { mutableStateOf(false) }
    var showCustomizeCardsDialog by rememberSaveable { mutableStateOf(false) }

    val visibleCards = remember(uiState.cards) { uiState.cards.filter { it.isVisible } }
    val shouldShowSideCards = showCardsPanel && visibleCards.isNotEmpty()
    val isDimMode = uiState.preferences.dimDeskModeEnabled
    val effectiveDark = isEffectiveDarkTheme(
        themeMode = uiState.preferences.themeMode,
        isDimDeskMode = isDimMode,
    )
    val density = LocalDensity.current
    val isAccessibilityScale = density.fontScale > 1.15f

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val isLandscapeDesk = maxWidth > maxHeight && maxWidth >= 560.dp

        if (isLandscapeDesk) {
            // LANDSCAPE DESK MODE: Prompt on left (full width if info cards hidden), adaptive A2UI + info cards on right.
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                val leftScrollState = rememberScrollState()
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .then(
                            if (isAccessibilityScale || showHints || showDraftDrawer) {
                                Modifier.verticalScroll(leftScrollState)
                            } else {
                                Modifier
                            },
                        ),
                    verticalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        DeskHeaderBar(
                            project = activeProject,
                            hasMultipleProjects = uiState.projects.size > 1,
                            isCompleted = todayEntry?.isCompleted == true,
                            isDarkEffective = effectiveDark,
                            isDimMode = isDimMode,
                            keepAwake = uiState.preferences.keepScreenAwakeInDeskMode,
                            hasVisibleCardsConfigured = visibleCards.isNotEmpty(),
                            cardsShown = showCardsPanel,
                            showThemeQuickToggle = true,
                            onOpenProjectPicker = { showProjectPickerDialog = true },
                            onOpenEstimator = { showEstimatorDialog = true },
                            onToggleLightDark = { onToggleLightDark(effectiveDark) },
                            onToggleDimMode = { onToggleDimMode(!isDimMode) },
                            onToggleKeepAwake = { onToggleKeepAwake(!uiState.preferences.keepScreenAwakeInDeskMode) },
                            onToggleCardsShown = { showCardsPanel = !showCardsPanel },
                            onOpenCustomizeCards = { showCustomizeCardsDialog = true },
                        )

                        uiState.statusBannerMessage?.let { banner ->
                            DiscreetBanner(message = banner, onDismiss = onDismissBanner)
                        }

                        if (todayEntry != null) {
                            ProactiveGlanceRow(
                                pulse = uiState.proactivePulse,
                                audience = if (!uiState.preferences.discreetDeskModeEnabled) activeProject.audience else null,
                                modifier = Modifier.fillMaxWidth(),
                            )

                            PromptDisplayBlock(
                                promptText = todayEntry.promptText,
                                isGenerating = uiState.isGeneratingPrompt,
                                isLandscape = true,
                                modifier = Modifier.fillMaxWidth(),
                            )

                            val starterPeek = uiState.proactivePulse.starterPeek
                            if (!showHints && !showDraftDrawer && starterPeek != null) {
                                Surface(
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
                                    shape = MaterialTheme.shapes.small,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { showHints = true }
                                        .testTag("desk_proactive_spark_peek"),
                                ) {
                                    Text(
                                        text = "Starter: $starterPeek",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    )
                                }
                            }

                            AnimatedVisibility(visible = showHints && todayEntry.hints.isNotEmpty()) {
                                HintsBox(hints = todayEntry.hints)
                            }
                        }
                    }

                    val haptics = LocalHapticFeedback.current
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CompactDeskControlsRow(
                            isCompleted = todayEntry?.isCompleted == true,
                            isGeneratingHint = uiState.isGeneratingHint,
                            isGeneratingPrompt = uiState.isGeneratingPrompt,
                            showDraftDrawer = showDraftDrawer,
                            hasDraftContent = uiState.draftText.isNotBlank(),
                            compactTimerLabel = if (!shouldShowSideCards) {
                                val rem = uiState.focusTimer.remainingSeconds
                                val timeStr = "%02d:%02d".format(rem / 60, rem % 60)
                                if (uiState.focusTimer.isRunning) "Pause $timeStr" else "Focus $timeStr"
                            } else {
                                null
                            },
                            onToggleCompactTimer = onToggleFocusTimer,
                            onRequestHint = {
                                showHints = true
                                onRequestHint()
                            },
                            onTryAnother = onTryAnotherPrompt,
                            onToggleDone = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                onToggleDoneForToday(!(todayEntry?.isCompleted ?: false))
                            },
                            onToggleDraft = { showDraftDrawer = !showDraftDrawer },
                        )

                        AnimatedVisibility(visible = showDraftDrawer) {
                            DigitalDraftPanel(
                                draftText = uiState.draftText,
                                estimatedWordsPerPage = activeProject.estimatedWordsPerPage,
                                canUndo = uiState.canUndoDraft,
                                isAssisting = uiState.isGeneratingDraftAssist,
                                pendingSuggestion = uiState.pendingSuggestion,
                                editableSuggestionText = uiState.editableSuggestionText,
                                onDraftChange = onDraftChange,
                                onUndo = onUndoDraft,
                                onHelpMeStart = onHelpMeStart,
                                onTightenDraft = onTightenDraft,
                                onEditableSuggestionChange = onEditableSuggestionChange,
                                onAcceptSuggestionReplace = onAcceptSuggestionReplace,
                                onAcceptSuggestionInsert = onAcceptSuggestionInsert,
                                onDismissSuggestion = onDismissSuggestion,
                            )
                        }
                    }
                }

                if (shouldShowSideCards) {
                    Column(
                        modifier = Modifier
                            .width(300.dp)
                            .fillMaxHeight()
                            .verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        DeskInfoCardList(
                            cards = visibleCards,
                            a2uiSurfaces = a2uiSurfaces,
                            isDimMode = isDimMode,
                            manualCityQuery = uiState.preferences.manualCityQuery,
                            onToggleIncludeInPrompt = onToggleCardIncludeInPrompt,
                            onRefreshWeather = onRefreshWeather,
                            onSearchCityWeather = onSearchCityWeather,
                            onUseApproximateLocation = onUseApproximateLocation,
                            onToggleFocusTimer = onToggleFocusTimer,
                            onResetFocusTimer = onResetFocusTimer,
                            onSelectFocusPreset = onSelectFocusPreset,
                            onStartBreakTimer = onStartBreakTimer,
                            onDismissTimerCompletion = onDismissTimerCompletion,
                            onRequestAnotherSpark = onRequestHint,
                            onRestoreA2uiSurface = onRestoreA2uiSurface,
                        )
                    }
                }
            }
        } else {
            // PORTRAIT MODE: Single spacious editorial column
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp, vertical = 14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                DeskHeaderBar(
                    project = activeProject,
                    hasMultipleProjects = uiState.projects.size > 1,
                    isCompleted = todayEntry?.isCompleted == true,
                    isDarkEffective = effectiveDark,
                    isDimMode = isDimMode,
                    keepAwake = uiState.preferences.keepScreenAwakeInDeskMode,
                    hasVisibleCardsConfigured = visibleCards.isNotEmpty(),
                    cardsShown = showCardsPanel,
                    showThemeQuickToggle = false,
                    onOpenProjectPicker = { showProjectPickerDialog = true },
                    onOpenEstimator = { showEstimatorDialog = true },
                    onToggleLightDark = { onToggleLightDark(effectiveDark) },
                    onToggleDimMode = { onToggleDimMode(!isDimMode) },
                    onToggleKeepAwake = { onToggleKeepAwake(!uiState.preferences.keepScreenAwakeInDeskMode) },
                    onToggleCardsShown = { showCardsPanel = !showCardsPanel },
                    onOpenCustomizeCards = { showCustomizeCardsDialog = true },
                )

                uiState.statusBannerMessage?.let { banner ->
                    DiscreetBanner(message = banner, onDismiss = onDismissBanner)
                }

                if (todayEntry != null) {
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (isDimMode) {
                                MaterialTheme.colorScheme.surfaceContainerLow
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerLowest
                            },
                        ),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            PromptDisplayBlock(
                                promptText = todayEntry.promptText,
                                isGenerating = uiState.isGeneratingPrompt,
                                isLandscape = false,
                            )

                            AnimatedVisibility(visible = showHints && todayEntry.hints.isNotEmpty()) {
                                HintsBox(hints = todayEntry.hints)
                            }
                        }
                    }

                    CompactDeskControlsRow(
                        isCompleted = todayEntry.isCompleted,
                        isGeneratingHint = uiState.isGeneratingHint,
                        isGeneratingPrompt = uiState.isGeneratingPrompt,
                        showDraftDrawer = showDraftDrawer,
                        hasDraftContent = uiState.draftText.isNotBlank(),
                        compactTimerLabel = if (!shouldShowSideCards) {
                            val rem = uiState.focusTimer.remainingSeconds
                            val timeStr = "%02d:%02d".format(rem / 60, rem % 60)
                            if (uiState.focusTimer.isRunning) "Pause $timeStr" else "Focus $timeStr"
                        } else {
                            null
                        },
                        onToggleCompactTimer = onToggleFocusTimer,
                        onRequestHint = {
                            showHints = true
                            onRequestHint()
                        },
                        onTryAnother = onTryAnotherPrompt,
                        onToggleDone = { onToggleDoneForToday(!todayEntry.isCompleted) },
                        onToggleDraft = { showDraftDrawer = !showDraftDrawer },
                    )

                    AnimatedVisibility(visible = showDraftDrawer) {
                        DigitalDraftPanel(
                            draftText = uiState.draftText,
                            estimatedWordsPerPage = activeProject.estimatedWordsPerPage,
                            canUndo = uiState.canUndoDraft,
                            isAssisting = uiState.isGeneratingDraftAssist,
                            pendingSuggestion = uiState.pendingSuggestion,
                            editableSuggestionText = uiState.editableSuggestionText,
                            onDraftChange = onDraftChange,
                            onUndo = onUndoDraft,
                            onHelpMeStart = onHelpMeStart,
                            onTightenDraft = onTightenDraft,
                            onEditableSuggestionChange = onEditableSuggestionChange,
                            onAcceptSuggestionReplace = onAcceptSuggestionReplace,
                            onAcceptSuggestionInsert = onAcceptSuggestionInsert,
                            onDismissSuggestion = onDismissSuggestion,
                        )
                    }
                }

                if (shouldShowSideCards) {
                    DeskInfoCardList(
                        cards = visibleCards,
                        a2uiSurfaces = a2uiSurfaces,
                        isDimMode = isDimMode,
                        manualCityQuery = uiState.preferences.manualCityQuery,
                        onToggleIncludeInPrompt = onToggleCardIncludeInPrompt,
                        onRefreshWeather = onRefreshWeather,
                        onSearchCityWeather = onSearchCityWeather,
                        onUseApproximateLocation = onUseApproximateLocation,
                        onToggleFocusTimer = onToggleFocusTimer,
                        onResetFocusTimer = onResetFocusTimer,
                        onSelectFocusPreset = onSelectFocusPreset,
                        onStartBreakTimer = onStartBreakTimer,
                        onDismissTimerCompletion = onDismissTimerCompletion,
                        onRequestAnotherSpark = onRequestHint,
                        onRestoreA2uiSurface = onRestoreA2uiSurface,
                    )
                }

                Spacer(Modifier.height(12.dp))
            }
        }
    }

    if (showEstimatorDialog && activeProject.pageSizeLabel != null) {
        HandwritingEstimatorDialog(
            pageSizeLabel = activeProject.pageSizeLabel,
            initialLines = activeProject.linesPerPage,
            initialWordsPerLine = activeProject.wordsPerLine,
            onDismiss = { showEstimatorDialog = false },
            onApply = { lines, words ->
                onUpdatePageEstimate(lines, words)
                showEstimatorDialog = false
            },
        )
    }

    if (showProjectPickerDialog) {
        AlertDialog(
            onDismissRequest = { showProjectPickerDialog = false },
            title = { Text("Switch journal project") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    uiState.projects.forEach { proj ->
                        val selected = proj.id == activeProject.id
                        Surface(
                            color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier
                                .fillMaxWidth()
                                .minimumInteractiveComponentSize()
                                .clickable {
                                    onSelectProject(proj.id)
                                    showProjectPickerDialog = false
                                },
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    text = proj.title,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f),
                                )
                                proj.pageSizeLabel?.let { size ->
                                    Text(
                                        text = size,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showProjectPickerDialog = false }) { Text("Close") }
            },
        )
    }

    if (showCustomizeCardsDialog) {
        DeskCardsCustomizeDialog(
            project = activeProject,
            themeMode = uiState.preferences.themeMode,
            discreetMode = uiState.preferences.discreetDeskModeEnabled,
            onSelectThemeMode = onSetThemeMode,
            onToggleVisible = onToggleCardVisible,
            onToggleIncludeInPrompt = onToggleCardIncludeInPrompt,
            onToggleDiscreetMode = onToggleDiscreetMode,
            onDismiss = { showCustomizeCardsDialog = false },
        )
    }
}

@Composable
private fun DeskHeaderBar(
    project: JournalProject,
    hasMultipleProjects: Boolean,
    isCompleted: Boolean,
    isDarkEffective: Boolean,
    isDimMode: Boolean,
    keepAwake: Boolean,
    hasVisibleCardsConfigured: Boolean,
    cardsShown: Boolean,
    showThemeQuickToggle: Boolean,
    onOpenProjectPicker: () -> Unit,
    onOpenEstimator: () -> Unit,
    onToggleLightDark: () -> Unit,
    onToggleDimMode: () -> Unit,
    onToggleKeepAwake: () -> Unit,
    onToggleCardsShown: () -> Unit,
    onOpenCustomizeCards: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(1f),
        ) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .then(
                        if (hasMultipleProjects) {
                            Modifier.clickable(onClick = onOpenProjectPicker)
                        } else {
                            Modifier
                        },
                    )
                    .testTag("desk_project_title"),
            ) {
                Text(
                    text = project.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                )
            }

            project.estimatedWordsPerPage?.let { estWords ->
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .clickable(onClick = onOpenEstimator)
                        .testTag("page_estimate_chip"),
                ) {
                    Text(
                        text = "${project.pageSizeLabel} · ~$estWords w",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
            }

            if (isCompleted) {
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.testTag("completed_today_badge"),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.CheckCircle,
                            contentDescription = "Done for today",
                            tint = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "Done",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(
                onClick = onToggleKeepAwake,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("desk_awake_toggle"),
            ) {
                Icon(
                    imageVector = Icons.Outlined.ScreenLockPortrait,
                    contentDescription = if (keepAwake) "Screen stays awake in Desk Mode" else "Allow screen sleep in Desk Mode",
                    tint = if (keepAwake) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (showThemeQuickToggle) {
                IconButton(
                    onClick = onToggleLightDark,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("desk_theme_toggle"),
                ) {
                    Icon(
                        imageVector = if (isDarkEffective) Icons.Outlined.LightMode else Icons.Outlined.DarkMode,
                        contentDescription = if (isDarkEffective) "Switch to Warm Light mode" else "Switch to Soft Dark mode",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            IconButton(
                onClick = onToggleDimMode,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("desk_dim_toggle"),
            ) {
                Icon(
                    imageVector = if (isDimMode) Icons.Outlined.WbSunny else Icons.Outlined.Bedtime,
                    contentDescription = if (isDimMode) "Exit extra-dim evening mode" else "Enable extra-dim evening mode",
                    tint = if (isDimMode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (hasVisibleCardsConfigured) {
                IconButton(
                    onClick = onToggleCardsShown,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("desk_cards_visibility_toggle"),
                ) {
                    Icon(
                        imageVector = if (cardsShown) Icons.Outlined.Visibility else Icons.Outlined.VisibilityOff,
                        contentDescription = if (cardsShown) "Hide side cards" else "Show side cards",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            IconButton(
                onClick = onOpenCustomizeCards,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("desk_cards_customize_button"),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Tune,
                    contentDescription = "Customize Desk Mode cards and appearance",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PromptDisplayBlock(
    promptText: String,
    isGenerating: Boolean,
    isLandscape: Boolean,
    modifier: Modifier = Modifier,
) {
    val style = when {
        isLandscape && promptText.length > 150 -> MaterialTheme.typography.headlineMedium
        isLandscape -> MaterialTheme.typography.displayMedium
        promptText.length > 160 -> MaterialTheme.typography.headlineMedium
        else -> MaterialTheme.typography.displayMedium
    }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = "TODAY'S QUESTION",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.semantics { heading() },
        )
        if (isGenerating) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    text = "Finding a fresh angle...",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            Text(
                text = promptText,
                style = style,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.testTag("today_prompt_text"),
            )
        }
    }
}

@Composable
private fun HintsBox(hints: List<String>) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.65f),
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier
            .fillMaxWidth()
            .testTag("hints_box"),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "WRITING HINTS",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            hints.forEach { hint ->
                Text(
                    text = "• $hint",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProactiveGlanceRow(
    pulse: com.example.model.ProactiveDeskPulse,
    audience: String? = null,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = modifier.testTag("desk_proactive_strip"),
    ) {
        GlancePill(text = "Session #${pulse.sessionNumber} · ${pulse.currentAngleLabel}")
        audience?.takeIf { it.isNotBlank() }?.let {
            GlancePill(text = "For: $it")
        }
        GlancePill(text = pulse.continuityCue)
        pulse.untappedTheme?.let { nextTheme ->
            GlancePill(text = "Next theme: $nextTheme")
        }
    }
}

@Composable
private fun GlancePill(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CompactDeskControlsRow(
    isCompleted: Boolean,
    isGeneratingHint: Boolean,
    isGeneratingPrompt: Boolean,
    showDraftDrawer: Boolean,
    hasDraftContent: Boolean,
    compactTimerLabel: String?,
    onToggleCompactTimer: () -> Unit,
    onRequestHint: () -> Unit,
    onTryAnother: () -> Unit,
    onToggleDone: () -> Unit,
    onToggleDraft: () -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (compactTimerLabel != null) {
            OutlinedButton(
                onClick = onToggleCompactTimer,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("desk_compact_timer_chip"),
            ) {
                Icon(Icons.Outlined.Timer, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(compactTimerLabel)
            }
        }

        FilledTonalButton(
            onClick = onRequestHint,
            enabled = !isGeneratingHint && !isGeneratingPrompt,
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .testTag("give_hint_button"),
        ) {
            if (isGeneratingHint) {
                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
            } else {
                Icon(Icons.Outlined.Lightbulb, contentDescription = null, modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(6.dp))
            Text("Give me a hint")
        }

        OutlinedButton(
            onClick = onTryAnother,
            enabled = !isGeneratingPrompt,
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .testTag("try_another_button"),
        ) {
            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text("Try another")
        }

        Button(
            onClick = onToggleDone,
            colors = if (isCompleted) {
                ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            } else {
                ButtonDefaults.buttonColors()
            },
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .testTag("done_today_button"),
        ) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (isCompleted) "Completed today" else "Done for today")
        }

        OutlinedButton(
            onClick = onToggleDraft,
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .testTag("toggle_draft_button"),
        ) {
            Icon(Icons.Outlined.EditNote, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(
                when {
                    showDraftDrawer -> "Hide note"
                    hasDraftContent -> "Edit note"
                    else -> "Optional note"
                },
            )
        }
    }
}

@Composable
private fun DiscreetBanner(message: String, onDismiss: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            Text(
                text = message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) {
                Text("OK")
            }
        }
    }
}

@Composable
private fun EmptyDeskState(
    onCreateFirstProject: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.widthIn(max = 520.dp),
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.AutoStories,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(40.dp),
                )
                Text(
                    text = "A calm desk companion for writing on paper.",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.semantics { heading() },
                )
                Text(
                    text = "Paste a freeform brief describing your notebook, project, or routine. Journal Companion stays local on your device and gives you one concrete question at a time.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(4.dp))
                Button(
                    onClick = onCreateFirstProject,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("empty_create_project_button"),
                ) {
                    Icon(Icons.Outlined.Add, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Create your first journal project")
                }
            }
        }
    }
}

@Composable
private fun HandwritingEstimatorDialog(
    pageSizeLabel: String,
    initialLines: Int,
    initialWordsPerLine: Int,
    onDismiss: () -> Unit,
    onApply: (lines: Int, words: Int) -> Unit,
) {
    var lines by remember { mutableIntStateOf(initialLines) }
    var words by remember { mutableIntStateOf(initialWordsPerLine) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Handwriting page estimate ($pageSizeLabel)") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Adjust to match your handwriting on this notebook. This is an estimate only—never an editing limit.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = "~${lines * words} words per page ($lines lines × $words words/line)",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Column {
                    Text("Lines per page: $lines", style = MaterialTheme.typography.labelLarge)
                    Slider(
                        value = lines.toFloat(),
                        onValueChange = { lines = it.roundToInt() },
                        valueRange = 8f..40f,
                    )
                }
                Column {
                    Text("Words per line: $words", style = MaterialTheme.typography.labelLarge)
                    Slider(
                        value = words.toFloat(),
                        onValueChange = { words = it.roundToInt() },
                        valueRange = 4f..14f,
                    )
                }
            }
        },
        confirmButton = {
            Button(onClick = { onApply(lines, words) }) { Text("Save estimate") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeskCardsCustomizeDialog(
    project: JournalProject,
    themeMode: AppThemeMode,
    discreetMode: Boolean,
    onSelectThemeMode: (AppThemeMode) -> Unit,
    onToggleVisible: (cardId: String, visible: Boolean) -> Unit,
    onToggleIncludeInPrompt: (cardId: String, include: Boolean) -> Unit,
    onToggleDiscreetMode: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Desk appearance & cards") },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "Appearance",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    AppThemeMode.entries.forEach { mode ->
                        val icon = when (mode) {
                            AppThemeMode.SYSTEM -> Icons.Outlined.Contrast
                            AppThemeMode.LIGHT -> Icons.Outlined.LightMode
                            AppThemeMode.DARK -> Icons.Outlined.DarkMode
                        }
                        FilterChip(
                            selected = themeMode == mode,
                            onClick = { onSelectThemeMode(mode) },
                            leadingIcon = { Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp)) },
                            label = { Text(mode.displayName, style = MaterialTheme.typography.labelSmall) },
                            modifier = Modifier.testTag("dialog_theme_${mode.name.lowercase()}"),
                        )
                    }
                }
                Text(
                    text = "Choose which cards sit beside your notebook and whether Time or Weather feeds into today's prompt.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                CardCustomizeRow(
                    title = "Show Focus Timer card",
                    checked = project.showTimerCard,
                    onCheckedChange = { onToggleVisible("focus_timer", it) },
                    testTag = "dialog_toggle_show_timer",
                )
                CardCustomizeRow(
                    title = "Show Date & Time card",
                    checked = project.showDateTimeCard,
                    onCheckedChange = { onToggleVisible("date_time", it) },
                    testTag = "dialog_toggle_show_datetime",
                )
                if (project.showDateTimeCard) {
                    CardCustomizeRow(
                        title = "Include Date & Time in prompt",
                        checked = project.includeDateTimeInPrompt,
                        onCheckedChange = { onToggleIncludeInPrompt("date_time", it) },
                        testTag = "dialog_toggle_prompt_datetime",
                    )
                }
                CardCustomizeRow(
                    title = "Show Weather card",
                    checked = project.showWeatherCard,
                    onCheckedChange = { onToggleVisible("weather", it) },
                    testTag = "dialog_toggle_show_weather",
                )
                if (project.showWeatherCard) {
                    CardCustomizeRow(
                        title = "Include Weather in prompt",
                        checked = project.includeWeatherInPrompt,
                        onCheckedChange = { onToggleIncludeInPrompt("weather", it) },
                        testTag = "dialog_toggle_prompt_weather",
                    )
                }
                CardCustomizeRow(
                    title = "Show A2UI Desk Companion",
                    checked = project.showA2uiCompanionCard,
                    onCheckedChange = { onToggleVisible("a2ui_companion", it) },
                    testTag = "dialog_toggle_show_a2ui",
                )
                CardCustomizeRow(
                    title = "Discreet mode (hide brief, audience & notes)",
                    checked = discreetMode,
                    onCheckedChange = onToggleDiscreetMode,
                    testTag = "dialog_toggle_discreet_mode",
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Done") }
        },
    )
}

@Composable
private fun CardCustomizeRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    testTag: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize(),
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f).padding(end = 8.dp),
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(testTag),
        )
    }
}

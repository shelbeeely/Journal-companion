package com.example.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoStories
import androidx.compose.material.icons.filled.FolderCopy
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.FolderCopy
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.ui.screens.HistoryScreen
import com.example.ui.screens.ProjectEditorScreen
import com.example.ui.screens.ProjectWizardScreen
import com.example.ui.screens.ProjectsScreen
import com.example.ui.screens.SettingsScreen
import com.example.ui.screens.TodayDeskScreen
import kotlinx.serialization.Serializable

@Serializable data object TodayRoute
@Serializable data object ProjectsRoute
@Serializable data object ProjectEditorRoute
@Serializable data object HistoryRoute
@Serializable data object SettingsRoute

private data class TopLevelDestination(
    val route: Any,
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector,
    val testTag: String,
    val matchClass: kotlin.reflect.KClass<*>,
)

@Composable
fun JournalCompanionApp(
    viewModel: MainViewModel,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val editorState by viewModel.editorState.collectAsStateWithLifecycle()
    val a2uiSurfaces by viewModel.a2uiSurfaces.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = backStackEntry?.destination

    val destinations = listOf(
        TopLevelDestination(TodayRoute, "Today", Icons.Filled.AutoStories, Icons.Outlined.AutoStories, "nav_today", TodayRoute::class),
        TopLevelDestination(ProjectsRoute, "Projects", Icons.Filled.FolderCopy, Icons.Outlined.FolderCopy, "nav_projects", ProjectsRoute::class),
        TopLevelDestination(HistoryRoute, "History", Icons.Filled.History, Icons.Outlined.History, "nav_history", HistoryRoute::class),
        TopLevelDestination(SettingsRoute, "Settings", Icons.Filled.Settings, Icons.Outlined.Settings, "nav_settings", SettingsRoute::class),
    )

    val isTopLevelRoute = currentDestination == null || destinations.any { currentDestination.hasRoute(it.matchClass) }

    fun navigateTopLevel(route: Any) {
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }

    BoxWithConstraints(modifier = modifier.fillMaxSize()) {
        val useNavigationRail = maxWidth > maxHeight && maxWidth >= 560.dp

        Scaffold(
            contentWindowInsets = WindowInsets.safeDrawing,
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                if (isTopLevelRoute && !useNavigationRail) {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLow) {
                        destinations.forEach { dest ->
                            val selected = currentDestination?.hasRoute(dest.matchClass) == true
                            NavigationBarItem(
                                selected = selected,
                                onClick = { navigateTopLevel(dest.route) },
                                icon = {
                                    Icon(
                                        imageVector = if (selected) dest.selectedIcon else dest.unselectedIcon,
                                        contentDescription = dest.label,
                                    )
                                },
                                label = { Text(dest.label) },
                                modifier = Modifier.testTag(dest.testTag),
                            )
                        }
                    }
                }
            },
        ) { innerPadding ->
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding),
            ) {
                if (isTopLevelRoute && useNavigationRail) {
                    NavigationRail(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                        modifier = Modifier.fillMaxHeight(),
                    ) {
                        destinations.forEach { dest ->
                            val selected = currentDestination?.hasRoute(dest.matchClass) == true
                            NavigationRailItem(
                                selected = selected,
                                onClick = { navigateTopLevel(dest.route) },
                                icon = {
                                    Icon(
                                        imageVector = if (selected) dest.selectedIcon else dest.unselectedIcon,
                                        contentDescription = dest.label,
                                    )
                                },
                                label = { Text(dest.label) },
                                modifier = Modifier
                                    .padding(vertical = 4.dp)
                                    .testTag(dest.testTag),
                            )
                        }
                    }
                }

                NavHost(
                    navController = navController,
                    startDestination = TodayRoute,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                ) {
                    composable<TodayRoute> {
                        TodayDeskScreen(
                            uiState = uiState,
                            a2uiSurfaces = a2uiSurfaces,
                            onCreateFirstProject = {
                                viewModel.startNewProjectEditor()
                                navController.navigate(ProjectEditorRoute)
                            },
                            onSelectProject = viewModel::selectProject,
                            onRequestHint = viewModel::requestHint,
                            onTryAnotherPrompt = viewModel::tryAnotherPrompt,
                            onToggleDoneForToday = viewModel::markDoneForToday,
                            onDraftChange = viewModel::onDraftChanged,
                            onUndoDraft = viewModel::undoDraftChange,
                            onHelpMeStart = viewModel::requestHelpMeStart,
                            onTightenDraft = viewModel::requestTightenDraft,
                            onEditableSuggestionChange = viewModel::updateEditableSuggestion,
                            onAcceptSuggestionReplace = { viewModel.acceptSuggestion(appendInsteadOfReplace = false) },
                            onAcceptSuggestionInsert = { viewModel.acceptSuggestion(appendInsteadOfReplace = true) },
                            onDismissSuggestion = viewModel::dismissSuggestion,
                            onSetThemeMode = viewModel::setThemeMode,
                            onToggleLightDark = viewModel::toggleLightDarkTheme,
                            onToggleDimMode = viewModel::setDimDeskMode,
                            onToggleKeepAwake = viewModel::setKeepScreenAwake,
                            onToggleDiscreetMode = viewModel::setDiscreetDeskMode,
                            onRestoreA2uiSurface = viewModel::restoreA2uiSurface,
                            onUpdatePageEstimate = { lines, words ->
                                viewModel.updateActiveProjectSettings {
                                    it.copy(linesPerPage = lines, wordsPerLine = words)
                                }
                            },
                            onToggleCardIncludeInPrompt = { cardId, include ->
                                viewModel.updateActiveProjectSettings { proj ->
                                    when (cardId) {
                                        "date_time" -> proj.copy(includeDateTimeInPrompt = include)
                                        "weather" -> proj.copy(includeWeatherInPrompt = include)
                                        else -> proj
                                    }
                                }
                            },
                            onToggleCardVisible = { cardId, visible ->
                                viewModel.updateActiveProjectSettings { proj ->
                                    when (cardId) {
                                        "focus_timer" -> proj.copy(showTimerCard = visible)
                                        "date_time" -> proj.copy(showDateTimeCard = visible)
                                        "weather" -> proj.copy(showWeatherCard = visible)
                                        "a2ui_companion" -> proj.copy(showSparksCard = visible, showRhythmCard = visible)
                                        "sparks" -> proj.copy(showSparksCard = visible)
                                        "rhythm" -> proj.copy(showRhythmCard = visible)
                                        else -> proj
                                    }
                                }
                            },
                            onRefreshWeather = {
                                val city = uiState.preferences.manualCityQuery ?: uiState.weatherSnapshot?.cityLabel
                                if (!city.isNullOrBlank()) {
                                    viewModel.refreshWeatherByCity(city)
                                } else {
                                    navigateTopLevel(SettingsRoute)
                                }
                            },
                            onSearchCityWeather = viewModel::refreshWeatherByCity,
                            onUseApproximateLocation = viewModel::refreshWeatherUsingApproximateLocation,
                            onToggleFocusTimer = viewModel::toggleFocusTimer,
                            onResetFocusTimer = viewModel::resetFocusTimer,
                            onSelectFocusPreset = viewModel::selectFocusPreset,
                            onStartBreakTimer = { viewModel.startBreakTimer() },
                            onDismissTimerCompletion = viewModel::dismissTimerCompletion,
                            onDismissBanner = viewModel::dismissBanner,
                        )
                    }

                    composable<ProjectsRoute> {
                        ProjectsScreen(
                            projects = uiState.projects,
                            activeProjectId = uiState.activeProject?.id,
                            onSelectProject = { id ->
                                viewModel.selectProject(id)
                                navigateTopLevel(TodayRoute)
                            },
                            onCreateProject = {
                                viewModel.startNewProjectEditor()
                                navController.navigate(ProjectEditorRoute)
                            },
                            onEditProject = { proj ->
                                viewModel.startEditingProject(proj)
                                navController.navigate(ProjectEditorRoute)
                            },
                            onDeleteProject = viewModel::deleteProject,
                        )
                    }

                    composable<ProjectEditorRoute> {
                        if (editorState.editingProjectId == null) {
                            ProjectWizardScreen(
                                state = editorState,
                                onBriefChange = viewModel::updateEditorBrief,
                                onUpdateWizardInputs = viewModel::updateWizardInputs,
                                onGoToStep = viewModel::goToWizardStep,
                                onProposeWithAiCore = viewModel::analyzeEditorBrief,
                                onSkipAiManualSetup = viewModel::skipAiAndUseManualWizardSetup,
                                onUpdateProposed = viewModel::updateProposedSetup,
                                onUpdateToggles = viewModel::updateEditorToggles,
                                onSave = {
                                    viewModel.saveEditorProject {
                                        navController.popBackStack()
                                        navigateTopLevel(TodayRoute)
                                    }
                                },
                                onBack = { navController.popBackStack() },
                            )
                        } else {
                            ProjectEditorScreen(
                                state = editorState,
                                onBriefChange = viewModel::updateEditorBrief,
                                onAnalyzeBrief = viewModel::analyzeEditorBrief,
                                onManualSetup = viewModel::openManualSetupInEditor,
                                onUpdateProposed = viewModel::updateProposedSetup,
                                onUpdateToggles = viewModel::updateEditorToggles,
                                onSave = {
                                    viewModel.saveEditorProject {
                                        navController.popBackStack()
                                        navigateTopLevel(TodayRoute)
                                    }
                                },
                                onBack = { navController.popBackStack() },
                            )
                        }
                    }

                    composable<HistoryRoute> {
                        HistoryScreen(
                            activeProject = uiState.activeProject,
                            entries = uiState.projectEntries,
                        )
                    }

                    composable<SettingsRoute> {
                        SettingsScreen(
                            uiState = uiState,
                            onSetKeepScreenAwake = viewModel::setKeepScreenAwake,
                            onSetThemeMode = viewModel::setThemeMode,
                            onSetDimDeskMode = viewModel::setDimDeskMode,
                            onSetHideInRecents = viewModel::setHideInRecents,
                            onSetDiscreetDeskMode = viewModel::setDiscreetDeskMode,
                            onSetScreenSaverMode = viewModel::setScreenSaverMode,
                            onSetScreenSaverDimBrightness = viewModel::setScreenSaverDimBrightness,
                            onSetUseCelsius = viewModel::setUseCelsius,
                            onSearchCityWeather = viewModel::refreshWeatherByCity,
                            onUseApproximateLocation = viewModel::refreshWeatherUsingApproximateLocation,
                            onCheckAiStatus = viewModel::checkAiStatus,
                            onDownloadAiModel = viewModel::startAiModelDownload,
                        )
                    }
                }
            }
        }
    }
}

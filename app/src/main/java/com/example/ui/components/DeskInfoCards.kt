package com.example.ui.components

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.a2ui.model.processor.A2uiSurfaceModel
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.SizeTransform
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.EditLocationAlt
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Thunderstorm
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.WaterDrop
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.a2ui.A2uiSurface
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.model.DeskCardSlot
import com.example.model.FocusPhase
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

@Composable
fun DeskInfoCardList(
    cards: List<DeskCardSlot>,
    a2uiSurfaces: List<A2uiSurfaceModel> = emptyList(),
    isDimMode: Boolean,
    manualCityQuery: String?,
    onToggleIncludeInPrompt: (cardId: String, include: Boolean) -> Unit,
    onRefreshWeather: () -> Unit,
    onSearchCityWeather: (String) -> Unit,
    onUseApproximateLocation: () -> Unit,
    onToggleFocusTimer: () -> Unit,
    onResetFocusTimer: () -> Unit,
    onSelectFocusPreset: (Int) -> Unit,
    onStartBreakTimer: () -> Unit,
    onDismissTimerCompletion: () -> Unit,
    onRequestAnotherSpark: () -> Unit,
    onRestoreA2uiSurface: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        cards.filter { it.isVisible }.forEach { card ->
            when (card) {
                is DeskCardSlot.FocusTimerCard -> FocusTimerCard(
                    card = card,
                    isDimMode = isDimMode,
                    onToggleTimer = onToggleFocusTimer,
                    onResetTimer = onResetFocusTimer,
                    onSelectPreset = onSelectFocusPreset,
                    onStartBreak = onStartBreakTimer,
                    onDismissCompletion = onDismissTimerCompletion,
                )
                is DeskCardSlot.DateTimeCard -> DateTimeInfoCard(
                    card = card,
                    isDimMode = isDimMode,
                    onToggleInclude = { onToggleIncludeInPrompt(card.id, it) },
                )
                is DeskCardSlot.WeatherCard -> WeatherInfoCard(
                    card = card,
                    isDimMode = isDimMode,
                    manualCityQuery = manualCityQuery,
                    onToggleInclude = { onToggleIncludeInPrompt(card.id, it) },
                    onRefresh = onRefreshWeather,
                    onSearchCityWeather = onSearchCityWeather,
                    onUseApproximateLocation = onUseApproximateLocation,
                )
                is DeskCardSlot.A2uiCompanionCard -> A2uiCompanionSurfaceSlot(
                    card = card,
                    surfaces = a2uiSurfaces,
                    isDimMode = isDimMode,
                    onRestoreSurface = onRestoreA2uiSurface,
                )
                is DeskCardSlot.SparksCard -> ProactiveSparksCard(
                    card = card,
                    isDimMode = isDimMode,
                    onRequestAnotherSpark = onRequestAnotherSpark,
                )
                is DeskCardSlot.RhythmCard -> NotebookRhythmCard(
                    card = card,
                    isDimMode = isDimMode,
                )
            }
        }
    }
}

@Composable
fun A2uiCompanionSurfaceSlot(
    card: DeskCardSlot.A2uiCompanionCard,
    surfaces: List<A2uiSurfaceModel>,
    isDimMode: Boolean,
    onRestoreSurface: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val activeSurface = surfaces.firstOrNull { it.id == card.surfaceId } ?: surfaces.firstOrNull()
    if (card.isDismissedForWindow) {
        Surface(
            color = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
            shape = MaterialTheme.shapes.medium,
            modifier = modifier
                .fillMaxWidth()
                .testTag("card_a2ui_companion_quiet"),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text(
                    text = "A2UI cues quieted (${card.dayPartLabel.ifBlank { "session" }})",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    onClick = onRestoreSurface,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("a2ui_restore_button"),
                ) {
                    Text("Show cues")
                }
            }
        }
        return
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_a2ui_companion"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (activeSurface != null) {
            key(activeSurface.id) {
                A2uiSurface(
                    surfaceModel = activeSurface,
                    modifier = Modifier.fillMaxWidth(),
                    loadingContent = {
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(64.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center,
                                modifier = Modifier.padding(12.dp),
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = "Composing A2UI desk surface...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    },
                    errorContent = { err ->
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            shape = MaterialTheme.shapes.medium,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = err.message ?: "Unable to render desk cues right now.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.secondary,
                                modifier = Modifier.padding(12.dp),
                            )
                        }
                    },
                    transitionSpec = {
                        (fadeIn(animationSpec = tween(280)) togetherWith fadeOut(animationSpec = tween(220)))
                            .using(SizeTransform(clip = false))
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FocusTimerCard(
    card: DeskCardSlot.FocusTimerCard,
    isDimMode: Boolean,
    onToggleTimer: () -> Unit,
    onResetTimer: () -> Unit,
    onSelectPreset: (Int) -> Unit,
    onStartBreak: () -> Unit,
    onDismissCompletion: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val state = card.timerState
    val haptics = LocalHapticFeedback.current
    val mins = state.remainingSeconds / 60
    val secs = state.remainingSeconds % 60
    val timeFormatted = "%02d:%02d".format(mins, secs)

    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_focus_timer"),
        colors = CardDefaults.cardColors(
            containerColor = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(
            width = if (state.isRunning) 1.5.dp else 1.dp,
            color = if (state.isRunning) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
        ),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.Timer,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = state.phase.label.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
                ) {
                    val count = state.completedFocusBlocksToday
                    Text(
                        text = "$count block${if (count == 1) "" else "s"} today",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = timeFormatted,
                    style = MaterialTheme.typography.headlineMedium.copy(fontFeatureSettings = "tnum"),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.testTag("focus_timer_countdown"),
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    FilledTonalButton(
                        onClick = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            onToggleTimer()
                        },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("focus_timer_toggle_button"),
                    ) {
                        Icon(
                            imageVector = if (state.isRunning) Icons.Outlined.Pause else Icons.Outlined.PlayArrow,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(if (state.isRunning) "Pause" else "Start")
                    }
                    IconButton(
                        onClick = onResetTimer,
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("focus_timer_reset_button"),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Replay,
                            contentDescription = "Reset focus timer",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            LinearProgressIndicator(
                progress = { state.progressFraction },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp),
            )

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf(10, 15, 25).forEach { preset ->
                    FilterChip(
                        selected = state.phase == FocusPhase.FOCUS && state.presetMinutes == preset,
                        onClick = { onSelectPreset(preset) },
                        label = { Text("${preset}m", style = MaterialTheme.typography.labelSmall) },
                        modifier = Modifier.testTag("focus_preset_$preset"),
                    )
                }
                FilterChip(
                    selected = state.phase == FocusPhase.BREAK,
                    onClick = onStartBreak,
                    label = { Text("5m break", style = MaterialTheme.typography.labelSmall) },
                    modifier = Modifier.testTag("focus_preset_break"),
                )
            }

            state.justFinishedPhase?.let { finished ->
                Surface(
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        Text(
                            text = if (finished == FocusPhase.FOCUS) {
                                "Sprint complete. Take 5m or wrap up."
                            } else {
                                "Break finished. Ready when you are."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = onDismissCompletion) {
                            Text("OK")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun DateTimeInfoCard(
    card: DeskCardSlot.DateTimeCard,
    isDimMode: Boolean,
    onToggleInclude: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_date_time"),
        colors = CardDefaults.cardColors(
            containerColor = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.Schedule,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = card.dayPartLabel.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                ContextModePill(includeInPrompt = card.includeInPrompt)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                text = "${card.formattedTime} · ${card.formattedDate}",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            val rhythmSubtitle = card.daylightSummary
                ?: listOfNotNull(
                    card.writingWindowCue.takeIf { it.isNotBlank() },
                    card.calendarRhythmLabel.takeIf { it.isNotBlank() },
                ).joinToString(" · ")
            if (rhythmSubtitle.isNotBlank()) {
                Text(
                    text = rhythmSubtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(2.dp))
            IncludeInPromptRow(
                label = "Include in today's prompt",
                checked = card.includeInPrompt,
                onCheckedChange = onToggleInclude,
                testTag = "toggle_include_datetime",
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WeatherInfoCard(
    card: DeskCardSlot.WeatherCard,
    isDimMode: Boolean,
    manualCityQuery: String?,
    onToggleInclude: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onSearchCityWeather: (String) -> Unit,
    onUseApproximateLocation: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var showLocationDialog by rememberSaveable { mutableStateOf(false) }
    var locationPermissionDenied by rememberSaveable { mutableStateOf(false) }

    val coarseLocationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            locationPermissionDenied = false
            onUseApproximateLocation()
        } else {
            locationPermissionDenied = true
        }
    }

    fun triggerApproxLocation() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            onUseApproximateLocation()
        } else {
            coarseLocationLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_weather"),
        colors = CardDefaults.cardColors(
            containerColor = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                    Icon(
                        imageVector = weatherIconForCode(card.snapshot?.wmoCode ?: -1),
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = card.snapshot?.cityLabel ?: "WEATHER",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        onClick = { showLocationDialog = !showLocationDialog },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("desk_weather_location_button"),
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.EditLocationAlt,
                            contentDescription = "Set city or approximate location",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    if (card.snapshot != null) {
                        IconButton(
                            onClick = onRefresh,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("refresh_weather_button"),
                        ) {
                            if (card.isLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(
                                    imageVector = Icons.Outlined.Refresh,
                                    contentDescription = "Refresh weather",
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }

            ContextModePill(includeInPrompt = card.includeInPrompt)
            Spacer(Modifier.height(4.dp))

            if (card.snapshot == null) {
                Text(
                    text = if (card.isLoading) "Fetching local weather..." else "No location set yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                card.errorMessage?.let { err ->
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = err,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
                Spacer(Modifier.height(6.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    OutlinedButton(
                        onClick = { showLocationDialog = true },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("setup_weather_button"),
                    ) {
                        Icon(Icons.Outlined.EditLocationAlt, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Enter city")
                    }
                    OutlinedButton(
                        onClick = { triggerApproxLocation() },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("desk_weather_approx_location_button"),
                    ) {
                        Icon(Icons.Outlined.LocationOn, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Approx.")
                    }
                }
            } else {
                val snap = card.snapshot
                val unit = if (card.useCelsius) "°C" else "°F"
                fun fmtTemp(c: Double): Int = if (card.useCelsius) c.roundToInt() else ((c * 9.0 / 5.0) + 32.0).roundToInt()

                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "${fmtTemp(snap.temperatureCelsius)}$unit",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = snap.conditionLabel,
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.padding(bottom = 3.dp),
                    )
                }

                val extraParts = buildList {
                    add("H ${fmtTemp(snap.highCelsius)}$unit · L ${fmtTemp(snap.lowCelsius)}$unit")
                    snap.feelsLikeCelsius?.let { add("Feels ${fmtTemp(it)}$unit") }
                    snap.windSpeedKmh?.let { kmh ->
                        val windStr = if (card.useCelsius) "${kmh.roundToInt()} km/h" else "${(kmh * 0.621371).roundToInt()} mph"
                        add(windStr)
                    }
                }
                Text(
                    text = extraParts.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                snap.precipitationChancePercent?.let { pct ->
                    val periodText = snap.precipitationPeriodLabel?.let { " $it" }.orEmpty()
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.WaterDrop,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "$pct% precip$periodText",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }

                Spacer(Modifier.height(4.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        text = "Fetched ${formatFetchedTime(snap.fetchedAtEpochMs)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (card.isStale) {
                        Surface(
                            color = MaterialTheme.colorScheme.secondaryContainer,
                            shape = MaterialTheme.shapes.small,
                            modifier = Modifier.testTag("weather_stale_badge"),
                        ) {
                            Text(
                                text = "Stale data (cached ${formatRelativeAge(snap.fetchedAtEpochMs)})",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
                }

                card.errorMessage?.let { err ->
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.CloudOff,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = "Offline · showing cached data ($err)",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }
                }

                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Weather data by Open-Meteo.com (CC BY 4.0)",
                    style = MaterialTheme.typography.labelSmall.copy(textDecoration = TextDecoration.Underline),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clickable {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://open-meteo.com/")))
                            }
                        }
                        .padding(vertical = 2.dp),
                )
            }

            if (locationPermissionDenied) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Location permission declined—you can enter any city manually.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }

            AnimatedVisibility(visible = showLocationDialog) {
                var cityDraft by rememberSaveable(manualCityQuery) {
                    mutableStateOf(manualCityQuery ?: card.snapshot?.cityLabel.orEmpty())
                }
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    shape = MaterialTheme.shapes.medium,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                ) {
                    Column(
                        modifier = Modifier.padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = "Weather location",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "Enter a city manually or grant approximate foreground location. Only city or rounded coordinates are sent to Open-Meteo.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = cityDraft,
                            onValueChange = { cityDraft = it },
                            label = { Text("City name") },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("desk_weather_city_input"),
                        )
                        OutlinedButton(
                            onClick = {
                                showLocationDialog = false
                                triggerApproxLocation()
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .minimumInteractiveComponentSize()
                                .testTag("desk_dialog_approx_location_button"),
                        ) {
                            Icon(Icons.Outlined.LocationOn, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Use approximate location")
                        }
                        Row(
                            horizontalArrangement = Arrangement.End,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            TextButton(
                                onClick = { showLocationDialog = false },
                                modifier = Modifier.minimumInteractiveComponentSize(),
                            ) {
                                Text("Cancel")
                            }
                            Spacer(Modifier.width(6.dp))
                            Button(
                                onClick = {
                                    onSearchCityWeather(cityDraft)
                                    showLocationDialog = false
                                },
                                enabled = cityDraft.isNotBlank(),
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("desk_weather_city_submit"),
                            ) {
                                Text("Save city")
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(2.dp))
            IncludeInPromptRow(
                label = "Include in today's prompt",
                checked = card.includeInPrompt,
                onCheckedChange = onToggleInclude,
                testTag = "toggle_include_weather",
            )
        }
    }
}

@Composable
fun ProactiveSparksCard(
    card: DeskCardSlot.SparksCard,
    isDimMode: Boolean,
    onRequestAnotherSpark: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_proactive_sparks"),
        colors = CardDefaults.cardColors(
            containerColor = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.AutoAwesome,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "READY SPARKS",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                TextButton(
                    onClick = onRequestAnotherSpark,
                    enabled = !card.isGeneratingSpark,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("card_next_spark_button"),
                ) {
                    Text(if (card.isGeneratingSpark) "Thinking..." else "Another angle")
                }
            }

            card.activeStarter?.let { starter ->
                Text(
                    text = starter,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            card.recallQuestion?.let { recall ->
                Text(
                    text = "Recall cue: $recall",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f),
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                    Text(
                        text = card.continuityTitle,
                        style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = card.continuityBody,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotebookRhythmCard(
    card: DeskCardSlot.RhythmCard,
    isDimMode: Boolean,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .testTag("card_notebook_rhythm"),
        colors = CardDefaults.cardColors(
            containerColor = if (isDimMode) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerLowest,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.Timeline,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = "NOTEBOOK RHYTHM",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.semantics { heading() },
                    )
                }
                Text(
                    text = "Session #${card.sessionNumber}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Text(
                text = card.cadenceStatus,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface,
            )

            card.estimatedWordsPerPage?.let { estWords ->
                Text(
                    text = "${card.pageSizeLabel ?: "Page"} · ~${estWords}w (${card.linesPerPage} lines × ${card.wordsPerLine}w)",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (card.draftWordCount > 0) {
                    val progress = (card.draftWordCount.toFloat() / estWords.toFloat()).coerceIn(0f, 1f)
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp),
                    )
                    Text(
                        text = "Draft: ${card.draftWordCount} / ~$estWords words (estimate only)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (card.untappedThemes.isNotEmpty() || card.coveredThemes.isNotEmpty()) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    card.untappedThemes.take(3).forEach { theme ->
                        Surface(
                            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
                            shape = MaterialTheme.shapes.small,
                        ) {
                            Text(
                                text = "Next: $theme",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            )
                        }
                    }
                    card.coveredThemes.take(2).forEach { theme ->
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            shape = MaterialTheme.shapes.small,
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(11.dp),
                                )
                                Spacer(Modifier.width(3.dp))
                                Text(
                                    text = theme,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContextModePill(includeInPrompt: Boolean) {
    Surface(
        color = if (includeInPrompt) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        },
        shape = MaterialTheme.shapes.small,
    ) {
        Text(
            text = if (includeInPrompt) "In prompt + desk" else "Supplementary only",
            style = MaterialTheme.typography.labelSmall,
            color = if (includeInPrompt) {
                MaterialTheme.colorScheme.onPrimaryContainer
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun IncludeInPromptRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    testTag: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .clickable { onCheckedChange(!checked) },
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(testTag),
        )
    }
}

private fun formatFetchedTime(epochMs: Long): String {
    return runCatching {
        Instant.ofEpochMilli(epochMs)
            .atZone(ZoneId.systemDefault())
            .format(DateTimeFormatter.ofPattern("MMM d, h:mm a"))
    }.getOrDefault("recently")
}

private fun formatRelativeAge(epochMs: Long): String {
    val diffMinutes = ((System.currentTimeMillis() - epochMs) / 60_000L).coerceAtLeast(1L)
    return if (diffMinutes >= 60L) {
        "${diffMinutes / 60L}h ago"
    } else {
        "${diffMinutes}m ago"
    }
}

private fun weatherIconForCode(code: Int): ImageVector = when (code) {
    0, 1 -> Icons.Outlined.WbSunny
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82 -> Icons.Outlined.WaterDrop
    95, 96, 99 -> Icons.Outlined.Thunderstorm
    else -> Icons.Outlined.Cloud
}

package com.example.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Bedtime
import androidx.compose.material.icons.outlined.CloudDownload
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.model.AiAvailabilityState
import com.example.model.AppThemeMode
import com.example.model.ScreenSaverMode
import com.example.ui.TodayDeskUiState

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    uiState: TodayDeskUiState,
    onSetKeepScreenAwake: (Boolean) -> Unit,
    onSetThemeMode: (AppThemeMode) -> Unit,
    onSetDimDeskMode: (Boolean) -> Unit,
    onSetHideInRecents: (Boolean) -> Unit,
    onSetDiscreetDeskMode: (Boolean) -> Unit = {},
    onSetScreenSaverMode: (ScreenSaverMode) -> Unit = {},
    onSetScreenSaverDimBrightness: (Boolean) -> Unit = {},
    onSetUseCelsius: (Boolean) -> Unit,
    onSearchCityWeather: (String) -> Unit,
    onUseApproximateLocation: () -> Unit,
    onCheckAiStatus: () -> Unit,
    onDownloadAiModel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    var cityInput by rememberSaveable(uiState.preferences.manualCityQuery) {
        mutableStateOf(uiState.preferences.manualCityQuery.orEmpty())
    }
    var locationPermissionDeniedNote by rememberSaveable { mutableStateOf(false) }

    val coarseLocationLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            locationPermissionDeniedNote = false
            onUseApproximateLocation()
        } else {
            locationPermissionDeniedNote = true
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 680.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = "Desk & Privacy Settings",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.semantics { heading() },
            )

            // Appearance & Eye Comfort
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Contrast, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "Appearance & Eye Comfort",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )
                    }

                    Text(
                        text = "Choose Warm Light (matte oat paper), Soft Dark (low-halation charcoal), or match Android's system theme.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        AppThemeMode.entries.forEach { mode ->
                            val icon = when (mode) {
                                AppThemeMode.SYSTEM -> Icons.Outlined.Contrast
                                AppThemeMode.LIGHT -> Icons.Outlined.LightMode
                                AppThemeMode.DARK -> Icons.Outlined.DarkMode
                            }
                            FilterChip(
                                selected = uiState.preferences.themeMode == mode,
                                onClick = { onSetThemeMode(mode) },
                                leadingIcon = {
                                    Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
                                },
                                label = { Text(mode.displayName) },
                                modifier = Modifier.testTag("setting_theme_${mode.name.lowercase()}"),
                            )
                        }
                    }

                    SettingsSwitchRow(
                        title = "Extra-dim evening mode",
                        subtitle = "Ultra-low-glare candlelight surface for late-night desk sessions",
                        checked = uiState.preferences.dimDeskModeEnabled,
                        onCheckedChange = onSetDimDeskMode,
                        testTag = "setting_dim_mode",
                    )
                }
            }

            // Desk Mode & Privacy Controls
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Lock, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "Desk Mode & Privacy",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )
                    }

                    SettingsSwitchRow(
                        title = "Keep screen awake in Desk Mode",
                        subtitle = "Active only while Today Desk Mode is open in the foreground",
                        checked = uiState.preferences.keepScreenAwakeInDeskMode,
                        onCheckedChange = onSetKeepScreenAwake,
                        testTag = "setting_keep_awake",
                    )
                    SettingsSwitchRow(
                        title = "Protect recent-app previews",
                        subtitle = "Hides recent-app switcher thumbnails on Android 13+ (uses FLAG_SECURE on older Android) without affecting live Desk Mode display",
                        checked = uiState.preferences.hideInRecentsEnabled,
                        onCheckedChange = onSetHideInRecents,
                        testTag = "setting_hide_recents",
                    )

                    SettingsSwitchRow(
                        title = "Discreet mode (hide brief & notes)",
                        subtitle = "Off by default so Desk Mode and the Screen Saver surface rich context (brief highlights, goal, audience, tone & recent threads). Turn on in shared spaces.",
                        checked = uiState.preferences.discreetDeskModeEnabled,
                        onCheckedChange = onSetDiscreetDeskMode,
                        testTag = "setting_discreet_mode",
                    )

                    Text(
                        text = "On-device only: journal briefs, drafts, and history are excluded from Android cloud backups and device transfers, never logged, and contain zero analytics.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Ambient Screen Saver (DreamService)
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Bedtime, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "Screen Saver (Docked Desk)",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )
                    }

                    Text(
                        text = "Use Journal Desk as an Android Screen Saver while charging or docked. Shifts gently to protect OLED screens.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        ScreenSaverMode.entries.forEach { mode ->
                            FilterChip(
                                selected = uiState.preferences.screenSaverMode == mode,
                                onClick = { onSetScreenSaverMode(mode) },
                                label = { Text(mode.displayName) },
                                modifier = Modifier.testTag("setting_screensaver_${mode.name.lowercase()}"),
                            )
                        }
                    }

                    SettingsSwitchRow(
                        title = "Dim screen saver brightness",
                        subtitle = "Reduces luminance for bedside and evening charging stands",
                        checked = uiState.preferences.screenSaverDimBrightness,
                        onCheckedChange = onSetScreenSaverDimBrightness,
                        testTag = "setting_screensaver_dim",
                    )

                    var dreamSettingsError by rememberSaveable { mutableStateOf(false) }
                    OutlinedButton(
                        onClick = {
                            val opened = runCatching {
                                context.startActivity(Intent(Settings.ACTION_DREAM_SETTINGS))
                                true
                            }.getOrElse {
                                runCatching {
                                    context.startActivity(Intent(Settings.ACTION_DISPLAY_SETTINGS))
                                    true
                                }.getOrDefault(false)
                            }
                            dreamSettingsError = !opened
                        },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("open_system_screensaver_settings_button"),
                    ) {
                        Icon(Icons.Outlined.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Open Android Screen Saver settings")
                    }
                    if (dreamSettingsError) {
                        Text(
                            text = "Open Android Settings > Display > Screen saver to select Journal Desk.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }
                }
            }

            // Weather Setup & Open-Meteo Attribution
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        text = "Weather Card (Open-Meteo)",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        text = "Enter a city manually or grant approximate location on demand. Only your city query or rounded coordinates are sent to Open-Meteo—never your journal briefs or entries.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    OutlinedTextField(
                        value = cityInput,
                        onValueChange = { cityInput = it },
                        label = { Text("City name (e.g., Seattle, San Francisco)") },
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("weather_city_input"),
                    )

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = { onSearchCityWeather(cityInput) },
                            enabled = !uiState.weatherLoading && cityInput.isNotBlank(),
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("search_city_weather_button"),
                        ) {
                            if (uiState.weatherLoading) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Outlined.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(6.dp))
                            Text("Fetch city weather")
                        }

                        OutlinedButton(
                            onClick = {
                                val granted = ContextCompat.checkSelfPermission(
                                    context,
                                    Manifest.permission.ACCESS_COARSE_LOCATION,
                                ) == PackageManager.PERMISSION_GRANTED
                                if (granted) {
                                    onUseApproximateLocation()
                                } else {
                                    coarseLocationLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                                }
                            },
                            enabled = !uiState.weatherLoading,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("use_approx_location_button"),
                        ) {
                            Icon(Icons.Outlined.LocationOn, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Use approximate location")
                        }
                    }

                    if (locationPermissionDeniedNote) {
                        Text(
                            text = "Location permission declined. You can always enter a city manually above.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }

                    uiState.weatherError?.let { err ->
                        Text(
                            text = err,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                    }

                    SettingsSwitchRow(
                        title = "Use Celsius (°C)",
                        subtitle = "Switch between Fahrenheit and Celsius",
                        checked = uiState.preferences.useCelsius,
                        onCheckedChange = onSetUseCelsius,
                        testTag = "setting_use_celsius",
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(
                            text = "Weather data by Open-Meteo.com",
                            style = MaterialTheme.typography.labelSmall.copy(textDecoration = TextDecoration.Underline),
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clickable {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://open-meteo.com/")))
                                }
                            },
                        )
                        Text(
                            text = "License: CC BY 4.0",
                            style = MaterialTheme.typography.labelSmall.copy(textDecoration = TextDecoration.Underline),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.clickable {
                                runCatching {
                                    context.startActivity(
                                        Intent(Intent.ACTION_VIEW, Uri.parse("https://creativecommons.org/licenses/by/4.0/")),
                                    )
                                }
                            },
                        )
                    }
                }
            }

            // AICore / ML Kit GenAI Prompt API Status
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Memory, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            text = "On-Device AI (Android AICore)",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )
                    }

                    val statusText = when (val s = uiState.aiAvailability) {
                        AiAvailabilityState.Checking -> "Checking Gemini Nano / AICore availability..."
                        AiAvailabilityState.Available -> "Ready: Gemini Nano is downloaded and running completely on-device via AICore."
                        is AiAvailabilityState.Downloadable -> if (s.isDownloading) {
                            val mb = s.bytesDownloaded / (1024.0 * 1024.0)
                            "Downloading Gemini Nano via AICore (${String.format("%.1f", mb)} MB downloaded)..."
                        } else {
                            "Gemini Nano is supported on this device and ready to download via AICore."
                        }
                        is AiAvailabilityState.Unavailable -> s.reason
                        is AiAvailabilityState.Error -> "AICore status error: ${s.message}. Built-in templates remain active."
                    }

                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = statusText,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier
                                .padding(12.dp)
                                .testTag("aicore_status_text"),
                        )
                    }

                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = onCheckAiStatus,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("recheck_aicore_button"),
                        ) {
                            Icon(Icons.Outlined.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Re-check AICore")
                        }
                        val dlState = uiState.aiAvailability as? AiAvailabilityState.Downloadable
                        if (dlState != null && !dlState.isDownloading) {
                            Button(
                                onClick = onDownloadAiModel,
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("download_aicore_button"),
                            ) {
                                Icon(Icons.Outlined.CloudDownload, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("Download Gemini Nano")
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SettingsSwitchRow(
    title: String,
    subtitle: String,
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
            .padding(vertical = 4.dp),
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(text = title, style = MaterialTheme.typography.bodyMedium)
            Text(text = subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(testTag),
        )
    }
}

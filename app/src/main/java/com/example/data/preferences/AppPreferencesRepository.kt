package com.example.data.preferences

import android.content.Context
import android.os.Build
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.example.model.AppThemeMode
import com.example.model.DeskUiPreferences
import com.example.model.ScreenSaverMode
import com.example.model.WeatherSnapshot
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.journalPrefsDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "journal_companion_settings",
)

class AppPreferencesRepository(
    private val dataStore: DataStore<Preferences>,
) {
    constructor(context: Context) : this(context.applicationContext.journalPrefsDataStore)

    private val json = Json { ignoreUnknownKeys = true }

    private object Keys {
        val LAST_ACTIVE_PROJECT_ID = longPreferencesKey("last_active_project_id")
        val KEEP_SCREEN_AWAKE = booleanPreferencesKey("keep_screen_awake_desk")
        val THEME_MODE = stringPreferencesKey("app_theme_mode")
        val DIM_DESK_MODE = booleanPreferencesKey("dim_desk_mode")
        val HIDE_IN_RECENTS = booleanPreferencesKey("hide_in_recents")
        val USE_CELSIUS = booleanPreferencesKey("use_celsius")
        val MANUAL_CITY_QUERY = stringPreferencesKey("manual_city_query")
        val CACHED_WEATHER_JSON = stringPreferencesKey("cached_weather_json")
        val FOCUS_BLOCKS_DATE = stringPreferencesKey("focus_blocks_date")
        val FOCUS_BLOCKS_COUNT = intPreferencesKey("focus_blocks_count")
        val DISCREET_DESK_MODE = booleanPreferencesKey("discreet_desk_mode")
        val SCREEN_SAVER_MODE = stringPreferencesKey("screen_saver_mode")
        val SCREEN_SAVER_DIM = booleanPreferencesKey("screen_saver_dim")
    }

    val uiPreferences: Flow<DeskUiPreferences> = dataStore.data.map { prefs ->
        val rawTheme = prefs[Keys.THEME_MODE]
        val themeMode = AppThemeMode.entries.firstOrNull { it.name == rawTheme } ?: AppThemeMode.SYSTEM
        val rawDreamMode = prefs[Keys.SCREEN_SAVER_MODE]
        val dreamMode = ScreenSaverMode.entries.firstOrNull { it.name == rawDreamMode } ?: ScreenSaverMode.FULL_A2UI
        DeskUiPreferences(
            lastActiveProjectId = prefs[Keys.LAST_ACTIVE_PROJECT_ID]?.takeIf { it > 0L },
            keepScreenAwakeInDeskMode = prefs[Keys.KEEP_SCREEN_AWAKE] ?: true,
            themeMode = themeMode,
            dimDeskModeEnabled = prefs[Keys.DIM_DESK_MODE] ?: false,
            hideInRecentsEnabled = prefs[Keys.HIDE_IN_RECENTS] ?: (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU),
            useCelsius = prefs[Keys.USE_CELSIUS] ?: false,
            manualCityQuery = prefs[Keys.MANUAL_CITY_QUERY],
            discreetDeskModeEnabled = prefs[Keys.DISCREET_DESK_MODE] ?: false,
            screenSaverMode = dreamMode,
            screenSaverDimBrightness = prefs[Keys.SCREEN_SAVER_DIM] ?: true,
        )
    }

    fun observeFocusBlocksCountForDate(dateIso: String): Flow<Int> = dataStore.data.map { prefs ->
        if (prefs[Keys.FOCUS_BLOCKS_DATE] == dateIso) (prefs[Keys.FOCUS_BLOCKS_COUNT] ?: 0) else 0
    }

    val cachedWeather: Flow<WeatherSnapshot?> = dataStore.data.map { prefs ->
        val raw = prefs[Keys.CACHED_WEATHER_JSON] ?: return@map null
        runCatching { json.decodeFromString<WeatherSnapshot>(raw) }.getOrNull()
    }

    suspend fun setLastActiveProjectId(projectId: Long?) {
        dataStore.edit { prefs ->
            if (projectId == null || projectId <= 0L) {
                prefs.remove(Keys.LAST_ACTIVE_PROJECT_ID)
            } else {
                prefs[Keys.LAST_ACTIVE_PROJECT_ID] = projectId
            }
        }
    }

    suspend fun setKeepScreenAwake(enabled: Boolean) {
        dataStore.edit { it[Keys.KEEP_SCREEN_AWAKE] = enabled }
    }

    suspend fun setThemeMode(mode: AppThemeMode) {
        dataStore.edit { it[Keys.THEME_MODE] = mode.name }
    }

    suspend fun setDimDeskMode(enabled: Boolean) {
        dataStore.edit { it[Keys.DIM_DESK_MODE] = enabled }
    }

    suspend fun setHideInRecents(enabled: Boolean) {
        dataStore.edit { it[Keys.HIDE_IN_RECENTS] = enabled }
    }

    suspend fun setUseCelsius(useCelsius: Boolean) {
        dataStore.edit { it[Keys.USE_CELSIUS] = useCelsius }
    }

    suspend fun setManualCityQuery(city: String?) {
        dataStore.edit { prefs ->
            val trimmed = city?.trim().orEmpty()
            if (trimmed.isEmpty()) prefs.remove(Keys.MANUAL_CITY_QUERY) else prefs[Keys.MANUAL_CITY_QUERY] = trimmed
        }
    }

    suspend fun saveCachedWeather(snapshot: WeatherSnapshot) {
        dataStore.edit { prefs ->
            prefs[Keys.CACHED_WEATHER_JSON] = json.encodeToString(snapshot)
        }
    }

    suspend fun incrementFocusBlocksCount(dateIso: String) {
        dataStore.edit { prefs ->
            val current = if (prefs[Keys.FOCUS_BLOCKS_DATE] == dateIso) (prefs[Keys.FOCUS_BLOCKS_COUNT] ?: 0) else 0
            prefs[Keys.FOCUS_BLOCKS_DATE] = dateIso
            prefs[Keys.FOCUS_BLOCKS_COUNT] = current + 1
        }
    }

    suspend fun setDiscreetDeskMode(enabled: Boolean) {
        dataStore.edit { it[Keys.DISCREET_DESK_MODE] = enabled }
    }

    suspend fun setScreenSaverMode(mode: ScreenSaverMode) {
        dataStore.edit { it[Keys.SCREEN_SAVER_MODE] = mode.name }
    }

    suspend fun setScreenSaverDimBrightness(dim: Boolean) {
        dataStore.edit { it[Keys.SCREEN_SAVER_DIM] = dim }
    }
}

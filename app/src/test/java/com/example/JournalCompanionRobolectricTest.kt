package com.example

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.example.ai.AiGenerationResult
import com.example.ai.JournalAiOrchestrator
import com.example.ai.OnDeviceAiClient
import com.example.data.local.JournalDatabase
import com.example.data.preferences.AppPreferencesRepository
import com.example.data.repository.JournalRepository
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.model.processor.processInput
import androidx.a2ui.model.protocol.A2uiClientToServerMessage
import androidx.a2ui.model.protocol.A2uiUserAction
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.a2ui.DeskA2uiAgentEngine
import com.example.a2ui.DeskA2uiCatalog
import com.example.a2ui.DeskContextBuilder
import com.example.dream.DreamAmbientUiState
import com.example.dream.DreamScreenSaverContent
import com.example.dream.JournalDreamService
import com.example.model.AiAvailabilityState
import com.example.model.AppThemeMode
import com.example.model.DeskUiPreferences
import com.example.model.JournalCadence
import com.example.model.JournalProject
import com.example.model.ScreenSaverMode
import com.example.model.WeatherSnapshot
import com.example.ui.JournalCompanionApp
import com.example.ui.MainViewModel
import com.example.ui.theme.JournalCompanionTheme
import com.example.weather.WeatherRepository
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.compose.ui.test.assertTextContains
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import androidx.compose.runtime.getValue
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.performScrollTo
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

private const val SPENCER_BRIEF =
    "3.25\" x 4.5\" Mini journal. How can I fill a page a day for my friend spencer while he's in the psych hospital. I want to tell him all tje thingi like about him, why i appreciate his friends, and that i care but i don'twant to seem like I'm being to much or clingy or anything like that. He's my roommate and we are close enough that we literally share a room and I've missed his presence this week"

private class UnavailableFakeAiClient : OnDeviceAiClient {
    var capturedPrompts = mutableListOf<String>()
    override suspend fun checkAvailability(): AiAvailabilityState =
        AiAvailabilityState.Unavailable("Test device: AICore unavailable")

    override fun downloadModel(): Flow<AiAvailabilityState> =
        flowOf(AiAvailabilityState.Unavailable("Test device"))

    override suspend fun generate(
        systemInstruction: String,
        prompt: String,
        temperature: Float,
        maxOutputTokens: Int,
    ): AiGenerationResult {
        capturedPrompts += prompt
        return AiGenerationResult.Unavailable("Test unavailable")
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class JournalCompanionRobolectricTest {

    @get:Rule
    val composeRule = createComposeRule()

    private lateinit var context: Context
    private lateinit var dbFile: File
    private lateinit var prefsFile: File
    private var currentDateIso = "2026-11-15"
    private var currentEpochMs = 1_763_234_836_000L

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        val suffix = UUID.randomUUID().toString()
        dbFile = File(context.cacheDir, "test_journal_$suffix.db")
        prefsFile = File(context.cacheDir, "test_prefs_$suffix.preferences_pb")
    }

    @After
    fun tearDown() {
        dbFile.delete()
        prefsFile.delete()
    }

    private fun buildRepository(
        aiClient: OnDeviceAiClient = UnavailableFakeAiClient(),
        inMemory: Boolean = false,
        dsScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    ): Triple<JournalDatabase, JournalRepository, CoroutineScope> {
        val db = if (inMemory) {
            Room.inMemoryDatabaseBuilder(context, JournalDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        } else {
            Room.databaseBuilder(context, JournalDatabase::class.java, dbFile.absolutePath)
                .allowMainThreadQueries()
                .build()
        }
        val dataStore = PreferenceDataStoreFactory.create(scope = dsScope, produceFile = { prefsFile })
        val prefsRepo = AppPreferencesRepository(dataStore)
        val weatherRepo = WeatherRepository(prefsRepo)
        val orchestrator = JournalAiOrchestrator(aiClient)
        val repo = JournalRepository(
            dao = db.journalDao(),
            preferences = prefsRepo,
            weatherRepository = weatherRepo,
            aiOrchestrator = orchestrator,
            todayIsoProvider = { currentDateIso },
            nowEpochMsProvider = { currentEpochMs },
        )
        return Triple(db, repo, dsScope)
    }

    @Test
    fun spencerAcceptanceCase_tomorrowDiffers_paperCompletion_andSurvivesRestart() = runBlocking {
        val (db1, repo1, scope1) = buildRepository()
        val setup = repo1.analyzeBrief(SPENCER_BRIEF)

        // Discreet title & accurate parsing
        assertFalse(setup.title.contains("Spencer", ignoreCase = true))
        assertFalse(setup.title.contains("psych", ignoreCase = true))
        assertFalse(setup.title.contains("hospital", ignoreCase = true))
        assertEquals(JournalCadence.DAILY, setup.cadence)
        assertEquals("3.25\" × 4.5\"", setup.pageSizeLabel)
        assertTrue(setup.themes.any { it.contains("appreciation", ignoreCase = true) })
        assertTrue(setup.themes.any { it.contains("friends", ignoreCase = true) })
        assertTrue(setup.tonePreferences?.contains("low-pressure", ignoreCase = true) == true)

        val projectId = repo1.createProjectFromSetup(SPENCER_BRIEF, setup)
        val project = repo1.projects.first().first { it.id == projectId }

        // Today's prompt stays identical on reopening same day
        val today1 = repo1.ensureTodayEntry(project, weather = null, useCelsius = false, dateIso = "2026-11-15")
        val today1Reopened = repo1.ensureTodayEntry(project, weather = null, useCelsius = false, dateIso = "2026-11-15")
        assertEquals(today1.promptText, today1Reopened.promptText)

        // Mark done for today with ZERO typed response (pure paper mode)
        repo1.setEntryCompleted(today1, true)
        val savedToday = repo1.observeEntryForToday(projectId, "2026-11-15").first()!!
        assertTrue(savedToday.isCompleted)
        assertEquals("", savedToday.draftText)

        // Tomorrow's prompt differs from today's
        currentDateIso = "2026-11-16"
        currentEpochMs += 86_400_000L
        val tomorrow = repo1.ensureTodayEntry(project, weather = null, useCelsius = false, dateIso = "2026-11-16")
        assertNotEquals(today1.promptText, tomorrow.promptText)
        assertNotEquals(today1.promptTopicTag, tomorrow.promptTopicTag)

        // Editing brief preserves existing journal history
        repo1.updateProjectPreservingHistory(project.copy(tonePreferences = "Calm, appreciative"))
        val allEntriesAfterEdit = repo1.observeEntriesForProject(projectId).first()
        assertEquals(2, allEntriesAfterEdit.size)
        assertTrue(allEntriesAfterEdit.any { it.dateIso == "2026-11-15" && it.isCompleted })

        db1.close()
        scope1.coroutineContext[Job]?.cancelAndJoin()

        // Simulate app restart with fresh DB + DataStore instance on same files
        val (db2, repo2, scope2) = buildRepository()
        val resumedId = repo2.uiPreferences.first().lastActiveProjectId
        assertEquals(projectId, resumedId)
        val resumedProjects = repo2.projects.first()
        assertEquals(1, resumedProjects.size)
        assertEquals(2, repo2.observeEntriesForProject(projectId).first().size)
        db2.close()
        scope2.cancel()
    }

    @Test
    fun dailyReflectionAndCreativeLog_leaveUnknownFieldsUnset_andVaryPrompts() = runBlocking {
        val (db, repo, scope) = buildRepository(inMemory = true)

        val dailyBrief = "A daily reflection journal to unwind after work without productivity pressure."
        val dailySetup = repo.analyzeBrief(dailyBrief)
        assertEquals(JournalCadence.DAILY, dailySetup.cadence)
        assertNull(dailySetup.pageSizeLabel) // unknown page size stays null

        val creativeBrief = "Studio project log for my ceramics and glaze experiments whenever I work."
        val creativeSetup = repo.analyzeBrief(creativeBrief)
        assertEquals(JournalCadence.WHENEVER, creativeSetup.cadence)
        assertNull(creativeSetup.pageSizeLabel)
        assertTrue(creativeSetup.themes.any { it.contains("craft", ignoreCase = true) || it.contains("process", ignoreCase = true) })

        db.close()
        scope.cancel()
    }

    @Test
    fun disabledContextSharing_excludesWeatherFromAiPayload_andDetectsStaleWeather() = runBlocking {
        val (db, repo, scope) = buildRepository(inMemory = true)
        val setup = repo.analyzeBrief("Daily reflection")
        val id = repo.createProjectFromSetup("Daily reflection", setup, includeWeatherInPrompt = false)
        val project = repo.projects.first().first { it.id == id }

        val staleSnapshot = WeatherSnapshot(
            cityLabel = "Seattle",
            latitudeRounded = 47.61,
            longitudeRounded = -122.33,
            conditionLabel = "Light rain",
            wmoCode = 61,
            temperatureCelsius = 10.0,
            highCelsius = 12.0,
            lowCelsius = 7.0,
            precipitationChancePercent = 70,
            precipitationPeriodLabel = "this evening (5–9 PM)",
            fetchedAtEpochMs = currentEpochMs - (3 * 60 * 60 * 1000L), // 3 hours old -> stale
        )
        assertTrue(staleSnapshot.isStale(nowEpochMs = currentEpochMs))

        // Weather disabled in prompt -> payload must omit weather
        val disabledPayload = repo.buildPromptContextPayload(project, staleSnapshot, useCelsius = false)
        assertNull(disabledPayload.weatherSummary)
        assertNull(disabledPayload.weatherFetchedTimestamp)

        // Weather enabled in prompt -> payload includes only weather fields & timestamp
        val enabledPayload = repo.buildPromptContextPayload(
            project.copy(includeWeatherInPrompt = true),
            staleSnapshot,
            useCelsius = false,
        )
        assertTrue(enabledPayload.weatherSummary?.contains("Light rain") == true)
        assertTrue(enabledPayload.weatherSummary?.contains("70% precip") == true)
        assertTrue(enabledPayload.weatherFetchedTimestamp != null)

        db.close()
        scope.cancel()
    }

    @Test
    @Config(sdk = [36], qualifiers = "w840dp-h411dp-land")
    fun landscapeDeskMode_hidesCardsFullWidth_dimMode_draftAssistUndo_andManualFlow() {
        val (db, repo, scope) = buildRepository(inMemory = true)
        val vm = MainViewModel(context as Application, repo)

        composeRule.setContent {
            JournalCompanionTheme(isDimDeskMode = true) {
                JournalCompanionApp(viewModel = vm)
            }
        }
        composeRule.waitForIdle()

        // Empty state -> Step 1 of creation wizard (Brief)
        composeRule.onNodeWithTag("empty_create_project_button").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("wizard_step_1_card").assertIsDisplayed()

        composeRule.onNodeWithTag("load_spencer_brief").performScrollTo().performClick()
        composeRule.onNodeWithTag("wizard_next_step_1").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Step 2: Cadence & Audience
        composeRule.onNodeWithTag("wizard_step_2_card").assertIsDisplayed()
        composeRule.onNodeWithTag("wizard_next_step_2").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Step 3: Page Size & Tone -> Propose with AICore
        composeRule.onNodeWithTag("wizard_step_3_card").assertIsDisplayed()
        composeRule.onNodeWithTag("analyze_brief_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("proposed_setup_review_card")).fetchSemanticsNodes().isNotEmpty()
        }

        // Step 4: Review card appears; save project
        composeRule.onNodeWithTag("proposed_setup_review_card").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("save_project_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("today_prompt_text")).fetchSemanticsNodes().isNotEmpty()
        }

        // Landscape Desk Mode shows project title, proactive strip, starter peek, prompt, and right-hand cards
        composeRule.onNodeWithTag("desk_project_title").assertIsDisplayed()
        composeRule.onNodeWithTag("desk_proactive_strip").assertIsDisplayed()
        composeRule.onNodeWithTag("today_prompt_text").assertIsDisplayed()
        composeRule.onNodeWithTag("desk_proactive_spark_peek").assertIsDisplayed()
        composeRule.onNodeWithTag("card_focus_timer").assertIsDisplayed()
        composeRule.onNodeWithTag("card_date_time").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("card_weather").performScrollTo().assertIsDisplayed()

        // By default (Discreet Mode OFF), A2UI Desk Companion surfaces rich project context, starters, pacing & ambient cues
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("a2ui_intent_card")).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("card_a2ui_companion").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("a2ui_intent_card").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("a2ui_starter_card").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("a2ui_ambient_window_card").performScrollTo().assertIsDisplayed()
        composeRule.onAllNodes(hasText("Spencer", substring = true, ignoreCase = true)).let {
            assertTrue(it.fetchSemanticsNodes().isNotEmpty())
        }

        // Toggle Discreet Mode ON via Desk Customize dialog -> hides audience, boundaries, and brief excerpts
        composeRule.onNodeWithTag("desk_cards_customize_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("dialog_toggle_discreet_mode").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Done").performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasText("Spencer", substring = true, ignoreCase = true)).fetchSemanticsNodes().isEmpty()
        }
        composeRule.onAllNodes(hasText("hospital", substring = true, ignoreCase = true)).assertCountEquals(0)

        // Turn Discreet Mode back OFF so user can continue seeing rich context
        composeRule.onNodeWithTag("desk_cards_customize_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("dialog_toggle_discreet_mode").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Done").performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasText("Spencer", substring = true, ignoreCase = true)).fetchSemanticsNodes().isNotEmpty()
        }

        // Test interactive A2UI starter action ("Jot starter" opens draft panel & inserts starter)
        composeRule.onNodeWithTag("a2ui_use_starter_chip").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            vm.uiState.value.draftText.isNotBlank()
        }
        // Clear draft back via Undo so remaining tests operate on clean state
        composeRule.onNodeWithTag("undo_draft_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("toggle_draft_button").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Test A2UI window quiet/dismiss -> restore
        composeRule.onNodeWithTag("a2ui_dismiss_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("card_a2ui_companion_quiet")).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("a2ui_restore_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("a2ui_ambient_window_card")).fetchSemanticsNodes().isNotEmpty()
        }

        // Open inline Weather location editor directly in Desk Mode
        composeRule.onNodeWithTag("desk_weather_location_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("desk_weather_city_input").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Toggle weather card to "Include in today's prompt" vs "Supplementary only"
        composeRule.onAllNodesWithText("Supplementary only").assertCountEquals(2)
        composeRule.onNodeWithTag("toggle_include_weather").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodesWithText("In prompt + desk").fetchSemanticsNodes().size == 1
        }
        composeRule.onAllNodesWithText("In prompt + desk").assertCountEquals(1)
        composeRule.onAllNodesWithText("Supplementary only").assertCountEquals(1)

        // Pomodoro Focus Timer controls: default 15:00 sprint, switch preset, start/pause, reset (no journal tracking)
        composeRule.onNodeWithTag("card_focus_timer").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("focus_timer_countdown").assertTextContains("15:00")
        composeRule.onNodeWithTag("focus_preset_10").performScrollTo().performClick()
        composeRule.onNodeWithTag("focus_timer_countdown").assertTextContains("10:00")
        composeRule.onNodeWithTag("focus_timer_toggle_button").performScrollTo().performClick()
        composeRule.onNodeWithTag("focus_timer_toggle_button").assertTextContains("Pause")
        composeRule.onNodeWithTag("focus_timer_toggle_button").performClick()
        composeRule.onNodeWithTag("focus_timer_toggle_button").assertTextContains("Start")
        composeRule.onNodeWithTag("focus_timer_reset_button").performClick()
        composeRule.onNodeWithTag("focus_timer_countdown").assertTextContains("10:00")

        // Hide cards -> prompt expands full width (cards gone) and compact timer control remains accessible
        composeRule.onNodeWithTag("desk_cards_visibility_toggle").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("card_date_time").assertDoesNotExist()
        composeRule.onNodeWithTag("card_focus_timer").assertDoesNotExist()
        composeRule.onNodeWithTag("desk_compact_timer_chip").assertIsDisplayed()
        composeRule.onNodeWithTag("today_prompt_text").assertIsDisplayed()

        // Hint button works
        composeRule.onNodeWithTag("give_hint_button").performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("hints_box")).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("hints_box").performScrollTo().assertIsDisplayed()

        // Optional draft + Help me start -> editable suggestion -> accept -> undo
        composeRule.onNodeWithTag("toggle_draft_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("help_me_start_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("editable_suggestion_card")).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("editable_suggestion_card").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("accept_replace_suggestion_button").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Undo restores empty draft
        composeRule.onNodeWithTag("undo_draft_button").performScrollTo().assertIsDisplayed().performClick()
        composeRule.waitForIdle()

        // Complete on paper with no typed draft
        composeRule.onNodeWithTag("done_today_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodesWithText("Completed today").fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithText("Completed today").performScrollTo().assertIsDisplayed()

        // Toggle Light/Dark mode and Dim mode icons in Desk Header
        composeRule.onNodeWithTag("desk_theme_toggle").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("desk_dim_toggle").performScrollTo().performClick()
        composeRule.waitForIdle()

        db.close()
        scope.cancel()
    }

    @Test
    @Config(sdk = [36], qualifiers = "w840dp-h411dp-land")
    fun creationWizard_skipAiManualSetup_preservesUserInputs_andDisplaysStaleWeatherBadge() {
        val (db, repo, scope) = buildRepository(inMemory = true)
        val dataStore = PreferenceDataStoreFactory.create(scope = scope, produceFile = {
            File(context.cacheDir, "test_prefs_stale_${UUID.randomUUID()}.preferences_pb")
        })
        val prefsRepo = AppPreferencesRepository(dataStore)
        val staleWeather = WeatherSnapshot(
            cityLabel = "Portland",
            latitudeRounded = 45.52,
            longitudeRounded = -122.68,
            conditionLabel = "Overcast",
            wmoCode = 3,
            temperatureCelsius = 11.0,
            highCelsius = 14.0,
            lowCelsius = 8.0,
            precipitationChancePercent = 40,
            precipitationPeriodLabel = "this afternoon (12–5 PM)",
            fetchedAtEpochMs = System.currentTimeMillis() - (4 * 60 * 60 * 1000L), // 4h old -> stale
        )
        runBlocking { prefsRepo.saveCachedWeather(staleWeather) }
        val staleRepo = JournalRepository(
            dao = db.journalDao(),
            preferences = prefsRepo,
            weatherRepository = WeatherRepository(prefsRepo),
            aiOrchestrator = JournalAiOrchestrator(UnavailableFakeAiClient()),
        )
        val vm = MainViewModel(context as Application, staleRepo)

        composeRule.setContent {
            JournalCompanionTheme {
                JournalCompanionApp(viewModel = vm)
            }
        }
        composeRule.waitForIdle()

        // Launch wizard -> enter brief -> Step 2 (Weekly + Myself) -> Step 3 (A6 + Calm) -> Skip AI
        composeRule.onNodeWithTag("empty_create_project_button").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("project_brief_input").performTextInput("Weekly field notes for myself")
        composeRule.onNodeWithTag("wizard_next_step_1").performScrollTo().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("wizard_cadence_weekly").performScrollTo().performClick()
        composeRule.onNodeWithTag("wizard_audience_input").performScrollTo().performTextInput("Myself")
        composeRule.onNodeWithTag("wizard_next_step_2").performScrollTo().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("wizard_pagesize_input").performScrollTo().performTextInput("A6")
        composeRule.onNodeWithTag("wizard_tone_input").performScrollTo().performTextInput("Calm and curious")
        composeRule.onNodeWithTag("wizard_step3_skip_ai").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Review step preserves manual inputs; fill title & goal manually and save
        composeRule.onNodeWithTag("proposed_setup_review_card").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("setup_title_input").performScrollTo().performTextInput("Field Notes")
        composeRule.onNodeWithTag("setup_goal_input").performScrollTo().performTextInput("Observe one pattern each week.")
        composeRule.onNodeWithTag("save_project_button").performScrollTo().performClick()
        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodesWithTag("today_prompt_text").fetchSemanticsNodes().isNotEmpty()
        }

        // Desk Mode displays saved project and cached stale weather badge
        composeRule.onNodeWithText("Field Notes").assertIsDisplayed()
        composeRule.onNodeWithTag("weather_stale_badge").performScrollTo().assertIsDisplayed()

        db.close()
        scope.cancel()
    }

    @Test
    fun roomMigration1To2_preservesExistingProjectsAndDefaultsNewDeskCardFlags() = runBlocking {
        // Seed a v1 SQLite schema database before Room v2 opens it
        val openHelper = FrameworkSQLiteOpenHelperFactory().create(
            SupportSQLiteOpenHelper.Configuration.builder(context)
                .name(dbFile.absolutePath)
                .callback(object : SupportSQLiteOpenHelper.Callback(1) {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        db.execSQL(
                            """
                            CREATE TABLE IF NOT EXISTS `journal_projects` (
                                `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                                `title` TEXT NOT NULL,
                                `writingGoal` TEXT NOT NULL,
                                `originalBrief` TEXT NOT NULL,
                                `audience` TEXT,
                                `cadenceName` TEXT,
                                `pageSizeLabel` TEXT,
                                `entryLengthLabel` TEXT,
                                `linesPerPage` INTEGER NOT NULL,
                                `wordsPerLine` INTEGER NOT NULL,
                                `themes` TEXT NOT NULL,
                                `tonePreferences` TEXT,
                                `boundaries` TEXT,
                                `includePastAnswersInPrompts` INTEGER NOT NULL,
                                `showDateTimeCard` INTEGER NOT NULL,
                                `showWeatherCard` INTEGER NOT NULL,
                                `includeDateTimeInPrompt` INTEGER NOT NULL,
                                `includeWeatherInPrompt` INTEGER NOT NULL,
                                `createdAtEpochMs` INTEGER NOT NULL,
                                `updatedAtEpochMs` INTEGER NOT NULL
                            )
                            """.trimIndent(),
                        )
                        db.execSQL(
                            """
                            CREATE TABLE IF NOT EXISTS `journal_entries` (
                                `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                                `projectId` INTEGER NOT NULL,
                                `dateIso` TEXT NOT NULL,
                                `promptText` TEXT NOT NULL,
                                `promptTopicTag` TEXT NOT NULL,
                                `hints` TEXT NOT NULL,
                                `draftText` TEXT NOT NULL,
                                `isCompleted` INTEGER NOT NULL,
                                `completedAtEpochMs` INTEGER,
                                `updatedAtEpochMs` INTEGER NOT NULL,
                                FOREIGN KEY(`projectId`) REFERENCES `journal_projects`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                            )
                            """.trimIndent(),
                        )
                        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_journal_entries_projectId_dateIso` ON `journal_entries` (`projectId`, `dateIso`)")
                        db.execSQL("CREATE INDEX IF NOT EXISTS `index_journal_entries_projectId` ON `journal_entries` (`projectId`)")
                        db.execSQL(
                            """
                            CREATE TABLE IF NOT EXISTS `prompt_history` (
                                `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                                `projectId` INTEGER NOT NULL,
                                `dateIso` TEXT NOT NULL,
                                `promptText` TEXT NOT NULL,
                                `topicTag` TEXT NOT NULL,
                                `createdAtEpochMs` INTEGER NOT NULL,
                                FOREIGN KEY(`projectId`) REFERENCES `journal_projects`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE
                            )
                            """.trimIndent(),
                        )
                        db.execSQL("CREATE INDEX IF NOT EXISTS `index_prompt_history_projectId` ON `prompt_history` (`projectId`)")
                        db.execSQL(
                            """
                            INSERT INTO journal_projects (
                                id, title, writingGoal, originalBrief, cadenceName,
                                linesPerPage, wordsPerLine, themes,
                                includePastAnswersInPrompts, showDateTimeCard, showWeatherCard,
                                includeDateTimeInPrompt, includeWeatherInPrompt,
                                createdAtEpochMs, updatedAtEpochMs
                            ) VALUES (
                                1, 'Daily Pages', 'Reflect cleanly.', 'Daily unwinding notebook', 'DAILY',
                                18, 7, '["Evening reflection"]',
                                0, 1, 1, 0, 0, 1000, 1000
                            )
                            """.trimIndent(),
                        )
                    }

                    override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
                })
                .build(),
        )
        openHelper.writableDatabase.close()

        val migratedDb = Room.databaseBuilder(context, JournalDatabase::class.java, dbFile.absolutePath)
            .addMigrations(JournalDatabase.MIGRATION_1_2)
            .allowMainThreadQueries()
            .build()

        val projects = migratedDb.journalDao().observeProjects().first()
        assertEquals(1, projects.size)
        assertEquals("Daily Pages", projects.first().title)
        assertTrue(projects.first().showSparksCard)
        assertTrue(projects.first().showRhythmCard)
        assertTrue(projects.first().showTimerCard)

        migratedDb.close()
    }

    @Test
    @Config(sdk = [36], qualifiers = "w840dp-h411dp-land")
    fun lightAndDarkThemeMode_switchesAndPersistsAcrossSettingsAndDeskMode() {
        val (db, repo, scope) = buildRepository(inMemory = true)
        runBlocking {
            val setup = repo.analyzeBrief("Quiet daily reflection log")
            repo.createProjectFromSetup("Quiet daily reflection log", setup)
        }
        val vm = MainViewModel(context as Application, repo)

        composeRule.setContent {
            val state = vm.uiState.collectAsStateWithLifecycle().value
            JournalCompanionTheme(
                themeMode = state.preferences.themeMode,
                isDimDeskMode = state.preferences.dimDeskModeEnabled,
            ) {
                JournalCompanionApp(viewModel = vm)
            }
        }
        composeRule.waitForIdle()

        // Switch to Settings -> verify System, Warm Light, and Soft Dark options persist
        composeRule.onNodeWithTag("nav_settings").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("setting_theme_dark").performScrollTo().performClick()
        composeRule.waitForIdle()
        val deadline = System.currentTimeMillis() + 5000L
        while (System.currentTimeMillis() < deadline && vm.uiState.value.preferences.themeMode != AppThemeMode.DARK) {
            Thread.sleep(50)
            composeRule.waitForIdle()
        }
        val repoThemeAfterDark = runBlocking { repo.uiPreferences.first().themeMode }
        assertEquals(
            "Expected DARK after clicking setting_theme_dark (repo=$repoThemeAfterDark, vm=${vm.uiState.value.preferences.themeMode})",
            AppThemeMode.DARK,
            vm.uiState.value.preferences.themeMode,
        )
        composeRule.onNodeWithTag("setting_theme_dark").assertIsSelected()

        composeRule.onNodeWithTag("setting_theme_light").performScrollTo().performClick()
        composeRule.waitForIdle()
        val deadline2 = System.currentTimeMillis() + 5000L
        while (System.currentTimeMillis() < deadline2 && vm.uiState.value.preferences.themeMode != AppThemeMode.LIGHT) {
            Thread.sleep(50)
            composeRule.waitForIdle()
        }
        assertEquals(AppThemeMode.LIGHT, vm.uiState.value.preferences.themeMode)
        composeRule.onNodeWithTag("setting_theme_light").assertIsSelected()
        assertEquals(AppThemeMode.LIGHT, runBlocking { repo.uiPreferences.first().themeMode })

        // Return to Today Desk Mode and flip Light -> Dark via header quick toggle
        composeRule.onNodeWithTag("nav_today").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("desk_theme_toggle").performClick()
        composeRule.waitForIdle()
        val deadline3 = System.currentTimeMillis() + 5000L
        while (System.currentTimeMillis() < deadline3 && vm.uiState.value.preferences.themeMode != AppThemeMode.DARK) {
            Thread.sleep(50)
            composeRule.waitForIdle()
        }
        assertEquals(AppThemeMode.DARK, vm.uiState.value.preferences.themeMode)
        assertEquals(AppThemeMode.DARK, runBlocking { repo.uiPreferences.first().themeMode })

        db.close()
        scope.cancel()
    }

    @Test
    @Config(sdk = [36], qualifiers = "w840dp-h411dp-land")
    fun dreamScreenSaver_rendersFullA2uiAndClockOnlyModes() {
        val parser = A2uiMessageParser()
        val processor = A2uiMessageProcessor(catalogs = DeskA2uiCatalog.allCatalogs())
        val outbound = mutableListOf<A2uiClientToServerMessage>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val collectorJob = scope.launch { processor.collectMessages() }
        val outboundJob = scope.launch { processor.outboundEvents.collect { outbound += it } }

        val project = JournalProject(
            id = 42L,
            title = "Quiet Friend Notes",
            writingGoal = "Share steady appreciation without overwhelming.",
            originalBrief = SPENCER_BRIEF,
            audience = "Spencer",
            cadence = JournalCadence.DAILY,
            pageSizeLabel = "3.25\" × 4.5\"",
            linesPerPage = 16,
            wordsPerLine = 6,
            themes = listOf("Appreciation", "Everyday moments", "Shared friendships"),
            tonePreferences = "Warm, low-pressure",
            boundaries = "Keep entries grounded and unhurried.",
        )
        val snapshot = DeskContextBuilder.buildSnapshot(
            project = project,
            todayEntry = null,
            entries = emptyList(),
            history = emptyList(),
            draftWordCount = 0,
            weather = WeatherSnapshot(
                cityLabel = "Portland",
                latitudeRounded = 45.52,
                longitudeRounded = -122.68,
                conditionLabel = "Clear sky",
                wmoCode = 0,
                temperatureCelsius = 16.0,
                highCelsius = 18.0,
                lowCelsius = 9.0,
                precipitationChancePercent = 5,
                precipitationPeriodLabel = null,
                fetchedAtEpochMs = currentEpochMs,
            ),
            useCelsius = false,
            nowMs = currentEpochMs,
            discreetMode = false,
        )

        val engine = DeskA2uiAgentEngine()
        val messages = engine.buildDeterministicMessages(
            snapshot = snapshot,
            surfaceId = JournalDreamService.DREAM_SURFACE_ID,
            interactiveMode = false,
        )
        messages.forEach { processor.processInput(parser, it) }

        var useClockOnly = false
        var openedDeskCount = 0

        composeRule.setContent {
            val surfaces by processor.activeSurfaces.collectAsStateWithLifecycle()
            JournalCompanionTheme(isDimDeskMode = true) {
                DreamScreenSaverContent(
                    state = DreamAmbientUiState(
                        preferences = DeskUiPreferences(
                            screenSaverMode = if (useClockOnly) ScreenSaverMode.CLOCK_AND_WEATHER_ONLY else ScreenSaverMode.FULL_A2UI,
                            discreetDeskModeEnabled = false,
                        ),
                        activeProject = project,
                        weather = WeatherSnapshot(
                            cityLabel = "Portland",
                            latitudeRounded = 45.52,
                            longitudeRounded = -122.68,
                            conditionLabel = "Clear sky",
                            wmoCode = 0,
                            temperatureCelsius = 16.0,
                            highCelsius = 18.0,
                            lowCelsius = 9.0,
                            precipitationChancePercent = 5,
                            precipitationPeriodLabel = null,
                            fetchedAtEpochMs = currentEpochMs,
                        ),
                        formattedTime = "8:42 PM",
                        formattedDate = "Sunday, Nov 15",
                        daylightSummary = snapshot.daylightSummary,
                        contextSnapshot = snapshot,
                    ),
                    a2uiSurfaces = surfaces,
                    driftStep = 2,
                    onWakeAndOpenDesk = { openedDeskCount++ },
                    onDismissDream = {},
                )
            }
        }

        composeRule.waitUntil(timeoutMillis = 5000) {
            composeRule.onAllNodes(hasTestTag("dream_a2ui_surface")).fetchSemanticsNodes().isNotEmpty()
        }
        composeRule.onNodeWithTag("dream_clock_text").assertTextContains("8:42 PM")
        composeRule.onNodeWithTag("dream_project_title").assertTextContains("Quiet Friend Notes")
        composeRule.onNodeWithTag("dream_a2ui_surface").assertIsDisplayed()
        composeRule.onNodeWithText("For: Spencer", substring = true).assertIsDisplayed()
        composeRule.onNodeWithTag("dream_open_desk_button").performClick()
        assertEquals(1, openedDeskCount)

        // Verify no A2UI validation errors occurred
        val nonActionErrors = outbound.filterNot { it is A2uiUserAction }
        assertTrue("Expected zero A2UI validation errors, got: $nonActionErrors", nonActionErrors.isEmpty())

        collectorJob.cancel()
        outboundJob.cancel()
        scope.cancel()
    }
}

# Journal Companion

> **Now cross-platform:** an installable PWA for iOS, Android, desktop and ChromeOS lives in [`web/`](web/README.md). It ports the same local-first data model, prompt engine, weather, focus timer and Desk Mode, using on-device browser AI where available.

A local-first Android journaling assistant built for **Pixel 10** and Android 8.0+ (`minSdk = 26`, `targetSdk = 36`) using **Kotlin, Jetpack Compose, Material 3, Room, DataStore, and Coroutines**.

Designed as a calm, hands-free **desk companion** beside a physical notebook—with optional digital notes, discreet privacy defaults, on-device **Android AICore (ML Kit GenAI Prompt API)** guidance, and cached **Open-Meteo** weather.

---

## Core Architecture & Privacy

- **100% Local-First Persistence**:
  - `Room` (`journal_companion_local.db`, schema v2 with `MIGRATION_1_2`) stores projects, original briefs, daily entries, per-project prompt history, and per-project Desk Mode card visibility flags.
  - `DataStore Preferences` (`journal_companion_settings`) stores the last active project ID, Desk Mode settings (keep screen awake, `System` / `Warm Light` / `Soft Dark` theme mode, extra-dim evening mode, Recents preview protection), temperature units, cached weather snapshots, and today's completed focus-block count (no journal text).
- **Eye-Comfort Themes**:
  - Soft, glare-free **Warm Light** (matte oat paper cards without harsh white `#FFFFFF` glare), **Soft Dark** (warm charcoal slate eliminating bright-white OLED halation), **System** follow, plus **Extra-dim evening mode**, gentler card borders, relaxed reading line heights, and synced status/navigation bar contrast.
- **Backup & Device Transfer Exclusion**:
  - `android:allowBackup="false"` in `AndroidManifest.xml`, plus explicit exclusions in `res/xml/backup_rules.xml` and `res/xml/data_extraction_rules.xml` for `database`, `sharedpref`, and `file` domains.
- **Discreet & Stream-Safe by Default**:
  - Briefs, recipient details, and personal boundaries are never displayed in Landscape Desk Mode, notifications, or recent-app previews (`Activity.setRecentsScreenshotEnabled(false)` on Android 13+, protecting Recents switcher thumbnails without blanking live Desk Mode rendering or streaming virtual displays).
  - Zero analytics, zero cloud AI, and zero logging of journal text.
- **On-Device AI (Android AICore)**:
  - Uses Google's official ML Kit GenAI Prompt API (`com.google.mlkit:genai-prompt:1.0.0-beta4`) via `Generation.getClient()`, checking runtime availability (`FeatureStatus.AVAILABLE`, `DOWNLOADABLE`, `DOWNLOADING`, `UNAVAILABLE`) asynchronously with a bounded timeout so startup never stalls.
  - Validates structured JSON responses (`StructuredOutputValidator`) before applying any setup or prompt, and falls back seamlessly to a complete built-in template and prompt engine (`FallbackPromptEngine`).

---

## Weather Provider & Attribution

- **Provider**: [Open-Meteo](https://open-meteo.com/) Forecast & Geocoding APIs (no API key required, free for non-commercial use).
- **License & Attribution**: Data licensed under **CC BY 4.0** (`https://creativecommons.org/licenses/by/4.0/`). Visible clickable attribution (`Weather data by Open-Meteo.com`) appears inside both the Weather card and Settings.
- **Privacy Guarantee**: Only the manual city search string or 2-decimal-rounded approximate foreground coordinates (`ACCESS_COARSE_LOCATION`, requested strictly on demand) are sent to Open-Meteo. Journal briefs, project titles, recipients, and entries are never sent to the weather provider.
- **Offline & Stale Caching**: Last fetched weather (conditions, high/low, feels-like, wind speed, precipitation window, and sunrise/sunset daylight balance) is cached locally in DataStore and refreshes quietly when stale (>2 hours) or on demand. Stale entries display a clear indicator (`Stale data (cached ... ago)`), and journaling remains 100% functional offline.

## Proactive Desk Mode & Pomodoro Focus Timer

- **Minimal Left Desk Column**: Surfaces Today's prompt, a quiet **Proactive Glance Strip** (Session #, current topic angle, safe continuity cue, next untapped theme), and a 1-line **Starter** peek immediately without asking—expanding to full width when side cards are hidden, with a compact **Focus** toggle chip staying reachable in the control bar.
- **Right Desk Card Stack**:
  - **Focus Timer (`FocusTimerCard`)**: Preset `10m` / `15m` / `25m` focus sprints and `5m break`, tabular countdown, Start/Pause/Reset, haptic cues, and today's completed block counter—never tracking or timing actual journal words/content.
  - **Time & Daylight (`DateTimeInfoCard`)**: Current time/date, writing window cue, calendar week/month rhythm, and sunrise/sunset daylight status.
  - **Weather (`WeatherInfoCard`)**: Inline manual city search, on-demand coarse location, feels-like, wind speed, precipitation chance, and prompt-context opt-in switch.
  - **Ready Sparks (`ProactiveSparksCard`)**: Immediately visible sentence starter, recall cue, and non-invasive session continuity.
  - **Notebook Rhythm (`NotebookRhythmCard`)**: Cadence status, adjustable handwriting page word-count estimate, and live covered vs. next theme chips.

---

## Project Structure

- `app/src/main/java/com/example/model/JournalModels.kt` — Domain models & extensible `DeskCardSlot` card architecture
- `app/src/main/java/com/example/data/local/` — Room entities, DAO, converters, and `JournalDatabase`
- `app/src/main/java/com/example/data/preferences/` — `AppPreferencesRepository` (DataStore)
- `app/src/main/java/com/example/data/repository/` — `JournalRepository`
- `app/src/main/java/com/example/ai/` — `MlKitPromptAiClient`, `StructuredOutputValidator`, `FallbackPromptEngine`, `JournalAiOrchestrator`
- `app/src/main/java/com/example/weather/` — `OpenMeteoClient`, `WeatherRepository`, `LocationHelper`
- `app/src/main/java/com/example/ui/` — `MainViewModel`, `JournalCompanionApp`, themes, components (`DeskInfoCards`, `DigitalDraftDrawer`), and screens (`TodayDeskScreen`, `ProjectsScreen`, `ProjectWizardScreen`, `ProjectEditorScreen`, `HistoryScreen`, `SettingsScreen`)

---

## Setup & Build Instructions

### Prerequisites
- Android Studio (Meerkat / Narwhal or newer) with JDK 17+ and Android SDK 36 installed (or command-line Gradle).
- No API keys or `google-services.json` are required.

### Build Debug APK
```bash
gradle :app:assembleDebug
```
The debug APK is generated at:
`app/build/outputs/apk/debug/app-debug.apk`

### Run Automated Verification (JVM + Robolectric)
```bash
gradle :app:testDebugUnitTest
```

---

## Verification Summary

### Verified Automatically in Robolectric / JVM Suite (`JournalCompanionRobolectricTest`)
- **Spencer Mini-Journal Acceptance Case**: Brief parsing produces a discreet title (`Mini Pocket Pages`), `3.25" × 4.5"` size, `Daily` cadence, appreciation/friendship/his-friends themes, warm low-pressure tone, and appropriate boundaries.
- **Daily Prompt Stability & Next-Day Variation**: Reopening on the same day keeps the exact same prompt; advancing to the next day generates a new topic and wording.
- **Paper Mode Completion & Restart Persistence**: Completing a page with zero typed text persists date, prompt, and completion status across Room DB + DataStore restart, and resumes the last active project.
- **General Daily Reflection & Creative Project Log**: Leaves unmentioned fields (e.g., physical page size) unset and tailors prompts to each brief.
- **Brief Editing**: Updating a project's brief/settings preserves all existing `JournalEntry` history.
- **Stale Weather & Opt-In Context Privacy**: Weather >2 hours old is flagged stale; weather context is omitted from AI prompts unless `"Include in today's prompt"` is explicitly toggled on.
- **Landscape Desk Mode, Focus Timer & Creation Wizard**: Verified the 4-step creation wizard (AICore proposal and `"Skip AI & set up manually"`), proactive Desk Mode strip, starter peek, `FocusTimerCard` (`10m`/`15m`/`25m`/Start/Pause/Reset + compact timer chip when cards are hidden), `ProactiveSparksCard`, `NotebookRhythmCard`, inline weather location & supplementary/prompt card controls, stale weather cache labeling, discreet redaction checks, dim mode toggle, editable AI draft suggestions, and Undo.
- **Room `MIGRATION_1_2`**: Verified clean migration from v1 to v2 preserving existing projects while enabling the new Desk Mode cards by default.

### Requires Physical Pixel 10 Verification
1. **AICore / Gemini Nano Hardware Inference**:
   - Install `app-debug.apk` on a Pixel 10 (`adb install -r app/build/outputs/apk/debug/app-debug.apk`).
   - Open **Settings → On-Device AI (Android AICore)** and verify status (`Available` or `Downloadable` -> tap **Download Gemini Nano**).
   - Paste the Spencer brief in **Projects → New Project** and tap **Propose setup with AICore**; confirm Gemini Nano proposes the setup on-device with Airplane Mode turned on (after model download).
2. **Physical Screen-Awake & Rotation Ergonomics**:
   - Prop the Pixel 10 horizontally on a desk with **Today** open and **Keep screen awake in Desk Mode** enabled; verify the display stays awake past the system screen-timeout, and resumes normal timeout after navigating away or pressing Home.
   - Toggle **Dim evening mode** in a dark room to confirm comfortable low-glare legibility.
3. **Recent-App Preview Protection**:
   - Open the Android Recents switcher while **Protect recent-app previews** is enabled; confirm the Recents thumbnail is redacted (`setRecentsScreenshotEnabled(false)` on Android 13+) while the live Desk Mode UI stays visible.
4. **On-Demand Approximate Location**:
   - In **Settings → Weather Card** or directly from the Desk **Weather** card, tap **Use approximate location**, grant coarse location when prompted, and verify Open-Meteo fetches conditions, high/low, precipitation period, daylight sunrise/sunset, and timestamp.

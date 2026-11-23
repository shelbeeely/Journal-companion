package com.example.a2ui

import com.example.model.DeskContextSnapshot
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.model.PromptHistoryItem
import com.example.model.WeatherSnapshot
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.WeekFields
import java.util.Locale
import kotlin.math.roundToInt

object DeskContextBuilder {

    fun buildSnapshot(
        project: JournalProject,
        todayEntry: JournalEntry?,
        entries: List<JournalEntry>,
        history: List<PromptHistoryItem>,
        draftWordCount: Int,
        weather: WeatherSnapshot?,
        useCelsius: Boolean,
        nowMs: Long,
        discreetMode: Boolean,
        today: LocalDate = LocalDate.now(),
        nowTime: LocalTime = LocalTime.now(),
    ): DeskContextSnapshot {
        val dayPart = when (nowTime.hour) {
            in 5..11 -> "Morning"
            in 12..16 -> "Afternoon"
            in 17..20 -> "Evening"
            else -> "Night"
        }
        val writingWindowCue = when (nowTime.hour) {
            in 5..9 -> "Morning clarity window"
            in 10..11 -> "Mid-morning desk session"
            in 12..16 -> "Midday pause"
            in 17..20 -> "Evening wind-down"
            in 21..23 -> "Quiet night desk"
            else -> "Late stillness"
        }
        val weekNum = today.get(WeekFields.of(Locale.getDefault()).weekOfWeekBasedYear())
        val daysLeftInMonth = (today.lengthOfMonth() - today.dayOfMonth).coerceAtLeast(0)
        val monthShort = today.format(DateTimeFormatter.ofPattern("MMM"))
        val calendarRhythmLabel = "Week $weekNum · $daysLeftInMonth days left in $monthShort"
        val daylightSummary = buildDaylightSummary(weather, today, nowTime)

        val hints = todayEntry?.hints.orEmpty()
        val rawStarter = hints.firstOrNull { it.startsWith("Sentence starter:", ignoreCase = true) }
            ?: hints.firstOrNull()
        val cleanStarter = rawStarter
            ?.removePrefix("Sentence starter:")
            ?.trim()
        val recallQuestion = hints.firstOrNull {
            it != rawStarter && (it.startsWith("Smaller question:", ignoreCase = true) || it.startsWith("Recall cue:", ignoreCase = true))
        }?.removePrefix("Smaller question:")?.removePrefix("Recall cue:")?.trim()
            ?: hints.firstOrNull { it != rawStarter }

        val priorEntries = entries.filter { it.dateIso != todayEntry?.dateIso }
        val lastPrior = priorEntries.maxByOrNull { it.dateIso }
        val relDay = lastPrior?.let { formatRelativeDay(it.dateIso, today) }

        val canSurfaceDraftExcerpt = !discreetMode &&
            lastPrior != null &&
            lastPrior.draftText.isNotBlank() &&
            (project.includePastAnswersInPrompts || !discreetMode)
        val excerpt = if (canSurfaceDraftExcerpt) {
            val clean = lastPrior!!.draftText.trim().replace(Regex("\\s+"), " ")
            if (clean.length > 130) "${clean.take(127)}…" else clean
        } else {
            null
        }

        val sessionNumber = entries.size.coerceAtLeast(1)
        val completedCount = entries.count { it.isCompleted }
        val historyKeywords = (history.map { "${it.topicTag} ${it.promptText}" } + listOfNotNull(todayEntry?.promptTopicTag, todayEntry?.promptText))
            .joinToString(" ")
            .lowercase()

        val coveredThemes = mutableListOf<String>()
        val untappedThemes = mutableListOf<String>()
        project.themes.forEach { theme ->
            val tokens = theme.lowercase().split(Regex("[\\s&,/]+")).filter { it.length >= 4 }
            val matched = tokens.any { token -> historyKeywords.contains(token.take(5)) } ||
                historyKeywords.contains(theme.lowercase())
            if (matched) coveredThemes += theme else untappedThemes += theme
        }

        val weatherSummary = weather?.let { w ->
            val unit = if (useCelsius) "°C" else "°F"
            fun fmt(c: Double) = if (useCelsius) c.roundToInt() else ((c * 9.0 / 5.0) + 32.0).roundToInt()
            val precip = w.precipitationChancePercent?.let { " · $it% precip" }.orEmpty()
            "${w.cityLabel}: ${w.conditionLabel}, ${fmt(w.temperatureCelsius)}$unit (H ${fmt(w.highCelsius)} / L ${fmt(w.lowCelsius)}$unit)$precip"
        }

        return DeskContextSnapshot(
            projectId = project.id,
            projectTitle = project.title,
            writingGoal = project.writingGoal,
            originalBrief = project.originalBrief,
            audience = project.audience,
            cadenceLabel = project.cadence?.displayName,
            tonePreferences = project.tonePreferences,
            boundaries = project.boundaries,
            promptText = todayEntry?.promptText.orEmpty(),
            promptTopicLabel = formatTopicLabel(todayEntry?.promptTopicTag),
            activeStarter = cleanStarter,
            recallQuestion = recallQuestion,
            coveredThemes = coveredThemes,
            untappedThemes = untappedThemes,
            sessionNumber = sessionNumber,
            completedPagesCount = completedCount,
            todayCompleted = todayEntry?.isCompleted == true,
            pageSizeLabel = project.pageSizeLabel,
            estimatedWordsPerPage = project.estimatedWordsPerPage,
            linesPerPage = project.linesPerPage,
            wordsPerLine = project.wordsPerLine,
            draftWordCount = draftWordCount,
            recentNoteExcerpt = excerpt,
            recentNoteDayLabel = relDay,
            includePastAnswersInPrompts = project.includePastAnswersInPrompts,
            dayPartLabel = dayPart,
            writingWindowCue = writingWindowCue,
            calendarRhythmLabel = calendarRhythmLabel,
            formattedDate = today.format(DateTimeFormatter.ofPattern("EEEE, MMM d")),
            formattedTime = nowTime.format(DateTimeFormatter.ofPattern("h:mm a")),
            daylightSummary = daylightSummary,
            weatherSummary = weatherSummary,
            isWeatherStale = weather?.isStale(nowEpochMs = nowMs) ?: false,
            discreetMode = discreetMode,
        )
    }

    fun buildDaylightSummary(
        weather: WeatherSnapshot?,
        today: LocalDate,
        nowTime: LocalTime,
    ): String? {
        val sunriseStr = weather?.sunriseIso ?: return null
        val sunsetStr = weather.sunsetIso ?: return null
        return runCatching {
            val sunrise = LocalDateTime.parse(sunriseStr).toLocalTime()
            val sunset = LocalDateTime.parse(sunsetStr).toLocalTime()
            val fmt = DateTimeFormatter.ofPattern("h:mm a")
            val nowDt = LocalDateTime.of(today, nowTime)
            val sunriseDt = LocalDateTime.of(today, sunrise)
            val sunsetDt = LocalDateTime.of(today, sunset)

            when {
                nowDt.isBefore(sunriseDt) ->
                    "Before sunrise (${sunrise.format(fmt)}) · Sunset ${sunset.format(fmt)}"
                nowDt.isBefore(sunsetDt) -> {
                    val minsLeft = Duration.between(nowDt, sunsetDt).toMinutes().coerceAtLeast(1)
                    val hrs = minsLeft / 60
                    val rem = minsLeft % 60
                    val remaining = if (hrs > 0) "${hrs}h ${rem}m" else "${rem}m"
                    "$remaining daylight left · Sunset ${sunset.format(fmt)}"
                }
                else -> "Past sunset (${sunset.format(fmt)}) · Quiet evening"
            }
        }.getOrNull()
    }

    fun formatRelativeDay(dateIso: String, today: LocalDate): String {
        return runCatching {
            val prevDate = LocalDate.parse(dateIso)
            val days = ChronoUnit.DAYS.between(prevDate, today)
            when (days) {
                1L -> "Yesterday"
                0L -> "Earlier today"
                in 2L..6L -> "$days days ago"
                else -> prevDate.format(DateTimeFormatter.ofPattern("MMM d"))
            }
        }.getOrDefault(dateIso)
    }

    fun formatTopicLabel(rawTag: String?): String {
        val clean = rawTag?.trim()?.takeIf { it.isNotBlank() } ?: return "Opening prompt"
        return clean.replace('_', ' ')
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.getDefault()) else it.toString() }
    }
}

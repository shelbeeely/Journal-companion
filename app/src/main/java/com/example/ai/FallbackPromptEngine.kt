package com.example.ai

import com.example.model.JournalCadence
import com.example.model.JournalProject
import com.example.model.PromptContextPayload
import com.example.model.ProposedProjectSetup
import com.example.model.WizardSeedInputs

/**
 * Complete offline / fallback engine used when AICore is unavailable, downloading,
 * reaches quota, or when the user prefers manual/template-based setup.
 */
object FallbackPromptEngine {

    private data class PromptCandidate(
        val topicTag: String,
        val question: String,
        val hints: List<String>,
    )

    fun proposeSetupFromBrief(
        brief: String,
        statusNote: String? = null,
        wizardInputs: WizardSeedInputs? = null,
    ): ProposedProjectSetup {
        val base = proposeSetupFromBriefCore(brief, statusNote)
        if (wizardInputs == null) return base

        val mergedPageSize = wizardInputs.pageSizeLabel?.trim()?.takeIf { it.isNotBlank() } ?: base.pageSizeLabel
        val (defaultLines, defaultWords) = StructuredOutputValidator.estimatePageGrid(mergedPageSize)
        return base.copy(
            cadence = wizardInputs.cadence ?: base.cadence,
            audience = wizardInputs.audience?.trim()?.takeIf { it.isNotBlank() } ?: base.audience,
            pageSizeLabel = mergedPageSize,
            linesPerPage = wizardInputs.linesPerPage ?: if (mergedPageSize != base.pageSizeLabel) defaultLines else base.linesPerPage,
            wordsPerLine = wizardInputs.wordsPerLine ?: if (mergedPageSize != base.pageSizeLabel) defaultWords else base.wordsPerLine,
            tonePreferences = wizardInputs.tonePreferences?.trim()?.takeIf { it.isNotBlank() } ?: base.tonePreferences,
            boundaries = wizardInputs.boundaries?.trim()?.takeIf { it.isNotBlank() } ?: base.boundaries,
        )
    }

    private fun proposeSetupFromBriefCore(brief: String, statusNote: String? = null): ProposedProjectSetup {
        val trimmed = brief.trim()
        val lower = trimmed.lowercase()

        // Extract explicit physical dimensions like 3.25" x 4.5" or A5 / A6
        val dimMatch = Regex("""(\d+(?:\.\d+)?)\s*["”']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["”']?""").find(trimmed)
        val pageSize = when {
            dimMatch != null -> "${dimMatch.groupValues[1]}\" × ${dimMatch.groupValues[2]}\""
            lower.contains("a5") -> "A5"
            lower.contains("a6") -> "A6"
            lower.contains("pocket") || lower.contains("mini journal") -> "Pocket (3.5\" × 5.5\")"
            else -> null
        }

        val cadence = when {
            lower.contains("a day") || lower.contains("daily") || lower.contains("every day") || lower.contains("each day") ->
                JournalCadence.DAILY
            lower.contains("weekly") || lower.contains("every week") || lower.contains("once a week") ->
                JournalCadence.WEEKLY
            lower.contains("whenever") || lower.contains("as needed") ->
                JournalCadence.WHENEVER
            else -> null
        }

        val entryLength = when {
            lower.contains("one page") || lower.contains("a page") || lower.contains("fill a page") ->
                "One notebook page"
            lower.contains("few lines") || lower.contains("short note") ->
                "A few short lines"
            else -> null
        }

        val (lines, words) = StructuredOutputValidator.estimatePageGrid(pageSize)

        // Detect Spencer-like friend appreciation / room / care brief without exposing sensitive context in title
        val isFriendCareBrief = (lower.contains("friend") || lower.contains("roommate")) &&
            (lower.contains("appreciate") || lower.contains("like about") || lower.contains("care") || lower.contains("missed"))

        if (isFriendCareBrief) {
            val themes = buildList {
                add("appreciation")
                if (lower.contains("room") || lower.contains("routine")) add("shared routines")
                add("friendship")
                if (lower.contains("his friends") || lower.contains("friends")) add("his friends")
                if (lower.contains("missed")) add("presence & small moments")
            }.distinct()

            val tone = buildString {
                append("Warm, low-pressure, grounded")
                if (lower.contains("not") || lower.contains("too much") || lower.contains("clingy")) {
                    append(", steady and unhurried")
                }
            }

            val boundaries = if (lower.contains("clingy") || lower.contains("too much") || lower.contains("hospital")) {
                "Keep notes light and grounded—no heavy pressure, no clinginess, and never ask to re-explain why he's away."
            } else {
                "Keep entries warm and easy to read without pressure."
            }

            val audience = when {
                lower.contains("roommate") && lower.contains("friend") -> "Close friend & roommate"
                lower.contains("friend") -> "A close friend"
                else -> null
            }

            return ProposedProjectSetup(
                title = "Mini Pocket Pages",
                writingGoal = "Write one warm, low-pressure pocket page sharing everyday appreciation and steady friendship.",
                audience = audience,
                cadence = cadence,
                pageSizeLabel = pageSize,
                entryLengthLabel = entryLength,
                linesPerPage = lines,
                wordsPerLine = words,
                themes = themes,
                tonePreferences = tone,
                boundaries = boundaries,
                firstPrompt = "What is one small, ordinary thing around the room or from your week that reminded you of something you genuinely like about him?",
                firstHints = listOf(
                    "Sentence starter: \"Walking past [spot/object] reminded me of how you always...\"",
                    "Smaller question: Think of a tiny habit of his that makes sharing a space easier.",
                ),
                usedAiCore = false,
                statusNote = statusNote,
            )
        }

        // Creative project log detection
        val isCreativeLog = lower.contains("project") || lower.contains("sketch") || lower.contains("studio") ||
            lower.contains("craft") || lower.contains("novel") || lower.contains("music") ||
            lower.contains("build") || lower.contains("woodwork") || lower.contains("creative")

        if (isCreativeLog) {
            val themes = extractKeywords(
                lower,
                mapOf(
                    "process" to listOf("process", "progress", "step", "experiment"),
                    "craft & materials" to listOf("sketch", "wood", "paint", "code", "craft", "design", "music", "draft"),
                    "momentum" to listOf("stuck", "momentum", "finish", "ship", "block"),
                    "decisions" to listOf("decision", "choice", "why", "note"),
                ),
                defaultList = listOf("creative process", "open questions", "small breakthroughs"),
            )
            val audience = when {
                lower.contains("future me") || lower.contains("future reader") -> "Future me"
                lower.contains("myself") || lower.contains("for me") -> "Myself"
                else -> null
            }
            return ProposedProjectSetup(
                title = "Studio Process Log",
                writingGoal = "Capture clear observations, experiments, and next steps from each creative session.",
                audience = audience,
                cadence = cadence,
                pageSizeLabel = pageSize,
                entryLengthLabel = entryLength,
                linesPerPage = lines,
                wordsPerLine = words,
                themes = themes,
                tonePreferences = "Curious, concrete, unpretentious",
                boundaries = "Focus on what you noticed or tried today rather than judging the whole project.",
                firstPrompt = "What single detail, texture, or problem in your current work held your attention longest today?",
                firstHints = listOf(
                    "Sentence starter: \"The moment the piece shifted slightly today was when...\"",
                    "Smaller question: What is one tiny experiment you want to try next session?",
                ),
                usedAiCore = false,
                statusNote = statusNote,
            )
        }

        // General daily reflection / fallback brief
        val audience = when {
            lower.contains("future reader") -> "A future reader"
            lower.contains("myself") || lower.contains("personal") || lower.contains("my own") -> "Myself"
            else -> null
        }

        val themes = extractKeywords(
            lower,
            mapOf(
                "daily grounding" to listOf("day", "daily", "morning", "evening", "routine"),
                "gratitude & notice" to listOf("grateful", "notice", "small", "calm", "quiet"),
                "clarity" to listOf("clear", "mind", "focus", "reflect", "unwind"),
                "growth" to listOf("learn", "habit", "goal", "change"),
            ),
            defaultList = listOf("everyday moments", "quiet noticing", "clarity"),
        )

        val title = when {
            lower.contains("morning") -> "Morning Pages"
            lower.contains("evening") || lower.contains("night") -> "Evening Unwind"
            lower.contains("gratitude") -> "Quiet Gratitude"
            else -> "Daily Reflection"
        }

        return ProposedProjectSetup(
            title = title,
            writingGoal = "Spend a few unhurried minutes noticing one grounded detail from today on paper.",
            audience = audience,
            cadence = cadence,
            pageSizeLabel = pageSize,
            entryLengthLabel = entryLength,
            linesPerPage = lines,
            wordsPerLine = words,
            themes = themes,
            tonePreferences = "Calm, observational, honest",
            boundaries = "Keep questions specific and grounded in real life—no vague clichés.",
            firstPrompt = "What was one quiet, ordinary moment today that felt worth remembering?",
            firstHints = listOf(
                "Sentence starter: \"Earlier today, I paused for a second when...\"",
                "Smaller question: Where were you sitting or standing, and what was in front of you?",
            ),
            usedAiCore = false,
            statusNote = statusNote,
        )
    }

    fun generateFallbackPrompt(
        project: JournalProject,
        recentPrompts: List<String>,
        recentTopics: List<String>,
        enabledContext: PromptContextPayload,
        previousTopicToAvoid: String? = null,
    ): Triple<String, String, List<String>> {
        val pool = buildCandidatePool(project, enabledContext)
        val avoidedTopics = (recentTopics.take(3) + listOfNotNull(previousTopicToAvoid)).toSet()
        val normalizedRecent = recentPrompts.map { normalize(it) }.toSet()

        val selected = pool.firstOrNull { candidate ->
            candidate.topicTag !in avoidedTopics && normalize(candidate.question) !in normalizedRecent
        } ?: pool.firstOrNull { candidate ->
            normalize(candidate.question) !in normalizedRecent
        } ?: pool.random()

        return Triple(selected.question, selected.topicTag, selected.hints)
    }

    fun generateFallbackHint(currentPrompt: String, existingHints: List<String>): String {
        val lower = currentPrompt.lowercase()
        val candidates = when {
            lower.contains("friend") || lower.contains("people") || lower.contains("group") -> listOf(
                "Sentence starter: \"One thing I always notice when you're all together is...\"",
                "Smaller question: Think of a recent joke, hangout, or small kindness someone showed.",
                "Recall cue: Picture the last time you heard them laughing—what sparked it?",
            )
            lower.contains("room") || lower.contains("routine") || lower.contains("space") -> listOf(
                "Sentence starter: \"It felt a little different this week whenever I...\"",
                "Smaller question: What time of day do your routines usually cross paths?",
                "Recall cue: Look at one item on a shelf or desk and trace the story behind it.",
            )
            lower.contains("project") || lower.contains("work") || lower.contains("creative") || lower.contains("experiment") -> listOf(
                "Sentence starter: \"I originally tried this approach because..., and what actually happened was...\"",
                "Smaller question: What surprised you—even slightly—during the last 20 minutes of working?",
                "Recall cue: Name one constraint you bumped into and one workaround you tested.",
            )
            else -> listOf(
                "Sentence starter: \"If I were describing just five minutes of that moment, I'd start with...\"",
                "Smaller question: What specific sound, object, or phrase stands out first?",
                "Recall cue: Shrink the answer down to one concrete scene rather than a summary.",
            )
        }
        return candidates.firstOrNull { it !in existingHints }
            ?: "Sentence starter: \"Right now, the simplest honest detail to put on the page is...\""
    }

    fun generateFallbackStart(project: JournalProject, currentPrompt: String): String {
        val lower = currentPrompt.lowercase()
        val isFriendTone = project.themes.any { it.contains("friendship", true) || it.contains("appreciation", true) }
        return when {
            isFriendTone && (lower.contains("room") || lower.contains("routine")) ->
                "Nothing huge happened today, just a small moment in the room that made me think of you—specifically how you always..."
            isFriendTone && lower.contains("friends") ->
                "One thing I really appreciate about your circle of friends is how naturally they..."
            isFriendTone ->
                "I was thinking about an ordinary detail from this week, and it reminded me how much I like that you..."
            project.themes.any { it.contains("creative", true) || it.contains("process", true) } ->
                "Today's session centered on one stubborn detail: I tried adjusting..."
            else ->
                "Looking back at today, one small detail stood out more than I expected:..."
        }
    }

    fun generateFallbackTighten(currentDraft: String, targetWords: Int?): String {
        val cleaned = currentDraft
            .replace(Regex("""\s+"""), " ")
            .replace(Regex("""\b(just|really|actually|literally|basically|very)\b\s*""", RegexOption.IGNORE_CASE), "")
            .replace(Regex("""\s+([,.!?])"""), "$1")
            .trim()
        if (targetWords == null) return cleaned
        val words = cleaned.split(" ").filter { it.isNotBlank() }
        return if (words.size > targetWords + 15) {
            words.take(targetWords).joinToString(" ").trimEnd(',', ';') + "."
        } else {
            cleaned
        }
    }

    private fun buildCandidatePool(
        project: JournalProject,
        enabledContext: PromptContextPayload,
    ): List<PromptCandidate> {
        val themesLower = project.themes.joinToString(" ").lowercase()
        val briefLower = project.originalBrief.lowercase()
        val isFriendAppreciation = themesLower.contains("appreciation") ||
            themesLower.contains("friendship") ||
            briefLower.contains("roommate") ||
            briefLower.contains("his friends")

        val isCreative = themesLower.contains("creative") ||
            themesLower.contains("process") ||
            themesLower.contains("craft") ||
            briefLower.contains("project log")

        val baseList = when {
            isFriendAppreciation -> listOf(
                PromptCandidate(
                    topicTag = "appreciation_trait",
                    question = "What is one quiet habit or personality trait of his that makes daily life feel steadier around him?",
                    hints = listOf(
                        "Sentence starter: \"I don't think I've ever said how much I appreciate the way you...\"",
                        "Smaller question: Think of a tiny gesture he does without thinking twice.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "his_friends",
                    question = "What is something you genuinely appreciate about his friends—maybe how they show up or the energy they bring?",
                    hints = listOf(
                        "Sentence starter: \"Whenever your friends are around, it's clear why you click with them—especially...\"",
                        "Smaller question: Recall one specific hangout or moment where his friends felt welcoming.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "shared_routines",
                    question = "Which small shared routine in your room—morning coffee, music, late-night wind-down—felt most noticeable by its absence this week?",
                    hints = listOf(
                        "Sentence starter: \"Around [time of day], the room always has this rhythm when we...\"",
                        "Smaller question: Focus on just one hour of the day you both usually cross paths.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "light_memory",
                    question = "What is an ordinary, funny, or low-stakes moment from the past few weeks that you'd want him to remember?",
                    hints = listOf(
                        "Sentence starter: \"Randomly remembered the time we... and it still makes me smile.\"",
                        "Smaller question: Keep it light—one small laugh, meal, or passing comment.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "shared_taste",
                    question = "What song, snack, show, or inside reference feels unmistakably like him right now, and why?",
                    hints = listOf(
                        "Sentence starter: \"Whenever [song/item] comes up, I immediately associate it with you because...\"",
                        "Smaller question: What would you put in a tiny care-package list of everyday things he likes?",
                    ),
                ),
                PromptCandidate(
                    topicTag = "friendship_friends_trait",
                    question = "How do you see the best parts of him reflected in the people he chooses to spend time with?",
                    hints = listOf(
                        "Sentence starter: \"You can always tell a lot about someone from their crew, and yours...\"",
                        "Smaller question: Name one friend of his and one quality you respect in them.",
                    ),
                ),
            )

            isCreative -> listOf(
                PromptCandidate(
                    topicTag = "observation",
                    question = "What specific part of the work moved forward today, even if it was just a rough test or adjustment?",
                    hints = listOf(
                        "Sentence starter: \"Before today, this piece felt stuck on..., and testing... changed it.\"",
                        "Smaller question: Describe the exact material, line, or structure you touched last.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "open_question",
                    question = "What unsolved question or design tension are you deliberately leaving open until the next session?",
                    hints = listOf(
                        "Sentence starter: \"I still haven't decided between... and..., and here is what each costs:\"",
                        "Smaller question: Write down two options without picking a winner yet.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "inspiration_source",
                    question = "What reference, tool, or accidental mistake gave you an idea worth keeping?",
                    hints = listOf(
                        "Sentence starter: \"Something unexpected happened when I...\"",
                        "Smaller question: What almost felt like an error at first?",
                    ),
                ),
                PromptCandidate(
                    topicTag = "next_step",
                    question = "If you only had twenty focused minutes tomorrow, what exact starting action would give you momentum?",
                    hints = listOf(
                        "Sentence starter: \"Tomorrow's first concrete step—before checking anything else—is to...\"",
                        "Smaller question: Make the first step small enough to finish in ten minutes.",
                    ),
                ),
            )

            else -> listOf(
                PromptCandidate(
                    topicTag = "sensory_moment",
                    question = "What small sensory detail—a sound, light in the room, or flavor—marked a pause in your day?",
                    hints = listOf(
                        "Sentence starter: \"For a minute today, everything slowed down when I noticed...\"",
                        "Smaller question: Stick to what you saw or heard, before adding interpretation.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "conversation",
                    question = "What brief exchange or passing remark from someone today stayed in the back of your mind?",
                    hints = listOf(
                        "Sentence starter: \"Someone mentioned... and it made me realize...\"",
                        "Smaller question: Who did you interact with, even briefly, and what was the tone?",
                    ),
                ),
                PromptCandidate(
                    topicTag = "energy_check",
                    question = "What gave you a quiet lift of energy today, and what quietly drained it?",
                    hints = listOf(
                        "Sentence starter: \"My energy felt clearest right after...\"",
                        "Smaller question: Compare morning energy with late-afternoon energy in two lines.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "gratitude_concrete",
                    question = "What practical convenience or small kindness made today noticeably smoother than it might have been?",
                    hints = listOf(
                        "Sentence starter: \"Today would have been harder without...\"",
                        "Smaller question: Name something ordinary you'd miss if it broke tomorrow.",
                    ),
                ),
                PromptCandidate(
                    topicTag = "carry_forward",
                    question = "What is one thought or unfinished thread you'd like to set down on paper before tomorrow?",
                    hints = listOf(
                        "Sentence starter: \"The thing still circling in my head tonight is...\"",
                        "Smaller question: What can wait until morning once it's written down?",
                    ),
                ),
            )
        }.toMutableList()

        // Only weave in weather/time if explicitly opted in for this project!
        if (enabledContext.weatherSummary != null && !isFriendAppreciation) {
            baseList.add(
                1,
                PromptCandidate(
                    topicTag = "weather_atmosphere",
                    question = "With ${enabledContext.weatherSummary.lowercase()} outside, how has the atmosphere shaped your pace or focus today?",
                    hints = listOf(
                        "Sentence starter: \"Watching the ${enabledContext.weatherSummary.lowercase()} from indoors made today feel...\"",
                        "Smaller question: Did the weather change where you worked or how long you lingered?",
                    ),
                ),
            )
        } else if (enabledContext.dateTimeText != null && !isFriendAppreciation) {
            baseList.add(
                1,
                PromptCandidate(
                    topicTag = "time_of_day",
                    question = "Looking at ${enabledContext.dateTimeText}, what stands out most about this stretch of the day?",
                    hints = listOf(
                        "Sentence starter: \"Sitting down at this hour feels like...\"",
                        "Smaller question: Compare how this hour felt today versus earlier in the week.",
                    ),
                ),
            )
        }

        return baseList
    }

    private fun extractKeywords(
        lower: String,
        mapping: Map<String, List<String>>,
        defaultList: List<String>,
    ): List<String> {
        val found = mapping.entries.mapNotNull { (label, cues) ->
            if (cues.any { lower.contains(it) }) label else null
        }
        return if (found.isEmpty()) defaultList else found.take(5)
    }

    private fun normalize(text: String): String =
        text.lowercase().replace(Regex("[^a-z0-9 ]"), "").trim()
}

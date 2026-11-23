package com.example.data.local

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import com.example.model.JournalCadence
import com.example.model.JournalEntry
import com.example.model.JournalProject
import com.example.model.PromptHistoryItem

@Entity(tableName = "journal_projects")
data class JournalProjectEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val title: String,
    val writingGoal: String,
    val originalBrief: String,
    val audience: String?,
    val cadenceName: String?,
    val pageSizeLabel: String?,
    val entryLengthLabel: String?,
    val linesPerPage: Int,
    val wordsPerLine: Int,
    val themes: List<String>,
    val tonePreferences: String?,
    val boundaries: String?,
    val includePastAnswersInPrompts: Boolean,
    val showDateTimeCard: Boolean,
    val showWeatherCard: Boolean,
    @ColumnInfo(defaultValue = "1") val showSparksCard: Boolean = true,
    @ColumnInfo(defaultValue = "1") val showRhythmCard: Boolean = true,
    @ColumnInfo(defaultValue = "1") val showTimerCard: Boolean = true,
    val includeDateTimeInPrompt: Boolean,
    val includeWeatherInPrompt: Boolean,
    val createdAtEpochMs: Long,
    val updatedAtEpochMs: Long,
) {
    fun toDomain(): JournalProject = JournalProject(
        id = id,
        title = title,
        writingGoal = writingGoal,
        originalBrief = originalBrief,
        audience = audience,
        cadence = cadenceName?.let { name -> JournalCadence.entries.firstOrNull { it.name == name } },
        pageSizeLabel = pageSizeLabel,
        entryLengthLabel = entryLengthLabel,
        linesPerPage = linesPerPage,
        wordsPerLine = wordsPerLine,
        themes = themes,
        tonePreferences = tonePreferences,
        boundaries = boundaries,
        includePastAnswersInPrompts = includePastAnswersInPrompts,
        showDateTimeCard = showDateTimeCard,
        showWeatherCard = showWeatherCard,
        showSparksCard = showSparksCard,
        showRhythmCard = showRhythmCard,
        showTimerCard = showTimerCard,
        includeDateTimeInPrompt = includeDateTimeInPrompt,
        includeWeatherInPrompt = includeWeatherInPrompt,
        createdAtEpochMs = createdAtEpochMs,
        updatedAtEpochMs = updatedAtEpochMs,
    )

    companion object {
        fun fromDomain(project: JournalProject): JournalProjectEntity = JournalProjectEntity(
            id = project.id,
            title = project.title,
            writingGoal = project.writingGoal,
            originalBrief = project.originalBrief,
            audience = project.audience,
            cadenceName = project.cadence?.name,
            pageSizeLabel = project.pageSizeLabel,
            entryLengthLabel = project.entryLengthLabel,
            linesPerPage = project.linesPerPage,
            wordsPerLine = project.wordsPerLine,
            themes = project.themes,
            tonePreferences = project.tonePreferences,
            boundaries = project.boundaries,
            includePastAnswersInPrompts = project.includePastAnswersInPrompts,
            showDateTimeCard = project.showDateTimeCard,
            showWeatherCard = project.showWeatherCard,
            showSparksCard = project.showSparksCard,
            showRhythmCard = project.showRhythmCard,
            showTimerCard = project.showTimerCard,
            includeDateTimeInPrompt = project.includeDateTimeInPrompt,
            includeWeatherInPrompt = project.includeWeatherInPrompt,
            createdAtEpochMs = project.createdAtEpochMs,
            updatedAtEpochMs = project.updatedAtEpochMs,
        )
    }
}

@Entity(
    tableName = "journal_entries",
    foreignKeys = [
        ForeignKey(
            entity = JournalProjectEntity::class,
            parentColumns = ["id"],
            childColumns = ["projectId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["projectId", "dateIso"], unique = true),
        Index(value = ["projectId"]),
    ],
)
data class JournalEntryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val projectId: Long,
    val dateIso: String,
    val promptText: String,
    val promptTopicTag: String,
    val hints: List<String>,
    val draftText: String,
    val isCompleted: Boolean,
    val completedAtEpochMs: Long?,
    val updatedAtEpochMs: Long,
) {
    fun toDomain(): JournalEntry = JournalEntry(
        id = id,
        projectId = projectId,
        dateIso = dateIso,
        promptText = promptText,
        promptTopicTag = promptTopicTag,
        hints = hints,
        draftText = draftText,
        isCompleted = isCompleted,
        completedAtEpochMs = completedAtEpochMs,
        updatedAtEpochMs = updatedAtEpochMs,
    )

    companion object {
        fun fromDomain(entry: JournalEntry): JournalEntryEntity = JournalEntryEntity(
            id = entry.id,
            projectId = entry.projectId,
            dateIso = entry.dateIso,
            promptText = entry.promptText,
            promptTopicTag = entry.promptTopicTag,
            hints = entry.hints,
            draftText = entry.draftText,
            isCompleted = entry.isCompleted,
            completedAtEpochMs = entry.completedAtEpochMs,
            updatedAtEpochMs = entry.updatedAtEpochMs,
        )
    }
}

@Entity(
    tableName = "prompt_history",
    foreignKeys = [
        ForeignKey(
            entity = JournalProjectEntity::class,
            parentColumns = ["id"],
            childColumns = ["projectId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["projectId"])],
)
data class PromptHistoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0L,
    val projectId: Long,
    val dateIso: String,
    val promptText: String,
    val topicTag: String,
    val createdAtEpochMs: Long,
) {
    fun toDomain(): PromptHistoryItem = PromptHistoryItem(
        id = id,
        projectId = projectId,
        dateIso = dateIso,
        promptText = promptText,
        topicTag = topicTag,
        createdAtEpochMs = createdAtEpochMs,
    )
}

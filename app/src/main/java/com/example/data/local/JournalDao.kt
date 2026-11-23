package com.example.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface JournalDao {
    @Query("SELECT * FROM journal_projects ORDER BY updatedAtEpochMs DESC")
    fun observeProjects(): Flow<List<JournalProjectEntity>>

    @Query("SELECT * FROM journal_projects WHERE id = :projectId")
    fun observeProject(projectId: Long): Flow<JournalProjectEntity?>

    @Query("SELECT * FROM journal_projects WHERE id = :projectId")
    suspend fun getProjectById(projectId: Long): JournalProjectEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProject(project: JournalProjectEntity): Long

    @Update
    suspend fun updateProject(project: JournalProjectEntity)

    @Query("DELETE FROM journal_projects WHERE id = :projectId")
    suspend fun deleteProjectById(projectId: Long)

    @Query("SELECT * FROM journal_entries WHERE projectId = :projectId AND dateIso = :dateIso LIMIT 1")
    fun observeEntryForDate(projectId: Long, dateIso: String): Flow<JournalEntryEntity?>

    @Query("SELECT * FROM journal_entries WHERE projectId = :projectId AND dateIso = :dateIso LIMIT 1")
    suspend fun getEntryForDate(projectId: Long, dateIso: String): JournalEntryEntity?

    @Query("SELECT * FROM journal_entries WHERE projectId = :projectId ORDER BY dateIso DESC, updatedAtEpochMs DESC")
    fun observeEntriesForProject(projectId: Long): Flow<List<JournalEntryEntity>>

    @Query(
        "SELECT * FROM journal_entries WHERE projectId = :projectId AND TRIM(draftText) != '' ORDER BY dateIso DESC LIMIT :limit",
    )
    suspend fun getRecentAnsweredEntries(projectId: Long, limit: Int = 5): List<JournalEntryEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertEntry(entry: JournalEntryEntity): Long

    @Query("SELECT * FROM prompt_history WHERE projectId = :projectId ORDER BY createdAtEpochMs DESC LIMIT :limit")
    fun observePromptHistory(projectId: Long, limit: Int = 20): Flow<List<PromptHistoryEntity>>

    @Query("SELECT * FROM prompt_history WHERE projectId = :projectId ORDER BY createdAtEpochMs DESC LIMIT :limit")
    suspend fun getRecentPromptHistory(projectId: Long, limit: Int = 15): List<PromptHistoryEntity>

    @Insert
    suspend fun insertPromptHistory(item: PromptHistoryEntity): Long
}

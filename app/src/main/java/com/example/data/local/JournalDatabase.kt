package com.example.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [
        JournalProjectEntity::class,
        JournalEntryEntity::class,
        PromptHistoryEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
@TypeConverters(JournalTypeConverters::class)
abstract class JournalDatabase : RoomDatabase() {
    abstract fun journalDao(): JournalDao

    companion object {
        @Volatile
        private var instance: JournalDatabase? = null

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE journal_projects ADD COLUMN showSparksCard INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE journal_projects ADD COLUMN showRhythmCard INTEGER NOT NULL DEFAULT 1")
                db.execSQL("ALTER TABLE journal_projects ADD COLUMN showTimerCard INTEGER NOT NULL DEFAULT 1")
            }
        }

        fun getInstance(context: Context): JournalDatabase {
            return instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    JournalDatabase::class.java,
                    "journal_companion_local.db",
                ).addMigrations(MIGRATION_1_2).build().also { instance = it }
            }
        }
    }
}

package com.example.data.local

import androidx.room.TypeConverter
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class JournalTypeConverters {
    private val json = Json { ignoreUnknownKeys = true }

    @TypeConverter
    fun fromStringList(list: List<String>): String = json.encodeToString(list)

    @TypeConverter
    fun toStringList(value: String): List<String> = runCatching {
        if (value.isBlank()) emptyList() else json.decodeFromString<List<String>>(value)
    }.getOrDefault(emptyList())
}

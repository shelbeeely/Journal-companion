package com.example.weather

import com.example.model.WeatherSnapshot
import java.io.IOException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime
import java.time.LocalTime
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Weather client backed by Open-Meteo (https://open-meteo.com/).
 * Privacy guarantee: only city query or 2-decimal-rounded approximate coordinates are transmitted.
 * Never receives journal briefs, recipients, project settings, or entry text.
 * Attribution: Weather data by Open-Meteo.com (CC BY 4.0).
 */
class OpenMeteoClient(
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class GeocodingResponse(
        val results: List<GeocodingResult> = emptyList(),
    )

    @Serializable
    private data class GeocodingResult(
        val name: String,
        val admin1: String? = null,
        val country: String? = null,
        val latitude: Double,
        val longitude: Double,
    )

    @Serializable
    private data class ForecastResponse(
        val current: CurrentBlock? = null,
        val daily: DailyBlock? = null,
        val hourly: HourlyBlock? = null,
    )

    @Serializable
    private data class CurrentBlock(
        @SerialName("temperature_2m") val temperature2m: Double,
        @SerialName("apparent_temperature") val apparentTemperature: Double? = null,
        @SerialName("weather_code") val weatherCode: Int,
        @SerialName("wind_speed_10m") val windSpeed10m: Double? = null,
        @SerialName("is_day") val isDay: Int? = null,
    )

    @Serializable
    private data class DailyBlock(
        @SerialName("temperature_2m_max") val temperatureMax: List<Double> = emptyList(),
        @SerialName("temperature_2m_min") val temperatureMin: List<Double> = emptyList(),
        val sunrise: List<String> = emptyList(),
        val sunset: List<String> = emptyList(),
        @SerialName("uv_index_max") val uvIndexMax: List<Double?> = emptyList(),
    )

    @Serializable
    private data class HourlyBlock(
        val time: List<String> = emptyList(),
        @SerialName("precipitation_probability") val precipitationProbability: List<Int?> = emptyList(),
    )

    suspend fun fetchWeatherByCity(cityQuery: String, nowEpochMs: Long = System.currentTimeMillis()): Result<WeatherSnapshot> =
        withContext(Dispatchers.IO) {
            runCatching {
                val trimmed = cityQuery.trim()
                require(trimmed.isNotEmpty()) { "Enter a city name first." }
                val encoded = URLEncoder.encode(trimmed, StandardCharsets.UTF_8.name())
                val geoUrl = "https://geocoding-api.open-meteo.com/v1/search?name=$encoded&count=1&language=en&format=json"
                val geoBody = executeGet(geoUrl)
                val geo = json.decodeFromString<GeocodingResponse>(geoBody)
                val match = geo.results.firstOrNull()
                    ?: throw IOException("No city found matching \"$trimmed\".")

                val label = listOfNotNull(match.name, match.admin1?.takeIf { it != match.name })
                    .joinToString(", ")
                fetchForecastInternal(match.latitude, match.longitude, label, nowEpochMs)
            }
        }

    suspend fun fetchWeatherByCoordinates(
        latitude: Double,
        longitude: Double,
        cityLabel: String,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): Result<WeatherSnapshot> = withContext(Dispatchers.IO) {
        runCatching {
            fetchForecastInternal(latitude, longitude, cityLabel, nowEpochMs)
        }
    }

    private fun fetchForecastInternal(
        latitude: Double,
        longitude: Double,
        cityLabel: String,
        nowEpochMs: Long,
    ): WeatherSnapshot {
        val latRounded = (latitude * 100.0).roundToInt() / 100.0
        val lonRounded = (longitude * 100.0).roundToInt() / 100.0

        val forecastUrl =
            "https://api.open-meteo.com/v1/forecast" +
                "?latitude=$latRounded&longitude=$lonRounded" +
                "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day" +
                "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max" +
                "&hourly=precipitation_probability" +
                "&forecast_days=1&timezone=auto"

        val body = executeGet(forecastUrl)
        val parsed = json.decodeFromString<ForecastResponse>(body)
        val current = parsed.current ?: throw IOException("Weather response missing current conditions.")
        val high = parsed.daily?.temperatureMax?.firstOrNull() ?: current.temperature2m
        val low = parsed.daily?.temperatureMin?.firstOrNull() ?: current.temperature2m
        val (precipChance, precipPeriod) = summarizePrecipitationWindow(
            times = parsed.hourly?.time.orEmpty(),
            probabilities = parsed.hourly?.precipitationProbability.orEmpty(),
            currentHour = LocalTime.now().hour,
        )

        return WeatherSnapshot(
            cityLabel = cityLabel.ifBlank { "Local area" },
            latitudeRounded = latRounded,
            longitudeRounded = lonRounded,
            conditionLabel = mapWmoCodeToCondition(current.weatherCode),
            wmoCode = current.weatherCode,
            temperatureCelsius = current.temperature2m,
            highCelsius = high,
            lowCelsius = low,
            precipitationChancePercent = precipChance,
            precipitationPeriodLabel = precipPeriod,
            fetchedAtEpochMs = nowEpochMs,
            feelsLikeCelsius = current.apparentTemperature,
            windSpeedKmh = current.windSpeed10m,
            sunriseIso = parsed.daily?.sunrise?.firstOrNull(),
            sunsetIso = parsed.daily?.sunset?.firstOrNull(),
            uvIndexMax = parsed.daily?.uvIndexMax?.firstOrNull(),
            isDaytime = current.isDay?.let { it == 1 },
        )
    }

    private fun executeGet(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "JournalCompanionAndroid/1.0")
            .get()
            .build()
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Weather service returned HTTP ${response.code}.")
            }
            return response.body?.string() ?: throw IOException("Empty response from weather service.")
        }
    }

    companion object {
        fun summarizePrecipitationWindow(
            times: List<String>,
            probabilities: List<Int?>,
            currentHour: Int,
        ): Pair<Int?, String?> {
            if (times.isEmpty() || probabilities.isEmpty()) return null to null
            val points = times.zip(probabilities).mapNotNull { (isoTime, prob) ->
                val hour = runCatching { LocalDateTime.parse(isoTime).hour }.getOrNull() ?: return@mapNotNull null
                val pct = prob ?: return@mapNotNull null
                hour to pct
            }
            if (points.isEmpty()) return null to null

            val upcoming = points.filter { it.first >= currentHour }.ifEmpty { points }
            val peak = upcoming.maxByOrNull { it.second } ?: return null to null
            val periodLabel = when (peak.first) {
                in 0..5 -> "overnight (12–6 AM)"
                in 6..11 -> "this morning (6 AM–12 PM)"
                in 12..16 -> "this afternoon (12–5 PM)"
                in 17..20 -> "this evening (5–9 PM)"
                else -> "tonight (9 PM–12 AM)"
            }
            return peak.second to periodLabel
        }

        fun mapWmoCodeToCondition(code: Int): String = when (code) {
            0 -> "Clear sky"
            1 -> "Mainly clear"
            2 -> "Partly cloudy"
            3 -> "Overcast"
            45, 48 -> "Foggy"
            51, 53, 55 -> "Drizzle"
            56, 57 -> "Freezing drizzle"
            61, 63, 65 -> "Rain"
            66, 67 -> "Freezing rain"
            71, 73, 75, 77 -> "Snow"
            80, 81, 82 -> "Rain showers"
            85, 86 -> "Snow showers"
            95 -> "Thunderstorm"
            96, 99 -> "Thunderstorm with hail"
            else -> "Mixed conditions"
        }
    }
}

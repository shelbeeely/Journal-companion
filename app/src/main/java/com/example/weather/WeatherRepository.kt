package com.example.weather

import com.example.data.preferences.AppPreferencesRepository
import com.example.model.WeatherSnapshot
import kotlinx.coroutines.flow.Flow

class WeatherRepository(
    private val preferencesRepository: AppPreferencesRepository,
    private val openMeteoClient: OpenMeteoClient = OpenMeteoClient(),
) {
    val cachedWeather: Flow<WeatherSnapshot?> = preferencesRepository.cachedWeather

    suspend fun refreshByCity(cityQuery: String): Result<WeatherSnapshot> {
        val result = openMeteoClient.fetchWeatherByCity(cityQuery)
        result.onSuccess { snapshot ->
            preferencesRepository.setManualCityQuery(snapshot.cityLabel)
            preferencesRepository.saveCachedWeather(snapshot)
        }
        return result
    }

    suspend fun refreshByCoordinates(
        latitude: Double,
        longitude: Double,
        cityLabel: String,
    ): Result<WeatherSnapshot> {
        val result = openMeteoClient.fetchWeatherByCoordinates(latitude, longitude, cityLabel)
        result.onSuccess { snapshot ->
            preferencesRepository.setManualCityQuery(snapshot.cityLabel)
            preferencesRepository.saveCachedWeather(snapshot)
        }
        return result
    }
}

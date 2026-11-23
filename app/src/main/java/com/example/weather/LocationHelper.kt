package com.example.weather

import android.annotation.SuppressLint
import android.content.Context
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

data class ApproxLocationResult(
    val latitude: Double,
    val longitude: Double,
    val cityLabel: String,
)

/**
 * Fetches approximate foreground location ONLY when explicitly triggered by user action
 * after granting ACCESS_COARSE_LOCATION. Never polls in the background.
 */
class LocationHelper(private val context: Context) {

    @SuppressLint("MissingPermission")
    suspend fun getApproximateLocation(): Result<ApproxLocationResult> = runCatching {
        val fusedClient = LocationServices.getFusedLocationProviderClient(context)
        val location = fetchFromFusedClient(fusedClient)
            ?: fetchLastKnownFallback()
            ?: throw IllegalStateException("Approximate location is currently unavailable. Try entering a city manually.")

        val cityLabel = resolveAreaLabel(location.latitude, location.longitude)
        ApproxLocationResult(
            latitude = location.latitude,
            longitude = location.longitude,
            cityLabel = cityLabel,
        )
    }

    @SuppressLint("MissingPermission")
    private suspend fun fetchFromFusedClient(
        fusedClient: com.google.android.gms.location.FusedLocationProviderClient,
    ): Location? = suspendCancellableCoroutine { cont ->
        val tokenSource = CancellationTokenSource()
        cont.invokeOnCancellation { tokenSource.cancel() }

        fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, tokenSource.token)
            .addOnSuccessListener { loc ->
                if (loc != null) {
                    cont.resume(loc)
                } else {
                    fusedClient.lastLocation
                        .addOnSuccessListener { last -> cont.resume(last) }
                        .addOnFailureListener { cont.resume(null) }
                }
            }
            .addOnFailureListener {
                fusedClient.lastLocation
                    .addOnSuccessListener { last -> cont.resume(last) }
                    .addOnFailureListener { cont.resume(null) }
            }
    }

    @SuppressLint("MissingPermission")
    private fun fetchLastKnownFallback(): Location? {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        return runCatching {
            lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)
        }.getOrNull()
    }

    @Suppress("DEPRECATION")
    private suspend fun resolveAreaLabel(latitude: Double, longitude: Double): String =
        withContext(Dispatchers.IO) {
            runCatching {
                val geocoder = Geocoder(context, Locale.getDefault())
                val list = geocoder.getFromLocation(latitude, longitude, 1)
                val addr = list?.firstOrNull()
                listOfNotNull(addr?.locality ?: addr?.subAdminArea, addr?.adminArea)
                    .distinct()
                    .joinToString(", ")
                    .ifBlank { "Approximate area" }
            }.getOrDefault("Approximate area")
        }
}

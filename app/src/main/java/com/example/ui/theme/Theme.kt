package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.example.model.AppThemeMode

private val LightColorScheme = lightColorScheme(
    primary = BotanicalInk,
    onPrimary = ElevatedCream,
    primaryContainer = BotanicalInkLight,
    onPrimaryContainer = BotanicalInk,
    secondary = TerracottaAccent,
    onSecondary = ElevatedCream,
    secondaryContainer = TerracottaSoft,
    onSecondaryContainer = TerracottaAccent,
    background = IvoryPaper,
    onBackground = InkCharcoal,
    surface = IvoryPaper,
    onSurface = InkCharcoal,
    surfaceVariant = WarmParchment,
    onSurfaceVariant = SepiaMuted,
    surfaceContainerLowest = ElevatedCream,
    surfaceContainerLow = Color(0xFFF6F1E8),
    surfaceContainer = WarmParchment,
    surfaceContainerHigh = Color(0xFFE3DACB),
    outline = HairlineWarm,
    outlineVariant = HairlineWarm,
)

private val DarkColorScheme = darkColorScheme(
    primary = SageInk,
    onPrimary = ObsidianDesk,
    primaryContainer = SageInkContainer,
    onPrimaryContainer = SageInk,
    secondary = WarmAmberAccent,
    onSecondary = ObsidianDesk,
    secondaryContainer = WarmAmberContainer,
    onSecondaryContainer = WarmAmberAccent,
    background = ObsidianDesk,
    onBackground = CreamInk,
    surface = ObsidianDesk,
    onSurface = CreamInk,
    surfaceVariant = DarkSlatePaper,
    onSurfaceVariant = TaupeMuted,
    surfaceContainerLowest = DarkSlatePaper,
    surfaceContainerLow = Color(0xFF1F1C19),
    surfaceContainer = DarkSlatePaper,
    surfaceContainerHigh = DarkElevatedPaper,
    outline = HairlineDark,
    outlineVariant = HairlineDark,
)

private val DimDeskColorScheme = darkColorScheme(
    primary = DimAccent,
    onPrimary = DimInkBlack,
    primaryContainer = DimAccentContainer,
    onPrimaryContainer = DimWarmText,
    secondary = DimWarmText,
    onSecondary = DimInkBlack,
    secondaryContainer = DimSurfaceElevated,
    onSecondaryContainer = DimWarmText,
    background = DimInkBlack,
    onBackground = DimWarmText,
    surface = DimInkBlack,
    onSurface = DimWarmText,
    surfaceVariant = DimSurface,
    onSurfaceVariant = DimMutedText,
    surfaceContainerLowest = DimSurface,
    surfaceContainerLow = Color(0xFF14110F),
    surfaceContainer = DimSurface,
    surfaceContainerHigh = DimSurfaceElevated,
    outline = DimBorder,
    outlineVariant = DimBorder,
)

private val JournalShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun isEffectiveDarkTheme(
    themeMode: AppThemeMode,
    isDimDeskMode: Boolean,
    systemIsDark: Boolean = isSystemInDarkTheme(),
): Boolean = when {
    isDimDeskMode -> true
    themeMode == AppThemeMode.DARK -> true
    themeMode == AppThemeMode.LIGHT -> false
    else -> systemIsDark
}

@Composable
fun JournalCompanionTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    isDimDeskMode: Boolean = false,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val useDark = when {
        isDimDeskMode -> true
        themeMode == AppThemeMode.DARK -> true
        themeMode == AppThemeMode.LIGHT -> false
        else -> darkTheme
    }

    val colorScheme = when {
        isDimDeskMode -> DimDeskColorScheme
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (useDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        useDark -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = JournalTypography,
        shapes = JournalShapes,
        content = content,
    )
}

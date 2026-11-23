package com.example

import android.graphics.Color as AndroidColor
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.ui.JournalCompanionApp
import com.example.ui.MainViewModel
import com.example.ui.theme.JournalCompanionTheme
import com.example.ui.theme.isEffectiveDarkTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val uiState by viewModel.uiState.collectAsStateWithLifecycle()
            val hideInRecents = uiState.preferences.hideInRecentsEnabled
            val themeMode = uiState.preferences.themeMode
            val isDimMode = uiState.preferences.dimDeskModeEnabled
            val effectiveDark = isEffectiveDarkTheme(themeMode = themeMode, isDimDeskMode = isDimMode)

            LaunchedEffect(effectiveDark) {
                enableEdgeToEdge(
                    statusBarStyle = if (effectiveDark) {
                        SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                    } else {
                        SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                    },
                    navigationBarStyle = if (effectiveDark) {
                        SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                    } else {
                        SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                    },
                )
            }

            LaunchedEffect(hideInRecents) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    // Protects recent-app switcher previews without blacking out virtual displays/emulators
                    setRecentsScreenshotEnabled(!hideInRecents)
                } else {
                    if (hideInRecents) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    }
                }
            }

            JournalCompanionTheme(
                themeMode = themeMode,
                isDimDeskMode = isDimMode,
            ) {
                JournalCompanionApp(viewModel = viewModel)
            }
        }
    }
}

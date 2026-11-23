package com.example.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.example.model.JournalCadence
import com.example.model.ProposedProjectSetup
import com.example.ui.ProjectEditorUiState
import kotlin.math.roundToInt

private const val SAMPLE_SPENCER_BRIEF =
    "3.25\" x 4.5\" Mini journal. How can I fill a page a day for my friend spencer while he's in the psych hospital. I want to tell him all tje thingi like about him, why i appreciate his friends, and that i care but i don'twant to seem like I'm being to much or clingy or anything like that. He's my roommate and we are close enough that we literally share a room and I've missed his presence this week"

private const val SAMPLE_DAILY_BRIEF =
    "A5 notebook for a daily 5-minute evening reflection for myself. Help me notice small ordinary details from my day without generic productivity pressure."

private const val SAMPLE_CREATIVE_BRIEF =
    "Studio project log for my woodworking and ceramic prototypes whenever I finish a work session. Track experiments, material notes, and next steps."

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectEditorScreen(
    state: ProjectEditorUiState,
    onBriefChange: (String) -> Unit,
    onAnalyzeBrief: () -> Unit,
    onManualSetup: () -> Unit,
    onUpdateProposed: ((ProposedProjectSetup) -> ProposedProjectSetup) -> Unit,
    onUpdateToggles: (
        includePastAnswers: Boolean?,
        showDateTime: Boolean?,
        showWeather: Boolean?,
        includeDateTimeInPrompt: Boolean?,
        includeWeatherInPrompt: Boolean?,
    ) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isEditing = state.editingProjectId != null
    val proposal = state.proposedSetup

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            modifier = Modifier.widthIn(max = 680.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.minimumInteractiveComponentSize(),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                }
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (isEditing) "Edit Project & Brief" else "New Journal Project",
                    style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.semantics { heading() },
                )
            }

            if (isEditing) {
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "Editing your brief updates future guidance after review. Existing journal history is always preserved.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            // Step 1: Freeform Brief
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(
                        text = "1. Describe your journal in your own words",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    OutlinedTextField(
                        value = state.briefText,
                        onValueChange = onBriefChange,
                        placeholder = {
                            Text("Paste or write your brief—notebook size, cadence, themes, tone, boundaries, or audience...")
                        },
                        minLines = 4,
                        maxLines = 9,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("project_brief_input"),
                    )

                    if (!isEditing) {
                        Text(
                            text = "Or load an example brief to test:",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            OutlinedButton(
                                onClick = { onBriefChange(SAMPLE_SPENCER_BRIEF) },
                                modifier = Modifier.testTag("load_spencer_brief"),
                            ) {
                                Text("Mini friend journal")
                            }
                            OutlinedButton(
                                onClick = { onBriefChange(SAMPLE_DAILY_BRIEF) },
                                modifier = Modifier.testTag("load_daily_brief"),
                            ) {
                                Text("Daily reflection")
                            }
                            OutlinedButton(
                                onClick = { onBriefChange(SAMPLE_CREATIVE_BRIEF) },
                                modifier = Modifier.testTag("load_creative_brief"),
                            ) {
                                Text("Creative project log")
                            }
                        }
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Button(
                            onClick = onAnalyzeBrief,
                            enabled = !state.isAnalyzingBrief && state.briefText.isNotBlank(),
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("analyze_brief_button"),
                        ) {
                            if (state.isAnalyzingBrief) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(if (proposal == null) "Propose setup with AICore" else "Re-analyze brief")
                        }

                        OutlinedButton(
                            onClick = onManualSetup,
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("manual_setup_button"),
                        ) {
                            Icon(Icons.Outlined.EditNote, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Manual setup")
                        }
                    }
                }
            }

            // Step 2: Review & Edit Proposed Setup before applying
            if (proposal != null) {
                proposal.statusNote?.let { note ->
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = note,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier.padding(12.dp),
                        )
                    }
                }

                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("proposed_setup_review_card"),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            text = "2. Review & adjust setup before applying",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )
                        Text(
                            text = if (proposal.usedAiCore) {
                                "Proposed by on-device AICore. Unknown fields stay unset."
                            } else {
                                "Prepared locally. Unknown fields stay unset—edit anything below."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        OutlinedTextField(
                            value = proposal.title,
                            onValueChange = { v -> onUpdateProposed { it.copy(title = v) } },
                            label = { Text("Discreet project title") },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_title_input"),
                        )

                        OutlinedTextField(
                            value = proposal.writingGoal,
                            onValueChange = { v -> onUpdateProposed { it.copy(writingGoal = v) } },
                            label = { Text("One-sentence writing goal") },
                            maxLines = 3,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_goal_input"),
                        )

                        OutlinedTextField(
                            value = proposal.audience.orEmpty(),
                            onValueChange = { v -> onUpdateProposed { it.copy(audience = v.ifBlank { null }) } },
                            label = { Text("Audience (optional — leave blank if unset)") },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_audience_input"),
                        )

                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Cadence (optional)", style = MaterialTheme.typography.labelLarge)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    selected = proposal.cadence == null,
                                    onClick = { onUpdateProposed { it.copy(cadence = null) } },
                                    label = { Text("Unset") },
                                )
                                JournalCadence.entries.forEach { cadence ->
                                    FilterChip(
                                        selected = proposal.cadence == cadence,
                                        onClick = { onUpdateProposed { it.copy(cadence = cadence) } },
                                        label = { Text(cadence.displayName) },
                                    )
                                }
                            }
                        }

                        OutlinedTextField(
                            value = proposal.pageSizeLabel.orEmpty(),
                            onValueChange = { v -> onUpdateProposed { it.copy(pageSizeLabel = v.ifBlank { null }) } },
                            label = { Text("Physical page size (optional, e.g., 3.25\" × 4.5\")") },
                            singleLine = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_pagesize_input"),
                        )

                        if (!proposal.pageSizeLabel.isNullOrBlank()) {
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                                shape = MaterialTheme.shapes.medium,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(
                                    modifier = Modifier.padding(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp),
                                ) {
                                    Text(
                                        text = "Handwriting estimate: ~${proposal.linesPerPage * proposal.wordsPerLine} words (${proposal.linesPerPage} lines × ${proposal.wordsPerLine} words/line)",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    Text(
                                        text = "Advisory guide only—never enforced as a limit.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Slider(
                                        value = proposal.linesPerPage.toFloat(),
                                        onValueChange = { v -> onUpdateProposed { it.copy(linesPerPage = v.roundToInt()) } },
                                        valueRange = 8f..40f,
                                    )
                                    Slider(
                                        value = proposal.wordsPerLine.toFloat(),
                                        onValueChange = { v -> onUpdateProposed { it.copy(wordsPerLine = v.roundToInt()) } },
                                        valueRange = 4f..14f,
                                    )
                                }
                            }
                        }

                        var themesText by remember(proposal.themes) {
                            mutableStateOf(proposal.themes.joinToString(", "))
                        }
                        OutlinedTextField(
                            value = themesText,
                            onValueChange = { raw ->
                                themesText = raw
                                val parsed = raw.split(",").map { it.trim() }.filter { it.isNotBlank() }
                                onUpdateProposed { it.copy(themes = parsed) }
                            },
                            label = { Text("Themes (comma-separated)") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_themes_input"),
                        )

                        OutlinedTextField(
                            value = proposal.tonePreferences.orEmpty(),
                            onValueChange = { v -> onUpdateProposed { it.copy(tonePreferences = v.ifBlank { null }) } },
                            label = { Text("Tone preferences (optional)") },
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_tone_input"),
                        )

                        OutlinedTextField(
                            value = proposal.boundaries.orEmpty(),
                            onValueChange = { v -> onUpdateProposed { it.copy(boundaries = v.ifBlank { null }) } },
                            label = { Text("Boundaries (optional — kept off Desk Mode)") },
                            maxLines = 3,
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("setup_boundaries_input"),
                        )

                        if (!isEditing) {
                            OutlinedTextField(
                                value = proposal.firstPrompt,
                                onValueChange = { v -> onUpdateProposed { it.copy(firstPrompt = v) } },
                                label = { Text("First Today prompt") },
                                maxLines = 4,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("setup_first_prompt_input"),
                            )
                        }
                    }
                }

                // Step 3: Privacy & Information Cards per project
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = "3. Context & Information Cards",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.semantics { heading() },
                        )

                        EditorToggleRow(
                            title = "Use previous typed answers in future prompts",
                            subtitle = "Off by default. Never guesses what you wrote on paper.",
                            checked = state.includePastAnswersInPrompts,
                            onCheckedChange = { onUpdateToggles(it, null, null, null, null) },
                            testTag = "toggle_use_past_answers",
                        )

                        EditorToggleRow(
                            title = "Show Date & Time card",
                            subtitle = "Display local date & time in Desk Mode",
                            checked = state.showDateTimeCard,
                            onCheckedChange = { onUpdateToggles(null, it, null, null, null) },
                            testTag = "toggle_show_datetime_card",
                        )

                        if (state.showDateTimeCard) {
                            EditorToggleRow(
                                title = "Include Date & Time in today's prompt",
                                subtitle = "Shares current day & time with AICore when generating prompts",
                                checked = state.includeDateTimeInPrompt,
                                onCheckedChange = { onUpdateToggles(null, null, null, it, null) },
                                testTag = "toggle_project_datetime_prompt",
                            )
                        }

                        EditorToggleRow(
                            title = "Show Weather card",
                            subtitle = "Display cached Open-Meteo weather in Desk Mode",
                            checked = state.showWeatherCard,
                            onCheckedChange = { onUpdateToggles(null, null, it, null, null) },
                            testTag = "toggle_show_weather_card",
                        )

                        if (state.showWeatherCard) {
                            EditorToggleRow(
                                title = "Include Weather in today's prompt",
                                subtitle = "Off by default so weather sits beside your notebook without turning every prompt into a weather question",
                                checked = state.includeWeatherInPrompt,
                                onCheckedChange = { onUpdateToggles(null, null, null, null, it) },
                                testTag = "toggle_project_weather_prompt",
                            )
                        }
                    }
                }

                Button(
                    onClick = onSave,
                    enabled = proposal.title.isNotBlank() || proposal.writingGoal.isNotBlank(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .minimumInteractiveComponentSize()
                        .testTag("save_project_button"),
                ) {
                    Icon(Icons.Outlined.Check, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (isEditing) "Save changes (preserve history)" else "Apply & open Today")
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun EditorToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    testTag: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
        modifier = Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .padding(vertical = 4.dp),
    ) {
        Column(modifier = Modifier.weight(1f).padding(end = 12.dp)) {
            Text(text = title, style = MaterialTheme.typography.bodyMedium)
            Text(text = subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(testTag),
        )
    }
}

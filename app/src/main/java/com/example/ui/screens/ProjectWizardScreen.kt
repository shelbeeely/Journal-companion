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
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
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
import androidx.compose.material3.LinearProgressIndicator
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
import com.example.ai.StructuredOutputValidator
import com.example.model.JournalCadence
import com.example.model.ProposedProjectSetup
import com.example.model.WizardSeedInputs
import com.example.ui.ProjectEditorUiState
import kotlin.math.roundToInt

private const val WIZARD_SAMPLE_SPENCER =
    "3.25\" x 4.5\" Mini journal. How can I fill a page a day for my friend spencer while he's in the psych hospital. I want to tell him all tje thingi like about him, why i appreciate his friends, and that i care but i don'twant to seem like I'm being to much or clingy or anything like that. He's my roommate and we are close enough that we literally share a room and I've missed his presence this week"

private const val WIZARD_SAMPLE_DAILY =
    "A5 notebook for a daily 5-minute evening reflection for myself. Help me notice small ordinary details from my day without generic productivity pressure."

private const val WIZARD_SAMPLE_CREATIVE =
    "Studio project log for my woodworking and ceramic prototypes whenever I finish a work session. Track experiments, material notes, and next steps."

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectWizardScreen(
    state: ProjectEditorUiState,
    onBriefChange: (String) -> Unit,
    onUpdateWizardInputs: ((WizardSeedInputs) -> WizardSeedInputs) -> Unit,
    onGoToStep: (Int) -> Unit,
    onProposeWithAiCore: () -> Unit,
    onSkipAiManualSetup: () -> Unit,
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
    val step = state.wizardStep.coerceIn(0, 3)
    val stepTitles = listOf("Brief", "Cadence & Audience", "Page Size & Tone", "Review & Save")

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
            // Wizard header & progress
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(
                        onClick = {
                            if (step > 0) onGoToStep(step - 1) else onBack()
                        },
                        modifier = Modifier.minimumInteractiveComponentSize(),
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                    }
                    Spacer(Modifier.width(6.dp))
                    Column {
                        Text(
                            text = "New Journal Project",
                            style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.semantics { heading() },
                        )
                        Text(
                            text = "Step ${step + 1} of 4 · ${stepTitles[step]}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.testTag("wizard_step_label"),
                        )
                    }
                }

                if (step < 3) {
                    TextButton(
                        onClick = onSkipAiManualSetup,
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("wizard_skip_ai_button"),
                    ) {
                        Icon(Icons.Outlined.EditNote, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Skip AI")
                    }
                }
            }

            LinearProgressIndicator(
                progress = { (step + 1) / 4f },
                modifier = Modifier.fillMaxWidth(),
            )

            when (step) {
                0 -> WizardStepBrief(
                    briefText = state.briefText,
                    onBriefChange = onBriefChange,
                    onNext = { onGoToStep(1) },
                    onSkipAiManual = onSkipAiManualSetup,
                )

                1 -> WizardStepCadenceAudience(
                    inputs = state.wizardInputs,
                    onUpdateInputs = onUpdateWizardInputs,
                    onBack = { onGoToStep(0) },
                    onNext = { onGoToStep(2) },
                    onSkipAiManual = onSkipAiManualSetup,
                )

                2 -> WizardStepPageSizeTone(
                    inputs = state.wizardInputs,
                    briefText = state.briefText,
                    isAnalyzing = state.isAnalyzingBrief,
                    onUpdateInputs = onUpdateWizardInputs,
                    onBack = { onGoToStep(1) },
                    onProposeWithAiCore = onProposeWithAiCore,
                    onSkipAiManual = onSkipAiManualSetup,
                )

                3 -> WizardStepReview(
                    state = state,
                    onBack = { onGoToStep(2) },
                    onReanalyzeWithAi = onProposeWithAiCore,
                    onUpdateProposed = onUpdateProposed,
                    onUpdateToggles = onUpdateToggles,
                    onSave = onSave,
                )
            }

            Spacer(Modifier.height(24.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WizardStepBrief(
    briefText: String,
    onBriefChange: (String) -> Unit,
    onNext: () -> Unit,
    onSkipAiManual: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("wizard_step_1_card"),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "What is this journal for?",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = "Describe your notebook in your own words. Your brief stays private on this device.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                value = briefText,
                onValueChange = onBriefChange,
                placeholder = {
                    Text("e.g., 3.25\" x 4.5\" pocket journal for daily reflections, or notes for a friend...")
                },
                minLines = 5,
                maxLines = 9,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("project_brief_input"),
            )

            Text(
                text = "Or load a sample brief:",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                OutlinedButton(
                    onClick = { onBriefChange(WIZARD_SAMPLE_SPENCER) },
                    modifier = Modifier.testTag("load_spencer_brief"),
                ) { Text("Mini friend journal") }
                OutlinedButton(
                    onClick = { onBriefChange(WIZARD_SAMPLE_DAILY) },
                    modifier = Modifier.testTag("load_daily_brief"),
                ) { Text("Daily reflection") }
                OutlinedButton(
                    onClick = { onBriefChange(WIZARD_SAMPLE_CREATIVE) },
                    modifier = Modifier.testTag("load_creative_brief"),
                ) { Text("Creative project log") }
            }

            Row(
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedButton(
                    onClick = onSkipAiManual,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("manual_setup_button"),
                ) {
                    Text("Set up manually")
                }
                Button(
                    onClick = onNext,
                    enabled = briefText.isNotBlank(),
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("wizard_next_step_1"),
                ) {
                    Text("Next: Cadence & Audience")
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WizardStepCadenceAudience(
    inputs: WizardSeedInputs,
    onUpdateInputs: ((WizardSeedInputs) -> WizardSeedInputs) -> Unit,
    onBack: () -> Unit,
    onNext: () -> Unit,
    onSkipAiManual: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("wizard_step_2_card"),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Cadence & Audience",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = "Optional—leave anything unset if you'd rather let AICore infer it from your brief or decide later.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Desired cadence", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = inputs.cadence == null,
                        onClick = { onUpdateInputs { it.copy(cadence = null) } },
                        label = { Text("Let brief decide / Unset") },
                    )
                    JournalCadence.entries.forEach { cadence ->
                        FilterChip(
                            selected = inputs.cadence == cadence,
                            onClick = { onUpdateInputs { it.copy(cadence = cadence) } },
                            label = { Text(cadence.displayName) },
                            modifier = Modifier.testTag("wizard_cadence_${cadence.name.lowercase()}"),
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Audience (optional)", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Myself", "A close friend", "A future reader").forEach { preset ->
                        FilterChip(
                            selected = inputs.audience.equals(preset, ignoreCase = true),
                            onClick = {
                                val next = if (inputs.audience.equals(preset, ignoreCase = true)) null else preset
                                onUpdateInputs { it.copy(audience = next) }
                            },
                            label = { Text(preset) },
                        )
                    }
                }
                OutlinedTextField(
                    value = inputs.audience.orEmpty(),
                    onValueChange = { v -> onUpdateInputs { it.copy(audience = v.ifBlank { null }) } },
                    label = { Text("Custom audience (leave blank if none)") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("wizard_audience_input"),
                )
            }

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedButton(onClick = onBack, modifier = Modifier.minimumInteractiveComponentSize()) {
                    Text("Back")
                }
                TextButton(onClick = onSkipAiManual, modifier = Modifier.minimumInteractiveComponentSize()) {
                    Text("Skip AI")
                }
                Button(
                    onClick = onNext,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("wizard_next_step_2"),
                ) {
                    Text("Next: Page Size & Tone")
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WizardStepPageSizeTone(
    inputs: WizardSeedInputs,
    briefText: String,
    isAnalyzing: Boolean,
    onUpdateInputs: ((WizardSeedInputs) -> WizardSeedInputs) -> Unit,
    onBack: () -> Unit,
    onProposeWithAiCore: () -> Unit,
    onSkipAiManual: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("wizard_step_3_card"),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Page Size & Tone",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = "Set your physical notebook size and preferred voice, or leave blank.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Physical page size (optional)", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("3.25\" × 4.5\"", "A6", "A5").forEach { sizePreset ->
                        FilterChip(
                            selected = inputs.pageSizeLabel == sizePreset,
                            onClick = {
                                val next = if (inputs.pageSizeLabel == sizePreset) null else sizePreset
                                val (lines, words) = StructuredOutputValidator.estimatePageGrid(next)
                                onUpdateInputs {
                                    it.copy(
                                        pageSizeLabel = next,
                                        linesPerPage = if (next != null) lines else null,
                                        wordsPerLine = if (next != null) words else null,
                                    )
                                }
                            },
                            label = { Text(sizePreset) },
                        )
                    }
                }
                OutlinedTextField(
                    value = inputs.pageSizeLabel.orEmpty(),
                    onValueChange = { v ->
                        val cleaned = v.ifBlank { null }
                        val (lines, words) = StructuredOutputValidator.estimatePageGrid(cleaned)
                        onUpdateInputs {
                            it.copy(
                                pageSizeLabel = cleaned,
                                linesPerPage = if (cleaned != null) (it.linesPerPage ?: lines) else null,
                                wordsPerLine = if (cleaned != null) (it.wordsPerLine ?: words) else null,
                            )
                        }
                    },
                    label = { Text("Custom page size (e.g., Pocket 3.5\" × 5.5\")") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("wizard_pagesize_input"),
                )
            }

            if (!inputs.pageSizeLabel.isNullOrBlank()) {
                val lines = inputs.linesPerPage ?: 14
                val words = inputs.wordsPerLine ?: 6
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
                    shape = MaterialTheme.shapes.medium,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Text(
                            text = "Handwriting estimate: ~${lines * words} words ($lines lines × $words words/line)",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Slider(
                            value = lines.toFloat(),
                            onValueChange = { v -> onUpdateInputs { it.copy(linesPerPage = v.roundToInt()) } },
                            valueRange = 8f..40f,
                        )
                        Slider(
                            value = words.toFloat(),
                            onValueChange = { v -> onUpdateInputs { it.copy(wordsPerLine = v.roundToInt()) } },
                            valueRange = 4f..14f,
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Tone preferences (optional)", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Warm & low-pressure", "Calm & observational", "Curious & concrete").forEach { tonePreset ->
                        FilterChip(
                            selected = inputs.tonePreferences.equals(tonePreset, ignoreCase = true),
                            onClick = {
                                val next = if (inputs.tonePreferences.equals(tonePreset, ignoreCase = true)) null else tonePreset
                                onUpdateInputs { it.copy(tonePreferences = next) }
                            },
                            label = { Text(tonePreset) },
                        )
                    }
                }
                OutlinedTextField(
                    value = inputs.tonePreferences.orEmpty(),
                    onValueChange = { v -> onUpdateInputs { it.copy(tonePreferences = v.ifBlank { null }) } },
                    label = { Text("Tone (e.g., gentle, grounded, unhurried)") },
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("wizard_tone_input"),
                )
            }

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                OutlinedButton(onClick = onBack, modifier = Modifier.minimumInteractiveComponentSize()) {
                    Text("Back")
                }
                OutlinedButton(
                    onClick = onSkipAiManual,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("wizard_step3_skip_ai"),
                ) {
                    Text("Skip AI & set up manually")
                }
                Button(
                    onClick = onProposeWithAiCore,
                    enabled = !isAnalyzing && briefText.isNotBlank(),
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("analyze_brief_button"),
                ) {
                    if (isAnalyzing) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(6.dp))
                    Text("Propose with AICore")
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WizardStepReview(
    state: ProjectEditorUiState,
    onBack: () -> Unit,
    onReanalyzeWithAi: () -> Unit,
    onUpdateProposed: ((ProposedProjectSetup) -> ProposedProjectSetup) -> Unit,
    onUpdateToggles: (
        includePastAnswers: Boolean?,
        showDateTime: Boolean?,
        showWeather: Boolean?,
        includeDateTimeInPrompt: Boolean?,
        includeWeatherInPrompt: Boolean?,
    ) -> Unit,
    onSave: () -> Unit,
) {
    val proposal = state.proposedSetup ?: ProposedProjectSetup()

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
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Review & Edit Proposal",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.semantics { heading() },
                )
                if (state.briefText.isNotBlank()) {
                    TextButton(onClick = onReanalyzeWithAi, enabled = !state.isAnalyzingBrief) {
                        Text("Re-run AICore")
                    }
                }
            }
            Text(
                text = if (proposal.usedAiCore) {
                    "Proposed on-device by AICore. Edit any field before saving."
                } else {
                    "Ready for review. Edit any field before saving—unknown fields remain unset."
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
                value = proposal.firstPrompt,
                onValueChange = { v -> onUpdateProposed { it.copy(firstPrompt = v) } },
                label = { Text("Initial Today prompt") },
                maxLines = 4,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("setup_first_prompt_input"),
            )

            OutlinedTextField(
                value = proposal.audience.orEmpty(),
                onValueChange = { v -> onUpdateProposed { it.copy(audience = v.ifBlank { null }) } },
                label = { Text("Audience (optional)") },
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
                label = { Text("Physical page size (optional)") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("setup_pagesize_input"),
            )

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
                label = { Text("Boundaries (optional — never shown on Desk Mode)") },
                maxLines = 3,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("setup_boundaries_input"),
            )
        }
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Desk Mode Cards & Privacy",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
            WizardToggleRow(
                title = "Use previous typed answers in future prompts",
                subtitle = "Off by default. Never guesses what was written on paper.",
                checked = state.includePastAnswersInPrompts,
                onCheckedChange = { onUpdateToggles(it, null, null, null, null) },
            )
            WizardToggleRow(
                title = "Show Date & Time card",
                subtitle = "Visible beside Today's prompt in Desk Mode",
                checked = state.showDateTimeCard,
                onCheckedChange = { onUpdateToggles(null, it, null, null, null) },
            )
            if (state.showDateTimeCard) {
                WizardToggleRow(
                    title = "Include Date & Time in today's prompt",
                    subtitle = "Off = supplementary display only",
                    checked = state.includeDateTimeInPrompt,
                    onCheckedChange = { onUpdateToggles(null, null, null, it, null) },
                )
            }
            WizardToggleRow(
                title = "Show Weather card",
                subtitle = "Visible beside Today's prompt in Desk Mode",
                checked = state.showWeatherCard,
                onCheckedChange = { onUpdateToggles(null, null, it, null, null) },
            )
            if (state.showWeatherCard) {
                WizardToggleRow(
                    title = "Include Weather in today's prompt",
                    subtitle = "Off = supplementary display only",
                    checked = state.includeWeatherInPrompt,
                    onCheckedChange = { onUpdateToggles(null, null, null, null, it) },
                )
            }
        }
    }

    Row(
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        OutlinedButton(
            onClick = onBack,
            modifier = Modifier.minimumInteractiveComponentSize(),
        ) {
            Text("Back")
        }
        Button(
            onClick = onSave,
            enabled = proposal.title.isNotBlank() || proposal.writingGoal.isNotBlank() || proposal.firstPrompt.isNotBlank(),
            modifier = Modifier
                .weight(1f)
                .minimumInteractiveComponentSize()
                .testTag("save_project_button"),
        ) {
            Icon(Icons.Outlined.Check, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("Save & open Today")
        }
    }
}

@Composable
private fun WizardToggleRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
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
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

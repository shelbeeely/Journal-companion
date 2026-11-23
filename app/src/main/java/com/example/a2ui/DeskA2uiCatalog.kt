package com.example.a2ui

import androidx.a2ui.compose.runtime.A2uiComponentProperties
import androidx.a2ui.compose.runtime.A2uiComponentScope
import androidx.a2ui.compose.runtime.A2uiComponentState
import androidx.a2ui.compose.runtime.A2uiProperty
import androidx.a2ui.compose.ui.A2uiCatalog
import androidx.a2ui.compose.ui.A2uiComponent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Timeline
import androidx.compose.material.icons.outlined.WbTwilight
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.material3.a2ui.catalog.MaterialA2uiBasicCatalogV1Defaults

object DeskA2uiCatalog {
    const val DESK_CATALOG_ID = "https://journalcompanion.local/catalogs/desk/v1/catalog.json"

    fun createDeskCatalog(): A2uiCatalog = A2uiCatalog(
        catalogId = DESK_CATALOG_ID,
        components = listOf(
            DeskColumnComponent,
            DeskIntentCardComponent,
            DeskStarterCardComponent,
            DeskThemePaceCardComponent,
            DeskAmbientWindowCardComponent,
            MaterialA2uiBasicCatalogV1Defaults.text,
            MaterialA2uiBasicCatalogV1Defaults.card,
            MaterialA2uiBasicCatalogV1Defaults.column,
            MaterialA2uiBasicCatalogV1Defaults.row,
            MaterialA2uiBasicCatalogV1Defaults.button,
        ),
    )

    fun allCatalogs(): List<A2uiCatalog> = listOf(
        createDeskCatalog(),
    )
}

object DeskColumnComponent : A2uiComponent {
    private val childrenProp = A2uiProperty.childList("children", required = true)
    private val spacingProp = A2uiProperty.string("spacingDp")

    override val name: String = "DeskColumn"
    override val description: String = "Vertical stack for Journal Companion proactive desk surface cards."
    override val properties: List<A2uiProperty<*>> = listOf(childrenProp, spacingProp)

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val refs = properties.bindChildReferences(childrenProp) ?: return
        val spacing = (properties[spacingProp]?.toIntOrNull() ?: 8).coerceIn(4, 24)

        Column(
            modifier = modifier
                .fillMaxWidth()
                .testTag("a2ui_desk_surface_root"),
            verticalArrangement = Arrangement.spacedBy(spacing.dp),
        ) {
            refs.forEach { ref ->
                key(ref.id, ref.baseDataPath) {
                    when (val childState = observeA2uiComponentState(id = ref.id)) {
                        is A2uiComponentState.Loading -> {
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceContainerLow,
                                shape = MaterialTheme.shapes.medium,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(44.dp),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 12.dp),
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                }
                            }
                        }
                        is A2uiComponentState.Error -> Unit
                        is A2uiComponentState.Success -> {
                            A2uiComponent(component = childState.component)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
object DeskIntentCardComponent : A2uiComponent {
    private val eyebrowProp = A2uiProperty.dynamicString("eyebrow", required = true)
    private val goalProp = A2uiProperty.dynamicString("goal", required = true)
    private val audienceProp = A2uiProperty.dynamicString("audience")
    private val toneProp = A2uiProperty.dynamicString("tone")
    private val boundariesProp = A2uiProperty.dynamicString("boundaries")
    private val briefHighlightsProp = A2uiProperty.dynamicString("briefHighlights")

    override val name: String = "DeskIntentCard"
    override val description: String = "Surfaces project writing goal, audience, tone, boundaries, and brief anchors."
    override val properties: List<A2uiProperty<*>> = listOf(
        eyebrowProp,
        goalProp,
        audienceProp,
        toneProp,
        boundariesProp,
        briefHighlightsProp,
    )

    @Composable
    override fun A2uiComponentScope.isReady(properties: A2uiComponentProperties): Boolean {
        return properties.bind(eyebrowProp) != null && properties.bind(goalProp) != null
    }

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val eyebrow = properties.bind(eyebrowProp).orEmpty()
        val goal = properties.bind(goalProp).orEmpty()
        val audience = properties.bind(audienceProp)?.takeIf { it.isNotBlank() }
        val tone = properties.bind(toneProp)?.takeIf { it.isNotBlank() }
        val boundaries = properties.bind(boundariesProp)?.takeIf { it.isNotBlank() }
        val briefHighlights = properties.bind(briefHighlightsProp)?.takeIf { it.isNotBlank() }
        var showFullBrief by rememberSaveable(briefHighlights) { mutableStateOf(false) }

        Card(
            modifier = modifier
                .fillMaxWidth()
                .testTag("a2ui_intent_card"),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Explore,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = eyebrow.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.semantics { heading() },
                        )
                    }
                    if (briefHighlights != null) {
                        Text(
                            text = if (showFullBrief) "Compact brief" else "Full brief",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier
                                .clickable { showFullBrief = !showFullBrief }
                                .padding(horizontal = 4.dp, vertical = 2.dp)
                                .testTag("a2ui_toggle_brief_anchor"),
                        )
                    }
                }

                if (goal.isNotBlank()) {
                    Text(
                        text = goal,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }

                if (audience != null || tone != null) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        audience?.let {
                            DeskMetaPill(label = "For: $it", testTag = "a2ui_audience_pill")
                        }
                        tone?.let {
                            DeskMetaPill(label = "Tone: $it", testTag = "a2ui_tone_pill")
                        }
                    }
                }

                boundaries?.let { b ->
                    Surface(
                        color = MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.48f),
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = "Guardrail: $b",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSecondaryContainer,
                            modifier = Modifier
                                .padding(horizontal = 8.dp, vertical = 5.dp)
                                .testTag("a2ui_boundaries_note"),
                        )
                    }
                }

                if (briefHighlights != null) {
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showFullBrief = !showFullBrief },
                    ) {
                        Text(
                            text = "Brief: $briefHighlights",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = if (showFullBrief) 12 else 2,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier
                                .padding(horizontal = 10.dp, vertical = 6.dp)
                                .testTag("a2ui_brief_excerpt"),
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
object DeskStarterCardComponent : A2uiComponent {
    private val eyebrowProp = A2uiProperty.dynamicString("eyebrow", required = true)
    private val starterTextProp = A2uiProperty.dynamicString("starterText")
    private val recallQuestionProp = A2uiProperty.dynamicString("recallQuestion")
    private val continuityTitleProp = A2uiProperty.dynamicString("continuityTitle", required = true)
    private val continuityBodyProp = A2uiProperty.dynamicString("continuityBody", required = true)
    private val interactiveProp = A2uiProperty.string("interactiveMode")
    private val useStarterActionProp = A2uiProperty.action("useStarterAction")
    private val nextAngleActionProp = A2uiProperty.action("nextAngleAction")
    private val startFocusActionProp = A2uiProperty.action("startFocusAction")

    override val name: String = "DeskStarterCard"
    override val description: String = "Surfaces ADHD-calm opening starter, recall cue, continuity excerpt, and quick actions."
    override val properties: List<A2uiProperty<*>> = listOf(
        eyebrowProp,
        starterTextProp,
        recallQuestionProp,
        continuityTitleProp,
        continuityBodyProp,
        interactiveProp,
        useStarterActionProp,
        nextAngleActionProp,
        startFocusActionProp,
    )

    @Composable
    override fun A2uiComponentScope.isReady(properties: A2uiComponentProperties): Boolean {
        return properties.bind(eyebrowProp) != null && properties.bind(continuityTitleProp) != null
    }

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val eyebrow = properties.bind(eyebrowProp).orEmpty()
        val starter = properties.bind(starterTextProp)?.takeIf { it.isNotBlank() }
        val recall = properties.bind(recallQuestionProp)?.takeIf { it.isNotBlank() }
        val continuityTitle = properties.bind(continuityTitleProp).orEmpty()
        val continuityBody = properties.bind(continuityBodyProp).orEmpty()
        val isInteractive = properties[interactiveProp]?.equals("true", ignoreCase = true) ?: true

        val useStarterAction by rememberUpdatedState(properties[useStarterActionProp])
        val nextAngleAction by rememberUpdatedState(properties[nextAngleActionProp])
        val startFocusAction by rememberUpdatedState(properties[startFocusActionProp])

        Card(
            modifier = modifier
                .fillMaxWidth()
                .testTag("a2ui_starter_card"),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.AutoAwesome,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = eyebrow.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.semantics { heading() },
                        )
                    }
                    if (isInteractive && nextAngleAction != null) {
                        TextButton(
                            onClick = { nextAngleAction?.let { dispatchAction(it) } },
                            modifier = Modifier
                                .minimumInteractiveComponentSize()
                                .testTag("a2ui_next_angle_button"),
                        ) {
                            Text("Another angle", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }

                starter?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.testTag("a2ui_starter_text"),
                    )
                }

                recall?.let {
                    Text(
                        text = "Recall cue: $it",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.52f),
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Text(
                            text = continuityTitle,
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = continuityBody,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                if (isInteractive && (useStarterAction != null || startFocusAction != null)) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (starter != null && useStarterAction != null) {
                            AssistChip(
                                onClick = { useStarterAction?.let { dispatchAction(it) } },
                                leadingIcon = {
                                    Icon(Icons.Outlined.EditNote, contentDescription = null, modifier = Modifier.size(16.dp))
                                },
                                label = { Text("Jot starter", style = MaterialTheme.typography.labelSmall) },
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("a2ui_use_starter_chip"),
                            )
                        }
                        if (startFocusAction != null) {
                            AssistChip(
                                onClick = { startFocusAction?.let { dispatchAction(it) } },
                                leadingIcon = {
                                    Icon(Icons.Outlined.Timer, contentDescription = null, modifier = Modifier.size(16.dp))
                                },
                                label = { Text("10m sprint", style = MaterialTheme.typography.labelSmall) },
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("a2ui_start_focus_chip"),
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
object DeskThemePaceCardComponent : A2uiComponent {
    private val sessionTitleProp = A2uiProperty.dynamicString("sessionTitle", required = true)
    private val cadenceSummaryProp = A2uiProperty.dynamicString("cadenceSummary", required = true)
    private val pageEstimateProp = A2uiProperty.dynamicString("pageEstimateSummary")
    private val draftProgressProp = A2uiProperty.dynamicString("draftProgressLabel")
    private val progressFractionProp = A2uiProperty.dynamicString("progressFraction")
    private val untappedCsvProp = A2uiProperty.dynamicString("untappedThemesCsv")
    private val coveredCsvProp = A2uiProperty.dynamicString("coveredThemesCsv")

    override val name: String = "DeskThemePace"
    override val description: String = "Surfaces covered vs unexplored notebook themes and handwriting pace estimate."
    override val properties: List<A2uiProperty<*>> = listOf(
        sessionTitleProp,
        cadenceSummaryProp,
        pageEstimateProp,
        draftProgressProp,
        progressFractionProp,
        untappedCsvProp,
        coveredCsvProp,
    )

    @Composable
    override fun A2uiComponentScope.isReady(properties: A2uiComponentProperties): Boolean {
        return properties.bind(sessionTitleProp) != null && properties.bind(cadenceSummaryProp) != null
    }

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val sessionTitle = properties.bind(sessionTitleProp).orEmpty()
        val cadenceSummary = properties.bind(cadenceSummaryProp).orEmpty()
        val pageEstimate = properties.bind(pageEstimateProp)?.takeIf { it.isNotBlank() }
        val draftProgress = properties.bind(draftProgressProp)?.takeIf { it.isNotBlank() }
        val progress = (properties.bind(progressFractionProp)?.toFloatOrNull() ?: 0f).coerceIn(0f, 1f)
        val untapped = properties.bind(untappedCsvProp).orEmpty().split("|").map { it.trim() }.filter { it.isNotBlank() }
        val covered = properties.bind(coveredCsvProp).orEmpty().split("|").map { it.trim() }.filter { it.isNotBlank() }

        Card(
            modifier = modifier
                .fillMaxWidth()
                .testTag("a2ui_theme_pace_card"),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
        ) {
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Timeline,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            text = "THEMES & PACING",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.semantics { heading() },
                        )
                    }
                    Text(
                        text = sessionTitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Text(
                    text = cadenceSummary,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                pageEstimate?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (draftProgress != null && progress > 0f) {
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(4.dp),
                    )
                    Text(
                        text = draftProgress,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (untapped.isNotEmpty() || covered.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        untapped.take(3).forEach { theme ->
                            Surface(
                                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.65f),
                                shape = MaterialTheme.shapes.small,
                            ) {
                                Text(
                                    text = "Next: $theme",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                                )
                            }
                        }
                        covered.take(2).forEach { theme ->
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = MaterialTheme.shapes.small,
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.CheckCircle,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(11.dp),
                                    )
                                    Spacer(Modifier.width(3.dp))
                                    Text(
                                        text = theme,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

object DeskAmbientWindowCardComponent : A2uiComponent {
    private val dayWindowProp = A2uiProperty.dynamicString("dayWindow", required = true)
    private val ambientDetailProp = A2uiProperty.dynamicString("ambientDetail", required = true)
    private val engineBadgeProp = A2uiProperty.dynamicString("engineBadge")
    private val interactiveProp = A2uiProperty.string("interactiveMode")
    private val refreshActionProp = A2uiProperty.action("refreshAction")
    private val dismissActionProp = A2uiProperty.action("dismissAction")

    override val name: String = "DeskAmbientWindow"
    override val description: String = "Surfaces day-part writing window, daylight/weather cue, and calm refresh/quiet controls."
    override val properties: List<A2uiProperty<*>> = listOf(
        dayWindowProp,
        ambientDetailProp,
        engineBadgeProp,
        interactiveProp,
        refreshActionProp,
        dismissActionProp,
    )

    @Composable
    override fun A2uiComponentScope.isReady(properties: A2uiComponentProperties): Boolean {
        return properties.bind(dayWindowProp) != null && properties.bind(ambientDetailProp) != null
    }

    @Composable
    override fun A2uiComponentScope.Content(
        properties: A2uiComponentProperties,
        modifier: Modifier,
    ) {
        val dayWindow = properties.bind(dayWindowProp).orEmpty()
        val ambientDetail = properties.bind(ambientDetailProp).orEmpty()
        val engineBadge = properties.bind(engineBadgeProp)?.takeIf { it.isNotBlank() }
        val isInteractive = properties[interactiveProp]?.equals("true", ignoreCase = true) ?: true

        val refreshAction by rememberUpdatedState(properties[refreshActionProp])
        val dismissAction by rememberUpdatedState(properties[dismissActionProp])

        Card(
            modifier = modifier
                .fillMaxWidth()
                .testTag("a2ui_ambient_window_card"),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.WbTwilight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(14.dp),
                        )
                        Spacer(Modifier.width(5.dp))
                        Text(
                            text = dayWindow,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        engineBadge?.let { badge ->
                            Spacer(Modifier.width(6.dp))
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = MaterialTheme.shapes.small,
                            ) {
                                Text(
                                    text = badge,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
                                )
                            }
                        }
                    }
                    Text(
                        text = ambientDetail,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                if (isInteractive) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (refreshAction != null) {
                            IconButton(
                                onClick = { refreshAction?.let { dispatchAction(it) } },
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("a2ui_refresh_button"),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Refresh,
                                    contentDescription = "Refresh A2UI desk surface",
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                        if (dismissAction != null) {
                            IconButton(
                                onClick = { dismissAction?.let { dispatchAction(it) } },
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("a2ui_dismiss_button"),
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Close,
                                    contentDescription = "Quiet companion cues for this window",
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DeskMetaPill(label: String, testTag: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.testTag(testTag),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

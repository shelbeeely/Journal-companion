package com.example.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Compress
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.example.model.DraftSuggestion
import com.example.model.SuggestionKind

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DigitalDraftPanel(
    draftText: String,
    estimatedWordsPerPage: Int?,
    canUndo: Boolean,
    isAssisting: Boolean,
    pendingSuggestion: DraftSuggestion?,
    editableSuggestionText: String,
    onDraftChange: (String) -> Unit,
    onUndo: () -> Unit,
    onHelpMeStart: () -> Unit,
    onTightenDraft: () -> Unit,
    onEditableSuggestionChange: (String) -> Unit,
    onAcceptSuggestionReplace: () -> Unit,
    onAcceptSuggestionInsert: () -> Unit,
    onDismissSuggestion: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val wordCount = draftText.trim().split(Regex("\\s+")).count { it.isNotBlank() }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.55f)),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = "Optional digital note or draft",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                val countLabel = if (estimatedWordsPerPage != null) {
                    "$wordCount / ~$estimatedWordsPerPage words est."
                } else {
                    "$wordCount words"
                }
                Text(
                    text = countLabel,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(10.dp))

            OutlinedTextField(
                value = draftText,
                onValueChange = onDraftChange,
                placeholder = {
                    Text("Optional: sketch an answer or key phrases here (never required for paper mode)")
                },
                minLines = 3,
                maxLines = 8,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("digital_draft_input"),
            )

            Spacer(Modifier.height(10.dp))

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = onHelpMeStart,
                    enabled = !isAssisting,
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("help_me_start_button"),
                ) {
                    if (isAssisting) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                    Spacer(Modifier.width(6.dp))
                    Text("Help me start")
                }

                OutlinedButton(
                    onClick = onTightenDraft,
                    enabled = !isAssisting && draftText.isNotBlank(),
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("tighten_draft_button"),
                ) {
                    Icon(Icons.Outlined.Compress, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Tighten my draft")
                }

                if (canUndo) {
                    TextButton(
                        onClick = onUndo,
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("undo_draft_button"),
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.Undo,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text("Undo")
                    }
                }
            }

            AnimatedVisibility(visible = pendingSuggestion != null) {
                pendingSuggestion?.let { suggestion ->
                    Spacer(Modifier.height(12.dp))
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.38f),
                        ),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("editable_suggestion_card"),
                    ) {
                        Column(modifier = Modifier.padding(14.dp)) {
                            val title = when (suggestion.kind) {
                                SuggestionKind.HELP_START -> "Editable opening suggestion"
                                SuggestionKind.TIGHTEN_DRAFT -> "Editable tightened draft"
                            }
                            Text(
                                text = title,
                                style = MaterialTheme.typography.titleSmall,
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = "Edit freely below. Your draft only changes when you accept.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = editableSuggestionText,
                                onValueChange = onEditableSuggestionChange,
                                minLines = 2,
                                maxLines = 6,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag("editable_suggestion_input"),
                            )
                            Spacer(Modifier.height(8.dp))
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Button(
                                    onClick = onAcceptSuggestionReplace,
                                    modifier = Modifier
                                        .minimumInteractiveComponentSize()
                                        .testTag("accept_replace_suggestion_button"),
                                ) {
                                    Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Accept & Replace")
                                }
                                if (draftText.isNotBlank() && suggestion.kind == SuggestionKind.HELP_START) {
                                    OutlinedButton(
                                        onClick = onAcceptSuggestionInsert,
                                        modifier = Modifier
                                            .minimumInteractiveComponentSize()
                                            .testTag("accept_insert_suggestion_button"),
                                    ) {
                                        Text("Insert below")
                                    }
                                }
                                TextButton(
                                    onClick = onDismissSuggestion,
                                    modifier = Modifier
                                        .minimumInteractiveComponentSize()
                                        .testTag("dismiss_suggestion_button"),
                                ) {
                                    Icon(Icons.Outlined.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Dismiss")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

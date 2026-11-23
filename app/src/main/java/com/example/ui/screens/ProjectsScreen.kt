package com.example.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
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
import com.example.model.JournalProject

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProjectsScreen(
    projects: List<JournalProject>,
    activeProjectId: Long?,
    onSelectProject: (Long) -> Unit,
    onCreateProject: () -> Unit,
    onEditProject: (JournalProject) -> Unit,
    onDeleteProject: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    var projectPendingDelete by remember { mutableStateOf<JournalProject?>(null) }

    Box(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .widthIn(max = 720.dp)
                .align(Alignment.TopCenter),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = "Journal Projects",
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        text = "Your briefs, notes, and prompts stay strictly on this device.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (projects.isEmpty()) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Column(
                            modifier = Modifier.padding(24.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text(
                                text = "No journal projects yet",
                                style = MaterialTheme.typography.titleLarge,
                            )
                            Text(
                                text = "Start by pasting a brief in your own words, or set up a notebook manually.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Button(
                                onClick = onCreateProject,
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("projects_empty_create_button"),
                            ) {
                                Icon(Icons.Outlined.Add, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("New project")
                            }
                        }
                    }
                }
            } else {
                items(projects, key = { it.id }) { project ->
                    val isActive = project.id == activeProjectId
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (isActive) {
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.25f)
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerLowest
                            },
                        ),
                        border = BorderStroke(
                            width = if (isActive) 1.5.dp else 1.dp,
                            color = if (isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onSelectProject(project.id) }
                            .testTag("project_card_${project.id}"),
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    modifier = Modifier.weight(1f),
                                ) {
                                    Text(
                                        text = project.title,
                                        style = MaterialTheme.typography.titleLarge,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    if (isActive) {
                                        Surface(
                                            color = MaterialTheme.colorScheme.primaryContainer,
                                            shape = MaterialTheme.shapes.small,
                                        ) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Outlined.CheckCircle,
                                                    contentDescription = "Active project",
                                                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                                    modifier = Modifier.size(13.dp),
                                                )
                                                Spacer(Modifier.width(4.dp))
                                                Text(
                                                    text = "Active",
                                                    style = MaterialTheme.typography.labelSmall,
                                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                                )
                                            }
                                        }
                                    }
                                }

                                Row {
                                    IconButton(
                                        onClick = { onEditProject(project) },
                                        modifier = Modifier
                                            .minimumInteractiveComponentSize()
                                            .testTag("edit_project_${project.id}"),
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.Edit,
                                            contentDescription = "Edit ${project.title}",
                                        )
                                    }
                                    IconButton(
                                        onClick = { projectPendingDelete = project },
                                        modifier = Modifier
                                            .minimumInteractiveComponentSize()
                                            .testTag("delete_project_${project.id}"),
                                    ) {
                                        Icon(
                                            imageVector = Icons.Outlined.DeleteOutline,
                                            contentDescription = "Delete ${project.title}",
                                        )
                                    }
                                }
                            }

                            Text(
                                text = project.writingGoal,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                            )

                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp),
                            ) {
                                project.cadence?.let { cadence ->
                                    AssistChip(onClick = {}, label = { Text(cadence.displayName) })
                                }
                                project.pageSizeLabel?.let { size ->
                                    val words = project.estimatedWordsPerPage?.let { " (~$it w)" }.orEmpty()
                                    AssistChip(onClick = {}, label = { Text("$size$words") })
                                }
                                project.audience?.let { aud ->
                                    AssistChip(onClick = {}, label = { Text("For: $aud") })
                                }
                            }

                            if (!isActive) {
                                OutlinedButton(
                                    onClick = { onSelectProject(project.id) },
                                    modifier = Modifier.minimumInteractiveComponentSize(),
                                ) {
                                    Text("Open in Today")
                                }
                            }
                        }
                    }
                }
            }
        }

        FloatingActionButton(
            onClick = onCreateProject,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(20.dp)
                .testTag("fab_new_project"),
        ) {
            Icon(Icons.Outlined.Add, contentDescription = "New journal project")
        }
    }

    projectPendingDelete?.let { target ->
        AlertDialog(
            onDismissRequest = { projectPendingDelete = null },
            title = { Text("Delete \"${target.title}\"?") },
            text = {
                Text("This permanently deletes the local brief, prompt history, and saved notes for this project from your device.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        onDeleteProject(target.id)
                        projectPendingDelete = null
                    },
                    modifier = Modifier.testTag("confirm_delete_project"),
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { projectPendingDelete = null }) {
                    Text("Cancel")
                }
            },
        )
    }
}

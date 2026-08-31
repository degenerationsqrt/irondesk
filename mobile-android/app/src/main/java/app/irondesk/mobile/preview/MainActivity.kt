package app.irondesk.mobile.preview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.irondesk.mobile.preview.workout.AndroidKeystoreCodec
import app.irondesk.mobile.preview.workout.AppendResult
import app.irondesk.mobile.preview.workout.JournalLoad
import app.irondesk.mobile.preview.workout.SessionFinished
import app.irondesk.mobile.preview.workout.SessionStarted
import app.irondesk.mobile.preview.workout.SetLogged
import app.irondesk.mobile.preview.workout.WorkoutJournal
import app.irondesk.mobile.preview.workout.WorkoutStatus
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            IronDeskPreviewTheme {
                val journal = remember {
                    WorkoutJournal(
                        file = File(filesDir, "mobile-preview/workout-journal.v1"),
                        codec = AndroidKeystoreCodec("irondesk-mobile-preview-workout-v1"),
                    )
                }
                MobilePreview(journal)
            }
        }
    }
}

@Composable
private fun MobilePreview(journal: WorkoutJournal) {
    var loaded by remember { mutableStateOf<JournalLoad?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(journal) {
        loaded = withContext(Dispatchers.IO) { journal.load() }
    }

    fun append(event: app.irondesk.mobile.preview.workout.WorkoutEvent) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                val (result, next) = withContext(Dispatchers.IO) {
                    journal.append(event) to journal.load()
                }
                message = when (result) {
                    AppendResult.APPENDED -> "Saved locally before the screen advanced."
                    AppendResult.DUPLICATE -> "That mutation was already saved; no duplicate was created."
                    AppendResult.CONFLICT -> "That mutation ID was reused with different data; nothing was changed."
                    AppendResult.INVALID -> "This event is not valid for the current workout."
                    AppendResult.CORRUPT -> "The journal is unreadable. It was not overwritten."
                    AppendResult.ENCRYPTION_FAILED -> "Android could not encrypt this event; nothing was saved."
                    AppendResult.TOO_LARGE -> "The local journal reached its safety limit; nothing was saved."
                    AppendResult.STORAGE_FAILED -> "Android could not safely commit this event; nothing was advanced."
                }
                loaded = next
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                message = "The local commit failed safely; nothing was advanced."
                loaded = withContext(Dispatchers.IO) { journal.load() }
            } finally {
                busy = false
            }
        }
    }

    fun resetPreview() {
        if (busy) return
        busy = true
        scope.launch {
            try {
                val (cleared, next) = withContext(Dispatchers.IO) {
                    val result = journal.clear()
                    result to journal.load()
                }
                message = if (cleared) {
                    "The sample-only preview journal was reset."
                } else {
                    "The preview journal could not be reset."
                }
                loaded = next
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                message = "The preview journal could not be reset."
                loaded = withContext(Dispatchers.IO) { journal.load() }
            } finally {
                busy = false
            }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Text("IRONDESK", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
            Text(
                "NATIVE MOBILE FOUNDATION",
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.labelLarge,
            )
            Text(
                "INTERNAL PREVIEW · SAMPLE DATA ONLY",
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.labelMedium,
            )
        }

        item {
            PreviewCard("Safety boundary") {
                Text("No WebView. No remote page. No network permission. No release build.")
                Text("Backend authority remains ${BuildConfig.BACKEND_SYSTEM}; auth and sync are intentionally blocked.")
            }
        }

        when (val current = loaded) {
            null -> item {
                PreviewCard("Restoring workout") {
                    Text("Opening the encrypted local journal…")
                }
            }

            JournalLoad.Empty -> item {
                PreviewCard("Offline workout proof") {
                    Text("Load a sample workout, log sets, close the app, and reopen it. The journal restores from an encrypted atomic file.")
                    Button(
                        onClick = {
                            val sessionId = "sample-session-v1"
                            append(
                                SessionStarted(
                                    eventId = "$sessionId:start",
                                    sessionId = sessionId,
                                    occurredAtEpochMillis = System.currentTimeMillis(),
                                    title = "Sample Lower Strength",
                                ),
                            )
                        },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Load sample workout") }
                }
            }

            is JournalLoad.Corrupt -> item {
                PreviewCard("Journal protected") {
                    Text(current.reason, color = MaterialTheme.colorScheme.error)
                    Text("IronDesk did not treat this as an empty workout or overwrite it.")
                    OutlinedButton(
                        onClick = { resetPreview() },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Reset sample preview") }
                }
            }

            is JournalLoad.Unavailable -> item {
                PreviewCard("Journal temporarily unavailable") {
                    Text(current.reason, color = MaterialTheme.colorScheme.error)
                    Text("No workout data was changed. Reopen the preview to try again.")
                }
            }

            is JournalLoad.Ready -> {
                val workout = current.snapshot
                item {
                    PreviewCard(workout.title) {
                        Text(
                            if (workout.status == WorkoutStatus.ACTIVE) "ACTIVE OFFLINE" else "FINISHED OFFLINE",
                            color = if (workout.status == WorkoutStatus.ACTIVE) {
                                MaterialTheme.colorScheme.secondary
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                            fontWeight = FontWeight.Bold,
                        )
                        Text("${workout.sets.size} set(s) · ${workout.pendingMutationIds.size} mutation(s) awaiting a future sync adapter")
                        if (workout.status == WorkoutStatus.ACTIVE) {
                            val next = workout.sets.size + 1
                            Button(
                                onClick = {
                                    append(
                                        SetLogged(
                                            eventId = UUID.randomUUID().toString(),
                                            sessionId = workout.sessionId,
                                            occurredAtEpochMillis = System.currentTimeMillis(),
                                            exerciseId = "sample-back-squat",
                                            exerciseName = "Back Squat",
                                            setNumber = next,
                                            weightKg = 60.0 + ((next - 1) * 2.5),
                                            reps = 5,
                                            rpe = 7.0 + ((next - 1).coerceAtMost(4) * 0.5),
                                        ),
                                    )
                                },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("Log sample set $next") }
                            OutlinedButton(
                                onClick = {
                                    append(
                                        SessionFinished(
                                            eventId = UUID.randomUUID().toString(),
                                            sessionId = workout.sessionId,
                                            occurredAtEpochMillis = System.currentTimeMillis(),
                                        ),
                                    )
                                },
                                enabled = workout.sets.isNotEmpty() && !busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("Finish sample workout") }
                        }
                        OutlinedButton(
                            onClick = { resetPreview() },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Reset sample preview") }
                    }
                }

                if (workout.sets.isNotEmpty()) {
                    item { Text("Saved sets", style = MaterialTheme.typography.titleMedium) }
                    items(workout.sets, key = { it.mutationId }) { set ->
                        PreviewCard("${set.exerciseName} · set ${set.setNumber}") {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${"%.1f".format(set.weightKg)} kg")
                                Text("${set.reps} reps")
                                Text("RPE ${"%.1f".format(set.rpe)}")
                            }
                        }
                    }
                }
            }
        }

        message?.let { result ->
            item { Text(result, color = MaterialTheme.colorScheme.secondary) }
        }

        if (busy) {
            item { Text("Committing encrypted sample data…", color = MaterialTheme.colorScheme.primary) }
        }

        item {
            PreviewCard("Release remains blocked") {
                ReleasePolicy.blockedGates.forEachIndexed { index, gate ->
                    Text("${index + 1}. $gate", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun PreviewCard(title: String, content: @Composable () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            content()
            Spacer(Modifier.height(1.dp))
        }
    }
}

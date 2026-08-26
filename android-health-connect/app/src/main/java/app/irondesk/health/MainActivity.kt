package app.irondesk.health

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Single-screen exporter: grant permission, choose a range and record types,
 * preview the counts, then write the file through the system picker.
 *
 * The manifest declares no INTERNET permission, so this app cannot transmit
 * health data even if some future code tried to.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repository = HealthRepository(this)
        setContent {
            MaterialTheme {
                Surface { ExportScreen(repository) }
            }
        }
    }
}

@Composable
private fun ExportScreen(repository: HealthRepository) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var days by remember { mutableStateOf(90) }
    var selection by remember { mutableStateOf(Selection()) }
    var snapshot by remember { mutableStateOf<HealthSnapshot?>(null) }
    var payload by remember { mutableStateOf<String?>(null) }
    var status by remember {
        mutableStateOf(
            if (repository.available) "" else "Health Connect is not available on this device.",
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        status = if (granted.containsAll(repository.permissions)) {
            "Permission granted for every record type."
        } else {
            "Some record types were declined — those will be empty in the export."
        }
    }

    val saveLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri: Uri? ->
        val body = payload
        if (uri == null || body == null) {
            status = "Export cancelled — nothing was written."
            return@rememberLauncherForActivityResult
        }
        scope.launch {
            status = try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { stream ->
                        stream.write(body.toByteArray(Charsets.UTF_8))
                    } ?: error("The chosen location could not be opened.")
                }
                "Export written. Upload it in IronDesk under Connections & Imports."
            } catch (error: Exception) {
                "Export failed: ${error.message ?: "unknown error"}"
            }
        }
    }

    Column(
        modifier = Modifier.fillMaxWidth().padding(20.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("IronDesk Health Export", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Reads only the record types you approve, writes a JSON file you choose, and never uploads anything.",
            style = MaterialTheme.typography.bodyMedium,
        )

        Button(onClick = { permissionLauncher.launch(repository.permissions) }, enabled = repository.available) {
            Text("Grant Health Connect access")
        }

        Text("Range: last $days days", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(7, 30, 90, 365).forEach { option ->
                Button(onClick = { days = option }) { Text("$option d") }
            }
        }

        Text("Record types", style = MaterialTheme.typography.titleSmall)
        Toggle("Steps", selection.steps) { selection = selection.copy(steps = it) }
        Toggle("Sleep", selection.sleep) { selection = selection.copy(sleep = it) }
        Toggle("Resting heart rate", selection.restingHr) { selection = selection.copy(restingHr = it) }
        Toggle("HRV", selection.hrv) { selection = selection.copy(hrv = it) }
        Toggle("Weight", selection.weight) { selection = selection.copy(weight = it) }
        Toggle("Active calories", selection.activeCalories) { selection = selection.copy(activeCalories = it) }
        Toggle("Distance", selection.distance) { selection = selection.copy(distance = it) }
        Toggle("Workouts", selection.sessions) { selection = selection.copy(sessions = it) }

        Button(
            enabled = repository.available,
            onClick = {
                scope.launch {
                    status = "Reading Health Connect…"
                    try {
                        val to = Instant.now().truncatedTo(ChronoUnit.SECONDS)
                        val from = LocalDate.now().minusDays(days.toLong())
                            .atStartOfDay(ZoneId.systemDefault()).toInstant()
                        val collected = repository.collect(selection, from, to)
                        snapshot = collected
                        payload = ExportBuilder.build(collected)
                        status = "Found ${collected.total} records. Review the counts, then export."
                    } catch (error: Exception) {
                        snapshot = null
                        payload = null
                        status = "Read failed: ${error.message ?: "unknown error"}"
                    }
                }
            },
        ) { Text("Preview") }

        snapshot?.counts()?.forEach { (label, count) ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text("$count", style = MaterialTheme.typography.bodyMedium)
            }
        }

        Button(
            enabled = (snapshot?.total ?: 0) > 0 && payload != null,
            onClick = { saveLauncher.launch("irondesk-health-${LocalDate.now()}.json") },
        ) { Text("Export JSON") }

        if (status.isNotEmpty()) Text(status, style = MaterialTheme.typography.bodySmall)

        Text(
            "Revoke access any time in Settings → Health Connect → App permissions. Uninstalling this app removes every copy it holds.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun Toggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

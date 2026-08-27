package app.irondesk.health

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.text.DateFormat
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.Date

/**
 * The whole companion, as one screen per state: pair → grant → preview → sync.
 *
 * Every read and every upload is user-initiated. There is no background work in
 * this build; the only persistence is the device token and an outbox of payloads
 * whose upload failed.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { IronDeskTheme { Surface(color = IronDesk.Background) { CompanionApp() } } }
    }
}

private const val PLAY_HEALTH_CONNECT =
    "market://details?id=com.google.android.apps.healthdata"

@Composable
private fun CompanionApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val health = remember { HealthRepository(context) }
    val vault = remember { TokenVault.onDevice(context) }
    // Queued payloads are health data, so they are encrypted at rest with the
    // same AndroidKeyStore key as the token.
    val queue = remember {
        SyncQueue(File(context.filesDir, "sync-queue"), codec = KeystoreCodec(TokenVault.KEY_ALIAS))
    }
    val client = remember { SyncClient() }

    var paired by remember { mutableStateOf(vault.paired) }
    var granted by remember { mutableStateOf(false) }
    var historyGranted by remember { mutableStateOf(false) }
    var range by remember { mutableStateOf(RangeOption.MONTH) }
    var selection by remember { mutableStateOf(Selection()) }
    var snapshot by remember { mutableStateOf<HealthSnapshot?>(null) }
    var summary by remember { mutableStateOf<PreviewSummary?>(null) }
    var payload by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var queued by remember { mutableStateOf(queue.size) }

    suspend fun refreshPermissions() {
        val granted0 = health.grantedPermissions()
        granted = health.permissions.all { granted0.contains(it) }
        // Never treat history as authorized when the provider cannot serve it.
        historyGranted = health.historySupported && granted0.contains(health.historyPermission)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { scope.launch { refreshPermissions() } }

    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri: Uri? ->
        val body = payload
        if (uri != null && body != null) {
            runCatching {
                context.contentResolver.openOutputStream(uri)?.use { it.write(body.toByteArray()) }
            }.onSuccess { status = "Saved the export file. Upload it under Connections & Imports in IronDesk." }
                .onFailure { error = "Could not write the file: ${it.message}" }
        }
    }

    // First composition: read the current grant state without asking for anything.
    LaunchedEffect(Unit) { refreshPermissions() }

    // Permissions can be changed in Health Connect settings while this app is
    // backgrounded, so the grant state is re-read on every return to foreground.
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) scope.launch { refreshPermissions() }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun prepare() {
        scope.launch {
            busy = true; error = null; status = null
            try {
                val zone = ZoneId.systemDefault()
                val effectiveDays = range.effectiveDays(historyGranted)
                val to = Instant.now()
                val from = to.minus(Duration.ofDays(effectiveDays.toLong()))
                val read = withContext(Dispatchers.IO) { health.collect(selection, from, to, zone) }
                val (metrics, activities) = HealthMapper.map(read, zone)
                snapshot = read
                summary = PreviewSummary.of(effectiveDays, metrics, activities)
                payload = PayloadBuilder.build(
                    SyncPayload(
                        metrics = metrics,
                        activities = activities,
                        deviceLabel = vault.label,
                        rangeDays = effectiveDays,
                        historyAuthorized = historyGranted,
                    ),
                )
                status = if (effectiveDays < range.days) {
                    "Read the last $effectiveDays days. Health Connect only shares older data with historical access."
                } else {
                    "Ready: ${read.total} records from the last $effectiveDays days."
                }
            } catch (t: Throwable) {
                error = t.message ?: "Could not read Health Connect."
            } finally {
                busy = false
            }
        }
    }

    fun sync() {
        val token = vault.token ?: return
        val body = payload ?: return
        scope.launch {
            busy = true; error = null; status = null
            try {
                // Drain anything a previous failure left behind, oldest first.
                var replayed = 0
                withContext(Dispatchers.IO) {
                    queue.entries().forEach { entry ->
                        // An unreadable blob can never be sent; drop it instead of retrying forever.
                        val queuedBody = entry.read()
                        if (queuedBody == null) {
                            queue.remove(entry)
                            return@forEach
                        }
                        runCatching { client.sync(token, queuedBody) }
                            .onSuccess { queue.remove(entry); replayed++ }
                            .onFailure { failure ->
                                if (failure is SyncClient.SyncException) queue.remove(entry) else throw failure
                            }
                    }
                }
                val result = withContext(Dispatchers.IO) { client.sync(token, body) }
                vault.markSynced()
                queued = queue.size
                status = "Synced ${result.describe()}" + if (replayed > 0) " Also sent $replayed queued batch(es)." else ""
            } catch (transient: SyncClient.TransientException) {
                withContext(Dispatchers.IO) { queue.enqueue(body) }
                queued = queue.size
                error = "${transient.message} Kept this batch in the outbox — press Sync Now again when you're online."
            } catch (t: Throwable) {
                error = t.message ?: "The sync failed."
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(IronDesk.Background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 22.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Header()

        when (health.availability) {
            HealthRepository.Availability.UNAVAILABLE -> AvailabilityCard(
                title = "Health Connect not found",
                body = "Install Health Connect from Google Play, then open Samsung Health (or your tracker) and turn on " +
                    "sharing to Health Connect. Reopen IronDesk Health afterwards.",
                actionLabel = "Get Health Connect",
                onAction = { context.openUri(PLAY_HEALTH_CONNECT) },
            )
            HealthRepository.Availability.UPDATE_REQUIRED -> AvailabilityCard(
                title = "Health Connect needs updating",
                body = "Your Health Connect provider is older than this app supports. Update it and reopen this screen.",
                actionLabel = "Update",
                onAction = { context.openUri(PLAY_HEALTH_CONNECT) },
            )
            HealthRepository.Availability.AVAILABLE -> Unit
        }

        if (!paired) {
            PairingCard(busy = busy) { code, name ->
                scope.launch {
                    busy = true; error = null; status = null
                    try {
                        val pairing = withContext(Dispatchers.IO) { client.pair(code, name) }
                        vault.save(pairing.token, pairing.label ?: name, pairing.deviceId)
                        paired = true
                        status = "Paired as “${vault.label}”. Grant Health Connect access next."
                    } catch (t: Throwable) {
                        error = t.message ?: "Pairing failed."
                    } finally {
                        busy = false
                    }
                }
            }
        } else {
            LinkedDeviceCard(
                label = vault.label ?: "This phone",
                pairedAt = vault.pairedAt,
                lastSyncAt = vault.lastSyncAt,
                queued = queued,
                busy = busy,
                onUnlink = {
                    scope.launch {
                        busy = true; error = null; status = null
                        val token = vault.token
                        try {
                            // The token is cleared only for a confirmed revocation
                            // (or a confirmed already-revoked 401). Anything else
                            // keeps it, so the link can be retried.
                            val outcome = if (token == null) {
                                SyncClient.UnpairOutcome.ALREADY_REVOKED
                            } else {
                                withContext(Dispatchers.IO) { client.unpair(token) }
                            }
                            vault.clear(); queue.clear(); queued = 0
                            paired = false; payload = null; snapshot = null; summary = null
                            status = when (outcome) {
                                SyncClient.UnpairOutcome.REVOKED_NOW ->
                                    "Device unlinked. IronDesk will no longer accept data from this phone."
                                SyncClient.UnpairOutcome.ALREADY_REVOKED ->
                                    "This device was already revoked in IronDesk. Local token cleared."
                            }
                        } catch (transient: SyncClient.TransientException) {
                            error = "${transient.message} The device is still linked — retry when you're online, " +
                                "or use “Forget locally only” to clear this phone."
                        } catch (t: Throwable) {
                            error = "${t.message ?: "The unlink failed."} The device is still linked here — retry, " +
                                "or use “Forget locally only” to clear this phone."
                        } finally {
                            busy = false
                        }
                    }
                },
                onForgetLocally = {
                    vault.clear(); queue.clear(); queued = 0
                    paired = false; payload = null; snapshot = null; summary = null
                    status = "Cleared this phone. The link still exists in IronDesk until you remove it there."
                },
            )

            SectionCard("Health Connect access") {
                Text(
                    if (granted) "Read access granted for the eight record types IronDesk uses."
                    else "IronDesk needs read-only access to steps, sleep, resting heart rate, HRV, weight, active " +
                        "calories, distance and workouts. Nothing is written back.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (granted) IronDesk.Green else IronDesk.Muted,
                )
                Button(
                    onClick = { permissionLauncher.launch(health.permissions) },
                    enabled = health.available && !busy,
                    modifier = Modifier.fillMaxWidth().semantics {
                        contentDescription = "Request read-only Health Connect permissions"
                    },
                ) { Text(if (granted) "Review permissions" else "Grant read access") }
                OutlinedButton(
                    onClick = {
                        runCatching {
                            context.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
                        }.onFailure { error = "Health Connect settings could not be opened on this device." }
                    },
                    enabled = health.available,
                    modifier = Modifier.fillMaxWidth().semantics {
                        contentDescription = "Open Health Connect settings to manage IronDesk access"
                    },
                ) { Text("Manage Health Connect access") }
                TextButton(onClick = {
                    context.startActivity(Intent(context, PrivacyActivity::class.java))
                }) { Text("What is read and where it goes") }
            }

            SectionCard("Range") {
                // Scrolls instead of clipping on narrow phones.
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                ) {
                    RangeOption.entries.forEach { option ->
                        FilterChip(
                            selected = range == option,
                            onClick = { range = option; payload = null; snapshot = null },
                            label = { Text(option.label) },
                            modifier = Modifier.semantics { contentDescription = "Read the last ${option.days} days" },
                        )
                    }
                }
                if (range.needsHistory) {
                    when {
                        !health.historySupported -> Text(
                            "This phone's Health Connect version cannot share data older than " +
                                "${HealthRepository.HISTORY_FREE_DAYS} days, so this range is unavailable — the read " +
                                "will cover ${HealthRepository.HISTORY_FREE_DAYS} days. Update Health Connect to " +
                                "unlock longer history.",
                            style = MaterialTheme.typography.bodySmall,
                            color = IronDesk.Amber,
                        )
                        historyGranted -> Text(
                            "Historical access granted — the full ${range.days} days can be read.",
                            style = MaterialTheme.typography.bodySmall,
                            color = IronDesk.Green,
                        )
                        else -> {
                            Text(
                                "Health Connect limits apps to the last ${HealthRepository.HISTORY_FREE_DAYS} days " +
                                    "without historical access. Without it, this range reads " +
                                    "${HealthRepository.HISTORY_FREE_DAYS} days — not ${range.days}.",
                                style = MaterialTheme.typography.bodySmall,
                                color = IronDesk.Amber,
                            )
                            OutlinedButton(
                                // Only launched when the provider reports the feature as available.
                                onClick = { permissionLauncher.launch(setOf(health.historyPermission)) },
                                enabled = health.available && !busy,
                            ) { Text("Allow historical access") }
                        }
                    }
                }
                RecordToggles(selection) { selection = it; payload = null; snapshot = null }
                Button(
                    onClick = { prepare() },
                    enabled = granted && !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Preview data") }
            }

            snapshot?.let { read ->
                SectionCard("Preview") {
                    summary?.let { totals ->
                        Text(
                            "Last ${totals.days} days",
                            style = MaterialTheme.typography.titleSmall,
                            color = IronDesk.Muted,
                        )
                        MetricGrid(
                            buildList {
                                add("Steps" to "%,d".format(java.util.Locale.ROOT, totals.steps))
                                add("Sleep" to "%.0f h".format(java.util.Locale.ROOT, totals.sleepHours))
                                add("Workouts" to totals.workouts.toString())
                                add("Active kcal" to "%,d".format(java.util.Locale.ROOT, totals.activeCalories))
                                if (totals.distanceKm > 0) {
                                    add("Distance" to "%.1f km".format(java.util.Locale.ROOT, totals.distanceKm))
                                }
                            },
                        )
                        HorizontalDivider(color = IronDesk.Border)
                    }
                    read.counts().filter { it.second > 0 }.forEach { (label, count) ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(label, style = MaterialTheme.typography.bodyMedium, color = IronDesk.Muted)
                            Text("$count", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (read.total == 0) {
                        Text(
                            "No records in this range. Check that your tracker app is syncing into Health Connect.",
                            style = MaterialTheme.typography.bodySmall,
                            color = IronDesk.Amber,
                        )
                    }
                    Text(
                        "Sleep, HRV, resting HR and weight only fill days you haven't logged by hand. IronDesk never " +
                            "overwrites a manual entry.",
                        style = MaterialTheme.typography.bodySmall,
                        color = IronDesk.Muted,
                    )
                    Button(
                        onClick = { sync() },
                        enabled = !busy && read.total > 0 && vault.paired,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Sync now") }
                    OutlinedButton(
                        onClick = { exportLauncher.launch("irondesk-health-${Instant.now().epochSecond}.json") },
                        enabled = !busy && payload != null,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Export JSON file instead") }
                }
            }
        }

        if (busy) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(18.dp))
                Text("Working…", style = MaterialTheme.typography.bodySmall, color = IronDesk.Muted)
            }
        }
        status?.let { Banner(it, IronDesk.Green) }
        error?.let { Banner(it, IronDesk.Red) }
        Spacer(Modifier.height(20.dp))
    }
}

/* ------------------------------- components -------------------------------- */

@Composable
private fun Header() {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("IRONDESK", style = MaterialTheme.typography.displaySmall, color = IronDesk.Text)
        Text(
            "HEALTH CONNECT COMPANION",
            style = MaterialTheme.typography.titleSmall,
            color = IronDesk.Blue,
        )
    }
}

@Composable
private fun SectionCard(title: String, content: ColumnContent) {
    Surface(
        color = IronDesk.Surface,
        shape = RoundedCornerShape(IronDesk.CardRadius),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.titleSmall, color = IronDesk.Muted)
            content()
        }
    }
}

private typealias ColumnContent = @Composable () -> Unit

@Composable
private fun Metric(label: String, value: String) {
    Column {
        Text(value, style = MaterialTheme.typography.headlineSmall, color = IronDesk.Text)
        Text(label.uppercase(), style = MaterialTheme.typography.titleSmall, color = IronDesk.Muted)
    }
}

/** Two columns per row so five metrics fit a narrow phone instead of clipping. */
@Composable
private fun MetricGrid(items: List<Pair<String, String>>) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
        items.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                row.forEach { (label, value) ->
                    Box(Modifier.weight(1f)) { Metric(label, value) }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Banner(message: String, accent: Color) {
    Surface(color = IronDesk.SurfaceHigh, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.height(18.dp).background(accent, RoundedCornerShape(2.dp)).semantics {
                contentDescription = "status indicator"
            }) { Text(" ", fontSize = 12.sp) }
            Text(message, style = MaterialTheme.typography.bodyMedium, color = accent)
        }
    }
}

@Composable
private fun AvailabilityCard(title: String, body: String, actionLabel: String, onAction: () -> Unit) {
    SectionCard(title) {
        Text(body, style = MaterialTheme.typography.bodyMedium, color = IronDesk.Amber)
        OutlinedButton(onClick = onAction, modifier = Modifier.fillMaxWidth()) { Text(actionLabel) }
    }
}

@Composable
private fun PairingCard(busy: Boolean, onPair: (String, String) -> Unit) {
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("${Build.MANUFACTURER} ${Build.MODEL}".trim()) }
    val codeError = if (code.isEmpty()) null else PairingCode.validate(code)
    val nameError = DeviceName.validate(name)

    SectionCard("Pair with IronDesk") {
        Text(
            "In IronDesk, open Connections & Imports and generate a pairing code. It is single-use and expires.",
            style = MaterialTheme.typography.bodyMedium,
            color = IronDesk.Muted,
        )
        OutlinedTextField(
            value = PairingCode.pretty(code),
            onValueChange = { code = PairingCode.normalize(it) },
            label = { Text("Pairing code") },
            supportingText = { Text(codeError ?: "8 characters, letters and digits") },
            isError = codeError != null,
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Pairing code from IronDesk" },
        )
        OutlinedTextField(
            value = name,
            onValueChange = { name = DeviceName.normalize(it) },
            label = { Text("Device name") },
            supportingText = { Text(nameError ?: "Shown in IronDesk under linked devices") },
            isError = nameError != null,
            singleLine = true,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Name for this phone" },
        )
        Button(
            onClick = { onPair(code, name) },
            enabled = !busy && PairingCode.isValid(code) && nameError == null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Pair this phone") }
    }
}

@Composable
private fun LinkedDeviceCard(
    label: String,
    pairedAt: Long,
    lastSyncAt: Long,
    queued: Int,
    busy: Boolean,
    onUnlink: () -> Unit,
    onForgetLocally: () -> Unit,
) {
    var confirming by remember { mutableStateOf(false) }
    SectionCard("Linked device") {
        Text(label, style = MaterialTheme.typography.headlineSmall, color = IronDesk.Text)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Paired", color = IronDesk.Muted, style = MaterialTheme.typography.bodySmall)
            Text(formatTime(pairedAt), style = MaterialTheme.typography.bodySmall)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Last sync", color = IronDesk.Muted, style = MaterialTheme.typography.bodySmall)
            Text(formatTime(lastSyncAt), style = MaterialTheme.typography.bodySmall)
        }
        if (queued > 0) {
            Text(
                "$queued batch(es) waiting in the outbox — they upload on the next sync.",
                style = MaterialTheme.typography.bodySmall,
                color = IronDesk.Amber,
            )
        }
        if (!confirming) {
            OutlinedButton(
                onClick = { confirming = true },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Unlink this device") }
        } else {
            Text(
                "Unlinking revokes the token in IronDesk. Already-imported data stays in your account.",
                style = MaterialTheme.typography.bodySmall,
                color = IronDesk.Muted,
                textAlign = TextAlign.Start,
            )
            Button(
                onClick = { confirming = false; onUnlink() },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = IronDesk.Red, contentColor = Color.Black),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Confirm unlink") }
            TextButton(onClick = { confirming = false; onForgetLocally() }) { Text("Forget locally only") }
            TextButton(onClick = { confirming = false }) { Text("Cancel") }
        }
    }
}

@Composable
private fun RecordToggles(selection: Selection, onChange: (Selection) -> Unit) {
    val rows = listOf<Triple<String, Boolean, (Boolean) -> Selection>>(
        Triple("Steps", selection.steps) { selection.copy(steps = it) },
        Triple("Sleep", selection.sleep) { selection.copy(sleep = it) },
        Triple("Resting HR", selection.restingHr) { selection.copy(restingHr = it) },
        Triple("HRV", selection.hrv) { selection.copy(hrv = it) },
        Triple("Weight", selection.weight) { selection.copy(weight = it) },
        Triple("Active calories", selection.activeCalories) { selection.copy(activeCalories = it) },
        Triple("Distance", selection.distance) { selection.copy(distance = it) },
        Triple("Workouts", selection.sessions) { selection.copy(sessions = it) },
    )
    Column {
        rows.forEach { (label, checked, apply) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = checked,
                    onCheckedChange = { onChange(apply(it)) },
                    modifier = Modifier.semantics { contentDescription = "Include $label" },
                )
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

private fun formatTime(millis: Long): String =
    if (millis <= 0L) "Never" else DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(millis))

private fun android.content.Context.openUri(uri: String) {
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri))) }
}

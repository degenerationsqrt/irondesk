package app.irondesk.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import kotlin.reflect.KClass

/**
 * Read-only Health Connect access.
 *
 * Nothing here uploads or transmits data: records are read into memory, handed to
 * [ExportBuilder], and written to a file the user chooses.
 */
class HealthRepository(context: Context) {

    private val client: HealthConnectClient? =
        if (HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE) {
            HealthConnectClient.getOrCreate(context)
        } else {
            null
        }

    val available: Boolean get() = client != null

    /** Exactly the record types the export needs — no broader scope is requested. */
    val permissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    suspend fun grantedPermissions(): Set<String> =
        client?.permissionController?.getGrantedPermissions() ?: emptySet()

    private suspend fun <T : Record> read(type: KClass<T>, from: Instant, to: Instant): List<T> {
        val session = client ?: return emptyList()
        val page = session.readRecords(
            ReadRecordsRequest(recordType = type, timeRangeFilter = TimeRangeFilter.between(from, to)),
        )
        return page.records
    }

    /** Reads every selected type for the range. Types the user did not grant come back empty. */
    suspend fun collect(selection: Selection, from: Instant, to: Instant): HealthSnapshot = HealthSnapshot(
        steps = if (selection.steps) read(StepsRecord::class, from, to) else emptyList(),
        sleep = if (selection.sleep) read(SleepSessionRecord::class, from, to) else emptyList(),
        restingHr = if (selection.restingHr) read(RestingHeartRateRecord::class, from, to) else emptyList(),
        hrv = if (selection.hrv) read(HeartRateVariabilityRmssdRecord::class, from, to) else emptyList(),
        weight = if (selection.weight) read(WeightRecord::class, from, to) else emptyList(),
        activeCalories = if (selection.activeCalories) read(ActiveCaloriesBurnedRecord::class, from, to) else emptyList(),
        distance = if (selection.distance) read(DistanceRecord::class, from, to) else emptyList(),
        sessions = if (selection.sessions) read(ExerciseSessionRecord::class, from, to) else emptyList(),
    )
}

data class Selection(
    val steps: Boolean = true,
    val sleep: Boolean = true,
    val restingHr: Boolean = true,
    val hrv: Boolean = true,
    val weight: Boolean = true,
    val activeCalories: Boolean = true,
    val distance: Boolean = false,
    val sessions: Boolean = true,
)

data class HealthSnapshot(
    val steps: List<StepsRecord>,
    val sleep: List<SleepSessionRecord>,
    val restingHr: List<RestingHeartRateRecord>,
    val hrv: List<HeartRateVariabilityRmssdRecord>,
    val weight: List<WeightRecord>,
    val activeCalories: List<ActiveCaloriesBurnedRecord>,
    val distance: List<DistanceRecord>,
    val sessions: List<ExerciseSessionRecord>,
) {
    /** Per-type counts shown in the UI before the user commits to an export. */
    fun counts(): List<Pair<String, Int>> = listOf(
        "Steps" to steps.size,
        "Sleep" to sleep.size,
        "Resting HR" to restingHr.size,
        "HRV" to hrv.size,
        "Weight" to weight.size,
        "Active calories" to activeCalories.size,
        "Distance" to distance.size,
        "Workouts" to sessions.size,
    )

    val total: Int
        get() = counts().sumOf { it.second }
}

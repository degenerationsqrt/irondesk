package app.irondesk.health

import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

data class IronDeskWorkout(
    val id: String,
    val title: String,
    val kind: String,
    val start: Instant,
    val end: Instant,
    val version: Long,
    val notes: String?,
) {
    init {
        require(UUID.fromString(id).toString() == id) { "Invalid IronDesk workout ID." }
        require(end > start) { "Workout finish must be after its start." }
        require(version > 0) { "Invalid workout version." }
    }

    fun toRecord(): ExerciseSessionRecord = ExerciseSessionRecord(
        startTime = start,
        startZoneOffset = null, // Source stores instants, not the athlete's original zone.
        endTime = end,
        endZoneOffset = null,
        exerciseType = when (kind) {
            "strength" -> ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING
            "mobility" -> ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING
            else -> ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT
        },
        title = title.take(200),
        notes = listOfNotNull("Completed in IronDesk.", notes?.takeIf { it.isNotBlank() }?.take(2000)).joinToString("\n"),
        metadata = Metadata.manualEntry(clientRecordId = "irondesk:workout:$id", clientRecordVersion = version),
    )

    companion object {
        fun fromJson(row: JSONObject) = IronDeskWorkout(
            id = row.getString("id"),
            title = row.getString("title"),
            kind = row.getString("kind"),
            start = Instant.parse(row.getString("start_time")),
            end = Instant.parse(row.getString("end_time")),
            version = row.getLong("client_record_version"),
            notes = if (row.isNull("notes")) null else row.getString("notes"),
        )

        /** Don't re-import our exports as new external activities. */
        fun isOwnExport(metadata: Metadata): Boolean =
            isOwnExport(metadata.dataOrigin.packageName, metadata.clientRecordId)

        internal fun isOwnExport(packageName: String, clientRecordId: String?): Boolean =
            packageName in setOf("app.irondesk.health", "app.irondesk.health.debug") &&
                clientRecordId?.startsWith("irondesk:workout:") == true
    }
}

data class WorkoutExportPreview(val workouts: List<IronDeskWorkout>, val skipped: Int)

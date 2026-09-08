package app.irondesk.health

import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WorkoutExportTest {
    private val workout = IronDeskWorkout(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Upper body", "strength",
        Instant.parse("2026-09-07T17:00:00Z"), Instant.parse("2026-09-07T18:00:00Z"), 1788804000000, "Felt strong",
    )

    @Test fun mapsActualSessionTimesAndManualProvenance() {
        val record = workout.toRecord()
        assertEquals(workout.start, record.startTime)
        assertEquals(workout.end, record.endTime)
        assertNull(record.startZoneOffset)
        assertEquals(ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, record.exerciseType)
        assertEquals(Metadata.RECORDING_METHOD_MANUAL_ENTRY, record.metadata.recordingMethod)
        assertTrue(record.notes!!.contains("Felt strong"))
    }

    @Test fun retriesAndEditsHaveTheSameClientIdentity() {
        val first = workout.toRecord().metadata
        val retry = workout.toRecord().metadata
        val update = workout.copy(title = "Corrected", version = workout.version + 1).toRecord().metadata
        assertEquals(first.clientRecordId, retry.clientRecordId)
        assertEquals(first.clientRecordVersion, retry.clientRecordVersion)
        assertEquals(first.clientRecordId, update.clientRecordId)
        assertTrue(update.clientRecordVersion > first.clientRecordVersion)
    }

    @Test fun genericCardioAndConditioningDoNotInventASpecificSport() {
        for (kind in listOf("cardio", "conditioning", "unknown")) {
            assertEquals(ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT, workout.copy(kind = kind).toRecord().exerciseType)
        }
    }

    @Test fun separateWorkoutIdsDoNotCollide() {
        val other = workout.copy(id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
        assertNotEquals(workout.toRecord().metadata.clientRecordId, other.toRecord().metadata.clientRecordId)
    }

    @Test(expected = IllegalArgumentException::class) fun invalidTimingIsRejected() {
        workout.copy(end = workout.start)
    }

    @Test fun roundTripFilterRequiresOurPackageAndOurClientId() {
        val id = "irondesk:workout:${workout.id}"
        assertTrue(IronDeskWorkout.isOwnExport("app.irondesk.health.debug", id))
        assertTrue(IronDeskWorkout.isOwnExport("app.irondesk.health", id))
        assertFalse(IronDeskWorkout.isOwnExport("com.samsung.android.app.health", id))
        assertFalse(IronDeskWorkout.isOwnExport("app.irondesk.health", null))
    }
}

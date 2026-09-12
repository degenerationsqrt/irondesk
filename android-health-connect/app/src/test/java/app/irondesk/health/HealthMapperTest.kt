package app.irondesk.health

import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.units.Energy
import androidx.health.connect.client.units.Length
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class HealthMapperTest {
    @Test fun `daily metrics ending inside a workout are not reported as workout totals`() {
        val morning = Instant.parse("2026-09-07T00:00:00Z")
        val start = Instant.parse("2026-09-07T17:00:00Z")
        val during = Instant.parse("2026-09-07T17:30:00Z")
        val end = Instant.parse("2026-09-07T18:00:00Z")
        val snapshot = HealthSnapshot(
            steps = emptyList(), sleep = emptyList(), restingHr = emptyList(),
            hrv = emptyList(), weight = emptyList(),
            activeCalories = listOf(ActiveCaloriesBurnedRecord(
                startTime = morning, startZoneOffset = null, endTime = during, endZoneOffset = null,
                energy = Energy.kilocalories(900.0), metadata = Metadata.manualEntry(),
            )),
            distance = listOf(DistanceRecord(
                startTime = morning, startZoneOffset = null, endTime = during, endZoneOffset = null,
                distance = Length.meters(10000.0), metadata = Metadata.manualEntry(),
            )),
            sessions = listOf(ExerciseSessionRecord(
                startTime = start, startZoneOffset = null, endTime = end, endZoneOffset = null,
                exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
                metadata = Metadata.manualEntry(), title = "Strength session",
            )),
        )
        val (metrics, activities) = HealthMapper.map(snapshot, ZoneOffset.UTC)
        assertEquals(2, metrics.size)
        assertEquals(900.0, metrics.single { it.metric == "active_calories" }.value, 0.0)
        assertEquals(10000.0, metrics.single { it.metric == "distance" }.value, 0.0)
        val workout = activities.single()
        assertEquals(3600L, workout.durationSec)
        assertNull(workout.calories)
        assertNull(workout.distanceM)
    }
}

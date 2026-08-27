package app.irondesk.health

import androidx.health.connect.client.records.ExerciseSessionRecord
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Guards the mapping against the numeric ids that used to be hard-coded: every
 * expectation is written against the official connect-client constant.
 */
class ExerciseTypesTest {

    @Test fun `maps the exercise types IronDesk cares about`() {
        val expected = mapOf(
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING to "running",
            ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL to "treadmill_running",
            ExerciseSessionRecord.EXERCISE_TYPE_WALKING to "walking",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING to "biking",
            ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY to "stationary_biking",
            ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING to "strength_training",
            ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING to "weightlifting",
            ExerciseSessionRecord.EXERCISE_TYPE_ROWING to "rowing",
            ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE to "rowing_machine",
            ExerciseSessionRecord.EXERCISE_TYPE_HIKING to "hiking",
            ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL to "elliptical",
            ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL to "pool_swimming",
            ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER to "open_water_swimming",
            ExerciseSessionRecord.EXERCISE_TYPE_SOCCER to "soccer",
            ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING to "stair_climbing",
            ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE to "stair_climbing_machine",
        )
        expected.forEach { (code, label) -> assertEquals(label, ExerciseTypes.label(code)) }
    }

    @Test fun `unknown types fall back to other`() {
        assertEquals("other", ExerciseTypes.label(Int.MAX_VALUE))
        assertEquals("other", ExerciseTypes.label(-1))
    }
}

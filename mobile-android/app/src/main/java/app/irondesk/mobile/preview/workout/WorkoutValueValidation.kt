package app.irondesk.mobile.preview.workout

import kotlin.math.abs
import kotlin.math.round

/** Mirrors the web and Supabase workout-set contract for the native preview. */
object WorkoutValueValidation {
    const val MIN_RPE = 1.0
    const val MAX_RPE = 10.0
    const val RPE_STEP = 0.5
    const val MIN_REPS = 0
    const val MAX_REPS = 500
    const val MIN_WEIGHT_KG = 0.0
    const val MAX_WEIGHT_KG = 1_000.0

    fun isValidRpe(value: Double?): Boolean {
        if (value == null) return true
        if (!value.isFinite() || value !in MIN_RPE..MAX_RPE) return false
        val steps = value / RPE_STEP
        return abs(steps - round(steps)) <= 1e-9
    }

    fun isValidReps(value: Int): Boolean = value in MIN_REPS..MAX_REPS

    fun isValidWeightKg(value: Double): Boolean =
        value.isFinite() && value in MIN_WEIGHT_KG..MAX_WEIGHT_KG
}

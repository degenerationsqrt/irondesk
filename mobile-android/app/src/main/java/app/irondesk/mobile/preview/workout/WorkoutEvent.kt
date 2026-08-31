package app.irondesk.mobile.preview.workout

/**
 * Durable client events for one active workout. Every event has a stable client
 * mutation id so a UI retry or later Supabase replay cannot create a duplicate.
 */
sealed interface WorkoutEvent {
    val eventId: String
    val sessionId: String
    val occurredAtEpochMillis: Long
}

data class SessionStarted(
    override val eventId: String,
    override val sessionId: String,
    override val occurredAtEpochMillis: Long,
    val title: String,
) : WorkoutEvent

data class SetLogged(
    override val eventId: String,
    override val sessionId: String,
    override val occurredAtEpochMillis: Long,
    val exerciseId: String,
    val exerciseName: String,
    val setNumber: Int,
    val weightKg: Double,
    val reps: Int,
    val rpe: Double,
) : WorkoutEvent

data class SessionFinished(
    override val eventId: String,
    override val sessionId: String,
    override val occurredAtEpochMillis: Long,
) : WorkoutEvent

enum class WorkoutStatus { ACTIVE, FINISHED }

data class LoggedSet(
    val mutationId: String,
    val exerciseId: String,
    val exerciseName: String,
    val setNumber: Int,
    val weightKg: Double,
    val reps: Int,
    val rpe: Double,
    val loggedAtEpochMillis: Long,
)

data class WorkoutSnapshot(
    val sessionId: String,
    val title: String,
    val startedAtEpochMillis: Long,
    val status: WorkoutStatus,
    val finishedAtEpochMillis: Long?,
    val sets: List<LoggedSet>,
    val pendingMutationIds: Set<String>,
)

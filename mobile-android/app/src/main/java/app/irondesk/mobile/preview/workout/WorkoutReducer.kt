package app.irondesk.mobile.preview.workout

/** Pure reducer used by both restore and mutation validation. */
object WorkoutReducer {
    fun reduce(events: List<WorkoutEvent>): WorkoutSnapshot? {
        if (events.isEmpty()) return null

        val seen = linkedMapOf<String, WorkoutEvent>()
        var snapshot: WorkoutSnapshot? = null

        events.forEach { event ->
            require(event.eventId.isNotBlank()) { "event id is required" }
            require(event.sessionId.isNotBlank()) { "session id is required" }
            require(event.occurredAtEpochMillis >= 0) { "event time is invalid" }

            // Only an exact replay is idempotent. Reusing a mutation ID with a
            // different payload is a conflict and must fail closed.
            seen[event.eventId]?.let { existing ->
                require(existing == event) { "mutation id was reused with different data" }
                return@forEach
            }
            seen[event.eventId] = event

            snapshot = when (event) {
                is SessionStarted -> {
                    require(snapshot == null) { "a journal can contain only one session" }
                    require(event.title.isNotBlank()) { "workout title is required" }
                    WorkoutSnapshot(
                        sessionId = event.sessionId,
                        title = event.title.trim(),
                        startedAtEpochMillis = event.occurredAtEpochMillis,
                        status = WorkoutStatus.ACTIVE,
                        finishedAtEpochMillis = null,
                        sets = emptyList(),
                        pendingMutationIds = linkedSetOf(event.eventId),
                    )
                }

                is SetLogged -> {
                    val current = requireNotNull(snapshot) { "a set cannot precede session start" }
                    require(current.sessionId == event.sessionId) { "set belongs to a different session" }
                    require(current.status == WorkoutStatus.ACTIVE) { "a finished session cannot accept sets" }
                    require(event.exerciseId.isNotBlank()) { "exercise id is required" }
                    require(event.exerciseName.isNotBlank()) { "exercise name is required" }
                    require(event.setNumber > 0) { "set number must be positive" }
                    require(event.weightKg.isFinite() && event.weightKg >= 0) { "weight is invalid" }
                    require(event.reps > 0) { "reps must be positive" }
                    require(event.rpe.isFinite() && event.rpe in 0.0..10.0) { "RPE must be 0 through 10" }
                    current.copy(
                        sets = current.sets + LoggedSet(
                            mutationId = event.eventId,
                            exerciseId = event.exerciseId,
                            exerciseName = event.exerciseName.trim(),
                            setNumber = event.setNumber,
                            weightKg = event.weightKg,
                            reps = event.reps,
                            rpe = event.rpe,
                            loggedAtEpochMillis = event.occurredAtEpochMillis,
                        ),
                        pendingMutationIds = current.pendingMutationIds + event.eventId,
                    )
                }

                is SessionFinished -> {
                    val current = requireNotNull(snapshot) { "finish cannot precede session start" }
                    require(current.sessionId == event.sessionId) { "finish belongs to a different session" }
                    require(current.status == WorkoutStatus.ACTIVE) { "session is already finished" }
                    current.copy(
                        status = WorkoutStatus.FINISHED,
                        finishedAtEpochMillis = event.occurredAtEpochMillis,
                        pendingMutationIds = current.pendingMutationIds + event.eventId,
                    )
                }
            }
        }

        return snapshot
    }
}

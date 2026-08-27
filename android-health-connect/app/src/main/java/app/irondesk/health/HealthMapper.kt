package app.irondesk.health

import androidx.health.connect.client.records.metadata.Metadata
import java.time.Duration
import java.time.Instant
import java.time.ZoneId

/**
 * Turns Health Connect records into the wire model.
 *
 * Steps come pre-aggregated per calendar day (see [StepAggregator]); everything
 * else is one record per source record with a deterministic `hc:` id. Exercise
 * sessions are enriched with the distance and active calories that fall inside
 * the session window, which is the only enrichment possible without asking for
 * broader permissions.
 */
object HealthMapper {

    fun map(
        snapshot: HealthSnapshot,
        zone: ZoneId = ZoneId.systemDefault(),
    ): Pair<List<MetricPoint>, List<ActivityPoint>> {
        val metrics = mutableListOf<MetricPoint>()

        metrics += StepAggregator.points(snapshot.steps, zone)
        snapshot.sleep.forEach {
            val minutes = Duration.between(it.startTime, it.endTime).toMinutes().toDouble()
            metrics += point(it.metadata, "hc:sleep", "sleep_minutes", it.endTime, minutes, "min", zone)
        }
        snapshot.restingHr.forEach {
            metrics += point(it.metadata, "hc:rhr", "resting_heart_rate", it.time, it.beatsPerMinute.toDouble(), "bpm", zone)
        }
        snapshot.hrv.forEach {
            metrics += point(it.metadata, "hc:hrv", "hrv", it.time, it.heartRateVariabilityMillis, "ms", zone)
        }
        snapshot.weight.forEach {
            metrics += point(it.metadata, "hc:weight", "weight", it.time, it.weight.inKilograms, "kg", zone)
        }
        snapshot.activeCalories.forEach {
            metrics += point(it.metadata, "hc:kcal", "active_calories", it.endTime, it.energy.inKilocalories, "kcal", zone)
        }
        snapshot.distance.forEach {
            metrics += point(it.metadata, "hc:dist", "distance", it.endTime, it.distance.inMeters, "m", zone)
        }

        val activities = snapshot.sessions.map { session ->
            val type = ExerciseTypes.label(session.exerciseType)
            ActivityPoint(
                externalId = "hc:sess:${session.metadata.id}",
                activityType = type,
                name = session.title ?: type.replace('_', ' '),
                startTime = session.startTime.toString(),
                durationSec = Duration.between(session.startTime, session.endTime).seconds,
                distanceM = sumWithin(session.startTime, session.endTime, snapshot.distance.map { it.endTime to it.distance.inMeters }),
                calories = sumWithin(session.startTime, session.endTime, snapshot.activeCalories.map { it.endTime to it.energy.inKilocalories })
                    ?.let { kotlin.math.round(it) },
                notes = session.notes,
                timezone = (session.startZoneOffset?.id ?: zone.id),
                source = provenance(session.metadata),
            )
        }

        return metrics to activities
    }

    private fun point(
        metadata: Metadata,
        prefix: String,
        metric: String,
        at: Instant,
        value: Double,
        unit: String,
        zone: ZoneId,
    ) = MetricPoint(
        externalId = "$prefix:${metadata.id}",
        metric = metric,
        timestamp = at.toString(),
        value = value,
        unit = unit,
        timezone = zone.id,
        source = provenance(metadata),
    )

    /** Only the provenance Health Connect actually supplies; blanks stay null. */
    fun provenance(metadata: Metadata): SourceMeta = SourceMeta(
        packageName = metadata.dataOrigin.packageName.takeIf { it.isNotBlank() },
        manufacturer = metadata.device?.manufacturer?.takeIf { it.isNotBlank() },
        model = metadata.device?.model?.takeIf { it.isNotBlank() },
        recordingMethod = ExerciseTypes.recordingMethod(metadata.recordingMethod),
    )

    private fun sumWithin(from: Instant, to: Instant, points: List<Pair<Instant, Double>>): Double? {
        val inside = points.filter { !it.first.isBefore(from) && !it.first.isAfter(to) }
        return if (inside.isEmpty()) null else inside.sumOf { it.second }
    }
}

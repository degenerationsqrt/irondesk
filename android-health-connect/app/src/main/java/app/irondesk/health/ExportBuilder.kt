package app.irondesk.health

import android.util.JsonWriter
import java.io.StringWriter
import java.time.Duration
import java.time.Instant

/**
 * Builds the JSON export IronDesk's Health Connect importer reads directly.
 *
 * `external_id` values are deterministic per record so an overlapping re-export
 * imports zero duplicates — IronDesk dedupes on `ext:health_connect:<id>`.
 */
object ExportBuilder {

    fun build(snapshot: HealthSnapshot, exportedAt: Instant = Instant.now()): String {
        val out = StringWriter()
        JsonWriter(out).use { json ->
            json.setIndent("  ")
            json.beginObject()
            json.name("source").value("irondesk-health-connect")
            json.name("version").value(1L)
            json.name("exportedAt").value(exportedAt.toString())

            json.name("records").beginArray()
            snapshot.steps.forEach {
                metric(json, "hc:steps:${it.metadata.id}", "steps", it.endTime, it.count.toDouble(), "count")
            }
            snapshot.sleep.forEach {
                val minutes = Duration.between(it.startTime, it.endTime).toMinutes().toDouble()
                metric(json, "hc:sleep:${it.metadata.id}", "sleep_minutes", it.endTime, minutes, "min")
            }
            snapshot.restingHr.forEach {
                metric(json, "hc:rhr:${it.metadata.id}", "resting_heart_rate", it.time, it.beatsPerMinute.toDouble(), "bpm")
            }
            snapshot.hrv.forEach {
                metric(json, "hc:hrv:${it.metadata.id}", "hrv", it.time, it.heartRateVariabilityMillis, "ms")
            }
            snapshot.weight.forEach {
                metric(json, "hc:weight:${it.metadata.id}", "weight", it.time, it.weight.inKilograms, "kg")
            }
            snapshot.activeCalories.forEach {
                metric(json, "hc:kcal:${it.metadata.id}", "active_calories", it.endTime, it.energy.inKilocalories, "kcal")
            }
            snapshot.distance.forEach {
                metric(json, "hc:dist:${it.metadata.id}", "distance", it.endTime, it.distance.inMeters, "m")
            }
            json.endArray()

            json.name("activities").beginArray()
            snapshot.sessions.forEach { session ->
                json.beginObject()
                json.name("external_id").value("hc:sess:${session.metadata.id}")
                json.name("activity_type").value(activityType(session.exerciseType))
                json.name("name").value(session.title ?: activityType(session.exerciseType))
                json.name("start_time").value(session.startTime.toString())
                json.name("duration_sec")
                    .value(Duration.between(session.startTime, session.endTime).seconds)
                session.notes?.let { json.name("notes").value(it) }
                json.endObject()
            }
            json.endArray()

            json.endObject()
        }
        return out.toString()
    }

    private fun metric(
        json: JsonWriter,
        id: String,
        metric: String,
        at: Instant,
        value: Double,
        unit: String,
    ) {
        json.beginObject()
        json.name("external_id").value(id)
        json.name("metric").value(metric)
        json.name("timestamp").value(at.toString())
        json.name("value").value(value)
        json.name("unit").value(unit)
        json.endObject()
    }

    /** Health Connect exposes exercise types as ints; map the common ones by name. */
    private fun activityType(code: Int): String = when (code) {
        56 -> "running"
        79 -> "walking"
        8 -> "biking"
        73 -> "strength_training"
        68 -> "rowing"
        37 -> "hiking"
        76 -> "swimming"
        25 -> "elliptical"
        else -> "other"
    }
}

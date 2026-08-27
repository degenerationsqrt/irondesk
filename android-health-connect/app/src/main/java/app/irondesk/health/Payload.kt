package app.irondesk.health

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * The wire format, expressed as plain data plus a hand-rolled serializer.
 *
 * Deliberately free of Android and org.json imports so the exact bytes that go
 * to `/api/public/health-connect/ingest` can be asserted in a JVM unit test.
 * All numeric and hex formatting pins [Locale.ROOT] so a device set to a
 * comma-decimal locale cannot emit invalid JSON.
 */

/** Provenance Health Connect exposes per record. Every field is optional. */
data class SourceMeta(
    val packageName: String? = null,
    val manufacturer: String? = null,
    val model: String? = null,
    val recordingMethod: String? = null,
) {
    val empty: Boolean
        get() = packageName == null && manufacturer == null && model == null && recordingMethod == null

    companion object {
        val NONE = SourceMeta()
    }
}

data class MetricPoint(
    val externalId: String,
    val metric: String,
    val timestamp: String,
    val value: Double,
    val unit: String,
    val timezone: String? = null,
    val source: SourceMeta = SourceMeta.NONE,
)

data class ActivityPoint(
    val externalId: String,
    val activityType: String,
    val name: String,
    val startTime: String,
    val durationSec: Long,
    val distanceM: Double? = null,
    val calories: Double? = null,
    val averageHeartRate: Int? = null,
    val notes: String? = null,
    val timezone: String? = null,
    val source: SourceMeta = SourceMeta.NONE,
)

data class SyncPayload(
    val metrics: List<MetricPoint>,
    val activities: List<ActivityPoint>,
    val deviceLabel: String?,
    val timeZone: String = ZoneId.systemDefault().id,
    val exportedAt: Instant = Instant.now(),
    val rangeDays: Int = 30,
    /** True only when a full historical read was actually permitted. */
    val historyAuthorized: Boolean = false,
) {
    val total: Int get() = metrics.size + activities.size
}

object PayloadBuilder {

    /** Raised when a value cannot be represented in JSON. Never silently coerced. */
    class InvalidValueException(message: String) : IllegalArgumentException(message)

    fun build(payload: SyncPayload): String {
        val out = StringBuilder(1024)
        out.append('{')
        out.field("source", "irondesk-health-connect").append(',')
        out.append("\"version\":1,")
        out.field("exportedAt", payload.exportedAt.toString()).append(',')

        out.append("\"device\":{")
        payload.deviceLabel?.let { out.field("label", it).append(',') }
        out.field("timezone", payload.timeZone).append(',')
        out.append("\"platform\":\"android\",")
        out.append("\"range_days\":").append(payload.rangeDays).append(',')
        out.append("\"history_authorized\":").append(payload.historyAuthorized)
        out.append("},")

        out.append("\"records\":[")
        payload.metrics.forEachIndexed { index, metric ->
            if (index > 0) out.append(',')
            out.append('{')
            out.field("external_id", metric.externalId).append(',')
            out.field("metric", metric.metric).append(',')
            out.field("timestamp", metric.timestamp).append(',')
            out.append("\"value\":").append(number(metric.value, metric.metric)).append(',')
            out.field("unit", metric.unit)
            metric.timezone?.let { out.append(',').field("timezone", it) }
            out.source(metric.source)
            out.append('}')
        }
        out.append("],")

        out.append("\"activities\":[")
        payload.activities.forEachIndexed { index, activity ->
            if (index > 0) out.append(',')
            out.append('{')
            out.field("external_id", activity.externalId).append(',')
            out.field("activity_type", activity.activityType).append(',')
            out.field("name", activity.name).append(',')
            out.field("start_time", activity.startTime).append(',')
            out.append("\"duration_sec\":").append(activity.durationSec)
            activity.distanceM?.let { out.append(",\"distance_m\":").append(number(it, "distance_m")) }
            activity.calories?.let { out.append(",\"calories\":").append(number(it, "calories")) }
            activity.averageHeartRate?.let { out.append(",\"average_heart_rate\":").append(it) }
            activity.timezone?.let { out.append(',').field("timezone", it) }
            activity.notes?.let { out.append(',').field("notes", it) }
            out.source(activity.source)
            out.append('}')
        }
        out.append(']')

        out.append('}')
        return out.toString()
    }

    private fun StringBuilder.source(meta: SourceMeta): StringBuilder {
        if (meta.empty) return this
        meta.packageName?.let { append(',').field("source_package", it) }
        meta.manufacturer?.let { append(',').field("device_manufacturer", it) }
        meta.model?.let { append(',').field("device_model", it) }
        meta.recordingMethod?.let { append(',').field("recording_method", it) }
        return this
    }

    private fun StringBuilder.field(name: String, value: String): StringBuilder {
        append('"').append(name).append("\":")
        return escape(value)
    }

    private fun StringBuilder.escape(value: String): StringBuilder {
        append('"')
        for (char in value) {
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (char.code < 0x20) append(hexEscape(char)) else append(char)
            }
        }
        return append('"')
    }

    private fun hexEscape(char: Char): String = String.format(Locale.ROOT, "\\u%04x", char.code)

    /** Whole numbers stay integral so values read cleanly. NaN/∞ are refused. */
    private fun number(value: Double, field: String): String {
        if (value.isNaN() || value.isInfinite()) {
            throw InvalidValueException("$field is not a finite number.")
        }
        return if (value == value.toLong().toDouble()) {
            value.toLong().toString()
        } else {
            String.format(Locale.ROOT, "%.4f", value).trimEnd('0').trimEnd('.')
        }
    }
}

package app.irondesk.health

import java.time.LocalDate
import java.time.ZoneId

/**
 * Steps are cumulative and arrive from several apps at once, so raw records are
 * never summed here. Health Connect's own `aggregateGroupByPeriod` de-duplicates
 * across origins and returns one calendar-day total; this file only turns those
 * buckets into wire records with a stable `hc:steps:<local-date>` id, so
 * re-syncing an overlapping range produces zero duplicates.
 *
 * Pure on purpose: unit-testable without Health Connect.
 */
data class DailySteps(val date: LocalDate, val count: Long)

object StepAggregator {

    /** One metric point per day, ascending. Repeated days are summed defensively. */
    fun points(days: List<DailySteps>, zone: ZoneId): List<MetricPoint> {
        val perDay = LinkedHashMap<LocalDate, Long>()
        days.forEach { perDay[it.date] = (perDay[it.date] ?: 0L) + it.count }
        return perDay.entries
            .sortedBy { it.key }
            .map { (day, total) ->
                MetricPoint(
                    externalId = "hc:steps:$day",
                    metric = "steps",
                    timestamp = day.atStartOfDay(zone).toInstant().toString(),
                    value = total.toDouble(),
                    unit = "count",
                    timezone = zone.id,
                )
            }
    }
}

/** Totals shown in the preview card before anything is uploaded. */
data class PreviewSummary(
    val days: Int,
    val steps: Long,
    val sleepHours: Double,
    val workouts: Int,
    val activeCalories: Long,
    val distanceKm: Double,
) {
    companion object {
        fun of(days: Int, metrics: List<MetricPoint>, activities: List<ActivityPoint>): PreviewSummary {
            fun sum(metric: String) = metrics.filter { it.metric == metric }.sumOf { it.value }
            return PreviewSummary(
                days = days,
                steps = sum("steps").toLong(),
                sleepHours = sum("sleep_minutes") / 60.0,
                workouts = activities.size,
                activeCalories = sum("active_calories").toLong(),
                distanceKm = sum("distance") / 1000.0,
            )
        }
    }
}

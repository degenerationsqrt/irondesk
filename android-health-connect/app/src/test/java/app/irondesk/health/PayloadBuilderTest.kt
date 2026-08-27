package app.irondesk.health

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

class PayloadBuilderTest {

    private val payload = SyncPayload(
        metrics = listOf(
            MetricPoint("hc:steps:2026-05-01", "steps", "2026-05-01T00:00:00Z", 11423.0, "count"),
            MetricPoint("hc:hrv:x", "hrv", "2026-05-01T05:02:00Z", 62.5, "ms"),
        ),
        activities = listOf(
            ActivityPoint(
                externalId = "hc:sess:abc",
                activityType = "running",
                name = "Morning \"tempo\"",
                startTime = "2026-05-01T06:30:00Z",
                durationSec = 2520,
                distanceM = 8200.0,
                calories = 540.0,
                averageHeartRate = 151,
            ),
        ),
        deviceLabel = "Pixel 8",
        timeZone = "Europe/Oslo",
        exportedAt = Instant.parse("2026-05-01T09:12:00Z"),
        rangeDays = 30,
        historyAuthorized = false,
    )

    @Test fun `emits the documented envelope`() {
        val json = PayloadBuilder.build(payload)
        assertTrue(json.startsWith("{\"source\":\"irondesk-health-connect\",\"version\":1,"))
        assertTrue(json.contains("\"exportedAt\":\"2026-05-01T09:12:00Z\""))
        assertTrue(json.contains("\"timezone\":\"Europe/Oslo\""))
        assertTrue(json.contains("\"range_days\":30"))
        assertTrue(json.contains("\"history_authorized\":false"))
    }

    @Test fun `whole numbers stay integral and fractions survive`() {
        val json = PayloadBuilder.build(payload)
        assertTrue(json.contains("\"value\":11423"))
        assertTrue(json.contains("\"value\":62.5"))
        assertTrue(json.contains("\"distance_m\":8200"))
    }

    @Test fun `escapes quotes in free text`() {
        val json = PayloadBuilder.build(payload)
        assertTrue(json.contains("Morning \\\"tempo\\\""))
    }

    @Test fun `omits optional activity fields when absent`() {
        val json = PayloadBuilder.build(
            payload.copy(activities = listOf(payload.activities[0].copy(distanceM = null, calories = null, averageHeartRate = null))),
        )
        assertFalse(json.contains("distance_m"))
        assertFalse(json.contains("average_heart_rate"))
    }

    @Test fun `step aggregation is per local day and deterministic`() {
        val zone = ZoneId.of("Europe/Oslo")
        val days = listOf(
            DailySteps(LocalDate.parse("2026-05-02"), 900),
            DailySteps(LocalDate.parse("2026-05-01"), 1200),
            DailySteps(LocalDate.parse("2026-05-01"), 3400),
        )
        val first = StepAggregator.points(days, zone)
        val second = StepAggregator.points(days.reversed(), zone)

        assertEquals(2, first.size)
        assertEquals("hc:steps:2026-05-01", first[0].externalId)
        assertEquals(4600.0, first[0].value, 0.0)
        assertEquals(first.map { it.externalId }, second.map { it.externalId })
        assertEquals(first.map { it.value }, second.map { it.value })
        assertEquals("Europe/Oslo", first[0].timezone)
    }

    @Test fun `refuses non-finite values instead of emitting invalid JSON`() {
        val broken = payload.copy(
            metrics = listOf(MetricPoint("hc:x", "hrv", "2026-05-01T05:02:00Z", Double.NaN, "ms")),
        )
        assertThrows(PayloadBuilder.InvalidValueException::class.java) { PayloadBuilder.build(broken) }
        assertThrows(PayloadBuilder.InvalidValueException::class.java) {
            PayloadBuilder.build(
                payload.copy(activities = listOf(payload.activities[0].copy(distanceM = Double.POSITIVE_INFINITY))),
            )
        }
    }

    @Test fun `decimal formatting ignores the device locale`() {
        val previous = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag("nb-NO"))
        try {
            assertTrue(PayloadBuilder.build(payload).contains("\"value\":62.5"))
        } finally {
            Locale.setDefault(previous)
        }
    }

    @Test fun `keeps source provenance when Health Connect supplies it`() {
        val json = PayloadBuilder.build(
            payload.copy(
                metrics = listOf(
                    payload.metrics[0].copy(
                        source = SourceMeta(
                            packageName = "com.samsung.health",
                            manufacturer = "samsung",
                            model = "SM-S911B",
                            recordingMethod = "automatically_recorded",
                        ),
                    ),
                ),
            ),
        )
        assertTrue(json.contains("\"source_package\":\"com.samsung.health\""))
        assertTrue(json.contains("\"device_manufacturer\":\"samsung\""))
        assertTrue(json.contains("\"device_model\":\"SM-S911B\""))
        assertTrue(json.contains("\"recording_method\":\"automatically_recorded\""))
    }

    @Test fun `omits provenance keys entirely when nothing is known`() {
        assertFalse(PayloadBuilder.build(payload).contains("source_package"))
    }

    @Test fun `preview summary totals the mapped metrics`() {
        val summary = PreviewSummary.of(
            30,
            listOf(
                MetricPoint("a", "steps", "t", 10_000.0, "count"),
                MetricPoint("b", "sleep_minutes", "t", 480.0, "min"),
                MetricPoint("c", "active_calories", "t", 600.0, "kcal"),
                MetricPoint("d", "distance", "t", 5000.0, "m"),
            ),
            payload.activities,
        )
        assertEquals(10_000L, summary.steps)
        assertEquals(8.0, summary.sleepHours, 0.01)
        assertEquals(1, summary.workouts)
        assertEquals(5.0, summary.distanceKm, 0.01)
    }
}

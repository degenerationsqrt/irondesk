package app.irondesk.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.aggregate.AggregationResultGroupedByPeriod
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/**
 * Read-only Health Connect access.
 *
 * Nothing here transmits data: records are read into memory and handed to
 * [HealthMapper]. The user then either writes a file or presses Sync Now,
 * which posts the same payload to their own IronDesk account.
 */
class HealthRepository(context: Context) {

    /** Distinguishes "no Health Connect" from "provider needs an update". */
    enum class Availability { AVAILABLE, UPDATE_REQUIRED, UNAVAILABLE }

    val availability: Availability = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> Availability.AVAILABLE
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> Availability.UPDATE_REQUIRED
        else -> Availability.UNAVAILABLE
    }

    private val client: HealthConnectClient? =
        if (availability == Availability.AVAILABLE) HealthConnectClient.getOrCreate(context) else null

    val available: Boolean get() = client != null

    /** Exactly the record types the export needs — no broader scope is requested. */
    val permissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    /**
     * Health Connect only returns the last 30 days unless the app additionally
     * holds the history permission. It is requested separately, and only when
     * the installed provider actually supports the feature.
     */
    val historyPermission: String = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY

    /**
     * Whether the installed provider implements historical reads at all.
     * Requesting the permission when it is unavailable would show the user a
     * dialog they cannot satisfy, so it is never launched in that case.
     */
    val historySupported: Boolean = client?.let {
        runCatching {
            it.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) ==
                HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        }.getOrDefault(false)
    } ?: false

    suspend fun grantedPermissions(): Set<String> =
        client?.permissionController?.getGrantedPermissions() ?: emptySet()

    suspend fun hasHistoryAccess(): Boolean =
        historySupported && grantedPermissions().contains(historyPermission)

    /**
     * Reads every page for a non-cumulative record type.
     *
     * Health Connect returns at most a few thousand records per response, so the
     * page token is followed until it is null. [MAX_RECORDS_PER_TYPE] keeps a
     * pathological history from exhausting memory.
     */
    private suspend fun <T : Record> read(type: KClass<T>, from: Instant, to: Instant): List<T> {
        val session = client ?: return emptyList()
        val all = mutableListOf<T>()
        var pageToken: String? = null
        do {
            val response = session.readRecords(
                ReadRecordsRequest(
                    recordType = type,
                    timeRangeFilter = TimeRangeFilter.between(from, to),
                    pageSize = PAGE_SIZE,
                    pageToken = pageToken,
                ),
            )
            all += response.records
            pageToken = response.pageToken
        } while (pageToken != null && all.size < MAX_RECORDS_PER_TYPE)
        return all
    }

    /**
     * Calendar-day step totals.
     *
     * Steps are cumulative and usually written by more than one app, so raw
     * records must not be summed. `aggregateGroupByPeriod` with a one-day slicer
     * and a *local* time filter both de-duplicates across origins and keeps the
     * buckets aligned to the user's own days across DST transitions.
     */
    private suspend fun dailySteps(from: Instant, to: Instant, zone: ZoneId): List<DailySteps> {
        val session = client ?: return emptyList()
        val buckets: List<AggregationResultGroupedByPeriod> = session.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(
                    LocalDateTime.ofInstant(from, zone),
                    LocalDateTime.ofInstant(to, zone),
                ),
                timeRangeSlicer = Period.ofDays(1),
            ),
        )
        return buckets.mapNotNull { bucket ->
            val count = bucket.result[StepsRecord.COUNT_TOTAL] ?: return@mapNotNull null
            DailySteps(date = bucket.startTime.toLocalDate(), count = count)
        }
    }

    /** Reads every selected type for the range. Types the user did not grant come back empty. */
    suspend fun collect(
        selection: Selection,
        from: Instant,
        to: Instant,
        zone: ZoneId = ZoneId.systemDefault(),
    ): HealthSnapshot = HealthSnapshot(
        steps = if (selection.steps) dailySteps(from, to, zone) else emptyList(),
        sleep = if (selection.sleep) read(SleepSessionRecord::class, from, to) else emptyList(),
        restingHr = if (selection.restingHr) read(RestingHeartRateRecord::class, from, to) else emptyList(),
        hrv = if (selection.hrv) read(HeartRateVariabilityRmssdRecord::class, from, to) else emptyList(),
        weight = if (selection.weight) read(WeightRecord::class, from, to) else emptyList(),
        activeCalories = if (selection.activeCalories) read(ActiveCaloriesBurnedRecord::class, from, to) else emptyList(),
        distance = if (selection.distance) read(DistanceRecord::class, from, to) else emptyList(),
        sessions = if (selection.sessions) read(ExerciseSessionRecord::class, from, to) else emptyList(),
    )

    companion object {
        const val PAGE_SIZE = 1000
        const val MAX_RECORDS_PER_TYPE = 20_000

        /** Ranges beyond this need [historyPermission]; see [RangeOption]. */
        const val HISTORY_FREE_DAYS = 30
    }
}

/** The offered ranges, and which of them require historical access. */
enum class RangeOption(val days: Int, val label: String) {
    WEEK(7, "7 d"),
    MONTH(30, "30 d"),
    QUARTER(90, "90 d"),
    YEAR(365, "1 y");

    val needsHistory: Boolean get() = days > HealthRepository.HISTORY_FREE_DAYS

    /** What was actually readable, given the permission the user granted. */
    fun effectiveDays(historyAuthorized: Boolean): Int =
        if (needsHistory && !historyAuthorized) HealthRepository.HISTORY_FREE_DAYS else days
}

data class Selection(
    val steps: Boolean = true,
    val sleep: Boolean = true,
    val restingHr: Boolean = true,
    val hrv: Boolean = true,
    val weight: Boolean = true,
    val activeCalories: Boolean = true,
    val distance: Boolean = false,
    val sessions: Boolean = true,
)

data class HealthSnapshot(
    val steps: List<DailySteps>,
    val sleep: List<SleepSessionRecord>,
    val restingHr: List<RestingHeartRateRecord>,
    val hrv: List<HeartRateVariabilityRmssdRecord>,
    val weight: List<WeightRecord>,
    val activeCalories: List<ActiveCaloriesBurnedRecord>,
    val distance: List<DistanceRecord>,
    val sessions: List<ExerciseSessionRecord>,
) {
    /** Per-type counts shown in the UI before the user commits to an export or sync. */
    fun counts(): List<Pair<String, Int>> = listOf(
        "Step days" to steps.size,
        "Sleep" to sleep.size,
        "Resting HR" to restingHr.size,
        "HRV" to hrv.size,
        "Weight" to weight.size,
        "Active calories" to activeCalories.size,
        "Distance" to distance.size,
        "Workouts" to sessions.size,
    )

    val total: Int get() = counts().sumOf { it.second }
}

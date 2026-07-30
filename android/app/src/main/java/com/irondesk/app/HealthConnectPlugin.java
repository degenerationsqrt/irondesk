package com.irondesk.app;

import android.content.Intent;
import android.os.Build;
import android.os.OutcomeReceiver;

import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executor;
import java.util.concurrent.ConcurrentSkipListSet;

import android.health.connect.AggregateRecordsRequest;
import android.health.connect.AggregateRecordsResponse;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.InsertRecordsResponse;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.TimeRangeFilter;
import android.health.connect.datatypes.AggregationType;
import android.health.connect.datatypes.BodyFatRecord;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.Device;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.ExerciseSessionType;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.Metadata;
import android.health.connect.datatypes.Record;
import android.health.connect.datatypes.RestingHeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.TotalCaloriesBurnedRecord;
import android.health.connect.datatypes.Vo2MaxRecord;
import android.health.connect.datatypes.WeightRecord;
import android.health.connect.datatypes.units.Energy;
import android.health.connect.datatypes.units.Mass;

@CapacitorPlugin(
    name = "HealthConnect",
    permissions = {
        @Permission(
            alias = "healthRead",
            strings = {
                HealthConnectPlugin.READ_STEPS,
                HealthConnectPlugin.READ_HEART_RATE,
                HealthConnectPlugin.READ_RESTING_HEART_RATE,
                HealthConnectPlugin.READ_SLEEP,
                HealthConnectPlugin.READ_WEIGHT,
                HealthConnectPlugin.READ_BODY_FAT,
                HealthConnectPlugin.READ_TOTAL_CALORIES_BURNED,
                HealthConnectPlugin.READ_EXERCISE,
                HealthConnectPlugin.READ_VO2_MAX
            }
        ),
        @Permission(
            alias = "healthWrite",
            strings = {
                HealthConnectPlugin.WRITE_EXERCISE
            }
        )
    }
)
public class HealthConnectPlugin extends Plugin {
    static final String READ_STEPS = "android.permission.health.READ_STEPS";
    static final String READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    static final String READ_RESTING_HEART_RATE = "android.permission.health.READ_RESTING_HEART_RATE";
    static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    static final String READ_WEIGHT = "android.permission.health.READ_WEIGHT";
    static final String READ_BODY_FAT = "android.permission.health.READ_BODY_FAT";
    static final String READ_TOTAL_CALORIES_BURNED = "android.permission.health.READ_TOTAL_CALORIES_BURNED";
    static final String READ_EXERCISE = "android.permission.health.READ_EXERCISE";
    static final String READ_VO2_MAX = "android.permission.health.READ_VO2_MAX";
    static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";

    private static final Map<String, String> PERMISSIONS = new LinkedHashMap<>();

    static {
        PERMISSIONS.put("steps", READ_STEPS);
        PERMISSIONS.put("heartRate", READ_HEART_RATE);
        PERMISSIONS.put("restingHeartRate", READ_RESTING_HEART_RATE);
        PERMISSIONS.put("sleep", READ_SLEEP);
        PERMISSIONS.put("weight", READ_WEIGHT);
        PERMISSIONS.put("bodyFat", READ_BODY_FAT);
        PERMISSIONS.put("calories", READ_TOTAL_CALORIES_BURNED);
        PERMISSIONS.put("exercise", READ_EXERCISE);
        PERMISSIONS.put("vo2Max", READ_VO2_MAX);
        PERMISSIONS.put("writeExercise", WRITE_EXERCISE);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
        JSObject permissions = new JSObject();
        JSArray missing = new JSArray();
        int grantedCount = 0;
        int readGrantedCount = 0;

        for (Map.Entry<String, String> entry : PERMISSIONS.entrySet()) {
            boolean granted = available && isGranted(entry.getValue());
            permissions.put(entry.getKey(), granted);
            if (granted) {
                grantedCount += 1;
                if (!"writeExercise".equals(entry.getKey())) {
                    readGrantedCount += 1;
                }
            } else {
                missing.put(entry.getKey());
            }
        }

        result.put("available", available);
        result.put("platform", "android");
        result.put("minimumAndroidVersion", 14);
        result.put("androidSdk", Build.VERSION.SDK_INT);
        result.put("permissions", permissions);
        result.put("missingPermissions", missing);
        result.put("grantedCount", grantedCount);
        result.put("permissionCount", PERMISSIONS.size());
        result.put("readGrantedCount", readGrantedCount);
        result.put("readPermissionCount", PERMISSIONS.size() - 1);
        result.put("writeExerciseGranted", available && isGranted(WRITE_EXERCISE));
        result.put("allGranted", available && grantedCount == PERMISSIONS.size());
        result.put("allReadGranted", available && readGrantedCount == PERMISSIONS.size() - 1);
        if (!available) {
            result.put("reason", "android-14-required");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.reject("Health Connect requires Android 14 or newer.", "HEALTH_CONNECT_UNAVAILABLE");
            return;
        }

        Intent intent = new Intent(HealthConnectManager.ACTION_MANAGE_HEALTH_PERMISSIONS);
        intent.putExtra(Intent.EXTRA_PACKAGE_NAME, getContext().getPackageName());
        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Health Connect settings could not be opened.", "HEALTH_CONNECT_SETTINGS_FAILED", error);
        }
    }

    @PluginMethod
    public void readDailySummary(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.reject("Health Connect requires Android 14 or newer.", "HEALTH_CONNECT_UNAVAILABLE");
            return;
        }
        Api34Impl.readDailySummary(this, call, permissionSnapshot());
    }

    @PluginMethod
    public void writeExerciseSession(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            call.reject("Health Connect requires Android 14 or newer.", "HEALTH_CONNECT_UNAVAILABLE");
            return;
        }
        if (!isGranted(WRITE_EXERCISE)) {
            call.reject(
                "Allow IronDesk to write exercise in Health Connect first.",
                "HEALTH_CONNECT_WRITE_PERMISSION_REQUIRED"
            );
            return;
        }
        Api34Impl.writeExerciseSession(this, call);
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
            == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private Map<String, Boolean> permissionSnapshot() {
        Map<String, Boolean> snapshot = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : PERMISSIONS.entrySet()) {
            snapshot.put(entry.getKey(), isGranted(entry.getValue()));
        }
        return snapshot;
    }

    @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private static final class Api34Impl {
        private static final int MAX_DAYS = 31;
        private static final double GRAMS_PER_POUND = 453.59237d;

        static void writeExerciseSession(
            HealthConnectPlugin plugin,
            PluginCall call
        ) {
            String clientRecordId = call.getString("clientRecordId", "").trim();
            String title = call.getString("title", "IronDesk Workout").trim();
            String notes = call.getString("notes", "").trim();
            String exerciseType = call.getString("exerciseType", "strengthTraining");
            Long clientRecordVersion = call.getLong("clientRecordVersion", 1L);
            Instant startTime;
            Instant endTime;

            if (clientRecordId.isBlank()) {
                call.reject("A stable IronDesk session ID is required.", "INVALID_EXERCISE_SESSION");
                return;
            }

            try {
                startTime = Instant.parse(call.getString("startTime", ""));
                endTime = Instant.parse(call.getString("endTime", ""));
            } catch (RuntimeException error) {
                call.reject(
                    "Workout start and end times must be valid ISO timestamps.",
                    "INVALID_EXERCISE_SESSION",
                    error
                );
                return;
            }

            if (!endTime.isAfter(startTime)) {
                call.reject(
                    "Workout end time must be after its start time.",
                    "INVALID_EXERCISE_SESSION"
                );
                return;
            }

            HealthConnectManager manager = plugin.getContext().getSystemService(HealthConnectManager.class);
            if (manager == null) {
                call.reject("Health Connect is not available on this device.", "HEALTH_CONNECT_UNAVAILABLE");
                return;
            }

            Device device = new Device.Builder()
                .setManufacturer(Build.MANUFACTURER)
                .setModel(Build.MODEL)
                .setType(Device.DEVICE_TYPE_PHONE)
                .build();
            Metadata metadata = new Metadata.Builder()
                .setClientRecordId(clientRecordId)
                .setClientRecordVersion(clientRecordVersion == null ? 1L : clientRecordVersion)
                .setRecordingMethod(Metadata.RECORDING_METHOD_ACTIVELY_RECORDED)
                .setDevice(device)
                .build();
            ExerciseSessionRecord.Builder recordBuilder = new ExerciseSessionRecord.Builder(
                metadata,
                startTime,
                endTime,
                exerciseSessionType(exerciseType)
            ).setTitle(title.isBlank() ? "IronDesk Workout" : title);
            if (!notes.isBlank()) {
                recordBuilder.setNotes(notes);
            }

            List<Record> records = new ArrayList<>();
            records.add(recordBuilder.build());
            manager.insertRecords(
                records,
                plugin.getContext().getMainExecutor(),
                new OutcomeReceiver<InsertRecordsResponse, HealthConnectException>() {
                    @Override
                    public void onResult(InsertRecordsResponse response) {
                        JSObject result = new JSObject();
                        result.put("clientRecordId", clientRecordId);
                        result.put("writtenAt", Instant.now().toString());
                        if (!response.getRecords().isEmpty()) {
                            result.put("recordId", response.getRecords().get(0).getMetadata().getId());
                        }
                        call.resolve(result);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        call.reject(
                            "Health Connect could not save this completed workout.",
                            "HEALTH_CONNECT_WRITE_FAILED",
                            error
                        );
                    }
                }
            );
        }

        private static int exerciseSessionType(String type) {
            if (type == null) {
                return ExerciseSessionType.EXERCISE_SESSION_TYPE_STRENGTH_TRAINING;
            }
            switch (type) {
                case "hiit":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING;
                case "martialArts":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_MARTIAL_ARTS;
                case "pilates":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_PILATES;
                case "yoga":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_YOGA;
                case "calisthenics":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_CALISTHENICS;
                case "otherWorkout":
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_OTHER_WORKOUT;
                case "strengthTraining":
                default:
                    return ExerciseSessionType.EXERCISE_SESSION_TYPE_STRENGTH_TRAINING;
            }
        }

        static void readDailySummary(
            HealthConnectPlugin plugin,
            PluginCall call,
            Map<String, Boolean> permissions
        ) {
            LocalDate startDate;
            LocalDate endDate;
            try {
                startDate = LocalDate.parse(call.getString("startDate", LocalDate.now().minusDays(6).toString()));
                endDate = LocalDate.parse(call.getString("endDate", LocalDate.now().toString()));
            } catch (DateTimeParseException error) {
                call.reject("Dates must use YYYY-MM-DD.", "INVALID_DATE_RANGE", error);
                return;
            }

            long dayCount = ChronoUnit.DAYS.between(startDate, endDate) + 1;
            if (dayCount < 1 || dayCount > MAX_DAYS) {
                call.reject("Choose a date range from 1 to 31 days.", "INVALID_DATE_RANGE");
                return;
            }

            HealthConnectManager manager = plugin.getContext().getSystemService(HealthConnectManager.class);
            if (manager == null) {
                call.reject("Health Connect is not available on this device.", "HEALTH_CONNECT_UNAVAILABLE");
                return;
            }

            Executor executor = plugin.getContext().getMainExecutor();
            ZoneId zone = ZoneId.systemDefault();
            List<CompletableFuture<JSObject>> dayFutures = new ArrayList<>();

            for (int index = 0; index < dayCount; index += 1) {
                LocalDate date = startDate.plusDays(index);
                Instant start = date.atStartOfDay(zone).toInstant();
                Instant end = date.plusDays(1).atStartOfDay(zone).toInstant();
                dayFutures.add(readDay(manager, executor, date, start, end, permissions));
            }

            CompletableFuture<?>[] pending = dayFutures.toArray(new CompletableFuture<?>[0]);
            CompletableFuture.allOf(pending).whenComplete((unused, failure) -> {
                if (failure != null) {
                    Throwable cause = failure instanceof CompletionException && failure.getCause() != null
                        ? failure.getCause()
                        : failure;
                    Exception exception = cause instanceof Exception
                        ? (Exception) cause
                        : new Exception(cause);
                    call.reject(
                        "Health Connect could not read the selected days. Check access and try again.",
                        "HEALTH_CONNECT_READ_FAILED",
                        exception
                    );
                    return;
                }

                JSArray days = new JSArray();
                for (CompletableFuture<JSObject> future : dayFutures) {
                    days.put(future.join());
                }
                JSObject result = new JSObject();
                result.put("days", days);
                result.put("startDate", startDate.toString());
                result.put("endDate", endDate.toString());
                result.put("syncedAt", Instant.now().toString());
                call.resolve(result);
            });
        }

        private static CompletableFuture<JSObject> readDay(
            HealthConnectManager manager,
            Executor executor,
            LocalDate date,
            Instant start,
            Instant end,
            Map<String, Boolean> permissions
        ) {
            DaySummary summary = new DaySummary(date.toString());
            TimeRangeFilter filter = new TimeInstantRangeFilter.Builder()
                .setStartTime(start)
                .setEndTime(end)
                .build();

            CompletableFuture<Void> longMetrics = readLongMetrics(
                manager,
                executor,
                filter,
                permissions,
                summary
            );
            CompletableFuture<Void> calories = readCalories(
                manager,
                executor,
                filter,
                allowed(permissions, "calories"),
                summary
            );
            CompletableFuture<Void> weight = readWeight(
                manager,
                executor,
                filter,
                allowed(permissions, "weight"),
                summary
            );
            CompletableFuture<Void> bodyFat = readBodyFat(
                manager,
                executor,
                filter,
                allowed(permissions, "bodyFat"),
                summary
            );
            CompletableFuture<Void> vo2Max = readVo2Max(
                manager,
                executor,
                filter,
                allowed(permissions, "vo2Max"),
                summary
            );

            return CompletableFuture.allOf(longMetrics, calories, weight, bodyFat, vo2Max)
                .thenApply(unused -> summary.toJson());
        }

        private static CompletableFuture<Void> readLongMetrics(
            HealthConnectManager manager,
            Executor executor,
            TimeRangeFilter filter,
            Map<String, Boolean> permissions,
            DaySummary summary
        ) {
            AggregateRecordsRequest.Builder<Long> builder = new AggregateRecordsRequest.Builder<>(filter);
            List<AggregationType<Long>> metrics = new ArrayList<>();
            addLongMetric(builder, metrics, permissions, "steps", StepsRecord.STEPS_COUNT_TOTAL);
            addLongMetric(builder, metrics, permissions, "heartRate", HeartRateRecord.BPM_AVG);
            addLongMetric(builder, metrics, permissions, "heartRate", HeartRateRecord.BPM_MIN);
            addLongMetric(builder, metrics, permissions, "heartRate", HeartRateRecord.BPM_MAX);
            addLongMetric(builder, metrics, permissions, "restingHeartRate", RestingHeartRateRecord.BPM_AVG);
            addLongMetric(builder, metrics, permissions, "sleep", SleepSessionRecord.SLEEP_DURATION_TOTAL);
            addLongMetric(builder, metrics, permissions, "exercise", ExerciseSessionRecord.EXERCISE_DURATION_TOTAL);

            if (metrics.isEmpty()) {
                return CompletableFuture.completedFuture(null);
            }

            CompletableFuture<Void> future = new CompletableFuture<>();
            manager.aggregate(
                builder.build(),
                executor,
                new OutcomeReceiver<AggregateRecordsResponse<Long>, HealthConnectException>() {
                    @Override
                    public void onResult(AggregateRecordsResponse<Long> response) {
                        if (allowed(permissions, "steps")) {
                            summary.steps = response.get(StepsRecord.STEPS_COUNT_TOTAL);
                        }
                        if (allowed(permissions, "heartRate")) {
                            summary.averageHeartRate = response.get(HeartRateRecord.BPM_AVG);
                            summary.minimumHeartRate = response.get(HeartRateRecord.BPM_MIN);
                            summary.maximumHeartRate = response.get(HeartRateRecord.BPM_MAX);
                        }
                        if (allowed(permissions, "restingHeartRate")) {
                            summary.restingHeartRate = response.get(RestingHeartRateRecord.BPM_AVG);
                        }
                        if (allowed(permissions, "sleep")) {
                            summary.sleepMilliseconds = response.get(SleepSessionRecord.SLEEP_DURATION_TOTAL);
                        }
                        if (allowed(permissions, "exercise")) {
                            summary.exerciseMilliseconds = response.get(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL);
                        }
                        for (AggregationType<Long> metric : metrics) {
                            addOrigins(summary, response.getDataOrigins(metric));
                        }
                        future.complete(null);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        future.completeExceptionally(error);
                    }
                }
            );
            return future;
        }

        private static void addLongMetric(
            AggregateRecordsRequest.Builder<Long> builder,
            List<AggregationType<Long>> metrics,
            Map<String, Boolean> permissions,
            String permissionKey,
            AggregationType<Long> metric
        ) {
            if (allowed(permissions, permissionKey)) {
                builder.addAggregationType(metric);
                metrics.add(metric);
            }
        }

        private static CompletableFuture<Void> readCalories(
            HealthConnectManager manager,
            Executor executor,
            TimeRangeFilter filter,
            boolean allowed,
            DaySummary summary
        ) {
            if (!allowed) {
                return CompletableFuture.completedFuture(null);
            }
            AggregateRecordsRequest<Energy> request = new AggregateRecordsRequest.Builder<Energy>(filter)
                .addAggregationType(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
                .build();
            CompletableFuture<Void> future = new CompletableFuture<>();
            manager.aggregate(
                request,
                executor,
                new OutcomeReceiver<AggregateRecordsResponse<Energy>, HealthConnectException>() {
                    @Override
                    public void onResult(AggregateRecordsResponse<Energy> response) {
                        Energy value = response.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
                        if (value != null) {
                            summary.calories = value.getInCalories();
                        }
                        addOrigins(summary, response.getDataOrigins(TotalCaloriesBurnedRecord.ENERGY_TOTAL));
                        future.complete(null);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        future.completeExceptionally(error);
                    }
                }
            );
            return future;
        }

        private static CompletableFuture<Void> readWeight(
            HealthConnectManager manager,
            Executor executor,
            TimeRangeFilter filter,
            boolean allowed,
            DaySummary summary
        ) {
            if (!allowed) {
                return CompletableFuture.completedFuture(null);
            }
            AggregateRecordsRequest<Mass> request = new AggregateRecordsRequest.Builder<Mass>(filter)
                .addAggregationType(WeightRecord.WEIGHT_AVG)
                .build();
            CompletableFuture<Void> future = new CompletableFuture<>();
            manager.aggregate(
                request,
                executor,
                new OutcomeReceiver<AggregateRecordsResponse<Mass>, HealthConnectException>() {
                    @Override
                    public void onResult(AggregateRecordsResponse<Mass> response) {
                        Mass value = response.get(WeightRecord.WEIGHT_AVG);
                        if (value != null) {
                            summary.weightPounds = value.getInGrams() / GRAMS_PER_POUND;
                        }
                        addOrigins(summary, response.getDataOrigins(WeightRecord.WEIGHT_AVG));
                        future.complete(null);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        future.completeExceptionally(error);
                    }
                }
            );
            return future;
        }

        private static CompletableFuture<Void> readBodyFat(
            HealthConnectManager manager,
            Executor executor,
            TimeRangeFilter filter,
            boolean allowed,
            DaySummary summary
        ) {
            if (!allowed) {
                return CompletableFuture.completedFuture(null);
            }
            ReadRecordsRequestUsingFilters<BodyFatRecord> request =
                new ReadRecordsRequestUsingFilters.Builder<>(BodyFatRecord.class)
                    .setTimeRangeFilter(filter)
                    .setAscending(false)
                    .setPageSize(1)
                    .build();
            CompletableFuture<Void> future = new CompletableFuture<>();
            manager.readRecords(
                request,
                executor,
                new OutcomeReceiver<ReadRecordsResponse<BodyFatRecord>, HealthConnectException>() {
                    @Override
                    public void onResult(ReadRecordsResponse<BodyFatRecord> response) {
                        if (!response.getRecords().isEmpty()) {
                            BodyFatRecord record = response.getRecords().get(0);
                            summary.bodyFatPercentage = record.getPercentage().getValue();
                            String packageName = record.getMetadata().getDataOrigin().getPackageName();
                            if (packageName != null && !packageName.isBlank()) {
                                summary.sourcePackages.add(packageName);
                            }
                        }
                        future.complete(null);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        future.completeExceptionally(error);
                    }
                }
            );
            return future;
        }

        private static CompletableFuture<Void> readVo2Max(
            HealthConnectManager manager,
            Executor executor,
            TimeRangeFilter filter,
            boolean allowed,
            DaySummary summary
        ) {
            if (!allowed) {
                return CompletableFuture.completedFuture(null);
            }
            ReadRecordsRequestUsingFilters<Vo2MaxRecord> request =
                new ReadRecordsRequestUsingFilters.Builder<>(Vo2MaxRecord.class)
                    .setTimeRangeFilter(filter)
                    .setAscending(false)
                    .setPageSize(1)
                    .build();
            CompletableFuture<Void> future = new CompletableFuture<>();
            manager.readRecords(
                request,
                executor,
                new OutcomeReceiver<ReadRecordsResponse<Vo2MaxRecord>, HealthConnectException>() {
                    @Override
                    public void onResult(ReadRecordsResponse<Vo2MaxRecord> response) {
                        if (!response.getRecords().isEmpty()) {
                            Vo2MaxRecord record = response.getRecords().get(0);
                            summary.vo2Max = record.getVo2MillilitersPerMinuteKilogram();
                            String packageName = record.getMetadata().getDataOrigin().getPackageName();
                            if (packageName != null && !packageName.isBlank()) {
                                summary.sourcePackages.add(packageName);
                            }
                        }
                        future.complete(null);
                    }

                    @Override
                    public void onError(HealthConnectException error) {
                        future.completeExceptionally(error);
                    }
                }
            );
            return future;
        }

        private static boolean allowed(Map<String, Boolean> permissions, String key) {
            return Boolean.TRUE.equals(permissions.get(key));
        }

        private static void addOrigins(
            DaySummary summary,
            Set<DataOrigin> origins
        ) {
            for (DataOrigin origin : origins) {
                String packageName = origin.getPackageName();
                if (packageName != null && !packageName.isBlank()) {
                    summary.sourcePackages.add(packageName);
                }
            }
        }

        private static final class DaySummary {
            final String date;
            final Set<String> sourcePackages = new ConcurrentSkipListSet<>();
            Long steps;
            Long averageHeartRate;
            Long minimumHeartRate;
            Long maximumHeartRate;
            Long restingHeartRate;
            Long sleepMilliseconds;
            Long exerciseMilliseconds;
            Double calories;
            Double weightPounds;
            Double bodyFatPercentage;
            Double vo2Max;

            DaySummary(String date) {
                this.date = date;
            }

            JSObject toJson() {
                JSObject result = new JSObject();
                result.put("date", date);
                putNumber(result, "steps", steps);
                putNumber(result, "averageHeartRate", averageHeartRate);
                putNumber(result, "minimumHeartRate", minimumHeartRate);
                putNumber(result, "maximumHeartRate", maximumHeartRate);
                putNumber(result, "restingHeartRate", restingHeartRate);
                putRounded(result, "sleepMinutes", minutes(sleepMilliseconds), 0);
                putRounded(result, "exerciseMinutes", minutes(exerciseMilliseconds), 0);
                putRounded(result, "calories", calories, 0);
                putRounded(result, "weightLb", weightPounds, 1);
                putRounded(result, "bodyFat", bodyFatPercentage, 1);
                putRounded(result, "vo2Max", vo2Max, 1);
                result.put("sourcePackages", new JSArray(new ArrayList<>(sourcePackages)));
                return result;
            }

            private static Double minutes(Long milliseconds) {
                return milliseconds == null ? null : milliseconds / 60000d;
            }

            private static void putNumber(JSObject target, String key, Long value) {
                if (value != null) {
                    target.put(key, value);
                }
            }

            private static void putRounded(JSObject target, String key, Double value, int digits) {
                if (value == null || !Double.isFinite(value)) {
                    return;
                }
                double scale = Math.pow(10d, digits);
                target.put(key, Math.round(value * scale) / scale);
            }
        }
    }
}

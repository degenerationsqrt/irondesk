import Toybox.Lang;
import Toybox.Test;
import Toybox.Application.Properties;

(:debug)
function refreshTestWorkout(count, weight, reps) {
    var exercises = [];
    var remaining = count;
    var index = 0;
    while (remaining > 0) {
        var sets = [];
        var size = remaining > 16 ? 16 : remaining;
        for (var j = 0; j < size; j += 1) {
            sets.add({"id" => "set-" + index.toString(), "set_number" => j + 1,
                "weight_kg" => weight, "reps" => reps, "rpe" => 8.0,
                "completed" => false, "rest_seconds" => 60});
            index += 1;
        }
        exercises.add({"id" => "exercise-" + exercises.size().toString(),
            "name" => "Back Squat", "target_reps" => "4", "rest_seconds" => 60,
            "sets" => sets});
        remaining -= size;
    }
    return {"id" => "refresh-session", "title" => "Refresh test", "started_at" => "2026-09-12T23:27:56Z",
        "exercises" => exercises, "_watch_drafts_version" => 1};
}

(:debug)
function refreshTestEvent(set, weight, reps) {
    return {"event_id" => "refresh-event", "session_id" => "refresh-session", "set_id" => set["id"],
        "type" => "set.updated", "payload" => {"weight_kg" => weight, "reps" => reps,
            "rpe" => 8.0, "completed" => true, "rest_seconds" => 60}};
}

(:test)
function testRefreshAdoptsPersistedPlanWithoutMaskingInitialDefaults(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(4, null, 4);
    var incoming = refreshTestWorkout(4, 61.23, 20);
    var result = WorkoutRefresh.merge(local, incoming, []);
    var set = result["exercises"][0]["sets"][0];
    return result == incoming && set["weight_kg"] == 61.23 && set["reps"] == 20
        && local["exercises"][0]["sets"][0]["weight_kg"] == null
        && set["_watch_dirty"] == null;
}

(:test)
function testRefreshProtectsOnlyChangedFieldIncludingExplicitZero(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(4, null, 4);
    var set = local["exercises"][0]["sets"][0];
    var unchanged = !WorkoutRefresh.edit(set, "reps", 4);
    WorkoutRefresh.edit(set, "weight_kg", 0.0);
    var result = WorkoutRefresh.merge(local, refreshTestWorkout(4, 61.23, 20), []);
    var merged = result["exercises"][0]["sets"][0];
    return unchanged && merged["weight_kg"] == 0.0 && merged["reps"] == 20
        && merged["_watch_dirty"]["weight_kg"] == true && merged["_watch_dirty"]["reps"] == null;
}

(:test)
function testRefreshKeepsInFlightConfirmationUntilAcknowledged(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(4, null, 4);
    var set = local["exercises"][0]["sets"][0];
    WorkoutRefresh.edit(set, "weight_kg", 60.0);
    var event = refreshTestEvent(set, 60.0, 4);
    var pending = WorkoutRefresh.merge(local, refreshTestWorkout(4, 61.23, 20), [event]);
    var retained = pending["exercises"][0]["sets"][0]["completed"] == true;
    WorkoutRefresh.acknowledge(pending, [event]);
    var later = refreshTestWorkout(4, 70.0, 12);
    later["exercises"][0]["sets"][0]["completed"] = true;
    var result = WorkoutRefresh.merge(pending, later, []);
    return retained && result["exercises"][0]["sets"][0]["weight_kg"] == 70.0
        && result["exercises"][0]["sets"][0]["reps"] == 12
        && result["exercises"][0]["sets"][0]["_watch_dirty"] == null;
}

(:test)
function testDraftAcknowledgementDoesNotEraseNewerEdit(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(1, 50.0, 4);
    var set = local["exercises"][0]["sets"][0];
    WorkoutRefresh.edit(set, "weight_kg", 60.0);
    var event = refreshTestEvent(set, 60.0, 4);
    WorkoutRefresh.edit(set, "weight_kg", 65.0);
    WorkoutRefresh.acknowledge(local, [event]);
    var result = WorkoutRefresh.merge(local, refreshTestWorkout(1, 60.0, 20), []);
    return result["exercises"][0]["sets"][0]["weight_kg"] == 65.0
        && result["exercises"][0]["sets"][0]["reps"] == 20;
}

(:test)
function testRefreshRejectsDifferentSessionAndLayoutBeforeMutation(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(4, 60.0, 4);
    var changed = refreshTestWorkout(4, 70.0, 20);
    changed["exercises"][0]["sets"][0]["id"] = "replacement-set";
    var otherSession = refreshTestWorkout(4, 70.0, 20);
    otherSession["id"] = "other-session";
    return WorkoutRefresh.merge(local, null, []) == null
        && WorkoutRefresh.merge(local, changed, []) == null
        && WorkoutRefresh.merge(local, otherSession, []) == null
        && local["exercises"][0]["sets"][0]["reps"] == 4;
}

(:test)
function testRefreshHandlesSixtySetsAndLegacyDraftBoundary(logger as Test.Logger) as Boolean {
    var local = refreshTestWorkout(60, null, 4);
    local.remove("_watch_drafts_version");
    var current = local["exercises"][0]["sets"][0];
    var migrated = WorkoutRefresh.preserveLegacyDraft(local, current);
    var result = WorkoutRefresh.merge(local, refreshTestWorkout(60, 61.23, 20), []);
    var store = new WorkoutStore();
    var stored = store.setWorkout(result);
    var reread = store.getWorkout();
    store.setWorkout(null);
    return migrated && stored && reread["exercises"].size() == 4
        && reread["exercises"][0]["sets"][0]["reps"] == 4
        && reread["exercises"][3]["sets"][11]["reps"] == 20;
}

(:debug)
class RefreshTestApi {
    var store;
    var busy = false;
    var callback = null;
    var kind = null;
    var fetchCount = 0;
    var flushCount = 0;
    var paired = true;
    var localOrigin = true;
    function initialize(value) { store = value; }
    function hasBaseUrl() { return true; }
    function isPairedToCurrentBaseUrl() { return paired; }
    function isLocalDataForCurrentBaseUrl() { return localOrigin; }
    function isBusy() { return busy; }
    function fetchActive(handler) {
        if (busy) { return false; }
        busy = true; callback = handler; kind = "fetch"; fetchCount += 1; return true;
    }
    function flushEvents(handler) {
        if (busy || store.getEvents().size() == 0) { return false; }
        busy = true; callback = handler; kind = "flush"; flushCount += 1; return true;
    }
    function replyWorkout(workout) {
        var handler = callback; callback = null; busy = false; kind = null;
        handler.invoke("workout", {"schema_version" => 1, "workout" => workout}, 200);
    }
    function replyError() {
        replyFailure("fetch_error", -104);
    }
    function replyFailure(resultKind, code) {
        replyResult(resultKind, null, code);
    }
    function replyResult(resultKind, data, code) {
        var handler = callback; callback = null; busy = false; kind = null;
        handler.invoke(resultKind, data, code);
    }
    function replySynced() {
        var handler = callback; callback = null; busy = false; kind = null;
        var events = store.getEvents();
        store.acknowledgeDrafts(events);
        store.clearEvents();
        handler.invoke("events_acked", {"events" => events}, 200);
        handler.invoke("synced", {"schema_version" => 1}, 200);
    }
}

(:debug)
class RefreshTestRecorder {
    var starts = 0;
    var saves = 0;
    var laps = 0;
    function start() { starts += 1; return true; }
    function hasSession() { return starts > saves; }
    function hasRecoverableSession() { return hasSession(); }
    function stopAndSave() { saves += 1; return true; }
    function getHeartRate() { return null; }
    function getAverageHeartRate() { return null; }
    function getMaxHeartRate() { return null; }
    function addSetLap() { laps += 1; return true; }
}

(:debug)
class RefreshTestFixture {
    var store;
    var api;
    var recorder;
    var view;
    function initialize(count) {
        store = new WorkoutStore();
        store.clearProtectedServerData();
        api = new RefreshTestApi(store);
        recorder = new RefreshTestRecorder();
        view = new IronDeskView({"store" => store, "api" => api, "recorder" => recorder});
        view.onShow();
        api.replyWorkout(refreshTestWorkout(count, null, 4));
        view.startWorkout();
    }
    function close() { view.onHide(); store.clearProtectedServerData(); }
}

(:test)
function testLiveRefreshChangesPlanWithoutRestartingFit(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    var before = f.store.getCheckpoint();
    f.view.syncNow();
    f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var after = f.store.getCheckpoint();
    var set = f.store.getWorkout()["exercises"][0]["sets"][0];
    var passed = f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0
        && f.view.canEditCurrentSet() && after["state"].equals("active")
        && after["started_at"] == before["started_at"] && after["set_id"].equals(before["set_id"])
        && set["weight_kg"] == 61.23 && set["reps"] == 20;
    f.close(); return passed;
}

(:test)
function testHiddenSnapshotCannotOverwriteEditorAndMenuRetryResumes(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow();
    f.view.onHide();
    var editor = new IronDeskWeightEditor(f.view);
    editor.increase();
    f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    editor.cancel(); editor.save();
    var kept = f.store.getWorkout()["exercises"][0]["sets"][0]["weight_kg"] == null;
    f.view.onShow(); f.view.syncNow(); f.api.replyWorkout(null);
    var conflict = f.view.hasLiveSnapshotConflict();
    f.view.onHide(); f.view.syncNow();
    var before = f.api.fetchCount;
    f.view.onShow();
    var retried = f.api.fetchCount == before + 1;
    f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var passed = kept && conflict && retried && !f.view.hasLiveSnapshotConflict()
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testConfirmationDuringGetPreservesRestAndDrainsPost(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow();
    f.view.primaryAction();
    var before = f.store.getCheckpoint();
    f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var after = f.store.getCheckpoint();
    var retained = f.store.getWorkout()["exercises"][0]["sets"][0]["completed"] == true;
    var passed = retained && f.api.flushCount == 1 && f.recorder.laps == 1 && f.recorder.saves == 0
        && before["rest_ends_at"] == after["rest_ends_at"] && after["state"].equals("rest")
        && after["set_id"].equals("set-1");
    f.close(); return passed;
}

(:test)
function testLastSetFlushAndLateGetCannotReopenFinishedWorkout(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(1);
    f.view.syncNow();
    f.view.primaryAction();
    f.view.finishWorkout();
    var checkpoint = f.store.getCheckpoint();
    f.api.replyWorkout(refreshTestWorkout(1, 61.23, 20));
    var after = f.store.getCheckpoint();
    var passed = checkpoint["state"].equals("complete_pending")
        && after["state"].equals("complete_pending") && f.recorder.saves == 1
        && f.recorder.starts == 1 && f.api.flushCount == 1 && f.store.getEvents().size() == 2;
    f.close();
    var last = new RefreshTestFixture(1);
    last.view.primaryAction();
    passed = passed && last.api.flushCount == 1 && last.recorder.saves == 0;
    last.close(); return passed;
}

(:test)
function testRemoteCurrentCompletionAdvancesWithoutDuplicateLap(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow();
    var incoming = refreshTestWorkout(4, 61.23, 20);
    incoming["exercises"][0]["sets"][0]["completed"] = true;
    f.api.replyWorkout(incoming);
    var after = f.store.getCheckpoint();
    var passed = after["set_id"].equals("set-1") && f.recorder.laps == 0
        && f.recorder.starts == 1 && f.recorder.saves == 0;
    f.view.primaryAction();
    passed = passed && f.store.getEvents()[0]["set_id"].equals("set-1") && f.recorder.laps == 1;
    f.close(); return passed;
}

(:test)
function testNullAndStructuralRefreshKeepRecordingAndCheckpoint(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow(); f.api.replyWorkout(null);
    var nullKept = f.view.hasLiveSnapshotConflict() && f.recorder.saves == 0
        && f.store.getCheckpoint()["state"].equals("active");
    f.view.syncNow();
    var changed = refreshTestWorkout(3, 61.23, 20);
    f.api.replyWorkout(changed);
    f.view.primaryAction();
    var passed = nullKept && f.view.hasLiveSnapshotConflict() && f.recorder.laps == 0
        && f.recorder.saves == 0 && f.store.getWorkout()["exercises"][0]["sets"].size() == 4;
    f.close(); return passed;
}

(:test)
function testForegroundRefreshDoesNotPollEveryTickOrWhileHidden(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.onTick();
    var requested = f.api.fetchCount == 2;
    f.api.replyError();
    f.view.onTick(); f.view.onTick();
    var bounded = f.api.fetchCount == 2;
    f.view.onHide(); f.view.onTick();
    var passed = requested && bounded && f.api.fetchCount == 2 && f.recorder.saves == 0;
    f.close(); return passed;
}

(:test)
function testConflictRetryRefreshSurvivesHiddenPostAcknowledgement(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow(); f.view.primaryAction();
    f.api.replyWorkout(null);
    var held = f.view.hasLiveSnapshotConflict() && f.store.getEvents().size() == 1;
    f.view.onHide(); f.view.syncNow(); f.view.onShow();
    var sent = f.api.flushCount == 1;
    f.view.onHide(); f.api.replySynced();
    var before = f.api.fetchCount;
    f.view.onShow();
    var retried = f.api.fetchCount == before + 1;
    var incoming = refreshTestWorkout(4, 61.23, 20);
    incoming["exercises"][0]["sets"][0]["completed"] = true;
    f.api.replyWorkout(incoming);
    var passed = held && sent && retried && !f.view.hasLiveSnapshotConflict()
        && f.recorder.saves == 0 && f.recorder.laps == 1;
    f.close(); return passed;
}

(:test)
function testLiveDirtyRepsKeepRemoteWeightAndAckReleasesDraft(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.adjustReps(2);
    f.view.syncNow(); f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var set = f.store.getWorkout()["exercises"][0]["sets"][0];
    var retained = set["reps"] == 6 && set["weight_kg"] == 61.23;
    f.view.primaryAction(); f.api.replySynced();
    f.view.syncNow();
    var incoming = refreshTestWorkout(4, 70.0, 12);
    incoming["exercises"][0]["sets"][0]["completed"] = true;
    f.api.replyWorkout(incoming);
    var fresh = f.store.getWorkout()["exercises"][0]["sets"][0];
    var passed = retained && fresh["reps"] == 12 && fresh["weight_kg"] == 70.0
        && fresh["_watch_dirty"] == null && f.recorder.saves == 0;
    f.close(); return passed;
}

(:test)
function testAllDoneRefreshReconcilesServerWithoutNewFit(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(1);
    f.view.primaryAction(); f.api.replySynced();
    f.view.syncNow(); f.api.replyWorkout(refreshTestWorkout(1, 61.23, 20));
    var passed = f.view.canEditCurrentSet() && f.store.getCheckpoint()["state"].equals("active")
        && f.recorder.laps == 1 && f.recorder.starts == 1 && f.recorder.saves == 0;
    f.close(); return passed;
}

(:debug)
function refreshTestRepeat(value, count) {
    var text = "";
    for (var i = 0; i < count; i += 1) { text += value; }
    return text;
}

(:debug)
function refreshTestLargeWorkout() {
    var exercises = [];
    var counter = 0;
    for (var e = 0; e < 24; e += 1) {
        var sets = [];
        var count = e < 12 ? 3 : 2;
        for (var s = 0; s < count; s += 1) {
            sets.add({"id" => "11111111-1111-4111-8111-" + counter.format("%012d"),
                "set_number" => s + 1, "weight_kg" => 61.23, "reps" => 20,
                "rpe" => 8, "completed" => false, "is_warmup" => false, "rest_seconds" => 60});
            counter += 1;
        }
        exercises.add({"id" => "22222222-2222-4222-8222-" + e.format("%012d"),
            "name" => refreshTestRepeat("n", 77) + e.format("%03d"),
            "target_reps" => refreshTestRepeat("4", 40), "rest_seconds" => 60,
            "load_guidance" => refreshTestRepeat("g", 97) + refreshTestRepeat("é", 140) + e.format("%03d"),
            "sets" => sets});
    }
    return {"id" => "refresh-session", "title" => refreshTestRepeat("t", 80),
        "focus" => refreshTestRepeat("f", 160), "started_at" => "2026-09-12T23:27:56Z",
        "exercises" => exercises, "_watch_drafts_version" => 1};
}

(:test)
function testRefreshNearLimitSnapshotStoresAllSparseDrafts(logger as Test.Logger) as Boolean {
    // API-equivalent envelope is 24,283 UTF-8 bytes before watch metadata:
    // 24 exercises, 60 sets, UUID IDs and bounded multibyte guidance.
    var local = refreshTestLargeWorkout();
    for (var e = 0; e < local["exercises"].size(); e += 1) {
        var sets = local["exercises"][e]["sets"];
        for (var s = 0; s < sets.size(); s += 1) {
            WorkoutRefresh.edit(sets[s], "weight_kg", 65.0);
            WorkoutRefresh.edit(sets[s], "reps", 12);
            WorkoutRefresh.edit(sets[s], "rpe", 9.0);
        }
    }
    var merged = WorkoutRefresh.merge(local, refreshTestLargeWorkout(), []);
    local = null;
    var store = new WorkoutStore();
    var stored = store.setWorkout(merged);
    merged = null;
    var reread = store.getWorkout();
    var passed = stored && reread["exercises"].size() == 24
        && reread["exercises"][23]["sets"][1]["weight_kg"] == 65.0
        && reread["exercises"][23]["sets"][1]["_watch_dirty"]["rpe"] == true;
    store.setWorkout(null);
    return passed;
}

(:test)
function testRemoteCompletionCannotAdvancePastUnsentWatchDraft(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.adjustReps(2);
    f.view.syncNow();
    var incoming = refreshTestWorkout(4, 61.23, 20);
    incoming["exercises"][0]["sets"][0]["completed"] = true;
    f.api.replyWorkout(incoming);
    var set = f.store.getWorkout()["exercises"][0]["sets"][0];
    var passed = f.view.hasLiveSnapshotConflict() && set["reps"] == 6
        && set["completed"] == false && f.store.getCheckpoint()["set_id"].equals("set-0")
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testRefreshStatusReportsNetworkHttpAndAppliedWithoutChangingFit(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow(); f.api.replyError();
    var network = f.view.refreshStatusLabel().equals("GET network -104");
    f.view.syncNow(); f.api.replyFailure("fetch_error", 302);
    var redirect = f.view.refreshStatusLabel().equals("GET HTTP 302");
    f.view.syncNow(); f.api.replyFailure("unauthorized", 401);
    var unauthorized = f.view.refreshStatusLabel().equals("HTTP 401");
    f.api.paired = false; f.view.syncNow();
    var blocked = f.view.refreshStatusLabel().equals("401: pair after workout");
    f.api.paired = true; f.view.syncNow(); f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var passed = network && redirect && unauthorized && blocked
        && f.view.refreshStatusLabel().equals("Snapshot applied (200)")
        && f.store.getWorkout()["exercises"][0]["sets"][0]["reps"] == 20
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testRefreshStatusDistinguishesHiddenResponseAndIgnoresOlderCallback(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow();
    var oldCallback = f.api.callback;
    f.view.onHide(); f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    var skipped = f.view.refreshStatusLabel().equals("Response skipped (200)")
        && f.store.getWorkout()["exercises"][0]["sets"][0]["weight_kg"] == null;
    f.view.onShow(); f.view.syncNow(); f.api.replyError();
    oldCallback.invoke("workout", {"schema_version" => 1, "workout" => refreshTestWorkout(4, 61.23, 20)}, 200);
    var passed = skipped && f.view.refreshStatusLabel().equals("GET network -104")
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testRefreshStatusMenuInspectionAndSelectionHaveNoCommandEffect(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.api.localOrigin = false; f.view.syncNow();
    var before = f.api.fetchCount;
    var checkpoint = f.store.getCheckpoint();
    var menu = new IronDeskMenu(f.view);
    var item = menu.getItem(0);
    var delegate = new IronDeskMenuDelegate(f.view);
    delegate.onSelect(item);
    var origin = item.getLabel().equals("Refresh status")
        && item.getSubLabel().equals("Server origin differs");
    f.api.paired = false; f.view.syncNow();
    var passed = origin && f.view.refreshStatusLabel().equals("Pair after workout")
        && f.api.fetchCount == before && f.api.flushCount == 0 && f.store.getEvents().size() == 0
        && f.store.getCheckpoint()["started_at"] == checkpoint["started_at"]
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testRefreshStatusDoesNotClaimChangedWorkoutWasApplied(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    f.view.syncNow(); f.api.replyWorkout(null);
    var passed = f.view.refreshStatusLabel().equals("Server workout changed")
        && f.view.hasLiveSnapshotConflict() && f.store.getWorkout() != null
        && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testSavedServerSettingIsNotMigratedOrGivenOtherOriginToken(logger as Test.Logger) as Boolean {
    var previous = Properties.getValue("apiBaseUrl");
    var store = new WorkoutStore();
    var token = "local-test-token-not-a-credential";
    Properties.setValue("apiBaseUrl", "https://legacy.example");
    store.setToken(token); store.setPairedBaseUrl("https://legacy.example");
    var api = new IronDeskApi(store);
    var retained = Properties.getValue("apiBaseUrl").equals("https://legacy.example")
        && api.isPairedToCurrentBaseUrl();
    Properties.setValue("apiBaseUrl", "https://irondeskpro.com");
    var blocked = !api.isPairedToCurrentBaseUrl() && !api.fetchActive(null)
        && store.getToken().equals(token)
        && store.getPairedBaseUrl().equals("https://legacy.example");
    Properties.setValue("apiBaseUrl", previous);
    store.clearToken(); store.clearPairedBaseUrl();
    return retained && blocked;
}

(:debug)
class RefreshTestDrawingContext {
    var messages = [];
    function setColor(foreground, background) {}
    function clear() {}
    function getWidth() { return 280; }
    function getHeight() { return 280; }
    function getFontHeight(font) { return 16; }
    function fillCircle(x, y, radius) {}
    function drawText(x, y, font, text, flags) { messages.add(text); }
}

(:test)
function testStartupCompatibilityReasonsRemainActionableWithoutSizeClaim(logger as Test.Logger) as Boolean {
    var reasons = [
        "RPE must be blank or a number from 1 to 10 in 0.5 increments.",
        "Garmin supports at most 60 total sets in one active workout.",
        "Shorten Garmin target-rep guidance to 40 characters or fewer."
    ];
    var passed = true;
    for (var i = 0; i < reasons.size(); i += 1) {
        var store = new WorkoutStore(); store.clearProtectedServerData();
        var api = new RefreshTestApi(store);
        var recorder = new RefreshTestRecorder();
        var view = new IronDeskView({"store" => store, "api" => api, "recorder" => recorder});
        view.onShow(); api.replyResult("workout_incompatible", {"error" => reasons[i]}, 422);
        var dc = new RefreshTestDrawingContext();
        view.onUpdate(dc);
        var neutral = false;
        for (var m = 0; m < dc.messages.size(); m += 1) {
            if (dc.messages[m].equals("Workout not compatible\nEdit it in IronDesk")) { neutral = true; }
        }
        passed = passed && neutral && view.refreshStatusLabel().equals("422: " + reasons[i])
            && store.getWorkout() == null && store.getCheckpoint() == null && store.getEvents().size() == 0
            && api.flushCount == 0 && recorder.starts == 0 && recorder.saves == 0 && recorder.laps == 0;
        view.onHide(); store.clearProtectedServerData();
    }
    return passed;
}

(:test)
function testCompatibilityReasonMalformedFallbackAndBoundedControlNormalization(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    var malformed = [null, {}, {"error" => 42}, {"error" => ""}, {"error" => "\r\n\t"}];
    var passed = true;
    for (var i = 0; i < malformed.size(); i += 1) {
        f.view.onApiResult("workout_incompatible", malformed[i], 422);
        passed = passed && f.view.refreshStatusLabel().equals("Workout incompatible (422)");
    }
    var controls = " \r\n RPE\t\t must" + 0.toChar().toString() + 127.toChar().toString()
        + 8232.toChar().toString() + " be valid. \t";
    f.view.onApiResult("workout_incompatible", {"error" => controls}, 422);
    passed = passed && f.view.refreshStatusLabel().equals("422: RPE must be valid.");
    f.view.onApiResult("workout_incompatible", {"error" => refreshTestRepeat("x", 1000)}, 422);
    passed = passed && f.view.refreshStatusLabel().length() == 120
        && f.view.refreshStatusLabel().equals("422: " + refreshTestRepeat("x", 115))
        && f.store.getWorkout()["exercises"][0]["sets"][0]["weight_kg"] == null
        && f.store.getEvents().size() == 0 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

(:test)
function testLiveCompatibilityReasonKeepsStateAndHonorsHiddenAndNewerResponses(logger as Test.Logger) as Boolean {
    var f = new RefreshTestFixture(4);
    var reason = "Shorten Garmin target-rep guidance to 40 characters or fewer.";
    var before = f.store.getCheckpoint();
    f.view.syncNow();
    f.api.replyResult("workout_incompatible", {"error" => reason}, 422);
    var visible = f.view.refreshStatusLabel().equals("422: " + reason) && f.view.canEditCurrentSet();
    f.view.syncNow(); var oldCallback = f.api.callback;
    f.view.onHide(); f.api.replyResult("workout_incompatible", {"error" => reason}, 422);
    var hiddenStatus = f.view.refreshStatusLabel().equals("422: " + reason);
    f.view.onShow(); f.view.syncNow(); f.api.replyWorkout(refreshTestWorkout(4, 61.23, 20));
    oldCallback.invoke("workout_incompatible", {"error" => "Old failure"}, 422);
    var after = f.store.getCheckpoint();
    var passed = visible && hiddenStatus && f.view.refreshStatusLabel().equals("Snapshot applied (200)")
        && after["state"].equals("active") && after["started_at"] == before["started_at"]
        && after["set_id"].equals(before["set_id"]) && f.store.getEvents().size() == 0
        && f.api.flushCount == 0 && f.recorder.starts == 1 && f.recorder.saves == 0 && f.recorder.laps == 0;
    f.close(); return passed;
}

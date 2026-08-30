import Toybox.Lang;
import Toybox.Activity;
import Toybox.Test;

(:test)
function testRoundToHalf(logger as Test.Logger) as Boolean {
    var passed = IronDeskMath.roundToHalf(1.24) == 1.0
        && IronDeskMath.roundToHalf(1.26) == 1.5
        && IronDeskMath.roundToHalf(101.75) == 102.0;
    if (!passed) {
        logger.error("Half-unit rounding did not match the workout editor contract.");
    }
    return passed;
}

(:test)
function testDurationFormatting(logger as Test.Logger) as Boolean {
    var passed = IronDeskMath.formatDuration(0).equals("0:00")
        && IronDeskMath.formatDuration(65).equals("1:05")
        && IronDeskMath.formatDuration(3600).equals("60:00");
    if (!passed) {
        logger.error("Rest duration formatting produced an unexpected value.");
    }
    return passed;
}

(:test)
function testQueueRejectsOverflowWithoutDropping(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearEvents();
    store.clearQuarantinedEvents();
    var accepted = true;
    for (var i = 0; i < 64; i += 1) {
        accepted = accepted && store.queueEvent({"event_id" => "test-" + i.toString()});
    }
    var overflowRejected = !store.queueEvent({"event_id" => "test-overflow"});
    var countPreserved = store.getEvents().size() == 64;
    store.clearEvents();
    if (!accepted || !overflowRejected || !countPreserved) {
        logger.error("The pending-event queue lost data or accepted an unsafe overflow.");
    }
    return accepted && overflowRejected && countPreserved;
}

(:test)
function testRejectedEventsCanBeRestoredWithoutDuplicates(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearEvents();
    store.clearQuarantinedEvents();
    var event = {"event_id" => "restore-test-1", "session_id" => "session-test"};
    var queued = store.queueEvent(event);
    var quarantined = store.quarantineEventsByIds(["restore-test-1"], 409);
    var isolated = store.getEvents().size() == 0 && store.getQuarantinedCount() == 1;
    var restored = store.restoreQuarantinedEvents() == 1;
    var restoredOnce = store.getEvents().size() == 1 && store.getQuarantinedCount() == 0;
    store.clearEvents();
    store.clearQuarantinedEvents();
    if (!queued || !quarantined || !isolated || !restored || !restoredOnce) {
        logger.error("Rejected recovery queued=" + queued.toString() + " quarantined=" + quarantined.toString() + " isolated=" + isolated.toString() + " restored=" + restored.toString() + " restoredOnce=" + restoredOnce.toString());
    }
    return queued && quarantined && isolated && restored && restoredOnce;
}

(:test)
function testRemoveAcknowledgedEventsKeepsNewerQueueEntries(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearEvents();
    store.clearQuarantinedEvents();
    store.queueEvent({"event_id" => "sent-event-1"});
    store.queueEvent({"event_id" => "new-event-2"});
    var removed = store.removeEventsByIds(["sent-event-1"]);
    var events = store.getEvents();
    var passed = removed && events.size() == 1 && events[0]["event_id"].equals("new-event-2");
    store.clearEvents();
    if (!passed) {
        logger.error("Acknowledgement cleanup removed=" + removed.toString() + " count=" + events.size().toString() + " ids=" + (events.size() > 0 ? events[0]["event_id"].toString() : "empty"));
    }
    return passed;
}

(:test)
function testQueueTreatsSameEventIdAsIdempotent(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearEvents();
    store.clearQuarantinedEvents();
    var first = store.queueEvent({"event_id" => "same-event-1", "payload" => {"reps" => 5}});
    var replay = store.queueEvent({"event_id" => "same-event-1", "payload" => {"reps" => 5}});
    var passed = first && replay && store.getEvents().size() == 1;
    store.clearEvents();
    if (!passed) {
        logger.error("A local event retry created a duplicate queue entry.");
    }
    return passed;
}

(:test)
function testFitRecoveryDoesNotCreateAnEmptyActivity(logger as Test.Logger) as Boolean {
    var before = Activity.getActivityInfo().timerState;
    if (before != Activity.TIMER_STATE_OFF) {
        // Another simulator test or activity owns the recorder; this guard is
        // specifically concerned with the no-active-recording state.
        return true;
    }
    var recorder = new FitRecorder();
    var recovered = recorder.recoverAndSave();
    var after = Activity.getActivityInfo().timerState;
    var passed = !recovered && !recorder.hasSession() && after == Activity.TIMER_STATE_OFF;
    if (!passed) {
        logger.error("FIT recovery created or saved an empty Garmin activity.");
    }
    return passed;
}

(:test)
function testFinishingCheckpointPreservesCompletionIntent(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearCheckpoint();
    var stored = store.setCheckpoint({
        "session_id" => "finish-session",
        "state" => "finishing",
        "fit_expected" => true,
        "finish_event_id" => "finish-event",
        "finish_occurred_at" => 123456,
        "finish_payload" => {"avg_hr" => 120, "max_hr" => 160}
    });
    var restored = store.getCheckpoint();
    var passed = stored
        && restored instanceof Dictionary
        && restored["state"].equals("finishing")
        && restored["fit_expected"] == true
        && restored["finish_event_id"].equals("finish-event")
        && restored["finish_occurred_at"] == 123456;
    store.clearCheckpoint();
    if (!passed) {
        logger.error("The finishing checkpoint did not retain its completion identity.");
    }
    return passed;
}

(:test)
function testProtectedServerDataKeepsItsOriginUntilExplicitCleanup(logger as Test.Logger) as Boolean {
    var store = new WorkoutStore();
    store.clearProtectedServerData();
    var originStored = store.setDataBaseUrl("https://server-a.example");
    var queued = store.queueEvent({"event_id" => "origin-event", "session_id" => "origin-session"});
    var protectedBefore = store.hasProtectedServerData();
    var originBefore = store.getDataBaseUrl();
    var cleared = store.clearProtectedServerData();
    var passed = originStored
        && queued
        && protectedBefore
        && originBefore instanceof String
        && originBefore.equals("https://server-a.example")
        && cleared
        && !store.hasProtectedServerData()
        && store.getDataBaseUrl() == null;
    if (!passed) {
        logger.error("Protected workout events lost or silently rebound their server origin.");
    }
    return passed;
}

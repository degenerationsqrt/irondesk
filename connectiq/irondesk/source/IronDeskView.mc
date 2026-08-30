import Toybox.Application.Properties;
import Toybox.Attention;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

class IronDeskView extends WatchUi.View {
    const COLOR_BG = 0x05080D;
    const COLOR_PANEL = 0x111A25;
    const COLOR_PRIMARY = 0x2196F3;
    const COLOR_SUCCESS = 0x38D996;
    const COLOR_WARNING = 0xF2B84B;
    const COLOR_MUTED = 0x94A3B8;

    private var _store;
    private var _api;
    private var _recorder;
    private var _timer;
    private var _state = "loading";
    private var _message = "Opening IronDesk";
    private var _workout = null;
    private var _exerciseIndex = 0;
    private var _setIndex = 0;
    private var _restEndsAt = 0;
    private var _startedAt = 0;
    private var _online = true;
    private var _hasBootstrapped = false;
    private var _refreshAfterSync = false;
    private var _interruptedFitSaved = false;
    private var _storageOkay = true;
    private var _reconcilingResume = false;
    private var _resumeHadWarning = false;
    private var _resumeConflictWorkout = null;
    private var _resumeConflictCanAccept = false;
    private var _conflictCompletion = false;
    private var _pendingConflictAfterFit = false;
    private var _pendingFinishEventId = null;
    private var _pendingFinishPayload = null;
    private var _pendingFinishOccurredAt = 0;
    private var _fitExpected = false;

    function initialize() {
        View.initialize();
        _store = new WorkoutStore();
        _api = new IronDeskApi(_store);
        _recorder = new FitRecorder();
        _timer = new Timer.Timer();
    }

    function onShow() {
        _timer.start(method(:onTick), 1000, true);
        if (!_hasBootstrapped) {
            _hasBootstrapped = true;
            bootstrap();
        }
    }

    function onHide() {
        _timer.stop();
    }

    function onAppStop() {
        if (_state.equals("finishing")) {
            if (!_fitExpected || _interruptedFitSaved) {
                _state = "finish_queue_error";
                persistCheckpoint();
            } else if (_recorder.hasRecoverableSession() && _recorder.recoverAndSave()) {
                _interruptedFitSaved = true;
                _state = "finish_queue_error";
                _store.setFitSaveWarning(false);
                persistCheckpoint();
            } else {
                _state = "complete_fit_error";
                _store.setFitSaveWarning(true);
                persistCheckpoint();
            }
            return;
        }
        if ((_state.equals("complete_fit_error") || _store.hasFitSaveWarning()) && _recorder.hasSession()) {
            if (_recorder.stopAndSave()) {
                _interruptedFitSaved = true;
                _state = "finish_queue_error";
                _store.setFitSaveWarning(false);
                persistCheckpoint();
            }
            return;
        }
        if (_state.equals("cleanup_error") && _recorder.hasSession()) {
            if (_recorder.discard()) {
                _store.clearCheckpoint();
            } else {
                persistCheckpoint();
            }
            return;
        }
        if (_recorder.hasSession() || isWorkoutRunning()) {
            interruptRecording();
        }
    }

    function onSettingsChanged() {
        if (_api.invalidatePairingIfOriginChanged()) {
            if (isWorkoutRunning()) {
                interruptRecording();
            }
            _state = "not_paired";
            _message = "Server changed\nPair this watch again";
            WatchUi.requestUpdate();
            return;
        }
        if (isWorkoutRunning() || _state.equals("interrupted") || _state.equals("interrupted_fit_error") || _state.equals("all_done_interrupted") || _state.equals("complete_pending") || _state.equals("complete_fit_error") || _state.equals("complete_fit_uncertain") || _state.equals("finishing")) {
            _message = "Settings saved";
            WatchUi.requestUpdate();
            return;
        }
        bootstrap();
    }

    function bootstrap() {
        _reconcilingResume = false;
        _resumeHadWarning = false;
        _resumeConflictWorkout = null;
        _resumeConflictCanAccept = false;
        _conflictCompletion = false;
        _pendingConflictAfterFit = false;
        if (_store.hasFitSaveWarning()) {
            if (useCachedWorkoutForRecovery("Recovering finished workout")) {
                _state = "complete_fit_error";
                _message = "Garmin FIT save failed\nSelect to recover";
            }
            WatchUi.requestUpdate();
            return;
        }
        if (!_api.hasBaseUrl()) {
            _state = "server_missing";
            _message = "Set IronDesk server URL\nin Garmin Connect";
            WatchUi.requestUpdate();
            return;
        }
        if (!_api.isPairedToCurrentBaseUrl()) {
            _api.invalidatePairingIfOriginChanged();
            var code = Properties.getValue("pairingCode");
            if (code == null || code.toString().length() == 0) {
                _state = "not_paired";
                _message = "Add your pairing code\nin Garmin Connect";
                WatchUi.requestUpdate();
                return;
            }
            _state = "loading";
            _message = "Pairing watch";
            _api.pair(code, method(:onApiResult));
            WatchUi.requestUpdate();
            return;
        }
        if (_store.getQuarantinedCount() > 0 && _store.getCheckpoint() == null) {
            _reconcilingResume = true;
            _resumeHadWarning = true;
            _state = "loading";
            _message = "Checking rejected changes";
            fetchResumeStatus();
            return;
        }
        if (_store.getCheckpoint() != null && _store.getWorkout() != null) {
            useCachedWorkout("Restoring workout");
            if (_state.equals("complete_fit_error")) {
                WatchUi.requestUpdate();
                return;
            }
            if (_state.equals("complete_fit_uncertain")) {
                WatchUi.requestUpdate();
                return;
            }
            if (_state.equals("finishing")) {
                recoverFinishingWorkout();
                return;
            }
            if (_state.equals("finish_queue_error")) {
                queueFinishedWorkout();
                return;
            }
            if (_state.equals("complete_pending")) {
                _conflictCompletion = true;
                if (_store.getQuarantinedCount() > 0) {
                    _reconcilingResume = true;
                    _resumeHadWarning = true;
                }
                if (_store.getEvents().size() > 0 && _api.flushEvents(method(:onApiResult))) {
                    WatchUi.requestUpdate();
                    return;
                }
                _reconcilingResume = true;
                fetchResumeStatus();
                return;
            }
            beginResumeReconciliation();
            return;
        }
        refreshWorkout();
    }

    function refreshWorkout() {
        _state = "loading";
        _message = "Syncing workout";
        if (_store.getEvents().size() > 0) {
            _refreshAfterSync = true;
            if (_api.flushEvents(method(:onApiResult))) {
                WatchUi.requestUpdate();
                return;
            }
            _refreshAfterSync = false;
        }
        if (!_api.fetchActive(method(:onApiResult))) {
            useCachedWorkout("Offline cache");
        }
        WatchUi.requestUpdate();
    }

    private function beginResumeReconciliation() {
        if (!useCachedWorkout("Resume cached workout")) {
            _reconcilingResume = true;
            _resumeHadWarning = _store.getQuarantinedCount() > 0;
            _resumeConflictWorkout = null;
            _resumeConflictCanAccept = false;
            fetchResumeStatus();
            return;
        }
        _reconcilingResume = true;
        _resumeHadWarning = _store.getQuarantinedCount() > 0;
        _resumeConflictWorkout = null;
        _resumeConflictCanAccept = false;
        _state = "loading";
        _message = "Checking workout status";
        if (_store.getEvents().size() > 0 && _api.flushEvents(method(:onApiResult))) {
            WatchUi.requestUpdate();
            return;
        }
        fetchResumeStatus();
    }

    private function fetchResumeStatus() {
        if (!_api.fetchActive(method(:onApiResult))) {
            resumeOffline("Offline resume");
            return false;
        }
        _state = "loading";
        _message = "Checking workout status";
        WatchUi.requestUpdate();
        return true;
    }

    private function finishResumeReconciliation(incomingWorkout) {
        var cachedWorkout = _store.getWorkout();
        _reconcilingResume = false;
        if (_resumeHadWarning) {
            _resumeHadWarning = false;
            _resumeConflictWorkout = incomingWorkout;
            _resumeConflictCanAccept = true;
            _state = "resume_conflict";
            _message = _store.getQuarantinedCount().toString() + " changes rejected\nOpen MENU for options";
            return;
        }
        if (_conflictCompletion && incomingWorkout == null) {
            _conflictCompletion = false;
            _resumeConflictWorkout = null;
            _resumeConflictCanAccept = false;
            finalizeCompletion();
            return;
        }
        if (cachedWorkout != null && incomingWorkout != null && isValidWorkout(cachedWorkout) && cachedWorkout["id"].equals(incomingWorkout["id"])) {
            _workout = incomingWorkout;
            if (!_store.setWorkout(_workout)) {
                _state = "error";
                _message = "Workout is too large\nfor watch storage";
            } else if (!restoreCheckpoint()) {
                _state = "ready";
                _message = "Workout refreshed";
            } else {
                _message = "Server changes applied\nSelect to continue";
            }
            return;
        }
        _resumeConflictWorkout = incomingWorkout;
        _resumeConflictCanAccept = true;
        _state = "resume_conflict";
        _message = incomingWorkout == null ? "Workout ended in IronDesk\nOpen MENU for options" : "Different workout is active\nOpen MENU for options";
    }

    private function resumeOffline(message) {
        _reconcilingResume = false;
        if (_resumeHadWarning) {
            _resumeHadWarning = false;
            _resumeConflictCanAccept = false;
            _state = "resume_conflict";
            _message = _store.getQuarantinedCount().toString() + " changes rejected\nReconnect and retry";
            WatchUi.requestUpdate();
            return;
        }
        useCachedWorkout(message);
        WatchUi.requestUpdate();
    }

    function canAcceptServerConflict() {
        return _state.equals("resume_conflict") && _resumeConflictCanAccept;
    }

    function acceptServerConflict() {
        if (!canAcceptServerConflict()) {
            _message = "Reconnect before using\nserver workout";
            WatchUi.requestUpdate();
            return;
        }
        if (!_store.clearEvents() || !_store.clearQuarantinedEvents()) {
            _storageOkay = false;
            _message = "Cannot clear watch changes\nStorage cleanup failed";
            WatchUi.requestUpdate();
            return;
        }
        if (!_store.clearCheckpoint()) {
            _storageOkay = false;
            _message = "Cannot clear checkpoint\nWatch storage is full";
            WatchUi.requestUpdate();
            return;
        }
        _interruptedFitSaved = false;
        _workout = _resumeConflictWorkout;
        _resumeConflictWorkout = null;
        _resumeConflictCanAccept = false;
        if (_workout == null) {
            if (!_store.setWorkout(null)) {
                _storageOkay = false;
                _state = "error";
                _message = "Cannot clear old workout\nSelect to refresh";
                WatchUi.requestUpdate();
                return;
            }
            if (_conflictCompletion) {
                _state = "complete";
                _message = "Server workout kept\nWatch changes discarded";
            } else {
                _state = "no_workout";
                _message = "Start a workout\nin IronDesk first";
            }
        } else if (!_store.setWorkout(_workout)) {
            _state = "error";
            _message = "Workout is too large\nfor watch storage";
        } else {
            _state = "ready";
            _message = "Server workout ready";
        }
        _conflictCompletion = false;
    }

    private function retryResumeConflict() {
        _reconcilingResume = true;
        _resumeHadWarning = false;
        _state = "loading";
        _message = "Retrying watch changes";
        if (_store.getEvents().size() == 0 && _store.getQuarantinedCount() > 0) {
            if (_store.restoreQuarantinedEvents() == 0) {
                _reconcilingResume = false;
                _state = "resume_conflict";
                _message = "Cannot restore changes\nWatch storage is full";
                return;
            }
        }
        if (_store.getEvents().size() > 0 && _api.flushEvents(method(:onApiResult))) {
            return;
        }
        fetchResumeStatus();
    }

    private function beginRejectedConflict(wasCompletion) {
        _conflictCompletion = wasCompletion;
        if (isWorkoutRunning()) {
            interruptRecording();
            if (_state.equals("interrupted_fit_error")) {
                _pendingConflictAfterFit = true;
                _message = "FIT save and sync failed\nSelect to recover FIT";
                WatchUi.requestUpdate();
                return;
            }
        }
        _reconcilingResume = true;
        _resumeHadWarning = true;
        _resumeConflictWorkout = null;
        _resumeConflictCanAccept = false;
        _state = "loading";
        _message = "Checking rejected changes";
        fetchResumeStatus();
    }

    function onApiResult(kind, data, responseCode) {
        if (kind.equals("paired")) {
            refreshWorkout();
            return;
        }
        if (kind.equals("workout")) {
            _online = true;
            var incomingWorkout = data["workout"];
            if (!isValidWorkout(incomingWorkout)) {
                if (_reconcilingResume) {
                    resumeOffline("Invalid server response");
                    return;
                }
                _state = "error";
                _message = "Invalid workout response\nNothing was changed";
                WatchUi.requestUpdate();
                return;
            }
            if (_reconcilingResume) {
                finishResumeReconciliation(incomingWorkout);
                WatchUi.requestUpdate();
                return;
            }
            _workout = incomingWorkout;
            if (_workout == null) {
                _store.setWorkout(null);
                _state = "no_workout";
                _message = "Start a workout\nin IronDesk first";
            } else {
                if (!_store.setWorkout(_workout)) {
                    _state = "error";
                    _message = "Workout is too large\nfor watch storage";
                    WatchUi.requestUpdate();
                    return;
                }
                if (!restoreCheckpoint()) {
                    _state = "ready";
                    _message = "Workout ready";
                }
                _api.flushEvents(method(:onApiResult));
            }
        } else if (kind.equals("synced")) {
            _online = true;
            if (_reconcilingResume) {
                fetchResumeStatus();
                return;
            } else if (_refreshAfterSync) {
                _refreshAfterSync = false;
                refreshWorkout();
                return;
            } else if (_state.equals("complete_pending")) {
                if (_store.hasFitSaveWarning()) {
                    _state = "complete_fit_error";
                    _message = "IronDesk saved\nGarmin FIT save failed";
                } else {
                    finalizeCompletion();
                }
            } else if (_state.equals("queue_full")) {
                _state = "active";
                _message = "Pending changes synced";
            } else if (_state.equals("finish_queue_error")) {
                queueFinishedWorkout();
                return;
            }
        } else if (kind.equals("unauthorized")) {
            _refreshAfterSync = false;
            _reconcilingResume = false;
            if (isWorkoutRunning()) {
                interruptRecording();
            }
            _state = "not_paired";
            _message = _interruptedFitSaved ? "Partial FIT saved\nPair this watch again" : "Pair this watch again";
        } else if (kind.equals("origin_changed")) {
            _refreshAfterSync = false;
            _reconcilingResume = false;
            _online = false;
            if (isWorkoutRunning()) {
                interruptRecording();
            }
            _state = "not_paired";
            _message = "Server changed\nPair this watch again";
        } else if (kind.equals("server_data_conflict")) {
            _refreshAfterSync = false;
            _reconcilingResume = false;
            _online = false;
            _state = "server_data_conflict";
            _message = "Unsynced data belongs\nto the previous server";
        } else if (kind.equals("fetch_error")) {
            _refreshAfterSync = false;
            _online = false;
            if (_reconcilingResume) {
                resumeOffline("Offline resume");
                return;
            }
            useCachedWorkout("Offline - changes queue");
        } else if (kind.equals("workout_incompatible")) {
            _refreshAfterSync = false;
            _reconcilingResume = false;
            _online = true;
            _state = "workout_incompatible";
            _message = "Workout is too large\nEdit it in IronDesk";
        } else if (kind.equals("sync_error")) {
            var retryRefresh = _refreshAfterSync;
            _refreshAfterSync = false;
            _online = false;
            if (_reconcilingResume) {
                resumeOffline("Offline resume");
                return;
            } else if (_state.equals("complete_pending")) {
                _message = _store.hasFitSaveWarning() ? "FIT save failed\nIronDesk sync pending" : "FIT saved\nIronDesk sync pending";
            } else if (_state.equals("finish_queue_error")) {
                _message = "FIT saved\nFinish sync needs connection";
            } else if (_state.equals("queue_full")) {
                _message = "Connect phone to sync\npending changes";
            } else if (_state.equals("loading")) {
                useCachedWorkout("Offline - changes queue");
                _refreshAfterSync = retryRefresh;
            }
        } else if (kind.equals("sync_warning")) {
            _refreshAfterSync = false;
            _online = true;
            if (_reconcilingResume) {
                _resumeHadWarning = true;
                fetchResumeStatus();
                return;
            }
            if (_state.equals("complete_fit_error")) {
                _pendingConflictAfterFit = true;
                _message = "FIT save and sync failed\nSelect to recover FIT";
                persistCheckpoint();
                WatchUi.requestUpdate();
                return;
            }
            beginRejectedConflict(_state.equals("complete_pending"));
            return;
        } else if (kind.equals("pair_error")) {
            _online = false;
            _state = "not_paired";
            _message = "Pairing failed\nCheck code and server";
        } else if (kind.equals("storage_error")) {
            _state = "error";
            _message = "Watch storage is full\nPairing was not saved";
        }
        WatchUi.requestUpdate();
    }

    private function useCachedWorkout(message) {
        if (_store.getWorkout() != null && !_api.isLocalDataForCurrentBaseUrl()) {
            _state = "server_data_conflict";
            _message = "Cached workout belongs\nto the previous server";
            return false;
        }
        return useCachedWorkoutForRecovery(message);
    }

    private function useCachedWorkoutForRecovery(message) {
        _workout = _store.getWorkout();
        if (_workout == null) {
            _state = "error";
            _message = message + "\nNo cached workout";
            return false;
        } else if (!isValidWorkout(_workout)) {
            _state = "error";
            _message = "Cached workout is invalid\nRefresh from IronDesk";
            return false;
        } else {
            if (!restoreCheckpoint()) {
                _state = "ready";
                _message = message;
            }
        }
        return true;
    }

    function startWorkout() {
        if (_workout == null) {
            refreshWorkout();
            return;
        }
        if (!_api.isLocalDataForCurrentBaseUrl()) {
            _state = "server_data_conflict";
            _message = "Workout belongs to\nthe previous server";
            WatchUi.requestUpdate();
            return;
        }
        findNextIncomplete();
        if (_state.equals("all_done")) {
            _fitExpected = false;
            _state = "all_done_interrupted";
            _message = "All sets already done\nFinish without a new FIT";
            persistCheckpoint();
            WatchUi.requestUpdate();
            return;
        }
        if (!_recorder.start()) {
            _state = "error";
            _message = "Activity recording\nis unavailable";
            WatchUi.requestUpdate();
            return;
        }
        _fitExpected = true;
        _interruptedFitSaved = false;
        _startedAt = Time.now().value();
        _state = "active";
        persistCheckpoint();
        WatchUi.requestUpdate();
    }

    function primaryAction() {
        if (_state.equals("not_paired") || _state.equals("server_missing") || _state.equals("error") || _state.equals("no_workout") || _state.equals("workout_incompatible")) {
            bootstrap();
        } else if (_state.equals("ready") || _state.equals("interrupted")) {
            startWorkout();
        } else if (_state.equals("interrupted_fit_error")) {
            retryInterruptedFitSave();
        } else if (_state.equals("rest")) {
            _restEndsAt = 0;
            _state = "active";
            findNextIncomplete();
        } else if (_state.equals("active")) {
            completeCurrentSet();
        } else if (_state.equals("all_done") || _state.equals("all_done_interrupted")) {
            finishWorkout();
        } else if (_state.equals("complete_pending")) {
            _api.flushEvents(method(:onApiResult));
        } else if (_state.equals("complete_fit_error")) {
            retryFinalFitSave();
        } else if (_state.equals("complete_fit_uncertain") || _state.equals("finishing")) {
            recoverFinishingWorkout();
        } else if (_state.equals("finish_queue_error")) {
            queueFinishedWorkout();
        } else if (_state.equals("terminal_storage_error")) {
            finalizeCompletion();
        } else if (_state.equals("queue_full") || _state.equals("sync_conflict") || _state.equals("complete_warning")) {
            syncNow();
        } else if (_state.equals("resume_conflict")) {
            retryResumeConflict();
        } else if (_state.equals("cleanup_error")) {
            discardWorkout();
        }
        WatchUi.requestUpdate();
    }

    function adjustReps(delta) {
        if (!_state.equals("active")) {
            return;
        }
        var set = currentSet();
        if (set == null) {
            return;
        }
        var reps = numberValue(set["reps"], 0) + delta;
        set["reps"] = clamp(reps, 0, 500);
        persistCheckpoint();
        WatchUi.requestUpdate();
    }

    function adjustWeight(delta) {
        if (!_state.equals("active")) {
            return;
        }
        var set = currentSet();
        if (set == null) {
            return;
        }
        var display = IronDeskMath.kgToDisplay(numberValue(set["weight_kg"], 0.0));
        display = clamp(display + delta, 0.0, 9999.0);
        set["weight_kg"] = IronDeskMath.displayToKg(display);
        persistCheckpoint();
        WatchUi.requestUpdate();
    }

    function adjustRpe(delta) {
        if (!_state.equals("active")) {
            return;
        }
        var set = currentSet();
        if (set == null) {
            return;
        }
        var rpe = numberValue(set["rpe"], 8.0) + delta;
        set["rpe"] = clamp(rpe, 1.0, 10.0);
        persistCheckpoint();
        WatchUi.requestUpdate();
    }

    function syncNow() {
        if (_state.equals("resume_conflict")) {
            retryResumeConflict();
            WatchUi.requestUpdate();
            return;
        }
        if (_store.getEvents().size() == 0 && _store.getQuarantinedCount() > 0) {
            if (_store.restoreQuarantinedEvents() == 0) {
                _message = "Cannot restore rejected\nwatch changes";
                WatchUi.requestUpdate();
                return;
            }
        }
        if (_state.equals("complete_warning")) {
            _state = "complete_pending";
        } else if (_state.equals("sync_conflict")) {
            _state = "active";
        }
        if (!_api.flushEvents(method(:onApiResult))) {
            if (!isWorkoutRunning() && !_state.equals("queue_full")) {
                refreshWorkout();
            } else {
                _message = "No pending changes";
                WatchUi.requestUpdate();
            }
        }
    }

    function finishWorkout() {
        if (_workout == null || (!_state.equals("active") && !_state.equals("all_done") && !_state.equals("all_done_interrupted") && !_state.equals("rest"))) {
            return;
        }
        if (!_store.hasQueueCapacity()) {
            _message = "Sync required\nPending queue is full";
            _api.flushEvents(method(:onApiResult));
            WatchUi.requestUpdate();
            return;
        }
        var priorState = _state;
        var priorStartedAt = _startedAt;
        var priorRestEndsAt = _restEndsAt;
        _pendingFinishEventId = _store.nextEventId(_workout["id"]);
        _pendingFinishOccurredAt = Time.now().value();
        _pendingFinishPayload = _fitExpected ? {
            "avg_hr" => _recorder.getAverageHeartRate(),
            "max_hr" => _recorder.getMaxHeartRate()
        } : {};
        // Persist the completion identity before closing Garmin's FIT Session.
        // The FIT filesystem and Application.Storage cannot be committed in one
        // transaction, so a restart must always retain enough intent to resume.
        _state = "finishing";
        _message = _fitExpected ? "Saving Garmin FIT" : "Finishing IronDesk";
        _startedAt = 0;
        _restEndsAt = 0;
        if (!persistCheckpoint()) {
            _state = priorState;
            _startedAt = priorStartedAt;
            _restEndsAt = priorRestEndsAt;
            _message = "Cannot protect finish\nFree watch storage and retry";
            WatchUi.requestUpdate();
            return;
        }

        var fitSaved = !_fitExpected || _interruptedFitSaved;
        if (_fitExpected && _recorder.hasSession()) {
            fitSaved = _recorder.stopAndSave();
        }
        if (!fitSaved) {
            _state = "complete_fit_error";
            _message = "Garmin FIT save failed\nSelect to recover";
            var warningStored = _store.setFitSaveWarning(true);
            var checkpointStored = persistCheckpoint();
            _storageOkay = warningStored && checkpointStored;
            WatchUi.requestUpdate();
            return;
        }
        _interruptedFitSaved = _fitExpected;
        _state = "finish_queue_error";
        persistCheckpoint();
        if (!_store.setFitSaveWarning(false)) {
            _storageOkay = false;
            _message = "FIT saved; storage full\nSelect to queue finish";
            persistCheckpoint();
            WatchUi.requestUpdate();
            return;
        }
        queueFinishedWorkout();
    }

    private function recoverFinishingWorkout() {
        if (_workout == null || !(_pendingFinishEventId instanceof String)) {
            _state = "finish_queue_error";
            _message = "Finish recovery missing\nOpen IronDesk to verify";
            WatchUi.requestUpdate();
            return;
        }
        if (hasPendingFinishEvent()) {
            _interruptedFitSaved = _fitExpected;
            _state = "complete_pending";
            _message = _fitExpected ? "FIT saved\nIronDesk sync pending" : "IronDesk sync pending";
            _store.setFitSaveWarning(false);
            persistCheckpoint();
            _api.flushEvents(method(:onApiResult));
            WatchUi.requestUpdate();
            return;
        }
        if (!_fitExpected || _interruptedFitSaved) {
            _state = "finish_queue_error";
            _store.setFitSaveWarning(false);
            persistCheckpoint();
            queueFinishedWorkout();
            return;
        }
        if (!_recorder.hasRecoverableSession()) {
            _state = "complete_fit_uncertain";
            _message = "FIT status is uncertain\nCheck Activities, then MENU";
            persistCheckpoint();
            WatchUi.requestUpdate();
            return;
        }
        if (_recorder.recoverAndSave()) {
            _interruptedFitSaved = true;
            _state = "finish_queue_error";
            _store.setFitSaveWarning(false);
            persistCheckpoint();
            queueFinishedWorkout();
            return;
        }
        _state = "complete_fit_error";
        _message = "Garmin FIT save failed\nSelect to recover";
        _store.setFitSaveWarning(true);
        persistCheckpoint();
        WatchUi.requestUpdate();
    }

    private function hasPendingFinishEvent() {
        var events = _store.getEvents();
        for (var i = 0; i < events.size(); i += 1) {
            var eventId = events[i]["event_id"];
            if (eventId != null && _pendingFinishEventId != null && eventId.toString().equals(_pendingFinishEventId.toString())) {
                return true;
            }
        }
        return false;
    }

    private function queueFinishedWorkout() {
        if (_workout == null || !(_pendingFinishEventId instanceof String)) {
            _state = "finish_queue_error";
            _message = "Finish recovery missing\nOpen IronDesk to verify";
            WatchUi.requestUpdate();
            return;
        }
        if (!(_pendingFinishPayload instanceof Dictionary)) {
            _pendingFinishPayload = {};
        }
        var queued = _store.queueEvent({
            "event_id" => _pendingFinishEventId,
            "session_id" => _workout["id"],
            "type" => "workout.finished",
            "occurred_at" => _pendingFinishOccurredAt > 0 ? _pendingFinishOccurredAt : Time.now().value(),
            "payload" => _pendingFinishPayload
        });
        if (!queued) {
            _state = "finish_queue_error";
            _message = "FIT saved\nFinish queue needs space";
            persistCheckpoint();
            _api.flushEvents(method(:onApiResult));
            WatchUi.requestUpdate();
            return;
        }
        _state = "complete_pending";
        _message = "FIT saved\nSyncing IronDesk";
        persistCheckpoint();
        if (!_api.flushEvents(method(:onApiResult))) {
            _message = "FIT saved\nIronDesk sync pending";
        }
        WatchUi.requestUpdate();
    }

    private function finalizeCompletion() {
        var checkpointCleared = _store.clearCheckpoint();
        var workoutCleared = _store.setWorkout(null);
        var dataOriginCleared = _store.getEvents().size() == 0 && _store.getQuarantinedCount() == 0 && _store.clearDataBaseUrl();
        _pendingFinishEventId = null;
        _pendingFinishPayload = null;
        _pendingFinishOccurredAt = 0;
        _interruptedFitSaved = false;
        if (checkpointCleared && workoutCleared && dataOriginCleared) {
            _state = "complete";
            _message = "Saved to IronDesk";
        } else {
            _storageOkay = false;
            _state = "terminal_storage_error";
            _message = "IronDesk saved\nSelect to clean storage";
        }
        WatchUi.requestUpdate();
    }

    function hasFinalFitError() {
        return _state.equals("complete_fit_error");
    }

    function hasUncertainFinalFit() {
        return _state.equals("complete_fit_uncertain");
    }

    function hasServerDataConflict() {
        return _state.equals("server_data_conflict");
    }

    function showPreviousServerHelp() {
        _message = "Restore the previous URL\nto sync or recover";
        WatchUi.requestUpdate();
    }

    function discardPreviousServerData() {
        if (!_state.equals("server_data_conflict")) {
            return;
        }
        if (_recorder.hasRecoverableSession()) {
            if (!_recorder.recoverAndSave()) {
                _message = "Cannot save open FIT\nOld data was kept";
                WatchUi.requestUpdate();
                return;
            }
            _interruptedFitSaved = true;
            _startedAt = 0;
            _restEndsAt = 0;
            _state = "interrupted";
            if (!persistCheckpoint()) {
                _message = "FIT saved; old data kept\nWatch storage error";
                WatchUi.requestUpdate();
                return;
            }
        }
        if (!_store.clearProtectedServerData()) {
            _storageOkay = false;
            _message = "Cannot clear old data\nWatch storage error";
            WatchUi.requestUpdate();
            return;
        }
        _workout = null;
        _pendingFinishEventId = null;
        _pendingFinishPayload = null;
        _pendingFinishOccurredAt = 0;
        _interruptedFitSaved = false;
        _fitExpected = false;
        _startedAt = 0;
        _restEndsAt = 0;
        _state = "loading";
        _message = "Previous server data cleared";
        bootstrap();
    }

    function isCompletionPending() {
        return _state.equals("finishing") || _state.equals("finish_queue_error") || _state.equals("complete_pending") || _state.equals("complete_warning") || _state.equals("terminal_storage_error");
    }

    function canEditCurrentSet() {
        return _state.equals("active");
    }

    function canFinishFromMenu() {
        return _state.equals("active") || _state.equals("rest") || _state.equals("all_done") || _state.equals("all_done_interrupted");
    }

    function canSyncFromMenu() {
        return _state.equals("active") || _state.equals("rest") || _state.equals("all_done") || _state.equals("all_done_interrupted") || _state.equals("queue_full") || _state.equals("sync_conflict");
    }

    function canDiscardRecording() {
        var discardableState = _state.equals("active") || _state.equals("rest") || _state.equals("all_done") || _state.equals("queue_full") || _state.equals("sync_conflict") || _state.equals("cleanup_error") || _state.equals("interrupted_fit_error");
        return discardableState && _recorder.hasRecoverableSession();
    }

    function confirmUncertainFitSaved() {
        resolveUncertainFit(true);
    }

    function continueWithoutUncertainFit() {
        resolveUncertainFit(false);
    }

    private function resolveUncertainFit(wasSaved) {
        if (!_state.equals("complete_fit_uncertain")) {
            return;
        }
        _interruptedFitSaved = wasSaved;
        if (!_store.setFitSaveWarning(false)) {
            _storageOkay = false;
            _message = "Cannot clear FIT warning\nWatch storage is full";
            WatchUi.requestUpdate();
            return;
        }
        _state = "finish_queue_error";
        persistCheckpoint();
        queueFinishedWorkout();
    }

    function retryFinalFitSave() {
        if (!_recorder.hasRecoverableSession()) {
            _state = "complete_fit_uncertain";
            _message = "No open FIT session\nCheck Activities, then MENU";
            persistCheckpoint();
            return;
        }
        if (!_recorder.recoverAndSave()) {
            _message = "FIT recovery failed\nMENU can discard it";
            return;
        }
        if (!_store.setFitSaveWarning(false)) {
            _storageOkay = false;
            _message = "Cannot clear FIT warning\nWatch storage is full";
            return;
        }
        _interruptedFitSaved = true;
        continueAfterFinalFitResolution();
    }

    function discardFailedFinalFit() {
        if (!_recorder.recoverAndDiscard()) {
            _message = "FIT discard failed\nSelect to retry save";
            WatchUi.requestUpdate();
            return;
        }
        if (!_store.setFitSaveWarning(false)) {
            _storageOkay = false;
            _message = "Cannot clear FIT warning\nWatch storage is full";
            WatchUi.requestUpdate();
            return;
        }
        _interruptedFitSaved = false;
        continueAfterFinalFitResolution();
    }

    private function continueAfterFinalFitResolution() {
        if (_pendingConflictAfterFit) {
            _pendingConflictAfterFit = false;
            _state = "finish_queue_error";
            persistCheckpoint();
            beginRejectedConflict(false);
            return;
        }
        queueFinishedWorkout();
    }

    private function retryInterruptedFitSave() {
        if (!_recorder.recoverAndSave()) {
            _message = "Partial FIT save failed\nMENU can discard it";
            return;
        }
        _interruptedFitSaved = true;
        _state = "interrupted";
        _message = _interruptedFitSaved ? "Partial FIT saved\nSelect to continue" : "FIT unavailable; data kept\nSelect to continue";
        persistCheckpoint();
        if (_pendingConflictAfterFit) {
            _pendingConflictAfterFit = false;
            beginRejectedConflict(false);
        }
    }

    function discardWorkout() {
        if (!canDiscardRecording()) {
            _message = "No open Garmin FIT\nNothing was discarded";
            WatchUi.requestUpdate();
            return;
        }
        var hadSession = _recorder.hasSession();
        var needsRecovery = _state.equals("interrupted_fit_error") || _state.equals("cleanup_error");
        var discarded = hadSession ? _recorder.discard() : (needsRecovery ? _recorder.recoverAndDiscard() : true);
        if (!discarded) {
            _state = "cleanup_error";
            _message = "FIT discard failed\nSelect to retry";
            persistCheckpoint();
            WatchUi.requestUpdate();
            return;
        }
        _startedAt = 0;
        _restEndsAt = 0;
        _interruptedFitSaved = false;
        _store.clearCheckpoint();
        _message = hadSession || needsRecovery ? "FIT recording discarded" : "Watch session cleared";
        refreshWorkout();
    }

    private function completeCurrentSet() {
        var set = currentSet();
        var exercise = currentExercise();
        if (set == null || exercise == null) {
            _state = "all_done";
            return;
        }
        if (!_store.hasQueueCapacity()) {
            _state = "queue_full";
            _message = "Sync required\nPending queue is full";
            WatchUi.requestUpdate();
            return;
        }
        var queued = _store.queueEvent({
            "event_id" => _store.nextEventId(set["id"]),
            "session_id" => _workout["id"],
            "set_id" => set["id"],
            "type" => "set.updated",
            "occurred_at" => Time.now().value(),
            "payload" => {
                "weight_kg" => set["weight_kg"],
                "reps" => set["reps"],
                "rpe" => set["rpe"],
                "completed" => true,
                "rest_seconds" => set["rest_seconds"]
            }
        });
        if (!queued) {
            _state = "queue_full";
            _message = "Sync required\nSet was not completed";
            WatchUi.requestUpdate();
            return;
        }
        set["completed"] = true;
        _recorder.addSetLap();
        var rest = numberValue(exercise["rest_seconds"], numberValue(set["rest_seconds"], 60));
        findNextIncomplete();
        if (_state.equals("all_done")) {
            persistCheckpoint();
            return;
        }
        _restEndsAt = Time.now().value() + rest;
        _state = "rest";
        persistCheckpoint();
        _api.flushEvents(method(:onApiResult));
    }

    private function findNextIncomplete() {
        var exercises = _workout["exercises"];
        for (var i = 0; i < exercises.size(); i += 1) {
            var sets = exercises[i]["sets"];
            for (var j = 0; j < sets.size(); j += 1) {
                if (sets[j]["completed"] != true) {
                    _exerciseIndex = i;
                    _setIndex = j;
                    return;
                }
            }
        }
        _state = "all_done";
    }

    private function currentExercise() {
        if (_workout == null || _workout["exercises"] == null) {
            return null;
        }
        var exercises = _workout["exercises"];
        if (_exerciseIndex < 0 || _exerciseIndex >= exercises.size()) {
            return null;
        }
        return exercises[_exerciseIndex];
    }

    private function currentSet() {
        var exercise = currentExercise();
        if (exercise == null || exercise["sets"] == null) {
            return null;
        }
        var sets = exercise["sets"];
        if (_setIndex < 0 || _setIndex >= sets.size()) {
            return null;
        }
        return sets[_setIndex];
    }

    private function persistCheckpoint() {
        if (_workout == null) {
            return false;
        }
        var workoutSaved = _store.setWorkout(_workout);
        var set = currentSet();
        var checkpointSaved = _store.setCheckpoint({
            "session_id" => _workout["id"],
            "set_id" => set == null ? null : set["id"],
            "exercise_index" => _exerciseIndex,
            "set_index" => _setIndex,
            "rest_ends_at" => _restEndsAt,
            "started_at" => _startedAt,
            "state" => _state,
            "fit_saved" => _interruptedFitSaved,
            "fit_expected" => _fitExpected,
            "finish_event_id" => _pendingFinishEventId,
            "finish_occurred_at" => _pendingFinishOccurredAt,
            "finish_payload" => _pendingFinishPayload,
            "conflict_after_fit" => _pendingConflictAfterFit
        });
        _storageOkay = workoutSaved && checkpointSaved;
        return _storageOkay;
    }

    private function restoreCheckpoint() {
        var checkpoint = _store.getCheckpoint();
        if (!(checkpoint instanceof Dictionary) || _workout == null || !(checkpoint["session_id"] instanceof String) || !checkpoint["session_id"].equals(_workout["id"])) {
            return false;
        }
        var restoredById = false;
        if (checkpoint["set_id"] instanceof String) {
            restoredById = locateSetById(checkpoint["set_id"]);
        }
        if (!restoredById) {
            _exerciseIndex = numberValue(checkpoint["exercise_index"], 0);
            _setIndex = numberValue(checkpoint["set_index"], 0);
            if (currentSet() == null) {
                findNextIncomplete();
            }
        }
        _restEndsAt = numberValue(checkpoint["rest_ends_at"], 0);
        _startedAt = numberValue(checkpoint["started_at"], 0);
        _interruptedFitSaved = checkpoint["fit_saved"] == true;
        _fitExpected = checkpoint.hasKey("fit_expected") ? checkpoint["fit_expected"] == true : (_startedAt > 0 || _interruptedFitSaved);
        _pendingFinishEventId = checkpoint["finish_event_id"];
        _pendingFinishOccurredAt = numberValue(checkpoint["finish_occurred_at"], 0);
        _pendingFinishPayload = checkpoint["finish_payload"];
        _pendingConflictAfterFit = checkpoint["conflict_after_fit"] == true;
        var savedState = checkpoint["state"];
        if (savedState != null && savedState.equals("complete_fit_error")) {
            _state = "complete_fit_error";
            _message = "Garmin FIT save failed\nSelect to recover";
            return true;
        }
        if (savedState != null && savedState.equals("complete_fit_uncertain")) {
            _state = "complete_fit_uncertain";
            _message = "FIT status is uncertain\nCheck Activities, then MENU";
            return true;
        }
        if (savedState != null && savedState.equals("finishing")) {
            _state = "finishing";
            _message = _fitExpected ? "Recovering Garmin FIT" : "Recovering finish";
            return true;
        }
        if (savedState != null && savedState.equals("finish_queue_error")) {
            _state = "finish_queue_error";
            _message = "FIT saved\nSelect to queue finish";
            return true;
        }
        if (savedState != null && savedState.equals("complete_pending")) {
            _state = "complete_pending";
            _message = "FIT saved\nIronDesk sync pending";
            return true;
        }
        if (savedState != null && savedState.equals("cleanup_error")) {
            _state = "cleanup_error";
            _message = "FIT cleanup was interrupted\nSelect to clear session";
            return true;
        }
        if (savedState != null && savedState.equals("interrupted_fit_error")) {
            _state = "interrupted_fit_error";
            _message = "Partial FIT was not saved\nSelect to continue";
            return true;
        }
        if (savedState != null && (savedState.equals("all_done") || savedState.equals("all_done_interrupted"))) {
            _state = "all_done_interrupted";
            _message = "All sets recorded\nSelect to finish";
            return true;
        }
        if (_startedAt > 0 || (savedState != null && savedState.equals("interrupted"))) {
            _restEndsAt = 0;
            _startedAt = 0;
            _state = "interrupted";
            _message = _interruptedFitSaved ? "Partial FIT saved\nSelect to continue" : "Workout restored\nSelect to continue";
            return true;
        }
        return false;
    }

    private function locateSetById(setId) {
        var exercises = _workout["exercises"];
        for (var i = 0; i < exercises.size(); i += 1) {
            var sets = exercises[i]["sets"];
            for (var j = 0; j < sets.size(); j += 1) {
                if (sets[j]["id"].equals(setId)) {
                    _exerciseIndex = i;
                    _setIndex = j;
                    return true;
                }
            }
        }
        return false;
    }

    function onTick() {
        if (_state.equals("rest") && _restEndsAt <= Time.now().value()) {
            _state = "active";
            _restEndsAt = 0;
            if (Attention has :vibrate) {
                Attention.vibrate([
                    new Attention.VibeProfile(80, 250),
                    new Attention.VibeProfile(0, 100),
                    new Attention.VibeProfile(80, 250)
                ]);
            }
            persistCheckpoint();
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(COLOR_BG, COLOR_BG);
        dc.clear();
        drawHeader(dc);
        if (_state.equals("active") || _state.equals("rest") || _state.equals("all_done") || _state.equals("all_done_interrupted")) {
            drawWorkout(dc);
        } else if (_state.equals("ready")) {
            drawReady(dc);
        } else if (_state.equals("complete") || _state.equals("complete_pending")) {
            drawCentered(dc, _message, COLOR_SUCCESS);
        } else {
            var errorState = _state.equals("error") || _state.equals("complete_fit_error") || _state.equals("complete_fit_uncertain") || _state.equals("cleanup_error");
            drawCentered(dc, _message, errorState ? Graphics.COLOR_RED : Graphics.COLOR_WHITE);
        }
        drawFooter(dc);
    }

    private function drawHeader(dc) {
        var width = dc.getWidth();
        dc.setColor(COLOR_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, 6, Graphics.FONT_XTINY, "IRONDESK", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(_online ? COLOR_SUCCESS : COLOR_WARNING, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(width - 18, 14, 4);
        var hr = _recorder.getHeartRate();
        if (hr != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(18, 6, Graphics.FONT_XTINY, hr.toString(), Graphics.TEXT_JUSTIFY_LEFT);
        }
    }

    private function drawReady(dc) {
        var width = dc.getWidth();
        var height = dc.getHeight();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.25, Graphics.FONT_SMALL, truncate(_workout["title"], 22), Graphics.TEXT_JUSTIFY_CENTER);
        var exercises = _workout["exercises"];
        dc.setColor(COLOR_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.45, Graphics.FONT_XTINY, exercises.size().toString() + " exercises", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(COLOR_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.62, Graphics.FONT_MEDIUM, "START", Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function drawWorkout(dc) {
        var width = dc.getWidth();
        var height = dc.getHeight();
        if (_state.equals("all_done") || _state.equals("all_done_interrupted")) {
            drawCentered(dc, "All sets complete\nSelect to finish", COLOR_SUCCESS);
            return;
        }
        var exercise = currentExercise();
        var set = currentSet();
        if (exercise == null || set == null) {
            drawCentered(dc, "No set available", COLOR_WARNING);
            return;
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.18, Graphics.FONT_SMALL, truncate(exercise["name"], 24), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(COLOR_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.31, Graphics.FONT_XTINY, "SET " + (_setIndex + 1).toString() + " / " + exercise["sets"].size().toString(), Graphics.TEXT_JUSTIFY_CENTER);

        if (_state.equals("rest")) {
            var remaining = clamp(_restEndsAt - Time.now().value(), 0, 86400);
            dc.setColor(COLOR_WARNING, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, height * 0.43, Graphics.FONT_LARGE, IronDeskMath.formatDuration(remaining), Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(COLOR_MUTED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(width / 2, height * 0.62, Graphics.FONT_XTINY, "REST  select to skip", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var reps = set["reps"] == null ? "--" : set["reps"].toString();
        var weight = set["weight_kg"] == null ? "--" : IronDeskMath.kgToDisplay(set["weight_kg"]).toString();
        var rpe = set["rpe"] == null ? "--" : set["rpe"].toString();
        dc.setColor(COLOR_PRIMARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.42, Graphics.FONT_LARGE, reps + " reps", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.60, Graphics.FONT_SMALL, weight + " " + IronDeskMath.unitLabel() + "   RPE " + rpe, Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function drawCentered(dc, message, color) {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, message, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function drawFooter(dc) {
        var message = "SELECT";
        if (!_storageOkay) {
            message = "STORAGE FULL - finish or sync";
        } else if (_state.equals("active")) {
            message = "UP/DOWN reps  SELECT done  MENU edit";
        } else if (_state.equals("ready")) {
            message = _message;
        } else if (_state.equals("loading")) {
            message = "Please wait";
        }
        dc.setColor(COLOR_MUTED, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() - dc.getFontHeight(Graphics.FONT_XTINY) - 5, Graphics.FONT_XTINY, truncate(message, 38), Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function truncate(value, maxLength) {
        if (value == null) {
            return "";
        }
        var text = value.toString();
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + "...";
    }

    private function numberValue(value, fallback) {
        return value == null ? fallback : value;
    }

    private function clamp(value, minimum, maximum) {
        if (value < minimum) {
            return minimum;
        }
        if (value > maximum) {
            return maximum;
        }
        return value;
    }

    private function isValidWorkout(workout) {
        if (workout == null) {
            return true;
        }
        if (!(workout instanceof Dictionary) || !(workout["id"] instanceof String) || !(workout["title"] instanceof String) || !(workout["started_at"] instanceof String) || !(workout["exercises"] instanceof Array)) {
            return false;
        }
        if (workout["title"].length() > 80 || workout["exercises"].size() > 24 || (workout["focus"] != null && (!(workout["focus"] instanceof String) || workout["focus"].length() > 160))) {
            return false;
        }
        var totalSets = 0;
        var exercises = workout["exercises"];
        for (var i = 0; i < exercises.size(); i += 1) {
            var exercise = exercises[i];
            if (!(exercise instanceof Dictionary) || !(exercise["id"] instanceof String) || !(exercise["name"] instanceof String) || !(exercise["sets"] instanceof Array)) {
                return false;
            }
            if (exercise["name"].length() > 80 || exercise["sets"].size() > 16) {
                return false;
            }
            if (exercise["target_reps"] != null && (!(exercise["target_reps"] instanceof String) || exercise["target_reps"].length() > 40)) {
                return false;
            }
            if (exercise["load_guidance"] != null && (!(exercise["load_guidance"] instanceof String) || exercise["load_guidance"].length() > 240)) {
                return false;
            }
            var sets = exercise["sets"];
            totalSets += sets.size();
            for (var j = 0; j < sets.size(); j += 1) {
                var set = sets[j];
                if (!(set instanceof Dictionary) || !(set["id"] instanceof String) || !(set["set_number"] instanceof Number) || !(set["completed"] instanceof Boolean)) {
                    return false;
                }
            }
        }
        return totalSets <= 60;
    }

    private function interruptRecording() {
        var priorState = _state;
        var hadSession = _recorder.hasSession();
        if (hadSession) {
            _interruptedFitSaved = _recorder.stopAndSave();
        }
        _restEndsAt = 0;
        _startedAt = 0;
        if (hadSession && !_interruptedFitSaved) {
            _state = "interrupted_fit_error";
            _message = "Partial FIT save failed\nSelect to retry";
        } else {
            _state = priorState.equals("all_done") ? "all_done_interrupted" : "interrupted";
            _message = _interruptedFitSaved ? "Partial FIT saved\nSelect to continue" : "Workout interrupted\nSelect to continue";
        }
        persistCheckpoint();
    }

    function isWorkoutRunning() {
        return _state.equals("active") || _state.equals("rest") || _state.equals("all_done") || _state.equals("queue_full") || _state.equals("sync_conflict") || _state.equals("cleanup_error") || _state.equals("interrupted_fit_error");
    }
}

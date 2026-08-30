import Toybox.WatchUi;

class IronDeskDelegate extends WatchUi.BehaviorDelegate {
    private var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() {
        _view.primaryAction();
        return true;
    }

    function onTap(event) {
        _view.primaryAction();
        return true;
    }

    function onNextPage() {
        _view.adjustReps(-1);
        return true;
    }

    function onPreviousPage() {
        _view.adjustReps(1);
        return true;
    }

    function onMenu() {
        WatchUi.pushView(new IronDeskMenu(_view), new IronDeskMenuDelegate(_view), WatchUi.SLIDE_UP);
        return true;
    }

    function onBack() {
        if (_view.isWorkoutRunning()) {
            WatchUi.pushView(new IronDeskExitMenu(_view), new IronDeskExitMenuDelegate(_view), WatchUi.SLIDE_UP);
            return true;
        }
        return false;
    }
}

class IronDeskMenu extends WatchUi.Menu2 {
    function initialize(view) {
        Menu2.initialize({:title => "IronDesk"});
        if (view.hasUncertainFinalFit()) {
            addItem(new WatchUi.MenuItem("FIT already saved", "I verified Garmin Activities", :confirmFitSaved, {}));
            addItem(new WatchUi.MenuItem("Continue without FIT", "Finish IronDesk only", :continueWithoutFit, {}));
            return;
        }
        if (view.hasServerDataConflict()) {
            addItem(new WatchUi.MenuItem("Use previous server", "Restore its URL in settings", :keepPreviousServer, {}));
            addItem(new WatchUi.MenuItem("Discard old sync data", "Requires confirmation", :confirmDiscardServer, {}));
            return;
        }
        if (view.hasFinalFitError()) {
            addItem(new WatchUi.MenuItem("Retry FIT save", "Recover Garmin activity", :retryFit, {}));
            addItem(new WatchUi.MenuItem("Discard failed FIT", "Still sync IronDesk", :discardFailedFit, {}));
            return;
        }
        if (view.canAcceptServerConflict()) {
            addItem(new WatchUi.MenuItem("Retry changes", "Keep local watch data", :sync, {}));
            addItem(new WatchUi.MenuItem("Use server workout", "Discard rejected watch changes", :acceptServer, {}));
            return;
        }
        if (view.isCompletionPending()) {
            addItem(new WatchUi.MenuItem("Retry completion", "Queue or sync finish", :primary, {}));
            return;
        }
        if (view.canEditCurrentSet()) {
            addItem(new WatchUi.MenuItem("Weight +", "+ 0.5", :weightUp, {}));
            addItem(new WatchUi.MenuItem("Weight -", "- 0.5", :weightDown, {}));
            addItem(new WatchUi.MenuItem("RPE +", "+ 0.5", :rpeUp, {}));
            addItem(new WatchUi.MenuItem("RPE -", "- 0.5", :rpeDown, {}));
        }
        if (view.canSyncFromMenu()) {
            addItem(new WatchUi.MenuItem("Sync", "Send pending", :sync, {}));
        }
        if (view.canFinishFromMenu()) {
            addItem(new WatchUi.MenuItem("Finish", "Save workout", :finish, {}));
        }
        if (view.canDiscardRecording()) {
            addItem(new WatchUi.MenuItem("Discard", "Delete open FIT", :discard, {}));
        }
        if (!view.canEditCurrentSet() && !view.canSyncFromMenu() && !view.canFinishFromMenu() && !view.canDiscardRecording()) {
            addItem(new WatchUi.MenuItem("Refresh", "Check IronDesk", :primary, {}));
        }
    }
}

class IronDeskMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _view;

    function initialize(view) {
        Menu2InputDelegate.initialize();
        _view = view;
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :weightUp) {
            _view.adjustWeight(0.5);
        } else if (id == :weightDown) {
            _view.adjustWeight(-0.5);
        } else if (id == :rpeUp) {
            _view.adjustRpe(0.5);
        } else if (id == :rpeDown) {
            _view.adjustRpe(-0.5);
        } else if (id == :sync) {
            _view.syncNow();
        } else if (id == :acceptServer) {
            _view.acceptServerConflict();
        } else if (id == :retryFit) {
            _view.retryFinalFitSave();
        } else if (id == :discardFailedFit) {
            _view.discardFailedFinalFit();
        } else if (id == :confirmFitSaved) {
            _view.confirmUncertainFitSaved();
        } else if (id == :continueWithoutFit) {
            _view.continueWithoutUncertainFit();
        } else if (id == :keepPreviousServer) {
            _view.showPreviousServerHelp();
        } else if (id == :confirmDiscardServer) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            WatchUi.pushView(new IronDeskServerDiscardMenu(), new IronDeskServerDiscardMenuDelegate(_view), WatchUi.SLIDE_UP);
            return;
        } else if (id == :primary) {
            _view.primaryAction();
        } else if (id == :finish) {
            _view.finishWorkout();
        } else if (id == :discard) {
            _view.discardWorkout();
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class IronDeskServerDiscardMenu extends WatchUi.Menu2 {
    function initialize() {
        Menu2.initialize({:title => "Discard old server data?"});
        addItem(new WatchUi.MenuItem("Cancel", "Keep workout and pending events", :cancel, {}));
        addItem(new WatchUi.MenuItem("Discard", "Keep/safely close Garmin FIT", :discardServerData, {}));
    }
}

class IronDeskServerDiscardMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _view;

    function initialize(view) {
        Menu2InputDelegate.initialize();
        _view = view;
    }

    function onSelect(item) {
        var id = item.getId();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id == :discardServerData) {
            _view.discardPreviousServerData();
        }
    }
}

class IronDeskExitMenu extends WatchUi.Menu2 {
    function initialize(view) {
        Menu2.initialize({:title => "Workout running"});
        addItem(new WatchUi.MenuItem("Continue", "Return to workout", :continueWorkout, {}));
        if (view.canFinishFromMenu()) {
            addItem(new WatchUi.MenuItem("Finish & save", "Complete IronDesk", :finishWorkout, {}));
        }
        if (view.canDiscardRecording()) {
            addItem(new WatchUi.MenuItem("Discard FIT", "Keep IronDesk active", :discardWorkout, {}));
        }
    }
}

class IronDeskExitMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _view;

    function initialize(view) {
        Menu2InputDelegate.initialize();
        _view = view;
    }

    function onSelect(item) {
        var id = item.getId();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        if (id == :finishWorkout) {
            _view.finishWorkout();
        } else if (id == :discardWorkout) {
            _view.discardWorkout();
        }
    }
}

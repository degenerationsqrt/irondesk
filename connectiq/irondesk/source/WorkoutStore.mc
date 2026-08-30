import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

class WorkoutStore {
    const KEY_TOKEN = "deviceToken";
    const KEY_WORKOUT = "workout";
    const KEY_EVENTS = "pendingEvents";
    const KEY_CHECKPOINT = "checkpoint";
    const KEY_SEQUENCE = "eventSequence";
    const KEY_QUARANTINED = "quarantinedEvents";
    const KEY_FIT_WARNING = "fitSaveWarning";
    const KEY_PAIRED_BASE_URL = "pairedBaseUrl";
    const KEY_DATA_BASE_URL = "dataBaseUrl";
    const MAX_EVENTS = 64;

    function getToken() {
        try {
            return Storage.getValue(KEY_TOKEN);
        } catch (error) {
            return null;
        }
    }

    function setToken(token) {
        try {
            Storage.setValue(KEY_TOKEN, token);
            return true;
        } catch (error) {
            return false;
        }
    }

    function clearToken() {
        try {
            if (Storage.getValue(KEY_TOKEN) != null) {
                Storage.deleteValue(KEY_TOKEN);
            }
        } catch (error) {
            // A missing token is already equivalent to a cleared token.
        }
    }

    function getPairedBaseUrl() {
        try {
            return Storage.getValue(KEY_PAIRED_BASE_URL);
        } catch (error) {
            return null;
        }
    }

    function setPairedBaseUrl(baseUrl) {
        try {
            Storage.setValue(KEY_PAIRED_BASE_URL, baseUrl);
            return true;
        } catch (error) {
            return false;
        }
    }

    function clearPairedBaseUrl() {
        try {
            if (Storage.getValue(KEY_PAIRED_BASE_URL) != null) {
                Storage.deleteValue(KEY_PAIRED_BASE_URL);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function getDataBaseUrl() {
        try {
            return Storage.getValue(KEY_DATA_BASE_URL);
        } catch (error) {
            return null;
        }
    }

    function setDataBaseUrl(baseUrl) {
        try {
            Storage.setValue(KEY_DATA_BASE_URL, baseUrl);
            return true;
        } catch (error) {
            return false;
        }
    }

    function clearDataBaseUrl() {
        try {
            if (Storage.getValue(KEY_DATA_BASE_URL) != null) {
                Storage.deleteValue(KEY_DATA_BASE_URL);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function hasProtectedServerData() {
        return getCheckpoint() != null || getEvents().size() > 0 || getQuarantinedCount() > 0 || hasFitSaveWarning();
    }

    function clearProtectedServerData() {
        var eventsCleared = clearEvents();
        var quarantinedCleared = clearQuarantinedEvents();
        var checkpointCleared = clearCheckpoint();
        var workoutCleared = setWorkout(null);
        var fitWarningCleared = setFitSaveWarning(false);
        if (!(eventsCleared && quarantinedCleared && checkpointCleared && workoutCleared && fitWarningCleared)) {
            return false;
        }
        // Clear the binding last. Any partial cleanup therefore remains safely
        // blocked from transmission to a different server origin.
        return clearDataBaseUrl();
    }

    function clearCleanCachedWorkout() {
        if (hasProtectedServerData()) {
            return false;
        }
        if (!setWorkout(null)) {
            return false;
        }
        return clearDataBaseUrl();
    }

    function getWorkout() {
        try {
            return Storage.getValue(KEY_WORKOUT);
        } catch (error) {
            return null;
        }
    }

    function setWorkout(workout) {
        try {
            if (workout == null) {
                if (Storage.getValue(KEY_WORKOUT) != null) {
                    Storage.deleteValue(KEY_WORKOUT);
                }
            } else {
                Storage.setValue(KEY_WORKOUT, workout);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function getCheckpoint() {
        try {
            return Storage.getValue(KEY_CHECKPOINT);
        } catch (error) {
            return null;
        }
    }

    function setCheckpoint(checkpoint) {
        try {
            Storage.setValue(KEY_CHECKPOINT, checkpoint);
            return true;
        } catch (error) {
            return false;
        }
    }

    function clearCheckpoint() {
        try {
            if (Storage.getValue(KEY_CHECKPOINT) != null) {
                Storage.deleteValue(KEY_CHECKPOINT);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function getEvents() {
        try {
            var events = Storage.getValue(KEY_EVENTS);
            return events instanceof Array ? events : [];
        } catch (error) {
            return [];
        }
    }

    function queueEvent(event) {
        var events = getEvents();
        if (event instanceof Dictionary && containsEventId(events, event["event_id"])) {
            return true;
        }
        if (events.size() >= MAX_EVENTS) {
            return false;
        }
        events.add(event);
        try {
            Storage.setValue(KEY_EVENTS, events);
            return true;
        } catch (error) {
            return false;
        }
    }

    function hasQueueCapacity() {
        return getEvents().size() < MAX_EVENTS;
    }

    function clearEvents() {
        try {
            if (Storage.getValue(KEY_EVENTS) != null) {
                Storage.deleteValue(KEY_EVENTS);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function removeEventsByIds(eventIds) {
        var events = getEvents();
        var remaining = [];
        for (var i = 0; i < events.size(); i += 1) {
            var event = events[i];
            var remove = false;
            for (var j = 0; j < eventIds.size(); j += 1) {
                if (sameString(event["event_id"], eventIds[j])) {
                    remove = true;
                    break;
                }
            }
            if (!remove) {
                remaining.add(event);
            }
        }
        try {
            if (remaining.size() == 0) {
                return clearEvents();
            } else {
                Storage.setValue(KEY_EVENTS, remaining);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function getQuarantinedEvents() {
        try {
            var events = Storage.getValue(KEY_QUARANTINED);
            return events instanceof Array ? events : [];
        } catch (error) {
            return [];
        }
    }

    function getQuarantinedCount() {
        return getQuarantinedEvents().size();
    }

    function clearQuarantinedEvents() {
        try {
            if (Storage.getValue(KEY_QUARANTINED) != null) {
                Storage.deleteValue(KEY_QUARANTINED);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function quarantineEventsByIds(eventIds, responseCode) {
        var pending = getEvents();
        var quarantined = getQuarantinedEvents();
        var newMatches = 0;
        for (var i = 0; i < pending.size(); i += 1) {
            var pendingId = pending[i]["event_id"];
            if (containsId(eventIds, pendingId) && !containsQuarantinedId(quarantined, pendingId)) {
                newMatches += 1;
            }
        }
        if (quarantined.size() + newMatches > MAX_EVENTS) {
            return false;
        }

        var remaining = [];
        for (var j = 0; j < pending.size(); j += 1) {
            var event = pending[j];
            if (containsId(eventIds, event["event_id"])) {
                if (!containsQuarantinedId(quarantined, event["event_id"])) {
                    quarantined.add({
                        "event" => event,
                        "response_code" => responseCode,
                        "quarantined_at" => Time.now().value()
                    });
                }
            } else {
                remaining.add(event);
            }
        }
        try {
            Storage.setValue(KEY_QUARANTINED, quarantined);
            if (remaining.size() == 0) {
                if (!clearEvents()) {
                    return false;
                }
            } else {
                Storage.setValue(KEY_EVENTS, remaining);
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function restoreQuarantinedEvents() {
        var pending = getEvents();
        var quarantined = getQuarantinedEvents();
        if (quarantined.size() == 0) {
            return 0;
        }
        var missing = 0;
        for (var i = 0; i < quarantined.size(); i += 1) {
            var event = quarantined[i]["event"];
            if (!containsEventId(pending, event["event_id"])) {
                missing += 1;
            }
        }
        if (pending.size() + missing > MAX_EVENTS) {
            return 0;
        }
        for (var j = 0; j < quarantined.size(); j += 1) {
            var restoredEvent = quarantined[j]["event"];
            if (!containsEventId(pending, restoredEvent["event_id"])) {
                pending.add(restoredEvent);
            }
        }
        try {
            Storage.setValue(KEY_EVENTS, pending);
            Storage.deleteValue(KEY_QUARANTINED);
            return quarantined.size();
        } catch (error) {
            return 0;
        }
    }

    function hasFitSaveWarning() {
        try {
            return Storage.getValue(KEY_FIT_WARNING) == true;
        } catch (error) {
            return false;
        }
    }

    function setFitSaveWarning(value) {
        try {
            if (value) {
                Storage.setValue(KEY_FIT_WARNING, true);
            } else {
                if (Storage.getValue(KEY_FIT_WARNING) != null) {
                    Storage.deleteValue(KEY_FIT_WARNING);
                }
            }
            return true;
        } catch (error) {
            return false;
        }
    }

    function nextEventId(targetId) {
        var sequence = Storage.getValue(KEY_SEQUENCE);
        if (sequence == null) {
            sequence = 0;
        }
        sequence += 1;
        try {
            Storage.setValue(KEY_SEQUENCE, sequence);
        } catch (error) {
            // The millisecond timer still prevents an accidental same-second id reuse.
        }
        return targetId + "-" + Time.now().value().toString() + "-" + sequence.toString() + "-" + System.getTimer().toString();
    }

    private function containsId(eventIds, eventId) {
        for (var i = 0; i < eventIds.size(); i += 1) {
            if (sameString(eventIds[i], eventId)) {
                return true;
            }
        }
        return false;
    }

    private function containsEventId(events, eventId) {
        for (var i = 0; i < events.size(); i += 1) {
            if (sameString(events[i]["event_id"], eventId)) {
                return true;
            }
        }
        return false;
    }

    private function containsQuarantinedId(events, eventId) {
        for (var i = 0; i < events.size(); i += 1) {
            var wrapper = events[i];
            if (wrapper instanceof Dictionary && wrapper["event"] instanceof Dictionary && sameString(wrapper["event"]["event_id"], eventId)) {
                return true;
            }
        }
        return false;
    }

    private function sameString(first, second) {
        return first != null && second != null && first.toString().equals(second.toString());
    }
}

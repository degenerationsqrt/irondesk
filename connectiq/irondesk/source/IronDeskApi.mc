import Toybox.Application.Properties;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

class IronDeskApi {
    private var _store;
    private var _callback = null;
    private var _busy = false;
    private var _sentEventIds = [];
    private var _drainingEvents = false;
    private var _syncWarning = false;
    private var _requestGeneration = 0;
    private var _activeRequestGeneration = 0;
    private var _activeRequestKind = null;
    private var _activeRequestBaseUrl = null;
    private var _activeRequestDelegate = null;

    function initialize(store) {
        _store = store;
    }

    function isBusy() {
        return _busy;
    }

    function hasBaseUrl() {
        return getBaseUrl() != null;
    }

    function isPairedToCurrentBaseUrl() {
        var baseUrl = getBaseUrl();
        var pairedBaseUrl = _store.getPairedBaseUrl();
        return baseUrl != null && _store.getToken() != null && pairedBaseUrl instanceof String && pairedBaseUrl.equals(baseUrl);
    }

    function isLocalDataForCurrentBaseUrl() {
        var baseUrl = getBaseUrl();
        var dataBaseUrl = _store.getDataBaseUrl();
        if (baseUrl instanceof String && dataBaseUrl instanceof String) {
            return dataBaseUrl.equals(baseUrl);
        }
        if (baseUrl instanceof String && !(dataBaseUrl instanceof String)) {
            var pairedBaseUrl = _store.getPairedBaseUrl();
            if (_store.hasProtectedServerData() && pairedBaseUrl instanceof String && pairedBaseUrl.equals(baseUrl) && _store.setDataBaseUrl(pairedBaseUrl)) {
                return true;
            }
        }
        return false;
    }

    function invalidatePairingIfOriginChanged() {
        var requestInvalidated = invalidateActiveRequestIfOriginChanged();
        if (_store.getToken() == null) {
            return requestInvalidated;
        }
        if (isPairedToCurrentBaseUrl()) {
            return requestInvalidated;
        }
        preserveProtectedDataOrigin();
        clearPairing();
        return true;
    }

    function pair(code, callback) {
        if (_busy) {
            return false;
        }
        var baseUrl = getBaseUrl();
        if (baseUrl == null) {
            return false;
        }
        _callback = callback;
        if (hasProtectedDataConflict(baseUrl)) {
            notify("server_data_conflict", null, 0);
            return true;
        }
        _busy = true;
        var settings = System.getDeviceSettings();
        var label = "Garmin watch";
        if (settings.partNumber != null) {
            label = "Garmin " + settings.partNumber;
        }
        var parameters = {
            "code" => code,
            "device_label" => label
        };
        Communications.makeWebRequest(
            baseUrl + "/api/public/connect-iq/v1/pair",
            parameters,
            postOptions(null),
            beginRequest("pair", baseUrl)
        );
        return true;
    }

    private function onPair(requestedBaseUrl, responseCode, data) {
        if (responseCode == 200 && data instanceof Dictionary && data["schema_version"] == 1 && data["device_token"] instanceof String && data["device_token"].length() >= 20) {
            if (!prepareCleanCacheForOrigin(requestedBaseUrl)) {
                clearPairing();
                notify("storage_error", data, responseCode);
            } else if (_store.setToken(data["device_token"]) && _store.setPairedBaseUrl(requestedBaseUrl)) {
                try {
                    Properties.setValue("pairingCode", "");
                } catch (error) {
                    // The token is already stored; leaving the one-time code is harmless.
                }
                notify("paired", data, responseCode);
            } else {
                clearPairing();
                notify("storage_error", data, responseCode);
            }
        } else {
            notify("pair_error", data, responseCode);
        }
    }

    function fetchActive(callback) {
        if (_busy) {
            return false;
        }
        var token = _store.getToken();
        var baseUrl = getBaseUrl();
        if (token == null || baseUrl == null || !isPairedToCurrentBaseUrl()) {
            return false;
        }
        _callback = callback;
        if (hasProtectedDataConflict(baseUrl)) {
            notify("server_data_conflict", null, 0);
            return true;
        }
        _busy = true;
        Communications.makeWebRequest(
            baseUrl + "/api/public/connect-iq/v1/workouts/active",
            null,
            getOptions(token),
            beginRequest("fetch", baseUrl)
        );
        return true;
    }

    private function onFetch(requestedBaseUrl, responseCode, data) {
        if (responseCode == 200 && data instanceof Dictionary && data["schema_version"] == 1 && data.hasKey("workout")) {
            if (data["workout"] != null && !_store.setDataBaseUrl(requestedBaseUrl)) {
                notify("storage_error", data, responseCode);
            } else {
                notify("workout", data, responseCode);
            }
        } else if (responseCode == 401) {
            clearPairing();
            notify("unauthorized", data, responseCode);
        } else if (responseCode == 422 && data instanceof Dictionary && data["code"] instanceof String && data["code"].equals("workout_not_watch_compatible")) {
            notify("workout_incompatible", data, responseCode);
        } else {
            notify("fetch_error", data, responseCode);
        }
    }

    function flushEvents(callback) {
        if (_busy) {
            return false;
        }
        var token = _store.getToken();
        var events = _store.getEvents();
        var baseUrl = getBaseUrl();
        if (token == null || baseUrl == null || !isPairedToCurrentBaseUrl() || events.size() == 0) {
            return false;
        }
        _callback = callback;
        if (hasProtectedDataConflict(baseUrl)) {
            notify("server_data_conflict", null, 0);
            return true;
        }
        if (!_drainingEvents) {
            _drainingEvents = true;
            _syncWarning = false;
        }
        _sentEventIds = [];
        for (var i = 0; i < events.size(); i += 1) {
            _sentEventIds.add(events[i]["event_id"]);
        }
        _busy = true;
        Communications.makeWebRequest(
            baseUrl + "/api/public/connect-iq/v1/workout-events",
            {"events" => events},
            postOptions(token),
            beginRequest("flush", baseUrl)
        );
        return true;
    }

    private function onFlush(responseCode, data) {
        if (responseCode == 200 && data instanceof Dictionary) {
            var rejectedIds = validateAcknowledgement(data);
            if (rejectedIds == null) {
                finishDrainWithError(data, responseCode);
                return;
            }
            if (rejectedIds.size() > 0) {
                _syncWarning = true;
                if (!_store.quarantineEventsByIds(rejectedIds, responseCode)) {
                    finishDrainWithError(data, responseCode);
                    return;
                }
            }
            if (!_store.removeEventsByIds(_sentEventIds)) {
                finishDrainWithError(data, responseCode);
                return;
            }
            _sentEventIds = [];
            if (_store.getEvents().size() > 0 && flushEvents(_callback)) {
                return;
            }
            _drainingEvents = false;
            notify(_syncWarning ? "sync_warning" : "synced", data, responseCode);
        } else if (responseCode == 401) {
            _sentEventIds = [];
            _drainingEvents = false;
            clearPairing();
            notify("unauthorized", data, responseCode);
        } else if (responseCode == 400 || responseCode == 404 || responseCode == 409 || responseCode == 413) {
            if (_store.quarantineEventsByIds(_sentEventIds, responseCode)) {
                _sentEventIds = [];
                _drainingEvents = false;
                _syncWarning = true;
                notify("sync_warning", data, responseCode);
            } else {
                finishDrainWithError(data, responseCode);
            }
        } else {
            finishDrainWithError(data, responseCode);
        }
    }

    function onWebResponse(kind, requestedBaseUrl, generation, responseCode, data) {
        if (!_busy
            || generation != _activeRequestGeneration
            || !sameString(kind, _activeRequestKind)
            || !sameString(requestedBaseUrl, _activeRequestBaseUrl)) {
            return;
        }
        _busy = false;
        _activeRequestGeneration = 0;
        _activeRequestKind = null;
        _activeRequestBaseUrl = null;
        _activeRequestDelegate = null;

        var currentBaseUrl = getBaseUrl();
        if (!(currentBaseUrl instanceof String) || !requestedBaseUrl.equals(currentBaseUrl)) {
            if (kind.equals("flush")) {
                _sentEventIds = [];
                _drainingEvents = false;
                _syncWarning = false;
            }
            clearPairing();
            notify("origin_changed", data, responseCode);
            return;
        }
        if (kind.equals("pair")) {
            onPair(requestedBaseUrl, responseCode, data);
        } else if (kind.equals("fetch")) {
            onFetch(requestedBaseUrl, responseCode, data);
        } else if (kind.equals("flush")) {
            onFlush(responseCode, data);
        }
    }

    private function validateAcknowledgement(data) {
        if (data["schema_version"] != 1 || !(data["processed"] instanceof Array) || !(data["rejected"] instanceof Array)) {
            return null;
        }
        var acknowledged = [];
        var rejectedIds = [];
        if (!collectAcknowledgements(data["processed"], acknowledged, null)) {
            return null;
        }
        if (!collectAcknowledgements(data["rejected"], acknowledged, rejectedIds)) {
            return null;
        }
        if (acknowledged.size() != _sentEventIds.size()) {
            return null;
        }
        for (var i = 0; i < _sentEventIds.size(); i += 1) {
            if (!containsId(acknowledged, _sentEventIds[i])) {
                return null;
            }
        }
        return rejectedIds;
    }

    private function collectAcknowledgements(entries, acknowledged, rejectedIds) {
        for (var i = 0; i < entries.size(); i += 1) {
            var entry = entries[i];
            if (!(entry instanceof Dictionary) || !(entry["event_id"] instanceof String)) {
                return false;
            }
            var eventId = entry["event_id"];
            if (!containsId(_sentEventIds, eventId) || containsId(acknowledged, eventId)) {
                return false;
            }
            acknowledged.add(eventId);
            if (rejectedIds != null) {
                rejectedIds.add(eventId);
            }
        }
        return true;
    }

    private function containsId(ids, eventId) {
        for (var i = 0; i < ids.size(); i += 1) {
            if (ids[i] != null && eventId != null && ids[i].toString().equals(eventId.toString())) {
                return true;
            }
        }
        return false;
    }

    private function finishDrainWithError(data, responseCode) {
        _sentEventIds = [];
        _drainingEvents = false;
        notify("sync_error", data, responseCode);
    }

    private function beginRequest(kind, baseUrl) {
        _requestGeneration += 1;
        _activeRequestGeneration = _requestGeneration;
        _activeRequestKind = kind;
        _activeRequestBaseUrl = baseUrl;
        _activeRequestDelegate = new IronDeskRequestDelegate(self, kind, baseUrl, _activeRequestGeneration);
        return _activeRequestDelegate.method(:onResponse);
    }

    private function invalidateActiveRequestIfOriginChanged() {
        if (!_busy || !(_activeRequestBaseUrl instanceof String)) {
            return false;
        }
        var currentBaseUrl = getBaseUrl();
        if (currentBaseUrl instanceof String && _activeRequestBaseUrl.equals(currentBaseUrl)) {
            return false;
        }
        cancelActiveRequest();
        return true;
    }

    private function cancelActiveRequest() {
        // Communications requests cannot be canceled, so invalidate the unique
        // generation. Its eventual callback is then ignored without touching
        // the current request, token, workout, or pending event queue.
        _requestGeneration += 1;
        _activeRequestGeneration = 0;
        _activeRequestKind = null;
        _activeRequestBaseUrl = null;
        _activeRequestDelegate = null;
        _busy = false;
        _sentEventIds = [];
        _drainingEvents = false;
        _syncWarning = false;
    }

    private function sameString(first, second) {
        return first != null && second != null && first.toString().equals(second.toString());
    }

    private function preserveProtectedDataOrigin() {
        if (!_store.hasProtectedServerData() || _store.getDataBaseUrl() instanceof String) {
            return true;
        }
        var pairedBaseUrl = _store.getPairedBaseUrl();
        return pairedBaseUrl instanceof String && _store.setDataBaseUrl(pairedBaseUrl);
    }

    private function hasProtectedDataConflict(baseUrl) {
        if (!_store.hasProtectedServerData()) {
            return false;
        }
        var dataBaseUrl = _store.getDataBaseUrl();
        if (!(dataBaseUrl instanceof String)) {
            if (!preserveProtectedDataOrigin()) {
                // Unbound legacy recovery data must never be inferred from a
                // newly entered origin. Keep it blocked for explicit cleanup.
                return true;
            }
            dataBaseUrl = _store.getDataBaseUrl();
        }
        return !(dataBaseUrl instanceof String) || !dataBaseUrl.equals(baseUrl);
    }

    private function prepareCleanCacheForOrigin(baseUrl) {
        if (_store.hasProtectedServerData()) {
            return !hasProtectedDataConflict(baseUrl);
        }
        var dataBaseUrl = _store.getDataBaseUrl();
        if (dataBaseUrl instanceof String && !dataBaseUrl.equals(baseUrl)) {
            return _store.clearCleanCachedWorkout();
        }
        if (!(dataBaseUrl instanceof String) && _store.getWorkout() != null) {
            // A legacy unbound clean cache is safe to discard, but never safe
            // to infer from a newly paired server origin.
            return _store.clearCleanCachedWorkout();
        }
        return true;
    }

    private function getBaseUrl() {
        var value = Properties.getValue("apiBaseUrl");
        if (value == null || value.toString().length() == 0) {
            return null;
        }
        value = value.toString();
        if (value.length() < 9 || !value.substring(0, 8).equals("https://")) {
            return null;
        }
        while (value.length() > 0 && value.substring(value.length() - 1, value.length()).equals("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private function clearPairing() {
        _store.clearToken();
        _store.clearPairedBaseUrl();
    }

    private function getOptions(token) {
        return {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {"Authorization" => "Bearer " + token},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
    }

    private function postOptions(token) {
        var headers = {"Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON};
        if (token != null) {
            headers["Authorization"] = "Bearer " + token;
        }
        return {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
    }

    private function notify(kind, data, responseCode) {
        if (_callback != null) {
            _callback.invoke(kind, data, responseCode);
        }
    }
}

class IronDeskRequestDelegate {
    private var _api;
    private var _kind;
    private var _baseUrl;
    private var _generation;

    function initialize(api, kind, baseUrl, generation) {
        _api = api;
        _kind = kind;
        _baseUrl = baseUrl;
        _generation = generation;
    }

    function onResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        _api.onWebResponse(_kind, _baseUrl, _generation, responseCode, data);
    }
}

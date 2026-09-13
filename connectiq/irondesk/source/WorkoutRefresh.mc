import Toybox.Lang;

// Snapshot reconciliation is deliberately independent of FIT and UI lifecycle.
class WorkoutRefresh {
    static function canRefresh(state) {
        return state.equals("ready") || state.equals("active") || state.equals("rest") || state.equals("all_done");
    }

    static function edit(set, field, value) {
        if (sameValue(set[field], value)) {
            return false;
        }
        var dirty = set["_watch_dirty"];
        if (!(dirty instanceof Dictionary)) {
            dirty = {};
        }
        dirty[field] = true;
        set["_watch_dirty"] = dirty;
        set[field] = value;
        return true;
    }

    static function prepareSnapshot(workout) {
        if (workout != null) {
            workout["_watch_drafts_version"] = 1;
        }
        return workout;
    }

    static function preserveLegacyDraft(workout, currentSet) {
        if (workout == null || workout["_watch_drafts_version"] == 1) {
            return false;
        }
        // Old caches cannot distinguish an unsent watch edit from a stale plan.
        // Preserve only the editable current set until its explicit confirmation.
        if (currentSet != null && currentSet["completed"] != true) {
            currentSet["_watch_dirty"] = {"weight_kg" => true, "reps" => true, "rpe" => true};
        }
        workout["_watch_drafts_version"] = 1;
        return true;
    }

    static function merge(local, incoming, pending) {
        if (!sameLayout(local, incoming)) {
            return null;
        }
        // Validation completes before touching the response. Reuse its bounded
        // object graph instead of holding a third full workout on small watches.
        var fields = editableFields();
        var payloadFields = ["weight_kg", "reps", "rpe", "rest_seconds", "completed"];
        for (var i = 0; i < incoming["exercises"].size(); i += 1) {
            var exercise = incoming["exercises"][i];
            for (var j = 0; j < exercise["sets"].size(); j += 1) {
                var set = exercise["sets"][j];
                var localSet = local["exercises"][i]["sets"][j];
                var dirty = localSet["_watch_dirty"];
                if (dirty instanceof Dictionary) {
                    var remainingDirty = {};
                    for (var f = 0; f < fields.size(); f += 1) {
                        var field = fields[f];
                        if (dirty[field] == true) {
                            set[field] = localSet[field];
                            remainingDirty[field] = true;
                        }
                    }
                    if (remainingDirty.size() > 0) {
                        set["_watch_dirty"] = remainingDirty;
                    }
                }
                // A confirmation made while the GET was in flight wins until ACK.
                for (var e = 0; e < pending.size(); e += 1) {
                    var event = pending[e];
                    if (event["type"] != null && event["type"].equals("set.updated")
                        && sameValue(event["session_id"], local["id"])
                        && sameValue(event["set_id"], set["id"])
                        && event["payload"] instanceof Dictionary) {
                        for (var p = 0; p < payloadFields.size(); p += 1) {
                            var payloadField = payloadFields[p];
                            if (event["payload"].hasKey(payloadField)
                                && !(dirty instanceof Dictionary && dirty[payloadField] == true)) {
                                set[payloadField] = event["payload"][payloadField];
                            }
                        }
                    }
                }
            }
        }
        return prepareSnapshot(incoming);
    }

    static function acknowledge(workout, events) {
        if (workout == null) {
            return false;
        }
        var changed = false;
        var fields = editableFields();
        for (var i = 0; i < workout["exercises"].size(); i += 1) {
            var exercise = workout["exercises"][i];
            for (var j = 0; j < exercise["sets"].size(); j += 1) {
                var set = exercise["sets"][j];
                var dirty = set["_watch_dirty"];
                if (!(dirty instanceof Dictionary)) {
                    continue;
                }
                for (var e = 0; e < events.size(); e += 1) {
                    var event = events[e];
                    if (!sameValue(event["session_id"], workout["id"])
                        || !sameValue(event["set_id"], set["id"])
                        || !(event["payload"] instanceof Dictionary)) {
                        continue;
                    }
                    for (var f = 0; f < fields.size(); f += 1) {
                        var field = fields[f];
                        // An edit made after this payload was sent remains dirty.
                        if (dirty[field] == true && event["payload"].hasKey(field)
                            && sameValue(set[field], event["payload"][field])) {
                            dirty.remove(field);
                            changed = true;
                        }
                    }
                }
                if (dirty.size() == 0) {
                    set.remove("_watch_dirty");
                }
            }
        }
        return changed;
    }

    static function sameLayout(local, incoming) {
        if (!(local instanceof Dictionary) || !(incoming instanceof Dictionary)
            || !sameValue(local["id"], incoming["id"])
            || local["exercises"].size() != incoming["exercises"].size()) {
            return false;
        }
        for (var i = 0; i < local["exercises"].size(); i += 1) {
            var left = local["exercises"][i];
            var right = incoming["exercises"][i];
            if (!sameValue(left["id"], right["id"]) || left["sets"].size() != right["sets"].size()) {
                return false;
            }
            for (var j = 0; j < left["sets"].size(); j += 1) {
                if (!sameValue(left["sets"][j]["id"], right["sets"][j]["id"])) {
                    return false;
                }
                var dirty = left["sets"][j]["_watch_dirty"];
                if (right["sets"][j]["completed"] == true && left["sets"][j]["completed"] != true
                    && dirty instanceof Dictionary && dirty.size() > 0) {
                    // Do not advance beyond an unsent draft because another
                    // client completed its set. Require explicit reconciliation.
                    return false;
                }
            }
        }
        return true;
    }

    private static function editableFields() {
        return ["weight_kg", "reps", "rpe"];
    }

    private static function sameValue(left, right) {
        return left == null || right == null ? left == null && right == null : left.equals(right);
    }

}

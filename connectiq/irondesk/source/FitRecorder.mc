import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Sensor;

class FitRecorder {
    private var _session = null;
    private var _heartRate = null;
    private var _heartRateTotal = 0;
    private var _heartRateSamples = 0;
    private var _maxHeartRate = null;

    function start() {
        if (!(Toybox has :ActivityRecording)) {
            return false;
        }

        _heartRate = null;
        _heartRateTotal = 0;
        _heartRateSamples = 0;
        _maxHeartRate = null;

        try {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
            Sensor.enableSensorEvents(method(:onSensor));
        } catch (error) {
            // Activity recording remains useful on products without live sensor access.
        }

        try {
            _session = ActivityRecording.createSession(sessionOptions());
            if (_session.start()) {
                return true;
            }
        } catch (error) {
            // Another activity or a device limitation may prevent a new session.
        }
        _session = null;
        disableSensors();
        return false;
    }

    function onSensor(info as Sensor.Info) as Void {
        if (info.heartRate != null) {
            _heartRate = info.heartRate;
            _heartRateTotal += info.heartRate;
            _heartRateSamples += 1;
            if (_maxHeartRate == null || info.heartRate > _maxHeartRate) {
                _maxHeartRate = info.heartRate;
            }
        }
    }

    function addSetLap() {
        if (_session != null && _session.isRecording()) {
            return _session.addLap();
        }
        return false;
    }

    function isRecording() {
        return _session != null && _session.isRecording();
    }

    function hasSession() {
        return _session != null;
    }

    function hasRecoverableSession() {
        if (_session != null) {
            return true;
        }
        try {
            var info = Activity.getActivityInfo();
            return info != null && info.timerState != null && info.timerState != Activity.TIMER_STATE_OFF;
        } catch (error) {
            return false;
        }
    }

    function recoverAndSave() {
        if (!acquireExistingSession()) {
            return false;
        }
        return stopAndSave();
    }

    function recoverAndDiscard() {
        if (!acquireExistingSession()) {
            return false;
        }
        return discard();
    }

    function stopAndSave() {
        if (_session == null) {
            return false;
        }
        try {
            if (_session.isRecording() && !_session.stop()) {
                return false;
            }
            if (!_session.save()) {
                return false;
            }
        } catch (error) {
            return false;
        }
        _session = null;
        disableSensors();
        return true;
    }

    function discard() {
        if (_session == null) {
            return false;
        }
        try {
            if (_session.isRecording() && !_session.stop()) {
                return false;
            }
            if (!_session.discard()) {
                return false;
            }
        } catch (error) {
            return false;
        }
        _session = null;
        disableSensors();
        return true;
    }

    function getHeartRate() {
        return _heartRate;
    }

    function getAverageHeartRate() {
        if (_heartRateSamples == 0) {
            return null;
        }
        return (_heartRateTotal / _heartRateSamples).toNumber();
    }

    function getMaxHeartRate() {
        return _maxHeartRate;
    }

    private function disableSensors() {
        try {
            Sensor.enableSensorEvents(null);
        } catch (error) {
            // Sensor access is optional; recording cleanup still completes.
        }
    }

    private function acquireExistingSession() {
        if (_session != null) {
            return true;
        }
        if (!(Toybox has :ActivityRecording)) {
            return false;
        }
        // createSession() creates a fresh, unstarted Session when no activity is
        // open. Check Garmin's global timer state first so recovery never
        // mistakes that new object for the workout that was already saved.
        if (!hasRecoverableSession()) {
            return false;
        }
        try {
            // Garmin returns the one unclosed Session, including after an app
            // restart. The timer-state gate above proves one is active.
            _session = ActivityRecording.createSession(sessionOptions());
            return _session != null;
        } catch (error) {
            _session = null;
            return false;
        }
    }

    private function sessionOptions() {
        return {
            :name => "IronDesk",
            :sport => Activity.SPORT_TRAINING,
            :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING
        };
    }
}

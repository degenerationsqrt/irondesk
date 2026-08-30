import Toybox.Math;
import Toybox.System;

const IRONDESK_LB_PER_KG = 2.2046226218;

class IronDeskMath {
    static function usesPounds() {
        var settings = System.getDeviceSettings();
        return settings.weightUnits == System.UNIT_STATUTE;
    }

    static function kgToDisplay(kg) {
        if (kg == null) {
            return 0.0;
        }
        var value = kg.toFloat();
        if (usesPounds()) {
            value *= IRONDESK_LB_PER_KG;
        }
        return roundToHalf(value);
    }

    static function displayToKg(value) {
        var kg = value.toFloat();
        if (usesPounds()) {
            kg /= IRONDESK_LB_PER_KG;
        }
        return (Math.round(kg * 100.0) / 100.0);
    }

    static function unitLabel() {
        return usesPounds() ? "lb" : "kg";
    }

    static function roundToHalf(value) {
        return Math.round(value * 2.0) / 2.0;
    }

    static function formatDuration(seconds) {
        var safeSeconds = seconds < 0 ? 0 : seconds;
        var minutes = (safeSeconds / 60).toNumber();
        var remainder = (safeSeconds % 60).toNumber();
        var suffix = remainder < 10 ? "0" + remainder.toString() : remainder.toString();
        return minutes.toString() + ":" + suffix;
    }
}

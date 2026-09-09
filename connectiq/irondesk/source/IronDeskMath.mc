import Toybox.Math;
import Toybox.System;

const IRONDESK_LB_PER_KG = 2.2046226218;
const IRONDESK_MAX_WEIGHT_KG = 1000.0;

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

    static function weightStep(fine) {
        return weightStepForUnits(usesPounds(), fine);
    }

    static function weightStepForUnits(pounds, fine) {
        if (fine) {
            return 0.5;
        }
        return pounds ? 5.0 : 2.5;
    }

    static function maxDisplayWeight() {
        return maxDisplayWeightForUnits(usesPounds());
    }

    static function maxDisplayWeightForUnits(pounds) {
        var maximum = pounds ? IRONDESK_MAX_WEIGHT_KG * IRONDESK_LB_PER_KG : IRONDESK_MAX_WEIGHT_KG;
        return roundToHalf(maximum);
    }

    static function stepDisplayWeight(value, direction, step, maximum) {
        if (value == null) {
            return direction < 0 ? 0.0 : roundToHalf(step);
        }

        var current = value.toFloat();
        if (current <= 0.0 && direction < 0) {
            return null;
        }

        var next = current + (direction * step);
        if (next < 0.0) {
            next = 0.0;
        } else if (next > maximum) {
            next = maximum;
        }
        return roundToHalf(next);
    }

    static function formatDisplayWeight(value) {
        if (value == null) {
            return "--";
        }
        var doubled = Math.round(value.toFloat() * 2.0).toNumber();
        var whole = (doubled / 2).toNumber();
        return (doubled % 2) == 0 ? whole.toString() : whole.toString() + ".5";
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

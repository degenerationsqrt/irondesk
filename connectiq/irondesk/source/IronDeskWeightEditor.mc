import Toybox.Graphics;
import Toybox.WatchUi;

class IronDeskWeightEditor extends WatchUi.View {
    private var _workoutView;
    private var _originalWeight;
    private var _weight;
    private var _fine = false;
    private var _dirty = false;

    function initialize(workoutView) {
        View.initialize();
        _workoutView = workoutView;
        _weight = workoutView.currentWeightDisplay();
        _originalWeight = _weight;
    }

    function increase() {
        changeWeight(1);
    }

    function decrease() {
        changeWeight(-1);
    }

    function toggleStep() {
        _fine = !_fine;
        WatchUi.requestUpdate();
    }

    function save() {
        if (_dirty && !sameWeight(_weight, _originalWeight)) {
            _workoutView.setCurrentWeightDisplay(_weight);
        }
    }

    function cancel() {
        _weight = _originalWeight;
        _dirty = false;
    }

    private function sameWeight(left, right) {
        if (left == null || right == null) {
            return left == null && right == null;
        }
        return left == right;
    }

    private function changeWeight(direction) {
        _weight = IronDeskMath.stepDisplayWeight(
            _weight,
            direction,
            IronDeskMath.weightStep(_fine),
            IronDeskMath.maxDisplayWeight()
        );
        _dirty = true;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        var width = dc.getWidth();
        var height = dc.getHeight();
        var unit = IronDeskMath.unitLabel();
        var step = IronDeskMath.weightStep(_fine);
        var mode = (_fine ? "FINE " : "COARSE ") + IronDeskMath.formatDisplayWeight(step) + " " + unit;
        var state = "";
        var hint = "UP +" + IronDeskMath.formatDisplayWeight(step) + "   DOWN -" + IronDeskMath.formatDisplayWeight(step);
        if (_weight == null) {
            state = "UNSET   ";
            hint = "UP sets " + IronDeskMath.formatDisplayWeight(step) + "   DOWN zero";
        } else if (_weight == 0.0) {
            state = "ZERO LOAD   ";
            hint = "UP +" + IronDeskMath.formatDisplayWeight(step) + "   DOWN unset";
        }

        dc.setColor(0x05080D, 0x05080D);
        dc.clear();

        dc.setColor(0x2196F3, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.08, Graphics.FONT_XTINY, "EDIT WEIGHT", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            width / 2,
            height * 0.30,
            Graphics.FONT_LARGE,
            IronDeskMath.formatDisplayWeight(_weight) + " " + unit,
            Graphics.TEXT_JUSTIFY_CENTER
        );

        dc.setColor(_weight == null ? 0xF2B84B : 0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            width / 2,
            height * 0.49,
            Graphics.FONT_XTINY,
            state + mode,
            Graphics.TEXT_JUSTIFY_CENTER
        );

        dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(width / 2, height * 0.62, Graphics.FONT_XTINY, hint, Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, height * 0.74, Graphics.FONT_XTINY, "HOLD MENU toggles step", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(width / 2, height * 0.84, Graphics.FONT_XTINY, "START save   BACK cancel", Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class IronDeskWeightEditorDelegate extends WatchUi.BehaviorDelegate {
    private var _editor;

    function initialize(editor) {
        BehaviorDelegate.initialize();
        _editor = editor;
    }

    function onPreviousPage() {
        _editor.increase();
        return true;
    }

    function onNextPage() {
        _editor.decrease();
        return true;
    }

    function onMenu() {
        _editor.toggleStep();
        return true;
    }

    function onSelect() {
        _editor.save();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onBack() {
        _editor.cancel();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}

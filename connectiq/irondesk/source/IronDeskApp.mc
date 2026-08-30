import Toybox.Application;
import Toybox.WatchUi;

class IronDeskApp extends Application.AppBase {
    private var _view = null;

    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() {
        _view = new IronDeskView();
        return [_view, new IronDeskDelegate(_view)];
    }

    function onStop(state) {
        if (_view != null) {
            _view.onAppStop();
        }
    }

    function onSettingsChanged() {
        if (_view != null) {
            _view.onSettingsChanged();
        }
    }
}

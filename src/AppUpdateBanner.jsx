import React, { useEffect, useState } from "react";
import { APP_VERSION, UPDATE_AVAILABLE_EVENT } from "./release.js";

export function AppUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const showUpdate = () => setUpdateAvailable(true);
    window.addEventListener(UPDATE_AVAILABLE_EVENT, showUpdate);
    return () => window.removeEventListener(UPDATE_AVAILABLE_EVENT, showUpdate);
  }, []);

  if (!updateAvailable) return null;

  return (
    <aside className="app-update-banner" role="status">
      <div>
        <strong>IronDesk was updated</strong>
        <span>Reload once to use version {APP_VERSION}.</span>
      </div>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </aside>
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import IronDesk from "./IronDesk.jsx";
import { UPDATE_AVAILABLE_EVENT } from "./release.js";
import "./styles.css";

const root = document.getElementById("root");

try {
  createRoot(root).render(React.createElement(IronDesk));
} catch (error) {
  root.replaceChildren();
  const message = document.createElement("div");
  message.className = "boot boot-error";
  message.textContent = `IronDesk could not start: ${error instanceof Error ? error.message : "Unknown error"}`;
  root.appendChild(message);
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: "./" })
      .then(registration => {
        const announceUpdate = () => window.dispatchEvent(new Event(UPDATE_AVAILABLE_EVENT));
        if (registration.waiting && navigator.serviceWorker.controller) announceUpdate();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
          });
        });
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (hadController) announceUpdate();
        });
      })
      .catch(() => {});
  });
}

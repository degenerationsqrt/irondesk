import React from "react";
import { createRoot } from "react-dom/client";
import IronDesk from "./IronDesk.jsx";
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
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: "./" }).catch(() => {});
  });
}

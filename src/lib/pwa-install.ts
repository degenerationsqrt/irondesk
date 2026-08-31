export type InstallPlatform = "ios" | "android" | "desktop";

export interface InstallEnvironment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface InstallInstructions {
  title: string;
  steps: string[];
}

export const INSTALL_OFFER_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

/** Detect iPadOS as iOS even when it reports a desktop Mac platform. */
export function detectInstallPlatform({
  userAgent,
  platform = "",
  maxTouchPoints = 0,
}: InstallEnvironment): InstallPlatform {
  const iosDevice = /iPad|iPhone|iPod/i.test(userAgent);
  const iPadDesktopMode = platform === "MacIntel" && maxTouchPoints > 1;
  if (iosDevice || iPadDesktopMode) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

export function installInstructions(platform: InstallPlatform): InstallInstructions {
  if (platform === "ios") {
    return {
      title: "Add IronDesk from Safari",
      steps: [
        "Open IronDesk in Safari.",
        "Tap the Share button in Safari’s toolbar.",
        "Choose Add to Home Screen, then tap Add.",
      ],
    };
  }

  if (platform === "android") {
    return {
      title: "Install IronDesk on Android",
      steps: [
        "Open IronDesk in Chrome.",
        "Open Chrome’s menu and choose Install app or Add to Home screen.",
        "Confirm Install to open IronDesk in its own app window.",
      ],
    };
  }

  return {
    title: "Install IronDesk",
    steps: [
      "Open IronDesk in Chrome or Edge.",
      "Select the install icon in the address bar, or open the browser menu and choose Install IronDesk.",
      "Confirm Install to open IronDesk in its own app window.",
    ],
  };
}

export function hasActiveInstallDismissal(value: string | null, now = Date.now()): boolean {
  if (!value) return false;
  const dismissedAt = Number(value);
  return (
    Number.isFinite(dismissedAt) && dismissedAt > 0 && now - dismissedAt < INSTALL_OFFER_DISMISS_MS
  );
}

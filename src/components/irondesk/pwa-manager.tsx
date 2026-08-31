import {
  Download,
  MoreVertical,
  RefreshCw,
  Share2,
  Smartphone,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detectInstallPlatform,
  hasActiveInstallDismissal,
  installInstructions,
  type InstallPlatform,
} from "@/lib/pwa-install";
import { PwaContext, type PwaContextValue, usePwaInstall } from "@/lib/pwa-context";

const INSTALL_DISMISS_KEY = "irondesk-pwa-install-dismissed-at";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

function inStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as NavigatorWithStandalone).standalone)
  );
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadForUpdateRef = useRef(false);
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(true);
  const [connectionRestored, setConnectionRestored] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [promptAvailable, setPromptAvailable] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");
  const [installPreferenceLoaded, setInstallPreferenceLoaded] = useState(false);
  const [installOfferDismissed, setInstallOfferDismissed] = useState(false);
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [showUpdate, setShowUpdate] = useState(true);

  useEffect(() => {
    setMounted(true);
    setOnline(window.navigator.onLine);
    setInstalled(inStandaloneMode());
    setPlatform(
      detectInstallPlatform({
        userAgent: window.navigator.userAgent,
        platform: window.navigator.platform,
        maxTouchPoints: window.navigator.maxTouchPoints,
      }),
    );

    try {
      setInstallOfferDismissed(
        hasActiveInstallDismissal(window.localStorage.getItem(INSTALL_DISMISS_KEY)),
      );
    } catch {
      setInstallOfferDismissed(false);
    } finally {
      setInstallPreferenceLoaded(true);
    }

    const displayMode = window.matchMedia("(display-mode: standalone)");
    const syncInstalledState = () => setInstalled(inStandaloneMode());
    const onAppInstalled = () => {
      promptRef.current = null;
      setPromptAvailable(false);
      setInstalled(true);
      setInstallHelpOpen(false);
      try {
        window.localStorage.removeItem(INSTALL_DISMISS_KEY);
      } catch {
        // Install completion must not depend on storage access.
      }
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      promptRef.current = event as BeforeInstallPromptEvent;
      setPromptAvailable(true);
    };

    displayMode.addEventListener("change", syncInstalledState);
    window.addEventListener("appinstalled", onAppInstalled);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    return () => {
      displayMode.removeEventListener("change", syncInstalledState);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    const onOffline = () => {
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
      setConnectionRestored(false);
      setOnline(false);
    };
    const onOnline = () => {
      setOnline(true);
      setConnectionRestored(true);
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
      restoredTimerRef.current = setTimeout(() => setConnectionRestored(false), 3500);
      void registrationRef.current?.update().catch(() => undefined);
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let registration: ServiceWorkerRegistration | null = null;

    const showWaitingWorker = (worker: ServiceWorker | null) => {
      if (!cancelled && worker && navigator.serviceWorker.controller) {
        setWaitingWorker(worker);
        setShowUpdate(true);
      }
    };
    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      const onStateChange = () => {
        if (installing.state === "installed")
          showWaitingWorker(registration?.waiting ?? installing);
      };
      installing.addEventListener("statechange", onStateChange);
    };
    const checkForUpdate = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void registration?.update().catch(() => undefined);
      }
    };
    const onControllerChange = () => {
      if (!reloadForUpdateRef.current) return;
      reloadForUpdateRef.current = false;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((nextRegistration) => {
        if (cancelled) return;
        registration = nextRegistration;
        registrationRef.current = nextRegistration;
        showWaitingWorker(nextRegistration.waiting);
        nextRegistration.addEventListener("updatefound", onUpdateFound);
        intervalId = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
        window.addEventListener("focus", checkForUpdate);
        document.addEventListener("visibilitychange", checkForUpdate);
      })
      .catch((error: unknown) => {
        console.warn("IronDesk could not register its offline shell.", error);
      });

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      registration?.removeEventListener("updatefound", onUpdateFound);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", checkForUpdate);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  const dismissInstallOffer = useCallback(() => {
    setInstallOfferDismissed(true);
    try {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      // A storage-restricted browser can still dismiss the offer for this page session.
    }
  }, []);

  const openInstall = useCallback(async () => {
    const prompt = promptRef.current;
    if (!prompt) {
      setInstallHelpOpen(true);
      return;
    }

    await prompt.prompt();
    const choice = await prompt.userChoice;
    promptRef.current = null;
    setPromptAvailable(false);
    if (choice.outcome === "dismissed") dismissInstallOffer();
  }, [dismissInstallOffer]);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorker ?? registrationRef.current?.waiting;
    if (!worker) {
      void registrationRef.current?.update().catch(() => undefined);
      return;
    }
    reloadForUpdateRef.current = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  const installControlVisible = mounted && !installed;
  const automaticInstallOfferVisible =
    mounted &&
    installPreferenceLoaded &&
    !installed &&
    !installOfferDismissed &&
    !waitingWorker &&
    (promptAvailable || platform === "ios" || platform === "android");
  const instructions = installInstructions(platform);

  const context = useMemo<PwaContextValue>(
    () => ({ installed, installControlVisible, openInstall }),
    [installed, installControlVisible, openInstall],
  );

  return (
    <PwaContext.Provider value={context}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        {!online && (
          <div
            role="status"
            aria-live="assertive"
            className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-warning/50 bg-[#17130b]/96 px-4 py-3 text-sm shadow-2xl backdrop-blur"
          >
            <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" />
            <div>
              <p className="font-semibold text-warning">IronDesk is offline</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You can keep viewing this screen, but do not assume changes are synced until the
                connection returns and IronDesk confirms them.
              </p>
            </div>
          </div>
        )}
        {online && connectionRestored && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-success/40 bg-[#0b1b14]/96 px-4 py-2.5 text-sm font-semibold text-success shadow-2xl backdrop-blur"
          >
            <Wifi className="size-4" /> Back online
          </div>
        )}
      </div>

      {(waitingWorker && showUpdate) || automaticInstallOfferVisible ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] flex justify-center px-3 lg:bottom-4">
          {waitingWorker && showUpdate ? (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-primary/40 bg-surface/96 p-4 shadow-2xl backdrop-blur"
            >
              <RefreshCw className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">An IronDesk update is ready</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Refresh once to use the newest app shell. Your server-saved training data is not
                  removed by this update.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={applyUpdate}>
                    <RefreshCw className="size-3.5" /> Update now
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowUpdate(false)}>
                    Later
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="pointer-events-auto flex w-full max-w-xl items-start gap-3 rounded-xl border border-primary/40 bg-surface/96 p-4 shadow-2xl backdrop-blur">
              <Download className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Install IronDesk</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add IronDesk to your home screen and open it in a focused, standalone app window.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void openInstall()}>
                    <Download className="size-3.5" /> {promptAvailable ? "Install" : "Show me how"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dismissInstallOffer}>
                    Not now
                  </Button>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissInstallOffer}
                aria-label="Dismiss install suggestion"
                className="rounded-md p-1 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </div>
      ) : null}

      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="max-w-md border-border-strong bg-surface">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="size-5 text-primary" /> {instructions.title}
            </DialogTitle>
            <DialogDescription>
              Installation adds an IronDesk icon and opens the site without normal browser chrome.
              Sign-in and network requirements do not change.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3">
            {instructions.steps.map((step, index) => (
              <li key={step} className="flex gap-3 text-sm">
                <span className="numeric flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                <span className="pt-0.5 text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            {platform === "ios" ? (
              <Share2 className="size-4 shrink-0 text-primary" />
            ) : (
              <MoreVertical className="size-4 shrink-0 text-primary" />
            )}
            If the install option is missing, confirm you are using a supported browser over HTTPS.
          </div>
          <DialogFooter>
            <Button onClick={() => setInstallHelpOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PwaContext.Provider>
  );
}

export function PwaInstallButton() {
  const { installed, installControlVisible, openInstall } = usePwaInstall();
  if (!installControlVisible || installed) return null;

  return (
    <button
      type="button"
      onClick={() => void openInstall()}
      className="inline-flex size-8 items-center justify-center rounded-md border border-border-strong bg-surface-2 text-muted-foreground transition hover:border-primary/40 hover:text-primary sm:w-auto sm:gap-1.5 sm:px-2.5"
      aria-label="Install IronDesk"
      title="Install IronDesk"
    >
      <Download className="size-3.5" />
      <span className="hidden text-xs font-semibold xl:inline">Install</span>
    </button>
  );
}

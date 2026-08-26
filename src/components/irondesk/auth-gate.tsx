import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { AppShell } from "@/components/irondesk/app-shell";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountQuery } from "@/lib/irondesk/queries";

/** Routes rendered outside the app shell and outside the auth gate. */
/** OAuth consent handles its own session redirect, so it renders outside the gate. */
const CONSENT_PATH = "/.lovable/oauth/consent";
const PUBLIC_PATHS = ["/auth", CONSENT_PATH];
const BARE_PATHS = ["/auth", "/onboarding", CONSENT_PATH];

function Splash({ label }: { label: string }) {
  return (
    <div className="grid-fade flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <p className="font-display text-2xl font-extrabold uppercase tracking-[0.18em]">
        Iron<span className="text-primary">Desk</span>
      </p>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {label}
      </p>
    </div>
  );
}

/**
 * Client-side gate. Session restoration happens in the browser, so the server
 * renders the splash and the gate resolves once `ready` flips — no flicker of
 * protected content and no SSR redirect loops.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { ready, user, demo } = useAuth();

  const isPublic = PUBLIC_PATHS.includes(pathname);
  const bare = BARE_PATHS.includes(pathname);

  const { data: account, isPending: accountPending } = useQuery({
    ...accountQuery,
    enabled: Boolean(user) && ready,
  });

  const needsOnboarding = Boolean(user) && Boolean(account) && !account?.profile?.onboarding_completed;

  useEffect(() => {
    if (!ready) return;
    if (!user && !demo && !isPublic) {
      void navigate({ to: "/auth", search: { redirect: pathname }, replace: true });
      return;
    }
    if (user && needsOnboarding && pathname !== "/onboarding") {
      void navigate({ to: "/onboarding", replace: true });
      return;
    }
    if (user && !needsOnboarding && pathname === "/onboarding" && account) {
      void navigate({ to: "/", replace: true });
    }
  }, [ready, user, demo, isPublic, needsOnboarding, pathname, navigate, account]);

  if (bare) return <>{children}</>;
  if (!ready) return <Splash label="Restoring session…" />;
  if (!user && !demo) return <Splash label="Redirecting to sign in…" />;
  if (user && accountPending) return <Splash label="Loading your athlete profile…" />;
  if (user && needsOnboarding) return <Splash label="Opening setup…" />;

  return <AppShell>{children}</AppShell>;
}

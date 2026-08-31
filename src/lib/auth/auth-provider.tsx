import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { supabase } from "@/integrations/supabase/client";

const DEMO_KEY = "irondesk.demo";

export type DataMode = "demo" | "live" | "none";

export interface AuthContextValue {
  /** True once the browser has resolved the persisted session (avoids flicker). */
  ready: boolean;
  session: Session | null;
  user: User | null;
  demo: boolean;
  mode: DataMode;
  enterDemo: () => void;
  exitDemo: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    displayName: string,
  ) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  deleteAccount: (input: { password: string; confirmation: string }) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Maps Supabase auth errors to copy the athlete can act on. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials"))
    return "That email and password combination doesn't match an account.";
  if (m.includes("email not confirmed"))
    return "Confirm your email address first — check your inbox for the IronDesk link.";
  if (
    m.includes("already registered") ||
    m.includes("already been registered") ||
    m.includes("user already exists")
  )
    return "An account already exists for that email. Sign in instead.";
  if (m.includes("password should be at least"))
    return "Use at least 6 characters for your password.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "Too many attempts. Wait a minute and try again.";
  if (m.includes("session") && m.includes("missing")) return "Your session expired. Sign in again.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState(false);
  const bootstrapped = useRef<string | null>(null);

  useEffect(() => {
    setDemo(window.localStorage.getItem(DEMO_KEY) === "1");

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });

    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setReady(true));

    return () => sub.subscription.unsubscribe();
  }, []);

  // Idempotent account bootstrap: guarantees profile + preferences rows exist.
  useEffect(() => {
    const user = session?.user;
    if (!user || bootstrapped.current === user.id) return;
    bootstrapped.current = user.id;
    const displayName =
      (user.user_metadata?.["display_name"] as string | undefined) ??
      user.email?.split("@")[0] ??
      "Athlete";
    void supabase.rpc("bootstrap_current_user", { _display_name: displayName });
  }, [session?.user]);

  const enterDemo = useCallback(() => {
    window.localStorage.setItem(DEMO_KEY, "1");
    setDemo(true);
  }, []);

  const exitDemo = useCallback(() => {
    window.localStorage.removeItem(DEMO_KEY);
    setDemo(false);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendlyAuthError(error.message));
    window.localStorage.removeItem(DEMO_KEY);
    setDemo(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: { display_name: displayName.trim() },
      },
    });
    if (error) throw new Error(friendlyAuthError(error.message));
    // Supabase returns an identity-less user when the email is already taken.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      throw new Error("An account already exists for that email. Sign in instead.");
    }
    if (data.session) {
      window.localStorage.removeItem(DEMO_KEY);
      setDemo(false);
    }
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
  }, []);

  const deleteAccount = useCallback(
    async ({ password, confirmation }: { password: string; confirmation: string }) => {
      const { data, error } = await supabase.auth.getSession();
      const current = data.session;
      if (error || !current?.access_token || !current.user.email) {
        throw new Error("Your session expired. Sign in again before deleting your account.");
      }

      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: {
          authorization: `Bearer ${current.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: current.user.email,
          password,
          confirmation,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "IronDesk could not delete the account. Try again.",
        );
      }

      // Auth deletion removes refresh sessions server-side. Clear this browser's
      // cached access token as well; a local sign-out error is harmless because
      // the account has already been removed and the React state is cleared.
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      bootstrapped.current = null;
      window.localStorage.removeItem(DEMO_KEY);
      setDemo(false);
      setSession(null);
    },
    [],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth`,
    });
    if (error) throw new Error(friendlyAuthError(error.message));
  }, []);

  const user = session?.user ?? null;
  const mode: DataMode = user ? "live" : demo ? "demo" : "none";

  return (
    <AuthContext.Provider
      value={{
        ready,
        session,
        user,
        demo: demo && !user,
        mode,
        enterDemo,
        exitDemo,
        signIn,
        signUp,
        signOut,
        deleteAccount,
        requestPasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

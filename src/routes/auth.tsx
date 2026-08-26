import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-provider";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign In — IronDesk Training Intelligence" },
      {
        name: "description",
        content:
          "Sign in to IronDesk to track training load, strength progression, recovery readiness and nutrition in one athlete command center.",
      },
      { property: "og:title", content: "Sign In — IronDesk" },
      { property: "og:description", content: "Your training intelligence account: sessions, strain, readiness and progression." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "reset";

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const { signIn, signUp, requestPasswordReset, enterDemo } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const destination = search.redirect && search.redirect.startsWith("/") ? search.redirect : "/";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        await requestPasswordReset(email);
        setNotice("Password reset link sent. Check your inbox.");
      } else if (mode === "signup") {
        const parsed = z
          .object({
            displayName: z.string().min(2, "Enter your name."),
            email: z.string().email("Enter a valid email."),
            password: z.string().min(6, "Use at least 6 characters."),
          })
          .safeParse({ displayName, email, password });
        if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
        const { needsConfirmation } = await signUp(email, password, displayName);
        if (needsConfirmation) {
          setNotice("Account created. Confirm your email address, then sign in.");
          setMode("signin");
        } else {
          void navigate({ to: "/onboarding" });
        }
      } else {
        await signIn(email, password);
        void navigate({ to: destination });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-fade flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-display text-3xl font-extrabold uppercase tracking-[0.18em]">
            Iron<span className="text-primary">Desk</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Training intelligence for serious athletes.</p>
        </div>

        <div className="panel p-5 sm:p-6">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setNotice(null);
                }}
                className={`h-9 rounded text-xs font-bold uppercase tracking-widest transition ${
                  mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "signin" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="athlete@example.com"
              />
            </div>

            {mode !== "reset" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
            )}
            {notice && (
              <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</p>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Working…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "reset"
                    ? "Send reset link"
                    : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              className="text-muted-foreground transition hover:text-foreground"
              onClick={() => {
                setMode(mode === "reset" ? "signin" : "reset");
                setError(null);
                setNotice(null);
              }}
            >
              {mode === "reset" ? "Back to sign in" : "Forgot password?"}
            </button>
            <span className="text-muted-foreground">Email confirmation may be required.</span>
          </div>
        </div>

        <div className="mt-6 text-center">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="label-eyebrow">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              enterDemo();
              void navigate({ to: "/" });
            }}
          >
            Explore Demo
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Demo mode uses a fixed sample athlete. Nothing you do there is saved.
          </p>
        </div>
      </div>
    </div>
  );
}

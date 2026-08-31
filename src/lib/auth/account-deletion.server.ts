import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

const MAX_BODY_BYTES = 4_096;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

type AccountIdentity = {
  id: string;
  email: string | null;
};

type PortResult<T> = {
  data: T | null;
  error: {
    code: string | undefined;
    message: string | undefined;
    status: number | undefined;
  } | null;
};

export interface AccountDeletionPorts {
  getUser: (accessToken: string) => Promise<PortResult<AccountIdentity>>;
  verifyPassword: (email: string, password: string) => Promise<PortResult<{ userId: string }>>;
  revokeSessions: (accessToken: string) => Promise<PortResult<true>>;
  deleteUser: (userId: string) => Promise<PortResult<true>>;
}

export interface AccountDeletionInput {
  accessToken: string;
  email: string;
  password: string;
  confirmation: string;
}

export class AccountDeletionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "AccountDeletionError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Performs the destructive decision without accepting a client-supplied user id.
 * The bearer token is resolved first, then the password identity must match it.
 */
export async function deleteAuthenticatedAccount(
  input: AccountDeletionInput,
  ports: AccountDeletionPorts,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (input.confirmation !== "DELETE") {
    throw new AccountDeletionError(
      "Type DELETE exactly to confirm permanent account deletion.",
      "confirmation_required",
      400,
    );
  }
  if (!email || !input.password || input.password.length > 512) {
    throw new AccountDeletionError(
      "Enter your current password to confirm account deletion.",
      "credentials_required",
      400,
    );
  }

  const authenticated = await ports.getUser(input.accessToken);
  if (authenticated.error || !authenticated.data) {
    throw new AccountDeletionError(
      "Your session expired. Sign in again before deleting your account.",
      "invalid_session",
      401,
    );
  }

  const authenticatedEmail = authenticated.data.email?.trim().toLowerCase() ?? "";
  if (!authenticatedEmail || authenticatedEmail !== email) {
    throw new AccountDeletionError(
      "The signed-in account could not be verified.",
      "identity_mismatch",
      403,
    );
  }

  const verified = await ports.verifyPassword(email, input.password);
  if (verified.error || verified.data?.userId !== authenticated.data.id) {
    throw new AccountDeletionError(
      "The current password is incorrect.",
      "password_verification_failed",
      403,
    );
  }

  // Supabase access JWTs are stateless and remain valid until their exp claim,
  // but global admin sign-out removes every refresh session so no new token can
  // be minted. Refuse deletion if that revocation did not succeed.
  const revoked = await ports.revokeSessions(input.accessToken);
  if (revoked.error || revoked.data !== true) {
    throw new AccountDeletionError(
      "IronDesk could not revoke all account sessions. Sign out and try again.",
      "session_revocation_failed",
      503,
    );
  }

  const removed = await ports.deleteUser(authenticated.data.id);
  if (removed.error || removed.data !== true) {
    const diagnostic = removed.error?.code?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
    throw new AccountDeletionError(
      `IronDesk could not delete the account. Try again or report reference auth-delete/${diagnostic || "unknown"}.`,
      "account_delete_failed",
      409,
    );
  }

  return authenticated.data.id;
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(header);
  if (!match?.[1] || match[1].split(".").length !== 3) {
    throw new AccountDeletionError(
      "Your session expired. Sign in again before deleting your account.",
      "invalid_session",
      401,
    );
  }
  return match[1];
}

async function parseBody(request: Request): Promise<{
  email: string;
  password: string;
  confirmation: string;
}> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new AccountDeletionError("The deletion request is too large.", "invalid_request", 413);
  }
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let raw = "";
    let receivedBytes = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new AccountDeletionError(
            "The deletion request is too large.",
            "invalid_request",
            413,
          );
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    }
    body = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof AccountDeletionError) throw error;
    throw new AccountDeletionError("The deletion request is invalid.", "invalid_request", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AccountDeletionError("The deletion request is invalid.", "invalid_request", 400);
  }
  const record = body as Record<string, unknown>;
  return {
    email: typeof record["email"] === "string" ? record["email"] : "",
    password: typeof record["password"] === "string" ? record["password"] : "",
    confirmation: typeof record["confirmation"] === "string" ? record["confirmation"] : "",
  };
}

const attempts = new Map<string, number[]>();

function consumeAttempt(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < ATTEMPT_WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 1_000) {
    for (const [candidate, values] of attempts) {
      if (values.every((at) => now - at >= ATTEMPT_WINDOW_MS)) attempts.delete(candidate);
    }
  }
  return recent.length <= MAX_ATTEMPTS_PER_WINDOW;
}

function publicClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new AccountDeletionError(
      "Account deletion is temporarily unavailable.",
      "server_configuration_error",
      503,
    );
  }
  return createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Same-origin, authenticated server boundary for irreversible Auth deletion. */
export async function handleAccountDeletionRequest(request: Request): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      throw new AccountDeletionError(
        "Cross-site deletion requests are not allowed.",
        "bad_origin",
        403,
      );
    }

    const accessToken = bearerToken(request);
    const body = await parseBody(request);
    const client = publicClient();
    const authenticated = await client.auth.getUser(accessToken);
    const rateLimitKey = authenticated.data.user?.id ?? accessToken.slice(-24);
    if (!consumeAttempt(rateLimitKey)) {
      throw new AccountDeletionError(
        "Too many deletion attempts. Wait 15 minutes and try again.",
        "rate_limited",
        429,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await deleteAuthenticatedAccount(
      { accessToken, ...body },
      {
        getUser: async () => ({
          data: authenticated.data.user
            ? { id: authenticated.data.user.id, email: authenticated.data.user.email ?? null }
            : null,
          error: authenticated.error
            ? {
                code: authenticated.error.code,
                message: authenticated.error.message,
                status: authenticated.error.status,
              }
            : null,
        }),
        verifyPassword: async (email, password) => {
          const result = await client.auth.signInWithPassword({ email, password });
          return {
            data: result.data.user ? { userId: result.data.user.id } : null,
            error: result.error
              ? {
                  code: result.error.code,
                  message: result.error.message,
                  status: result.error.status,
                }
              : null,
          };
        },
        revokeSessions: async (token) => {
          const result = await supabaseAdmin.auth.admin.signOut(token, "global");
          if (result.error) {
            console.error("[Account deletion] Global session revocation failed", {
              code: result.error.code,
              status: result.error.status,
            });
          }
          return {
            data: result.error ? null : true,
            error: result.error
              ? {
                  code: result.error.code,
                  message: result.error.message,
                  status: result.error.status,
                }
              : null,
          };
        },
        deleteUser: async (userId) => {
          const result = await supabaseAdmin.auth.admin.deleteUser(userId, false);
          if (result.error) {
            console.error("[Account deletion] Supabase Auth deletion failed", {
              code: result.error.code,
              status: result.error.status,
            });
          }
          return {
            // GoTrue's successful admin-delete response may contain an empty
            // user object. The already authenticated userId is authoritative;
            // a response without an error means that identity was deleted.
            data: result.error ? null : true,
            error: result.error
              ? {
                  code: result.error.code,
                  message: result.error.message,
                  status: result.error.status,
                }
              : null,
          };
        },
      },
    );

    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error("[Account deletion] Unexpected failure", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return json(
      { error: "Account deletion is temporarily unavailable.", code: "unexpected_error" },
      500,
    );
  }
}

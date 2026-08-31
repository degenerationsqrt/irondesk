import { describe, expect, it, vi } from "vitest";

import {
  AccountDeletionError,
  deleteAuthenticatedAccount,
  handleAccountDeletionRequest,
  type AccountDeletionPorts,
} from "../src/lib/auth/account-deletion.server";

function ports(overrides: Partial<AccountDeletionPorts> = {}): AccountDeletionPorts {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { id: "user-from-token", email: "athlete@example.com" },
      error: null,
    }),
    verifyPassword: vi.fn().mockResolvedValue({
      data: { userId: "user-from-token" },
      error: null,
    }),
    revokeSessions: vi.fn().mockResolvedValue({ data: true, error: null }),
    deleteUser: vi.fn().mockResolvedValue({ data: true, error: null }),
    ...overrides,
  };
}

const input = {
  accessToken: "signed.jwt.value",
  email: "ATHLETE@example.com ",
  password: "correct horse battery staple",
  confirmation: "DELETE",
};

describe("self-service account deletion", () => {
  it("deletes only the identity resolved from the bearer token", async () => {
    const dependencies = ports();

    await expect(deleteAuthenticatedAccount(input, dependencies)).resolves.toBe("user-from-token");

    expect(dependencies.getUser).toHaveBeenCalledWith("signed.jwt.value");
    expect(dependencies.verifyPassword).toHaveBeenCalledWith(
      "athlete@example.com",
      "correct horse battery staple",
    );
    expect(dependencies.revokeSessions).toHaveBeenCalledWith("signed.jwt.value");
    expect(dependencies.deleteUser).toHaveBeenCalledWith("user-from-token");
    expect(vi.mocked(dependencies.revokeSessions).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(dependencies.deleteUser).mock.invocationCallOrder[0]!,
    );
  });

  it("refuses a password identity that does not match the bearer identity", async () => {
    const dependencies = ports({
      verifyPassword: vi
        .fn()
        .mockResolvedValue({ data: { userId: "different-user" }, error: null }),
    });

    await expect(deleteAuthenticatedAccount(input, dependencies)).rejects.toMatchObject<
      Partial<AccountDeletionError>
    >({ code: "password_verification_failed", status: 403 });
    expect(dependencies.revokeSessions).not.toHaveBeenCalled();
    expect(dependencies.deleteUser).not.toHaveBeenCalled();
  });

  it("fails closed for an OAuth-only identity without a verifiable password", async () => {
    const dependencies = ports({
      verifyPassword: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "invalid_credentials",
          message: "OAuth identity has no password",
          status: 400,
        },
      }),
    });

    await expect(deleteAuthenticatedAccount(input, dependencies)).rejects.toMatchObject<
      Partial<AccountDeletionError>
    >({ code: "password_verification_failed", status: 403 });
    expect(dependencies.revokeSessions).not.toHaveBeenCalled();
    expect(dependencies.deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete the account when global session revocation fails", async () => {
    const dependencies = ports({
      revokeSessions: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "unexpected_failure", message: "unavailable", status: 503 },
      }),
    });

    await expect(deleteAuthenticatedAccount(input, dependencies)).rejects.toMatchObject<
      Partial<AccountDeletionError>
    >({ code: "session_revocation_failed", status: 503 });
    expect(dependencies.deleteUser).not.toHaveBeenCalled();
  });

  it("requires exact destructive confirmation before any auth call", async () => {
    const dependencies = ports();

    await expect(
      deleteAuthenticatedAccount({ ...input, confirmation: "delete" }, dependencies),
    ).rejects.toMatchObject<Partial<AccountDeletionError>>({
      code: "confirmation_required",
      status: 400,
    });
    expect(dependencies.getUser).not.toHaveBeenCalled();
    expect(dependencies.verifyPassword).not.toHaveBeenCalled();
    expect(dependencies.revokeSessions).not.toHaveBeenCalled();
    expect(dependencies.deleteUser).not.toHaveBeenCalled();
  });

  it("returns a stable reference without exposing the admin error message", async () => {
    const dependencies = ports({
      deleteUser: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: "storage_owner_conflict",
          message: "internal object and account details",
          status: 422,
        },
      }),
    });

    await expect(deleteAuthenticatedAccount(input, dependencies)).rejects.toMatchObject<
      Partial<AccountDeletionError>
    >({
      code: "account_delete_failed",
      status: 409,
      message:
        "IronDesk could not delete the account. Try again or report reference auth-delete/storage_owner_conflict.",
    });
  });
});

describe("account-deletion HTTP boundary", () => {
  it("rejects cross-site requests before reading credentials", async () => {
    const response = await handleAccountDeletionRequest(
      new Request("https://irondeskpro.lovable.app/api/account/delete", {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "bad_origin" });
  });

  it("rejects a malformed bearer token without exposing server configuration", async () => {
    const response = await handleAccountDeletionRequest(
      new Request("https://irondeskpro.lovable.app/api/account/delete", {
        method: "POST",
        headers: {
          origin: "https://irondeskpro.lovable.app",
          authorization: "Bearer not-a-jwt",
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_session" });
  });

  it("enforces the body limit before constructing a Supabase client", async () => {
    const response = await handleAccountDeletionRequest(
      new Request("https://irondeskpro.lovable.app/api/account/delete", {
        method: "POST",
        headers: {
          origin: "https://irondeskpro.lovable.app",
          authorization: "Bearer signed.jwt.value",
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "x".repeat(4_100) }),
      }),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
  });
});

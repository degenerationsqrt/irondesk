import { describe, expect, it } from "vitest";

import { createIdentityDataScope, dataScopeKey } from "../src/lib/irondesk/identity-data-scope";

describe("authenticated data scope", () => {
  it("separates account identities, anonymous visits and demo without resetting on token refresh", () => {
    expect(dataScopeKey("athlete-a", false)).not.toBe(dataScopeKey("athlete-b", false));
    expect(dataScopeKey(null, false)).not.toBe(dataScopeKey(null, true));
    expect(dataScopeKey("athlete-a", true)).toBe(dataScopeKey("athlete-a", false));
    expect(dataScopeKey("demo", false)).not.toBe(dataScopeKey(null, true));
  });

  it("never serves another account's profile, workouts or imports under the existing feature keys", async () => {
    const first = createIdentityDataScope();
    const next = createIdentityDataScope();
    const keys = [
      ["irondesk", "account"],
      ["irondesk", "live", "workout"],
      ["irondesk", "live", "imported-activities"],
    ];
    for (const queryKey of keys) {
      first.queryClient.setQueryData(queryKey, { owner: "athlete-a" });
      expect(next.queryClient.getQueryData(queryKey)).toBeUndefined();
      await expect(
        next.queryClient.fetchQuery({
          queryKey,
          queryFn: async () => ({ owner: "athlete-b" }),
        }),
      ).resolves.toEqual({ owner: "athlete-b" });
      expect(first.queryClient.getQueryData(queryKey)).toEqual({ owner: "athlete-a" });
    }
    first.dispose();
    next.dispose();
  });

  it("removes private mutation results along with queries when leaving an account", async () => {
    const scope = createIdentityDataScope();
    scope.queryClient.setQueryData(["irondesk", "account"], { name: "Private profile" });
    const mutation = scope.queryClient.getMutationCache().build(scope.queryClient, {
      mutationFn: async () => ({ privateDeviceToken: "private-result" }),
    });
    await mutation.execute(undefined);
    scope.dispose();
    expect(scope.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(scope.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("cancels a retired query and contains its late response when the transport ignores abort", async () => {
    const first = createIdentityDataScope();
    const next = createIdentityDataScope();
    const queryKey = ["irondesk", "account"];
    let resolve!: (value: { owner: string }) => void;
    let requestSignal: AbortSignal | undefined;
    const request = first.queryClient.fetchQuery({
      queryKey,
      queryFn: ({ signal }) => {
        requestSignal = signal;
        return new Promise<{ owner: string }>((done) => {
          resolve = done;
        });
      },
    });
    // Observe cancellation before disposing to avoid an unhandled rejection.
    const settled = request.catch(() => "cancelled");
    next.queryClient.setQueryData(queryKey, { owner: "athlete-b" });
    first.dispose();
    expect(requestSignal?.aborted).toBe(true);
    resolve({ owner: "athlete-a" });
    await expect(settled).resolves.toBe("cancelled");
    expect(first.queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(next.queryClient.getQueryData(queryKey)).toEqual({ owner: "athlete-b" });
    next.dispose();
  });
});

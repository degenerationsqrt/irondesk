import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));
vi.mock("../src/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));

import { commitImport, type CommitInput } from "../src/lib/imports/repo";

const input: CommitInput = {
  sourceType: "generic_file",
  fileName: "metrics.csv",
  fileFormat: "csv",
  fileSizeBytes: 100,
  records: Array.from({ length: 501 }, (_, i) => ({
    kind: "metric" as const,
    externalId: `metric-${i}`,
    metricType: "steps" as const,
    recordedAt: "2026-09-01T12:00:00Z",
    sourceTimezone: "UTC",
    value: 1000,
    unit: "count",
    notes: null,
    raw: {},
  })),
  issues: [],
};

function database(
  options: {
    failChunk?: number;
    failFinish?: boolean;
    failAudit?: boolean;
    duplicateCount?: number;
  } = {},
) {
  const updates: Record<string, unknown>[] = [];
  let chunk = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table === "health_metrics") {
      return {
        upsert: (rows: unknown[], config: unknown) => {
          expect(config).toEqual({ onConflict: "user_id,dedupe_hash", ignoreDuplicates: true });
          chunk++;
          return {
            select: async () =>
              options.failChunk === chunk
                ? { data: null, error: { message: "write failed" } }
                : {
                    data: rows
                      .slice(options.duplicateCount ?? 0)
                      .map((_, i) => ({ id: `row-${i}` })),
                    error: null,
                  },
          };
        },
      };
    }
    expect(table).toBe("import_jobs");
    return {
      insert: () => ({
        select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
      }),
      update: (value: Record<string, unknown>) => {
        updates.push(value);
        return {
          eq: (column: string, id: string) => {
            expect([column, id]).toEqual(["id", "job-1"]);
            const result = {
              data: { id, ...value },
              error: options.failAudit ? { message: "audit failure" } : null,
            };
            return {
              then: (resolve: (result: unknown) => unknown) =>
                Promise.resolve(result).then(resolve),
              select: () => ({
                single: async () =>
                  options.failFinish ? { data: null, error: { message: "finish failed" } } : result,
              }),
            };
          },
        };
      },
    };
  });
  return updates;
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "athlete-1" } }, error: null });
});

describe("file import failure accounting", () => {
  it("retains acknowledged counts when a later chunk fails and explains rollback", async () => {
    const updates = database({ failChunk: 2, duplicateCount: 2 });
    await expect(commitImport(input)).rejects.toThrow("498 records were saved before the failure");
    expect(updates.at(-1)).toMatchObject({
      status: "partial",
      imported_count: 498,
      duplicate_count: 2,
    });
    expect(updates.at(-1)?.error_message).toContain("roll it back");
  });

  it("does not invent duplicate or successful counts for a failed first chunk", async () => {
    const updates = database({ failChunk: 1 });
    await expect(commitImport(input)).rejects.toThrow("No records were confirmed saved");
    expect(updates.at(-1)).toMatchObject({
      status: "failed",
      imported_count: 0,
      duplicate_count: 0,
    });
  });

  it("retains all confirmed writes if only final bookkeeping fails", async () => {
    const updates = database({ failFinish: true });
    await expect(commitImport(input)).rejects.toThrow("501 records were saved");
    expect(updates.at(-1)).toMatchObject({
      status: "partial",
      imported_count: 501,
      duplicate_count: 0,
    });
  });

  it("reports when the failure itself cannot be recorded without masking saved rows", async () => {
    database({ failChunk: 2, failAudit: true });
    await expect(commitImport(input)).rejects.toThrow(
      "500 records were saved before the failure. Review this batch in Connections; you can roll it back. The batch status could not be updated.",
    );
  });

  it("keeps an explicitly partial parse partial after its valid rows are written", async () => {
    database();
    const result = await commitImport({
      ...input,
      issues: [{ severity: "error", message: "Row 502 had an invalid date", row: 502 }],
    });
    expect(result).toMatchObject({ status: "partial", importedCount: 501, duplicateCount: 0 });
  });

  it("reports completed only after all valid rows and job metadata are confirmed", async () => {
    database();
    await expect(commitImport(input)).resolves.toMatchObject({
      status: "completed",
      importedCount: 501,
      duplicateCount: 0,
    });
  });
});

import { describe, expect, it } from "vitest";

import { asPostgrestIronDeskError, databaseDiagnosticReference } from "../src/lib/irondesk/errors";

describe("structured PostgREST diagnostics", () => {
  it("retains safe structured fields and exposes only a stable UI reference", () => {
    const error = asPostgrestIronDeskError(
      {
        code: "42501",
        message: "permission denied for table workout_templates",
        details: "RLS rejected the owner-scoped delete",
        hint: "Check the authenticated user and active project",
      },
      "Workout Template Delete",
      "That personal workout could not be deleted.",
    );

    expect(error.message).toBe(
      "That personal workout could not be deleted. Reference: workout-template-delete/42501.",
    );
    expect(error.message).not.toContain("permission denied");
    expect(error.diagnostic).toEqual({
      operation: "workout-template-delete",
      code: "42501",
      details: "RLS rejected the owner-scoped delete",
      hint: "Check the authenticated user and active project",
    });
    expect(databaseDiagnosticReference(error.diagnostic!)).toBe("workout-template-delete/42501");
  });

  it("bounds and sanitizes diagnostic material", () => {
    const error = asPostgrestIronDeskError(
      {
        code: "bad code / with spaces",
        details: "x".repeat(700),
        hint: " ",
      },
      "  Workout/Templates DELETE !! ",
      "Delete failed.",
    );

    expect(error.message).toBe(
      "Delete failed. Reference: workout-templates-delete/badcodewithspaces.",
    );
    expect(error.diagnostic?.details).toHaveLength(500);
    expect(error.diagnostic?.hint).toBeNull();
  });
});

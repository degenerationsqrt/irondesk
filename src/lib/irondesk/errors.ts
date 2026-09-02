export type IronDeskErrorCode =
  "unauthenticated" | "not_found" | "validation" | "database" | "conflict";

export interface DatabaseDiagnostic {
  /** Stable client operation label; never includes a user id or access token. */
  operation: string;
  /** PostgREST/Postgres code such as 42501 or 23503 when supplied. */
  code: string | null;
  /** Structured fields retained for controlled diagnostics, not appended to UI copy. */
  details: string | null;
  hint: string | null;
}

/** Predictable typed error surface for the data layer. */
export class IronDeskError extends Error {
  readonly code: IronDeskErrorCode;
  readonly diagnostic: DatabaseDiagnostic | undefined;

  constructor(
    message: string,
    code: IronDeskErrorCode = "database",
    diagnostic?: DatabaseDiagnostic,
  ) {
    super(message);
    this.name = "IronDeskError";
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function boundedText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function safeOperation(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "database-operation"
  );
}

export function databaseDiagnosticReference(diagnostic: DatabaseDiagnostic): string {
  const safeCode = diagnostic.code?.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
  return `${diagnostic.operation}/${safeCode || "unknown"}`;
}

/**
 * Preserves PostgREST's code/details/hint instead of flattening it to Error.message.
 * Only the stable operation/code reference is added to user-visible copy.
 */
export function asPostgrestIronDeskError(
  error: unknown,
  operation: string,
  publicMessage = "Something went wrong talking to the database.",
): IronDeskError {
  if (error instanceof IronDeskError) return error;
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const diagnostic: DatabaseDiagnostic = {
    operation: safeOperation(operation),
    code: boundedText(record["code"], 40),
    // postgrest-js reports browser fetch failures as an error-shaped response
    // whose database code is blank. Its stack normally lives in `details`, but
    // some runtimes provide only `message`; retain that fallback so the outbox
    // can distinguish an explicit connectivity failure from an arbitrary
    // code-less database error without exposing either value in UI copy.
    details: boundedText(record["details"]) ?? boundedText(record["message"]),
    hint: boundedText(record["hint"]),
  };
  return new IronDeskError(
    `${publicMessage} Reference: ${databaseDiagnosticReference(diagnostic)}.`,
    "database",
    diagnostic,
  );
}

export function asIronDeskError(
  error: unknown,
  fallback = "Something went wrong talking to the database.",
): IronDeskError {
  if (error instanceof IronDeskError) return error;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return new IronDeskError(message);
}

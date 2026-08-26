export type IronDeskErrorCode = "unauthenticated" | "not_found" | "validation" | "database" | "conflict";

/** Predictable typed error surface for the data layer. */
export class IronDeskError extends Error {
  readonly code: IronDeskErrorCode;

  constructor(message: string, code: IronDeskErrorCode = "database") {
    super(message);
    this.name = "IronDeskError";
    this.code = code;
  }
}

export function asIronDeskError(error: unknown, fallback = "Something went wrong talking to the database."): IronDeskError {
  if (error instanceof IronDeskError) return error;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  return new IronDeskError(message);
}

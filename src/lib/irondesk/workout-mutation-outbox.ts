import { IronDeskError } from "./errors";
import type { MethodConfig, MethodSegmentConfig } from "./method-composition";
import type { BlackWorkoutApplicationInput } from "./repo";
import { firstWorkoutSetValueIssue } from "./workout-values";

const LEGACY_STORAGE_KEY = "irondesk.workout-mutation-outbox.v1";
const STORAGE_KEY = "irondesk.workout-mutation-outbox.v2";
const STORAGE_VERSION = 2;
const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_APPLIED_TERMINAL_RECEIPTS_PER_USER = 20;

export interface SetMutationPatch {
  weightKg?: number | null;
  reps?: number | null;
  rpe?: number | null;
  completed?: boolean;
  completedAt?: string | null;
  isWarmup?: boolean;
  restSeconds?: number | null;
  notes?: string | null;
  methodSegment?: string | null;
  methodSegmentConfig?: MethodSegmentConfig | null;
}

export interface SessionMetaMutationPatch {
  title?: string;
  focus?: string | null;
  notes?: string | null;
  perceivedEffort?: number | null;
}

export interface SetAddMutationInput {
  weightKg?: number;
  reps?: number;
  rpe?: number | null;
  isWarmup?: boolean;
  restSeconds?: number | null;
  methodSegment?: string | null;
  methodSegmentConfig?: MethodSegmentConfig | null;
}

export type WorkoutMutation =
  | {
      kind: "set.add";
      recordId: string;
      sessionExerciseId: string;
      setNumber: number;
      input: SetAddMutationInput;
    }
  | { kind: "set.update"; setId: string; patch: SetMutationPatch }
  | { kind: "set.delete"; setId: string }
  | {
      kind: "exercise.add";
      recordId: string;
      sessionId: string;
      position: number;
      input: {
        exerciseId?: string | null;
        name: string;
        muscle?: string | null;
        equipment?: string | null;
        targetSets?: number | null;
        targetReps?: string | null;
      };
    }
  | { kind: "exercise.delete"; sessionExerciseId: string }
  | {
      kind: "exercise.substitute";
      sessionExerciseId: string;
      replacement: {
        exerciseId: string;
        name: string;
        muscle?: string | null;
        equipment?: string | null;
      };
    }
  | {
      kind: "exercise.method";
      sessionExerciseId: string;
      methodId: string | null;
      config?: MethodConfig;
    }
  | { kind: "session.meta"; sessionId: string; patch: SessionMetaMutationPatch }
  | {
      kind: "session.finish";
      sessionId: string;
      completedAt: string;
      /** Explicitly recover an already-cancelled session after user confirmation. */
      recoverCancelled?: boolean;
    }
  | { kind: "session.cancel"; sessionId: string; completedAt: string }
  | { kind: "black.apply"; input: BlackWorkoutApplicationInput };

export type WorkoutMutationState = "pending" | "blocked";
export type WorkoutMutationReceiptStatus = "queued" | "in_flight" | "applied" | "blocked";
export type WorkoutCompletionState =
  | "training"
  | "completed_locally_sync_pending"
  | "syncing"
  | "needs_attention"
  | "completed_on_server";
export type WorkoutTerminalCompletionState = Exclude<WorkoutCompletionState, "training">;

export interface WorkoutTerminalSummary {
  title: string;
  durationMin: number;
  sets: number;
  reps: number;
  tonnageKg: number;
  avgRpe: number | null;
}

export interface QueuedWorkoutMutation {
  id: string;
  revision: number;
  userId: string;
  /** Dependency lane. Operations remain FIFO inside one lane. */
  laneId: string;
  /** Null identifies a journal migrated from v1 or a caller that did not supply scope. */
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  state: WorkoutMutationState;
  lastError: string | null;
  /** Structured recovery metadata; older v2 entries may omit these fields. */
  issueCode?: WorkoutMutationIssueCode;
  issueField?: string | null;
  issueValue?: unknown;
  mutation: WorkoutMutation;
}

export interface WorkoutTerminalReceipt {
  itemId: string;
  userId: string;
  laneId: string;
  sessionId: string | null;
  kind: "session.finish" | "session.cancel";
  status: WorkoutMutationReceiptStatus;
  completionState: WorkoutTerminalCompletionState;
  /** Immutable finish/cancel time requested by the device. */
  requestedAt: string;
  /** Structured reason synchronization stopped, if one is known. */
  conflictState: WorkoutMutationIssueCode | null;
  /** True only after the athlete explicitly authorizes cancelled-session recovery. */
  recoveryAuthorized: boolean;
  acceptedAt: string;
  updatedAt: string;
  lastError: string | null;
  summary: WorkoutTerminalSummary | null;
}

export interface WorkoutMutationIssue {
  itemId: string;
  userId: string;
  laneId: string;
  sessionId: string | null;
  kind: WorkoutMutation["kind"];
  targetId: string | null;
  code: WorkoutMutationIssueCode;
  field: string | null;
  invalidValue: unknown;
  message: string;
}

export type WorkoutMutationIssueCode =
  | "invalid_workout_value"
  | "server_validation"
  | "record_not_found"
  | "operation_conflict"
  | "session_identity_conflict"
  | "cancelled_session_requires_recovery"
  | "terminal_conflict"
  | "session_not_found"
  | "unauthenticated"
  | "save_failed";

function isWorkoutMutationIssueCode(value: unknown): value is WorkoutMutationIssueCode {
  return (
    value === "invalid_workout_value" ||
    value === "server_validation" ||
    value === "record_not_found" ||
    value === "operation_conflict" ||
    value === "session_identity_conflict" ||
    value === "cancelled_session_requires_recovery" ||
    value === "terminal_conflict" ||
    value === "session_not_found" ||
    value === "unauthenticated" ||
    value === "save_failed"
  );
}

export interface WorkoutMutationQueueSnapshot {
  durable: boolean;
  flushing: boolean;
  pendingCount: number;
  blockedCount: number;
  lastAppliedAt: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  items: readonly QueuedWorkoutMutation[];
  issues: readonly WorkoutMutationIssue[];
  terminalReceipts: readonly WorkoutTerminalReceipt[];
}

export type WorkoutMutationCommitStatus = "applied" | "queued" | "blocked";

export type WorkoutMutationCommitOutcome =
  "accepted_locally" | "applied" | "retrying" | "blocked" | "terminal_conflict";

export interface WorkoutMutationCommitResult {
  itemId: string;
  status: WorkoutMutationCommitStatus;
  outcome: WorkoutMutationCommitOutcome;
  /** Present on durable-outbox receipts; optional for legacy/demo adapters. */
  durable?: boolean;
  laneId?: string;
  sessionId?: string | null;
}

export interface WorkoutMutationEnqueueOptions {
  sessionId?: string | null;
  /** Wait for the current drain pass when server ordering must be acknowledged. */
  requireAcknowledgment?: boolean;
  /** Persisted only for finish/cancel receipts so reload recovery can render locally. */
  terminalSummary?: WorkoutTerminalSummary | null;
}

export interface WorkoutMutationStore {
  readonly durable: boolean;
  read(): QueuedWorkoutMutation[];
  write(items: readonly QueuedWorkoutMutation[]): void;
  readTerminalReceipts(): WorkoutTerminalReceipt[];
  writeTerminalReceipts(receipts: readonly WorkoutTerminalReceipt[]): void;
  writeState(
    items: readonly QueuedWorkoutMutation[],
    receipts: readonly WorkoutTerminalReceipt[],
  ): void;
}

export type WorkoutMutationExecutor = (
  mutation: WorkoutMutation,
  expectedUserId: string,
  signal: AbortSignal,
) => Promise<void>;

type LegacyQueuedWorkoutMutation = Omit<QueuedWorkoutMutation, "laneId" | "sessionId">;

interface StoredEnvelopeV1 {
  version: 1;
  items: LegacyQueuedWorkoutMutation[];
}

interface StoredEnvelopeV2 {
  version: 2;
  items: QueuedWorkoutMutation[];
  terminalReceipts: WorkoutTerminalReceipt[];
}

export interface WorkoutMutationQueueOptions {
  now?: () => Date;
  createId?: () => string;
  isOnline?: () => boolean;
  requestTimeoutMs?: number;
  preflightLane?: WorkoutMutationLanePreflight;
}

export interface WorkoutMutationLaneState {
  id: string;
  status: "draft" | "active" | "completed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
}

export type WorkoutMutationLanePreflight = (
  sessionId: string,
  expectedUserId: string,
  signal: AbortSignal,
) => Promise<WorkoutMutationLaneState | null>;

class WorkoutMutationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Workout save timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    this.name = "WorkoutMutationTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWorkoutMutation(value: unknown): value is WorkoutMutation {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  const hasString = (key: string) => typeof value[key] === "string";
  switch (value["kind"]) {
    case "set.add":
      return (
        hasString("recordId") &&
        hasString("sessionExerciseId") &&
        typeof value["setNumber"] === "number" &&
        isRecord(value["input"])
      );
    case "set.update":
      return hasString("setId") && isRecord(value["patch"]);
    case "set.delete":
      return hasString("setId");
    case "exercise.add":
      return (
        hasString("recordId") &&
        hasString("sessionId") &&
        typeof value["position"] === "number" &&
        isRecord(value["input"]) &&
        typeof value["input"]["name"] === "string"
      );
    case "exercise.delete":
      return hasString("sessionExerciseId");
    case "exercise.substitute":
      return (
        hasString("sessionExerciseId") &&
        isRecord(value["replacement"]) &&
        typeof value["replacement"]["exerciseId"] === "string" &&
        typeof value["replacement"]["name"] === "string"
      );
    case "exercise.method":
      return (
        hasString("sessionExerciseId") &&
        (typeof value["methodId"] === "string" || value["methodId"] === null)
      );
    case "session.meta":
      return hasString("sessionId") && isRecord(value["patch"]);
    case "session.finish":
    case "session.cancel":
      return hasString("sessionId") && hasString("completedAt");
    case "black.apply":
      return (
        isRecord(value["input"]) &&
        typeof value["input"]["applicationId"] === "string" &&
        typeof value["input"]["sessionId"] === "string" &&
        typeof value["input"]["windowId"] === "string" &&
        typeof value["input"]["targetRegion"] === "string" &&
        typeof value["input"]["weekStart"] === "string" &&
        Array.isArray(value["input"]["prescriptions"]) &&
        Array.isArray(value["input"]["targets"])
      );
    default:
      return false;
  }
}

function isLegacyQueuedWorkoutMutation(value: unknown): value is LegacyQueuedWorkoutMutation {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["revision"] === "number" &&
    typeof value["userId"] === "string" &&
    typeof value["createdAt"] === "string" &&
    typeof value["updatedAt"] === "string" &&
    typeof value["attempts"] === "number" &&
    (typeof value["nextAttemptAt"] === "string" || value["nextAttemptAt"] === null) &&
    (value["state"] === "pending" || value["state"] === "blocked") &&
    (typeof value["lastError"] === "string" || value["lastError"] === null) &&
    isWorkoutMutation(value["mutation"])
  );
}

function isQueuedWorkoutMutation(value: unknown): value is QueuedWorkoutMutation {
  if (!isRecord(value) || !isLegacyQueuedWorkoutMutation(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return (
    typeof record["laneId"] === "string" &&
    (typeof record["sessionId"] === "string" || record["sessionId"] === null)
  );
}

function isTerminalKind(value: unknown): value is WorkoutTerminalReceipt["kind"] {
  return value === "session.finish" || value === "session.cancel";
}

function isTerminalMutation(
  mutation: WorkoutMutation,
): mutation is Extract<WorkoutMutation, { kind: "session.finish" | "session.cancel" }> {
  return isTerminalKind(mutation.kind);
}

function isTerminalSummary(value: unknown): value is WorkoutTerminalSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value["title"] === "string" &&
    typeof value["durationMin"] === "number" &&
    typeof value["sets"] === "number" &&
    typeof value["reps"] === "number" &&
    typeof value["tonnageKg"] === "number" &&
    (typeof value["avgRpe"] === "number" || value["avgRpe"] === null)
  );
}

function isTerminalReceipt(value: unknown): value is WorkoutTerminalReceipt {
  if (!isRecord(value)) return false;
  return (
    typeof value["itemId"] === "string" &&
    typeof value["userId"] === "string" &&
    typeof value["laneId"] === "string" &&
    (typeof value["sessionId"] === "string" || value["sessionId"] === null) &&
    isTerminalKind(value["kind"]) &&
    (value["status"] === "queued" ||
      value["status"] === "in_flight" ||
      value["status"] === "applied" ||
      value["status"] === "blocked") &&
    (value["completionState"] === undefined ||
      value["completionState"] === "completed_locally_sync_pending" ||
      value["completionState"] === "syncing" ||
      value["completionState"] === "needs_attention" ||
      value["completionState"] === "completed_on_server") &&
    (value["requestedAt"] === undefined || typeof value["requestedAt"] === "string") &&
    (value["conflictState"] === undefined ||
      value["conflictState"] === null ||
      isWorkoutMutationIssueCode(value["conflictState"])) &&
    (value["recoveryAuthorized"] === undefined ||
      typeof value["recoveryAuthorized"] === "boolean") &&
    typeof value["acceptedAt"] === "string" &&
    typeof value["updatedAt"] === "string" &&
    (typeof value["lastError"] === "string" || value["lastError"] === null) &&
    (value["summary"] === null || isTerminalSummary(value["summary"]))
  );
}

function completionStateForStatus(
  status: WorkoutMutationReceiptStatus,
): WorkoutTerminalCompletionState {
  switch (status) {
    case "queued":
      return "completed_locally_sync_pending";
    case "in_flight":
      return "syncing";
    case "blocked":
      return "needs_attention";
    case "applied":
      return "completed_on_server";
  }
}

function sessionIdFromMutation(mutation: WorkoutMutation | null | undefined): string | null {
  if (!mutation) return null;
  if (mutation.kind === "black.apply") return mutation.input.sessionId;
  return "sessionId" in mutation && typeof mutation.sessionId === "string"
    ? mutation.sessionId
    : null;
}

/**
 * A few historical row mutations do not carry their session id. When a set is
 * a child of an unsent locally-created exercise we can recover that identity
 * without guessing. Everything else stays in the explicitly ambiguous legacy
 * lane rather than risking cross-workout reordering.
 */
function inferSessionIdFromJournal(
  items: readonly QueuedWorkoutMutation[],
  userId: string,
  mutation: WorkoutMutation,
): string | null {
  const direct = sessionIdFromMutation(mutation);
  if (direct) return direct;
  if (mutation.kind !== "set.add") return null;
  const parent = items.find(
    (item) =>
      item.userId === userId &&
      item.mutation.kind === "exercise.add" &&
      item.mutation.recordId === mutation.sessionExerciseId,
  );
  return parent?.sessionId ?? sessionIdFromMutation(parent?.mutation as WorkoutMutation);
}

function terminalReceiptForItem(item: QueuedWorkoutMutation): WorkoutTerminalReceipt | null {
  if (!isTerminalMutation(item.mutation)) return null;
  return {
    itemId: item.id,
    userId: item.userId,
    laneId: item.laneId,
    sessionId: item.sessionId ?? sessionIdFromMutation(item.mutation),
    kind: item.mutation.kind,
    status: item.state === "blocked" ? "blocked" : "queued",
    completionState:
      item.state === "blocked" ? "needs_attention" : "completed_locally_sync_pending",
    requestedAt: item.mutation.completedAt,
    conflictState: item.state === "blocked" ? (item.issueCode ?? "save_failed") : null,
    recoveryAuthorized:
      item.mutation.kind === "session.finish" && item.mutation.recoverCancelled === true,
    acceptedAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastError: item.lastError,
    summary: null,
  };
}

function migrateLegacyItems(items: readonly LegacyQueuedWorkoutMutation[]): StoredEnvelopeV2 {
  const exerciseSessions = new Map<string, string>();
  const setSessions = new Map<string, string>();
  const inferredSessions = items.map((item) => {
    const mutation = item.mutation;
    const scoped = (id: string) => `${item.userId}:${id}`;
    let sessionId = sessionIdFromMutation(mutation);
    if (!sessionId) {
      if (mutation.kind === "set.add") {
        sessionId = exerciseSessions.get(scoped(mutation.sessionExerciseId)) ?? null;
      } else if (mutation.kind === "set.update" || mutation.kind === "set.delete") {
        sessionId = setSessions.get(scoped(mutation.setId)) ?? null;
      } else if (
        mutation.kind === "exercise.delete" ||
        mutation.kind === "exercise.substitute" ||
        mutation.kind === "exercise.method"
      ) {
        sessionId = exerciseSessions.get(scoped(mutation.sessionExerciseId)) ?? null;
      }
    }
    if (sessionId && mutation.kind === "exercise.add") {
      exerciseSessions.set(scoped(mutation.recordId), sessionId);
    }
    if (sessionId && mutation.kind === "set.add") {
      setSessions.set(scoped(mutation.recordId), sessionId);
    }
    return sessionId;
  });
  const migrated: QueuedWorkoutMutation[] = items.map((item, index) => ({
    ...item,
    laneId: `legacy:${item.userId}`,
    sessionId: inferredSessions[index] ?? null,
  }));

  const blockIdentityConflict = (indexes: readonly number[], laneId: string, message: string) => {
    const conflictIndex = indexes.find((index) => migrated[index]?.state !== "blocked");
    if (conflictIndex === undefined) return;
    const conflict = migrated[conflictIndex]!;
    migrated[conflictIndex] = {
      ...conflict,
      state: "blocked",
      nextAttemptAt: null,
      lastError: conflict.lastError ?? message,
      issueCode: "session_identity_conflict",
      issueField: "sessionId",
      issueValue: conflict.sessionId,
      laneId,
    };
  };

  // v1 was one FIFO per user and most row mutations did not carry a session
  // identifier. A terminal entry is the first trustworthy boundary: assign
  // every item since that user's previous terminal to the terminal session,
  // without changing journal order, ids, revisions, or timestamps. Any
  // ambiguous trailing segment deliberately remains in the legacy lane.
  const openSegmentIndexesByUser = new Map<string, number[]>();
  for (let index = 0; index < migrated.length; index += 1) {
    const item = migrated[index]!;
    const segment = openSegmentIndexesByUser.get(item.userId) ?? [];
    segment.push(index);
    openSegmentIndexesByUser.set(item.userId, segment);
    if (!isTerminalKind(item.mutation.kind)) continue;
    const terminalSessionId = sessionIdFromMutation(item.mutation);
    if (!terminalSessionId) continue;
    const conflictingSession = segment
      .map((segmentIndex) => migrated[segmentIndex]?.sessionId ?? null)
      .find((sessionId) => sessionId !== null && sessionId !== terminalSessionId);
    const segmentLaneId = conflictingSession
      ? `legacy-conflict:${item.id}`
      : laneIdFor(item.userId, terminalSessionId);
    for (const segmentIndex of segment) {
      const segmentItem = migrated[segmentIndex]!;
      migrated[segmentIndex] = {
        ...segmentItem,
        laneId: segmentLaneId,
        sessionId: conflictingSession ? segmentItem.sessionId : terminalSessionId,
      };
    }
    if (conflictingSession) {
      blockIdentityConflict(
        segment,
        segmentLaneId,
        "This legacy queue contains conflicting workout identities and will not replay automatically.",
      );
    }
    openSegmentIndexesByUser.set(item.userId, []);
  }

  // A trailing v1 segment has no terminal boundary. Recover it only when its
  // known parent/direct identities consistently point to one session.
  for (const [userId, segment] of openSegmentIndexesByUser) {
    if (!segment.length) continue;
    const knownSessions = new Set(
      segment
        .map((index) => migrated[index]?.sessionId ?? null)
        .filter((sessionId): sessionId is string => sessionId !== null),
    );
    if (knownSessions.size === 1) {
      const [sessionId] = knownSessions;
      for (const segmentIndex of segment) {
        const segmentItem = migrated[segmentIndex]!;
        migrated[segmentIndex] = {
          ...segmentItem,
          laneId: laneIdFor(userId, sessionId!),
          sessionId: sessionId!,
        };
      }
    } else if (knownSessions.size > 1) {
      const laneId = `legacy-conflict:${migrated[segment[0]!]!.id}`;
      for (const segmentIndex of segment) {
        migrated[segmentIndex] = { ...migrated[segmentIndex]!, laneId };
      }
      blockIdentityConflict(
        segment,
        laneId,
        "This legacy queue mixes multiple unfinished workouts and will not replay automatically.",
      );
    }
  }

  // Validate every migrated row before replay begins. A blocked value anywhere
  // in a lane pauses the entire lane, so a late legacy RPE cannot allow the
  // preceding 156 writes to reach the server first.
  for (let index = 0; index < migrated.length; index += 1) {
    const item = migrated[index]!;
    const invalid = invalidFieldForMutation(item.mutation);
    if (!invalid.validationMessage) continue;
    migrated[index] = {
      ...item,
      state: "blocked",
      nextAttemptAt: null,
      lastError: item.lastError ?? invalid.validationMessage,
      issueCode: "invalid_workout_value",
      issueField: invalid.field,
      issueValue: invalid.invalidValue,
    };
  }

  const blockedLanes = new Set(
    migrated.filter((item) => item.state === "blocked").map((item) => item.laneId),
  );
  return {
    version: STORAGE_VERSION,
    items: migrated,
    terminalReceipts: migrated
      .map(terminalReceiptForItem)
      .filter((receipt): receipt is WorkoutTerminalReceipt => receipt !== null)
      .map((receipt) =>
        blockedLanes.has(receipt.laneId)
          ? (() => {
              const blockingItem = migrated.find(
                (item) => item.laneId === receipt.laneId && item.state === "blocked",
              );
              return {
                ...receipt,
                status: "blocked" as const,
                completionState: "needs_attention" as const,
                conflictState: blockingItem?.issueCode ?? "save_failed",
                lastError: blockingItem?.lastError ?? receipt.lastError,
              };
            })()
          : receipt,
      ),
  };
}

function parseV1Envelope(raw: string | null): StoredEnvelopeV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed["version"] !== 1 || !Array.isArray(parsed["items"]))
      return null;
    const envelope = parsed as unknown as StoredEnvelopeV1;
    if (!envelope.items.every(isLegacyQueuedWorkoutMutation)) return null;
    return migrateLegacyItems(envelope.items);
  } catch {
    return null;
  }
}

function parseV2Envelope(raw: string | null): StoredEnvelopeV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed["version"] !== STORAGE_VERSION ||
      !Array.isArray(parsed["items"])
    )
      return null;
    if (!parsed["items"].every(isQueuedWorkoutMutation)) return null;
    const items = parsed["items"];
    const rawReceipts = parsed["terminalReceipts"];
    if (rawReceipts !== undefined && !Array.isArray(rawReceipts)) return null;
    if (Array.isArray(rawReceipts) && !rawReceipts.every(isTerminalReceipt)) return null;
    const parsedReceipts = Array.isArray(rawReceipts) ? rawReceipts : [];
    const itemIds = new Set(items.map((item) => item.id));
    const itemById = new Map(items.map((item) => [item.id, item] as const));
    const receipts: WorkoutTerminalReceipt[] = parsedReceipts.map((receipt) => {
      const status: WorkoutMutationReceiptStatus =
        receipt.status === "in_flight"
          ? itemIds.has(receipt.itemId)
            ? "queued"
            : "blocked"
          : receipt.status;
      const terminalItem = itemById.get(receipt.itemId);
      const terminalMutation =
        terminalItem && isTerminalMutation(terminalItem.mutation) ? terminalItem.mutation : null;
      return {
        ...receipt,
        status,
        completionState: completionStateForStatus(status),
        requestedAt: receipt.requestedAt ?? terminalMutation?.completedAt ?? receipt.acceptedAt,
        conflictState:
          status === "blocked"
            ? (receipt.conflictState ?? terminalItem?.issueCode ?? "save_failed")
            : null,
        recoveryAuthorized:
          receipt.recoveryAuthorized ??
          (terminalMutation?.kind === "session.finish" &&
            terminalMutation.recoverCancelled === true),
        lastError:
          receipt.status === "in_flight" && !terminalItem
            ? "IronDesk restarted before it could confirm this workout reached the server. The local summary is preserved, but synchronization needs attention."
            : receipt.lastError,
      };
    });
    const receiptIds = new Set(receipts.map((receipt) => receipt.itemId));
    for (const item of items) {
      const receipt = terminalReceiptForItem(item);
      if (receipt && !receiptIds.has(receipt.itemId)) receipts.push(receipt);
    }
    return {
      version: STORAGE_VERSION,
      items,
      terminalReceipts: receipts,
    };
  } catch {
    return null;
  }
}

function emptyEnvelope(): StoredEnvelopeV2 {
  return { version: STORAGE_VERSION, items: [], terminalReceipts: [] };
}

export class BrowserWorkoutMutationStore implements WorkoutMutationStore {
  private fallback = emptyEnvelope();

  constructor(private storage: Storage | null) {}

  get durable(): boolean {
    return this.storage !== null;
  }

  private readEnvelope(): StoredEnvelopeV2 {
    if (!this.storage) return structuredClone(this.fallback);
    try {
      const rawV2 = this.storage.getItem(STORAGE_KEY);
      const current = parseV2Envelope(rawV2);
      if (current) {
        this.fallback = structuredClone(current);
        return current;
      }
      // Never overwrite an unreadable recovery journal. Fall back to memory and
      // report storage as non-durable while leaving the original bytes intact.
      if (rawV2 !== null) {
        this.storage = null;
        return structuredClone(this.fallback);
      }
      const rawV1 = this.storage.getItem(LEGACY_STORAGE_KEY);
      const migrated = parseV1Envelope(rawV1);
      if (rawV1 !== null && !migrated) {
        this.storage = null;
        return structuredClone(this.fallback);
      }
      if (!migrated) return emptyEnvelope();
      this.fallback = structuredClone(migrated);
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        this.storage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        this.storage = null;
      }
      return migrated;
    } catch {
      this.storage = null;
      return structuredClone(this.fallback);
    }
  }

  private writeEnvelope(envelope: StoredEnvelopeV2): void {
    const copy = structuredClone(envelope);
    this.fallback = copy;
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(copy));
      this.storage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      this.storage = null;
    }
  }

  read(): QueuedWorkoutMutation[] {
    return structuredClone(this.readEnvelope().items);
  }

  write(items: readonly QueuedWorkoutMutation[]): void {
    const envelope = this.readEnvelope();
    envelope.items = structuredClone([...items]);
    this.writeEnvelope(envelope);
  }

  readTerminalReceipts(): WorkoutTerminalReceipt[] {
    return structuredClone(this.readEnvelope().terminalReceipts);
  }

  writeTerminalReceipts(receipts: readonly WorkoutTerminalReceipt[]): void {
    const envelope = this.readEnvelope();
    envelope.terminalReceipts = structuredClone([...receipts]);
    this.writeEnvelope(envelope);
  }

  writeState(
    items: readonly QueuedWorkoutMutation[],
    receipts: readonly WorkoutTerminalReceipt[],
  ): void {
    this.writeEnvelope({
      version: STORAGE_VERSION,
      items: structuredClone([...items]),
      terminalReceipts: structuredClone([...receipts]),
    });
  }
}

export class MemoryWorkoutMutationStore implements WorkoutMutationStore {
  readonly durable = false;
  private items: QueuedWorkoutMutation[];
  private terminalReceipts: WorkoutTerminalReceipt[];

  constructor(
    initial: readonly QueuedWorkoutMutation[] = [],
    terminalReceipts: readonly WorkoutTerminalReceipt[] = [],
  ) {
    this.items = structuredClone([...initial]);
    this.terminalReceipts = structuredClone([...terminalReceipts]);
  }

  read(): QueuedWorkoutMutation[] {
    return structuredClone(this.items);
  }

  write(items: readonly QueuedWorkoutMutation[]): void {
    this.items = structuredClone([...items]);
  }

  readTerminalReceipts(): WorkoutTerminalReceipt[] {
    return structuredClone(this.terminalReceipts);
  }

  writeTerminalReceipts(receipts: readonly WorkoutTerminalReceipt[]): void {
    this.terminalReceipts = structuredClone([...receipts]);
  }

  writeState(
    items: readonly QueuedWorkoutMutation[],
    receipts: readonly WorkoutTerminalReceipt[],
  ): void {
    this.items = structuredClone([...items]);
    this.terminalReceipts = structuredClone([...receipts]);
  }
}

export function createBrowserWorkoutMutationStore(): WorkoutMutationStore {
  if (typeof window === "undefined") return new MemoryWorkoutMutationStore();
  try {
    const probe = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return new BrowserWorkoutMutationStore(window.localStorage);
  } catch {
    return new BrowserWorkoutMutationStore(null);
  }
}

export function createClientWorkoutRecordId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function coalesceKey(mutation: WorkoutMutation): string | null {
  switch (mutation.kind) {
    case "set.update":
      return `set.update:${mutation.setId}`;
    case "exercise.substitute":
      return `exercise.substitute:${mutation.sessionExerciseId}`;
    case "exercise.method":
      return `exercise.method:${mutation.sessionExerciseId}`;
    case "session.meta":
      return `session.meta:${mutation.sessionId}`;
    case "session.finish":
      return `session.finish:${mutation.sessionId}`;
    case "session.cancel":
      return `session.cancel:${mutation.sessionId}`;
    case "black.apply":
      return `black.apply:${mutation.input.applicationId}`;
    default:
      return null;
  }
}

function mergeMutation(previous: WorkoutMutation, next: WorkoutMutation): WorkoutMutation {
  if (previous.kind === "set.update" && next.kind === "set.update") {
    return { ...next, patch: { ...previous.patch, ...next.patch } };
  }
  if (previous.kind === "session.meta" && next.kind === "session.meta") {
    return { ...next, patch: { ...previous.patch, ...next.patch } };
  }
  if (previous.kind === "session.finish" && next.kind === "session.finish") return previous;
  if (previous.kind === "session.cancel" && next.kind === "session.cancel") return previous;
  if (previous.kind === "black.apply" && next.kind === "black.apply") return previous;
  return next;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof IronDeskError) return error.message.slice(0, 240);
  if (error instanceof Error) return error.message.slice(0, 240);
  return "IronDesk could not save that change.";
}

function diagnosticCode(error: IronDeskError): string {
  return error.diagnostic?.code?.trim().toUpperCase() ?? "";
}

const RETRYABLE_CONNECTIVITY_MESSAGE =
  /failed to fetch|network(?:error| request)?|load failed|offline|timed? ?out|connection (?:lost|reset|refused)|fetch failed/i;

function hasExplicitConnectivityMessage(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => value != null && RETRYABLE_CONNECTIVITY_MESSAGE.test(value));
}

/** Only connectivity/availability failures are automatically replayed. */
export function isRetryableWorkoutMutationError(error: unknown): boolean {
  if (error instanceof WorkoutMutationTimeoutError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof IronDeskError) {
    if (error.code !== "database") return false;
    const code = diagnosticCode(error);
    if (!code) {
      return hasExplicitConnectivityMessage(error.diagnostic?.details, error.diagnostic?.hint);
    }
    return (
      code.startsWith("08") ||
      code === "40001" ||
      code === "40P01" ||
      code === "53300" ||
      code === "55P03" ||
      code === "57014" ||
      code === "57P01" ||
      code === "PGRST000" ||
      code === "PGRST001" ||
      code === "PGRST002" ||
      code === "PGRST003"
    );
  }
  return hasExplicitConnectivityMessage(safeErrorMessage(error));
}

function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

function sortItems(items: QueuedWorkoutMutation[]): QueuedWorkoutMutation[] {
  // The persisted array is the FIFO journal. Do not use millisecond timestamps
  // as the ordering boundary: add + edit can be enqueued in the same tick.
  return [...items];
}

function laneIdFor(userId: string, sessionId: string | null): string {
  return sessionId ? `session:${sessionId}` : `legacy:${userId}`;
}

function targetIdForMutation(mutation: WorkoutMutation): string | null {
  switch (mutation.kind) {
    case "set.add":
      return mutation.recordId;
    case "set.update":
    case "set.delete":
      return mutation.setId;
    case "exercise.add":
      return mutation.recordId;
    case "exercise.delete":
    case "exercise.substitute":
    case "exercise.method":
      return mutation.sessionExerciseId;
    case "session.meta":
    case "session.finish":
    case "session.cancel":
      return mutation.sessionId;
    case "black.apply":
      return mutation.input.applicationId;
  }
}

function invalidFieldForMutation(
  mutation: WorkoutMutation,
): Pick<WorkoutMutationIssue, "field" | "invalidValue"> & { validationMessage: string | null } {
  if (mutation.kind === "set.update" || mutation.kind === "set.add") {
    const values = mutation.kind === "set.update" ? mutation.patch : mutation.input;
    const valueIssue = firstWorkoutSetValueIssue(values);
    if (valueIssue)
      return {
        field: valueIssue.field,
        invalidValue: valueIssue.value,
        validationMessage: valueIssue.message,
      };
  }
  if (
    mutation.kind === "session.meta" &&
    mutation.patch.perceivedEffort !== undefined &&
    mutation.patch.perceivedEffort !== null
  ) {
    const effortIssue = firstWorkoutSetValueIssue({ rpe: mutation.patch.perceivedEffort });
    if (effortIssue)
      return {
        field: "perceivedEffort",
        invalidValue: effortIssue.value,
        validationMessage: effortIssue.message,
      };
  }
  return { field: null, invalidValue: null, validationMessage: null };
}

function issueForItem(item: QueuedWorkoutMutation): WorkoutMutationIssue {
  const invalid = invalidFieldForMutation(item.mutation);
  const hasInvalidValue = invalid.validationMessage !== null;
  return {
    itemId: item.id,
    userId: item.userId,
    laneId: item.laneId,
    sessionId: item.sessionId,
    kind: item.mutation.kind,
    targetId: targetIdForMutation(item.mutation),
    code: hasInvalidValue ? "invalid_workout_value" : (item.issueCode ?? "save_failed"),
    field: hasInvalidValue ? invalid.field : (item.issueField ?? null),
    invalidValue: hasInvalidValue ? invalid.invalidValue : (item.issueValue ?? null),
    message:
      invalid.validationMessage ?? item.lastError ?? "This queued workout change needs attention.",
  };
}

function issueCodeForExecutionFailure(
  error: unknown,
  mutation: WorkoutMutation,
  invalidValue: ReturnType<typeof invalidFieldForMutation>,
): WorkoutMutationIssueCode {
  if (invalidValue.validationMessage) return "invalid_workout_value";
  if (!(error instanceof IronDeskError)) return "save_failed";
  if (error.code === "unauthenticated") return "unauthenticated";
  if (error.code === "validation") return "server_validation";
  if (error.code === "not_found") {
    return isTerminalKind(mutation.kind) ? "session_not_found" : "record_not_found";
  }
  if (error.code !== "conflict") return "save_failed";
  if (!isTerminalKind(mutation.kind)) return "operation_conflict";
  const actualStatus = (error as IronDeskError & { actualStatus?: unknown }).actualStatus;
  if (mutation.kind === "session.finish" && actualStatus === "cancelled") {
    return "cancelled_session_requires_recovery";
  }
  return "terminal_conflict";
}

function equalRecordExcept(left: object, right: object, field: string): boolean {
  const leftCopy = { ...(left as Record<string, unknown>) };
  const rightCopy = { ...(right as Record<string, unknown>) };
  delete leftCopy[field];
  delete rightCopy[field];
  return JSON.stringify(leftCopy) === JSON.stringify(rightCopy);
}

function isAllowedBlockedCorrection(
  previous: QueuedWorkoutMutation,
  replacement: WorkoutMutation,
): boolean {
  if (previous.issueCode === "invalid_workout_value" && previous.issueField) {
    const field = previous.issueField;
    if (previous.mutation.kind === "set.update" && replacement.kind === "set.update") {
      return (
        previous.mutation.setId === replacement.setId &&
        equalRecordExcept(previous.mutation.patch, replacement.patch, field)
      );
    }
    if (previous.mutation.kind === "set.add" && replacement.kind === "set.add") {
      return (
        previous.mutation.recordId === replacement.recordId &&
        previous.mutation.sessionExerciseId === replacement.sessionExerciseId &&
        previous.mutation.setNumber === replacement.setNumber &&
        equalRecordExcept(previous.mutation.input, replacement.input, field)
      );
    }
    if (previous.mutation.kind === "session.meta" && replacement.kind === "session.meta") {
      return (
        previous.mutation.sessionId === replacement.sessionId &&
        equalRecordExcept(previous.mutation.patch, replacement.patch, field)
      );
    }
    return false;
  }

  if (
    previous.issueCode === "cancelled_session_requires_recovery" &&
    previous.mutation.kind === "session.finish" &&
    replacement.kind === "session.finish"
  ) {
    return (
      previous.mutation.sessionId === replacement.sessionId &&
      previous.mutation.completedAt === replacement.completedAt &&
      replacement.recoverCancelled === true
    );
  }

  if (
    previous.issueCode === "terminal_conflict" &&
    previous.mutation.kind === "session.cancel" &&
    replacement.kind === "session.finish"
  ) {
    return (
      previous.mutation.sessionId === replacement.sessionId &&
      previous.mutation.completedAt === replacement.completedAt
    );
  }

  return false;
}

function mergeSetUpdateIntoUnsentAdd(
  add: Extract<WorkoutMutation, { kind: "set.add" }>,
  update: Extract<WorkoutMutation, { kind: "set.update" }>,
): { add: Extract<WorkoutMutation, { kind: "set.add" }>; remainder: SetMutationPatch } {
  const input = { ...add.input };
  const remainder: SetMutationPatch = {};
  for (const [key, value] of Object.entries(update.patch) as [
    keyof SetMutationPatch,
    SetMutationPatch[keyof SetMutationPatch],
  ][]) {
    if (key === "weightKg" || key === "reps" || key === "rpe") {
      if (value === null && key !== "rpe") Object.assign(remainder, { [key]: value });
      else if (value !== undefined) Object.assign(input, { [key]: value });
    } else if (
      key === "isWarmup" ||
      key === "restSeconds" ||
      key === "methodSegment" ||
      key === "methodSegmentConfig"
    ) {
      if (value !== undefined) Object.assign(input, { [key]: value });
    } else if (value !== undefined) {
      Object.assign(remainder, { [key]: value });
    }
  }
  return { add: { ...add, input }, remainder };
}

function pruneTerminalReceipts(
  receipts: readonly WorkoutTerminalReceipt[],
): WorkoutTerminalReceipt[] {
  const keptIds = new Set<string>();
  const appliedByUser = new Map<string, number>();
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index]!;
    if (receipt.status !== "applied") {
      keptIds.add(receipt.itemId);
      continue;
    }
    const count = appliedByUser.get(receipt.userId) ?? 0;
    if (count < MAX_APPLIED_TERMINAL_RECEIPTS_PER_USER) {
      keptIds.add(receipt.itemId);
      appliedByUser.set(receipt.userId, count + 1);
    }
  }
  return receipts.filter((receipt) => keptIds.has(receipt.itemId));
}

export class WorkoutMutationOutbox {
  private flushing = false;
  private activeFlush: Promise<void> | null = null;
  private activeFlushUserId: string | null = null;
  private inFlightItemId: string | null = null;
  private lastAppliedAt: string | null = null;
  private listeners = new Set<() => void>();
  private readonly outcomes = new Map<string, WorkoutMutationCommitStatus>();
  private readonly lastLaneByUser = new Map<string, string>();

  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly isOnline: () => boolean;
  private readonly requestTimeoutMs: number;
  private readonly preflightLane: WorkoutMutationLanePreflight | undefined;

  constructor(
    private readonly store: WorkoutMutationStore,
    private readonly execute: WorkoutMutationExecutor,
    options: WorkoutMutationQueueOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createClientWorkoutRecordId;
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.preflightLane = options.preflightLane;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private userItems(userId: string): QueuedWorkoutMutation[] {
    return sortItems(this.store.read().filter((item) => item.userId === userId));
  }

  private laneHeads(
    userId: string,
    items: readonly QueuedWorkoutMutation[] = this.userItems(userId),
  ): QueuedWorkoutMutation[] {
    const seen = new Set<string>();
    const heads: QueuedWorkoutMutation[] = [];
    for (const item of items) {
      if (item.userId !== userId || seen.has(item.laneId)) continue;
      seen.add(item.laneId);
      heads.push(item);
    }
    return heads;
  }

  private nextReadyItem(
    userId: string,
    force: boolean,
    pausedLanes: ReadonlySet<string> = new Set(),
  ): QueuedWorkoutMutation | null {
    const now = this.now().getTime();
    const items = this.userItems(userId);
    const heads = this.laneHeads(userId, items);
    if (!heads.length) return null;
    const blockedLanes = new Set(
      items.filter((item) => item.state === "blocked").map((item) => item.laneId),
    );
    const lastLane = this.lastLaneByUser.get(userId);
    const lastIndex = lastLane ? heads.findIndex((item) => item.laneId === lastLane) : -1;
    for (let offset = 1; offset <= heads.length; offset += 1) {
      const item = heads[(lastIndex + offset) % heads.length]!;
      if (pausedLanes.has(item.laneId)) continue;
      if (blockedLanes.has(item.laneId)) continue;
      const terminal = items.find(
        (candidate) => candidate.laneId === item.laneId && isTerminalKind(candidate.mutation.kind),
      );
      if (
        !force &&
        terminal?.nextAttemptAt != null &&
        new Date(terminal.nextAttemptAt).getTime() > now
      )
        continue;
      if (!force && item.nextAttemptAt !== null && new Date(item.nextAttemptAt).getTime() > now)
        continue;
      return item;
    }
    return null;
  }

  private nextAttemptAt(userId: string): string | null {
    const items = this.userItems(userId);
    const laneIds = [...new Set(items.map((item) => item.laneId))];
    const laneTimes: string[] = [];
    for (const laneId of laneIds) {
      const lane = items.filter((item) => item.laneId === laneId);
      if (lane.some((item) => item.state === "blocked")) continue;
      const head = lane[0];
      const terminal = lane.find((item) => isTerminalKind(item.mutation.kind));
      const gates = [head?.nextAttemptAt, terminal?.nextAttemptAt]
        .filter((value): value is string => value !== null && value !== undefined)
        .sort();
      if (gates.length) laneTimes.push(gates[gates.length - 1]!);
    }
    laneTimes.sort();
    return laneTimes[0] ?? null;
  }

  snapshot(userId: string | null): WorkoutMutationQueueSnapshot {
    const items = userId
      ? sortItems(this.store.read().filter((item) => item.userId === userId))
      : [];
    const blocked = items.filter((item) => item.state === "blocked");
    return {
      durable: this.store.durable,
      flushing: this.flushing && this.activeFlushUserId === userId,
      pendingCount: items.filter((item) => item.state === "pending").length,
      blockedCount: blocked.length,
      lastAppliedAt: this.lastAppliedAt,
      lastError: blocked[0]?.lastError ?? null,
      nextAttemptAt: userId ? this.nextAttemptAt(userId) : null,
      items,
      issues: blocked.map(issueForItem),
      terminalReceipts: userId
        ? this.store.readTerminalReceipts().filter((receipt) => receipt.userId === userId)
        : [],
    };
  }

  terminalReceipt(itemId: string): WorkoutTerminalReceipt | null {
    return this.store.readTerminalReceipts().find((receipt) => receipt.itemId === itemId) ?? null;
  }

  /**
   * A completed receipt is presentation state, not pending workout data. It is
   * intentionally removable only after the terminal mutation has been
   * acknowledged; callers can never make a queued or blocked finish vanish.
   */
  dismissTerminalReceipt(itemId: string): boolean {
    const receipts = this.store.readTerminalReceipts();
    const receipt = receipts.find((candidate) => candidate.itemId === itemId);
    if (!receipt || receipt.status !== "applied") return false;
    this.store.writeTerminalReceipts(receipts.filter((candidate) => candidate.itemId !== itemId));
    this.notify();
    return true;
  }

  /**
   * Recreates a terminal journal row when a browser restart left only its
   * durable receipt. Replaying the same terminal request is idempotent; the
   * preflight path still requires explicit cancelled-session recovery.
   */
  async retryTerminalReceipt(userId: string, itemId: string): Promise<void> {
    const items = this.store.read();
    if (items.some((item) => item.id === itemId && item.userId === userId)) {
      await this.retryBlocked(userId);
      return;
    }
    const receipt = this.store
      .readTerminalReceipts()
      .find((candidate) => candidate.itemId === itemId && candidate.userId === userId);
    if (!receipt || receipt.status !== "blocked" || !receipt.sessionId) return;
    const mayRetry =
      receipt.conflictState === "save_failed" || receipt.conflictState === "unauthenticated";
    const mutation: WorkoutMutation =
      receipt.kind === "session.finish"
        ? {
            kind: "session.finish",
            sessionId: receipt.sessionId,
            completedAt: receipt.requestedAt,
            ...(receipt.recoveryAuthorized ? { recoverCancelled: true } : {}),
          }
        : {
            kind: "session.cancel",
            sessionId: receipt.sessionId,
            completedAt: receipt.requestedAt,
          };
    const restored: QueuedWorkoutMutation = {
      id: receipt.itemId,
      revision: 1,
      userId,
      laneId: receipt.laneId,
      sessionId: receipt.sessionId,
      createdAt: receipt.acceptedAt,
      updatedAt: this.now().toISOString(),
      attempts: 0,
      nextAttemptAt: null,
      state: mayRetry ? "pending" : "blocked",
      lastError: mayRetry ? null : receipt.lastError,
      ...(mayRetry || !receipt.conflictState ? {} : { issueCode: receipt.conflictState }),
      mutation,
    };
    const nextItems = [...items, restored];
    const receipts = this.terminalReceiptsWith(restored, mayRetry ? "queued" : "blocked", {
      error: mayRetry ? null : receipt.lastError,
      ...(receipt.conflictState ? { conflictState: receipt.conflictState } : {}),
    });
    this.store.writeState(nextItems, receipts);
    this.notify();
    if (mayRetry) await this.flush(userId);
  }

  private terminalReceiptsWith(
    item: QueuedWorkoutMutation,
    status: WorkoutMutationReceiptStatus,
    options: {
      error?: string | null;
      summary?: WorkoutTerminalSummary | null;
      conflictState?: WorkoutMutationIssueCode | null;
      receipts?: readonly WorkoutTerminalReceipt[];
    } = {},
  ): WorkoutTerminalReceipt[] {
    if (!isTerminalMutation(item.mutation)) {
      return structuredClone([...(options.receipts ?? this.store.readTerminalReceipts())]);
    }
    const receipts = structuredClone([...(options.receipts ?? this.store.readTerminalReceipts())]);
    const index = receipts.findIndex((receipt) => receipt.itemId === item.id);
    const existing = index >= 0 ? receipts[index]! : terminalReceiptForItem(item)!;
    const next: WorkoutTerminalReceipt = {
      ...existing,
      laneId: item.laneId,
      sessionId: item.sessionId,
      kind: item.mutation.kind,
      status,
      completionState: completionStateForStatus(status),
      requestedAt: item.mutation.completedAt,
      conflictState:
        status === "blocked" ? (options.conflictState ?? item.issueCode ?? "save_failed") : null,
      recoveryAuthorized:
        item.mutation.kind === "session.finish" && item.mutation.recoverCancelled === true,
      updatedAt: this.now().toISOString(),
      lastError: options.error === undefined ? existing.lastError : options.error,
      summary: options.summary === undefined ? existing.summary : options.summary,
    };
    if (index >= 0) receipts[index] = next;
    else receipts.push(next);
    return pruneTerminalReceipts(receipts);
  }

  private setTerminalReceipt(
    item: QueuedWorkoutMutation,
    status: WorkoutMutationReceiptStatus,
    options: {
      error?: string | null;
      summary?: WorkoutTerminalSummary | null;
      conflictState?: WorkoutMutationIssueCode | null;
      items?: readonly QueuedWorkoutMutation[];
    } = {},
  ): void {
    if (!isTerminalMutation(item.mutation)) return;
    const receipts = this.terminalReceiptsWith(item, status, options);
    if (options.items) this.store.writeState(options.items, receipts);
    else this.store.writeTerminalReceipts(receipts);
  }

  private terminalItemsForLane(
    userId: string,
    laneId: string,
    items: readonly QueuedWorkoutMutation[] = this.store.read(),
  ): QueuedWorkoutMutation[] {
    return items.filter(
      (item) =>
        item.userId === userId && item.laneId === laneId && isTerminalKind(item.mutation.kind),
    );
  }

  private setLaneTerminalReceipt(
    items: readonly QueuedWorkoutMutation[],
    userId: string,
    laneId: string,
    status: WorkoutMutationReceiptStatus,
    error: string | null,
  ): void {
    const terminal = this.terminalItemsForLane(userId, laneId, items)[0];
    const blockingItem = items.find(
      (item) => item.userId === userId && item.laneId === laneId && item.state === "blocked",
    );
    if (terminal)
      this.setTerminalReceipt(terminal, status, {
        error,
        ...(status === "blocked" && blockingItem?.issueCode
          ? { conflictState: blockingItem.issueCode }
          : { conflictState: null }),
        items,
      });
    else this.store.write(items);
  }

  private async runWithTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new WorkoutMutationTimeoutError(this.requestTimeoutMs));
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([operation(controller.signal), timedOut]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private recordLanePreflightFailure(
    terminal: QueuedWorkoutMutation,
    error: unknown,
    metadata?: {
      code: WorkoutMutationIssueCode;
      field: string | null;
      invalidValue: unknown;
      neverRetry?: boolean;
    },
  ): void {
    const current = this.store.read();
    const index = current.findIndex((candidate) => candidate.id === terminal.id);
    if (index < 0) return;
    const stored = current[index]!;
    if (stored.revision !== terminal.revision) {
      this.setTerminalReceipt(stored, "queued", { error: null });
      return;
    }
    const attempts = stored.attempts + 1;
    const retryable =
      metadata?.neverRetry !== true &&
      isRetryableWorkoutMutationError(error) &&
      attempts < MAX_ATTEMPTS;
    const message = safeErrorMessage(error);
    const updated: QueuedWorkoutMutation = {
      ...stored,
      attempts,
      updatedAt: this.now().toISOString(),
      nextAttemptAt: retryable
        ? new Date(this.now().getTime() + retryDelayMs(attempts)).toISOString()
        : null,
      state: retryable ? "pending" : "blocked",
      lastError: message,
      ...(retryable
        ? {}
        : {
            issueCode:
              metadata?.code ??
              (error instanceof IronDeskError && error.code === "unauthenticated"
                ? "unauthenticated"
                : "save_failed"),
            issueField: metadata?.field ?? null,
            issueValue: metadata?.invalidValue ?? null,
          }),
    };
    if (retryable) {
      delete updated.issueCode;
      delete updated.issueField;
      delete updated.issueValue;
    }
    current[index] = updated;
    this.outcomes.set(updated.id, retryable ? "queued" : "blocked");
    this.setTerminalReceipt(updated, retryable ? "queued" : "blocked", {
      error: message,
      items: current,
    });
    this.notify();
  }

  private async preflightReadyLane(
    userId: string,
    item: QueuedWorkoutMutation,
    preflightedLanes: Map<string, string>,
  ): Promise<boolean> {
    const laneItems = this.store
      .read()
      .filter((candidate) => candidate.userId === userId && candidate.laneId === item.laneId);
    const terminals = laneItems.filter((candidate) => isTerminalKind(candidate.mutation.kind));
    if (!terminals.length || !this.preflightLane) return true;
    const signature = terminals.map((terminal) => `${terminal.id}:${terminal.revision}`).join("|");
    if (preflightedLanes.get(item.laneId) === signature) return true;

    const firstTerminal = terminals[0]!;
    const sessionId = firstTerminal.sessionId ?? sessionIdFromMutation(firstTerminal.mutation);
    if (!sessionId) {
      this.recordLanePreflightFailure(
        firstTerminal,
        new IronDeskError(
          "IronDesk cannot identify the workout for this saved queue.",
          "not_found",
        ),
        {
          code: "session_not_found",
          field: "sessionId",
          invalidValue: null,
          neverRetry: true,
        },
      );
      return false;
    }

    this.setTerminalReceipt(firstTerminal, "in_flight", { error: null });
    this.notify();

    let state: WorkoutMutationLaneState | null;
    try {
      state = await this.runWithTimeout((signal) => this.preflightLane!(sessionId, userId, signal));
    } catch (error) {
      this.recordLanePreflightFailure(firstTerminal, error);
      return false;
    }

    const currentTerminal = this.store
      .read()
      .find((candidate) => candidate.id === firstTerminal.id);
    if (!currentTerminal || currentTerminal.revision !== firstTerminal.revision) {
      if (currentTerminal)
        this.setTerminalReceipt(currentTerminal, "queued", { error: currentTerminal.lastError });
      return false;
    }

    if (!state) {
      this.recordLanePreflightFailure(
        firstTerminal,
        new IronDeskError("That saved workout is no longer available on the server.", "not_found"),
        {
          code: "session_not_found",
          field: "sessionId",
          invalidValue: sessionId,
          neverRetry: true,
        },
      );
      return false;
    }

    const oppositeTerminal = terminals.find((terminal) => {
      if (state.status === "completed") return terminal.mutation.kind === "session.cancel";
      if (state.status !== "cancelled" || terminal.mutation.kind !== "session.finish") return false;
      return terminal.mutation.recoverCancelled !== true;
    });
    if (oppositeTerminal) {
      const cancelledRecovery =
        state.status === "cancelled" && oppositeTerminal.mutation.kind === "session.finish";
      this.recordLanePreflightFailure(
        oppositeTerminal,
        new IronDeskError(
          cancelledRecovery
            ? "That workout is already cancelled. Confirm recovery before syncing its saved changes."
            : "That workout is already completed and cannot be cancelled.",
          "conflict",
        ),
        {
          code: cancelledRecovery ? "cancelled_session_requires_recovery" : "terminal_conflict",
          field: "status",
          invalidValue: state.status,
          neverRetry: true,
        },
      );
      return false;
    }

    preflightedLanes.set(item.laneId, signature);
    return true;
  }

  private commitResult(
    itemId: string,
    laneId: string,
    sessionId: string | null,
  ): WorkoutMutationCommitResult {
    const remaining = this.store.read().find((item) => item.id === itemId);
    const status = remaining
      ? remaining.state === "blocked"
        ? "blocked"
        : "queued"
      : (this.outcomes.get(itemId) ?? "applied");
    const outcome: WorkoutMutationCommitOutcome =
      status === "applied"
        ? "applied"
        : status === "blocked"
          ? remaining?.issueCode === "terminal_conflict" ||
            remaining?.issueCode === "cancelled_session_requires_recovery"
            ? "terminal_conflict"
            : "blocked"
          : this.store.durable && remaining?.attempts === 0 && remaining.nextAttemptAt === null
            ? "accepted_locally"
            : "retrying";
    return { itemId, status, outcome, durable: this.store.durable, laneId, sessionId };
  }

  private compact(
    items: QueuedWorkoutMutation[],
    userId: string,
    laneId: string,
    mutation: WorkoutMutation,
    now: string,
  ): { items: QueuedWorkoutMutation[]; mutation: WorkoutMutation | null; itemId?: string } {
    if (mutation.kind === "set.update") {
      const setId = mutation.setId;
      const addIndex = items.findIndex(
        (item) =>
          item.userId === userId &&
          item.laneId === laneId &&
          item.state === "pending" &&
          item.attempts === 0 &&
          item.id !== this.inFlightItemId &&
          item.mutation.kind === "set.add" &&
          item.mutation.recordId === setId,
      );
      if (addIndex >= 0) {
        const addItem = items[addIndex]!;
        const merged = mergeSetUpdateIntoUnsentAdd(
          addItem.mutation as Extract<WorkoutMutation, { kind: "set.add" }>,
          mutation,
        );
        items[addIndex] = {
          ...addItem,
          revision: addItem.revision + 1,
          updatedAt: now,
          mutation: merged.add,
        };
        if (!Object.keys(merged.remainder).length)
          return { items, mutation: null, itemId: addItem.id };
        mutation = { ...mutation, patch: merged.remainder };
      }
    }

    if (mutation.kind === "set.delete") {
      const add = items.find(
        (item) =>
          item.userId === userId &&
          item.laneId === laneId &&
          item.state === "pending" &&
          item.attempts === 0 &&
          item.id !== this.inFlightItemId &&
          item.mutation.kind === "set.add" &&
          item.mutation.recordId === mutation.setId,
      );
      if (add) {
        const related = items.filter(
          (item) =>
            item.userId === userId &&
            item.laneId === laneId &&
            (item.id === add.id ||
              ((item.mutation.kind === "set.update" || item.mutation.kind === "set.delete") &&
                item.mutation.setId === mutation.setId)),
        );
        if (related.every((item) => item.attempts === 0 && item.id !== this.inFlightItemId)) {
          const remove = new Set(related.map((item) => item.id));
          return { items: items.filter((item) => !remove.has(item.id)), mutation: null };
        }
      }
      items = items.filter(
        (item) =>
          !(
            item.userId === userId &&
            item.laneId === laneId &&
            item.id !== this.inFlightItemId &&
            item.mutation.kind === "set.update" &&
            item.mutation.setId === mutation.setId
          ),
      );
    }

    if (mutation.kind === "exercise.delete") {
      const unsentExercise = items.find(
        (item) =>
          item.userId === userId &&
          item.laneId === laneId &&
          item.state === "pending" &&
          item.attempts === 0 &&
          item.id !== this.inFlightItemId &&
          item.mutation.kind === "exercise.add" &&
          item.mutation.recordId === mutation.sessionExerciseId,
      );
      if (unsentExercise) {
        const childSetIds = new Set(
          items
            .filter(
              (item) =>
                item.userId === userId &&
                item.laneId === laneId &&
                item.mutation.kind === "set.add" &&
                item.mutation.sessionExerciseId === mutation.sessionExerciseId,
            )
            .map((item) => (item.mutation.kind === "set.add" ? item.mutation.recordId : "")),
        );
        const related = items.filter(
          (item) =>
            item.userId === userId &&
            item.laneId === laneId &&
            (item.id === unsentExercise.id ||
              ((item.mutation.kind === "exercise.method" ||
                item.mutation.kind === "exercise.substitute" ||
                item.mutation.kind === "exercise.delete") &&
                item.mutation.sessionExerciseId === mutation.sessionExerciseId) ||
              (item.mutation.kind === "set.add" &&
                item.mutation.sessionExerciseId === mutation.sessionExerciseId) ||
              ((item.mutation.kind === "set.update" || item.mutation.kind === "set.delete") &&
                childSetIds.has(item.mutation.setId))),
        );
        if (related.every((item) => item.attempts === 0 && item.id !== this.inFlightItemId)) {
          const removedIds = new Set(related.map((item) => item.id));
          return { items: items.filter((item) => !removedIds.has(item.id)), mutation: null };
        }
      }
      items = items.filter(
        (item) =>
          !(
            item.userId === userId &&
            item.laneId === laneId &&
            item.id !== this.inFlightItemId &&
            (item.mutation.kind === "exercise.method" ||
              item.mutation.kind === "exercise.substitute") &&
            item.mutation.sessionExerciseId === mutation.sessionExerciseId
          ),
      );
    }

    return { items, mutation };
  }

  async enqueue(
    userId: string,
    mutation: WorkoutMutation,
    options?: WorkoutMutationEnqueueOptions,
  ): Promise<WorkoutMutationCommitResult>;
  async enqueue(
    userId: string,
    sessionId: string | null,
    mutation: WorkoutMutation,
    options?: Omit<WorkoutMutationEnqueueOptions, "sessionId">,
  ): Promise<WorkoutMutationCommitResult>;
  async enqueue(
    userId: string,
    mutationOrSessionId: WorkoutMutation | string | null,
    mutationOrOptions?: WorkoutMutation | WorkoutMutationEnqueueOptions,
    explicitOptions: Omit<WorkoutMutationEnqueueOptions, "sessionId"> = {},
  ): Promise<WorkoutMutationCommitResult> {
    const mutation = isWorkoutMutation(mutationOrSessionId)
      ? mutationOrSessionId
      : (mutationOrOptions as WorkoutMutation);
    const options = isWorkoutMutation(mutationOrSessionId)
      ? ((mutationOrOptions as WorkoutMutationEnqueueOptions | undefined) ?? {})
      : { ...explicitOptions, sessionId: mutationOrSessionId };
    const invalid = invalidFieldForMutation(mutation);
    if (invalid.validationMessage) {
      throw new IronDeskError(invalid.validationMessage, "validation");
    }
    const requestedSessionId =
      options.sessionId?.trim() ||
      sessionIdFromMutation(mutation) ||
      inferSessionIdFromJournal(this.store.read(), userId, mutation);
    const now = this.now().toISOString();
    let items = this.store.read();
    // Only mutations whose session cannot be recovered remain in the
    // ambiguous legacy lane. A new session must not be trapped behind an old
    // blocked journal merely because both belong to the same athlete.
    const hasLegacyLane = items.some(
      (item) => item.userId === userId && item.laneId === `legacy:${userId}`,
    );
    const laneId =
      requestedSessionId !== null
        ? laneIdFor(userId, requestedSessionId)
        : hasLegacyLane
          ? `legacy:${userId}`
          : laneIdFor(userId, null);
    const sessionId = requestedSessionId;

    const queuedTerminal = items.find(
      (item) =>
        item.userId === userId && item.laneId === laneId && isTerminalMutation(item.mutation),
    );
    if (
      queuedTerminal &&
      isTerminalMutation(mutation) &&
      queuedTerminal.mutation.kind !== mutation.kind
    ) {
      throw new IronDeskError(
        "That workout already has a different finish or cancel operation saved on this device.",
        "conflict",
      );
    }
    const deletedTarget = items.some((item) => {
      if (item.userId !== userId || item.laneId !== laneId) return false;
      if (mutation.kind === "set.update" && item.mutation.kind === "set.delete") {
        return item.mutation.setId === mutation.setId;
      }
      if (
        (mutation.kind === "exercise.method" || mutation.kind === "exercise.substitute") &&
        item.mutation.kind === "exercise.delete"
      ) {
        return item.mutation.sessionExerciseId === mutation.sessionExerciseId;
      }
      return false;
    });
    if (deletedTarget) {
      throw new IronDeskError(
        "That workout record is already queued for deletion and cannot accept another edit.",
        "conflict",
      );
    }

    const compacted = this.compact(items, userId, laneId, mutation, now);
    items = compacted.items;
    if (compacted.mutation === null) {
      const itemId = compacted.itemId ?? this.createId();
      this.outcomes.set(itemId, "applied");
      this.store.write(items);
      this.notify();
      return this.commitResult(itemId, laneId, sessionId);
    }

    const queuedMutation = compacted.mutation;
    const key = coalesceKey(queuedMutation);
    const existing = key
      ? items.find(
          (item) =>
            item.userId === userId &&
            item.laneId === laneId &&
            item.state === "pending" &&
            coalesceKey(item.mutation) === key,
        )
      : undefined;
    let item: QueuedWorkoutMutation;
    if (existing) {
      const index = items.findIndex((candidate) => candidate.id === existing.id);
      item = {
        ...existing,
        revision: existing.revision + 1,
        updatedAt: now,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        mutation: mergeMutation(existing.mutation, queuedMutation),
      };
      items[index] = item;
    } else {
      item = {
        id: this.createId(),
        revision: 1,
        userId,
        laneId,
        sessionId,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        nextAttemptAt: null,
        state: "pending",
        lastError: null,
        mutation: queuedMutation,
      };
      const terminalIndex = isTerminalKind(queuedMutation.kind)
        ? -1
        : items.findIndex(
            (candidate) =>
              candidate.userId === userId &&
              candidate.laneId === laneId &&
              isTerminalKind(candidate.mutation.kind),
          );
      if (terminalIndex >= 0) {
        const terminal = items[terminalIndex]!;
        if (terminal.id === this.inFlightItemId) {
          throw new IronDeskError(
            "That workout is already finishing. Wait for its synchronization result before editing it.",
            "conflict",
          );
        }
        items.splice(terminalIndex, 0, item);
      } else {
        items.push(item);
      }
    }
    this.outcomes.set(item.id, "queued");
    if (isTerminalKind(item.mutation.kind)) {
      this.setTerminalReceipt(item, "queued", {
        error: null,
        items,
        ...(existing || options.terminalSummary === undefined
          ? {}
          : { summary: options.terminalSummary }),
      });
    } else this.store.write(items);
    this.notify();

    const flush = this.flush(userId);
    if (options.requireAcknowledgment) await flush;
    return this.commitResult(item.id, item.laneId, item.sessionId);
  }

  private async executeWithTimeout(item: QueuedWorkoutMutation): Promise<void> {
    await this.runWithTimeout((signal) =>
      this.execute(structuredClone(item.mutation), item.userId, signal),
    );
  }

  flush(userId: string, force = false): Promise<void> {
    if (this.activeFlush) {
      if (this.activeFlushUserId === userId) return this.activeFlush;
      return this.activeFlush.then(() => this.flush(userId, force));
    }
    if (!this.isOnline()) return Promise.resolve();
    this.flushing = true;
    this.activeFlushUserId = userId;
    this.notify();
    const run = async () => {
      const preflightedLanes = new Map<string, string>();
      const pausedLanes = new Set<string>();
      let appliedInBatch = false;
      try {
        while (this.isOnline()) {
          const item = this.nextReadyItem(userId, force, pausedLanes);
          if (!item) break;
          this.lastLaneByUser.set(userId, item.laneId);
          if (isTerminalMutation(item.mutation)) preflightedLanes.delete(item.laneId);
          if (!(await this.preflightReadyLane(userId, item, preflightedLanes))) {
            pausedLanes.add(item.laneId);
            continue;
          }
          this.inFlightItemId = item.id;
          this.setTerminalReceipt(item, "in_flight", { error: null });
          this.notify();
          try {
            await this.executeWithTimeout(item);
            const current = this.store.read();
            const stored = current.find((candidate) => candidate.id === item.id);
            if (!stored) continue;
            if (stored.revision === item.revision) {
              const remaining = current.filter((candidate) => candidate.id !== item.id);
              appliedInBatch = true;
              this.outcomes.set(item.id, "applied");
              if (isTerminalKind(stored.mutation.kind))
                this.setTerminalReceipt(stored, "applied", { error: null, items: remaining });
              else this.store.write(remaining);
            }
            this.notify();
          } catch (error) {
            const current = this.store.read();
            const index = current.findIndex((candidate) => candidate.id === item.id);
            if (index < 0) continue;
            const stored = current[index]!;
            if (stored.revision !== item.revision) {
              this.setTerminalReceipt(stored, "queued", { error: null });
              continue;
            }
            const attempts = stored.attempts + 1;
            const retryable = isRetryableWorkoutMutationError(error) && attempts < MAX_ATTEMPTS;
            const message = safeErrorMessage(error);
            const invalid = invalidFieldForMutation(stored.mutation);
            const updated: QueuedWorkoutMutation = {
              ...stored,
              attempts,
              updatedAt: this.now().toISOString(),
              nextAttemptAt: retryable
                ? new Date(this.now().getTime() + retryDelayMs(attempts)).toISOString()
                : null,
              state: retryable ? "pending" : "blocked",
              lastError: message,
              ...(retryable
                ? {}
                : {
                    issueCode: issueCodeForExecutionFailure(error, stored.mutation, invalid),
                    issueField: invalid.field,
                    issueValue: invalid.invalidValue,
                  }),
            };
            if (retryable) {
              delete updated.issueCode;
              delete updated.issueField;
              delete updated.issueValue;
            }
            current[index] = updated;
            this.outcomes.set(item.id, retryable ? "queued" : "blocked");
            if (isTerminalKind(updated.mutation.kind))
              this.setTerminalReceipt(updated, retryable ? "queued" : "blocked", {
                error: message,
                items: current,
              });
            else
              this.setLaneTerminalReceipt(
                current,
                updated.userId,
                updated.laneId,
                retryable ? "queued" : "blocked",
                message,
              );
            this.notify();
            pausedLanes.add(updated.laneId);
            // Fair selection skips this delayed/blocked lane and continues with
            // other workout sessions owned by the same account.
          } finally {
            this.inFlightItemId = null;
          }
        }
      } finally {
        if (appliedInBatch) this.lastAppliedAt = this.now().toISOString();
        this.flushing = false;
        this.activeFlushUserId = null;
        this.notify();
      }
    };
    this.activeFlush = run().finally(() => {
      this.activeFlush = null;
    });
    return this.activeFlush;
  }

  async retryBlocked(userId: string): Promise<void> {
    const now = this.now().toISOString();
    const retriedLanes = new Set<string>();
    const updated = this.store.read().map((item) => {
      if (item.userId !== userId || item.state !== "blocked") return item;
      if (item.issueCode !== "save_failed" && item.issueCode !== "unauthenticated") return item;
      const retried: QueuedWorkoutMutation = {
        ...item,
        attempts: 0,
        nextAttemptAt: null,
        state: "pending",
        lastError: null,
        updatedAt: now,
      };
      delete retried.issueCode;
      delete retried.issueField;
      delete retried.issueValue;
      retriedLanes.add(retried.laneId);
      return retried;
    });
    if (!retriedLanes.size) return;
    let receipts = this.store.readTerminalReceipts();
    for (const laneId of retriedLanes) {
      const terminal = updated.find(
        (item) =>
          item.userId === userId && item.laneId === laneId && isTerminalMutation(item.mutation),
      );
      if (terminal) {
        receipts = this.terminalReceiptsWith(terminal, "queued", {
          error: null,
          receipts,
        });
      }
    }
    this.store.writeState(updated, receipts);
    this.notify();
    await this.flush(userId);
  }

  async correctBlocked(
    userId: string,
    itemId: string,
    replacement: WorkoutMutation,
    options: { expectedRevision: number; requireAcknowledgment?: boolean },
  ): Promise<WorkoutMutationCommitResult> {
    const items = this.store.read();
    const index = items.findIndex(
      (item) => item.id === itemId && item.userId === userId && item.state === "blocked",
    );
    if (index < 0) throw new IronDeskError("That queued change is no longer blocked.", "not_found");
    const invalid = invalidFieldForMutation(replacement);
    if (invalid.validationMessage) {
      throw new IronDeskError(invalid.validationMessage, "validation");
    }
    const previous = items[index]!;
    if (previous.revision !== options.expectedRevision) {
      throw new IronDeskError(
        "That queued change was updated in another view. Review its current value before saving again.",
        "conflict",
      );
    }
    if (!isAllowedBlockedCorrection(previous, replacement)) {
      throw new IronDeskError(
        "That correction would change the identity or history of the queued workout operation.",
        "validation",
      );
    }
    const corrected: QueuedWorkoutMutation = {
      ...previous,
      revision: previous.revision + 1,
      attempts: 0,
      nextAttemptAt: null,
      state: "pending",
      lastError: null,
      updatedAt: this.now().toISOString(),
      mutation: replacement,
    };
    delete corrected.issueCode;
    delete corrected.issueField;
    delete corrected.issueValue;
    items[index] = corrected;
    this.outcomes.set(itemId, "queued");
    if (isTerminalKind(replacement.kind))
      this.setTerminalReceipt(corrected, "queued", { error: null, items });
    else {
      const laneStillBlocked = items.some(
        (item) =>
          item.userId === userId && item.laneId === corrected.laneId && item.state === "blocked",
      );
      const blockingItem = items.find(
        (item) =>
          item.userId === userId && item.laneId === corrected.laneId && item.state === "blocked",
      );
      const terminal = items.find(
        (item) =>
          item.userId === userId &&
          item.laneId === corrected.laneId &&
          isTerminalMutation(item.mutation),
      );
      let receipts = this.store
        .readTerminalReceipts()
        .filter((receipt) => receipt.itemId !== itemId);
      if (terminal) {
        receipts = this.terminalReceiptsWith(terminal, laneStillBlocked ? "blocked" : "queued", {
          error: laneStillBlocked ? (blockingItem?.lastError ?? null) : null,
          ...(laneStillBlocked && blockingItem?.issueCode
            ? { conflictState: blockingItem.issueCode }
            : { conflictState: null }),
          receipts,
        });
      }
      this.store.writeState(items, receipts);
    }
    this.notify();
    const flush = this.flush(userId);
    if (options.requireAcknowledgment) await flush;
    return this.commitResult(itemId, corrected.laneId, corrected.sessionId);
  }

  /** Removes one explicitly confirmed/exported recovery lane and nothing else. */
  discardLane(userId: string, laneId: string): void {
    const items = this.store.read();
    this.store.writeState(
      items.filter((item) => !(item.userId === userId && item.laneId === laneId)),
      this.store
        .readTerminalReceipts()
        .filter((receipt) => !(receipt.userId === userId && receipt.laneId === laneId)),
    );
    this.notify();
  }

  clearUser(userId: string): void {
    this.store.writeState(
      this.store.read().filter((item) => item.userId !== userId),
      this.store.readTerminalReceipts().filter((receipt) => receipt.userId !== userId),
    );
    this.notify();
  }
}

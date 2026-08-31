import { IronDeskError } from "./errors";
import type { MethodConfig, MethodSegmentConfig } from "./method-composition";

const STORAGE_KEY = "irondesk.workout-mutation-outbox.v1";
const STORAGE_VERSION = 1;
const MAX_ATTEMPTS = 8;
const MAX_RETRY_DELAY_MS = 30_000;

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
  rpe?: number;
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
  | { kind: "session.finish"; sessionId: string; completedAt: string }
  | { kind: "session.cancel"; sessionId: string; completedAt: string };

export type WorkoutMutationState = "pending" | "blocked";

export interface QueuedWorkoutMutation {
  id: string;
  revision: number;
  userId: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  state: WorkoutMutationState;
  lastError: string | null;
  mutation: WorkoutMutation;
}

export interface WorkoutMutationQueueSnapshot {
  durable: boolean;
  flushing: boolean;
  pendingCount: number;
  blockedCount: number;
  lastAppliedAt: string | null;
  lastError: string | null;
  items: readonly QueuedWorkoutMutation[];
}

export type WorkoutMutationCommitStatus = "applied" | "queued" | "blocked";

export interface WorkoutMutationCommitResult {
  itemId: string;
  status: WorkoutMutationCommitStatus;
}

export interface WorkoutMutationStore {
  readonly durable: boolean;
  read(): QueuedWorkoutMutation[];
  write(items: readonly QueuedWorkoutMutation[]): void;
}

export type WorkoutMutationExecutor = (
  mutation: WorkoutMutation,
  expectedUserId: string,
) => Promise<void>;

interface StoredEnvelope {
  version: 1;
  items: QueuedWorkoutMutation[];
}

interface QueueOptions {
  now?: () => Date;
  createId?: () => string;
  isOnline?: () => boolean;
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
    default:
      return false;
  }
}

function isQueuedWorkoutMutation(value: unknown): value is QueuedWorkoutMutation {
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

function parseEnvelope(raw: string | null): QueuedWorkoutMutation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed) ||
      parsed["version"] !== STORAGE_VERSION ||
      !Array.isArray(parsed["items"])
    )
      return [];
    return parsed["items"].filter(isQueuedWorkoutMutation);
  } catch {
    return [];
  }
}

export class BrowserWorkoutMutationStore implements WorkoutMutationStore {
  private fallback: QueuedWorkoutMutation[] = [];

  constructor(private storage: Storage | null) {}

  get durable(): boolean {
    return this.storage !== null;
  }

  read(): QueuedWorkoutMutation[] {
    if (!this.storage) return structuredClone(this.fallback);
    try {
      return parseEnvelope(this.storage.getItem(STORAGE_KEY));
    } catch {
      this.storage = null;
      return structuredClone(this.fallback);
    }
  }

  write(items: readonly QueuedWorkoutMutation[]): void {
    const copy = structuredClone([...items]);
    this.fallback = copy;
    if (!this.storage) return;
    try {
      const envelope: StoredEnvelope = { version: STORAGE_VERSION, items: copy };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // The in-memory fallback keeps the current page usable, but changing the
      // durability signal prevents the UI from promising reload recovery.
      this.storage = null;
    }
  }
}

export class MemoryWorkoutMutationStore implements WorkoutMutationStore {
  readonly durable = false;
  private items: QueuedWorkoutMutation[];

  constructor(initial: readonly QueuedWorkoutMutation[] = []) {
    this.items = structuredClone([...initial]);
  }

  read(): QueuedWorkoutMutation[] {
    return structuredClone(this.items);
  }

  write(items: readonly QueuedWorkoutMutation[]): void {
    this.items = structuredClone([...items]);
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
  if (previous.kind === "session.finish" && next.kind === "session.finish") {
    return previous;
  }
  if (previous.kind === "session.cancel" && next.kind === "session.cancel") {
    return previous;
  }
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

/** Only connectivity/availability failures are automatically replayed. */
export function isRetryableWorkoutMutationError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = safeErrorMessage(error).toLowerCase();
  if (
    /failed to fetch|network(?:error| request)?|load failed|offline|timed? ?out|connection (?:lost|reset|refused)|fetch failed/.test(
      message,
    )
  )
    return true;
  if (!(error instanceof IronDeskError) || error.code !== "database") return false;
  const code = diagnosticCode(error);
  if (!code) return false;
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

function retryDelayMs(attempts: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.max(0, attempts - 1));
}

function sortItems(items: QueuedWorkoutMutation[]): QueuedWorkoutMutation[] {
  // The persisted array is the FIFO journal. Do not use millisecond timestamps
  // as the ordering boundary: add + edit can be enqueued in the same tick.
  return [...items];
}

export class WorkoutMutationOutbox {
  private flushing = false;
  private lastAppliedAt: string | null = null;
  private listeners = new Set<() => void>();

  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly isOnline: () => boolean;

  constructor(
    private readonly store: WorkoutMutationStore,
    private readonly execute: WorkoutMutationExecutor,
    options: QueueOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createClientWorkoutRecordId;
    this.isOnline =
      options.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine !== false);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  snapshot(userId: string | null): WorkoutMutationQueueSnapshot {
    const items = userId
      ? sortItems(this.store.read().filter((item) => item.userId === userId))
      : [];
    const blocked = items.filter((item) => item.state === "blocked");
    return {
      durable: this.store.durable,
      flushing: this.flushing,
      pendingCount: items.filter((item) => item.state === "pending").length,
      blockedCount: blocked.length,
      lastAppliedAt: this.lastAppliedAt,
      lastError: blocked[0]?.lastError ?? null,
      items,
    };
  }

  async enqueue(userId: string, mutation: WorkoutMutation): Promise<WorkoutMutationCommitResult> {
    const now = this.now().toISOString();
    const items = this.store.read();
    const key = coalesceKey(mutation);
    const existing = key
      ? items.find(
          (item) =>
            item.userId === userId &&
            item.state === "pending" &&
            coalesceKey(item.mutation) === key,
        )
      : undefined;
    let itemId: string;
    if (existing) {
      itemId = existing.id;
      const index = items.findIndex((item) => item.id === existing.id);
      items[index] = {
        ...existing,
        revision: existing.revision + 1,
        updatedAt: now,
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        mutation: mergeMutation(existing.mutation, mutation),
      };
    } else {
      itemId = this.createId();
      items.push({
        id: itemId,
        revision: 1,
        userId,
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        nextAttemptAt: null,
        state: "pending",
        lastError: null,
        mutation,
      });
    }
    this.store.write(items);
    this.notify();

    await this.flush(userId);
    const remaining = this.store.read().find((item) => item.id === itemId);
    return {
      itemId,
      status: remaining ? (remaining.state === "blocked" ? "blocked" : "queued") : "applied",
    };
  }

  async flush(userId: string, force = false): Promise<void> {
    if (this.flushing || !this.isOnline()) return;
    this.flushing = true;
    this.notify();
    try {
      while (this.isOnline()) {
        const now = this.now();
        const item = sortItems(this.store.read()).find((candidate) => candidate.userId === userId);
        if (!item) break;
        // A blocked or backoff-delayed head is an ordering barrier. Skipping it
        // could send a child set before its parent exercise has been created.
        if (item.state === "blocked") break;
        if (
          !force &&
          item.nextAttemptAt !== null &&
          new Date(item.nextAttemptAt).getTime() > now.getTime()
        )
          break;

        try {
          await this.execute(structuredClone(item.mutation), item.userId);
          const current = this.store.read();
          const stored = current.find((candidate) => candidate.id === item.id);
          if (!stored) continue;
          if (stored.revision === item.revision) {
            this.store.write(current.filter((candidate) => candidate.id !== item.id));
            this.lastAppliedAt = this.now().toISOString();
          }
          this.notify();
        } catch (error) {
          const current = this.store.read();
          const index = current.findIndex((candidate) => candidate.id === item.id);
          if (index < 0) continue;
          const stored = current[index]!;
          if (stored.revision !== item.revision) {
            // A newer coalesced edit arrived while the older revision was in
            // flight. Keep the newer revision untouched and retry it next.
            continue;
          }
          const attempts = stored.attempts + 1;
          const retryable = isRetryableWorkoutMutationError(error) && attempts < MAX_ATTEMPTS;
          current[index] = {
            ...stored,
            attempts,
            updatedAt: this.now().toISOString(),
            nextAttemptAt: retryable
              ? new Date(this.now().getTime() + retryDelayMs(attempts)).toISOString()
              : null,
            state: retryable ? "pending" : "blocked",
            lastError: safeErrorMessage(error),
          };
          this.store.write(current);
          this.notify();
          break;
        }
      }
    } finally {
      this.flushing = false;
      this.notify();
    }
  }

  async retryBlocked(userId: string): Promise<void> {
    const now = this.now().toISOString();
    this.store.write(
      this.store.read().map((item) =>
        item.userId === userId && item.state === "blocked"
          ? {
              ...item,
              attempts: 0,
              nextAttemptAt: null,
              state: "pending",
              lastError: null,
              updatedAt: now,
            }
          : item,
      ),
    );
    this.notify();
    await this.flush(userId, true);
  }

  discardBlocked(userId: string): void {
    const items = this.store.read();
    const blockedIndex = items.findIndex(
      (item) => item.userId === userId && item.state === "blocked",
    );
    if (blockedIndex < 0) return;
    // Later operations may depend on the blocked head (exercise.add -> set.add).
    // Discard that user's tail as a unit rather than sending orphaned children.
    this.store.write(items.filter((item, index) => item.userId !== userId || index < blockedIndex));
    this.notify();
  }

  clearUser(userId: string): void {
    this.store.write(this.store.read().filter((item) => item.userId !== userId));
    this.notify();
  }
}

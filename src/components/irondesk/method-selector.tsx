import { Lock, ShieldAlert } from "lucide-react";

import { Pill } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import {
  canAddMethod,
  methodEligibility,
  sessionFatigue,
  TRAINING_METHODS,
  type AthleteMethodProfile,
  type EvidenceGrade,
  type MethodPrescription,
  type TrainingMethod,
} from "@/lib/irondesk/training-methods";

const evidenceTone: Record<EvidenceGrade, "success" | "primary" | "warning" | "default"> = {
  strong: "success",
  good: "primary",
  emerging: "warning",
  situational: "default",
};

function CostDots({ value, tone }: { value: number; tone: "warning" | "danger" }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${
            i <= value ? (tone === "danger" ? "bg-danger" : "bg-warning") : "bg-border-strong"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Premium training-method picker. Locked methods stay visible with the exact
 * reason they are locked — the athlete always sees what the engine decided.
 */
export function TrainingMethodSelector({
  profile,
  exercise,
  selectedIds,
  activeId,
  notice,
  onSelect,
  onClose,
}: {
  profile: AthleteMethodProfile;
  exercise?: { name: string; equipment?: string | null } | undefined;
  /** Methods already stacked in this session (fatigue budget). */
  selectedIds: readonly string[];
  activeId: string;
  /** Why the last attempted selection was refused, when it was refused. */
  notice?: string | null;
  onSelect: (methodId: string) => void;
  onClose?: () => void;
}) {
  const budgetUsed = sessionFatigue(selectedIds);

  return (
    <div className="rounded-lg border border-border-strong bg-surface-2/60 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="label-eyebrow text-primary">Training methods</p>
          <p className="text-xs text-muted-foreground">
            {profile.experience} · {profile.sessionsLast28Days} sessions / 28d · session fatigue{" "}
            <span className="numeric font-semibold text-foreground">{budgetUsed}</span>
          </p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        ) : null}
      </div>

      {notice ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </p>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        {TRAINING_METHODS.map((method) => (
          <MethodCard
            key={method.id}
            method={method}
            profile={profile}
            exercise={exercise}
            selectedIds={selectedIds}
            active={method.id === activeId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function MethodCard({
  method,
  profile,
  exercise,
  selectedIds,
  active,
  onSelect,
}: {
  method: TrainingMethod;
  profile: AthleteMethodProfile;
  exercise?: { name: string; equipment?: string | null } | undefined;
  selectedIds: readonly string[];
  active: boolean;
  onSelect: (methodId: string) => void;
}) {
  const eligibility = methodEligibility(method, profile, exercise);
  const stack = canAddMethod(
    selectedIds.filter((id) => id !== method.id),
    method.id,
    profile,
  );
  const usable = eligibility.unlocked && (active || stack.allowed);
  const blockedReason = eligibility.unlocked
    ? stack.allowed
      ? null
      : stack.reason
    : eligibility.statusReason;

  const isBlack = method.id === "irondesk-black";

  return (
    <button
      type="button"
      disabled={!usable}
      onClick={() => onSelect(method.id)}
      className={`rounded-lg border p-3 text-left transition ${
        active
          ? isBlack
            ? "border-danger/60 bg-danger/10"
            : "border-primary/60 bg-primary/10"
          : usable
            ? isBlack
              ? "border-danger/40 bg-surface-1 hover:border-danger/60"
              : "border-border bg-surface-1 hover:border-primary/40"
            : "border-border bg-surface-1/50 opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="label-eyebrow text-[0.5625rem] text-muted-foreground">
            Level {method.level} · {method.tier}
          </p>
          <p className={`truncate text-sm font-bold ${isBlack ? "text-danger" : ""}`}>
            {method.displayName}
          </p>
        </div>
        {usable ? null : <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Pill tone={evidenceTone[method.evidenceGrade]}>{method.evidenceGrade}</Pill>
        <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          Fatigue <CostDots value={method.fatigueCost} tone="warning" />
        </span>
        <span className="flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          Risk <CostDots value={method.technicalRisk} tone="danger" />
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{method.whatItDoes}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">When: </span>
        {method.whenToUse}
      </p>

      {usable ? (
        <p className="mt-1.5 text-[0.6875rem] text-success">{eligibility.statusReason}</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          {/* Every lock reason is shown — the athlete never guesses what blocks a method. */}
          {eligibility.safetyRestrictions.map((reason) => (
            <p key={reason} className="flex items-start gap-1 text-[0.6875rem] text-danger">
              <ShieldAlert className="mt-0.5 size-3 shrink-0" />
              {reason}
            </p>
          ))}
          {eligibility.unlockRequirements.length ? (
            <div className="text-[0.6875rem] text-warning">
              <p className="font-semibold">To unlock:</p>
              <ul className="mt-0.5 space-y-0.5">
                {eligibility.unlockRequirements.map((reason) => (
                  <li key={reason} className="flex items-start gap-1">
                    <Lock className="mt-0.5 size-3 shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {blockedReason && !eligibility.lockReasons.includes(blockedReason) ? (
            <p className="flex items-start gap-1 text-[0.6875rem] text-warning">
              <ShieldAlert className="mt-0.5 size-3 shrink-0" />
              {blockedReason}
            </p>
          ) : null}
        </div>
      )}
    </button>
  );
}

/** Execution line shown on an active-workout exercise card. */
export function MethodExecutionCard({
  method,
  prescription,
  doubleProgressionLine,
  readinessNote,
  volumeLine,
  missingPairing,
  onApply,
  onChange,
}: {
  method: TrainingMethod;
  prescription: MethodPrescription | null;
  doubleProgressionLine?: string | null;
  readinessNote?: string | null;
  /** Real weekly direct-set volume line for volume progression. */
  volumeLine?: string | null;
  /** Set when a pairing method has no real movement available yet. */
  missingPairing?: string | null;
  /** Writes the method's real set structure into the active workout. */
  onApply?: (() => void) | undefined;
  onChange: () => void;
}) {
  return (
    <div
      className={`mb-3 rounded-lg border p-3 ${
        method.id === "irondesk-black"
          ? "border-danger/50 bg-danger/5"
          : "border-border-strong bg-surface-2/50"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`label-eyebrow ${
              method.id === "irondesk-black" ? "text-danger" : "text-primary"
            }`}
          >
            {method.displayName.toUpperCase()} · L{method.level}
          </p>
          {prescription ? (
            <p className="numeric mt-0.5 text-sm font-bold text-foreground">
              {prescription.summary}
            </p>
          ) : doubleProgressionLine ? (
            <p className="numeric mt-0.5 text-sm font-bold text-foreground">
              {doubleProgressionLine}
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">{method.whatItDoes}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={evidenceTone[method.evidenceGrade]}>{method.evidenceGrade}</Pill>
          {readinessNote ? <Pill tone="warning">{readinessNote}</Pill> : null}
          {onApply ? (
            <Button size="sm" variant="secondary" onClick={onApply}>
              Apply to sets
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onChange}>
            Change
          </Button>
        </div>
      </div>
      {prescription?.steps.length ? (
        <ol className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {prescription.steps.map((step, i) => (
            <li key={i} className="numeric">
              {i + 1}. {step}
            </li>
          ))}
        </ol>
      ) : null}
      {volumeLine ? (
        <p className="numeric mt-2 text-xs text-muted-foreground">{volumeLine}</p>
      ) : null}
      {missingPairing ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {missingPairing}
        </p>
      ) : null}
      {method.safetyNotes.length ? (
        <p className="mt-2 text-[0.6875rem] text-muted-foreground">{method.safetyNotes[0]}</p>
      ) : null}
    </div>
  );
}

/**
 * Template browser for the /workout start state.
 *
 * Shows the read-only "IronDesk Originals" (the 12 legacy programs) plus, in
 * live mode, the athlete's own templates. Filters are client-side over the
 * already-loaded set so the controls stay instant on a phone mid-session.
 */
import {
  Dumbbell,
  Flame,
  Home,
  Lock,
  Play,
  Search,
  Timer,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { CustomWorkoutBuilder } from "@/components/irondesk/custom-workout-builder";
import { EmptyState, Pill, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isFreeStartable, RELEASE_GATE_LABEL } from "@/lib/irondesk/program-logic";
import { templatesQuery } from "@/lib/irondesk/queries";
import type { AthleteMethodProfile } from "@/lib/irondesk/training-methods";
import type {
  Exercise,
  PersonalTemplateDraft,
  TemplateExercise,
  WorkoutTemplate,
} from "@/lib/irondesk/types";
import { formatLoadGuidance, type Units } from "@/lib/irondesk/units";
import { useModeData } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";
import { cn } from "@/lib/utils";

type EnvFilter = "all" | "home" | "gym";
type TypeFilter = "all" | "heavy" | "pump";

const BODY_AREA_LABEL: Record<string, string> = {
  chest: "Chest",
  arms: "Arms",
  back: "Back",
  shoulders: "Shoulders",
  legs: "Legs",
  "calves-plus-abs": "Calves + Abs",
};

const bodyArea = (t: WorkoutTemplate) =>
  t.tags.find((tag) => tag in BODY_AREA_LABEL) ??
  (t.legacyDayId ? t.legacyDayId.toLowerCase() : null);

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition",
        active
          ? "border-primary/60 bg-primary/15 text-primary"
          : "border-border bg-surface-2 text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PrescriptionLine({ ex, units }: { ex: TemplateExercise; units: Units }) {
  const load = formatLoadGuidance(ex.loadGuidance, ex.sourceLoadUnit, units);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{ex.name}</p>
        {ex.notes && <p className="text-xs text-muted-foreground">{ex.notes}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="numeric font-semibold">
          {ex.targetSets} × {ex.targetReps}
        </span>
        {load && (
          <span
            className="numeric text-muted-foreground"
            title={load.source ? `Source: ${load.source}` : undefined}
          >
            {load.text}
          </span>
        )}
        {ex.isHeavy && <Pill tone="warning">Heavy</Pill>}
        {ex.isDropSet && <Pill tone="primary">Drop</Pill>}
        {ex.restSeconds != null && (
          <span className="text-muted-foreground">{Math.round(ex.restSeconds / 60)}m rest</span>
        )}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onPreview,
  onStart,
  busy,
  locked,
  onDelete,
}: {
  template: WorkoutTemplate;
  onPreview: () => void;
  onStart: () => void;
  busy: boolean;
  /** Assignment-only content: startable through an assigned program only. */
  locked?: boolean;
  /** Present only for an owner-scoped personal template. */
  onDelete?: () => void;
}) {
  const area = bodyArea(template);
  return (
    <div className="panel flex flex-col gap-3 p-4 transition hover:border-primary/40">
      <div>
        <div className="flex items-center gap-1.5">
          {template.environment === "home" ? (
            <Home className="size-3.5 text-muted-foreground" />
          ) : (
            <Dumbbell className="size-3.5 text-muted-foreground" />
          )}
          <p className="label-eyebrow">
            {template.isSystem ? (locked ? "Legacy Beta" : "IronDesk Original") : "My template"}
            {area ? ` · ${BODY_AREA_LABEL[area] ?? area}` : ""}
          </p>
        </div>
        <h3 className="mt-1 text-base leading-tight font-bold tracking-tight">{template.name}</h3>
        {template.focus && <p className="mt-1 text-xs text-muted-foreground">{template.focus}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {locked && (
          <Pill tone="warning">
            <Lock className="mr-1 inline size-3" />
            Assigned only
          </Pill>
        )}
        {template.workoutType === "heavy" && (
          <Pill tone="warning">
            <Flame className="mr-1 inline size-3" />
            Heavy
          </Pill>
        )}
        {template.workoutType === "pump" && <Pill tone="primary">Pump</Pill>}
        <Pill>{template.exercises.length} movements</Pill>
        {template.estimatedMinutes && (
          <Pill>
            <Timer className="mr-1 inline size-3" />
            {template.estimatedMinutes}m
          </Pill>
        )}
      </div>

      <div className="mt-auto flex gap-2">
        {locked ? (
          <Button size="sm" variant="secondary" className="flex-1" onClick={onPreview}>
            <Lock className="size-4" /> Review &amp; unlock
          </Button>
        ) : (
          <>
            <Button size="sm" className="flex-1" disabled={busy} onClick={onStart}>
              <Play className="size-4" /> Start
            </Button>
            <Button size="sm" variant="secondary" onClick={onPreview}>
              Preview
            </Button>
            {onDelete ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onDelete}
                aria-label={`Delete ${template.name}`}
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function TemplateLibrary({
  onStart,
  onUnlockStart,
  busy,
  canStart,
  note,
  exercises,
  onCreatePersonal,
  onStartCreated,
  onDeletePersonal,
  builderReadOnlyNote,
  methodProfile,
}: {
  onStart: (template: WorkoutTemplate) => void;
  /**
   * Starts an assignment-only template as free training after the athlete
   * acknowledges its source-review warnings. Omitted when unlocking is not
   * available (demo mode, or a session already in progress).
   */
  onUnlockStart?: (template: WorkoutTemplate) => void;
  busy: boolean;
  /** False in demo mode or while another session is in progress. */
  canStart: boolean;
  /** Explains why starting is unavailable. */
  note?: string;
  /** Full readable library used by the personal workout builder. */
  exercises?: readonly Exercise[];
  onCreatePersonal?: (draft: PersonalTemplateDraft) => Promise<string>;
  onStartCreated?: (templateId: string) => Promise<void>;
  onDeletePersonal?: (templateId: string) => Promise<void>;
  builderReadOnlyNote?: string;
  methodProfile?: AthleteMethodProfile;
}) {
  const templates = useModeData(templatesQuery);
  const units = useUnits();
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState<EnvFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [area, setArea] = useState<string | "all">("all");
  const [preview, setPreview] = useState<WorkoutTemplate | null>(null);
  const [building, setBuilding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  /** Explicit per-preview consent required before unlocking gated content. */
  const [acknowledged, setAcknowledged] = useState(false);

  const areas = useMemo(() => {
    const found = new Set<string>();
    for (const t of templates) {
      const a = bodyArea(t);
      if (a) found.add(a);
    }
    return Object.keys(BODY_AREA_LABEL).filter((k) => found.has(k));
  }, [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (env !== "all" && t.environment !== env) return false;
      if (type !== "all" && t.workoutType !== type) return false;
      if (area !== "all" && bodyArea(t) !== area) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        (t.focus ?? "").toLowerCase().includes(q) ||
        t.exercises.some((e) => e.name.toLowerCase().includes(q))
      );
    });
  }, [templates, query, env, type, area]);

  const originals = filtered.filter((t) => t.isSystem && isFreeStartable(t));
  const assignedOnly = filtered.filter((t) => t.isSystem && !isFreeStartable(t));
  // Repository reads already hide staged rows; keep this UI guard so a stale
  // cache or demo fixture still cannot surface a non-startable personal orphan.
  const personal = filtered.filter((t) => !t.isSystem && isFreeStartable(t));
  const canWritePersonal = Boolean(exercises && onCreatePersonal && onStartCreated);
  const canShowBuilder = Boolean(exercises);
  const anyFilter = query.trim() !== "" || env !== "all" || type !== "all" || area !== "all";

  const reset = () => {
    setQuery("");
    setEnv("all");
    setType("all");
    setArea("all");
  };

  const removePersonal = async (template: WorkoutTemplate) => {
    if (!onDeletePersonal || template.isSystem || deletingId) return;
    if (!window.confirm(`Delete “${template.name}”? This removes only your saved template.`))
      return;
    setDeletingId(template.id);
    setManageError(null);
    try {
      await onDeletePersonal(template.id);
      if (preview?.id === template.id) setPreview(null);
    } catch (caught) {
      setManageError(
        caught instanceof Error ? caught.message : "Could not delete that personal workout.",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <SectionCard
        title="IronDesk Originals"
        eyebrow="Templates"
        action={
          anyFilter ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              <X className="size-4" /> Clear
            </Button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search workouts or movements"
              className="pl-9"
              aria-label="Search templates"
            />
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterChip active={env === "all"} onClick={() => setEnv("all")}>
              All
            </FilterChip>
            <FilterChip active={env === "home"} onClick={() => setEnv("home")}>
              Home
            </FilterChip>
            <FilterChip active={env === "gym"} onClick={() => setEnv("gym")}>
              Gym
            </FilterChip>
            <span className="mx-1 w-px shrink-0 bg-border" aria-hidden />
            <FilterChip
              active={type === "heavy"}
              onClick={() => setType(type === "heavy" ? "all" : "heavy")}
            >
              Heavy
            </FilterChip>
            <FilterChip
              active={type === "pump"}
              onClick={() => setType(type === "pump" ? "all" : "pump")}
            >
              Pump
            </FilterChip>
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {areas.map((a) => (
              <FilterChip
                key={a}
                active={area === a}
                onClick={() => setArea(area === a ? "all" : a)}
              >
                {BODY_AREA_LABEL[a] ?? a}
              </FilterChip>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              title="No templates match"
              description="Try a different body area, environment or search term."
              action={
                <Button variant="secondary" onClick={reset}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {originals.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  busy={busy || !canStart}
                  onPreview={() => setPreview(t)}
                  onStart={() => onStart(t)}
                />
              ))}
            </div>
          )}

          {!canStart && note && <p className="text-xs text-muted-foreground">{note}</p>}
        </div>
      </SectionCard>

      {assignedOnly.length > 0 && (
        <SectionCard title="Assigned Program Library" eyebrow="Legacy Beta">
          <p className="mb-3 text-xs text-muted-foreground">
            These prescriptions ship through assigned programs because they carry source review
            notes. Enroll in the matching program in My Program for guided delivery and progression,
            or review the notes and unlock any one of them as free training.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assignedOnly.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                locked
                busy={busy}
                onPreview={() => setPreview(t)}
                onStart={() => undefined}
              />
            ))}
          </div>
        </SectionCard>
      )}

      {(personal.length > 0 || canShowBuilder) && (
        <SectionCard
          title="My Templates"
          eyebrow="Personal"
          action={
            canShowBuilder ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setManageError(null);
                  setBuilding(true);
                }}
              >
                <WandSparkles className="size-4" /> Build your own
              </Button>
            ) : undefined
          }
        >
          {manageError ? (
            <p
              className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {manageError}
            </p>
          ) : null}
          {personal.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {personal.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  busy={busy || !canStart || deletingId === t.id}
                  onPreview={() => setPreview(t)}
                  onStart={() => onStart(t)}
                  {...(onDeletePersonal ? { onDelete: () => void removePersonal(t) } : {})}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Build a workout from the complete exercise library, then save it here for one-tap
              starts.
            </p>
          )}
        </SectionCard>
      )}

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null);
            setAcknowledged(false);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle className="tracking-tight">{preview.name}</DialogTitle>
                <p className="text-xs text-muted-foreground">{preview.focus}</p>
              </DialogHeader>
              {!isFreeStartable(preview) && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <p className="font-semibold">
                    Assignment only · {RELEASE_GATE_LABEL[preview.releaseGate ?? "public"]}
                  </p>
                  {(preview.warnings ?? []).slice(0, 3).map((w, i) => (
                    <p key={i} className="mt-1 text-muted-foreground">
                      {w.message}
                    </p>
                  ))}
                </div>
              )}
              <div className="divide-border">
                {preview.exercises.map((ex) => (
                  <PrescriptionLine key={ex.id} ex={ex} units={units} />
                ))}
              </div>
              {isFreeStartable(preview) ? (
                <Button
                  className="w-full"
                  disabled={busy || !canStart}
                  onClick={() => onStart(preview)}
                >
                  <Play className="size-4" /> Start this workout
                </Button>
              ) : onUnlockStart && canStart ? (
                <div className="space-y-3">
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(value) => setAcknowledged(value === true)}
                      className="mt-0.5"
                    />
                    <span>
                      I have reviewed the source notes above and accept responsibility for training
                      this prescription outside an assigned program. Load and volume stay my
                      judgement call.
                    </span>
                  </label>
                  <Button
                    className="w-full"
                    disabled={busy || !acknowledged}
                    onClick={() => onUnlockStart(preview)}
                  >
                    <Play className="size-4" /> Unlock &amp; start as free training
                  </Button>
                </div>
              ) : (
                <Button className="w-full" variant="secondary" disabled>
                  <Lock className="size-4" /> Delivered through an assigned program
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={building} onOpenChange={setBuilding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Build your own workout</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Choose movements from the full library, set the prescription and arrange the training
              order.
            </p>
          </DialogHeader>
          {building && exercises ? (
            <CustomWorkoutBuilder
              exercises={exercises}
              disabled={busy}
              onClose={() => setBuilding(false)}
              {...(methodProfile ? { methodProfile } : {})}
              {...(onCreatePersonal ? { onCreate: onCreatePersonal } : {})}
              {...(onStartCreated ? { onStart: onStartCreated } : {})}
              {...(!canWritePersonal
                ? {
                    readOnlyNote:
                      builderReadOnlyNote ??
                      "Read-only preview. Sign in to save this workout to My Templates or start it.",
                  }
                : {})}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

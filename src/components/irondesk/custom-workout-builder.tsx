import { ArrowDown, ArrowUp, Loader2, Play, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ExercisePicker } from "@/components/irondesk/exercise-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  Exercise,
  PersonalTemplateDraft,
  PersonalTemplateDraftExercise,
} from "@/lib/irondesk/types";

export function CustomWorkoutBuilder({
  exercises,
  disabled,
  onCreate,
  onStart,
  onClose,
  readOnlyNote,
}: {
  exercises: readonly Exercise[];
  disabled?: boolean;
  onCreate?: (draft: PersonalTemplateDraft) => Promise<string>;
  onStart?: (templateId: string) => Promise<void>;
  onClose: () => void;
  readOnlyNote?: string;
}) {
  const [name, setName] = useState("My Workout");
  const [focus, setFocus] = useState("");
  const [selected, setSelected] = useState<PersonalTemplateDraftExercise[]>([]);
  const [busy, setBusy] = useState<"save" | "start" | null>(null);
  const [createdTemplateId, setCreatedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedIds = useMemo(
    () => new Set(selected.map((exercise) => exercise.exerciseId)),
    [selected],
  );

  const add = (exercise: Exercise) => {
    setSelected((current) =>
      current.some((item) => item.exerciseId === exercise.id)
        ? current
        : [
            ...current,
            {
              exerciseId: exercise.id,
              name: exercise.name,
              targetSets: 3,
              targetReps: "10",
            },
          ],
    );
    setError(null);
  };

  const update = (exerciseId: string, patch: Partial<PersonalTemplateDraftExercise>) =>
    setSelected((current) =>
      current.map((exercise) =>
        exercise.exerciseId === exerciseId ? { ...exercise, ...patch } : exercise,
      ),
    );

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selected.length) return;
    setSelected((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item) next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const save = async (startAfterSave: boolean) => {
    if (busy || disabled || createdTemplateId || !onCreate || (startAfterSave && !onStart)) return;
    setBusy(startAfterSave ? "start" : "save");
    setError(null);
    try {
      const templateId = await onCreate({ name, focus, exercises: selected });
      if (!startAfterSave) {
        onClose();
        return;
      }
      try {
        await onStart!(templateId);
        onClose();
      } catch (caught) {
        setCreatedTemplateId(templateId);
        const reason =
          caught instanceof Error ? caught.message : "the session could not be started";
        setError(`Your workout was saved to My Templates, but it did not start: ${reason}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that workout.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="custom-workout-name" className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Workout name</span>
          <Input
            id="custom-workout-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            disabled={Boolean(createdTemplateId)}
          />
        </label>
        <label htmlFor="custom-workout-focus" className="space-y-1.5">
          <span className="text-xs font-semibold text-muted-foreground">Focus (optional)</span>
          <Input
            id="custom-workout-focus"
            value={focus}
            onChange={(event) => setFocus(event.target.value)}
            placeholder="Upper body, legs, full body…"
            maxLength={120}
            disabled={Boolean(createdTemplateId)}
          />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Workout order</p>
            <p className="text-xs text-muted-foreground">
              Edit the prescription, then reorder as needed.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">{selected.length}/30</span>
        </div>
        {selected.length ? (
          <div className="space-y-2">
            {selected.map((exercise, index) => (
              <div
                key={exercise.exerciseId}
                className="grid gap-2 rounded-lg border border-border bg-surface-2/50 p-3 sm:grid-cols-[minmax(0,1fr)_5rem_6rem_auto] sm:items-end"
              >
                <div className="min-w-0 self-center">
                  <p className="truncate text-sm font-semibold">
                    {index + 1}. {exercise.name}
                  </p>
                </div>
                <label className="space-y-1">
                  <span className="text-[0.6875rem] font-semibold text-muted-foreground">Sets</span>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    inputMode="numeric"
                    value={exercise.targetSets}
                    onChange={(event) =>
                      update(exercise.exerciseId, { targetSets: Number(event.target.value) })
                    }
                    disabled={Boolean(createdTemplateId)}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[0.6875rem] font-semibold text-muted-foreground">Reps</span>
                  <Input
                    value={exercise.targetReps}
                    onChange={(event) =>
                      update(exercise.exerciseId, { targetReps: event.target.value })
                    }
                    placeholder="8-10"
                    maxLength={32}
                    disabled={Boolean(createdTemplateId)}
                  />
                </label>
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0 || Boolean(createdTemplateId)}
                    onClick={() => move(index, -1)}
                    aria-label={`Move ${exercise.name} up`}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === selected.length - 1 || Boolean(createdTemplateId)}
                    onClick={() => move(index, 1)}
                    aria-label={`Move ${exercise.name} down`}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={Boolean(createdTemplateId)}
                    onClick={() =>
                      setSelected((current) =>
                        current.filter((item) => item.exerciseId !== exercise.exerciseId),
                      )
                    }
                    aria-label={`Remove ${exercise.name}`}
                    className="text-muted-foreground hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Add your first movement from the library below.
          </div>
        )}
      </div>

      {!createdTemplateId ? (
        <div>
          <p className="mb-2 text-sm font-semibold">Exercise library</p>
          <ExercisePicker exercises={exercises} selectedIds={selectedIds} onSelect={add} />
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {readOnlyNote ? (
        <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
          {readOnlyNote}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose} disabled={Boolean(busy)}>
          {createdTemplateId ? "Done" : "Cancel"}
        </Button>
        {!createdTemplateId ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={Boolean(busy) || disabled || !onCreate}
              onClick={() => void save(false)}
            >
              {busy === "save" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              disabled={Boolean(busy) || disabled || !onCreate || !onStart}
              onClick={() => void save(true)}
            >
              {busy === "start" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {busy === "start" ? "Saving…" : "Save & Start"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as repo from "@/lib/irondesk/repo";
import type { Exercise } from "@/lib/irondesk/types";
import { useIronDeskInvalidate } from "@/lib/irondesk/use-data";

const schema = z.object({
  name: z.string().min(2, "Give the movement a name."),
  primaryMuscle: z.string().min(2, "Set a primary muscle."),
  equipment: z.string().min(2, "Set the equipment used."),
  movementPattern: z.string().min(2, "Set the movement pattern."),
});

/** Create or edit a user-owned movement. System rows are never editable. */
export function ExerciseDialog({
  open,
  onOpenChange,
  exercise,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercise?: Exercise;
}) {
  const invalidate = useIronDeskInvalidate();
  const editing = Boolean(exercise?.isCustom);

  const [name, setName] = useState(exercise?.name ?? "");
  const [primaryMuscle, setPrimaryMuscle] = useState(exercise?.muscle ?? "");
  const [secondary, setSecondary] = useState((exercise?.secondary ?? []).join(", "));
  const [equipment, setEquipment] = useState(exercise?.equipment ?? "");
  const [movementPattern, setMovementPattern] = useState(exercise?.pattern ?? "");
  const [instructions, setInstructions] = useState(exercise?.instructions ?? "");
  const [cues, setCues] = useState((exercise?.cues ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = schema.safeParse({ name, primaryMuscle, equipment, movementPattern });
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);
      const payload = {
        ...parsed.data,
        secondaryMuscles: secondary
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        cues: cues
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (editing && exercise) await repo.updateCustomExercise(exercise.id, payload);
      else await repo.createCustomExercise(payload);
      invalidate();
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the movement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit movement" : "New custom movement"}</DialogTitle>
          <DialogDescription>
            Custom movements are private to your account and usable in any session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input id="ex-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Safety Bar Squat" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-muscle">Primary muscle</Label>
              <Input id="ex-muscle" value={primaryMuscle} onChange={(e) => setPrimaryMuscle(e.target.value)} placeholder="Quads" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-equip">Equipment</Label>
              <Input id="ex-equip" value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Barbell" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-pattern">Movement pattern</Label>
              <Input id="ex-pattern" value={movementPattern} onChange={(e) => setMovementPattern(e.target.value)} placeholder="Squat" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-secondary">Secondary (comma separated)</Label>
              <Input id="ex-secondary" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="Glutes, Core" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-instructions">Instructions</Label>
            <Textarea id="ex-instructions" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ex-cues">Cues (one per line)</Label>
            <Textarea id="ex-cues" rows={3} value={cues} onChange={(e) => setCues(e.target.value)} />
          </div>
          {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} {editing ? "Save movement" : "Create movement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

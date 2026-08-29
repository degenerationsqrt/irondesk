import { Check, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  exerciseFilterFacets,
  filterExercises,
  type ExerciseFilterMode,
} from "@/lib/irondesk/exercise-filter";
import type { Exercise } from "@/lib/irondesk/types";
import { cn } from "@/lib/utils";

const MODES: { value: ExerciseFilterMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "recent", label: "Recent" },
  { value: "custom", label: "Custom" },
];

export function ExercisePicker({
  exercises,
  selectedIds,
  onSelect,
  actionLabel = "Add",
  className,
}: {
  exercises: readonly Exercise[];
  selectedIds?: ReadonlySet<string>;
  onSelect: (exercise: Exercise) => void;
  actionLabel?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ExerciseFilterMode>("all");
  const [muscle, setMuscle] = useState<string | "all">("all");
  const [equipment, setEquipment] = useState<string | "all">("all");
  const facets = useMemo(() => exerciseFilterFacets(exercises), [exercises]);
  const filtered = useMemo(
    () => filterExercises(exercises, { query, mode, muscle, equipment }),
    [equipment, exercises, mode, muscle, query],
  );
  const anyFilter =
    query.trim() !== "" || mode !== "all" || muscle !== "all" || equipment !== "all";

  const reset = () => {
    setQuery("");
    setMode("all");
    setMuscle("all");
    setEquipment("all");
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, muscle, equipment or pattern"
          className="h-11 pl-9"
          aria-label="Search exercise library"
        />
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Exercise library views">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setMode(item.value)}
            aria-pressed={mode === item.value}
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              mode === item.value
                ? "border-primary/45 bg-primary/12 text-primary"
                : "border-border bg-surface-2 text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={muscle} onValueChange={setMuscle}>
          <SelectTrigger aria-label="Filter by muscle">
            <SelectValue placeholder="All muscles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All muscles</SelectItem>
            {facets.muscles.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={equipment} onValueChange={setEquipment}>
          <SelectTrigger aria-label="Filter by equipment">
            <SelectValue placeholder="All equipment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All equipment</SelectItem>
            {facets.equipment.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span aria-live="polite">
          {filtered.length} of {exercises.length} movements
        </span>
        {anyFilter ? (
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            <X className="size-3.5" /> Reset
          </Button>
        ) : null}
      </div>

      {filtered.length ? (
        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {filtered.map((exercise) => {
            const selected = selectedIds?.has(exercise.id) ?? false;
            return (
              <button
                key={exercise.id}
                type="button"
                disabled={selected}
                onClick={() => onSelect(exercise)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3 text-left transition hover:border-primary/45 disabled:cursor-default disabled:opacity-65 [content-visibility:auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{exercise.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {exercise.muscle} · {exercise.equipment} · {exercise.pattern}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                  {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
                  {selected ? "Added" : actionLabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-5 text-center">
          <p className="text-sm font-semibold">No movements match</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try fewer search terms or reset the filters.
          </p>
        </div>
      )}
    </div>
  );
}

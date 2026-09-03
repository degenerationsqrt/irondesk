import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  Clock3,
  Dumbbell,
  Footprints,
  MapPin,
  RotateCcw,
  Sparkles,
  TimerReset,
  Zap,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { MetricTile, Pill, ProgressBar, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import {
  HOME_WORKOUT_CATEGORY_LABELS,
  HOME_WORKOUT_WARM_UP,
  HOME_WORKOUTS,
  homeWorkoutById,
  type HomeWorkout,
  type HomeWorkoutCategory,
  type HomeWorkoutLevel,
} from "@/lib/irondesk/home-workouts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/home-workouts")({
  head: () => ({
    meta: [
      { title: "No-Gym Workouts - IronDesk" },
      {
        name: "description",
        content:
          "Choose from 12 bodyweight strength, plyometric, speed, and jump-rope workouts with no gym required.",
      },
      { property: "og:title", content: "No-Gym Workouts - IronDesk" },
      {
        property: "og:description",
        content: "Player-choice bodyweight training for home or a safe outdoor space.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomeWorkoutsPage,
});

type CategoryFilter = "all" | HomeWorkoutCategory;

const CATEGORY_FILTERS: readonly { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All 12" },
  { value: "strength", label: HOME_WORKOUT_CATEGORY_LABELS.strength },
  { value: "power", label: HOME_WORKOUT_CATEGORY_LABELS.power },
  { value: "speed", label: HOME_WORKOUT_CATEGORY_LABELS.speed },
  { value: "conditioning", label: HOME_WORKOUT_CATEGORY_LABELS.conditioning },
];

const categoryTone: Record<HomeWorkoutCategory, "primary" | "success" | "warning" | "default"> = {
  strength: "primary",
  power: "warning",
  speed: "success",
  conditioning: "default",
};

const categoryIcon: Record<HomeWorkoutCategory, typeof Dumbbell> = {
  strength: Dumbbell,
  power: Zap,
  speed: Footprints,
  conditioning: TimerReset,
};

function WorkoutChoiceCard({
  workout,
  selected,
  onSelect,
}: {
  workout: HomeWorkout;
  selected: boolean;
  onSelect: (workoutId: string) => void;
}) {
  const Icon = categoryIcon[workout.category];
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(workout.id)}
      className={cn(
        "panel group flex min-h-48 flex-col p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/55 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        selected && "border-primary/60 bg-primary/5 ring-1 ring-primary/25",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-4.5" strokeWidth={2.3} />
        </span>
        <Pill tone={categoryTone[workout.category]}>
          {HOME_WORKOUT_CATEGORY_LABELS[workout.category]}
        </Pill>
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{workout.title}</h3>
      <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
        {workout.focus}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" /> {workout.durationMinutes[0]}-{workout.durationMinutes[1]}{" "}
          min
        </span>
        <span className="inline-flex items-center gap-1">
          <Dumbbell className="size-3.5" /> {workout.exercises.length} movements
        </span>
      </div>
    </button>
  );
}

function WarmUpCard() {
  return (
    <SectionCard title="Five-minute warm-up" eyebrow="Use before every session">
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {HOME_WORKOUT_WARM_UP.map((movement, index) => (
          <li key={movement.name} className="rounded-lg border border-border bg-surface-2/55 p-3">
            <p className="label-eyebrow">Step {index + 1}</p>
            <p className="mt-1 text-sm font-semibold">{movement.name}</p>
            <p className="numeric mt-1 text-xs font-semibold text-primary">{movement.dose}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{movement.cue}</p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        For an outdoor speed or power workout, add two progressive 10-meter run-throughs: the first
        easy and the second faster but relaxed.
      </p>
    </SectionCard>
  );
}

function HomeWorkoutsPage() {
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string>(HOME_WORKOUTS[0].id);
  const [level, setLevel] = useState<HomeWorkoutLevel>("starter");
  const [completed, setCompleted] = useState<Set<string>>(() => new Set());
  const selectedWorkoutRef = useRef<HTMLElement>(null);

  const selected = homeWorkoutById(selectedId) ?? HOME_WORKOUTS[0];
  const visibleWorkouts = useMemo(
    () =>
      filter === "all"
        ? HOME_WORKOUTS
        : HOME_WORKOUTS.filter((workout) => workout.category === filter),
    [filter],
  );

  const selectWorkout = (workoutId: string) => {
    setSelectedId(workoutId);
    setCompleted(new Set());
  };

  const openWorkout = (workoutId: string) => {
    selectWorkout(workoutId);
    window.requestAnimationFrame(() => {
      selectedWorkoutRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const chooseFilter = (nextFilter: CategoryFilter) => {
    setFilter(nextFilter);
    if (nextFilter === "all" || selected.category === nextFilter) return;
    const firstMatch = HOME_WORKOUTS.find((workout) => workout.category === nextFilter);
    if (firstMatch) selectWorkout(firstMatch.id);
  };

  const chooseLevel = (nextLevel: HomeWorkoutLevel) => {
    setLevel(nextLevel);
    setCompleted(new Set());
  };

  const toggleMovement = (movementName: string) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(movementName)) next.delete(movementName);
      else next.add(movementName);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="No-Gym Workouts"
        subtitle="Pick any session that matches your goal, space, and available time. No required calendar."
        action={<Pill tone="primary">12 choices</Pill>}
      />

      <SectionCard bodyClassName="space-y-4">
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
          <div>
            <p className="label-eyebrow">IronDesk Athlete</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              Train wherever you are.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Choose bodyweight strength, landing, plyometric, sprint, change-of-direction, or
              jump-rope work. A gym, weights, ball, and video are not required.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MetricTile label="Workouts" value="12" tone="primary" />
            <MetricTile label="Typical" value="15-25" unit="min" tone="success" />
            <MetricTile label="Weights" value="0" tone="warning" />
          </div>
        </div>
        <p className="rounded-lg border border-warning/35 bg-warning/8 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Use a clear, non-slip area and choose clean repetitions over rushing. Stop any movement
          that causes pain, dizziness, or unusual shortness of breath.
        </p>
      </SectionCard>

      <SectionCard title="Choose your workout" eyebrow="Player choice" bodyClassName="space-y-4">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Workout categories">
          {CATEGORY_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={filter === item.value}
              onClick={() => chooseFilter(item.value)}
              className={cn(
                "shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                filter === item.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border-strong bg-surface-2 text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleWorkouts.map((workout) => (
            <WorkoutChoiceCard
              key={workout.id}
              workout={workout}
              selected={selected.id === workout.id}
              onSelect={openWorkout}
            />
          ))}
        </div>
      </SectionCard>

      <section
        ref={selectedWorkoutRef}
        id="selected-home-workout"
        aria-labelledby="selected-home-workout-title"
        className="scroll-mt-20"
      >
        <SectionCard
          title={selected.title}
          eyebrow={HOME_WORKOUT_CATEGORY_LABELS[selected.category]}
          action={
            <Pill tone={categoryTone[selected.category]}>
              <Clock3 className="size-3" /> {selected.durationMinutes[0]}-
              {selected.durationMinutes[1]} min
            </Pill>
          }
          bodyClassName="space-y-4"
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <h2 id="selected-home-workout-title" className="sr-only">
                Selected workout: {selected.title}
              </h2>
              <p className="text-sm leading-relaxed">{selected.focus}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill>
                  <MapPin className="size-3" /> {selected.space}
                </Pill>
                <Pill>
                  <Dumbbell className="size-3" /> {selected.equipment}
                </Pill>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {selected.format} {selected.rest}
              </p>
            </div>

            <div
              className="rounded-lg border border-border bg-surface-2/55 p-1"
              aria-label="Workout level"
            >
              {(["starter", "build"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={level === option}
                  onClick={() => chooseLevel(option)}
                  className={cn(
                    "rounded-md px-4 py-2 text-xs font-bold capitalize transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                    level === option
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">
              {level === "starter" ? "Starter" : "Build"} dose:
            </span>{" "}
            {level === "starter"
              ? "Use the lower amount and learn the movements."
              : "Use the higher amount only while every repetition stays controlled."}
          </div>

          <ol className="space-y-2">
            {selected.exercises.map((exercise, index) => {
              const checked = completed.has(exercise.name);
              return (
                <li
                  key={exercise.name}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border p-3 transition",
                    checked ? "border-success/40 bg-success/8" : "border-border bg-surface-2/45",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`${checked ? "Mark incomplete" : "Mark complete"}: ${exercise.name}`}
                    aria-pressed={checked}
                    onClick={() => toggleMovement(exercise.name)}
                    className={cn(
                      "mt-0.5 flex size-7 items-center justify-center rounded-md border transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                      checked
                        ? "border-success bg-success text-white"
                        : "border-border-strong bg-surface hover:border-primary/60",
                    )}
                  >
                    {checked ? (
                      <Check className="size-4" strokeWidth={3} />
                    ) : (
                      <span className="numeric text-xs font-bold text-muted-foreground">
                        {index + 1}
                      </span>
                    )}
                  </button>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={cn("font-semibold", checked && "text-success")}>
                        {exercise.name}
                      </p>
                      <span className="numeric text-sm font-bold text-primary">
                        {exercise[level]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {exercise.cue}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <ProgressBar
                value={completed.size}
                max={selected.exercises.length}
                tone={completed.size === selected.exercises.length ? "success" : "primary"}
                label={`${completed.size} of ${selected.exercises.length} movements checked`}
                right={`${Math.round((completed.size / selected.exercises.length) * 100)}%`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Finish:</span> {selected.finish}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={completed.size === 0}
              onClick={() => setCompleted(new Set())}
            >
              <RotateCcw className="size-4" /> Reset checks
            </Button>
          </div>
        </SectionCard>
      </section>

      <WarmUpCard />

      <SectionCard title="How this library works" eyebrow="Simple by design">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              icon: Sparkles,
              title: "Pick what fits",
              detail: "Choose any workout based on your goal, space, and available time.",
            },
            {
              icon: Dumbbell,
              title: "Choose your dose",
              detail:
                "Starter and Build change the amount of work, not who is allowed to participate.",
            },
            {
              icon: Check,
              title: "Check it off",
              detail:
                "Use the on-screen list while training. Checkmarks reset when you leave the page.",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-lg border border-border bg-surface-2/45 p-4">
                <Icon className="size-5 text-primary" strokeWidth={2.2} />
                <p className="mt-3 text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

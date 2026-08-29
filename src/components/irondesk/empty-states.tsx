import { Link } from "@tanstack/react-router";
import { Apple, Dumbbell, HeartPulse, LineChart } from "lucide-react";

import { EmptyState } from "@/components/irondesk/primitives";

const startWorkout = (
  <Link
    to="/workout"
    className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
  >
    Start a workout
  </Link>
);

/** Guided first-run state for a clean account with no training rows yet. */
export function DashboardEmptyState() {
  return (
    <EmptyState
      icon={<Dumbbell className="size-8" />}
      title="No training data yet"
      description="Log your first session and IronDesk starts building strain, strength and readiness intelligence from your own numbers. Nothing here is simulated."
      action={startWorkout}
    />
  );
}

export function NutritionEmptyState() {
  return (
    <EmptyState
      icon={<Apple className="size-8" />}
      title="No fuelling data for today"
      description="Set calorie and protein targets in Settings, then log meals to see macro adherence against training load."
      action={
        <Link to="/settings" className="text-sm font-semibold text-primary hover:underline">
          Open Settings
        </Link>
      }
    />
  );
}

export function ProgressEmptyState() {
  return (
    <EmptyState
      icon={<LineChart className="size-8" />}
      title="Not enough history for trends"
      description="Bodyweight, estimated 1RM, tonnage and load ratios appear once you have completed sessions and body metrics on file."
      action={startWorkout}
    />
  );
}

export function RecoveryEmptyState() {
  return (
    <EmptyState
      icon={<HeartPulse className="size-8" />}
      title="No recovery entries yet"
      description="Readiness needs sleep, resting HR and subjective inputs. Add a manual check-in or sync Health Connect evidence; missing values remain unavailable."
      action={startWorkout}
    />
  );
}

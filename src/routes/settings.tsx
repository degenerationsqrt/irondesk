import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/irondesk/app-shell";
import { DataRow, Pill, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth/auth-provider";
import { accountQuery, equipmentCatalogQuery } from "@/lib/irondesk/queries";
import * as repo from "@/lib/irondesk/repo";
import { fromCm, toCm, weightUnit, type Units } from "@/lib/irondesk/units";
import { useIronDeskInvalidate } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — IronDesk Athlete Profile" },
      {
        name: "description",
        content:
          "Manage your IronDesk profile, units, training goals, available equipment, notification and privacy preferences.",
      },
      { property: "og:title", content: "Settings — IronDesk" },
      {
        property: "og:description",
        content: "Profile, units, goals, equipment and privacy controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const GOALS = [
  "strength",
  "hypertrophy",
  "conditioning",
  "recomposition",
  "endurance",
  "sport_performance",
];

function SettingsPage() {
  const { mode, demo, user } = useAuth();
  const invalidate = useIronDeskInvalidate();
  const { data: account } = useQuery({ ...accountQuery, enabled: mode === "live" });
  const { data: catalog } = useQuery({ ...equipmentCatalogQuery, enabled: mode === "live" });
  const {
    data: sampleSummary,
    isLoading: sampleSummaryLoading,
    isError: sampleSummaryError,
    refetch: refetchSampleSummary,
  } = useQuery({
    queryKey: ["irondesk", "live", "sample-data-summary"],
    queryFn: () => repo.getSampleDataSummary(),
    enabled: mode === "live",
  });

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [height, setHeight] = useState("");
  const [dob, setDob] = useState("");
  const [units, setUnits] = useState<Units>("metric");
  const [goal, setGoal] = useState("strength");
  const [days, setDays] = useState(4);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [weeklySummary, setWeeklySummary] = useState(true);
  const [prAlerts, setPrAlerts] = useState(true);
  const [workoutReminders, setWorkoutReminders] = useState(true);
  const [publicProfile, setPublicProfile] = useState(false);
  const [shareAnalytics, setShareAnalytics] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [sampleState, setSampleState] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    const p = account.profile;
    const pref = account.preferences;
    const u: Units = pref?.units === "imperial" ? "imperial" : "metric";
    setUnits(u);
    setDisplayName(p?.display_name ?? "");
    setTimezone(p?.timezone ?? "UTC");
    setHeight(p?.height_cm ? String(fromCm(p.height_cm, u)) : "");
    setDob(p?.date_of_birth ?? "");
    setGoal(pref?.primary_goal ?? "strength");
    setDays(pref?.training_days_per_week ?? 4);
    setCalories(pref?.calorie_target ? String(pref.calorie_target) : "");
    setProtein(pref?.protein_target_g ? String(pref.protein_target_g) : "");
    setWeeklySummary(pref?.notify_weekly_summary ?? true);
    setPrAlerts(pref?.notify_pr_alerts ?? true);
    setWorkoutReminders(pref?.notify_workout_reminders ?? true);
    setPublicProfile(pref?.public_profile ?? false);
    setShareAnalytics(pref?.share_anonymous_analytics ?? false);
    setEquipment(account.equipmentIds ?? []);
  }, [account]);

  const save = async () => {
    setStatus("saving");
    setMessage(null);
    try {
      const parsed = z
        .object({
          displayName: z.string().min(2, "Display name needs at least 2 characters."),
          calories: z.number().int().min(0).max(12000).optional(),
          protein: z.number().int().min(0).max(600).optional(),
        })
        .safeParse({
          displayName,
          ...(calories ? { calories: Number(calories) } : {}),
          ...(protein ? { protein: Number(protein) } : {}),
        });
      if (!parsed.success) throw new Error(parsed.error.issues[0]!.message);

      await repo.updateProfile({
        display_name: displayName.trim(),
        timezone,
        height_cm: height ? Math.round(toCm(Number(height), units)) : null,
        date_of_birth: dob || null,
      });
      await repo.updatePreferences({
        units,
        primary_goal: goal,
        training_days_per_week: days,
        calorie_target: calories ? Number(calories) : null,
        protein_target_g: protein ? Number(protein) : null,
        notify_weekly_summary: weeklySummary,
        notify_pr_alerts: prAlerts,
        notify_workout_reminders: workoutReminders,
        public_profile: publicProfile,
        share_anonymous_analytics: shareAnalytics,
      });
      await repo.setUserEquipment(equipment);
      invalidate();
      setStatus("saved");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save settings.");
      setStatus("error");
    }
  };

  const removeSamples = async () => {
    if (!sampleSummary?.total) return;
    if (
      !window.confirm(
        `Clean up ${sampleSummary.total} records currently marked as samples? Known sample workouts, cardio and body metrics are removed. Nutrition removes only exact IronDesk seed meals; unrecognized meals or any changed day values preserve the day as real data. Recovery is deleted only when it still exactly matches the seed.`,
      )
    )
      return;
    setSampleState("Removing sample data…");
    try {
      const removed = await repo.removeSampleData();
      invalidate();
      await refetchSampleSummary();
      const preserved = removed.preservedNutritionDays + removed.preservedRecoveryEntries;
      const removalParts = [
        `${removed.total} known sample record${removed.total === 1 ? "" : "s"}`,
        `${removed.seedMeals} exact seed meal${removed.seedMeals === 1 ? "" : "s"}`,
      ];
      setSampleState(
        `Removed ${removalParts.join(" and ")}. ${
          preserved
            ? `Preserved ${preserved} changed or unrecognized nutrition/recovery record${preserved === 1 ? "" : "s"} as real data.`
            : "No changed or unrecognized nutrition/recovery records needed preservation."
        }`,
      );
    } catch (caught) {
      setSampleState(caught instanceof Error ? caught.message : "Could not remove sample data.");
    }
  };

  const changeUnits = (next: Units) => {
    if (next === units) return;
    if (height && Number.isFinite(Number(height))) {
      setHeight(String(fromCm(toCm(Number(height), units), next)));
    }
    setUnits(next);
  };

  if (demo) {
    return (
      <div className="space-y-4">
        <PageHeader title="Settings" subtitle="Demo mode — settings are read-only." />
        <SectionCard title="Demo Athlete" eyebrow="Read only">
          <DataRow label="Athlete" value="Demo Athlete" />
          <DataRow label="Units" value="Metric (kg)" />
          <DataRow label="Primary goal" value="Strength" />
          <DataRow label="Training days" value="4 / week" />
          <p className="mt-3 text-xs text-muted-foreground">
            Create an account to edit your profile, store sessions and build real trends.
          </p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle="Profile, units, goals, equipment and privacy."
        action={
          <Button onClick={() => void save()} disabled={status === "saving"}>
            {status === "saving" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}{" "}
            Save
          </Button>
        }
      />

      {status === "saved" && (
        <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          Settings saved.
        </p>
      )}
      {status === "error" && message && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Athlete Profile" eyebrow="Identity">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dn">Display name</Label>
              <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ht">Height ({units === "imperial" ? "in" : "cm"})</Label>
                <Input
                  id="ht"
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="db">Date of birth</Label>
                <Input id="db" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
            </div>
            <DataRow label="Account email" value={user?.email ?? "—"} />
          </div>
        </SectionCard>

        <SectionCard title="Units & Goals" eyebrow="Preferences">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Units</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["metric", "imperial"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => changeUnits(u)}
                    className={`h-10 rounded-md border text-sm font-semibold capitalize transition ${
                      units === u
                        ? "border-primary bg-primary/12 text-primary"
                        : "border-border bg-surface-2"
                    }`}
                  >
                    {u} ({weightUnit(u)})
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Primary goal</Label>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGoal(g)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                      goal === g
                        ? "border-primary bg-primary/12 text-primary"
                        : "border-border bg-surface-2"
                    }`}
                  >
                    {g.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Training days per week: {days}</Label>
              <input
                type="range"
                min={1}
                max={7}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="kc">Calorie target</Label>
                <Input
                  id="kc"
                  type="number"
                  value={calories}
                  onChange={(e) => setCalories(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr">Protein target (g)</Label>
                <Input
                  id="pr"
                  type="number"
                  value={protein}
                  onChange={(e) => setProtein(e.target.value)}
                />
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Equipment" eyebrow="Availability">
          <div className="flex flex-wrap gap-2">
            {(catalog ?? []).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  setEquipment((prev) =>
                    prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                  )
                }
                className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${
                  equipment.includes(item.id)
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border bg-surface-2"
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Equipment availability drives substitution suggestions during training.
          </p>
        </SectionCard>

        <SectionCard title="Notifications & Privacy" eyebrow="Controls">
          <div className="space-y-3">
            {[
              { label: "Weekly summary email", value: weeklySummary, set: setWeeklySummary },
              { label: "PR alerts", value: prAlerts, set: setPrAlerts },
              { label: "Workout reminders", value: workoutReminders, set: setWorkoutReminders },
              { label: "Public profile", value: publicProfile, set: setPublicProfile },
              { label: "Share anonymous analytics", value: shareAnalytics, set: setShareAnalytics },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm">{row.label}</span>
                <Switch checked={row.value} onCheckedChange={row.set} />
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Sample Data" eyebrow="Data integrity">
          <p className="text-sm text-muted-foreground">
            Live analytics exclude rows marked as samples. Cleanup removes known sample workouts,
            cardio and body metrics. On a sample nutrition day, only the three exact seed meals are
            deleted. Other or edited meals, or any change to the day's targets, totals, hydration or
            goal, preserve the day as real data. Macro totals are recalculated from remaining meals
            without resetting those other fields. Recovery is deleted only when every seeded value
            is unchanged; otherwise it is preserved as real data.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {sampleSummaryLoading ? (
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Checking for sample rows…
              </span>
            ) : sampleSummaryError ? (
              <Pill tone="warning">Sample-data status unavailable</Pill>
            ) : sampleSummary?.total ? (
              <>
                <Button variant="destructive" onClick={() => void removeSamples()}>
                  Clean up {sampleSummary.total} sample records
                </Button>
                <span className="text-xs text-muted-foreground">
                  {sampleSummary.workouts} workouts · {sampleSummary.cardio} cardio ·{" "}
                  {sampleSummary.bodyMetrics} body metrics · {sampleSummary.nutritionDays} nutrition
                  · {sampleSummary.recoveryEntries} recovery
                </span>
              </>
            ) : (
              <Pill tone="success">No sample rows found</Pill>
            )}
          </div>
          {sampleState && <p className="mt-2 text-xs text-muted-foreground">{sampleState}</p>}
        </SectionCard>

        <SectionCard
          title="Account"
          eyebrow="Data"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/connections">Connections &amp; Imports</Link>
            </Button>
          }
        >
          <div className="space-y-2">
            <DataRow label="File imports (FIT / TCX / GPX / CSV / JSON / ZIP)" value="Available" />
            <DataRow label="Garmin-compatible export" value="TCX v2" />
            <DataRow label="Device sync" value="Manage in Connections" />
            <DataRow label="Account deletion" value="Not implemented yet" />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Use Connections &amp; Imports to review device-sync access, imported activities and file
            imports. Account deletion is not implemented yet.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

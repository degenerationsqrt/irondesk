import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { equipmentCatalogQuery } from "@/lib/irondesk/queries";
import * as repo from "@/lib/irondesk/repo";
import {
  DEFAULT_UNITS,
  fromCm,
  fromKg,
  resolveUnits,
  toCm,
  toKg,
  weightUnit,
  type Units,
} from "@/lib/irondesk/units";
import { useIronDeskInvalidate } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Set Up Your Athlete Profile — IronDesk" },
      {
        name: "description",
        content:
          "Set units, goals, training frequency, bodyweight and available equipment so IronDesk can program and score your training.",
      },
      { property: "og:title", content: "Athlete Setup — IronDesk" },
      {
        property: "og:description",
        content: "Four quick steps to calibrate your training intelligence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OnboardingPage,
});

const GOALS = [
  ["strength", "Strength"],
  ["hypertrophy", "Hypertrophy"],
  ["conditioning", "Conditioning"],
  ["recomposition", "Recomposition"],
  ["endurance", "Endurance"],
  ["sport_performance", "Sport performance"],
] as const;

const STEPS = ["Identity", "Goals", "Body", "Equipment", "Data"] as const;

function OnboardingPage() {
  const navigate = useNavigate();
  const invalidate = useIronDeskInvalidate();
  const { data: catalog } = useQuery(equipmentCatalogQuery);

  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [units, setUnits] = useState<Units>(DEFAULT_UNITS);
  const [timezone, setTimezone] = useState("UTC");
  const [goal, setGoal] = useState<string>("strength");
  const [days, setDays] = useState(4);
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [dob, setDob] = useState("");
  const [equipment, setEquipment] = useState<string[]>([]);
  const [calorieTarget, setCalorieTarget] = useState("");
  const [proteinTarget, setProteinTarget] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume: prefill from whatever is already stored and jump to the saved step.
  useEffect(() => {
    void (async () => {
      try {
        const account = await repo.getAccount();
        // A bootstrap row used to default to metric before the athlete made a
        // choice. Treat an untouched profile as new, while preserving a saved
        // metric choice once onboarding has actually started or completed.
        const onboardingStarted =
          Boolean(account.profile?.onboarding_completed) ||
          (account.profile?.onboarding_step ?? 0) > 0;
        const accountUnits = onboardingStarted
          ? resolveUnits(account.preferences?.units)
          : DEFAULT_UNITS;
        setUnits(accountUnits);
        if (account.profile) {
          setDisplayName(account.profile.display_name ?? "");
          setTimezone(
            account.profile.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
          );
          if (account.profile.height_cm)
            setHeight(String(fromCm(account.profile.height_cm, accountUnits)));
          if (account.profile.date_of_birth) setDob(account.profile.date_of_birth);
          setStep(Math.min(account.profile.onboarding_step ?? 0, STEPS.length - 1));
        } else {
          setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC");
        }
        if (account.preferences) {
          setGoal(account.preferences.primary_goal ?? "strength");
          setDays(account.preferences.training_days_per_week ?? 4);
          if (account.preferences.calorie_target)
            setCalorieTarget(String(account.preferences.calorie_target));
          if (account.preferences.protein_target_g)
            setProteinTarget(String(account.preferences.protein_target_g));
        }
        setEquipment(account.equipmentIds ?? []);
      } catch {
        /* first-run accounts may not have rows yet; defaults are fine */
      }
    })();
  }, []);

  const saveStep = async (nextStep: number) => {
    setBusy(true);
    setError(null);
    try {
      await repo.updateProfile({
        display_name: displayName.trim() || "Athlete",
        timezone,
        onboarding_step: nextStep,
        ...(height ? { height_cm: Math.round(toCm(Number(height), units)) } : {}),
        ...(dob ? { date_of_birth: dob } : {}),
      });
      await repo.updatePreferences({
        units,
        primary_goal: goal,
        training_days_per_week: days,
        ...(calorieTarget ? { calorie_target: Number(calorieTarget) } : {}),
        ...(proteinTarget ? { protein_target_g: Number(proteinTarget) } : {}),
      });
      if (step === 3) await repo.setUserEquipment(equipment);
      if (step === 2 && weight)
        await repo.addBodyMetric({ weightKg: toKg(Number(weight), units), note: notes });
      setStep(nextStep);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save your setup.");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = z
        .object({ displayName: z.string().min(2, "Enter your display name.") })
        .safeParse({ displayName });
      if (!parsed.success) {
        setStep(0);
        throw new Error(parsed.error.issues[0]!.message);
      }
      await repo.updateProfile({ onboarding_completed: true, onboarding_step: STEPS.length });
      invalidate();
      void navigate({ to: "/" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  };

  const toggleEquipment = (id: string) =>
    setEquipment((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const changeUnits = (next: Units) => {
    if (next === units) return;
    if (weight && Number.isFinite(Number(weight))) {
      setWeight(String(fromKg(toKg(Number(weight), units), next)));
    }
    if (height && Number.isFinite(Number(height))) {
      setHeight(String(fromCm(toCm(Number(height), units), next)));
    }
    setUnits(next);
  };

  return (
    <div className="grid-fade min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-center font-display text-2xl font-extrabold uppercase tracking-[0.18em]">
          Iron<span className="text-primary">Desk</span>
        </p>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Calibrate your training intelligence.
        </p>

        <div className="mt-6 flex items-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1 rounded-full ${i <= step ? "bg-primary" : "bg-surface-3"}`} />
              <p
                className={`mt-1.5 text-[0.625rem] font-bold uppercase tracking-widest ${i === step ? "text-primary" : "text-muted-foreground"}`}
              >
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="panel mt-4 space-y-4 p-5">
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Units</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["metric", "imperial"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => changeUnits(u)}
                      className={`h-11 rounded-md border text-sm font-semibold capitalize transition ${
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
                <Label htmlFor="tz">Timezone</Label>
                <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-1.5">
                <Label>Primary goal</Label>
                <div className="grid grid-cols-2 gap-2">
                  {GOALS.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGoal(value)}
                      className={`h-11 rounded-md border text-sm font-semibold transition ${
                        goal === value
                          ? "border-primary bg-primary/12 text-primary"
                          : "border-border bg-surface-2"
                      }`}
                    >
                      {label}
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
                  <Label htmlFor="kcal">Calorie target (optional)</Label>
                  <Input
                    id="kcal"
                    type="number"
                    value={calorieTarget}
                    onChange={(e) => setCalorieTarget(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="protein">Protein target g (optional)</Label>
                  <Input
                    id="protein"
                    type="number"
                    value={proteinTarget}
                    onChange={(e) => setProteinTarget(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bw">Bodyweight ({weightUnit(units)})</Label>
                  <Input
                    id="bw"
                    type="number"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ht">Height {units === "imperial" ? "in" : "cm"} (optional)</Label>
                  <Input
                    id="ht"
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dob">Date of birth (optional)</Label>
                <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="note">Baseline note (optional)</Label>
                <Textarea
                  id="note"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Injuries, current block, competition date…"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-1.5">
              <Label>Available equipment</Label>
              <div className="flex flex-wrap gap-2">
                {(catalog ?? []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleEquipment(item.id)}
                    className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${
                      equipment.includes(item.id)
                        ? "border-primary bg-primary/12 text-primary"
                        : "border-border bg-surface-2"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
                {(catalog ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Loading equipment…</p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="rounded-lg border border-success/35 bg-success/10 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <Check className="size-4" /> Start clean
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Your account starts with no fake sessions or wellness entries. Every number in
                Today, History, Progress, and Recovery will come from your own training, check-ins,
                or connected imports.
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button
              variant="ghost"
              disabled={step === 0 || busy}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              <ChevronLeft className="size-4" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button disabled={busy} onClick={() => void saveStep(step + 1)}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Continue{" "}
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void complete()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Enter IronDesk
              </Button>
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Everything here is editable later in Settings.
        </p>
      </div>
    </div>
  );
}

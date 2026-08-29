import { Bike, Loader2, Plus, Save, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CARDIO_ACTIVITY_TYPES,
  cardioDistanceUnit,
  normalizeCardioLog,
  type CardioActivityType,
  type ManualCardioInput,
} from "@/lib/irondesk/cardio-log";
import { localDateTimeValueForInstant } from "@/lib/irondesk/dates";
import { useUnits } from "@/lib/irondesk/use-units";

interface CardioFormState {
  activityType: CardioActivityType;
  customName: string;
  localStartedAt: string;
  durationMin: string;
  distance: string;
  calories: string;
  avgHr: string;
  maxHr: string;
  activeZoneMinutes: string;
  cardioLoad: string;
  notes: string;
}

function initialState(timeZone: string): CardioFormState {
  return {
    activityType: "Run",
    customName: "",
    localStartedAt: localDateTimeValueForInstant(new Date(), timeZone),
    durationMin: "",
    distance: "",
    calories: "",
    avgHr: "",
    maxHr: "",
    activeZoneMinutes: "",
    cardioLoad: "",
    notes: "",
  };
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function Field({
  id,
  label,
  value,
  onChange,
  suffix,
  step = "1",
  required,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  step?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
      />
    </label>
  );
}

export function CardioLogForm({
  live,
  timeZone,
  onSave,
}: {
  live: boolean;
  timeZone: string;
  onSave: (input: ManualCardioInput) => Promise<void>;
}) {
  const units = useUnits();
  const distanceUnit = cardioDistanceUnit(units);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CardioFormState>(() => initialState(timeZone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const set = (patch: Partial<CardioFormState>) =>
    setState((current) => ({ ...current, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!live || busy) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const input = normalizeCardioLog(
        {
          activityType: state.activityType,
          customName: state.customName,
          localStartedAt: state.localStartedAt,
          durationMin: numberOrNull(state.durationMin),
          distance: numberOrNull(state.distance),
          calories: numberOrNull(state.calories),
          avgHr: numberOrNull(state.avgHr),
          maxHr: numberOrNull(state.maxHr),
          activeZoneMinutes: numberOrNull(state.activeZoneMinutes),
          cardioLoad: numberOrNull(state.cardioLoad),
          notes: state.notes,
        },
        units,
        timeZone,
      );
      await onSave(input);
      setSuccess(`${input.name} saved. It is now included in Today and History.`);
      setState(initialState(timeZone));
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save that cardio activity.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Log Cardio"
      eyebrow="Completed activity"
      action={
        <Button
          type="button"
          size="sm"
          variant={open ? "ghost" : "secondary"}
          disabled={busy}
          onClick={() => {
            setOpen((current) => !current);
            setError(null);
            setSuccess(null);
          }}
        >
          {open ? <X className="size-4" /> : <Plus className="size-4" />}
          {open ? "Close" : "Log cardio"}
        </Button>
      }
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/12 p-2.5 text-primary">
          <Bike className="size-5" />
        </div>
        <div>
          <p className="text-sm font-semibold">
            Save a run, ride or other finished cardio session.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This creates one completed cardio activity—not a strength workout with sets, reps and
            RPE.
          </p>
        </div>
      </div>

      {!live ? (
        <p className="mt-3 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
          Read-only preview. Explore the cardio fields below; sign in to edit or save an activity.
          Types include Run, Ride, Walk / Hike, Rower, Elliptical, Stair, Swim, HIIT and Other.
        </p>
      ) : null}
      {success ? (
        <p
          className="mt-3 rounded-md border border-success/35 bg-success/10 px-3 py-2 text-sm text-success"
          role="status"
        >
          {success}
        </p>
      ) : null}

      {open ? (
        <form
          className="mt-4 space-y-4 border-t border-border pt-4"
          onSubmit={(event) => void submit(event)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="cardio-type" className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Activity</span>
              <Select
                value={state.activityType}
                onValueChange={(value) => set({ activityType: value as CardioActivityType })}
                disabled={!live}
              >
                <SelectTrigger id="cardio-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARDIO_ACTIVITY_TYPES.map((activity) => (
                    <SelectItem key={activity} value={activity}>
                      {activity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {state.activityType === "Other" ? (
              <label htmlFor="cardio-name" className="space-y-1.5">
                <span className="text-xs font-semibold text-muted-foreground">Activity name</span>
                <Input
                  id="cardio-name"
                  value={state.customName}
                  onChange={(event) => set({ customName: event.target.value })}
                  placeholder="Kayaking"
                  maxLength={80}
                  required
                  disabled={!live}
                />
              </label>
            ) : null}
            <label htmlFor="cardio-started-at" className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">
                Date and start time
              </span>
              <Input
                id="cardio-started-at"
                type="datetime-local"
                value={state.localStartedAt}
                onChange={(event) => set({ localStartedAt: event.target.value })}
                required
                disabled={!live}
              />
              <span className="block text-[0.6875rem] text-muted-foreground">
                Profile timezone: {timeZone}
              </span>
            </label>
            <Field
              id="cardio-duration"
              label="Duration"
              suffix="minutes"
              value={state.durationMin}
              onChange={(durationMin) => set({ durationMin })}
              required
              disabled={!live}
            />
            <Field
              id="cardio-distance"
              label="Distance"
              suffix={distanceUnit}
              step="0.01"
              value={state.distance}
              onChange={(distance) => set({ distance })}
              disabled={!live}
            />
            <Field
              id="cardio-calories"
              label="Calories"
              suffix="kcal"
              value={state.calories}
              onChange={(calories) => set({ calories })}
              disabled={!live}
            />
            <Field
              id="cardio-avg-hr"
              label="Average heart rate"
              suffix="bpm"
              value={state.avgHr}
              onChange={(avgHr) => set({ avgHr })}
              disabled={!live}
            />
            <Field
              id="cardio-max-hr"
              label="Maximum heart rate"
              suffix="bpm"
              value={state.maxHr}
              onChange={(maxHr) => set({ maxHr })}
              disabled={!live}
            />
            <Field
              id="cardio-zone-minutes"
              label="Active-zone minutes"
              value={state.activeZoneMinutes}
              onChange={(activeZoneMinutes) => set({ activeZoneMinutes })}
              disabled={!live}
            />
            <div>
              <Field
                id="cardio-load"
                label="Measured cardio load"
                value={state.cardioLoad}
                onChange={(cardioLoad) => set({ cardioLoad })}
                disabled={!live}
              />
              <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                Optional. Copy a measured load from your watch or machine; IronDesk will not
                estimate it.
              </p>
            </div>
          </div>

          <label htmlFor="cardio-notes" className="block space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Notes</span>
            <Textarea
              id="cardio-notes"
              value={state.notes}
              onChange={(event) => set({ notes: event.target.value })}
              placeholder="Route, intervals, terrain, how it felt…"
              maxLength={2_000}
              rows={3}
              disabled={!live}
            />
          </label>

          {error ? (
            <p
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy || !live} className="w-full sm:w-auto">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save cardio activity"}
          </Button>
        </form>
      ) : null}
    </SectionCard>
  );
}

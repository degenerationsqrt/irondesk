const ANCHOR_PLANS = Object.freeze({
  Shoulders: { lift: "ohp", exercises: ["Standing Military Press", "Overhead Press"] },
  Back: { lift: "deadlift", exercises: ["Deadlift", "Barbell Row"] },
  Chest: { lift: "bench", exercises: ["Bench Press", "Incline Barbell Press"] },
  Legs: { lift: "squat", exercises: ["Back Squat", "Front Squat"] },
  Glutes: { lift: "squat", exercises: ["Back Squat", "Front Squat"] },
  Arms: { lift: "bench", exercises: ["Close-Grip Bench Press"] },
  Upper: { lift: "bench", exercises: ["Bench Press", "Incline Barbell Press"] },
  Lower: { lift: "squat", exercises: ["Back Squat", "Front Squat"] },
  FullBody: { lift: "squat", exercises: ["Back Squat", "Front Squat"] },
  Push: { lift: "bench", exercises: ["Bench Press", "Close-Grip Bench Press"] },
  Pull: { lift: "deadlift", exercises: ["Deadlift", "Barbell Row"] },
  Delts: { lift: "ohp", exercises: ["Standing Military Press"] },
  Cond: { lift: "deadlift", exercises: ["Barbell Row"] },
});

const FINISHER_PLANS = Object.freeze({
  Shoulders: {
    home: ["Lateral Raises", "DB Rear Lateral Raise", "Band Pull-Apart"],
    gym: ["Cable Lateral Raise", "Cable Rear Delt Fly", "Face Pull"],
  },
  Back: {
    home: ["Band Row", "Reverse Shrug", "One-Arm DB Row"],
    gym: ["Straight-Arm Pulldown", "Face Pull", "Seated Cable Row"],
  },
  Chest: {
    home: ["DB Fly", "Push-Up (weighted)", "Neutral-Grip DB Press"],
    gym: ["High Cable Fly", "Pec-Deck Fly", "Machine Incline Press"],
  },
  Legs: {
    home: ["Walking Lunge", "Nordic Curl", "Single-Leg Calf Raise"],
    gym: ["Leg Extension", "Seated Leg Curl", "Seated Calf Raise"],
  },
  Glutes: {
    home: ["Banded Kickback", "Glute Bridge", "Nordic Curl"],
    gym: ["Cable Kickback", "Hip Abduction Machine", "Seated Leg Curl"],
  },
  Arms: {
    home: ["Skullcrusher", "Hammer Curl", "Concentration Curl"],
    gym: ["Cable Pushdown", "Cable Curl", "Cable Kickback"],
  },
  Upper: {
    home: ["DB Fly", "Band Row", "Lateral Raises"],
    gym: ["High Cable Fly", "Straight-Arm Pulldown", "Cable Lateral Raise"],
  },
  Lower: {
    home: ["Walking Lunge", "Nordic Curl", "Single-Leg Calf Raise"],
    gym: ["Leg Extension", "Lying Leg Curl", "Calf Machine Raise"],
  },
  FullBody: {
    home: ["Push-Up (weighted)", "Band Row", "Walking Lunge"],
    gym: ["Pec-Deck Fly", "Straight-Arm Pulldown", "Leg Extension"],
  },
  Push: {
    home: ["DB Fly", "Lateral Raises", "Overhead Tricep Ext"],
    gym: ["High Cable Fly", "Cable Lateral Raise", "Cable Pushdown"],
  },
  Pull: {
    home: ["Band Row", "DB Rear Lateral Raise", "Hammer Curl"],
    gym: ["Straight-Arm Pulldown", "Face Pull", "Cable Curl"],
  },
  Delts: {
    home: ["Lateral Raises", "DB Rear Lateral Raise", "Band Pull-Apart"],
    gym: ["Cable Lateral Raise", "Cable Rear Delt Fly", "Face Pull"],
  },
  Cond: {
    home: ["Walking Lunge", "Lateral Raises", "Band Pull-Apart"],
    gym: ["Leg Extension", "Cable Lateral Raise", "Face Pull"],
  },
});

const ANCHOR_PRESCRIPTIONS = Object.freeze({
  strength: { sets: 4, reps: 5, pct: 0.85 },
  hypertrophy: { sets: 3, reps: 5, pct: 0.82 },
  tone: { sets: 3, reps: 6, pct: 0.78 },
});

export const READINESS_LEVELS = Object.freeze({
  normal: {
    label: "Ready",
    short: "Full plan",
    description: "Keep the anchor load and all three pump rounds.",
  },
  reduced: {
    label: "Manage fatigue",
    short: "2 pump rounds",
    description: "Keep strength work; trim the finisher before intensity.",
  },
  recovery: {
    label: "Recovery",
    short: "Back off",
    description: "Reduce the anchor 10%, trim work sets, and skip the finisher.",
  },
});

export const GENERATED_FOCUS_KEYS = Object.freeze(Object.keys(ANCHOR_PLANS));

function normalizedMode(mode) {
  return mode === "gym" ? "gym" : "home";
}

function safeSeed(value) {
  const seed = Number(value);
  return Number.isFinite(seed) ? Math.trunc(seed) : 0;
}

function pick(values, seed) {
  return values[((safeSeed(seed) % values.length) + values.length) % values.length];
}

function roundedLoad(value, increment) {
  const load = Number(value);
  const step = Number(increment) > 0 ? Number(increment) : 5;
  if (!Number.isFinite(load) || load <= 0) return 0;
  return Math.round(load / step) * step;
}

function sessionTimestamp(session) {
  const recorded = Number(session?.completedAt || session?.startedAt);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  const parsed = Date.parse(String(session?.date || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestProgressionForAnchor(sessions, lift, exercise) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter(session => (
      session?.anchorProgression?.lift === lift
      && (!exercise || session.anchorProgression.exercise === exercise)
    ))
    .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))[0]
    ?.anchorProgression || null;
}

export function anchorPlanForFocus(focusKey, seed = 0) {
  const plan = ANCHOR_PLANS[focusKey] || ANCHOR_PLANS.Upper;
  return {
    lift: plan.lift,
    exercise: pick(plan.exercises, seed),
  };
}

export function anchorPrescription(style, deload = false) {
  const base = ANCHOR_PRESCRIPTIONS[style] || ANCHOR_PRESCRIPTIONS.hypertrophy;
  return {
    sets: deload ? Math.max(2, base.sets - 1) : base.sets,
    reps: base.reps,
    pct: deload ? base.pct * 0.85 : base.pct,
  };
}

export function pumpFinisherRows(focusKey, mode, deload = false) {
  const plan = FINISHER_PLANS[focusKey] || FINISHER_PLANS.Upper;
  const exercises = plan[normalizedMode(mode)];
  return exercises.map((exercise, index) => ({
    ex: exercise,
    role: "finisher",
    lift: null,
    db: /\bDB\b|Dumbbell/i.test(exercise),
    heavy: false,
    drop: false,
    sets: deload ? 2 : 3,
    reps: deload ? 15 : 20,
    target: null,
    circuitId: "pump",
    circuitOrder: index + 1,
    restSeconds: 45,
    note: "Pump circuit · move to the next exercise · 30–45s rest",
  }));
}

export function readinessSuggestionFromSleep(sleepMinutes) {
  const minutes = Number(sleepMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return {
      level: "normal",
      reason: "No recent sleep value. Choose from soreness, energy, and warm-up performance.",
    };
  }
  if (minutes < 360) {
    return {
      level: "recovery",
      reason: `Only ${Math.round(minutes / 6) / 10}h sleep was imported. Back off unless your warm-up feels unusually good.`,
    };
  }
  if (minutes < 420) {
    return {
      level: "reduced",
      reason: `${Math.round(minutes / 6) / 10}h sleep was imported. Keep the anchor and trim pump volume.`,
    };
  }
  return {
    level: "normal",
    reason: `${Math.round(minutes / 6) / 10}h sleep supports the full plan if soreness and warm-ups also feel normal.`,
  };
}

function resizedSets(entry, count, target) {
  const current = Array.isArray(entry?.sets) ? entry.sets : [];
  const fallbackWeight = entry?.heavy ? target || "" : current[0]?.w || "";
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    w: current[index]?.w ?? fallbackWeight,
    r: current[index]?.r ?? entry?.targetReps ?? 0,
    done: false,
  }));
}

export function applyWorkoutReadiness(workout, requestedLevel) {
  if (!workout || !Array.isArray(workout.entries)) return workout;
  const level = READINESS_LEVELS[requestedLevel] ? requestedLevel : "normal";
  const hasLoggedSet = workout.entries.some(entry => (
    Array.isArray(entry?.sets) && entry.sets.some(set => set?.done)
  ));
  if (hasLoggedSet) return workout;

  const loadIncrement = Number(workout.loadIncrement) || 5;
  return {
    ...workout,
    readiness: level,
    entries: workout.entries.map((entry) => {
      const baseSetCount = Math.max(
        0,
        Number(entry?.baseSetCount ?? entry?.plannedSetCount ?? entry?.sets?.length) || 0,
      );
      const baseTarget = Number(entry?.baseTarget ?? entry?.target) || 0;
      let nextSetCount = baseSetCount;
      let nextTarget = baseTarget;
      let readinessSkipped = false;

      if (entry?.role === "finisher") {
        nextSetCount = level === "normal" ? baseSetCount : level === "reduced" ? 2 : 0;
        readinessSkipped = nextSetCount === 0;
      } else if (level === "recovery" && entry?.heavy) {
        nextSetCount = Math.max(2, baseSetCount - 1);
        nextTarget = roundedLoad(baseTarget * 0.9, loadIncrement);
      } else if (level === "recovery" && ["acc", "iso"].includes(entry?.role)) {
        nextSetCount = Math.max(2, baseSetCount - 1);
      }

      return {
        ...entry,
        baseSetCount,
        baseTarget,
        target: nextTarget || null,
        plannedSetCount: nextSetCount,
        readinessSkipped,
        sets: resizedSets(entry, nextSetCount, nextTarget),
      };
    }),
  };
}

export function progressedAnchorTarget(baseTarget, lift, exercise, sessions, increment = 5) {
  const baseline = Number(baseTarget);
  if (!Number.isFinite(baseline) || baseline <= 0) return 0;
  const previous = latestProgressionForAnchor(sessions, lift, exercise);
  const nextLoad = Number(previous?.nextLoad);
  const previousBaseline = Number(previous?.baseTarget);
  if (!Number.isFinite(nextLoad) || nextLoad <= 0) return roundedLoad(baseline, increment);
  if (
    Number.isFinite(previousBaseline)
    && previousBaseline > 0
    && Math.abs(previousBaseline - baseline) / baseline > 0.12
  ) return roundedLoad(baseline, increment);
  if (nextLoad < baseline * 0.7 || nextLoad > baseline * 1.3) {
    return roundedLoad(baseline, increment);
  }
  return roundedLoad(nextLoad, increment);
}

export function evaluateAnchorProgression(workout, sessions = []) {
  const anchor = workout?.entries?.find(entry => entry?.heavy && entry?.lift);
  const target = Number(anchor?.target);
  if (!anchor || !Number.isFinite(target) || target <= 0) return null;

  const plannedSets = Math.max(1, Number(anchor.plannedSetCount) || anchor.sets.length || 1);
  const targetReps = Math.max(1, Number(anchor.targetReps) || 1);
  const completedSets = (Array.isArray(anchor.sets) ? anchor.sets : []).filter(set => set?.done);
  const baseTarget = Number(anchor.baseTarget) || target;
  const increment = ["squat", "deadlift"].includes(anchor.lift) ? 10 : 5;
  const loadIncrement = Number(workout.loadIncrement) || 5;
  const completedCleanly = completedSets.length >= plannedSets && completedSets.every(set => (
    Number(set?.r) >= targetReps && Number(set?.w) >= target
  ));

  if (workout.readiness === "recovery") {
    return {
      lift: anchor.lift,
      exercise: anchor.ex,
      status: "hold",
      baseTarget,
      completedSets: completedSets.length,
      plannedSets,
      nextLoad: roundedLoad(baseTarget, loadIncrement),
      message: "Recovery session recorded — keep the normal anchor load next time.",
    };
  }

  if (completedCleanly) {
    return {
      lift: anchor.lift,
      exercise: anchor.ex,
      status: "increase",
      baseTarget,
      completedSets: completedSets.length,
      plannedSets,
      nextLoad: roundedLoad(target + increment, loadIncrement),
      message: `All anchor sets complete — add ${increment} lb next time.`,
    };
  }

  const previous = latestProgressionForAnchor(sessions, anchor.lift, anchor.ex);
  const repeatedMiss = previous?.status === "repeat";
  const status = repeatedMiss ? "reset" : "repeat";
  const nextLoad = repeatedMiss
    ? roundedLoad(target * 0.95, loadIncrement)
    : roundedLoad(target, loadIncrement);
  return {
    lift: anchor.lift,
    exercise: anchor.ex,
    status,
    baseTarget,
    completedSets: completedSets.length,
    plannedSets,
    nextLoad,
    message: repeatedMiss
      ? "Two anchor misses — reset 5% and build back with clean reps."
      : "Anchor target not completed — repeat the load next time.",
  };
}

import React from "react";
import * as Recharts from "recharts";
import { App } from "@capacitor/app";
import firebase from "firebase/compat/app";
import "firebase/compat/auth";
import "firebase/compat/firestore";
import {
  epley,
  estimatedMaxForSet,
  isValidE1RMSet,
  localDateKey,
  weightForReps as wForReps,
  workoutVolume,
} from "./trainingMath.js";
import {
  DEFAULT_REST_TIMER_PREFS,
  filterAndSortSessions,
  normalizeActiveWorkout,
  normalizeRestTimerPrefs,
  normalizeSessionHistory,
  removeLastWorkoutSet,
  restDurationForEntry,
  safeSessionVolume,
  sessionsToCsv,
  sessionsToGarminCsv,
  summarizeSessions,
} from "./workoutUtilities.js";
import {
  garminMetricItems,
  mergeGarminSessions,
  parseGarminCsv,
  parseGarminFit,
} from "./garminImport.js";
import {
  CLOUD_SYNC_PREF_KEY,
  buildPersonalState,
  createCloudEnvelope,
  getOrCreateCloudDeviceId,
  mergePersonalStates,
  personalStateHash,
  recordTombstoneKey,
} from "./cloudSync.js";
import { HealthConnectPanel } from "./HealthConnectPanel.jsx";
import { AppUpdateBanner } from "./AppUpdateBanner.jsx";
import { ExerciseGuide } from "./ExerciseGuide.jsx";
import { PrimaryNavigation } from "./PrimaryNavigation.jsx";
import {
  HEALTH_CONNECT_AUTO_SYNC_KEY,
  HEALTH_CONNECT_LAST_SYNC_KEY,
  HEALTH_CONNECT_WRITE_ENABLED_KEY,
  healthSyncSummary,
  isNativeHealthConnect,
  mergeHealthBodyweight,
  mergeHealthSummaries,
  performHealthConnectSync,
  writeWorkoutToHealthConnect,
} from "./healthConnect.js";
import {
  HEALTH_TREND_METRICS,
  healthTrendSeries,
  latestHealthValue,
  mergeCardioTrendRecords,
  weekStartKey,
} from "./trendData.js";
import {
  buildTrackedSession,
  sessionTypeLabel,
  trackedSessionSummary,
} from "./trainingSessions.js";
import {
  advanceWorkoutProgress,
  resolveWorkoutDayIndex,
  selectWorkoutDay,
} from "./workoutSchedule.js";
import { normalizeGender, normalizeGoal, normalizeWorkoutProgress } from "./profileState.js";

const GarminBridge = React.lazy(() =>
  import("./GarminBridge.jsx").then((module) => ({ default: module.GarminBridge })));

const firebaseConfig = {
  apiKey: "AIzaSyCahMEkIle_yGm74AZv1271Q7uGLi6Tu6k",
  authDomain: "irondesk-54651.firebaseapp.com",
  projectId: "irondesk-54651",
  storageBucket: "irondesk-54651.firebasestorage.app",
  messagingSenderId: "719297846505",
  appId: "1:719297846505:web:73d891e9ae812f6a886478"
};

try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
} catch {}
window.firebase = firebase;
var useState = React.useState,
  useEffect = React.useEffect,
  useMemo = React.useMemo,
  useRef = React.useRef;
var RC = Recharts;
function ChartStub() {
  return React.createElement('div', {
    style: {
      color: '#8a8a93',
      fontSize: 13,
      textAlign: 'center',
      padding: '14px 0'
    }
  }, '(chart unavailable offline)');
}
var LineChart = RC.LineChart || ChartStub,
  Line = RC.Line || function () {
    return null;
  };
var BarChart = RC.BarChart || ChartStub,
  Bar = RC.Bar || function () {
    return null;
  };
var XAxis = RC.XAxis || function () {
    return null;
  },
  YAxis = RC.YAxis || function () {
    return null;
  };
var Tooltip = RC.Tooltip || function () {
    return null;
  },
  CartesianGrid = RC.CartesianGrid || function () {
    return null;
  };
var ResponsiveContainer = RC.ResponsiveContainer || function (p) {
  return React.createElement('div', null, p.children);
};
window.storage = {
  get: function (k) {
    var v = localStorage.getItem(k);
    return Promise.resolve(v == null ? null : {
      key: k,
      value: v
    });
  },
  set: function (k, v) {
    localStorage.setItem(k, v);
    return Promise.resolve({
      key: k,
      value: v
    });
  }
};

/* ============ MATH ============ */
const today = () => localDateKey();
const uid = () => crypto.randomUUID();
function downloadFile(contents, filename, type) {
  const blob = new Blob([contents], {
    type
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function solveLoadout(targetTotal, bar, pairs) {
  const perSide = Math.max(0, (targetTotal - bar) / 2);
  const denoms = pairs.filter(p => p.weight > 0 && Math.floor(p.count / 2) > 0).map(p => ({
    w: p.weight,
    n: Math.floor(p.count / 2)
  })).sort((a, b) => b.w - a.w);
  let best = {
    sum: 0,
    combo: []
  };
  const maxD = denoms.reduce((a, d) => Math.max(a, d.w), 0);
  const go = (i, sum, combo) => {
    if (Math.abs(sum - perSide) < Math.abs(best.sum - perSide)) best = {
      sum,
      combo: [...combo]
    };
    if (i >= denoms.length || sum > perSide + maxD) return;
    for (let k = denoms[i].n; k >= 0; k--) go(i + 1, sum + k * denoms[i].w, [...combo, ...Array(k).fill(denoms[i].w)]);
  };
  go(0, 0, []);
  const counts = {};
  best.combo.forEach(w => counts[w] = (counts[w] || 0) + 1);
  return {
    total: bar + best.sum * 2,
    counts
  };
}

/* ============ DATA ============ */
const LIFTS = [{
  key: "bench",
  name: "Bench Press"
}, {
  key: "squat",
  name: "Squat"
}, {
  key: "ohp",
  name: "Overhead Press"
}, {
  key: "deadlift",
  name: "Deadlift"
}];
const LIFT_COLORS = {
  bench: "#e11d2a",
  squat: "#d9a441",
  ohp: "#3b9ae1",
  deadlift: "#4ade80"
};
const D_MAXES = {
  bench: 0,
  squat: 0,
  ohp: 0,
  deadlift: 0
};
const D_HOME = [{
  weight: 45,
  count: 6
}, {
  weight: 55,
  count: 2
}, {
  weight: 35,
  count: 2
}, {
  weight: 25,
  count: 4
}, {
  weight: 10,
  count: 2
}, {
  weight: 5,
  count: 0
}, {
  weight: 2.5,
  count: 0
}];
const D_GYM = [{
  weight: 45,
  count: 20
}, {
  weight: 35,
  count: 4
}, {
  weight: 25,
  count: 6
}, {
  weight: 10,
  count: 6
}, {
  weight: 5,
  count: 4
}, {
  weight: 2.5,
  count: 4
}];
const mk = (ex, sets, reps, opts = {}) => ({
  ex,
  sets,
  reps,
  ...opts
});
/* ============ GOAL-DRIVEN ENGINE ============ */
/* Merged movement library. eq: where the move is doable — "both" | "gym" | "home" */
const LIB = {
  Shoulders: [{
    n: "Lateral Raises",
    eq: "both"
  }, {
    n: "DB Arnold Press",
    eq: "both"
  }, {
    n: "Military Press",
    eq: "both"
  }, {
    n: "Front Raise",
    eq: "both"
  }, {
    n: "Upright Row",
    eq: "both"
  }, {
    n: "Shoulder Shrugs",
    eq: "both"
  }, {
    n: "Cable Lateral Raise",
    eq: "gym"
  }, {
    n: "Cable Rear Delt Fly",
    eq: "gym"
  }, {
    n: "Reverse Pec Deck",
    eq: "gym"
  }, {
    n: "DB Rear Lateral Raise",
    eq: "both"
  }, {
    n: "Reverse Fly (incline)",
    eq: "both"
  }],
  Chest: [{
    n: "Incline DB Press",
    eq: "both"
  }, {
    n: "Flat DB Press",
    eq: "both"
  }, {
    n: "Decline DB Press",
    eq: "both"
  }, {
    n: "DB Fly",
    eq: "both"
  }, {
    n: "Neutral-Grip DB Press",
    eq: "both"
  }, {
    n: "Push-Up (weighted)",
    eq: "home"
  }, {
    n: "Leverage Incline Press",
    eq: "gym"
  }, {
    n: "High Cable Fly",
    eq: "gym"
  }, {
    n: "Pec-Deck Fly",
    eq: "gym"
  }, {
    n: "Machine Incline Press",
    eq: "gym"
  }],
  Back: [{
    n: "Bent-Over Row",
    eq: "both"
  }, {
    n: "One-Arm DB Row",
    eq: "both"
  }, {
    n: "Pull-up",
    eq: "both"
  }, {
    n: "Neutral-Grip Pull-up",
    eq: "both"
  }, {
    n: "Reverse Shrug",
    eq: "both"
  }, {
    n: "Band Row",
    eq: "home"
  }, {
    n: "Lat Pulldown",
    eq: "gym"
  }, {
    n: "Seated Cable Row",
    eq: "gym"
  }, {
    n: "Straight-Arm Pulldown",
    eq: "gym"
  }, {
    n: "Close-Grip Pulldown",
    eq: "gym"
  }],
  Legs: [{
    n: "Back Squat",
    eq: "both"
  }, {
    n: "Front Squat",
    eq: "both"
  }, {
    n: "Goblet Squat",
    eq: "both"
  }, {
    n: "Walking Lunge",
    eq: "both"
  }, {
    n: "Bulgarian Split Squat",
    eq: "both"
  }, {
    n: "Step-Up",
    eq: "both"
  }, {
    n: "Leg Press",
    eq: "gym"
  }, {
    n: "Hack Squat",
    eq: "gym"
  }, {
    n: "Leg Extension",
    eq: "gym"
  }, {
    n: "Smith Lunge",
    eq: "gym"
  }],
  Glutes: [{
    n: "Hip Thrust",
    eq: "both"
  }, {
    n: "Glute Bridge",
    eq: "both"
  }, {
    n: "Sumo Squat",
    eq: "both"
  }, {
    n: "Romanian Deadlift",
    eq: "both"
  }, {
    n: "Curtsy Lunge",
    eq: "both"
  }, {
    n: "Banded Kickback",
    eq: "home"
  }, {
    n: "Cable Kickback",
    eq: "gym"
  }, {
    n: "Hip Abduction Machine",
    eq: "gym"
  }, {
    n: "Smith Hip Thrust",
    eq: "gym"
  }],
  Hams: [{
    n: "Romanian Deadlift",
    eq: "both"
  }, {
    n: "Stiff-Leg Deadlift",
    eq: "both"
  }, {
    n: "Good Morning",
    eq: "both"
  }, {
    n: "Nordic Curl",
    eq: "home"
  }, {
    n: "Lying Leg Curl",
    eq: "gym"
  }, {
    n: "Seated Leg Curl",
    eq: "gym"
  }],
  Arms: [{
    n: "EZ Bar Curl",
    eq: "both"
  }, {
    n: "Hammer Curl",
    eq: "both"
  }, {
    n: "Wide-Grip Curl",
    eq: "both"
  }, {
    n: "Skullcrusher",
    eq: "both"
  }, {
    n: "Overhead Tricep Ext",
    eq: "both"
  }, {
    n: "Concentration Curl",
    eq: "both"
  }, {
    n: "Cable Pushdown",
    eq: "gym"
  }, {
    n: "Cable Curl",
    eq: "gym"
  }, {
    n: "Cable Kickback",
    eq: "gym"
  }],
  Calves: [{
    n: "Standing Calf Raise",
    eq: "both"
  }, {
    n: "Single-Leg Calf Raise",
    eq: "both"
  }, {
    n: "Calf Machine Raise",
    eq: "gym"
  }, {
    n: "Seated Calf Raise",
    eq: "gym"
  }],
  Core: [{
    n: "Hanging Leg Raise",
    eq: "both"
  }, {
    n: "Weighted Sit-Up",
    eq: "both"
  }, {
    n: "Air Bike",
    eq: "both"
  }, {
    n: "Side Crunch",
    eq: "both"
  }, {
    n: "Russian Twist",
    eq: "both"
  }, {
    n: "Plank",
    eq: "both"
  }, {
    n: "Side Bend",
    eq: "both"
  }, {
    n: "Cable Crunch",
    eq: "gym"
  }, {
    n: "Cable Woodchop",
    eq: "gym"
  }],
  Delts: [{
    n: "Cable Lateral Raise",
    eq: "gym"
  }, {
    n: "DB Rear Lateral Raise",
    eq: "both"
  }, {
    n: "Reverse Pec Deck",
    eq: "gym"
  }, {
    n: "Cable Rear Delt Fly",
    eq: "gym"
  }, {
    n: "Reverse Fly (incline)",
    eq: "both"
  }, {
    n: "Leaning Cable Lateral",
    eq: "gym"
  }, {
    n: "Face Pull",
    eq: "gym"
  }, {
    n: "Front Raise",
    eq: "both"
  }, {
    n: "3-Way DB Raise",
    eq: "both"
  }, {
    n: "Band Pull-Apart",
    eq: "both"
  }]
};

/* rep styles per goal */
const STYLES = {
  strength: {
    comp: {
      sets: 4,
      reps: 5,
      pct: 0.85
    },
    acc: {
      sets: 3,
      reps: 8
    },
    iso: {
      sets: 3,
      reps: 12
    }
  },
  hypertrophy: {
    comp: {
      sets: 4,
      reps: 8,
      pct: 0.75
    },
    acc: {
      sets: 3,
      reps: 12
    },
    iso: {
      sets: 3,
      reps: 15
    }
  },
  tone: {
    comp: {
      sets: 3,
      reps: 15,
      pct: 0.55
    },
    acc: {
      sets: 3,
      reps: 18
    },
    iso: {
      sets: 3,
      reps: 20
    }
  }
};

/* day focuses: which library groups a day pulls from, how many, and the heavy compound lift */
const FOCUS = {
  Shoulders: {
    title: "Shoulders",
    lift: "ohp",
    pools: [["Shoulders", 4]]
  },
  Back: {
    title: "Back",
    lift: "deadlift",
    pools: [["Back", 4]]
  },
  Chest: {
    title: "Chest",
    lift: "bench",
    pools: [["Chest", 4]]
  },
  Legs: {
    title: "Legs",
    lift: "squat",
    pools: [["Legs", 3], ["Calves", 1]]
  },
  Glutes: {
    title: "Glutes & Hams",
    lift: "squat",
    pools: [["Glutes", 3], ["Hams", 1]]
  },
  Arms: {
    title: "Arms",
    lift: null,
    pools: [["Arms", 5]]
  },
  Upper: {
    title: "Upper Body",
    lift: "bench",
    pools: [["Chest", 2], ["Back", 2], ["Shoulders", 1]]
  },
  Lower: {
    title: "Lower Body",
    lift: "squat",
    pools: [["Glutes", 2], ["Legs", 2], ["Hams", 1]]
  },
  FullBody: {
    title: "Full Body",
    lift: "squat",
    pools: [["Legs", 1], ["Back", 1], ["Chest", 1], ["Shoulders", 1]]
  },
  Push: {
    title: "Push",
    lift: "bench",
    pools: [["Chest", 2], ["Shoulders", 2]]
  },
  Pull: {
    title: "Pull",
    lift: "deadlift",
    pools: [["Back", 3], ["Arms", 1]]
  },
  Delts: {
    title: "Delts & Core",
    lift: null,
    pools: [["Delts", 4]]
  },
  Cond: {
    title: "Conditioning",
    lift: null,
    pools: [["Legs", 1], ["Shoulders", 1]]
  }
};

/* goals → suggested weekly split (FOCUS keys) + rep style */
const GOALS = {
  vtaper: {
    label: "Build Muscle · V-Taper",
    style: "hypertrophy",
    week: ["Shoulders", "Back", "Chest", "Legs", "Arms", "Delts"]
  },
  glutes: {
    label: "Glutes & Legs",
    style: "hypertrophy",
    week: ["Glutes", "Legs", "Glutes", "Upper", "Lower", "Cond"]
  },
  tone: {
    label: "Tone & Sculpt",
    style: "tone",
    week: ["Upper", "Lower", "FullBody", "Upper", "Lower", "Cond"]
  },
  strength: {
    label: "Full-Body Strength",
    style: "strength",
    week: ["Push", "Pull", "Legs", "Push", "Pull", "Legs"]
  },
  recomp: {
    label: "Lean Out · Recomp",
    style: "hypertrophy",
    week: ["Upper", "Lower", "Cond", "Upper", "Lower", "Cond"]
  }
};
const GENDER_DEFAULT_GOAL = {
  women: "glutes",
  men: "vtaper"
};
const CARDIO_BY_FOCUS = {
  heavy: ["Incline Walk", 12],
  pump: ["Bike", 20],
  cond: ["Mixed Intervals", 25]
};

/* Only these true barbell lifts can be a day's heavy anchor with a %1RM load.
   Everything else is accessory/isolation: rep-targeted, athlete fills the weight. */
const COMPOUNDS = {
  bench: ["Bench Press", "Incline Barbell Press", "Close-Grip Bench Press"],
  squat: ["Back Squat", "Front Squat", "Pause Squat"],
  ohp: ["Overhead Press", "Push Press", "Standing Military Press"],
  deadlift: ["Deadlift", "Barbell Row", "Romanian Deadlift"]
};
function collectExerciseGuideItems(sessions, active) {
  const items = [];
  Object.entries(LIB).forEach(([category, movements]) => {
    movements.forEach((movement) => items.push({
      name: movement.n,
      category,
      equipment: movement.eq,
    }));
  });
  Object.entries(COMPOUNDS).forEach(([lift, movements]) => {
    const categories = {
      bench: "Chest",
      squat: "Legs",
      ohp: "Shoulders",
      deadlift: "Posterior Chain",
    };
    movements.forEach((name) => items.push({
      name,
      category: categories[lift],
      equipment: "Barbell",
    }));
  });
  Object.values(DISCIPLINES).forEach((discipline) => {
    Object.values(discipline.lib).flat().forEach((movement) => items.push({
      name: movement.n,
      category: discipline.name,
      equipment: discipline.name === "MMA" ? "Training space or combat equipment" : "Mat or clear floor",
      cue: movement.cue,
    }));
  });
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    (Array.isArray(session?.entries) ? session.entries : []).forEach((entry) => items.push({
      name: entry?.ex || entry?.name,
      category: session?.sessionType ? "Guided training" : "Workout history",
    }));
  });
  (Array.isArray(active?.entries) ? active.entries : []).forEach((entry) => items.push({
    name: entry?.ex || entry?.name,
    category: "Current workout",
  }));
  return items;
}
function pick(arr, n) {
  return arr[(n % arr.length + arr.length) % arr.length];
}
function poolFor(group, mode) {
  return LIB[group].filter(m => m.eq === "both" || m.eq === mode);
}

/* Build one day's workout from goal + focus + location + week (for variation + deload) */
function generateDay(focusKey, goalKey, mode, blockNum, weekIdx, tm, roundLoad, styleOverride) {
  const f = FOCUS[focusKey] || FOCUS.Upper;
  const goal = GOALS[goalKey] || GOALS.vtaper;
  const style = STYLES[styleOverride] ? styleOverride : goal.style;
  const deload = (weekIdx % 6 + 6) % 6 === 5;
  const st = STYLES[style];
  const rows = [];
  let slotN = blockNum * 7 + weekIdx; // rotates exercises each week/block

  // 1) Heavy anchor — ONLY a real barbell compound gets a calculated %1RM load.
  if (f.lift && COMPOUNDS[f.lift]) {
    const compName = pick(COMPOUNDS[f.lift], slotN++);
    const target = roundLoad(tm(f.lift) * st.comp.pct * (deload ? 0.85 : 1));
    rows.push({
      ex: compName,
      role: "comp",
      lift: f.lift,
      heavy: !deload && style === "strength",
      drop: false,
      sets: deload ? Math.max(2, st.comp.sets - 1) : st.comp.sets,
      reps: st.comp.reps,
      target,
      note: ""
    });
  }

  // 2) Accessories + isolation from the focus pools — NO computed load, athlete enters weight.
  f.pools.forEach(([group, count]) => {
    const pool = poolFor(group, mode);
    for (let i = 0; i < count; i++) {
      const ex = pick(pool, slotN++);
      const sc = i === 0 ? st.acc : st.iso;
      rows.push({
        ex: ex.n,
        role: i === 0 ? "acc" : "iso",
        lift: null,
        db: /\bDB\b|Dumbbell/i.test(ex.n),
        heavy: false,
        drop: style !== "strength" && !deload && i > 0,
        sets: deload ? Math.max(2, sc.sets - 1) : sc.sets,
        reps: sc.reps,
        target: null,
        note: group === "Glutes" ? "Glute focus" : ""
      });
    }
  });

  // 3) daily core (reps only, no weight) + cardio (minutes only)
  // daily core — steps one per day through the catalog so every day in the week differs
  const focusIdx = (GOALS[goalKey] || GOALS.vtaper).week.indexOf(focusKey);
  const coreSeed = blockNum + weekIdx + (focusIdx >= 0 ? focusIdx : 0);
  rows.push({
    ex: pick(poolFor("Core", mode), coreSeed).n,
    role: "ab",
    sets: 3,
    reps: deload ? 12 : 15,
    target: null,
    heavy: false,
    drop: false,
    note: "Bodyweight — reps only"
  });
  const isHeavy = style === "strength";
  const cardio = focusKey === "Cond" ? CARDIO_BY_FOCUS.cond : isHeavy ? CARDIO_BY_FOCUS.heavy : CARDIO_BY_FOCUS.pump;
  const cmin = Math.round(cardio[1] * (deload ? 0.6 : 1) / 5) * 5;
  rows.push({
    ex: `${cardio[0]} — ${cmin} min`,
    role: "cardio",
    sets: 1,
    reps: cmin,
    target: null,
    heavy: false,
    drop: false,
    note: isHeavy ? "Zone 2 — easy" : "Steady pace"
  });
  return {
    id: f.title,
    focusKey,
    type: isHeavy ? "heavy" : "pump",
    deload,
    style,
    rows
  };
}

function createGeneratedActiveWorkout({
  focusKey,
  programDayIndex,
  goal,
  mode,
  progress,
  tm,
  roundLoad,
  styleOverride,
}) {
  const day = generateDay(
    focusKey,
    goal,
    mode,
    progress.blockNum,
    progress.week - 1,
    tm,
    roundLoad,
    styleOverride,
  );
  return {
    id: uid(),
    date: today(),
    dayId: day.id,
    focusKey,
    programDayIndex,
    mode,
    goal,
    blockNum: progress.blockNum,
    week: progress.week,
    start: Date.now(),
    entries: day.rows.map(row => ({
      ex: row.ex,
      heavy: Boolean(row.heavy),
      drop: Boolean(row.drop),
      role: row.role,
      db: Boolean(row.db),
      note: row.note || "",
      lift: row.lift || null,
      target: row.target,
      targetReps: row.reps,
      plannedSetCount: row.sets,
      sets: Array(row.sets).fill(null).map(() => ({
        w: row.target || "",
        r: row.reps,
        done: false,
      })),
    })),
  };
}
const RULES = ["Heavy compounds (3–5 reps) are the muscle-protecting signal. Never drop-set them.", "Protein ~1g per lb of target bodyweight daily, front-loaded early.", "Drop sets only on isolation last sets. Max 2–3 per session.", "Rate of loss ~1–2 lb/week. Faster = lean mass going.", "Safety pins set before every heavy solo bench or squat.", "All reps clean → +5 lb upper / +10 lb lower. Miss → repeat."];

/* ============ THEME ============ */
const C = {
  bg: "#0b0b0d",
  panel: "#151518",
  panel2: "#1d1d22",
  line: "#27272e",
  red: "#e11d2a",
  blue: "#3b9ae1",
  gold: "#d9a441",
  green: "#4ade80",
  txt: "#f4f4f5",
  dim: "#8a8a93"
};

/* ============ FIREBASE (connected layer) ============ */
/* window.firebase is initialized by the HTML host before the app runs.
   In the Claude artifact sandbox it's absent, so the Crew tab degrades gracefully. */
var FB = function () {
  var ready = typeof window !== "undefined" && !!window.firebase && window.firebase.apps && window.firebase.apps.length > 0;
  function auth() {
    return window.firebase.auth();
  }
  function db() {
    return window.firebase.firestore();
  }
  return {
    ready: ready,
    onAuth: function (cb) {
      if (!ready) {
        cb(null);
        return function () {};
      }
      return auth().onAuthStateChanged(cb);
    },
    signUp: function (email, pw, name) {
      return auth().createUserWithEmailAndPassword(email, pw).then(function (c) {
        return c.user.updateProfile({
          displayName: name
        }).then(function () {
          return db().collection("users").doc(c.user.uid).set({
            name: name,
            email: email
          }, {
            merge: true
          });
        }).then(function () {
          return c.user;
        });
      });
    },
    signIn: function (email, pw) {
      return auth().signInWithEmailAndPassword(email, pw);
    },
    signOut: function () {
      return auth().signOut();
    },
    watchPersonalState: function (uid, cb, onError) {
      if (!ready || !uid) {
        cb(null);
        return function () {};
      }
      return db().collection("users").doc(uid).onSnapshot(function (doc) {
        cb(doc.exists ? doc.data()?.irondeskCloud || null : null);
      }, onError || function () {});
    },
    savePersonalState: function (uid, envelope) {
      if (!ready || !uid) return Promise.reject(new Error("Firebase is unavailable."));
      return db().collection("users").doc(uid).set({
        irondeskCloud: envelope
      }, {
        merge: true
      });
    },
    createGroup: function (uid, name, groupName) {
      var code = Math.random().toString(36).slice(2, 8).toUpperCase();
      var ref = db().collection("groups").doc();
      return ref.set({
        name: groupName,
        code: code,
        owner: uid,
        createdAt: Date.now()
      }).then(function () {
        return ref.collection("members").doc(uid).set({
          name: name,
          updatedAt: Date.now()
        });
      }).then(function () {
        return {
          groupId: ref.id,
          code: code,
          name: groupName
        };
      });
    },
    joinGroup: function (uid, name, code) {
      return db().collection("groups").where("code", "==", code.toUpperCase()).limit(1).get().then(function (qs) {
        if (qs.empty) throw new Error("No group with that code");
        var doc = qs.docs[0];
        return doc.ref.collection("members").doc(uid).set({
          name: name,
          updatedAt: Date.now()
        }).then(function () {
          return {
            groupId: doc.id,
            code: code.toUpperCase(),
            name: doc.data().name
          };
        });
      });
    },
    watchMembers: function (groupId, cb) {
      return db().collection("groups").doc(groupId).collection("members").onSnapshot(function (qs) {
        cb(qs.docs.map(function (d) {
          return Object.assign({
            uid: d.id
          }, d.data());
        }));
      }, function () {
        cb([]);
      });
    },
    watchFeed: function (groupId, cb) {
      return db().collection("groups").doc(groupId).collection("feed").orderBy("ts", "desc").limit(40).onSnapshot(function (qs) {
        cb(qs.docs.map(function (d) {
          return Object.assign({
            id: d.id
          }, d.data());
        }));
      }, function () {
        cb([]);
      });
    },
    syncStats: function (groupId, uid, stats) {
      if (!ready || !groupId) return Promise.resolve();
      return db().collection("groups").doc(groupId).collection("members").doc(uid).set(Object.assign({
        updatedAt: Date.now()
      }, stats), {
        merge: true
      });
    },
    pushPRs: function (groupId, uid, name, prs) {
      if (!ready || !groupId || !prs || !prs.length) return Promise.resolve();
      var batch = db().batch();
      prs.forEach(function (p) {
        var ref = db().collection("groups").doc(groupId).collection("feed").doc();
        batch.set(ref, {
          uid: uid,
          name: name,
          ex: p.ex,
          e1rm: p.e1rm,
          ts: Date.now()
        });
      });
      return batch.commit();
    }
  };
}();
function computeStats(sessions, maxes) {
  var ironDeskSessions = (Array.isArray(sessions) ? sessions : []).filter(function (session) {
    return session?.source !== "garmin";
  });
  var best = {
    bench: 0,
    squat: 0,
    ohp: 0,
    deadlift: 0
  };
  ironDeskSessions.forEach(function (s) {
    (Array.isArray(s?.entries) ? s.entries : []).forEach(function (en) {
      if (en?.lift && Object.prototype.hasOwnProperty.call(best, en.lift)) (Array.isArray(en?.sets) ? en.sets : []).forEach(function (st) {
        var estimate = estimatedMaxForSet(st.w, st.r);
        if (estimate == null) return;
        var e = Math.round(estimate);
        if (e > best[en.lift]) best[en.lift] = e;
      });
    });
  });
  ["bench", "squat", "ohp", "deadlift"].forEach(function (k) {
    if (!best[k]) best[k] = maxes[k] || 0;
  });
  var cut = localDateKey(new Date(Date.now() - 7 * 864e5));
  var wk = ironDeskSessions.filter(function (s) {
    return String(s?.date || "") >= cut;
  });
  return {
    bench: best.bench,
    squat: best.squat,
    ohp: best.ohp,
    deadlift: best.deadlift,
    weekVolume: wk.reduce(function (a, s) {
      return a + safeSessionVolume(s);
    }, 0),
    weekSessions: wk.length
  };
}
const CREW_KEY = "irondesk:crew";
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      err: null
    };
  }
  static getDerivedStateFromError(err) {
    return {
      err: err
    };
  }
  componentDidUpdate(prev) {
    if (prev.tabKey !== this.props.tabKey && this.state.err) this.setState({
      err: null
    });
  }
  render() {
    if (this.state.err) {
      return React.createElement("div", {
        style: {
          background: "#151518",
          border: "1px solid #27272e",
          borderRadius: 14,
          padding: 18,
          margin: "8px 0"
        }
      }, React.createElement("div", {
        className: "ttl",
        style: {
          fontSize: 15,
          fontWeight: 700,
          color: "#e11d2a"
        }
      }, "This tab hit a snag"), React.createElement("div", {
        style: {
          fontSize: 12.5,
          color: "#8a8a93",
          marginTop: 8,
          lineHeight: 1.5
        }
      }, "The rest of the app still works \u2014 switch tabs and back to retry. Details: " + (this.state.err.message || "unknown")));
    }
    return this.props.children;
  }
}
export default function IronDesk() {
  const [tab, setTab] = useState("today");
  const [mode, setMode] = useState("home");
  const [modeUpdatedAt, setModeUpdatedAt] = useState(0);
  const [maxes, setMaxes] = useState(D_MAXES);
  const [homePlates, setHomePlates] = useState(D_HOME);
  const [gymPlates, setGymPlates] = useState(D_GYM);
  const [bar, setBar] = useState(45);
  const [sessions, setSessions] = useState([]);
  const [deletedRecords, setDeletedRecords] = useState({
    sessions: {},
    bwLog: {},
    cardioLog: {},
  });
  const [bwLog, setBwLog] = useState([]);
  const [cardioLog, setCardioLog] = useState([]);
  const [healthLog, setHealthLog] = useState([]);
  const [healthLogClearedAt, setHealthLogClearedAt] = useState(0);
  const [healthAutoSync, setHealthAutoSync] = useState(() => {
    try {
      return localStorage.getItem(HEALTH_CONNECT_AUTO_SYNC_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [healthWriteEnabled, setHealthWriteEnabled] = useState(() => {
    try {
      return localStorage.getItem(HEALTH_CONNECT_WRITE_ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [healthSyncStatus, setHealthSyncStatus] = useState(() => {
    let syncedAt = null;
    try {
      syncedAt = localStorage.getItem(HEALTH_CONNECT_LAST_SYNC_KEY);
    } catch {}
    return {
      state: "idle",
      message: "",
      syncedAt
    };
  });
  const [active, setActive] = useState(null); // live workout
  const [activeClearedAt, setActiveClearedAt] = useState(0);
  const [progress, setProgress] = useState({
    blockNum: 1,
    week: 1,
    dayIndex: 0,
    updatedAt: Date.now()
  });
  const [gender, setGender] = useState("men");
  const [goal, setGoal] = useState("vtaper");
  const [styleOverride, setStyleOverride] = useState(null);
  const [customDays, setCustomDays] = useState([]);
  const [onboarded, setOnboarded] = useState(true);
  const [macros, setMacros] = useState(null);
  const [restTimerPrefs, setRestTimerPrefs] = useState(DEFAULT_REST_TIMER_PREFS);
  const crewRef = useRef({
    uid: null,
    name: null,
    groupId: null
  });
  const lastPushed = useRef(null);
  const flashSequenceRef = useRef(0);
  const healthSyncInFlightRef = useRef(null);
  const lastAutomaticHealthSyncRef = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState("");
  const [cloudUser, setCloudUser] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(() => {
    try {
      return localStorage.getItem(CLOUD_SYNC_PREF_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [cloudStatus, setCloudStatus] = useState({
    state: "signed-out",
    message: "Sign in to sync this device.",
    syncedAt: null
  });
  const [cloudSyncNonce, setCloudSyncNonce] = useState(0);
  const [cloudDeviceId] = useState(() => getOrCreateCloudDeviceId(localStorage));
  const cloudReadyRef = useRef(false);
  const cloudLastHashRef = useRef("");
  const personalState = useMemo(() => buildPersonalState({
    maxes,
    homePlates,
    gymPlates,
    bar,
    mode,
    modeUpdatedAt,
    sessions,
    deletedRecords,
    bwLog,
    cardioLog,
    healthLog,
    healthLogClearedAt,
    active,
    activeClearedAt,
    progress,
    gender,
    goal,
    styleOverride,
    customDays,
    onboarded,
    macros,
    restTimerPrefs
  }), [maxes, homePlates, gymPlates, bar, mode, modeUpdatedAt, sessions, deletedRecords, bwLog, cardioLog, healthLog, healthLogClearedAt, active, activeClearedAt, progress, gender, goal, styleOverride, customDays, onboarded, macros, restTimerPrefs]);
  const personalStateRef = useRef(personalState);
  personalStateRef.current = personalState;
  const applyHealthSync = React.useCallback(result => {
    const days = Array.isArray(result?.days) ? result.days : [];
    const syncedAt = result?.syncedAt || new Date().toISOString();
    const summary = healthSyncSummary(days);
    setHealthLog(current => mergeHealthSummaries(current, days, syncedAt));
    setBwLog(current => mergeHealthBodyweight(current, days));
    try {
      localStorage.setItem(HEALTH_CONNECT_LAST_SYNC_KEY, syncedAt);
    } catch {}
    setHealthSyncStatus({
      state: "synced",
      message: summary.metricCount
        ? `Refreshed ${summary.metricCount} health value${summary.metricCount === 1 ? "" : "s"} across ${summary.populatedDays} day${summary.populatedDays === 1 ? "" : "s"}.`
        : "Health Connect returned no shared records for the last 7 days. Check Garmin sharing and Health Connect access.",
      syncedAt
    });
    return result;
  }, []);
  const syncHealthNow = React.useCallback(async () => {
    if (healthSyncInFlightRef.current) return healthSyncInFlightRef.current;
    setHealthSyncStatus({
      state: "syncing",
      message: "Reading the last 7 days from Health Connect…",
      syncedAt: null
    });
    const task = performHealthConnectSync()
      .then(applyHealthSync)
      .catch(error => {
        setHealthSyncStatus({
          state: error?.code === "health-connect-permission-required" ? "permission" : "error",
          message: error?.message || "Health Connect sync failed.",
          syncedAt: null
        });
        throw error;
      });
    healthSyncInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (healthSyncInFlightRef.current === task) healthSyncInFlightRef.current = null;
    }
  }, [applyHealthSync]);
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("irondesk:v3");
        if (r && r.value) {
          const s = JSON.parse(r.value);
          s.maxes && setMaxes(s.maxes);
          s.homePlates && setHomePlates(s.homePlates);
          s.gymPlates && setGymPlates(s.gymPlates);
          s.bar && setBar(s.bar);
          if (s.mode === "home" || s.mode === "gym") {
            setMode(s.mode);
            setModeUpdatedAt(Math.max(1, Number(s.modeUpdatedAt) || Date.now()));
          }
          s.sessions && setSessions(normalizeSessionHistory(s.sessions));
          s.deletedRecords && setDeletedRecords(s.deletedRecords);
          s.bwLog && setBwLog(s.bwLog);
          s.cardioLog && setCardioLog(s.cardioLog);
          s.healthLog && setHealthLog(s.healthLog);
          if (s.healthLogClearedAt != null) setHealthLogClearedAt(Number(s.healthLogClearedAt) || 0);
          const storedActiveClearedAt = Number(s.activeClearedAt) || 0;
          setActiveClearedAt(storedActiveClearedAt);
          const storedActive = normalizeActiveWorkout(s.active);
          if (storedActive) {
            const activeStartedAt = Number(storedActive.start) || Date.parse(storedActive.startedAt || "") || 0;
            if (storedActiveClearedAt <= 0 || activeStartedAt > storedActiveClearedAt) {
              setActive(storedActive);
            }
          }
          if (s.progress) setProgress(normalizeWorkoutProgress(s.progress));
          const storedGender = normalizeGender(s.gender);
          setGender(storedGender);
          setGoal(normalizeGoal(s.goal, storedGender));
          s.styleOverride && setStyleOverride(s.styleOverride);
          s.customDays && setCustomDays(s.customDays);
          s.macros && setMacros(s.macros);
          setRestTimerPrefs(normalizeRestTimerPrefs(s.restTimerPrefs));
          if (typeof s.onboarded === "boolean") setOnboarded(s.onboarded);
        } else {
          // migrate from v2 if present
          try {
            const old = await window.storage.get("irondesk:v2");
            if (old && old.value) {
              const s = JSON.parse(old.value);
              s.maxes && setMaxes(s.maxes);
              s.plates && setHomePlates(s.plates);
              s.gymPlates && setGymPlates(s.gymPlates);
              s.bar && setBar(s.bar);
              s.bwLog && setBwLog(s.bwLog);
              s.cardioLog && setCardioLog(s.cardioLog);
            } else {
              setOnboarded(false); // brand-new install → offer the 5-question setup
            }
          } catch (e) {
            setOnboarded(false);
          }
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(HEALTH_CONNECT_AUTO_SYNC_KEY, healthAutoSync ? "true" : "false");
    } catch {}
  }, [healthAutoSync]);
  useEffect(() => {
    try {
      localStorage.setItem(
        HEALTH_CONNECT_WRITE_ENABLED_KEY,
        healthWriteEnabled ? "true" : "false",
      );
    } catch {}
  }, [healthWriteEnabled]);
  const runAutomaticHealthSync = React.useCallback(() => {
    if (!loaded || !healthAutoSync || !isNativeHealthConnect()) return;
    const now = Date.now();
    if (now - lastAutomaticHealthSyncRef.current < 15_000) return;
    lastAutomaticHealthSyncRef.current = now;
    syncHealthNow().catch(() => {
      if (lastAutomaticHealthSyncRef.current === now) {
        lastAutomaticHealthSyncRef.current = 0;
      }
    });
  }, [healthAutoSync, loaded, syncHealthNow]);
  useEffect(() => {
    runAutomaticHealthSync();
    if (!loaded || !healthAutoSync || !isNativeHealthConnect()) return undefined;

    let disposed = false;
    let appStateHandle = null;
    Promise.resolve(App.addListener("appStateChange", state => {
      if (state?.isActive) runAutomaticHealthSync();
    })).then(handle => {
      if (disposed) {
        handle?.remove();
      } else {
        appStateHandle = handle;
      }
    }).catch(() => {});

    const handleVisibility = () => {
      if (document.visibilityState === "visible") runAutomaticHealthSync();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", runAutomaticHealthSync);
    return () => {
      disposed = true;
      appStateHandle?.remove();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", runAutomaticHealthSync);
    };
  }, [healthAutoSync, loaded, runAutomaticHealthSync]);
  const persist = async () => {
    try {
      await window.storage.set("irondesk:v3", JSON.stringify({
        maxes,
        homePlates,
        gymPlates,
        bar,
        mode,
        modeUpdatedAt,
        sessions,
        deletedRecords,
        bwLog,
        cardioLog,
        healthLog,
        healthLogClearedAt,
        active,
        activeClearedAt,
        progress,
        gender,
        goal,
        styleOverride,
        customDays,
        onboarded,
        macros,
        restTimerPrefs
      }));
    } catch (e) {}
  };
  useEffect(() => {
    if (loaded) persist(); /* eslint-disable-next-line */
  }, [maxes, homePlates, gymPlates, bar, mode, modeUpdatedAt, sessions, deletedRecords, bwLog, cardioLog, healthLog, healthLogClearedAt, active, activeClearedAt, progress, gender, goal, styleOverride, customDays, onboarded, macros, restTimerPrefs, loaded]);

  useEffect(() => FB.onAuth(user => {
    setCloudUser(user || null);
    cloudReadyRef.current = false;
    cloudLastHashRef.current = "";
    setCloudStatus(user ? {
      state: cloudEnabled ? "connecting" : "paused",
      message: cloudEnabled ? "Connecting to your cloud copy…" : "Cloud sync is paused.",
      syncedAt: null
    } : {
      state: "signed-out",
      message: "Sign in to sync this device.",
      syncedAt: null
    });
  }), [cloudEnabled]);

  const applyPersonalState = state => {
    state.maxes && setMaxes(state.maxes);
    state.homePlates && setHomePlates(state.homePlates);
    state.gymPlates && setGymPlates(state.gymPlates);
    if (state.bar != null) setBar(state.bar);
    if (state.mode === "home" || state.mode === "gym") setMode(state.mode);
    if (state.modeUpdatedAt != null) setModeUpdatedAt(Number(state.modeUpdatedAt) || 0);
    Array.isArray(state.sessions) && setSessions(normalizeSessionHistory(state.sessions));
    if (state.deletedRecords) setDeletedRecords(state.deletedRecords);
    Array.isArray(state.bwLog) && setBwLog(state.bwLog);
    Array.isArray(state.cardioLog) && setCardioLog(state.cardioLog);
    Array.isArray(state.healthLog) && setHealthLog(state.healthLog);
    if (state.healthLogClearedAt != null) setHealthLogClearedAt(Number(state.healthLogClearedAt) || 0);
    if (Object.prototype.hasOwnProperty.call(state, "active")) setActive(normalizeActiveWorkout(state.active));
    if (state.activeClearedAt != null) setActiveClearedAt(Number(state.activeClearedAt) || 0);
    if (state.progress) setProgress(normalizeWorkoutProgress(state.progress));
    const storedGender = normalizeGender(state.gender);
    setGender(storedGender);
    setGoal(normalizeGoal(state.goal, storedGender));
    if (Object.prototype.hasOwnProperty.call(state, "styleOverride")) setStyleOverride(state.styleOverride || null);
    Array.isArray(state.customDays) && setCustomDays(state.customDays);
    if (typeof state.onboarded === "boolean") setOnboarded(state.onboarded);
    if (Object.prototype.hasOwnProperty.call(state, "macros")) setMacros(state.macros || null);
    setRestTimerPrefs(normalizeRestTimerPrefs(state.restTimerPrefs));
  };

  useEffect(() => {
    if (!loaded || !cloudEnabled || !cloudUser || !FB.ready) return undefined;
    cloudReadyRef.current = false;
    setCloudStatus({
      state: "connecting",
      message: "Checking your cloud copy…",
      syncedAt: null
    });
    return FB.watchPersonalState(cloudUser.uid, payload => {
      const local = personalStateRef.current;
      if (!payload?.state) {
        const hash = personalStateHash(local);
        cloudLastHashRef.current = hash;
        cloudReadyRef.current = true;
        setCloudStatus({
          state: "syncing",
          message: "Uploading this device for the first time…",
          syncedAt: null
        });
        try {
          const envelope = createCloudEnvelope(local, {
            deviceId: cloudDeviceId
          });
          FB.savePersonalState(cloudUser.uid, envelope).then(() => {
            setCloudStatus({
              state: "synced",
              message: "This device is synced.",
              syncedAt: Date.now()
            });
          }).catch(error => {
            setCloudStatus({
              state: "error",
              message: error?.code === "permission-denied"
                ? "Firebase denied personal sync. Check Firestore rules."
                : error?.message || "Cloud upload failed.",
              syncedAt: null
            });
          });
        } catch (error) {
          setCloudStatus({
            state: "error",
            message: error?.message || "Cloud upload failed.",
            syncedAt: null
          });
        }
        return;
      }

      const remote = buildPersonalState(payload.state);
      const merged = mergePersonalStates(local, remote);
      const localHash = personalStateHash(local);
      const remoteHash = personalStateHash(remote);
      const mergedHash = personalStateHash(merged);
      cloudReadyRef.current = true;
      cloudLastHashRef.current = mergedHash === remoteHash ? mergedHash : remoteHash;
      if (mergedHash !== localHash) applyPersonalState(merged);
      if (mergedHash !== remoteHash) {
        setCloudStatus({
          state: "syncing",
          message: "Merging this device with your cloud history…",
          syncedAt: null
        });
        setCloudSyncNonce(value => value + 1);
      } else {
        setCloudStatus({
          state: "synced",
          message: "This device is synced.",
          syncedAt: Number(payload.updatedAt) || Date.now()
        });
      }
    }, error => {
      setCloudStatus({
        state: "error",
        message: error?.code === "permission-denied"
          ? "Firebase denied personal sync. Check Firestore rules."
          : error?.message || "Cloud connection failed.",
        syncedAt: null
      });
    });
  }, [loaded, cloudEnabled, cloudUser, cloudDeviceId]);

  useEffect(() => {
    if (
      !loaded
      || !cloudEnabled
      || !cloudUser
      || !cloudReadyRef.current
      || !FB.ready
    ) return undefined;
    const hash = personalStateHash(personalState);
    if (hash === cloudLastHashRef.current) return undefined;
    setCloudStatus({
      state: "syncing",
      message: "Saving changes to your cloud copy…",
      syncedAt: null
    });
    const timer = setTimeout(() => {
      try {
        const envelope = createCloudEnvelope(personalStateRef.current, {
          deviceId: cloudDeviceId
        });
        const envelopeHash = personalStateHash(envelope.state);
        FB.savePersonalState(cloudUser.uid, envelope).then(() => {
          cloudLastHashRef.current = envelopeHash;
          setCloudStatus({
            state: "synced",
            message: "This device is synced.",
            syncedAt: Date.now()
          });
        }).catch(error => {
          setCloudStatus({
            state: "error",
            message: error?.code === "permission-denied"
              ? "Firebase denied personal sync. Check Firestore rules."
              : error?.message || "Cloud save failed.",
            syncedAt: null
          });
        });
      } catch (error) {
        setCloudStatus({
          state: "error",
          message: error?.message || "Cloud save failed.",
          syncedAt: null
        });
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [personalState, loaded, cloudEnabled, cloudUser, cloudDeviceId, cloudSyncNonce]);

  const updateCloudEnabled = enabled => {
    try {
      localStorage.setItem(CLOUD_SYNC_PREF_KEY, enabled ? "true" : "false");
    } catch {}
    setCloudEnabled(enabled);
    cloudReadyRef.current = false;
    if (!enabled) {
      setCloudStatus({
        state: cloudUser ? "paused" : "signed-out",
        message: cloudUser ? "Cloud sync is paused." : "Sign in to sync this device.",
        syncedAt: null
      });
    }
  };
  const syncCloudNow = () => {
    cloudLastHashRef.current = "";
    setCloudSyncNonce(value => value + 1);
  };

  // push PRs + stats to the crew group when a new session lands
  useEffect(() => {
    if (!FB.ready || !loaded) return;
    const c = crewRef.current;
    if (c.uid && c.groupId && sessions[0] && sessions[0].id !== lastPushed.current) {
      lastPushed.current = sessions[0].id;
      FB.pushPRs(c.groupId, c.uid, c.name, sessions[0].prs || []).catch(function () {});
      FB.syncStats(c.groupId, c.uid, computeStats(sessions, maxes)).catch(function () {});
    }
    /* eslint-disable-next-line */
  }, [sessions, loaded]);
  const note = m => {
    const sequence = flashSequenceRef.current + 1;
    flashSequenceRef.current = sequence;
    setFlash(m);
    setTimeout(() => {
      if (flashSequenceRef.current === sequence) setFlash("");
    }, 1600);
  };
  const deleteTrackedRecord = React.useCallback((field, record) => {
    const key = recordTombstoneKey(field, record);
    const deletedAt = Date.now();
    const currentState = personalStateRef.current;
    const nextDeletedRecords = {
      ...(currentState.deletedRecords || {}),
      [field]: {
        ...(currentState.deletedRecords?.[field] || {}),
        [key]: deletedAt,
      },
    };
    const nextRecords = (Array.isArray(currentState[field]) ? currentState[field] : [])
      .filter(item => recordTombstoneKey(field, item) !== key);
    const nextState = buildPersonalState({
      ...currentState,
      [field]: nextRecords,
      deletedRecords: nextDeletedRecords,
    });
    personalStateRef.current = nextState;
    try {
      window.storage.set("irondesk:v3", JSON.stringify(nextState));
    } catch {}
    setDeletedRecords(nextState.deletedRecords);
    if (field === "sessions") setSessions(nextRecords);
    if (field === "bwLog") setBwLog(nextRecords);
    if (field === "cardioLog") setCardioLog(nextRecords);
  }, []);
  const markHealthConnectWrite = React.useCallback((sessionId, state, details = {}) => {
    setSessions(current => current.map(session => session.id !== sessionId ? session : {
      ...session,
      healthConnectWrite: {
        state,
        ...details,
      },
    }));
  }, []);
  const sendSessionToHealthConnect = React.useCallback(session => {
    markHealthConnectWrite(session.id, "pending");
    return writeWorkoutToHealthConnect(session)
      .then(result => {
        markHealthConnectWrite(session.id, "synced", {
          recordId: result?.recordId || null,
          writtenAt: result?.writtenAt || new Date().toISOString(),
        });
        note("Workout sent to Health Connect");
        return result;
      })
      .catch(error => {
        markHealthConnectWrite(session.id, "error", {
          message: error?.message || "Health Connect write failed.",
        });
        note("Workout saved in IronDesk; Health Connect needs attention");
        return null;
      });
  }, [markHealthConnectWrite]);
  const completeWorkoutSession = React.useCallback(session => {
    const shouldWrite = healthWriteEnabled
      && isNativeHealthConnect()
      && session?.source !== "garmin";
    const savedSession = shouldWrite ? {
      ...session,
      healthConnectWrite: {
        state: "pending",
      },
    } : session;
    const sessionKey = recordTombstoneKey("sessions", savedSession);
    setDeletedRecords(current => {
      if (!current?.sessions?.[sessionKey]) return current;
      const nextSessions = { ...current.sessions };
      delete nextSessions[sessionKey];
      return { ...current, sessions: nextSessions };
    });
    setSessions(current => [
      savedSession,
      ...current.filter(item => recordTombstoneKey("sessions", item) !== sessionKey),
    ]);
    if (shouldWrite) {
      sendSessionToHealthConnect(savedSession);
    }
    return savedSession;
  }, [healthWriteEnabled, sendSessionToHealthConnect]);
  const retryHealthConnectWrite = React.useCallback(session => {
    if (!isNativeHealthConnect()) {
      note("Open IronDesk on Android to send this workout");
      return;
    }
    if (!healthWriteEnabled) {
      note("Enable completed-workout writeback in Connect first");
      setTab("connections");
      return;
    }
    sendSessionToHealthConnect(session);
  }, [healthWriteEnabled, sendSessionToHealthConnect]);
  const clearActiveWorkout = React.useCallback(() => {
    const clearedAt = Date.now();
    const clearedState = buildPersonalState({
      ...personalStateRef.current,
      active: null,
      activeClearedAt: clearedAt
    });
    personalStateRef.current = clearedState;
    try {
      window.storage.set("irondesk:v3", JSON.stringify(clearedState));
    } catch {}
    setActive(null);
    setActiveClearedAt(current => Math.max(current, clearedAt));
  }, []);
  const selectTrainingMode = nextMode => {
    if (nextMode !== "home" && nextMode !== "gym") return;
    if (active?.mode && active.mode !== nextMode) {
      note(`Current workout stays ${active.mode === "gym" ? "Gym" : "Home"}. Finish or discard it before switching.`);
      setTab("today");
      return;
    }
    if (mode === nextMode) return;
    const changedAt = Date.now();
    personalStateRef.current = buildPersonalState({
      ...personalStateRef.current,
      mode: nextMode,
      modeUpdatedAt: changedAt,
    });
    setMode(nextMode);
    setModeUpdatedAt(changedAt);
  };
  const plates = mode === "gym" ? gymPlates : homePlates;
  const setPlates = mode === "gym" ? setGymPlates : setHomePlates;
  const roundLoad = x => mode === "gym" ? Math.round(x / 2.5) * 2.5 : Math.round(x / 5) * 5;
  const tm = k => Math.round(maxes[k] * 0.9);
  const recordTrainingSession = React.useCallback(details => {
    const session = buildTrackedSession({
      id: uid(),
      date: today(),
      completedAt: Date.now(),
      ...details,
    });
    return completeWorkoutSession(session);
  }, [completeWorkoutSession]);
  const startProgramWorkout = (focusKey, programDayIndex) => {
    if (active && !window.confirm("Replace the workout currently in progress?")) return;
    const selectedProgress = selectWorkoutDay(
      progress,
      programDayIndex,
      GOALS[goal].week.length
    );
    const workout = createGeneratedActiveWorkout({
      focusKey,
      programDayIndex: selectedProgress.dayIndex,
      goal,
      mode,
      progress: selectedProgress,
      tm,
      roundLoad,
      styleOverride,
    });
    setProgress(selectedProgress);
    setActive(workout);
    setTab("today");
    note(`${workout.dayId} ready`);
  };

  // PR map: best e1RM per exercise across all finished sessions
  const prMap = useMemo(() => {
    const m = {};
    (Array.isArray(sessions) ? sessions : []).forEach(s => (
      Array.isArray(s?.entries) ? s.entries : []
    ).forEach(en => (Array.isArray(en?.sets) ? en.sets : []).forEach(st => {
      const e = estimatedMaxForSet(st.w, st.r);
      if (e == null) return;
      if (!m[en.ex] || e > m[en.ex]) m[en.ex] = e;
    })));
    return m;
  }, [sessions]);
  const exportJson = () => {
    const data = {
      maxes,
      homePlates,
      gymPlates,
      bar,
      mode,
      modeUpdatedAt,
      sessions,
      deletedRecords,
      bwLog,
      cardioLog,
      healthLog,
      healthLogClearedAt,
      active,
      activeClearedAt,
      progress,
      gender,
      goal,
      styleOverride,
      customDays,
      onboarded,
      macros,
      restTimerPrefs,
      _app: "IronDesk Pro",
      _v: 4,
      _exported: new Date().toISOString()
    };
    downloadFile(JSON.stringify(data, null, 2), `irondesk-backup-${today()}.json`, "application/json");
    note("JSON backup exported");
  };
  const exportCsv = () => {
    downloadFile(`\uFEFF${sessionsToGarminCsv(sessions)}`, `irondesk-garmin-history-${today()}.csv`, "text/csv;charset=utf-8");
    note(sessions.length ? "Garmin import CSV exported" : "Garmin import CSV exported — no sessions yet");
  };
  const exportSetCsv = () => {
    downloadFile(`\uFEFF${sessionsToCsv(sessions)}`, `irondesk-set-history-${today()}.csv`, "text/csv;charset=utf-8");
    note(sessions.length ? "Detailed set CSV exported" : "Set CSV exported — no sets yet");
  };
  const importData = file => {
    if (!file) return;
    if (Number(file.size) > 10 * 1024 * 1024) {
      note("Import failed — backup is larger than 10 MB");
      return;
    }
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const s = JSON.parse(rd.result);
        s.maxes && setMaxes(s.maxes);
        s.homePlates && setHomePlates(s.homePlates);
        s.plates && setHomePlates(s.plates);
        s.gymPlates && setGymPlates(s.gymPlates);
        if (s.bar != null) setBar(s.bar);
        if (s.mode === "home" || s.mode === "gym") {
          setMode(s.mode);
          setModeUpdatedAt(Math.max(1, Number(s.modeUpdatedAt) || Date.now()));
        }
        Array.isArray(s.sessions) && setSessions(normalizeSessionHistory(s.sessions));
        if (s.deletedRecords) setDeletedRecords(s.deletedRecords);
        // v2 logs → keep bw/cardio
        s.bwLog && setBwLog(s.bwLog);
        s.cardioLog && setCardioLog(s.cardioLog);
        s.healthLog && setHealthLog(s.healthLog);
        if (s.healthLogClearedAt != null) setHealthLogClearedAt(Number(s.healthLogClearedAt) || 0);
        if (Object.prototype.hasOwnProperty.call(s, "active")) {
          const importedActiveClearedAt = Math.max(
            Number(s.activeClearedAt) || 0,
            s.active ? 0 : Date.now(),
          );
          const restoredActive = normalizeActiveWorkout(s.active);
          const activeStartedAt = Number(restoredActive?.start) || Date.parse(restoredActive?.startedAt || "") || 0;
          setActive(
            restoredActive && (importedActiveClearedAt <= 0 || activeStartedAt > importedActiveClearedAt)
              ? restoredActive
              : null,
          );
          setActiveClearedAt(importedActiveClearedAt);
        } else if (s.activeClearedAt != null) {
          setActiveClearedAt(Number(s.activeClearedAt) || 0);
        }
        if (s.progress) setProgress(normalizeWorkoutProgress(s.progress));
        const importedGender = normalizeGender(s.gender);
        setGender(importedGender);
        setGoal(normalizeGoal(s.goal, importedGender));
        if (Object.prototype.hasOwnProperty.call(s, "styleOverride")) setStyleOverride(s.styleOverride || null);
        Array.isArray(s.customDays) && setCustomDays(s.customDays);
        if (Object.prototype.hasOwnProperty.call(s, "macros")) setMacros(s.macros || null);
        setRestTimerPrefs(normalizeRestTimerPrefs(s.restTimerPrefs));
        if (typeof s.onboarded === "boolean") setOnboarded(s.onboarded);
        note("Imported");
      } catch (e) {
        note("Import failed");
      }
    };
    rd.onerror = () => note("Import failed — file could not be read");
    rd.readAsText(file);
  };
  const importGarminFiles = async files => {
    const selected = Array.from(files || []);
    if (!selected.length) throw new Error("Choose at least one Garmin FIT or CSV file.");

    const importedSessions = [];
    const warnings = [];
    const failedFiles = [];
    let skippedRows = 0;
    for (const file of selected) {
      try {
        const name = String(file.name || "");
        const lowerName = name.toLowerCase();
        let parsed;
        if (lowerName.endsWith(".fit")) {
          parsed = await parseGarminFit(await file.arrayBuffer(), {
            sourceFile: name,
            device: "Garmin fēnix 6X"
          });
        } else if (lowerName.endsWith(".csv") || file.type === "text/csv") {
          parsed = parseGarminCsv(await file.text(), {
            sourceFile: name,
            device: "Garmin fēnix 6X"
          });
        } else {
          throw new Error("Use a .FIT or .CSV file.");
        }
        importedSessions.push(...parsed.sessions);
        skippedRows += Number(parsed.skippedRows) || 0;
        warnings.push(...(parsed.warnings || []).map(warning => `${name}: ${warning}`));
      } catch (error) {
        failedFiles.push(`${file.name || "File"}: ${error?.message || "Import failed"}`);
      }
    }

    if (!importedSessions.length) {
      throw new Error(failedFiles[0] || "No Garmin activities were found.");
    }
    const merged = mergeGarminSessions(sessions, importedSessions);
    const restoredKeys = new Set(importedSessions.map(session => recordTombstoneKey("sessions", session)));
    setDeletedRecords(current => {
      if (!restoredKeys.size || !current?.sessions) return current;
      const nextSessions = Object.fromEntries(
        Object.entries(current.sessions).filter(([key]) => !restoredKeys.has(key)),
      );
      return nextSessions === current.sessions ? current : { ...current, sessions: nextSessions };
    });
    setSessions(merged.sessions);
    note(merged.added
      ? `${merged.added} Garmin activit${merged.added === 1 ? "y" : "ies"} imported`
      : "Garmin import already up to date");
    return {
      ...merged,
      files: selected.length,
      parsed: importedSessions.length,
      skippedRows,
      warnings,
      failedFiles
    };
  };
  const exerciseGuideItems = collectExerciseGuideItems(sessions, active);
  const activeExerciseNames = (Array.isArray(active?.entries) ? active.entries : [])
    .map((entry) => entry?.ex || entry?.name)
    .filter(Boolean);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: C.bg,
      color: C.txt,
      paddingBottom: 50,
      fontFamily: "'Archivo',-apple-system,sans-serif"
    }
  }, /*#__PURE__*/React.createElement("style", null, `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Archivo:wght@400;500;600;700&display=swap');
        input::-webkit-outer-spin-button,input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
        input[type=number]{-moz-appearance:textfield;} select{-webkit-appearance:none;appearance:none;}
        .ttl{font-family:'Oswald',sans-serif;text-transform:uppercase;letter-spacing:1px;}
        button{transition:all .15s;}
      `), /*#__PURE__*/React.createElement("header", {
    style: {
      background: "linear-gradient(150deg,#17171b 0%,#0b0b0d 70%)",
      borderBottom: `2px solid ${C.red}`,
      padding: "20px 18px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "ttl",
    style: {
      fontSize: 26,
      fontWeight: 700,
      lineHeight: 1,
      margin: 0
    }
  }, "IRON", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.red
    }
  }, "DESK"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: C.dim,
      letterSpacing: 2
    }
  }, "PRO")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.dim,
      fontSize: 11.5,
      marginTop: 4
    }
  }, flash ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.green
    }
  }, flash) : "Strength training system")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      background: "#1f1f25",
      borderRadius: 8,
      padding: 3
    }
  }, [["home", "Home"], ["gym", "Gym"]].map(([m, l]) => /*#__PURE__*/React.createElement("button", {
    key: m,
    type: "button",
    "aria-pressed": mode === m,
    title: active?.mode && active.mode !== m
      ? `Finish or discard the current ${active.mode === "gym" ? "Gym" : "Home"} workout before switching`
      : `Use ${l} equipment`,
    onClick: () => selectTrainingMode(m),
    className: "ttl",
    style: {
      padding: "6px 12px",
      minHeight: 32,
      borderRadius: 6,
      border: "none",
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 700,
      background: mode === m ? C.red : "transparent",
      color: mode === m ? "#fff" : C.dim
    }
  }, l)))), /*#__PURE__*/React.createElement(PrimaryNavigation, {
    tab,
    setTab,
    hasActiveWorkout: Boolean(active)
  })), /*#__PURE__*/React.createElement(AppUpdateBanner, null), /*#__PURE__*/React.createElement("main", {
    style: {
      maxWidth: 820,
      margin: "0 auto",
      padding: "16px 14px"
    }
  }, /*#__PURE__*/React.createElement(Boundary, {
    tabKey: tab
  }, tab === "today" && /*#__PURE__*/React.createElement(Today, {
    mode,
    maxes,
    setMaxes,
    tm,
    roundLoad,
    plates,
    bar,
    active,
    setActive,
    clearActiveWorkout,
    sessions,
    prMap,
    note,
    setTab,
    progress,
    setProgress,
    gender,
    goal,
    setGender,
    setGoal,
    cardioLog,
    setCardioLog,
    styleOverride,
    setStyleOverride,
    customDays,
    setCustomDays,
    onboarded,
    setOnboarded,
    restTimerPrefs,
    setRestTimerPrefs,
    onWorkoutComplete: completeWorkoutSession
  }), tab === "program" && /*#__PURE__*/React.createElement(ProgramTab, {
    mode,
    tm,
    roundLoad,
    progress,
    setProgress,
    note,
    gender,
    goal,
    setGender,
    setGoal,
    styleOverride,
    onStartWorkout: startProgramWorkout
  }), tab === "guide" && /*#__PURE__*/React.createElement(ExerciseGuide, {
    items: exerciseGuideItems,
    activeExerciseNames,
    note,
    onReturnToWorkout: active ? () => setTab("today") : null
  }), tab === "core" && /*#__PURE__*/React.createElement(CoreTab, {
    mode,
    note,
    onComplete: recordTrainingSession
  }), tab === "hiit" && /*#__PURE__*/React.createElement(HiitTab, {
    note,
    mode,
    onComplete: recordTrainingSession
  }), tab === "mma" && /*#__PURE__*/React.createElement(DisciplineTab, {
    id: "mma",
    note: note,
    mode,
    onComplete: recordTrainingSession
  }), tab === "pilates" && /*#__PURE__*/React.createElement(DisciplineTab, {
    id: "pilates",
    note: note,
    mode,
    onComplete: recordTrainingSession
  }), tab === "yoga" && /*#__PURE__*/React.createElement(DisciplineTab, {
    id: "yoga",
    note: note,
    mode,
    onComplete: recordTrainingSession
  }), tab === "macros" && /*#__PURE__*/React.createElement(MacrosTab, {
    macros,
    setMacros
  }), tab === "crew" && /*#__PURE__*/React.createElement(Crew, {
    sessions,
    maxes,
    crewRef,
    note
  }), tab === "history" && /*#__PURE__*/React.createElement(History, {
    sessions,
    onDeleteSession: session => deleteTrackedRecord("sessions", session),
    onRetryHealthConnect: retryHealthConnectWrite,
    canUseHealthConnect: isNativeHealthConnect(),
    exportCsv
  }), tab === "connections" && /*#__PURE__*/React.createElement(Connections, {
    firebaseReady: FB.ready,
    cloudUser,
    cloudEnabled,
    cloudStatus,
    updateCloudEnabled,
    syncCloudNow,
    cloudSignIn: FB.signIn,
    cloudSignUp: FB.signUp,
    cloudSignOut: FB.signOut,
    healthLog,
    healthAutoSync,
    setHealthAutoSync,
    healthWriteEnabled,
    setHealthWriteEnabled,
    healthSyncStatus,
    syncHealthNow,
    clearHealthData: () => {
      const clearedAt = Date.now();
      setHealthLog([]);
      setHealthLogClearedAt(clearedAt);
      setBwLog(current => current.filter(entry => entry?.source !== "health-connect"));
      setHealthSyncStatus({
        state: "idle",
        message: "Health Connect summaries were removed from IronDesk.",
        syncedAt: null
      });
      try {
        localStorage.removeItem(HEALTH_CONNECT_LAST_SYNC_KEY);
      } catch {}
    },
    importGarminFiles,
    setTab
  }), tab === "garmin" && /*#__PURE__*/React.createElement(React.Suspense, {
    fallback: /*#__PURE__*/React.createElement("div", {
      className: "garmin-bridge-loading",
      role: "status"
    }, "Loading Garmin Bridge…")
  }, /*#__PURE__*/React.createElement(GarminBridge, {
    sessions,
    note,
    onOpenImport: () => setTab("connections")
  })), tab === "trends" && /*#__PURE__*/React.createElement(Trends, {
    sessions,
    bwLog,
    setBwLog,
    cardioLog,
    setCardioLog,
    healthLog,
    note,
    onDeleteBodyweight: entry => deleteTrackedRecord("bwLog", entry),
    onDeleteCardio: entry => deleteTrackedRecord("cardioLog", entry)
  }), tab === "tools" && /*#__PURE__*/React.createElement(Tools, {
    mode,
    plates,
    bar,
    roundLoad,
    maxes
  }), tab === "ideas" && /*#__PURE__*/React.createElement(IdeasTab, {
    setTab
  }), tab === "settings" && /*#__PURE__*/React.createElement(Settings, {
    maxes,
    setMaxes,
    plates,
    setPlates,
    bar,
    setBar,
    mode,
    exportJson,
    exportCsv,
    exportSetCsv,
    importData,
    sessions,
    gender,
    goal,
    setGender,
    setGoal,
    restTimerPrefs,
    setRestTimerPrefs
  }))));
}

/* ============ TODAY (live workout) ============ */
function TodayCommandCard({
  mode,
  goal,
  progress,
  focusKey,
  dayIndex,
  totalDays,
  lastTrained,
  onStart,
  onPrevious,
  onNext,
  onOpenProgram
}) {
  const focus = FOCUS[focusKey] || FOCUS.Upper;
  const swipeStartRef = useRef(null);
  const startSwipe = event => {
    swipeStartRef.current = {
      x: event.clientX,
      y: event.clientY
    };
  };
  const finishSwipe = event => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (deltaX < 0) onNext();else onPrevious();
  };
  return (
    <section
      className="today-command-card"
      aria-labelledby="today-command-title"
      onPointerDown={startSwipe}
      onPointerUp={finishSwipe}
    >
      <div className="today-command-heading">
        <div>
          <span className="today-command-kicker">TODAY&apos;S PLAN</span>
          <h2 id="today-command-title">{focus.title}</h2>
          <p>{GOALS[goal].label} · {mode === "gym" ? "Gym" : "Home"}</p>
        </div>
        <div className="today-command-controls">
          <span className="today-command-week">B{progress.blockNum} · W{progress.week}</span>
          <div className="today-command-day-nav" aria-label="Choose workout day">
            <button type="button" aria-label="Previous workout day" onClick={onPrevious}>‹</button>
            <span>{dayIndex + 1}/{totalDays}</span>
            <button type="button" aria-label="Next workout day" onClick={onNext}>›</button>
          </div>
        </div>
      </div>
      <div className="today-command-meta">
        <span><small>Session</small><strong>Day {dayIndex + 1} of {totalDays}</strong></span>
        <span><small>Last trained</small><strong>{lastTrained ? lastTrained.slice(5) : "First session"}</strong></span>
        <span><small>Focus</small><strong>{focus.title}</strong></span>
      </div>
      <p className="today-command-swipe">Swipe the card or use the arrows to change workout day.</p>
      <div className="today-command-actions">
        <button type="button" className="today-command-start" onClick={onStart}>Start {focus.title}</button>
        <button type="button" className="today-command-program" onClick={onOpenProgram}>View program</button>
      </div>
    </section>
  );
}

function Today({
  mode,
  maxes,
  setMaxes,
  tm,
  roundLoad,
  plates,
  bar,
  active,
  setActive,
  clearActiveWorkout,
  sessions,
  prMap,
  note,
  setTab,
  progress,
  setProgress,
  gender,
  goal,
  setGender,
  setGoal,
  cardioLog,
  setCardioLog,
  styleOverride,
  setStyleOverride,
  customDays,
  setCustomDays,
  onboarded,
  setOnboarded,
  restTimerPrefs,
  setRestTimerPrefs,
  onWorkoutComplete
}) {
  const week = GOALS[goal].week;
  const dayIds = week.map(focusKey => (FOCUS[focusKey] || FOCUS.Upper).title);
  const dayIndex = resolveWorkoutDayIndex(progress, dayIds, sessions);
  const selectedFocusKey = week[dayIndex] || week[0];
  const [builder, setBuilder] = useState(false);
  const [planQ, setPlanQ] = useState(false);
  const [timerNow, setTimerNow] = useState(Date.now());
  const completedTimerRef = useRef(0);
  const combinedCardioLog = useMemo(
    () => mergeCardioTrendRecords(cardioLog, sessions),
    [cardioLog, sessions],
  );
  const selectDay = nextDayIndex => {
    setProgress(current => selectWorkoutDay(current, nextDayIndex, week.length));
  };
  const openExerciseGuide = exerciseName => {
    try {
      sessionStorage.setItem("irondesk:exercise-guide-query", exerciseName);
    } catch {}
    setTab("guide");
  };
  const timerEndAt = Number(active?.restTimerEndAt) || 0;
  const timer = timerEndAt > 0 ? Math.max(0, Math.ceil((timerEndAt - timerNow) / 1000)) : 0;
  useEffect(() => {
    if (!timerEndAt) return undefined;
    const tick = () => {
      const now = Date.now();
      setTimerNow(now);
      if (now >= timerEndAt) {
        setActive(current => {
          if (!current || Number(current.restTimerEndAt) !== timerEndAt) return current;
          return {
            ...current,
            restTimerEndAt: null,
            restTimerDuration: 0
          };
        });
        if (completedTimerRef.current !== timerEndAt) {
          completedTimerRef.current = timerEndAt;
          if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
          note("Rest complete");
        }
      }
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [timerEndAt, setActive, note]);
  const clearRestTimer = () => setActive(current => current ? {
    ...current,
    restTimerEndAt: null,
    restTimerDuration: 0
  } : current);
  const extendRestTimer = seconds => setActive(current => current ? {
    ...current,
    restTimerEndAt: Math.max(Date.now(), Number(current.restTimerEndAt) || Date.now()) + seconds * 1000,
    restTimerDuration: Math.max(0, Number(current.restTimerDuration) || 0) + seconds
  } : current);
  const start = (focusKey, programDayIndex) => {
    const selectedProgress = selectWorkoutDay(progress, programDayIndex, week.length);
    setProgress(selectedProgress);
    setActive(createGeneratedActiveWorkout({
      focusKey,
      programDayIndex: selectedProgress.dayIndex,
      goal,
      mode,
      progress: selectedProgress,
      tm,
      roundLoad,
      styleOverride,
    }));
  };
  const startCustom = cd => {
    setActive({
      id: uid(),
      date: today(),
      dayId: cd.name,
      focusKey: "custom",
      mode,
      goal,
      blockNum: progress.blockNum,
      week: progress.week,
      start: Date.now(),
      entries: cd.rows.map(r => ({
        ex: r.ex,
        heavy: false,
        drop: false,
        role: r.role || "acc",
        db: /\bDB\b|Dumbbell/i.test(r.ex),
        note: "",
        lift: null,
        target: null,
        targetReps: r.reps,
        plannedSetCount: Number(r.sets) || 3,
        sets: Array(Number(r.sets) || 3).fill(null).map(() => ({
          w: "",
          r: Number(r.reps) || 10,
          done: false
        }))
      }))
    });
  };
  const setSet = (ei, si, field, val) => {
    setActive(current => current ? {
      ...current,
      entries: current.entries.map((en, i) => i !== ei ? en : {
        ...en,
        sets: en.sets.map((s, j) => j !== si ? s : {
          ...s,
          [field]: val
        })
      })
    } : current);
  };
  const toggleDone = (ei, si) => {
    setActive(current => {
      if (!current) return current;
      const entry = current.entries[ei];
      const currentSet = entry.sets[si];
      const nowDone = !currentSet.done;
      const restSeconds = nowDone ? restDurationForEntry(restTimerPrefs, entry) : 0;
      return {
        ...current,
        restTimerEndAt: restSeconds ? Date.now() + restSeconds * 1000 : current.restTimerEndAt,
        restTimerDuration: restSeconds || current.restTimerDuration || 0,
        entries: current.entries.map((item, entryIndex) => entryIndex !== ei ? item : {
          ...item,
          sets: item.sets.map((set, setIndex) => setIndex !== si ? set : {
            ...set,
            done: nowDone
          })
        })
      };
    });
  };
  const addSet = ei => {
    setActive(current => current ? {
      ...current,
      entries: current.entries.map((en, i) => i !== ei ? en : {
        ...en,
        plannedSetCount: Number(en.plannedSetCount) || en.sets.length,
        sets: [...en.sets, {
          w: en.sets[en.sets.length - 1]?.w || "",
          r: en.targetReps,
          done: false
        }]
      })
    } : current);
  };
  const removeLastSet = ei => {
    setActive(current => removeLastWorkoutSet(current, ei));
  };
  const finish = () => {
    const completedAt = Date.now();
    const entries = active.entries.map(en => ({
      ex: en.ex,
      heavy: en.heavy,
      lift: en.lift,
      role: en.role,
      db: !!en.db,
      sets: en.sets.filter(s => s.done && Number(s.w) >= 0 && Number(s.r) > 0).map(s => ({
        w: Number(s.w),
        r: Number(s.r)
      }))
    })).filter(en => en.sets.length > 0);
    if (entries.length === 0) {
      note("Nothing logged");
      return;
    }
    const volume = workoutVolume(entries);
    const prs = [];
    entries.forEach(en => {
      const eligible = en.sets.filter(s => isValidE1RMSet(s.w, s.r));
      if (eligible.length === 0) return;
      const best = Math.max(...eligible.map(s => epley(s.w, s.r)));
      if (best > (prMap[en.ex] || 0)) prs.push({
        ex: en.ex,
        e1rm: Math.round(best)
      });
    });
    const session = {
      id: active.id,
      date: active.date,
      dayId: active.dayId,
      focusKey: active.focusKey,
      programDayIndex: active.programDayIndex,
      blockNum: active.blockNum,
      week: active.week,
      mode: active.mode,
      startedAt: active.start,
      completedAt,
      durationMin: Math.max(1, Math.round((completedAt - active.start) / 60000)),
      entries,
      volume,
      prs
    };
    onWorkoutComplete(session);
    const generatedWorkout = week.includes(active.focusKey);
    if (generatedWorkout) {
      const nextProgress = advanceWorkoutProgress({
        progress,
        focusKeys: week,
        completedFocusKey: active.focusKey,
        completedDayIndex: active.programDayIndex,
        completedWeek: active.week,
        completedBlockNum: active.blockNum
      });
      const nextFocusKey = week[nextProgress.dayIndex] || week[0];
      setProgress(nextProgress);
      note(prs.length
        ? `Saved with ${prs.length} PR${prs.length > 1 ? "s" : ""} · ${(FOCUS[nextFocusKey] || FOCUS.Upper).title} is next`
        : `Workout saved · ${(FOCUS[nextFocusKey] || FOCUS.Upper).title} is next`);
    } else {
      note(prs.length ? `Done — ${prs.length} PR${prs.length > 1 ? "s" : ""}!` : "Workout saved");
    }
    clearActiveWorkout();
    setTab("today");
  };
  if (!active) {
    const lastByDay = {};
    sessions.forEach(s => {
      if (!lastByDay[s.dayId]) lastByDay[s.dayId] = s.date;
    });
    const setGenderGoal = g => {
      setGender(g);
      setGoal(GENDER_DEFAULT_GOAL[g]);
    };
    if (planQ) return /*#__PURE__*/React.createElement(PlanBuilder, {
      setMaxes,
      setGoal,
      setGender,
      setStyleOverride,
      setOnboarded,
      done: () => setPlanQ(false),
      note
    });
    if (builder) return /*#__PURE__*/React.createElement(CustomBuilder, {
      mode,
      customDays,
      setCustomDays,
      startCustom,
      done: () => setBuilder(false),
      note
    });
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(TodayCommandCard, {
      mode,
      goal,
      progress,
      focusKey: selectedFocusKey,
      dayIndex,
      totalDays: week.length,
      lastTrained: lastByDay[(FOCUS[selectedFocusKey] || FOCUS.Upper).title],
      onStart: () => start(selectedFocusKey, dayIndex),
      onPrevious: () => selectDay(dayIndex - 1),
      onNext: () => selectDay(dayIndex + 1),
      onOpenProgram: () => setTab("program")
    }), !onboarded && /*#__PURE__*/React.createElement("div", {
      style: {
        background: "linear-gradient(135deg,#e11d2a22,#0b0b0d)",
        border: `1px solid ${C.red}`,
        borderRadius: 14,
        padding: 16,
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "ttl",
      style: {
        fontSize: 16,
        fontWeight: 700
      }
    }, "New here? Build your plan"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        color: C.dim,
        margin: "4px 0 12px",
        lineHeight: 1.5
      }
    }, "Answer 5 quick questions and IronDesk builds a program to ", /*#__PURE__*/React.createElement("b", null, "your"), " level — no one else's numbers, no pressure."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setPlanQ(true),
      style: {
        flex: 2,
        padding: "11px",
        background: C.red,
        border: "none",
        borderRadius: 10,
        color: "#fff",
        fontFamily: "'Oswald'",
        fontWeight: 700,
        fontSize: 13,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Build My Plan"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setOnboarded(true),
      style: {
        flex: 1,
        padding: "11px",
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        color: C.dim,
        fontFamily: "'Oswald'",
        fontWeight: 600,
        fontSize: 12,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Skip"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setBuilder(true),
      style: {
        flex: 1,
        padding: "12px",
        background: C.panel2,
        border: `1px solid ${C.gold}`,
        borderRadius: 10,
        color: C.gold,
        fontFamily: "'Oswald'",
        fontWeight: 700,
        fontSize: 12.5,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "✎ Build Your Own"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setPlanQ(true),
      style: {
        flex: 1,
        padding: "12px",
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        color: C.txt,
        fontFamily: "'Oswald'",
        fontWeight: 700,
        fontSize: 12.5,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "⚙ Personalize (5 Q)")), customDays && customDays.length > 0 && /*#__PURE__*/React.createElement(Panel, {
      title: "Your Custom Workouts",
      sub: "Built by you — tap to run"
    }, customDays.map(cd => /*#__PURE__*/React.createElement("div", {
      key: cd.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 0",
        borderBottom: `1px solid ${C.line}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600
      }
    }, cd.name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.dim
      }
    }, cd.rows.length, " exercises")), /*#__PURE__*/React.createElement("button", {
      onClick: () => startCustom(cd),
      style: {
        padding: "8px 14px",
        background: C.red,
        border: "none",
        borderRadius: 8,
        color: "#fff",
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer"
      }
    }, "Start"), /*#__PURE__*/React.createElement("button", {
      onClick: () => setCustomDays(customDays.filter(x => x.id !== cd.id)),
      style: {
        background: "none",
        border: "none",
        color: C.dim,
        cursor: "pointer",
        fontSize: 16
      }
    }, "×")))), /*#__PURE__*/React.createElement(Panel, {
      title: "What are you training for?",
      sub: "Set it once — your day and week generate from this"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.dim,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6
      }
    }, "Profile"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 14
      }
    }, [["women", "Women"], ["men", "Men"]].map(([g, l]) => /*#__PURE__*/React.createElement("button", {
      key: g,
      onClick: () => setGenderGoal(g),
      className: "ttl",
      style: {
        flex: 1,
        padding: "9px",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12.5,
        fontWeight: 700,
        background: gender === g ? C.red : C.panel2,
        color: gender === g ? "#fff" : C.dim,
        border: `1px solid ${C.line}`
      }
    }, l))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.dim,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 6
      }
    }, "Goal"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, Object.entries(GOALS).map(([k, g]) => /*#__PURE__*/React.createElement("button", {
      key: k,
      onClick: () => setGoal(k),
      style: {
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 8,
        cursor: "pointer",
        background: goal === k ? "rgba(225,29,42,.13)" : C.panel2,
        color: C.txt,
        border: `1px solid ${goal === k ? C.red : C.line}`,
        fontSize: 13.5,
        fontWeight: goal === k ? 700 : 500
      }
    }, g.label)))), /*#__PURE__*/React.createElement(Panel, {
      title: "This Week",
      sub: `${mode === "gym" ? "Gym" : "Home"} · ${GOALS[goal].label} · Block ${progress.blockNum} · Week ${progress.week}/6`
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (progress.week > 1) setProgress({
          ...progress,
          week: progress.week - 1,
          dayIndex: 0,
          updatedAt: Date.now()
        });else if (progress.blockNum > 1) setProgress({
          blockNum: progress.blockNum - 1,
          week: 6,
          dayIndex: 0,
          updatedAt: Date.now()
        });
      },
      style: {
        flex: 1,
        padding: "9px",
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        color: C.dim,
        fontFamily: "'Oswald'",
        fontSize: 11.5,
        fontWeight: 600,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "‹ Prev Week"), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        if (progress.week < 6) {
          setProgress({
            ...progress,
            week: progress.week + 1,
            dayIndex: 0,
            updatedAt: Date.now()
          });
          note(`Week ${progress.week + 1}`);
        } else {
          setProgress({
            blockNum: progress.blockNum + 1,
            week: 1,
            dayIndex: 0,
            updatedAt: Date.now()
          });
          note(`Block ${progress.blockNum + 1}`);
        }
      },
      style: {
        flex: 1,
        padding: "9px",
        background: progress.week >= 6 ? C.gold : C.red,
        border: "none",
        borderRadius: 8,
        color: "#fff",
        fontFamily: "'Oswald'",
        fontSize: 11.5,
        fontWeight: 700,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, progress.week >= 6 ? "Next Block ›" : "Next Week ›")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8
      }
    }, week.map((fk, idx) => {
      const f = FOCUS[fk] || FOCUS.Upper;
      const heavy = GOALS[goal].style === "strength";
      return /*#__PURE__*/React.createElement("button", {
        key: idx,
        onClick: () => {
          selectDay(idx);
          start(fk, idx);
        },
        style: {
          background: C.panel2,
          border: `1px solid ${idx === dayIndex ? C.gold : heavy ? C.red : C.blue}`,
          borderRadius: 12,
          padding: "13px 10px",
          cursor: "pointer",
          textAlign: "left"
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: C.dim,
          letterSpacing: 0.5
        }
      }, "DAY ", idx + 1, idx === dayIndex ? " · NEXT" : ""), /*#__PURE__*/React.createElement("div", {
        className: "ttl",
        style: {
          fontSize: 14,
          fontWeight: 700,
          color: C.txt
        }
      }, f.title), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 10.5,
          color: C.dim,
          marginTop: 3
        }
      }, lastByDay[f.title] ? `Last: ${lastByDay[f.title].slice(5)}` : "Tap to start"));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.dim,
        marginTop: 12,
        lineHeight: 1.5
      }
    }, "Use Prev/Next to move through the 6-week block — exercises and loads shift each week, just like the Program tab.")), /*#__PURE__*/React.createElement(Stopwatch, null), /*#__PURE__*/React.createElement(CardioQuickLog, {
      cardioLog: cardioLog,
      trendLog: combinedCardioLog,
      setCardioLog: setCardioLog,
      note: note
    }), /*#__PURE__*/React.createElement(WeekSummary, {
      sessions: sessions
    }));
  }
  const heavyDay = GOALS[active.goal || goal].style === "strength";
  const doneCount = active.entries.reduce((a, en) => a + en.sets.filter(s => s.done).length, 0);
  const totalCount = active.entries.reduce((a, en) => a + en.sets.length, 0);
  return /*#__PURE__*/React.createElement(React.Fragment, null, timer > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "sticky",
      top: 8,
      zIndex: 5,
      background: C.red,
      borderRadius: 12,
      padding: "12px 16px",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14,
      boxShadow: "0 4px 20px rgba(225,29,42,.35)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: "#fff"
    }
  }, "REST"), /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 26,
      fontWeight: 700,
      color: "#fff"
    }
  }, Math.floor(timer / 60), ":", String(timer % 60).padStart(2, "0")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => extendRestTimer(30),
    style: {
      background: "rgba(0,0,0,.18)",
      border: "1px solid rgba(255,255,255,.25)",
      borderRadius: 6,
      color: "#fff",
      padding: "6px 9px",
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, "+30"), /*#__PURE__*/React.createElement("button", {
    onClick: clearRestTimer,
    style: {
      background: "rgba(0,0,0,.25)",
      border: "none",
      borderRadius: 6,
      color: "#fff",
      padding: "6px 9px",
      fontSize: 12,
      fontWeight: 700,
      cursor: "pointer"
    }
  }, "SKIP"))), /*#__PURE__*/React.createElement(Panel, {
    title: `${active.dayId} — Live`,
    sub: `${doneCount}/${totalCount} sets done · started ${new Date(active.start).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    })}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "live-rest-control"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, "Auto rest"), /*#__PURE__*/React.createElement("span", null, restTimerPrefs.enabled ? `${restTimerPrefs.accessorySeconds}s accessory · ${restTimerPrefs.heavySeconds}s heavy` : "Timer will not start after sets")), /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": restTimerPrefs.enabled,
    onClick: () => setRestTimerPrefs(current => ({
      ...current,
      enabled: !current.enabled
    })),
    className: `switch-button ${restTimerPrefs.enabled ? "is-on" : ""}`
  }, restTimerPrefs.enabled ? "ON" : "OFF")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      background: C.panel2,
      borderRadius: 3,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 6,
      width: `${totalCount ? doneCount / totalCount * 100 : 0}%`,
      background: heavyDay ? C.red : C.blue,
      borderRadius: 3,
      transition: "width .3s"
    }
  })), active.entries.map((en, ei) => {
    const isCardio = en.role === "cardio",
      isAb = en.role === "ab",
      isDB = !!en.db;
    return /*#__PURE__*/React.createElement("div", {
      key: ei,
      style: {
        marginBottom: 18,
        background: C.panel2,
        borderRadius: 12,
        padding: "12px 12px 8px",
        border: `1px solid ${C.line}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14.5,
        fontWeight: 700
      }
    }, en.ex, en.heavy && /*#__PURE__*/React.createElement(Badge, {
      color: C.red
    }, "HEAVY"), en.drop && /*#__PURE__*/React.createElement(Badge, {
      color: C.blue
    }, "DROP"), isCardio && /*#__PURE__*/React.createElement(Badge, {
      color: C.green
    }, "CARDIO"), isAb && /*#__PURE__*/React.createElement(Badge, {
      color: C.gold
    }, "CORE"), isDB && /*#__PURE__*/React.createElement(Badge, {
      color: C.blue
    }, "PER DB"), en.note === "Glute focus" && /*#__PURE__*/React.createElement(Badge, {
      color: C.gold
    }, "GLUTES")), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: C.gold,
        fontWeight: 700
      }
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      className: "exercise-howto-inline",
      onClick: () => openExerciseGuide(en.ex),
      "aria-label": `How to perform ${en.ex}`
    }, "How to"), isCardio ? `${en.targetReps} min` : `${en.sets.length}×${en.targetReps}`)), (en.note || en.target) && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.dim,
        marginBottom: 8
      }
    }, en.target ? `Target ${en.target} lb${isDB || en.note ? " · " : ""}` : "", isDB ? "Weight is per dumbbell" : en.note), en.target && !isCardio && !isAb && !isDB && /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement(LoadChips, {
      total: en.target,
      bar: bar,
      plates: plates
    })), en.sets.map((s, si) => /*#__PURE__*/React.createElement("div", {
      key: si,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 22,
        fontSize: 11,
        color: C.dim,
        fontWeight: 700
      }
    }, isCardio ? "" : si + 1), isCardio ? /*#__PURE__*/React.createElement(MiniIn, {
      value: s.r,
      onChange: v => setSet(ei, si, "r", v),
      suffix: "min"
    }) : isAb ? /*#__PURE__*/React.createElement(MiniIn, {
      value: s.r,
      onChange: v => setSet(ei, si, "r", v),
      suffix: "reps"
    }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MiniIn, {
      value: s.w,
      onChange: v => setSet(ei, si, "w", v),
      suffix: isDB ? "/DB" : "lb"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.dim,
        fontSize: 12
      }
    }, "×"), /*#__PURE__*/React.createElement(MiniIn, {
      value: s.r,
      onChange: v => setSet(ei, si, "r", v),
      suffix: "reps"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => toggleDone(ei, si),
      style: {
        width: 70,
        padding: "8px 0",
        borderRadius: 8,
        border: `1px solid ${s.done ? C.green : C.line}`,
        background: s.done ? "rgba(74,222,128,.15)" : C.panel,
        color: s.done ? C.green : C.dim,
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer"
      }
    }, s.done ? "✓ DONE" : "LOG"))), !isCardio && /*#__PURE__*/React.createElement("div", {
      className: "live-set-actions"
    }, /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => addSet(ei)
    }, "+ Add Set"), en.sets.length > (Number(en.plannedSetCount) || en.sets.length) && /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: () => removeLastSet(ei),
      className: "is-remove",
      "aria-label": `Remove last ${en.ex} set`
    }, "− Remove Last Set")));
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (window.confirm("Discard this workout?")) {
        clearActiveWorkout();
        note("Workout discarded");
      }
    },
    style: {
      flex: 1,
      padding: "13px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: 1,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Discard"), /*#__PURE__*/React.createElement("button", {
    onClick: finish,
    style: {
      flex: 2,
      padding: "13px",
      background: C.red,
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "'Oswald'",
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: 1,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Finish Workout"))), /*#__PURE__*/React.createElement(Stopwatch, null));
}
function WeekSummary({
  sessions
}) {
  const cut = localDateKey(new Date(Date.now() - 7 * 864e5));
  const wk = (Array.isArray(sessions) ? sessions : []).filter(s => String(s?.date || "") >= cut);
  const vol = wk.reduce((a, s) => a + safeSessionVolume(s), 0);
  const prs = wk.reduce((a, s) => a + (s.prs?.length || 0), 0);
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Last 7 Days",
    sub: "Rolling week at a glance"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement(Stat, {
    label: "Sessions",
    value: wk.length,
    color: C.txt
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Volume (lb)",
    value: vol.toLocaleString(),
    color: C.gold
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "PRs",
    value: prs,
    color: C.green
  })));
}

/* ============ PROGRAM ============ */
function ProgramTab({
  mode,
  tm,
  roundLoad,
  progress,
  setProgress,
  note,
  gender,
  goal,
  setGender,
  setGoal,
  styleOverride,
  onStartWorkout
}) {
  const g = GOALS[goal];
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.min(g.week.length - 1, Math.max(0, Number(progress.dayIndex) || 0)));
  const selectedFocusIndex = Math.min(g.week.length - 1, Math.max(0, focusIndex));
  const fk = g.week[selectedFocusIndex] || g.week[0];
  const gen = generateDay(fk, goal, mode, progress.blockNum, progress.week - 1, tm, roundLoad, styleOverride);
  const deload = gen.deload;
  const advanceWeek = () => {
    if (progress.week < 6) {
      setProgress({
        ...progress,
        week: progress.week + 1,
        dayIndex: 0,
        updatedAt: Date.now()
      });
      note(`Week ${progress.week + 1}`);
    } else {
      setProgress({
        blockNum: progress.blockNum + 1,
        week: 1,
        dayIndex: 0,
        updatedAt: Date.now()
      });
      note(`Block ${progress.blockNum + 1} \u2014 new variations`);
    }
  };
  const backWeek = () => {
    if (progress.week > 1) setProgress({
      ...progress,
      week: progress.week - 1,
      dayIndex: 0,
      updatedAt: Date.now()
    });else if (progress.blockNum > 1) setProgress({
      blockNum: progress.blockNum - 1,
      week: 6,
      dayIndex: 0,
      updatedAt: Date.now()
    });
  };
  const setGenderGoal = gx => {
    setGender(gx);
    setGoal(GENDER_DEFAULT_GOAL[gx]);
    setFocusIndex(0);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Your Plan",
    sub: "Goal drives the exercises, reps, and weekly split"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12
    }
  }, [["women", "Women"], ["men", "Men"]].map(([gx, l]) => /*#__PURE__*/React.createElement("button", {
    key: gx,
    onClick: () => setGenderGoal(gx),
    className: "ttl",
    style: {
      flex: 1,
      padding: "8px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      background: gender === gx ? C.red : C.panel2,
      color: gender === gx ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, Object.entries(GOALS).map(([k, gg]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => {
      setGoal(k);
      setFocusIndex(0);
    },
    style: {
      textAlign: "left",
      padding: "10px 12px",
      borderRadius: 8,
      cursor: "pointer",
      background: goal === k ? "rgba(225,29,42,.13)" : C.panel2,
      color: C.txt,
      border: `1px solid ${goal === k ? C.red : C.line}`,
      fontSize: 13.5,
      fontWeight: goal === k ? 700 : 500
    }
  }, gg.label)))), /*#__PURE__*/React.createElement(Panel, {
    title: "Block Progress",
    sub: "6-week cycle \\u00b7 week 6 deloads, then exercises rotate fresh"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 14,
      color: C.dim,
      letterSpacing: 1
    }
  }, "BLOCK ", progress.blockNum, " \\u00b7 WEEK ", progress.week, "/6"), /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: deload ? C.blue : C.red
    }
  }, deload ? "DELOAD" : g.style.toUpperCase())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      marginBottom: 12
    }
  }, [1, 2, 3, 4, 5, 6].map(i => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      background: i <= progress.week ? i === 6 ? C.blue : C.red : C.panel2
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: backWeek,
    style: {
      flex: 1,
      padding: "11px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 600,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "\\u2039 Back"), /*#__PURE__*/React.createElement("button", {
    onClick: advanceWeek,
    style: {
      flex: 2,
      padding: "11px",
      background: progress.week >= 6 ? C.gold : C.red,
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "'Oswald'",
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, progress.week >= 6 ? "Start Next Block \u2192" : "Advance Week \u2192"))), /*#__PURE__*/React.createElement(Panel, {
    title: `Suggested Week \u2014 ${mode === "gym" ? "Gym" : "Home"}`,
    sub: "Tap a day to preview its generated workout"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      marginBottom: 12
    }
  }, g.week.map((k, i) => {
    const f = FOCUS[k] || FOCUS.Upper;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      onClick: () => setFocusIndex(i),
      className: "ttl",
      style: {
        background: selectedFocusIndex === i ? C.red : C.panel2,
        color: selectedFocusIndex === i ? "#fff" : C.dim,
        border: `1px solid ${C.line}`,
        borderRadius: 8,
        padding: "8px 11px",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer"
      }
    }, f.title);
  })), gen.rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "10px 0",
      borderBottom: i < gen.rows.length - 1 ? `1px solid ${C.line}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      flex: 1
    }
  }, r.ex, r.heavy && /*#__PURE__*/React.createElement(Badge, {
    color: C.red
  }, "HEAVY"), r.drop && /*#__PURE__*/React.createElement(Badge, {
    color: C.blue
  }, "DROP"), r.role === "cardio" && /*#__PURE__*/React.createElement(Badge, {
    color: C.green
  }, "CARDIO"), r.role === "ab" && /*#__PURE__*/React.createElement(Badge, {
    color: C.gold
  }, "CORE"), r.note === "Glute focus" && /*#__PURE__*/React.createElement(Badge, {
    color: C.gold
  }, "GLUTES")), /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: C.gold,
      whiteSpace: "nowrap"
    }
  }, r.role === "cardio" ? `${r.reps} min` : `${r.sets}\u00d7${r.reps}`, r.target ? ` \u00b7 ${r.target}` : "")))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => onStartWorkout(fk, selectedFocusIndex),
    style: {
      width: "100%",
      marginTop: 14,
      padding: "13px",
      background: C.red,
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "'Oswald'",
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: 1,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, `Start ${gen.id}`), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      marginTop: 10
    }
  }, "Core logs reps and cardio logs minutes \\u2014 neither asks for plate weight.")), /*#__PURE__*/React.createElement(Panel, {
    title: "Golden Rules",
    sub: "The strategy in six lines"
  }, RULES.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      gap: 10,
      padding: "7px 0",
      borderBottom: i < RULES.length - 1 ? `1px solid ${C.line}` : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      color: C.red,
      fontWeight: 700
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      lineHeight: 1.45
    }
  }, r)))));
}

/* ============ HISTORY ============ */
function History({
  sessions,
  onDeleteSession,
  onRetryHealthConnect,
  canUseHealthConnect,
  exportCsv
}) {
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [range, setRange] = useState("all");
  const [sort, setSort] = useState("newest");
  const filtered = useMemo(() => filterAndSortSessions(sessions, {
    query,
    mode: modeFilter,
    range,
    sort
  }), [sessions, query, modeFilter, range, sort]);
  const summary = useMemo(() => summarizeSessions(filtered), [filtered]);
  const hasFilters = Boolean(query) || modeFilter !== "all" || range !== "all";
  const del = target => {
    if (window.confirm("Delete this session?")) {
      onDeleteSession(target);
    }
  };
  const resetFilters = () => {
    setQuery("");
    setModeFilter("all");
    setRange("all");
  };
  return <React.Fragment>
    <section className="history-heading">
      <div className="history-heading-icon" aria-hidden="true">◷</div>
      <div>
        <div className="history-heading-kicker">Training &amp; Planning</div>
        <h2 className="ttl">Workout History</h2>
        <p>Search, filter, sort, and export IronDesk workouts and Garmin activities.</p>
      </div>
      <button type="button" className="history-export-button" onClick={exportCsv}>
        ↓ Garmin Import CSV
      </button>
    </section>

    <div className="history-dashboard">
      <aside className="history-filter-rail" aria-label="Workout history filters">
        <div className="history-filter-title">Workouts</div>
        {[
          ["all", "All sessions"],
          ["home", "Home"],
          ["gym", "Gym"],
          ["training", "Train"],
          ["garmin", "Garmin"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={`history-filter-button ${modeFilter === value ? "is-active" : ""}`}
            aria-pressed={modeFilter === value}
            onClick={() => setModeFilter(value)}
          >
            <span aria-hidden="true">
              {value === "all" ? "▦" : value === "home" ? "⌂" : value === "garmin" ? "G" : value === "training" ? "✓" : "◆"}
            </span>
            {label}
          </button>
        ))}
        <label className="history-filter-label" htmlFor="history-range">Date range</label>
        <select
          id="history-range"
          className="history-select"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        >
          <option value="all">All time</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="year">Last year</option>
        </select>
      </aside>

      <section className="history-results" aria-live="polite">
        <div className="history-toolbar">
          <label className="history-search">
            <span className="sr-only">Search workout history</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              placeholder="Search workout or exercise"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Sort workout history</span>
            <select
              className="history-select"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="volume">Highest volume</option>
              <option value="duration">Longest duration</option>
            </select>
          </label>
        </div>

        <div className="history-summary">
          <div><strong>{summary.sessions}</strong><span>Sessions</span></div>
          <div><strong>{Math.round(summary.volume).toLocaleString()}</strong><span>Volume lb</span></div>
          <div><strong>{summary.minutes.toLocaleString()}</strong><span>Minutes</span></div>
          <div><strong>{summary.prs}</strong><span>PRs</span></div>
        </div>

        {sessions.length === 0 && (
          <div className="history-empty">
            <strong>No workouts yet</strong>
            <span>Start a workout on Today. Finished sessions will appear here automatically.</span>
          </div>
        )}

        {sessions.length > 0 && filtered.length === 0 && (
          <div className="history-empty">
            <strong>No matching workouts</strong>
            <span>Try a different exercise, location, or date range.</span>
            <button type="button" onClick={resetFilters}>Clear filters</button>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="history-result-count">
            Showing {filtered.length} of {sessions.length}
            {hasFilters && <button type="button" onClick={resetFilters}>Reset</button>}
          </div>
        )}

        <div className="history-list">
          {filtered.map((session, sessionIndex) => {
            const sessionId = session.id || `${session.date}-${session.dayId}-${sessionIndex}`;
            const isOpen = open === sessionId;
            const entries = Array.isArray(session.entries) ? session.entries : [];
            const records = Array.isArray(session.prs) ? session.prs : [];
            const isGarmin = session.source === "garmin";
            const garminMetrics = isGarmin ? garminMetricItems(session) : [];
            const trackedSummary = trackedSessionSummary(session);
            return (
              <article
                className={`history-card ${isOpen ? "is-open" : ""} ${isGarmin ? "is-garmin" : ""}`}
                key={sessionId}
              >
                <div className="history-card-row">
                  <button
                    type="button"
                    className="history-card-toggle"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : sessionId)}
                  >
                    <span className="history-card-date">
                      {session.date || "No date"}
                      <small>{sessionTypeLabel(session)}</small>
                    </span>
                    <span className="history-card-main">
                      <strong>{session.dayId || "Workout"}</strong>
                      <small>
                        {isGarmin
                          ? `${Number(session.durationMin) || 0} min · ${session.garmin?.activityType || "Garmin activity"}`
                          : trackedSummary || `${Number(session.durationMin) || 0} min · ${Math.round(safeSessionVolume(session)).toLocaleString()} lb`}
                        {!isGarmin && records.length ? ` · ${records.length} PR${records.length === 1 ? "" : "s"}` : ""}
                      </small>
                    </span>
                    <span className="history-card-chevron" aria-hidden="true">{isOpen ? "⌃" : "⌄"}</span>
                  </button>
                  <button
                    type="button"
                    className="history-delete"
                    aria-label={`Delete ${session.dayId || "workout"} from ${session.date || "unknown date"}`}
                    onClick={() => del(session)}
                  >
                    ×
                  </button>
                </div>

                {isOpen && (
                  <div className="history-card-detail">
                    {isGarmin && (
                      <div className="garmin-history-summary">
                        <div className="garmin-history-source">
                          <span className="garmin-device-mark" aria-hidden="true">G</span>
                          <div>
                            <strong>{session.sourceDevice || "Garmin fēnix 6X"}</strong>
                            <small>{session.garmin?.sourceFile || "Garmin activity import"}</small>
                          </div>
                        </div>
                        {garminMetrics.length > 0 && (
                          <div className="garmin-metric-grid">
                            {garminMetrics.map(([label, value]) => (
                              <div key={label}><strong>{value}</strong><span>{label}</span></div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {!isGarmin && session.healthConnectWrite && (
                      <div className={`history-health-write is-${session.healthConnectWrite.state || "idle"}`}>
                        <div>
                          <strong>
                            {session.healthConnectWrite.state === "synced"
                              ? "Sent to Health Connect"
                              : session.healthConnectWrite.state === "pending"
                                ? "Sending to Health Connect…"
                                : "Health Connect writeback failed"}
                          </strong>
                          {session.healthConnectWrite.message && (
                            <small>{session.healthConnectWrite.message}</small>
                          )}
                        </div>
                        {canUseHealthConnect && session.healthConnectWrite.state === "error" && (
                          <button type="button" onClick={() => onRetryHealthConnect(session)}>
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    {entries.length === 0 ? (
                      <span className="history-legacy-note">
                        {isGarmin
                          ? "Activity summary imported. Use the original FIT file when you want the best available set detail."
                          : "This older session has no set detail."}
                      </span>
                    ) : entries.map((entry, entryIndex) => {
                      const sets = Array.isArray(entry.sets) ? entry.sets : [];
                      return (
                        <div className="history-exercise" key={`${entry.ex || "exercise"}-${entryIndex}`}>
                          <div>
                            <strong>{entry.ex || "Exercise"}</strong>
                            {entry.db && <small>PER DB</small>}
                            {records.some((record) => record.ex === entry.ex) && <small className="is-pr">PR</small>}
                          </div>
                          <span>{entry.summary || sets.map((set) => `${set.w}×${set.r}`).join(" · ") || "Completed"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  </React.Fragment>;
}

function formatHealthTrendValue(metricKey, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (metricKey === "sleepMinutes") {
    const hours = Math.floor(number / 60);
    return `${hours}h ${Math.round(number % 60)}m`;
  }
  if (metricKey === "steps" || metricKey === "calories") return Math.round(number).toLocaleString();
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function HealthRecoveryTrends({ healthLog }) {
  const [metricKey, setMetricKey] = useState("steps");
  const selected = HEALTH_TREND_METRICS.find(metric => metric.key === metricKey)
    || HEALTH_TREND_METRICS[0];
  const data = useMemo(
    () => healthTrendSeries(healthLog, selected.key),
    [healthLog, selected.key],
  );
  const headlineKeys = ["steps", "restingHeartRate", "sleepMinutes", "vo2Max"];
  const headlineMetrics = HEALTH_TREND_METRICS.filter(metric => headlineKeys.includes(metric.key));
  const tooltipStyle = {
    contentStyle: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      fontSize: 12
    },
    labelStyle: { color: C.dim }
  };

  return (
    <Panel
      title="Health & Recovery"
      sub="Health Connect daily summaries now feed Trends automatically"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8, marginBottom: 12 }}>
        {headlineMetrics.map(metric => {
          const latest = latestHealthValue(healthLog, metric.key);
          return (
            <div key={metric.key} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, padding: "10px 11px" }}>
              <span style={{ display: "block", color: C.dim, fontSize: 10, textTransform: "uppercase" }}>{metric.label}</span>
              <strong style={{ display: "block", color: metric.color, fontSize: 17, marginTop: 2 }}>
                {formatHealthTrendValue(metric.key, latest?.value)}
                {latest ? <small style={{ color: C.dim, fontSize: 9, marginLeft: 4 }}>{metric.suffix}</small> : null}
              </strong>
              <small style={{ color: C.dim }}>{latest?.date || "No imported data"}</small>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {HEALTH_TREND_METRICS.map(metric => (
          <button
            type="button"
            key={metric.key}
            onClick={() => setMetricKey(metric.key)}
            style={{
              background: metricKey === metric.key ? metric.color : C.panel2,
              color: metricKey === metric.key ? "#111" : C.dim,
              border: `1px solid ${metricKey === metric.key ? metric.color : C.line}`,
              borderRadius: 7,
              padding: "6px 9px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {metric.label}
          </button>
        ))}
      </div>
      {data.length < 2 ? (
        <Empty text={`Sync 2+ days with ${selected.label.toLowerCase()} to see this trend.`} />
      ) : (
        <ResponsiveContainer width="100%" height={175}>
          <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={C.line} strokeDasharray="2 4" />
            <XAxis dataKey="date" tick={{ fill: C.dim, fontSize: 10 }} tickFormatter={date => date.slice(5)} />
            <YAxis tick={{ fill: C.dim, fontSize: 10 }} />
            <Tooltip {...tooltipStyle} />
            <Line
              type="monotone"
              dataKey="value"
              name={selected.label}
              stroke={selected.color}
              strokeWidth={2.5}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      <div style={{ color: C.dim, fontSize: 10.5, marginTop: 8 }}>
        Source: Health Connect daily summaries. VO₂ max appears when a connected provider writes that record.
      </div>
    </Panel>
  );
}

/* ============ TRENDS ============ */
function Trends({
  sessions,
  bwLog,
  setBwLog,
  cardioLog,
  setCardioLog,
  healthLog,
  note,
  onDeleteBodyweight,
  onDeleteCardio
}) {
  const [sel, setSel] = useState("bench");
  const [bw, setBw] = useState({
    date: today(),
    weight: 242,
    bf: ""
  });
  const cardioTrendLog = useMemo(
    () => mergeCardioTrendRecords(cardioLog, sessions),
    [cardioLog, sessions],
  );
  const liftName = LIFTS.find(l => l.key === sel)?.name;
  const e1rmData = useMemo(() => {
    const pts = [];
    [...sessions].reverse().forEach(s => (Array.isArray(s?.entries) ? s.entries : []).forEach(en => {
      if (en.lift === sel || en.ex === liftName) {
        const estimates = (Array.isArray(en?.sets) ? en.sets : [])
          .map(st => epley(st.w, st.r))
          .filter(Number.isFinite);
        if (estimates.length) {
          pts.push({
            date: s.date,
            e1rm: Math.round(Math.max(...estimates))
          });
        }
      }
    }));
    return pts;
  }, [sessions, sel, liftName]);
  const volData = useMemo(() => {
    const byWeek = {};
    sessions.forEach(s => {
      const k = weekStartKey(s.date);
      if (!k) return;
      byWeek[k] = (byWeek[k] || 0) + safeSessionVolume(s);
    });
    return Object.entries(byWeek).sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([w, v]) => ({
      week: w,
      volume: v
    }));
  }, [sessions]);
  const bwData = useMemo(() => [...bwLog].sort((a, b) => a.date.localeCompare(b.date)), [bwLog]);
  const compData = useMemo(() => bwData.filter(x => Number(x.bf) > 0).map(x => ({
    date: x.date,
    lean: Math.round(x.weight * (1 - x.bf / 100)),
    fat: Math.round(x.weight * x.bf / 100)
  })), [bwData]);
  const addBw = () => {
    const weight = Number(bw.weight);
    const bodyFat = bw.bf === "" ? null : Number(bw.bf);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bw.date)) {
      note("Choose a bodyweight date");
      return;
    }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1500) {
      note("Enter a valid bodyweight");
      return;
    }
    if (bodyFat != null && (!Number.isFinite(bodyFat) || bodyFat <= 0 || bodyFat >= 75)) {
      note("Body fat must be between 0 and 75%");
      return;
    }
    const entry = {
      id: uid(),
      date: bw.date,
      weight
    };
    if (bodyFat != null) entry.bf = bodyFat;
    setBwLog(current => [entry, ...current.filter(x => x.date !== bw.date)]);
    note("Bodyweight logged");
  };
  const ttStyle = {
    contentStyle: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      fontSize: 12
    },
    labelStyle: {
      color: C.dim
    }
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(CardioQuickLog, {
    cardioLog: cardioLog,
    trendLog: cardioTrendLog,
    setCardioLog: setCardioLog,
    note: note
  }), /*#__PURE__*/React.createElement(Panel, {
    title: "Strength Trend",
    sub: "e1RM from your logged sessions — flat or rising while weight drops = recomp working"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 10,
      flexWrap: "wrap"
    }
  }, LIFTS.map(l => /*#__PURE__*/React.createElement("button", {
    key: l.key,
    onClick: () => setSel(l.key),
    style: {
      background: sel === l.key ? LIFT_COLORS[l.key] : C.panel2,
      color: sel === l.key ? "#fff" : C.dim,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: "5px 10px",
      fontSize: 12,
      cursor: "pointer",
      fontWeight: 600
    }
  }, l.name))), e1rmData.length < 2 ? /*#__PURE__*/React.createElement(Empty, {
    text: "Finish 2+ workouts containing this lift."
  }) : /*#__PURE__*/React.createElement(ResponsiveContainer, {
    width: "100%",
    height: 190
  }, /*#__PURE__*/React.createElement(LineChart, {
    data: e1rmData,
    margin: {
      top: 6,
      right: 8,
      left: -16,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(CartesianGrid, {
    stroke: C.line,
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement(XAxis, {
    dataKey: "date",
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    tickFormatter: d => d.slice(5)
  }), /*#__PURE__*/React.createElement(YAxis, {
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    domain: ["dataMin - 15", "dataMax + 15"]
  }), /*#__PURE__*/React.createElement(Tooltip, ttStyle), /*#__PURE__*/React.createElement(Line, {
    type: "monotone",
    dataKey: "e1rm",
    stroke: LIFT_COLORS[sel],
    strokeWidth: 2.5,
    dot: {
      r: 3
    }
  })))), /*#__PURE__*/React.createElement(Panel, {
    title: "Weekly Volume",
    sub: "Total pounds moved per week — watch for sudden drops (recovery) or runaway climbs"
  }, volData.length < 2 ? /*#__PURE__*/React.createElement(Empty, {
    text: "Finish workouts across 2+ weeks."
  }) : /*#__PURE__*/React.createElement(ResponsiveContainer, {
    width: "100%",
    height: 160
  }, /*#__PURE__*/React.createElement(BarChart, {
    data: volData,
    margin: {
      top: 6,
      right: 8,
      left: -10,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(CartesianGrid, {
    stroke: C.line,
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement(XAxis, {
    dataKey: "week",
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    tickFormatter: d => d.slice(5)
  }), /*#__PURE__*/React.createElement(YAxis, {
    tick: {
      fill: C.dim,
      fontSize: 10
    }
  }), /*#__PURE__*/React.createElement(Tooltip, ttStyle), /*#__PURE__*/React.createElement(Bar, {
    dataKey: "volume",
    fill: C.gold,
    radius: [4, 4, 0, 0]
  })))), /*#__PURE__*/React.createElement(Panel, {
    title: "Bodyweight & Composition",
    sub: "Add body fat % too (from your scale) — lean mass auto-calculates"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "flex-end",
      marginBottom: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    "aria-label": "Bodyweight date",
    value: bw.date,
    onChange: e => setBw({
      ...bw,
      date: e.target.value
    }),
    style: inp(120)
  }), /*#__PURE__*/React.createElement(MiniIn, {
    value: bw.weight,
    onChange: v => setBw({
      ...bw,
      weight: v
    }),
    suffix: "lb"
  }), /*#__PURE__*/React.createElement(MiniIn, {
    value: bw.bf,
    onChange: v => setBw({
      ...bw,
      bf: v
    }),
    suffix: "%bf"
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addBw,
    style: btnSm()
  }, "+ Log")), Number(bw.weight) > 0 && Number(bw.bf) > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: C.dim,
      marginBottom: 10
    }
  }, "→ lean ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: C.green
    }
  }, Math.round(bw.weight * (1 - bw.bf / 100)), " lb"), " · fat ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: C.red
    }
  }, Math.round(bw.weight * bw.bf / 100), " lb")), bwData.length >= 2 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      margin: "4px 0 2px"
    }
  }, "Bodyweight"), /*#__PURE__*/React.createElement(ResponsiveContainer, {
    width: "100%",
    height: 150
  }, /*#__PURE__*/React.createElement(LineChart, {
    data: bwData,
    margin: {
      top: 6,
      right: 8,
      left: -16,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(CartesianGrid, {
    stroke: C.line,
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement(XAxis, {
    dataKey: "date",
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    tickFormatter: d => d.slice(5)
  }), /*#__PURE__*/React.createElement(YAxis, {
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    domain: ["dataMin - 4", "dataMax + 4"]
  }), /*#__PURE__*/React.createElement(Tooltip, ttStyle), /*#__PURE__*/React.createElement(Line, {
    type: "monotone",
    dataKey: "weight",
    stroke: C.gold,
    strokeWidth: 2.5,
    dot: {
      r: 3
    }
  })))), compData.length >= 2 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      margin: "12px 0 2px"
    }
  }, "Composition · lean (green) vs fat (red)"), /*#__PURE__*/React.createElement(ResponsiveContainer, {
    width: "100%",
    height: 160
  }, /*#__PURE__*/React.createElement(LineChart, {
    data: compData,
    margin: {
      top: 6,
      right: 8,
      left: -16,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(CartesianGrid, {
    stroke: C.line,
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement(XAxis, {
    dataKey: "date",
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    tickFormatter: d => d.slice(5)
  }), /*#__PURE__*/React.createElement(YAxis, {
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    domain: ["dataMin - 6", "dataMax + 6"]
  }), /*#__PURE__*/React.createElement(Tooltip, ttStyle), /*#__PURE__*/React.createElement(Line, {
    type: "monotone",
    dataKey: "lean",
    stroke: C.green,
    strokeWidth: 2.5,
    dot: {
      r: 3
    },
    name: "Lean"
  }), /*#__PURE__*/React.createElement(Line, {
    type: "monotone",
    dataKey: "fat",
    stroke: C.red,
    strokeWidth: 2.5,
    dot: {
      r: 3
    },
    name: "Fat"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      marginTop: 6,
      textAlign: "center"
    }
  }, "Lean flat while fat drops = recomp working.")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, bwData.slice(-4).reverse().map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      padding: "6px 0",
      fontSize: 13,
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      color: C.dim
    }
  }, x.date), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, x.weight, " lb"), Number(x.bf) > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.gold,
      fontSize: 12
    }
  }, x.bf, "%"), Number(x.bf) > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.green,
      fontSize: 12
    }
  }, Math.round(x.weight * (1 - x.bf / 100)), " lean"), /*#__PURE__*/React.createElement("button", {
    "aria-label": `Delete bodyweight from ${x.date}`,
    onClick: () => {
      if (window.confirm("Delete this bodyweight entry?")) onDeleteBodyweight(x);
    },
    style: {
      background: "none",
      border: "none",
      color: C.dim,
      cursor: "pointer",
      fontSize: 15,
      minWidth: 32,
      minHeight: 32
    }
  }, "×"))))), /*#__PURE__*/React.createElement(HealthRecoveryTrends, {
    healthLog: healthLog
  }), /*#__PURE__*/React.createElement(Panel, {
    title: "Recent Cardio",
    sub: "One log, one history — Garmin activities appear automatically"
  }, cardioTrendLog.length ? cardioTrendLog.slice(0, 6).map(x => /*#__PURE__*/React.createElement("div", {
    key: x.id,
    style: {
      display: "flex",
      gap: 10,
      padding: "5px 0",
      fontSize: 13,
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, x.label || x.type, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim,
      fontSize: 11
    }
  }, " · ", x.date, x.source === "garmin" ? " · Garmin" : "")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: C.gold
    }
  }, x.minutes, " min"), x.source !== "garmin" && /*#__PURE__*/React.createElement("button", {
    "aria-label": `Delete cardio from ${x.date}`,
    onClick: () => {
      if (window.confirm("Delete this cardio entry?")) onDeleteCardio(x);
    },
    style: {
      background: "none",
      border: "none",
      color: C.dim,
      cursor: "pointer",
      minWidth: 32,
      minHeight: 32
    }
  }, "×"))) : /*#__PURE__*/React.createElement(Empty, {
    text: "Log cardio above or import a Garmin activity."
  })));
}

/* ============ TOOLS ============ */
function Tools({
  mode,
  plates,
  bar,
  roundLoad,
  maxes
}) {
  const [conv, setConv] = useState({
    weight: 315,
    reps: 4
  });
  const [warm, setWarm] = useState({
    target: 315
  });
  const e = epley(Number(conv.weight) || 0, Number(conv.reps) || 1);
  const warmups = useMemo(() => {
    const t = Number(warm.target) || 0;
    if (!t) return [];
    return [{
      pct: "bar",
      w: bar,
      r: 10
    }, {
      pct: "40%",
      w: roundLoad(t * 0.4),
      r: 8
    }, {
      pct: "60%",
      w: roundLoad(t * 0.6),
      r: 5
    }, {
      pct: "75%",
      w: roundLoad(t * 0.75),
      r: 3
    }, {
      pct: "85%",
      w: roundLoad(t * 0.85),
      r: 2
    }, {
      pct: "92%",
      w: roundLoad(t * 0.92),
      r: 1
    }].filter((x, i, arr) => i === 0 || x.w > arr[i - 1].w);
  }, [warm, bar, roundLoad]);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Warm-Up Builder",
    sub: "Enter your top-set weight — get the full ramp"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: C.dim
    }
  }, "Top set"), /*#__PURE__*/React.createElement(MiniIn, {
    value: warm.target,
    onChange: v => setWarm({
      target: v
    }),
    suffix: "lb"
  })), warmups.map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "7px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: C.gold
    }
  }, w.pct), " × ", w.r), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, w.w, " lb")), /*#__PURE__*/React.createElement(LoadChips, {
    total: w.w,
    bar: bar,
    plates: plates
  })))), /*#__PURE__*/React.createElement(Panel, {
    title: "Rep ⇄ Load Converter",
    sub: "A set you hit → est. 1RM → loads at every rep target"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: conv.weight,
    onChange: v => setConv({
      ...conv,
      weight: v
    }),
    suffix: "lb"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim
    }
  }, "×"), /*#__PURE__*/React.createElement(MiniIn, {
    value: conv.reps,
    onChange: v => setConv({
      ...conv,
      reps: v
    }),
    suffix: "reps"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      background: "rgba(225,29,42,.13)",
      border: `1px solid ${C.red}`,
      borderRadius: 8,
      padding: "7px 10px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: C.dim
    }
  }, "EST. 1RM"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 700
    }
  }, Math.round(e)))), [3, 5, 8, 10, 12].map(r => {
    const w = roundLoad(wForReps(e, r));
    return /*#__PURE__*/React.createElement("div", {
      key: r,
      style: {
        padding: "7px 0",
        borderBottom: `1px solid ${C.line}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("b", {
      style: {
        color: C.gold
      }
    }, r), " reps"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700
      }
    }, w, " lb")), /*#__PURE__*/React.createElement(LoadChips, {
      total: w,
      bar: bar,
      plates: plates
    }));
  })), /*#__PURE__*/React.createElement(Panel, {
    title: "Training Maxes",
    sub: "90% of 1RM — what working sets calculate from"
  }, LIFTS.map(l => /*#__PURE__*/React.createElement("div", {
    key: l.key,
    style: {
      display: "flex",
      justifyContent: "space-between",
      padding: "7px 0",
      borderBottom: `1px solid ${C.line}`,
      fontSize: 14
    }
  }, /*#__PURE__*/React.createElement("span", null, l.name), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: C.gold
    }
  }, Math.round(maxes[l.key] * 0.9)), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim,
      fontSize: 11
    }
  }, "TM"), " · ", maxes[l.key], " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim,
      fontSize: 11
    }
  }, "1RM"))))));
}

/* ============ SETTINGS ============ */
function friendlyAuthError(error) {
  const code = String(error?.code || "");
  if (code.includes("operation-not-allowed")) {
    return "Email/password sign-in is not enabled in Firebase yet.";
  }
  if (code.includes("email-already-in-use")) {
    return "That email already has an account. Sign in instead.";
  }
  if (
    code.includes("invalid-credential")
    || code.includes("invalid-login-credentials")
    || code.includes("wrong-password")
    || code.includes("user-not-found")
  ) {
    return "Email or password did not match.";
  }
  if (code.includes("weak-password")) return "Use a password with at least 6 characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("network-request-failed")) return "No network connection. Try again when you are online.";
  return error?.message || "Account request failed.";
}

function CloudSyncPanel({
  firebaseReady,
  user,
  enabled,
  status,
  onEnable,
  onSyncNow,
  onSignIn,
  onSignUp,
  onSignOut,
}) {
  const [accountMode, setAccountMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const statusState = ["connecting", "syncing", "synced", "error", "paused", "signed-out"]
    .includes(status?.state) ? status.state : "paused";

  const submitAccount = async event => {
    event.preventDefault();
    setBusy(true);
    setAccountError("");
    try {
      if (accountMode === "signup") {
        await onSignUp(email.trim(), password, name.trim() || email.trim().split("@")[0]);
      } else {
        await onSignIn(email.trim(), password);
      }
      onEnable(true);
      setPassword("");
    } catch (error) {
      setAccountError(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setAccountError("");
    try {
      onEnable(false);
      await onSignOut();
    } catch (error) {
      setAccountError(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  return <Panel
    title="Personal Cloud Sync"
    sub="Keep workouts, Garmin and Health Connect summaries, maxes, trends, and preferences aligned across your phone and website"
  >
    <div className="cloud-sync-card">
      <div className="cloud-sync-heading">
        <div className="cloud-sync-mark" aria-hidden="true">☁</div>
        <div>
          <strong>{user ? "Your IronDesk account" : "Use the same account on every device"}</strong>
          <span>{user?.email || "Sign in once on the website and once on your phone."}</span>
        </div>
        <span className={`cloud-sync-chip is-${statusState}`}>
          {enabled && user ? statusState.replace("-", " ") : user ? "paused" : "signed out"}
        </span>
      </div>

      {!firebaseReady ? (
        <div className="cloud-sync-message is-error" role="alert">
          Firebase did not load. Refresh the app while online and try again.
        </div>
      ) : !user ? (
        <form className="cloud-account-form" onSubmit={submitAccount}>
          <div className="cloud-account-tabs" aria-label="Cloud account action">
            <button
              type="button"
              className={accountMode === "signin" ? "is-active" : ""}
              onClick={() => {
                setAccountMode("signin");
                setAccountError("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={accountMode === "signup" ? "is-active" : ""}
              onClick={() => {
                setAccountMode("signup");
                setAccountError("");
              }}
            >
              Create account
            </button>
          </div>
          {accountMode === "signup" && (
            <label>
              <span>Name</span>
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete={accountMode === "signup" ? "new-password" : "current-password"}
              required
              minLength={6}
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="6+ characters"
            />
          </label>
          <button type="submit" className="cloud-primary-button" disabled={busy}>
            {busy
              ? "Connecting…"
              : accountMode === "signup" ? "Create Account & Sync" : "Sign In & Sync"}
          </button>
        </form>
      ) : (
        <div className="cloud-sync-controls">
          <div className={`cloud-sync-message is-${statusState}`} role={statusState === "error" ? "alert" : "status"}>
            <strong>{status?.message || (enabled ? "Connecting…" : "Cloud sync is paused.")}</strong>
            {status?.syncedAt && (
              <span>Last synced {new Date(status.syncedAt).toLocaleString()}</span>
            )}
          </div>
          <div className="cloud-sync-actions">
            {!enabled ? (
              <button type="button" className="cloud-primary-button" onClick={() => onEnable(true)}>
                Turn On Cloud Sync
              </button>
            ) : (
              <>
                <button type="button" className="cloud-primary-button" onClick={onSyncNow}>
                  Sync Now
                </button>
                <button type="button" className="cloud-secondary-button" onClick={() => onEnable(false)}>
                  Pause
                </button>
              </>
            )}
            <button type="button" className="cloud-secondary-button" onClick={signOut} disabled={busy}>
              Sign Out
            </button>
          </div>
        </div>
      )}

      {accountError && <div className="cloud-sync-message is-error" role="alert">{accountError}</div>}
      <div className="cloud-privacy-note">
        First connection safely merges workout, bodyweight, cardio, and daily Health Connect
        histories. Decoded Garmin activity data syncs; original FIT or CSV files and raw Health
        Connect sensor records stay on the device where you selected them.
      </div>
    </div>
  </Panel>;
}

function GarminImportPanel({
  importGarminFiles,
  setTab
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const handleFiles = async fileList => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    setResult(null);
    try {
      const imported = await importGarminFiles(files);
      setResult({
        kind: imported.failedFiles.length ? "warning" : "success",
        title: imported.added
          ? `Added ${imported.added} Garmin activit${imported.added === 1 ? "y" : "ies"}`
          : "No new Garmin activities",
        detail: [
          imported.duplicates
            ? `${imported.duplicates} duplicate${imported.duplicates === 1 ? "" : "s"} skipped`
            : "",
          imported.skippedRows
            ? `${imported.skippedRows} undated row${imported.skippedRows === 1 ? "" : "s"} skipped`
            : "",
          imported.failedFiles[0] || ""
        ].filter(Boolean).join(" · ")
      });
    } catch (error) {
      setResult({
        kind: "error",
        title: "Garmin import failed",
        detail: error?.message || "The selected file could not be read."
      });
    } finally {
      setBusy(false);
    }
  };
  return <Panel
    title="Garmin fēnix 6X Import"
    sub="Bring watch activities into History without replacing your IronDesk workouts"
  >
    <div className="garmin-import-card">
      <div className="garmin-import-heading">
        <div className="garmin-device-mark" aria-hidden="true">G</div>
        <div>
          <strong>FIT / CSV activity import</strong>
          <span>Original FIT files include the richest heart-rate and strength-set detail.</span>
        </div>
        <span className="garmin-device-chip">FĒNIX 6X</span>
      </div>
      <div className="garmin-import-steps">
        <span><b>1</b> Export Original (.FIT) from a Garmin Connect activity, or export the Activities CSV.</span>
        <span><b>2</b> Select one or many files below. Repeat imports are skipped automatically.</span>
      </div>
      <label className={`garmin-import-button ${busy ? "is-busy" : ""}`}>
        {busy ? "Reading Garmin files…" : "↑ Select Garmin FIT / CSV"}
        <input
          type="file"
          accept=".fit,.FIT,.csv,text/csv,application/vnd.ant.fit"
          multiple
          disabled={busy}
          onChange={event => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      <div className="garmin-privacy-note">
        <span aria-hidden="true">⌁</span>
        Processed on this device. IronDesk never asks for your Garmin password and does not upload
        the selected files.
      </div>
      {result && (
        <div
          className={`garmin-import-result is-${result.kind}`}
          role={result.kind === "error" ? "alert" : "status"}
        >
          <div>
            <strong>{result.title}</strong>
            {result.detail && <span>{result.detail}</span>}
          </div>
          {result.kind !== "error" && (
            <button type="button" onClick={() => setTab("history")}>View History →</button>
          )}
        </div>
      )}
    </div>
  </Panel>;
}

function Connections({
  firebaseReady,
  cloudUser,
  cloudEnabled,
  cloudStatus,
  updateCloudEnabled,
  syncCloudNow,
  cloudSignIn,
  cloudSignUp,
  cloudSignOut,
  healthLog,
  healthAutoSync,
  setHealthAutoSync,
  healthWriteEnabled,
  setHealthWriteEnabled,
  healthSyncStatus,
  syncHealthNow,
  clearHealthData,
  importGarminFiles,
  setTab
}) {
  const nativeAndroid = isNativeHealthConnect();
  const healthRecords = Array.isArray(healthLog) ? healthLog.length : 0;
  const healthState = nativeAndroid
    ? healthSyncStatus?.syncedAt || healthRecords
      ? "Ready"
      : "Connect"
    : healthRecords
      ? "Via cloud"
      : "Android needed";
  const cloudState = !firebaseReady
    ? "Unavailable"
    : !cloudUser
      ? "Sign in"
      : cloudEnabled && cloudStatus?.state === "synced"
        ? "Synced"
        : cloudEnabled
          ? "Connecting"
          : "Paused";

  const scrollTo = id => document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  return (
    <div className="connection-center">
      <section className="connection-center-hero" aria-labelledby="connection-center-title">
        <div>
          <span className="connection-center-kicker">ONE PLACE FOR EVERY DEVICE</span>
          <h2 id="connection-center-title">Connection Center</h2>
          <p>
            Bring Garmin and Samsung Health summaries, detailed FIT/CSV activities, and your
            private IronDesk cloud copy together without hunting through Settings.
          </p>
        </div>
        <span className="connection-center-device">
          {nativeAndroid ? "Android companion" : "Website"}
        </span>
      </section>

      <div className="connection-status-grid" aria-label="Connection status">
        <button type="button" onClick={() => setTab("garmin")}>
          <span className="connection-status-icon is-garmin" aria-hidden="true">G</span>
          <span><small>Garmin</small><strong>FIT / CSV ready</strong></span>
          <b>Open →</b>
        </button>
        <button type="button" onClick={() => scrollTo("health-connect-title")}>
          <span className="connection-status-icon is-health" aria-hidden="true">♥</span>
          <span><small>Health Connect</small><strong>{healthState}</strong></span>
          <b>Set up ↓</b>
        </button>
        <button type="button" onClick={() => scrollTo("personal-cloud-title")}>
          <span className="connection-status-icon is-cloud" aria-hidden="true">☁</span>
          <span><small>Personal Cloud</small><strong>{cloudState}</strong></span>
          <b>Manage ↓</b>
        </button>
      </div>

      <section className="watch-provider-grid" aria-label="Watch connection options">
        <article className="watch-provider-card is-ready">
          <div className="watch-provider-heading">
            <span className="watch-provider-mark is-samsung" aria-hidden="true">S</span>
            <div>
              <small>AVAILABLE IN THE ANDROID APP</small>
              <h3>Samsung Galaxy Watch</h3>
            </div>
            <b>Works now</b>
          </div>
          <p>Galaxy Watch → Samsung Health → Health Connect → IronDesk</p>
          <ol>
            <li>Sync the watch with Samsung Health on the phone.</li>
            <li>In Samsung Health, allow Health Connect read and write access.</li>
            <li>Connect IronDesk below, then enable completed-workout writeback.</li>
          </ol>
          <a
            href="https://developer.samsung.com/health/health-connect-faq.html"
            target="_blank"
            rel="noreferrer"
          >
            Samsung setup details ↗
          </a>
        </article>

        <article className="watch-provider-card is-planned">
          <div className="watch-provider-heading">
            <span className="watch-provider-mark is-apple" aria-hidden="true">●</span>
            <div>
              <small>SEPARATE IPHONE APP REQUIRED</small>
              <h3>Apple Watch</h3>
            </div>
            <b>HealthKit</b>
          </div>
          <p>Apple Watch → Apple Health → IronDesk iPhone app</p>
          <ol>
            <li>Apple Watch does not connect to Android Health Connect.</li>
            <li>An IronDesk iPhone target must request HealthKit read and share access.</li>
            <li>Personal Cloud Sync can then show approved summaries on the website.</li>
          </ol>
          <a
            href="https://developer.apple.com/documentation/healthkit"
            target="_blank"
            rel="noreferrer"
          >
            Apple HealthKit requirements ↗
          </a>
        </article>
      </section>

      <section className="connection-guide">
        <div className="connection-guide-heading">
          <div>
            <span className="connection-center-kicker">FĒNIX 6X + ANDROID</span>
            <h3>Connect Garmin to IronDesk</h3>
          </div>
          <span>Android 14+</span>
        </div>
        <ol>
          <li>
            <b>1</b>
            <div>
              <strong>Install and open the IronDesk Android companion</strong>
              <span>The website alone cannot appear inside the Health Connect app.</span>
            </div>
          </li>
          <li>
            <b>2</b>
            <div>
              <strong>In Garmin Connect, enable Health Connect sharing</strong>
              <span>Garmin Connect → More → Settings → Health Connect.</span>
            </div>
          </li>
          <li>
            <b>3</b>
            <div>
              <strong>Return here and grant Health Connect access</strong>
              <span>Choose the health fields to read, then optionally allow completed workout writeback.</span>
            </div>
          </li>
          <li>
            <b>4</b>
            <div>
              <strong>Choose workout writeback, then sync your cloud</strong>
              <span>Your phone can send completed workouts; cloud sync makes IronDesk data visible on the website.</span>
            </div>
          </li>
        </ol>
        {!nativeAndroid ? (
          <div className="connection-guide-note">
            <strong>You are viewing the website.</strong>
            <span>
              Complete steps 1–3 from the installed Android app. Android distribution is still in
              tester mode, so IronDesk will not appear in Health Connect until the companion is installed.
            </span>
          </div>
        ) : null}
      </section>

      <HealthConnectPanel
        healthLog={healthLog}
        autoSync={healthAutoSync}
        setAutoSync={setHealthAutoSync}
        writeEnabled={healthWriteEnabled}
        setWriteEnabled={setHealthWriteEnabled}
        syncStatus={healthSyncStatus}
        onSync={syncHealthNow}
        onClear={clearHealthData}
      />
      <div id="personal-cloud-title">
        <CloudSyncPanel
          firebaseReady={firebaseReady}
          user={cloudUser}
          enabled={cloudEnabled}
          status={cloudStatus}
          onEnable={updateCloudEnabled}
          onSyncNow={syncCloudNow}
          onSignIn={cloudSignIn}
          onSignUp={cloudSignUp}
          onSignOut={cloudSignOut}
        />
      </div>
      <GarminImportPanel importGarminFiles={importGarminFiles} setTab={setTab} />
    </div>
  );
}

function Settings({
  maxes,
  setMaxes,
  plates,
  setPlates,
  bar,
  setBar,
  mode,
  exportJson,
  exportCsv,
  exportSetCsv,
  importData,
  sessions,
  gender,
  goal,
  setGender,
  setGoal,
  restTimerPrefs,
  setRestTimerPrefs
}) {
  const setGenderGoal = g => {
    setGender(g);
    setGoal(GENDER_DEFAULT_GOAL[g]);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Profile",
    sub: "Drives your generated workouts — change anytime"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Training as"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 14
    }
  }, [["women", "Women"], ["men", "Men"]].map(([g, l]) => /*#__PURE__*/React.createElement("button", {
    key: g,
    onClick: () => setGenderGoal(g),
    className: "ttl",
    style: {
      flex: 1,
      padding: "9px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12.5,
      fontWeight: 700,
      background: gender === g ? C.red : C.panel2,
      color: gender === g ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Goal"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, Object.entries(GOALS).map(([k, gg]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setGoal(k),
    style: {
      textAlign: "left",
      padding: "10px 12px",
      borderRadius: 8,
      cursor: "pointer",
      background: goal === k ? "rgba(225,29,42,.13)" : C.panel2,
      color: C.txt,
      border: `1px solid ${goal === k ? C.red : C.line}`,
      fontSize: 13.5,
      fontWeight: goal === k ? 700 : 500
    }
  }, gg.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      marginTop: 10
    }
  }, "Location (Home / Gym) is the toggle up in the header.")), /*#__PURE__*/React.createElement(Panel, {
    title: "Your Maxes",
    sub: "Used to set target loads on heavy lifts — leave rough if you're new"
  }, LIFTS.map(l => /*#__PURE__*/React.createElement("div", {
    key: l.key,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14
    }
  }, l.name), /*#__PURE__*/React.createElement(MiniIn, {
    value: maxes[l.key],
    onChange: v => setMaxes({
      ...maxes,
      [l.key]: v
    }),
    suffix: "1RM"
  })))), /*#__PURE__*/React.createElement(Panel, {
    title: `Plate Inventory — ${mode === "gym" ? "Gym" : "Home"}`,
    sub: "Editing the active location only — toggle in the header to edit the other"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14
    }
  }, "Bar weight"), /*#__PURE__*/React.createElement(MiniIn, {
    value: bar,
    onChange: setBar,
    suffix: "lb"
  })), plates.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.weight,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14
    }
  }, p.weight, " lb ", p.weight <= 5 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.gold,
      fontSize: 11
    }
  }, "(micro)")), /*#__PURE__*/React.createElement(MiniIn, {
    value: p.count,
    onChange: v => {
      const np = [...plates];
      np[i] = {
        ...p,
        count: v
      };
      setPlates(np);
    },
    suffix: "total"
  })))), /*#__PURE__*/React.createElement(RestTimerSettings, {
    preferences: restTimerPrefs,
    setPreferences: setRestTimerPrefs
  }), /*#__PURE__*/React.createElement(Panel, {
    title: "Backup & Restore",
    sub: `${sessions.length} sessions in your log — export to keep them forever`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: exportJson,
    style: {
      flex: 1,
      minWidth: 130,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.gold}`,
      borderRadius: 10,
      color: C.gold,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "↓ JSON Backup"), /*#__PURE__*/React.createElement("button", {
    onClick: exportCsv,
    style: {
      flex: 1,
      minWidth: 130,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.blue}`,
      borderRadius: 10,
      color: C.blue,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "↓ Garmin Import CSV"), /*#__PURE__*/React.createElement("button", {
    onClick: exportSetCsv,
    style: {
      flex: 1,
      minWidth: 130,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.red}`,
      borderRadius: 10,
      color: C.red,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "↓ Detailed Sets"), /*#__PURE__*/React.createElement("label", {
    style: {
      flex: 1,
      minWidth: 130,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.txt,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 600,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer",
      textAlign: "center"
    }
  }, "↑ Import", /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: ".json,application/json",
    style: {
      display: "none"
    },
    onChange: e => {
      importData(e.target.files[0]);
      e.target.value = "";
    }
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      color: C.dim,
      fontSize: 11,
      lineHeight: 1.6
    }
  }, "IronDesk Pro · loads round to ", mode === "gym" ? "2.5" : "5", " lb in ", mode, " mode · Epley e1RM, best at 1–8 reps", /*#__PURE__*/React.createElement("br", null), "auto-saves everything · not medical advice"));
}

function RestTimerSettings({
  preferences,
  setPreferences
}) {
  const prefs = normalizeRestTimerPrefs(preferences);
  const options = [30, 45, 60, 90, 120, 180, 240, 300];
  const update = (field, value) => setPreferences(current => normalizeRestTimerPrefs({
    ...current,
    [field]: value
  }));
  return <Panel
    title="Automatic Rest Timer"
    sub="Optionally start a countdown whenever you log a strength set"
  >
    <div className="rest-setting-toggle">
      <div>
        <strong>Start timer after completed sets</strong>
        <span>Cardio and core entries never trigger it.</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={prefs.enabled}
        className={`switch-button ${prefs.enabled ? "is-on" : ""}`}
        onClick={() => update("enabled", !prefs.enabled)}
      >
        {prefs.enabled ? "ON" : "OFF"}
      </button>
    </div>
    <div className="rest-setting-grid">
      <label>
        <span>Accessory sets</span>
        <select
          value={prefs.accessorySeconds}
          disabled={!prefs.enabled}
          onChange={(event) => update("accessorySeconds", Number(event.target.value))}
        >
          {options.filter((seconds) => seconds <= 180).map((seconds) => (
            <option value={seconds} key={seconds}>{seconds} seconds</option>
          ))}
        </select>
      </label>
      <label>
        <span>Heavy sets</span>
        <select
          value={prefs.heavySeconds}
          disabled={!prefs.enabled}
          onChange={(event) => update("heavySeconds", Number(event.target.value))}
        >
          {options.filter((seconds) => seconds >= 60).map((seconds) => (
            <option value={seconds} key={seconds}>{seconds} seconds</option>
          ))}
        </select>
      </label>
    </div>
  </Panel>;
}

/* ============ CREW (connected) ============ */
function Crew({
  sessions,
  maxes,
  crewRef,
  note
}) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [grp, setGrp] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CREW_KEY) || "null");
    } catch (e) {
      return null;
    }
  });
  const [members, setMembers] = useState([]);
  const [feed, setFeed] = useState([]);
  const [form, setForm] = useState({
    email: "",
    pw: "",
    name: "",
    mode: "login"
  });
  const [grpForm, setGrpForm] = useState({
    name: "",
    code: ""
  });
  const [board, setBoard] = useState("bench");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!FB.ready) {
      setUser(null);
      return;
    }
    return FB.onAuth(setUser);
  }, []);

  // keep crewRef live for PR pushes from finished workouts
  useEffect(() => {
    crewRef.current = {
      uid: user ? user.uid : null,
      name: user ? user.displayName || "Lifter" : null,
      groupId: grp ? grp.groupId : null
    };
  }, [user, grp, crewRef]);

  // subscribe to group data + push our latest stats
  useEffect(() => {
    if (!FB.ready || !user || !grp) return;
    const u1 = FB.watchMembers(grp.groupId, setMembers);
    const u2 = FB.watchFeed(grp.groupId, setFeed);
    FB.syncStats(grp.groupId, user.uid, Object.assign({
      name: user.displayName || "Lifter"
    }, computeStats(sessions, maxes))).catch(function () {});
    return function () {
      u1 && u1();
      u2 && u2();
    };
  }, [user, grp, sessions, maxes]);
  const saveGrp = g => {
    setGrp(g);
    try {
      localStorage.setItem(CREW_KEY, JSON.stringify(g));
    } catch (e) {}
  };
  const doAuth = () => {
    setErr("");
    setBusy(true);
    const p = form.mode === "signup" ? FB.signUp(form.email.trim(), form.pw, form.name.trim() || "Lifter") : FB.signIn(form.email.trim(), form.pw);
    p.then(function () {
      setBusy(false);
    }).catch(function (e) {
      setErr(e.message || "Failed");
      setBusy(false);
    });
  };
  const doCreate = () => {
    if (!grpForm.name.trim()) {
      setErr("Name your group");
      return;
    }
    setErr("");
    setBusy(true);
    FB.createGroup(user.uid, user.displayName || "Lifter", grpForm.name.trim()).then(function (g) {
      saveGrp(g);
      setBusy(false);
      note("Group created");
    }).catch(function (e) {
      setErr(e.message);
      setBusy(false);
    });
  };
  const doJoin = () => {
    if (!grpForm.code.trim()) {
      setErr("Enter a code");
      return;
    }
    setErr("");
    setBusy(true);
    FB.joinGroup(user.uid, user.displayName || "Lifter", grpForm.code.trim()).then(function (g) {
      saveGrp(g);
      setBusy(false);
      note("Joined!");
    }).catch(function (e) {
      setErr(e.message);
      setBusy(false);
    });
  };
  if (!FB.ready) {
    return /*#__PURE__*/React.createElement(Panel, {
      title: "Crew",
      sub: "Connected features"
    }, /*#__PURE__*/React.createElement(Empty, {
      text: "Crew features run in the installed app on your phone, not this preview. Open IronDesk from your home screen to log in and connect with your group."
    }));
  }
  if (user === undefined) return /*#__PURE__*/React.createElement(Panel, {
    title: "Crew",
    sub: "Connecting…"
  }, /*#__PURE__*/React.createElement(Empty, {
    text: "Loading…"
  }));

  // --- not logged in ---
  if (!user) {
    return /*#__PURE__*/React.createElement(Panel, {
      title: form.mode === "signup" ? "Create Account" : "Log In",
      sub: "Connect with your crew — your workout data stays private to you"
    }, form.mode === "signup" && /*#__PURE__*/React.createElement(Field, {
      label: "Display name"
    }, /*#__PURE__*/React.createElement("input", {
      value: form.name,
      onChange: e => setForm({
        ...form,
        name: e.target.value
      }),
      placeholder: "How you show up",
      style: inp("100%")
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Email"
    }, /*#__PURE__*/React.createElement("input", {
      value: form.email,
      onChange: e => setForm({
        ...form,
        email: e.target.value
      }),
      autoCapitalize: "none",
      style: inp("100%")
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Password"
    }, /*#__PURE__*/React.createElement("input", {
      type: "password",
      value: form.pw,
      onChange: e => setForm({
        ...form,
        pw: e.target.value
      }),
      style: inp("100%")
    }))), err && /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.red,
        fontSize: 12,
        marginTop: 8
      }
    }, err), /*#__PURE__*/React.createElement("button", {
      onClick: doAuth,
      disabled: busy,
      style: {
        width: "100%",
        marginTop: 14,
        padding: "13px",
        background: C.red,
        border: "none",
        borderRadius: 10,
        color: "#fff",
        fontFamily: "'Oswald'",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: "uppercase",
        cursor: "pointer",
        opacity: busy ? 0.6 : 1
      }
    }, busy ? "…" : form.mode === "signup" ? "Create Account" : "Log In"), /*#__PURE__*/React.createElement("div", {
      onClick: () => {
        setForm({
          ...form,
          mode: form.mode === "signup" ? "login" : "signup"
        });
        setErr("");
      },
      style: {
        textAlign: "center",
        color: C.dim,
        fontSize: 12.5,
        marginTop: 12,
        cursor: "pointer"
      }
    }, form.mode === "signup" ? "Have an account? Log in" : "New here? Create an account"));
  }

  // --- logged in, no group ---
  if (!grp) {
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
      title: `Hey, ${user.displayName || "Lifter"}`,
      sub: "Create a group or join one with a code"
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Create a new group"
    }, /*#__PURE__*/React.createElement("input", {
      value: grpForm.name,
      onChange: e => setGrpForm({
        ...grpForm,
        name: e.target.value
      }),
      placeholder: "e.g. HighBetaCowboys",
      style: inp("100%")
    })), /*#__PURE__*/React.createElement("button", {
      onClick: doCreate,
      disabled: busy,
      style: btnFull(C.red)
    }, "Create Group"), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: "center",
        color: C.dim,
        fontSize: 12,
        margin: "14px 0"
      }
    }, "— or —"), /*#__PURE__*/React.createElement(Field, {
      label: "Join with a code"
    }, /*#__PURE__*/React.createElement("input", {
      value: grpForm.code,
      onChange: e => setGrpForm({
        ...grpForm,
        code: e.target.value
      }),
      autoCapitalize: "characters",
      placeholder: "6-char code",
      style: inp("100%")
    })), /*#__PURE__*/React.createElement("button", {
      onClick: doJoin,
      disabled: busy,
      style: btnFull(C.panel2, C.gold)
    }, "Join Group"), err && /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.red,
        fontSize: 12,
        marginTop: 10
      }
    }, err)), /*#__PURE__*/React.createElement("button", {
      onClick: () => FB.signOut(),
      style: {
        width: "100%",
        padding: "11px",
        background: "none",
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        color: C.dim,
        fontSize: 12.5,
        cursor: "pointer"
      }
    }, "Sign out"));
  }

  // --- logged in, in a group ---
  const sorted = [...members].sort((a, b) => (b[board] || 0) - (a[board] || 0));
  const byVol = [...members].sort((a, b) => (b.weekVolume || 0) - (a.weekVolume || 0));
  const bySess = [...members].sort((a, b) => (b.weekSessions || 0) - (a.weekSessions || 0));
  const lifters = members.length;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: grp.name,
    sub: `${lifters} member${lifters !== 1 ? "s" : ""} · share code to add your crew`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      background: C.panel2,
      border: `1px dashed ${C.gold}`,
      borderRadius: 10,
      padding: "10px 14px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: C.dim,
      letterSpacing: 1
    }
  }, "JOIN CODE"), /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 22,
      fontWeight: 700,
      color: C.gold,
      letterSpacing: 3
    }
  }, grp.code)), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (navigator.clipboard) navigator.clipboard.writeText(grp.code);
      note("Code copied");
    },
    style: {
      padding: "10px 12px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.txt,
      fontSize: 12,
      cursor: "pointer"
    }
  }, "Copy"))), /*#__PURE__*/React.createElement(Panel, {
    title: "Leaderboard",
    sub: "Best estimated 1RM in the crew"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12,
      flexWrap: "wrap"
    }
  }, LIFTS.map(l => /*#__PURE__*/React.createElement("button", {
    key: l.key,
    onClick: () => setBoard(l.key),
    style: {
      background: board === l.key ? LIFT_COLORS[l.key] : C.panel2,
      color: board === l.key ? "#fff" : C.dim,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: "5px 10px",
      fontSize: 12,
      cursor: "pointer",
      fontWeight: 600
    }
  }, l.name))), sorted.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    text: "No members yet."
  }), sorted.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.uid,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "9px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      width: 24,
      fontSize: 16,
      fontWeight: 700,
      color: i === 0 ? C.gold : i === 1 ? "#bbb" : i === 2 ? "#c87" : C.dim
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      fontWeight: m.uid === user.uid ? 700 : 500,
      color: m.uid === user.uid ? C.txt : C.txt
    }
  }, m.name, m.uid === user.uid ? " (you)" : ""), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: LIFT_COLORS[board]
    }
  }, m[board] || 0, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: C.dim
    }
  }, "lb"))))), /*#__PURE__*/React.createElement(Panel, {
    title: "PR Feed",
    sub: "Live — every personal record in the crew"
  }, feed.length === 0 && /*#__PURE__*/React.createElement(Empty, {
    text: "No PRs yet. Finish a workout that beats a best to post one."
  }), feed.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16
    }
  }, "🏆"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement("b", null, f.name), " — ", f.ex), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim
    }
  }, new Date(f.ts).toLocaleDateString(), " ")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: C.green
    }
  }, f.e1rm, " lb")))), /*#__PURE__*/React.createElement(Panel, {
    title: "This Week's Challenge",
    sub: "Resets as the week rolls — most work wins"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4
    }
  }, "Most Volume (lb)"), byVol.slice(0, 3).map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.uid,
    style: {
      display: "flex",
      gap: 10,
      padding: "5px 0",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      width: 18,
      color: i === 0 ? C.gold : C.dim,
      fontWeight: 700
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, m.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: C.gold
    }
  }, (m.weekVolume || 0).toLocaleString())))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4
    }
  }, "Most Sessions"), bySess.slice(0, 3).map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: m.uid,
    style: {
      display: "flex",
      gap: 10,
      padding: "5px 0",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      width: 18,
      color: i === 0 ? C.gold : C.dim,
      fontWeight: 700
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, m.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: C.green
    }
  }, m.weekSessions || 0))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      saveGrp(null);
      try {
        localStorage.removeItem(CREW_KEY);
      } catch (e) {}
      note("Left group");
    },
    style: {
      flex: 1,
      padding: "11px",
      background: "none",
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontSize: 12.5,
      cursor: "pointer"
    }
  }, "Leave group"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      FB.signOut();
      saveGrp(null);
    },
    style: {
      flex: 1,
      padding: "11px",
      background: "none",
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontSize: 12.5,
      cursor: "pointer"
    }
  }, "Sign out")));
}

/* ============ STOPWATCH ============ */
function Stopwatch() {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef(null);
  const startRef = useRef(0);
  useEffect(() => {
    if (running) {
      startRef.current = Date.now() - ms;
      ref.current = setInterval(() => setMs(Date.now() - startRef.current), 100);
    }
    return () => clearInterval(ref.current);
    /* eslint-disable-next-line */
  }, [running]);
  const fmt = m => {
    const s = Math.floor(m / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${Math.floor(m % 1000 / 100)}`;
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Stopwatch",
    sub: "No watch? Time your sets, rest, or holds"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 46,
      fontWeight: 700,
      color: running ? C.green : C.txt,
      letterSpacing: 2
    }
  }, fmt(ms)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setRunning(!running),
    style: {
      flex: 2,
      padding: "13px",
      background: running ? C.gold : C.green,
      border: "none",
      borderRadius: 10,
      color: "#111",
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 14,
      textTransform: "uppercase",
      letterSpacing: 1,
      cursor: "pointer"
    }
  }, running ? "Pause" : "Start"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setRunning(false);
      setMs(0);
    },
    style: {
      flex: 1,
      padding: "13px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontWeight: 600,
      fontSize: 13,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Reset"))));
}

/* ============ CARDIO TRACKER (rides / runs / steps) ============ */
function CardioQuickLog({
  cardioLog,
  trendLog,
  setCardioLog,
  note
}) {
  const [type, setType] = useState("ride");
  const [form, setForm] = useState({
    date: today(),
    minutes: "",
    miles: "",
    steps: ""
  });
  const displayLog = Array.isArray(trendLog) ? trendLog : cardioLog || [];
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      note("Choose a cardio date");
      return;
    }
    const e = {
      id: uid(),
      date: form.date,
      type
    };
    if (type === "steps") {
      const steps = Number(form.steps);
      if (!Number.isFinite(steps) || steps <= 0 || steps > 200000) {
        note("Enter steps from 1 to 200,000");
        return;
      }
      e.steps = Math.round(steps);
    } else {
      const minutes = Number(form.minutes) || 0;
      const miles = Number(form.miles) || 0;
      if (
        !Number.isFinite(minutes)
        || !Number.isFinite(miles)
        || minutes < 0
        || minutes > 1440
        || miles < 0
        || miles > 500
      ) {
        note("Use 0–1,440 minutes and 0–500 miles");
        return;
      }
      if (!minutes && !miles) {
        note("Enter minutes or miles");
        return;
      }
      e.minutes = minutes;
      e.miles = miles;
    }
    setCardioLog(current => [e, ...(current || [])]);
    setForm({
      date: form.date,
      minutes: "",
      miles: "",
      steps: ""
    });
    note("Cardio logged");
  };
  const metric = type === "steps" ? "steps" : "miles";
  const data = useMemo(() => displayLog.filter(x => x.type === type).slice().reverse().slice(-14).map(x => ({
    date: x.date,
    v: type === "steps" ? x.steps || 0 : x.miles || 0
  })), [displayLog, type]);
  const cut = localDateKey(new Date(Date.now() - 7 * 864e5));
  const wk = displayLog.filter(x => x.type === type && x.date >= cut);
  const wkMiles = wk.reduce((a, x) => a + (x.miles || 0), 0);
  const wkMin = wk.reduce((a, x) => a + (x.minutes || 0), 0);
  const wkSteps = wk.reduce((a, x) => a + (x.steps || 0), 0);
  const tt = {
    contentStyle: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 8,
      fontSize: 12
    },
    labelStyle: {
      color: C.dim
    }
  };
  const color = type === "ride" ? C.blue : type === "run" ? C.red : C.gold;
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Cardio Tracker",
    sub: "Log rides, runs & steps — trend shown below"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12
    }
  }, [["ride", "Ride"], ["run", "Run"], ["steps", "Steps"]].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setType(k),
    className: "ttl",
    style: {
      flex: 1,
      padding: "8px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      background: type === k ? color : C.panel2,
      color: type === k ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "flex-end",
      flexWrap: "wrap",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "date",
    "aria-label": "Cardio entry date",
    value: form.date,
    onChange: e => setForm({
      ...form,
      date: e.target.value
    }),
    style: inp(120)
  }), type === "steps" ? /*#__PURE__*/React.createElement(MiniIn, {
    value: form.steps,
    onChange: v => setForm({
      ...form,
      steps: v
    }),
    suffix: "steps"
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MiniIn, {
    value: form.minutes,
    onChange: v => setForm({
      ...form,
      minutes: v
    }),
    suffix: "min"
  }), /*#__PURE__*/React.createElement(MiniIn, {
    value: form.miles,
    onChange: v => setForm({
      ...form,
      miles: v
    }),
    suffix: "mi"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: add,
    style: btnSm()
  }, "+ Log")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginBottom: 12
    }
  }, type === "steps" ? /*#__PURE__*/React.createElement(Stat, {
    label: "Steps this wk",
    value: wkSteps.toLocaleString(),
    color: color
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Stat, {
    label: "Miles this wk",
    value: wkMiles.toFixed(1),
    color: color
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Minutes this wk",
    value: wkMin,
    color: C.green
  })), /*#__PURE__*/React.createElement(Stat, {
    label: "Sessions",
    value: wk.length,
    color: C.dim
  })), data.length < 2 ? /*#__PURE__*/React.createElement(Empty, {
    text: `Log 2+ ${type === "steps" ? "step days" : type + "s"} to see the trend.`
  }) : /*#__PURE__*/React.createElement(ResponsiveContainer, {
    width: "100%",
    height: 160
  }, /*#__PURE__*/React.createElement(LineChart, {
    data: data,
    margin: {
      top: 6,
      right: 8,
      left: -8,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement(CartesianGrid, {
    stroke: C.line,
    strokeDasharray: "2 4"
  }), /*#__PURE__*/React.createElement(XAxis, {
    dataKey: "date",
    tick: {
      fill: C.dim,
      fontSize: 10
    },
    tickFormatter: d => d.slice(5)
  }), /*#__PURE__*/React.createElement(YAxis, {
    tick: {
      fill: C.dim,
      fontSize: 10
    }
  }), /*#__PURE__*/React.createElement(Tooltip, tt), /*#__PURE__*/React.createElement(Line, {
    type: "monotone",
    dataKey: "v",
    name: metric,
    stroke: color,
    strokeWidth: 2.5,
    dot: {
      r: 3
    }
  }))));
}

/* ============ CORE / ABDOMINAL ============ */
const CORE_MOVES = [{
  n: "Hanging Leg Raise",
  unit: "reps",
  amt: 12
}, {
  n: "Weighted Sit-Up",
  unit: "reps",
  amt: 15
}, {
  n: "Air Bike",
  unit: "reps",
  amt: 20
}, {
  n: "Russian Twist",
  unit: "reps",
  amt: 30
}, {
  n: "Plank",
  unit: "sec",
  amt: 45
}, {
  n: "Side Plank (each)",
  unit: "sec",
  amt: 30
}, {
  n: "Cable Crunch",
  unit: "reps",
  amt: 15
}, {
  n: "Cable Woodchop (each)",
  unit: "reps",
  amt: 12
}, {
  n: "Side Crunch (each)",
  unit: "reps",
  amt: 15
}, {
  n: "Ab Wheel Rollout",
  unit: "reps",
  amt: 10
}, {
  n: "Hollow Body Hold",
  unit: "sec",
  amt: 30
}, {
  n: "Flutter Kicks",
  unit: "sec",
  amt: 30
}, {
  n: "V-Up",
  unit: "reps",
  amt: 12
}, {
  n: "Mountain Climbers",
  unit: "sec",
  amt: 40
}, {
  n: "Dead Bug (each)",
  unit: "reps",
  amt: 10
}, {
  n: "Reverse Crunch",
  unit: "reps",
  amt: 15
}];
function CoreTab({
  mode,
  note,
  onComplete
}) {
  const [size, setSize] = useState(5);
  const [rounds, setRounds] = useState(3);
  const [seed, setSeed] = useState(1);
  const [run, setRun] = useState(null);
  const circuit = useMemo(() => {
    const out = [];
    const used = {};
    let i = seed * 3;
    while (out.length < size && Object.keys(used).length < CORE_MOVES.length) {
      const m = CORE_MOVES[i % CORE_MOVES.length];
      i++;
      if (!used[m.n]) {
        used[m.n] = true;
        out.push(m);
      }
    }
    return out;
  }, [size, seed]);
  const completed = new Set(run?.completed || []);
  const activeCircuit = run?.circuit || circuit;
  const activeRounds = run?.rounds || rounds;
  const toggleMove = index => {
    setRun(current => {
      if (!current) return current;
      const next = new Set(current.completed || []);
      if (next.has(index)) next.delete(index);else next.add(index);
      return {
        ...current,
        completed: [...next]
      };
    });
  };
  const finishCircuit = () => {
    if (!run) {
      setRun({
        startedAt: Date.now(),
        completed: [],
        circuit: circuit.map(move => ({ ...move })),
        rounds: Number(rounds) || 1
      });
      note("Core circuit started");
      return;
    }
    const selected = activeCircuit.filter((_, index) => completed.has(index));
    if (!selected.length) {
      note("Check off at least one move");
      return;
    }
    onComplete({
      title: `Core Circuit · ${activeRounds} rounds`,
      sessionType: "core",
      mode,
      startedAt: run.startedAt,
      entries: selected.map(move => ({
        name: move.n,
        summary: `${activeRounds} × ${move.amt} ${move.unit}`
      })),
      metadata: {
        rounds: Number(activeRounds) || 1
      }
    });
    setRun(null);
    note("Core circuit saved");
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Core & Abs",
    sub: "Build a circuit — do it for the round count, rest 30–45s between rounds"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Circuit length"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12
    }
  }, [["Quick", 3], ["Standard", 5], ["Burner", 7]].map(([l, n]) => /*#__PURE__*/React.createElement("button", {
    key: n,
    onClick: () => setSize(n),
    className: "ttl",
    style: {
      flex: 1,
      padding: "9px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      background: size === n ? C.gold : C.panel2,
      color: size === n ? "#111" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      display: "block",
      opacity: 0.7
    }
  }, n, " moves")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "flex-end",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Rounds"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: rounds,
    onChange: v => setRounds(v)
  })), /*#__PURE__*/React.createElement("button", {
    onClick: () => setSeed(seed + 1),
    style: {
      flex: 1,
      padding: "11px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.txt,
      fontFamily: "'Oswald'",
      fontSize: 12.5,
      fontWeight: 700,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "↻ New Circuit"))), /*#__PURE__*/React.createElement(Panel, {
    title: `Your Circuit · ${activeRounds} rounds`,
    sub: "Weighted where it makes sense; bodyweight otherwise"
  }, activeCircuit.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 0",
      borderBottom: i < activeCircuit.length - 1 ? `1px solid ${C.line}` : "none"
    }
  }, run && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": `${completed.has(i) ? "Uncheck" : "Complete"} ${m.n}`,
    onClick: () => toggleMove(i),
    style: {
      width: 26,
      height: 26,
      borderRadius: 13,
      border: `2px solid ${completed.has(i) ? C.green : C.line}`,
      background: completed.has(i) ? C.green : "transparent",
      color: "#111",
      cursor: "pointer"
    }
  }, completed.has(i) ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      width: 22,
      color: C.gold,
      fontWeight: 700
    }
  }, i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600
    }
  }, m.n), /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: C.green
    }
  }, m.amt, " ", m.unit))), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: finishCircuit,
    style: {
      width: "100%",
      marginTop: 14,
      padding: "13px",
      background: run ? C.green : C.gold,
      border: "none",
      borderRadius: 10,
      color: "#111",
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 14,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, run ? `Finish & Save · ${completed.size}/${activeCircuit.length}` : "Start Circuit")), /*#__PURE__*/React.createElement(Stopwatch, null));
}

/* ============ HIIT (cardio machine intervals) ============ */
const HIIT_PROTOCOLS = [{
  id: "tabata",
  name: "Tabata",
  work: 20,
  rest: 10,
  rounds: 8,
  note: "All-out efforts, classic fat-burner."
}, {
  id: "3030",
  name: "30 / 30",
  work: 30,
  rest: 30,
  rounds: 10,
  note: "Balanced work-to-rest, very sustainable."
}, {
  id: "4020",
  name: "40 / 20",
  work: 40,
  rest: 20,
  rounds: 8,
  note: "Longer pushes, shorter recovery."
}, {
  id: "6060",
  name: "60 / 60",
  work: 60,
  rest: 60,
  rounds: 8,
  note: "Threshold intervals, big engine builder."
}, {
  id: "sprint",
  name: "Sprint 15/45",
  work: 15,
  rest: 45,
  rounds: 10,
  note: "Max sprints, full recovery — power."
}];
const VO2_PROTOCOLS = [{
  id: "vo2-4x4",
  name: "Norwegian 4 × 4",
  category: "vo2",
  work: 240,
  rest: 180,
  rounds: 4,
  warmupMinutes: 10,
  cooldownMinutes: 5,
  intensity: "90–95% HR max · RPE 8–9",
  note: "Four controlled hard efforts with active recovery."
}, {
  id: "vo2-starter",
  name: "VO₂ Starter 4 × 2",
  category: "vo2",
  work: 120,
  rest: 120,
  rounds: 4,
  warmupMinutes: 8,
  cooldownMinutes: 5,
  intensity: "RPE 8 · finish with good form",
  note: "A shorter entry point before progressing to four-minute efforts."
}, {
  id: "vo2-3030",
  name: "VO₂ 30 / 30 Builder",
  category: "vo2",
  work: 30,
  rest: 30,
  rounds: 12,
  warmupMinutes: 8,
  cooldownMinutes: 5,
  intensity: "RPE 8–9 · repeatable pace",
  note: "Short repeats that accumulate quality time at high aerobic output."
}];
const MACHINES = ["Bike", "Treadmill", "Rower", "Elliptical", "Stair"];
function HiitTab({
  note,
  mode,
  onComplete
}) {
  const [machine, setMachine] = useState("Bike");
  const [category, setCategory] = useState("vo2");
  const [proto, setProto] = useState(VO2_PROTOCOLS[0]);
  const protocols = category === "vo2" ? VO2_PROTOCOLS : HIIT_PROTOCOLS;
  const selectCategory = next => {
    setCategory(next);
    setProto(next === "vo2" ? VO2_PROTOCOLS[0] : HIIT_PROTOCOLS[1]);
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Conditioning Command Center",
    sub: "Choose VO₂ max development or shorter HIIT, then run the guided timer"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 14
    }
  }, [["vo2", "VO₂ Max"], ["hiit", "HIIT"]].map(([key, label]) => /*#__PURE__*/React.createElement("button", {
    key: key,
    type: "button",
    onClick: () => selectCategory(key),
    className: "ttl",
    style: {
      flex: 1,
      padding: "9px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      background: category === key ? C.blue : C.panel2,
      color: category === key ? "#fff" : C.dim,
      border: `1px solid ${category === key ? C.blue : C.line}`
    }
  }, label))), category === "vo2" && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 12px",
      marginBottom: 14,
      borderRadius: 9,
      background: "rgba(167,139,250,.10)",
      border: "1px solid rgba(167,139,250,.35)",
      color: C.dim,
      fontSize: 11.5,
      lineHeight: 1.5
    }
  }, "Warm up first, keep the hard efforts controlled, and cool down afterward. Start with 1–2 VO₂ sessions per week. Stop for chest pain, faintness, or unusual shortness of breath."), /*#__PURE__*/React.createElement("div", {
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Machine"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      marginBottom: 14
    }
  }, MACHINES.map(m => /*#__PURE__*/React.createElement("button", {
    key: m,
    onClick: () => setMachine(m),
    className: "ttl",
    style: {
      padding: "8px 12px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 700,
      background: machine === m ? C.blue : C.panel2,
      color: machine === m ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, m))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Protocol"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, protocols.map(p => /*#__PURE__*/React.createElement("button", {
    key: p.id,
    onClick: () => setProto(p),
    style: {
      textAlign: "left",
      padding: "11px 12px",
      borderRadius: 8,
      cursor: "pointer",
      background: proto.id === p.id ? "rgba(79,209,255,.12)" : C.panel2,
      border: `1px solid ${proto.id === p.id ? C.blue : C.line}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, p.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: C.gold,
      fontWeight: 700
    }
  }, p.work, "s / ", p.rest, "s × ", p.rounds)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      marginTop: 2
    }
  }, p.note, " · ~", Math.round((p.work * p.rounds + p.rest * Math.max(0, p.rounds - 1)) / 60), " min intervals", p.intensity ? ` · ${p.intensity}` : "")))), proto.category === "vo2" && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10,
      color: C.dim,
      fontSize: 11.5,
      lineHeight: 1.5
    }
  }, `${proto.warmupMinutes} min warm-up · ${proto.intensity} · ${proto.cooldownMinutes} min cool-down`))), /*#__PURE__*/React.createElement(IntervalTimer, {
    key: proto.id,
    proto: proto,
    machine: machine,
    note: note,
    onComplete: ({ startedAt }) => onComplete({
      title: `${proto.name} · ${machine}`,
      sessionType: proto.category === "vo2" ? "vo2" : "hiit",
      mode,
      startedAt,
      entries: [{
        name: machine,
        summary: `${proto.rounds} × ${proto.work}s hard / ${proto.rest}s recovery`
      }],
      metadata: {
        protocolId: proto.id,
        machine,
        intervalWorkSeconds: proto.work,
        intervalRestSeconds: proto.rest,
        rounds: proto.rounds,
        warmupMinutes: proto.warmupMinutes || 0,
        cooldownMinutes: proto.cooldownMinutes || 0
      }
    })
  }));
}
function IntervalTimer({
  proto,
  machine,
  note,
  onComplete
}) {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("ready"); // ready | work | rest | done
  const [round, setRound] = useState(1);
  const [left, setLeft] = useState(proto.work);
  const ref = useRef(null);
  const startedAtRef = useRef(null);
  const completedRef = useRef(false);
  const beep = freq => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      o.stop(ctx.currentTime + 0.25);
      o.onended = () => ctx.close().catch(() => {});
    } catch (e) {}
  };
  useEffect(() => {
    if (!running) return;
    ref.current = setInterval(() => {
      setLeft(l => {
        if (l > 1) {
          if (l <= 4) beep(600);
          return l - 1;
        }
        // phase transition
        setPhase(ph => {
          if (ph === "work") {
            if (round >= proto.rounds) {
              beep(300);
              setRunning(false);
              return "done";
            }
            beep(440);
            return "rest";
          } else {
            setRound(r => r + 1);
            beep(880);
            return "work";
          }
        });
        return -1; // will be corrected by the phase effect below
      });
    }, 1000);
    return () => clearInterval(ref.current);
    /* eslint-disable-next-line */
  }, [running, round]);
  // when phase changes, reset the seconds for the new phase
  useEffect(() => {
    if (phase === "work") setLeft(proto.work);else if (phase === "rest") setLeft(proto.rest);else if (phase === "done") {
      note && note(onComplete
        ? `${proto.category === "vo2" ? "VO₂" : "HIIT"} session saved`
        : "Rounds complete");
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete && onComplete({
          startedAt: startedAtRef.current || Date.now()
        });
      }
    }
    /* eslint-disable-next-line */
  }, [phase]);
  const startStop = () => {
    if (phase === "ready" || phase === "done") {
      startedAtRef.current = Date.now();
      completedRef.current = false;
      setPhase("work");
      setRound(1);
      setLeft(proto.work);
      setRunning(true);
      beep(880);
    } else setRunning(!running);
  };
  const reset = () => {
    setRunning(false);
    setPhase("ready");
    setRound(1);
    setLeft(proto.work);
    startedAtRef.current = null;
    completedRef.current = false;
    if (ref.current) clearInterval(ref.current);
  };
  const bg = phase === "work" ? C.red : phase === "rest" ? C.blue : phase === "done" ? C.green : C.panel2;
  const label = phase === "work" ? "WORK" : phase === "rest" ? "REST" : phase === "done" ? "DONE" : "READY";
  return /*#__PURE__*/React.createElement(Panel, {
    title: `${machine} · ${proto.name}`,
    sub: `${proto.work}s work / ${proto.rest}s rest × ${proto.rounds} rounds`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: bg,
      borderRadius: 14,
      padding: "22px 16px",
      textAlign: "center",
      transition: "background .3s"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 15,
      fontWeight: 700,
      color: "#fff",
      letterSpacing: 3
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 60,
      fontWeight: 700,
      color: "#fff",
      lineHeight: 1.1
    }
  }, Math.max(0, left)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "rgba(255,255,255,.85)"
    }
  }, "Round ", Math.min(round, proto.rounds), " of ", proto.rounds)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: startStop,
    style: {
      flex: 2,
      padding: "13px",
      background: running ? C.gold : C.green,
      border: "none",
      borderRadius: 10,
      color: "#111",
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 14,
      textTransform: "uppercase",
      letterSpacing: 1,
      cursor: "pointer"
    }
  }, running ? "Pause" : phase === "ready" || phase === "done" ? "Start" : "Resume"), /*#__PURE__*/React.createElement("button", {
    onClick: reset,
    style: {
      flex: 1,
      padding: "13px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontWeight: 600,
      fontSize: 13,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Reset")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim,
      marginTop: 10,
      textAlign: "center"
    }
  }, "Beeps on the last 3 seconds and at every switch. Keep your phone unlocked for sound."));
}

/* ============ PLAN BUILDER (5 questions) ============ */
const EST_MAXES = {
  new: {
    bench: 95,
    squat: 135,
    ohp: 65,
    deadlift: 155
  },
  some: {
    bench: 155,
    squat: 205,
    ohp: 95,
    deadlift: 245
  },
  experienced: {
    bench: 225,
    squat: 315,
    ohp: 135,
    deadlift: 335
  },
  advanced: {
    bench: 305,
    squat: 405,
    ohp: 175,
    deadlift: 455
  }
};
function PlanBuilder({
  setMaxes,
  setGoal,
  setGender,
  setStyleOverride,
  setOnboarded,
  done,
  note
}) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState({
    exp: "some",
    goal: "vtaper",
    gender: "men",
    style: "hypertrophy",
    knows: "estimate",
    maxes: {
      bench: "",
      squat: "",
      ohp: "",
      deadlift: ""
    }
  });
  const Q = [{
    key: "exp",
    title: "How much lifting experience do you have?",
    opts: [["new", "New — just starting"], ["some", "Some — a few months in"], ["experienced", "Experienced — a few years"], ["advanced", "Advanced — many years"]]
  }, {
    key: "gender",
    title: "Who's this plan for?",
    opts: [["women", "Women"], ["men", "Men"]]
  }, {
    key: "goal",
    title: "What's your main goal?",
    opts: [["vtaper", "Build muscle · V-taper"], ["glutes", "Glutes & legs"], ["tone", "Tone & sculpt"], ["strength", "Get stronger"], ["recomp", "Lean out · recomp"]]
  }, {
    key: "style",
    title: "How do you like to train?",
    opts: [["strength", "Heavy — low reps, long rests"], ["hypertrophy", "Balanced — moderate reps"], ["tone", "Light — high reps, short rests"]]
  }, {
    key: "knows",
    title: "Your starting weights",
    opts: [["estimate", "Estimate for me — I'm not sure"], ["enter", "I'll enter my own"]]
  }];
  const finish = () => {
    setGender(a.gender);
    setGoal(a.goal);
    setStyleOverride(a.style);
    if (a.knows === "enter") {
      const m = {};
      ["bench", "squat", "ohp", "deadlift"].forEach(k => {
        m[k] = Number(a.maxes[k]) || EST_MAXES[a.exp][k];
      });
      setMaxes(m);
    } else setMaxes({
      ...EST_MAXES[a.exp]
    });
    setOnboarded(true);
    note("Your plan is ready!");
    done();
  };
  const cur = Q[step];
  return /*#__PURE__*/React.createElement(Panel, {
    title: `Build My Plan · ${step + 1}/5`,
    sub: "Quick questions — this sets everything to your level"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 700,
      marginBottom: 14
    }
  }, cur.title), cur.key !== "knows" || true ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, cur.opts.map(([v, l]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setA({
      ...a,
      [cur.key]: v
    }),
    style: {
      textAlign: "left",
      padding: "12px 14px",
      borderRadius: 10,
      cursor: "pointer",
      background: a[cur.key] === v ? "rgba(225,29,42,.14)" : C.panel2,
      border: `1px solid ${a[cur.key] === v ? C.red : C.line}`,
      color: C.txt,
      fontSize: 14,
      fontWeight: a[cur.key] === v ? 700 : 500
    }
  }, l))) : null, cur.key === "knows" && a.knows === "enter" && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, [["bench", "Bench"], ["squat", "Squat"], ["ohp", "Overhead Press"], ["deadlift", "Deadlift"]].map(([k, l]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13
    }
  }, l), /*#__PURE__*/React.createElement(MiniIn, {
    value: a.maxes[k],
    onChange: v => setA({
      ...a,
      maxes: {
        ...a.maxes,
        [k]: v
      }
    }),
    suffix: "1RM"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim
    }
  }, "Leave any blank and I'll estimate it from your experience.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 16
    }
  }, step > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: () => setStep(step - 1),
    style: {
      flex: 1,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontWeight: 600,
      fontSize: 12.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "‹ Back"), /*#__PURE__*/React.createElement("button", {
    onClick: () => step < 4 ? setStep(step + 1) : finish(),
    style: {
      flex: 2,
      padding: "12px",
      background: C.red,
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, step < 4 ? "Next ›" : "Build My Plan ✓")), /*#__PURE__*/React.createElement("button", {
    onClick: done,
    style: {
      width: "100%",
      marginTop: 10,
      background: "none",
      border: "none",
      color: C.dim,
      fontSize: 12,
      cursor: "pointer"
    }
  }, "Cancel"));
}

/* ============ CUSTOM WORKOUT BUILDER ============ */
function CustomBuilder({
  mode,
  customDays,
  setCustomDays,
  startCustom,
  done,
  note
}) {
  const groups = Object.keys(LIB);
  const [name, setName] = useState("");
  const [rows, setRows] = useState([]);
  const [grp, setGrp] = useState(groups[0]);
  const [ex, setEx] = useState("");
  const [sets, setSets] = useState(3);
  const [reps, setReps] = useState(10);
  const poolNames = poolFor(grp, mode).map(x => x.n);
  const addRow = () => {
    const name2 = ex || poolNames[0];
    if (!name2) return;
    setRows([...rows, {
      ex: name2,
      sets: Number(sets) || 3,
      reps: Number(reps) || 10,
      role: grp === "Core" ? "ab" : "acc"
    }]);
    setEx("");
  };
  const save = run => {
    if (!rows.length) {
      note("Add at least one exercise");
      return;
    }
    const cd = {
      id: uid(),
      name: name.trim() || "My Workout",
      rows
    };
    setCustomDays([cd, ...(customDays || [])]);
    note("Saved");
    if (run) startCustom(cd);
    done();
  };
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Build Your Own",
    sub: "Pick exercises, sets and reps — make the workout you want"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Workout name"
  }, /*#__PURE__*/React.createElement("input", {
    value: name,
    onChange: e => setName(e.target.value),
    placeholder: "e.g. My Push Day",
    style: inp("100%")
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      background: C.panel2,
      borderRadius: 10,
      padding: 12,
      border: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "Add an exercise"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("select", {
    value: grp,
    onChange: e => {
      setGrp(e.target.value);
      setEx("");
    },
    style: {
      ...inp("40%"),
      padding: "9px 8px"
    }
  }, groups.map(g => /*#__PURE__*/React.createElement("option", {
    key: g,
    value: g
  }, g))), /*#__PURE__*/React.createElement("select", {
    value: ex,
    onChange: e => setEx(e.target.value),
    style: {
      ...inp("60%"),
      padding: "9px 8px"
    }
  }, poolNames.map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: sets,
    onChange: setSets,
    suffix: "sets"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim
    }
  }, "×"), /*#__PURE__*/React.createElement(MiniIn, {
    value: reps,
    onChange: setReps,
    suffix: "reps"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addRow,
    style: btnSm()
  }, "+ Add"))), rows.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      fontWeight: 600
    }
  }, r.ex), /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      fontSize: 13,
      color: C.gold,
      fontWeight: 700
    }
  }, r.sets, "×", r.reps), /*#__PURE__*/React.createElement("button", {
    onClick: () => setRows(rows.filter((_, j) => j !== i)),
    style: {
      background: "none",
      border: "none",
      color: C.dim,
      cursor: "pointer",
      fontSize: 16
    }
  }, "×")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: done,
    style: {
      flex: 1,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontFamily: "'Oswald'",
      fontWeight: 600,
      fontSize: 12.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    onClick: () => save(false),
    style: {
      flex: 1,
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${C.gold}`,
      borderRadius: 10,
      color: C.gold,
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 12.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Save"), /*#__PURE__*/React.createElement("button", {
    onClick: () => save(true),
    style: {
      flex: 1.4,
      padding: "12px",
      background: C.red,
      border: "none",
      borderRadius: 10,
      color: "#fff",
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 12.5,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "Save & Start")));
}

/* ============ MACROS / NUTRITION ============ */
const ACTIVITY = [["sed", "Sedentary", 1.2], ["light", "Lightly active", 1.375], ["mod", "Moderately active", 1.55], ["very", "Very active", 1.725], ["ath", "Athlete", 1.9]];
function MacrosTab({
  macros,
  setMacros
}) {
  const [f, setF] = useState(macros || {
    sex: "male",
    age: 30,
    ft: 6,
    in: 3,
    weight: 242,
    goalWeight: 225,
    activity: "mod",
    pace: 1
  });
  const kg = f.weight * 0.4536;
  const cm = ((Number(f.ft) || 0) * 12 + (Number(f.in) || 0)) * 2.54;
  const bmr = f.sex === "male" ? 10 * kg + 6.25 * cm - 5 * f.age + 5 : 10 * kg + 6.25 * cm - 5 * f.age - 161;
  const actF = (ACTIVITY.find(x => x[0] === f.activity) || ACTIVITY[2])[2];
  const tdee = bmr * actF;
  const dir = f.goalWeight < f.weight ? -1 : f.goalWeight > f.weight ? 1 : 0;
  const rate = Number(f.pace) || 1; // lb/week
  let cals = Math.round(tdee + dir * rate * 500);
  const floor = Math.round(bmr * 1.0);
  if (cals < floor) cals = floor; // don't prescribe below BMR
  const proteinG = Math.round(Math.max(f.goalWeight, f.weight * 0.9)); // ~1g per lb of goal bodyweight
  const fatG = Math.round(cals * 0.27 / 9);
  const carbG = Math.max(0, Math.round((cals - proteinG * 4 - fatG * 9) / 4));
  const weeks = dir === 0 ? 0 : Math.ceil(Math.abs(f.weight - f.goalWeight) / rate);
  const save = () => setMacros(f);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: "Macro & Protein Calculator",
    sub: "Estimates your daily targets to reach a goal weight"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: 12
    }
  }, [["male", "Male"], ["female", "Female"]].map(([v, l]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setF({
      ...f,
      sex: v
    }),
    className: "ttl",
    style: {
      flex: 1,
      padding: "9px",
      borderRadius: 8,
      cursor: "pointer",
      fontSize: 12.5,
      fontWeight: 700,
      background: f.sex === v ? C.red : C.panel2,
      color: f.sex === v ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Age"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: f.age,
    onChange: v => setF({
      ...f,
      age: v
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Height ft"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: f.ft,
    onChange: v => setF({
      ...f,
      ft: v
    })
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Height in"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: f.in,
    onChange: v => setF({
      ...f,
      in: v
    })
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Weight"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: f.weight,
    onChange: v => setF({
      ...f,
      weight: v
    }),
    suffix: "lb"
  })), /*#__PURE__*/React.createElement(Field, {
    label: "Goal weight"
  }, /*#__PURE__*/React.createElement(MiniIn, {
    value: f.goalWeight,
    onChange: v => setF({
      ...f,
      goalWeight: v
    }),
    suffix: "lb"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      margin: "6px 0"
    }
  }, "Activity"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 5,
      flexWrap: "wrap",
      marginBottom: 10
    }
  }, ACTIVITY.map(([v, l]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setF({
      ...f,
      activity: v
    }),
    style: {
      padding: "7px 10px",
      borderRadius: 7,
      cursor: "pointer",
      fontSize: 11.5,
      fontWeight: 600,
      background: f.activity === v ? C.blue : C.panel2,
      color: f.activity === v ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l))), dir !== 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      margin: "6px 0"
    }
  }, "Pace (", dir < 0 ? "lose" : "gain", ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, [[0.5, "Slow ·0.5/wk"], [1, "Moderate ·1/wk"], [1.5, "Fast ·1.5/wk"]].map(([v, l]) => /*#__PURE__*/React.createElement("button", {
    key: v,
    onClick: () => setF({
      ...f,
      pace: v
    }),
    style: {
      flex: 1,
      padding: "8px",
      borderRadius: 7,
      cursor: "pointer",
      fontSize: 11,
      fontWeight: 600,
      background: Number(f.pace) === v ? C.red : C.panel2,
      color: Number(f.pace) === v ? "#fff" : C.dim,
      border: `1px solid ${C.line}`
    }
  }, l)))), /*#__PURE__*/React.createElement("button", {
    onClick: save,
    style: {
      width: "100%",
      marginTop: 14,
      padding: "11px",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 10,
      color: C.dim,
      fontSize: 12,
      cursor: "pointer"
    }
  }, "Save these inputs")), /*#__PURE__*/React.createElement(Panel, {
    title: "Your Daily Targets",
    sub: dir === 0 ? "Maintenance" : `To reach ${f.goalWeight} lb${weeks ? ` · ~${weeks} weeks` : ""}`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 40,
      fontWeight: 700,
      color: C.red
    }
  }, cals.toLocaleString()), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.dim
    }
  }, "calories / day · TDEE ≈ ", Math.round(tdee).toLocaleString())), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Stat, {
    label: "Protein",
    value: `${proteinG}g`,
    color: C.green
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Carbs",
    value: `${carbG}g`,
    color: C.gold
  }), /*#__PURE__*/React.createElement(Stat, {
    label: "Fat",
    value: `${fatG}g`,
    color: C.blue
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: C.dim,
      marginTop: 14,
      lineHeight: 1.6
    }
  }, "Protein is set near 1 g per lb of goal bodyweight to protect muscle", dir < 0 ? " in a deficit" : "", ". Calories won't drop below your BMR. These are estimates — a registered dietitian can tailor them, especially if you have medical considerations.")));
}

/* ============ IDEAS ============ */
const IDEAS = [["Health app sync", "Auto-import bodyweight, steps, and heart rate from Apple Health / Google Health so you don't log them by hand."], ["Auto-update maxes", "When you beat an estimated 1RM in a logged set, offer to bump your max so targets keep pace."], ["Warm-up generator", "Auto-build warm-up ramp sets (e.g. bar → 50% → 70%) before your first heavy set."], ["Progress photos", "Private dated photos with side-by-side compare to see the recomp your scale can't."], ["Rest-day & readiness", "Track sleep/soreness and flag when to push or pull back — smarter than a fixed deload."], ["Exercise how-to", "A short form cue or demo link on each movement for anyone new to it."], ["Supersets & circuits", "Pair exercises to superset in the live view, with a combined rest timer."], ["Reminders", "Optional nudge to train, hit protein, or log bodyweight."], ["Water & sleep tracking", "Simple daily logs that sit alongside cardio and bodyweight trends."], ["Crew kudos", "Let the crew react to each other's PRs — light social push, no open chat."], ["CSV / share export", "Export history and trends to share with a coach or spreadsheet."], ["Wearable companion", "A watch face for logging sets and starting the rest timer from your wrist."]];
function IdeasTab({
  setTab
}) {
  return /*#__PURE__*/React.createElement(Panel, {
    title: "Ideas & Roadmap",
    sub: "Things I'd add next — here for you to review and pick from"
  }, IDEAS.map(([t, d], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "11px 0",
      borderBottom: i < IDEAS.length - 1 ? `1px solid ${C.line}` : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "ttl",
    style: {
      color: C.gold,
      fontWeight: 700,
      width: 20
    }
  }, i + 1), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.dim,
      marginTop: 2,
      lineHeight: 1.5
    }
  }, d))))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: C.dim,
      marginTop: 14,
      lineHeight: 1.6
    }
  }, "Tell me which of these you want and I'll build them. The macro calculator, custom-workout builder, and 5-question plan setup are already live — check the Today and Macros tabs."));
}

/* ============ DISCIPLINES: MMA · PILATES · YOGA ============ */
function m(n, amt, unit, cue) {
  return {
    n,
    amt,
    unit,
    cue
  };
}
const DISCIPLINES = {
  mma: {
    name: "MMA",
    color: "#ff8a3d",
    rounds: true,
    blurb: "Striking, grappling & fight conditioning. Use the round timer for live rounds.",
    lib: {
      Striking: [m("Jab–Cross (1-2)", 3, "rounds", "Snap punches back to guard, exhale each strike."), m("Jab–Cross–Hook (1-2-3)", 3, "rounds", "Rotate the hips into the hook."), m("Low Leg Kick", 20, "each", "Turn the hip over, strike with the shin."), m("Teep / Push Kick", 20, "each", "Drive the ball of the foot, hands up."), m("Roundhouse Kick", 15, "each", "Pivot the base foot all the way through."), m("Knee Strikes (clinch)", 20, "reps", "Pull down on the collar tie, drive the knee up."), m("Elbow Strikes", 20, "reps", "Short range, turn the shoulder over.")],
      Grappling: [m("Sprawls", 30, "sec", "Hips to the floor, kick the legs back fast."), m("Double-Leg Takedown (drill)", 10, "reps", "Change levels, penetration step, drive."), m("Shrimp / Hip Escape", 8, "each", "Push off the feet, make space with the hips."), m("Technical Stand-Up", 8, "reps", "Post the hand, stay guarded coming up."), m("Bridge & Roll (Upa)", 8, "each", "Trap the arm, bridge over the shoulder.")],
      Conditioning: [m("Burpees", 15, "reps", "Explode up, chest to the floor."), m("Jump Rope", 60, "sec", "Light on the toes, relaxed shoulders."), m("Bag Blast (max punches)", 30, "sec", "All-out volume, don't drop the hands."), m("Mountain Climbers", 40, "sec", "Hips low, fast knees."), m("Kettlebell Swing", 20, "reps", "Hinge at the hips, snap through.")],
      Footwork: [m("Shadowbox Footwork", 3, "rounds", "Balls of the feet, circle both directions."), m("Slip & Roll", 45, "sec", "Slip under the imaginary hook, stay balanced."), m("Pivot Drill", 45, "sec", "Pivot off the lead foot to cut an angle.")]
    },
    standards: [{
      name: "Fundamentals",
      level: "Beginner",
      note: "Learn the base movements at an easy pace.",
      moves: [m("Shadowbox Footwork", 3, "rounds", "Circle both ways, hands up."), m("Jab–Cross (1-2)", 3, "rounds", "Back to guard every time."), m("Sprawls", 30, "sec", "3 sets, rest as needed."), m("Shrimp / Hip Escape", 8, "each", "2 lengths."), m("Burpees", 10, "reps", "3 sets.")]
    }, {
      name: "Striking Rounds",
      level: "Intermediate",
      note: "Bag or shadow — sharp, technical volume.",
      moves: [m("Shadowbox Footwork", 1, "rounds", "Warm up."), m("Jab–Cross–Hook (1-2-3)", 4, "rounds", "Crisp combos."), m("Low Leg Kick", 20, "each", "3 sets."), m("Teep / Push Kick", 20, "each", "3 sets."), m("Slip & Roll", 45, "sec", "3 sets.")]
    }, {
      name: "Grappling & Conditioning",
      level: "Intermediate",
      note: "Wrestling base plus a gas-tank finisher.",
      moves: [m("Double-Leg Takedown (drill)", 10, "reps", "4 sets."), m("Sprawls", 30, "sec", "4 sets."), m("Shrimp / Hip Escape", 8, "each", "3 sets."), m("Bridge & Roll (Upa)", 8, "each", "3 sets."), m("Kettlebell Swing", 20, "reps", "3 sets."), m("Burpees", 12, "reps", "3 sets.")]
    }, {
      name: "Fight Cardio Circuit",
      level: "Conditioning",
      note: "HIIT-style — run it 40s work / 20s rest x4.",
      moves: [m("Bag Blast (max punches)", 40, "sec", ""), m("Mountain Climbers", 40, "sec", ""), m("Jump Rope", 40, "sec", ""), m("Burpees", 40, "sec", ""), m("Kettlebell Swing", 40, "sec", "")]
    }]
  },
  pilates: {
    name: "Pilates",
    color: "#c084fc",
    rounds: false,
    blurb: "Controlled mat work for core strength, control & posture. Move slow, breathe.",
    lib: {
      Core: [m("The Hundred", 100, "breaths", "Pump the arms, navel to spine, breathe wide."), m("Roll-Up", 8, "reps", "Peel the spine off the mat one bone at a time."), m("Single Leg Stretch", 10, "each", "Draw the knee in, keep the core braced."), m("Double Leg Stretch", 10, "reps", "Reach and circle the arms with control."), m("Criss-Cross", 12, "each", "Opposite elbow toward knee, slow twist."), m("Scissors", 10, "each", "Long legs, switch with control."), m("Teaser", 6, "reps", "Roll up into a V and balance."), m("Leg Circles", 8, "each", "Small circles, hips stay still.")],
      Mat: [m("Roll Like a Ball", 8, "reps", "Balance, roll back and up smoothly."), m("Spine Stretch Forward", 6, "reps", "Round forward, reach long."), m("Saw", 6, "each", "Twist and reach past the pinky toe."), m("Swan", 8, "reps", "Lift the chest, long spine, glutes on."), m("Shoulder Bridge", 10, "reps", "Roll the hips up, squeeze the glutes."), m("Plank Hold", 40, "sec", "Straight line head to heels, brace."), m("Side Kick Series", 10, "each", "Torso stable, the leg moves freely."), m("Swimming", 30, "sec", "Opposite arm/leg flutter, long body.")],
      Stability: [m("Side Plank", 30, "each", "Stack, lift the hips, stay steady."), m("Bird-Dog", 10, "each", "Opposite arm/leg, no wobble."), m("Pelvic Curl", 10, "reps", "Articulate the spine up and down.")]
    },
    standards: [{
      name: "Beginner Mat Flow",
      level: "Beginner",
      note: "Gentle intro to the classical order.",
      moves: [m("Pelvic Curl", 10, "reps", ""), m("The Hundred", 100, "breaths", "Modified: feet down if needed."), m("Roll-Up", 6, "reps", ""), m("Leg Circles", 6, "each", ""), m("Roll Like a Ball", 8, "reps", ""), m("Single Leg Stretch", 10, "each", ""), m("Spine Stretch Forward", 6, "reps", ""), m("Shoulder Bridge", 10, "reps", ""), m("Side Kick Series", 10, "each", ""), m("Plank Hold", 30, "sec", "")]
    }, {
      name: "Core Focus",
      level: "Intermediate",
      note: "The Pilates ab series, front to back.",
      moves: [m("The Hundred", 100, "breaths", ""), m("Single Leg Stretch", 10, "each", ""), m("Double Leg Stretch", 10, "reps", ""), m("Criss-Cross", 12, "each", ""), m("Scissors", 10, "each", ""), m("Teaser", 6, "reps", ""), m("Plank Hold", 45, "sec", ""), m("Side Plank", 30, "each", "")]
    }, {
      name: "Posture & Back",
      level: "All levels",
      note: "Undo desk posture, strengthen the back line.",
      moves: [m("Swan", 8, "reps", ""), m("Bird-Dog", 10, "each", ""), m("Shoulder Bridge", 10, "reps", ""), m("Spine Stretch Forward", 6, "reps", ""), m("Swimming", 30, "sec", ""), m("Side Kick Series", 10, "each", "")]
    }]
  },
  yoga: {
    name: "Yoga",
    color: "#4ade80",
    rounds: false,
    blurb: "Flows for mobility, balance & recovery. Hold with steady breath; ease into each pose.",
    lib: {
      "Sun Salutation": [m("Mountain (Tadasana)", 20, "sec", "Stand tall, grounded, breathe."), m("Forward Fold", 30, "sec", "Hinge at the hips, soft knees."), m("Halfway Lift", 15, "sec", "Flat back, gaze forward."), m("Plank", 30, "sec", "Strong line, shoulders over wrists."), m("Chaturanga", 5, "reps", "Elbows in, lower halfway with control."), m("Upward Dog", 20, "sec", "Chest open, thighs lifted off the mat."), m("Downward Dog", 40, "sec", "Hips up and back, heels toward the floor.")],
      Standing: [m("Warrior I", 30, "each", "Front knee bent, arms up, hips forward."), m("Warrior II", 30, "each", "Open the hips, gaze over the front hand."), m("Warrior III", 20, "each", "Balance, body in one straight line."), m("Triangle", 30, "each", "Long side body, open the chest."), m("Chair", 30, "sec", "Sit back, weight in the heels."), m("Crescent Lunge", 30, "each", "Sink the hips, lift the chest.")],
      Balance: [m("Tree", 30, "each", "Foot to calf or thigh, steady gaze."), m("Eagle", 20, "each", "Wrap and squeeze, sink low."), m("Half Moon", 20, "each", "Open through the top hand.")],
      Floor: [m("Cat-Cow", 8, "reps", "Flow the spine with the breath."), m("Cobra", 20, "sec", "Lift the chest, elbows soft."), m("Bridge", 30, "sec", "Lift the hips, roll the shoulders under."), m("Boat", 20, "sec", "V-sit, lift the chest, core on."), m("Pigeon", 45, "each", "Hip opener, keep the hips square."), m("Seated Forward Fold", 45, "sec", "Long spine, fold from the hips."), m("Supine Twist", 30, "each", "Knees over, gaze the other way."), m("Child's Pose", 45, "sec", "Rest, breathe into the back.")],
      Restorative: [m("Legs-Up-the-Wall", 90, "sec", "Relax, let the blood flow back."), m("Savasana", 120, "sec", "Total stillness, let everything go.")]
    },
    standards: [{
      name: "Morning Flow",
      level: "All levels",
      note: "Wake the body up, gentle to moving.",
      moves: [m("Cat-Cow", 8, "reps", ""), m("Downward Dog", 40, "sec", ""), m("Sun Salutation A", 3, "rounds", "Fold→Plank→Chaturanga→UpDog→DownDog."), m("Warrior I", 30, "each", ""), m("Warrior II", 30, "each", ""), m("Triangle", 30, "each", ""), m("Tree", 30, "each", ""), m("Forward Fold", 30, "sec", ""), m("Savasana", 120, "sec", "")]
    }, {
      name: "Athlete Recovery (Yin)",
      level: "Recovery",
      note: "Long holds — perfect after a heavy lift day.",
      moves: [m("Pigeon", 60, "each", "Breathe into the hip."), m("Seated Forward Fold", 60, "sec", ""), m("Supine Twist", 45, "each", ""), m("Bridge", 30, "sec", ""), m("Legs-Up-the-Wall", 120, "sec", ""), m("Child's Pose", 60, "sec", ""), m("Savasana", 120, "sec", "")]
    }, {
      name: "Post-Lift Stretch",
      level: "All levels",
      note: "Open hips, hamstrings, spine and shoulders.",
      moves: [m("Downward Dog", 40, "sec", ""), m("Crescent Lunge", 30, "each", ""), m("Pigeon", 45, "each", ""), m("Seated Forward Fold", 45, "sec", ""), m("Supine Twist", 30, "each", ""), m("Child's Pose", 45, "sec", "")]
    }, {
      name: "Beginner Basics",
      level: "Beginner",
      note: "Foundational poses with plenty of time.",
      moves: [m("Mountain (Tadasana)", 20, "sec", ""), m("Cat-Cow", 8, "reps", ""), m("Downward Dog", 40, "sec", ""), m("Warrior II", 30, "each", ""), m("Triangle", 30, "each", ""), m("Tree", 30, "each", ""), m("Child's Pose", 45, "sec", ""), m("Savasana", 120, "sec", "")]
    }]
  }
};
function DisciplineTab({
  id,
  note,
  mode,
  onComplete
}) {
  const cfg = DISCIPLINES[id];
  const groups = Object.keys(cfg.lib);
  const KEY = "irondesk:disc:" + id;
  const [view, setView] = useState("home");
  const [active, setActive] = useState(null);
  const [custom, setCustom] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch (e) {
      return [];
    }
  });
  // builder
  const [bName, setBName] = useState("");
  const [bRows, setBRows] = useState([]);
  const [grp, setGrp] = useState(groups[0]);
  const [pick, setPick] = useState(cfg.lib[groups[0]][0].n);
  const saveCustom = list => {
    setCustom(list);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (e) {}
  };
  const run = w => {
    setActive({
      name: w.name,
      startedAt: Date.now(),
      moves: w.moves.map(x => ({
        ...x,
        done: false
      }))
    });
    setView("run");
  };
  const toggle = i => setActive({
    ...active,
    moves: active.moves.map((x, j) => j === i ? {
      ...x,
      done: !x.done
    } : x)
  });
  if (view === "run" && active) {
    const done = active.moves.filter(x => x.done).length;
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
      title: active.name,
      sub: `${done}/${active.moves.length} done · tap each as you finish`
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 6,
        background: C.panel2,
        borderRadius: 3,
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 6,
        width: `${done / active.moves.length * 100}%`,
        background: cfg.color,
        borderRadius: 3,
        transition: "width .3s"
      }
    })), active.moves.map((x, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 0",
        borderBottom: i < active.moves.length - 1 ? `1px solid ${C.line}` : "none"
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => toggle(i),
      style: {
        width: 26,
        height: 26,
        borderRadius: 13,
        flexShrink: 0,
        border: `2px solid ${x.done ? cfg.color : C.line}`,
        background: x.done ? cfg.color : "transparent",
        color: "#111",
        fontWeight: 700,
        cursor: "pointer"
      }
    }, x.done ? "✓" : ""), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        opacity: x.done ? 0.5 : 1
      }
    }, x.n), x.cue && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.dim,
        marginTop: 1
      }
    }, x.cue)), /*#__PURE__*/React.createElement("span", {
      className: "ttl",
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: cfg.color,
        whiteSpace: "nowrap"
      }
    }, x.amt, " ", x.unit))), /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        const completedMoves = active.moves.filter(move => move.done);
        if (!completedMoves.length) {
          note("Check off at least one move");
          return;
        }
        onComplete({
          title: active.name,
          sessionType: id,
          mode,
          startedAt: active.startedAt,
          entries: completedMoves.map(move => ({
            name: move.n,
            summary: `${move.amt} ${move.unit}`
          }))
        });
        setActive(null);
        setView("home");
        note(`${cfg.name} workout saved`);
      },
      style: {
        width: "100%",
        marginTop: 14,
        padding: "13px",
        background: cfg.color,
        border: "none",
        borderRadius: 10,
        color: "#111",
        fontFamily: "'Oswald'",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Finish")), cfg.rounds && /*#__PURE__*/React.createElement(IntervalTimer, {
      proto: {
        id: "round",
        name: "Rounds",
        work: 180,
        rest: 60,
        rounds: 5
      },
      machine: "Round",
      note: note
    }), /*#__PURE__*/React.createElement(Stopwatch, null));
  }
  if (view === "build") {
    const addRow = () => {
      const src = cfg.lib[grp].find(x => x.n === pick) || cfg.lib[grp][0];
      setBRows([...bRows, {
        ...src
      }]);
    };
    const save = start => {
      if (!bRows.length) {
        note("Add at least one move");
        return;
      }
      const w = {
        name: bName.trim() || `My ${cfg.name}`,
        moves: bRows
      };
      saveCustom([{
        id: uid(),
        ...w
      }, ...custom]);
      note("Saved");
      if (start) run(w);else setView("home");
      setBRows([]);
      setBName("");
    };
    return /*#__PURE__*/React.createElement(Panel, {
      title: `Build a ${cfg.name} Workout`,
      sub: "Pick moves and amounts — make your own routine"
    }, /*#__PURE__*/React.createElement(Field, {
      label: "Name"
    }, /*#__PURE__*/React.createElement("input", {
      value: bName,
      onChange: e => setBName(e.target.value),
      placeholder: `My ${cfg.name}`,
      style: inp("100%")
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12,
        background: C.panel2,
        borderRadius: 10,
        padding: 12,
        border: `1px solid ${C.line}`
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("select", {
      value: grp,
      onChange: e => {
        setGrp(e.target.value);
        setPick(cfg.lib[e.target.value][0].n);
      },
      style: {
        ...inp("42%"),
        padding: "9px 8px"
      }
    }, groups.map(g => /*#__PURE__*/React.createElement("option", {
      key: g,
      value: g
    }, g))), /*#__PURE__*/React.createElement("select", {
      value: pick,
      onChange: e => setPick(e.target.value),
      style: {
        ...inp("58%"),
        padding: "9px 8px"
      }
    }, cfg.lib[grp].map(x => /*#__PURE__*/React.createElement("option", {
      key: x.n,
      value: x.n
    }, x.n)))), /*#__PURE__*/React.createElement("button", {
      onClick: addRow,
      style: {
        ...btnSm(),
        background: cfg.color,
        color: "#111"
      }
    }, "+ Add move")), bRows.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 12
      }
    }, bRows.map((r, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        borderBottom: `1px solid ${C.line}`
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 14,
        fontWeight: 600
      }
    }, r.n), /*#__PURE__*/React.createElement(MiniIn, {
      value: r.amt,
      onChange: v => setBRows(bRows.map((x, j) => j === i ? {
        ...x,
        amt: v
      } : x)),
      suffix: r.unit
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => setBRows(bRows.filter((_, j) => j !== i)),
      style: {
        background: "none",
        border: "none",
        color: C.dim,
        cursor: "pointer",
        fontSize: 16
      }
    }, "×")))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 10,
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => setView("home"),
      style: {
        flex: 1,
        padding: "12px",
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        color: C.dim,
        fontFamily: "'Oswald'",
        fontWeight: 600,
        fontSize: 12.5,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      onClick: () => save(false),
      style: {
        flex: 1,
        padding: "12px",
        background: C.panel2,
        border: `1px solid ${cfg.color}`,
        borderRadius: 10,
        color: cfg.color,
        fontFamily: "'Oswald'",
        fontWeight: 700,
        fontSize: 12.5,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Save"), /*#__PURE__*/React.createElement("button", {
      onClick: () => save(true),
      style: {
        flex: 1.4,
        padding: "12px",
        background: cfg.color,
        border: "none",
        borderRadius: 10,
        color: "#111",
        fontFamily: "'Oswald'",
        fontWeight: 700,
        fontSize: 12.5,
        textTransform: "uppercase",
        cursor: "pointer"
      }
    }, "Save & Start")));
  }

  // home
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
    title: cfg.name,
    sub: cfg.blurb
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setView("build"),
    style: {
      width: "100%",
      padding: "12px",
      background: C.panel2,
      border: `1px solid ${cfg.color}`,
      borderRadius: 10,
      color: cfg.color,
      fontFamily: "'Oswald'",
      fontWeight: 700,
      fontSize: 13,
      textTransform: "uppercase",
      cursor: "pointer"
    }
  }, "✎ Build Your Own ", cfg.name)), custom.length > 0 && /*#__PURE__*/React.createElement(Panel, {
    title: "Your Workouts",
    sub: "Built by you — tap to run"
  }, custom.map(w => /*#__PURE__*/React.createElement("div", {
    key: w.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 0",
      borderBottom: `1px solid ${C.line}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 600
    }
  }, w.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.dim
    }
  }, w.moves.length, " moves")), /*#__PURE__*/React.createElement("button", {
    onClick: () => run(w),
    style: {
      padding: "8px 14px",
      background: cfg.color,
      border: "none",
      borderRadius: 8,
      color: "#111",
      fontWeight: 700,
      fontSize: 12,
      cursor: "pointer"
    }
  }, "Start"), /*#__PURE__*/React.createElement("button", {
    onClick: () => saveCustom(custom.filter(x => x.id !== w.id)),
    style: {
      background: "none",
      border: "none",
      color: C.dim,
      cursor: "pointer",
      fontSize: 16
    }
  }, "×")))), /*#__PURE__*/React.createElement(Panel, {
    title: "Standard Workouts",
    sub: "Ready to go — no experience needed, each move has a cue"
  }, cfg.standards.map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 12,
      padding: "12px 14px",
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 15,
      fontWeight: 700
    }
  }, w.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: cfg.color,
      letterSpacing: 0.5,
      marginTop: 1
    }
  }, w.level.toUpperCase(), " · ", w.moves.length, " MOVES")), /*#__PURE__*/React.createElement("button", {
    onClick: () => run(w),
    style: {
      padding: "9px 16px",
      background: cfg.color,
      border: "none",
      borderRadius: 8,
      color: "#111",
      fontWeight: 700,
      fontSize: 12.5,
      cursor: "pointer"
    }
  }, "Start")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.dim,
      marginTop: 6,
      lineHeight: 1.4
    }
  }, w.note)))));
}

/* ============ SHARED UI ============ */
const inp = w => ({
  background: C.panel2,
  border: `1px solid ${C.line}`,
  borderRadius: 6,
  color: C.txt,
  padding: "8px 10px",
  fontSize: 13,
  width: w,
  fontFamily: "'Archivo',sans-serif",
  outline: "none"
});
const btnSm = () => ({
  padding: "9px 14px",
  background: C.red,
  border: "none",
  borderRadius: 8,
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12
});
const btnFull = (bg, txt) => ({
  width: "100%",
  marginTop: 10,
  padding: "12px",
  background: bg,
  border: bg === C.panel2 ? `1px solid ${C.line}` : "none",
  borderRadius: 10,
  color: txt || "#fff",
  fontFamily: "'Oswald'",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
  cursor: "pointer"
});
function Panel({
  title,
  sub,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 14,
      padding: "16px 14px",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("h2", {
    className: "ttl",
    style: {
      fontSize: 15.5,
      fontWeight: 600,
      margin: 0
    }
  }, title), sub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: C.dim,
      margin: "3px 0 13px"
    }
  }, sub), children);
}
function Badge({
  color,
  children
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      background: `${color}26`,
      color,
      fontSize: 9,
      fontWeight: 700,
      padding: "1px 6px",
      borderRadius: 4,
      marginLeft: 6,
      letterSpacing: 0.5,
      verticalAlign: "middle"
    }
  }, children);
}
function Stat({
  label,
  value,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      background: C.panel2,
      borderRadius: 10,
      padding: "12px 6px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ttl",
    style: {
      fontSize: 20,
      fontWeight: 700,
      color
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: 2
    }
  }, label));
}
function MiniIn({
  value,
  onChange,
  suffix,
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      background: C.panel2,
      border: `1px solid ${C.line}`,
      borderRadius: 6,
      padding: "0 8px",
      width: 86
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "number",
    "aria-label": label || `${suffix || "Value"} input`,
    value: value,
    onChange: e => onChange(e.target.value === "" ? "" : Number(e.target.value)),
    style: {
      width: "100%",
      background: "transparent",
      border: "none",
      outline: "none",
      color: C.txt,
      fontSize: 14,
      fontWeight: 600,
      padding: "8px 0",
      fontFamily: "'Archivo',sans-serif"
    }
  }), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: C.dim,
      marginLeft: 3,
      whiteSpace: "nowrap"
    }
  }, suffix));
}
function LoadChips({
  total,
  bar,
  plates
}) {
  const {
    total: got,
    counts
  } = solveLoadout(total, Number(bar), plates);
  const order = [55, 45, 35, 25, 10, 5, 2.5].filter(w => counts[w]);
  const off = got - total;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 4,
      alignItems: "center",
      marginTop: 3
    }
  }, order.length === 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.dim,
      fontSize: 11
    }
  }, "bar only"), order.map(w => /*#__PURE__*/React.createElement("span", {
    key: w,
    style: {
      background: C.panel,
      border: `1px solid ${C.line}`,
      borderRadius: 4,
      padding: "1px 6px",
      fontSize: 11
    }
  }, counts[w], "× ", /*#__PURE__*/React.createElement("b", {
    style: {
      color: C.gold
    }
  }, w), "/s")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: off === 0 ? C.green : C.gold,
      fontSize: 10.5
    }
  }, "= ", got, off ? ` (${off > 0 ? "+" : ""}${off})` : " ✓"));
}
function Field({
  label,
  children
}) {
  const control = React.isValidElement(children) ? React.cloneElement(children, {
    "aria-label": children.props["aria-label"] || label
  }) : children;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.dim,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 4
    }
  }, label), control);
}
function Empty({
  text
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.dim,
      fontSize: 13,
      textAlign: "center",
      padding: "14px 0"
    }
  }, text);
}

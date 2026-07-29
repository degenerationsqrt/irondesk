import assert from "node:assert/strict";
import test from "node:test";
import { Encoder, Profile } from "@garmin/fitsdk";
import {
  garminMessagesToSessions,
  garminMetricItems,
  mergeGarminSessions,
  parseGarminCsv,
  parseGarminFit,
} from "../src/garminImport.js";

test("Garmin activity CSV rows become additive IronDesk sessions", () => {
  const csv = [
    "Activity ID,Activity Type,Date,Title,Distance,Calories,Time,Avg HR,Max HR,VO2 Max",
    '12345,Strength Training,07/22/2026 6:15 AM,"Lunch, Lifts",0,412,01:03:30,121,164,',
    "67890,Running,2026-07-21 07:30:00,Morning Run,3.10 mi,505,00:28:45,148,177,42.8",
  ].join("\r\n");

  const result = parseGarminCsv(csv, { sourceFile: "Activities.csv" });

  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].date, "2026-07-22");
  assert.equal(result.sessions[0].dayId, "Lunch, Lifts");
  assert.equal(result.sessions[0].durationMin, 64);
  assert.equal(result.sessions[0].sourceKey, "garmin:activity:12345");
  assert.equal(result.sessions[0].sourceDevice, "Garmin fēnix 6X");
  assert.equal(result.sessions[1].garmin.distanceDisplay, "3.10 mi");
  assert.equal(Math.round(result.sessions[1].garmin.distanceMeters), 4989);
  assert.equal(result.sessions[1].garmin.vo2Max, 42.8);
});

test("IronDesk CSV exports are rejected as Garmin imports", () => {
  assert.throws(
    () => parseGarminCsv("workout_id,date,exercise,weight_lb\none,2026-07-22,Squat,225"),
    /Garmin activity CSV/,
  );
});

test("decoded FIT strength sets retain reps and convert kilograms to pounds", () => {
  const start = new Date("2026-07-22T18:00:00Z");
  const messages = {
    fileIdMesgs: [{
      productName: "fēnix 6X Pro",
      serialNumber: 4242,
      timeCreated: start,
    }],
    sessionMesgs: [{
      startTime: start,
      timestamp: new Date("2026-07-22T19:00:00Z"),
      sport: "training",
      subSport: "strengthTraining",
      totalTimerTime: 3600,
      totalCalories: 400,
      avgHeartRate: 115,
      maxHeartRate: 158,
    }],
    setMesgs: [
      {
        setType: "active",
        category: ["benchPress"],
        categorySubtype: [1],
        repetitions: 5,
        weight: 100,
      },
      {
        setType: "rest",
        duration: 120,
      },
    ],
  };

  const [session] = garminMessagesToSessions(messages, {
    sourceFile: "strength.fit",
    profile: Profile,
  });

  assert.equal(session.dayId, "Garmin Strength Training");
  assert.equal(session.sourceDevice, "fēnix 6X Pro");
  assert.equal(session.entries[0].ex, "Barbell Bench Press");
  assert.deepEqual(
    { weight: session.entries[0].sets[0].w, reps: session.entries[0].sets[0].r },
    { weight: 220.5, reps: 5 },
  );
  assert.equal(session.garmin.totalReps, 5);
  assert.equal(session.volume, 1103);
});

test("the official Garmin SDK decodes an in-memory FIT activity", async () => {
  const encoder = new Encoder();
  const start = new Date("2026-07-23T16:00:00Z");
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "activity",
    manufacturer: "garmin",
    product: 1,
    serialNumber: 8675309,
    timeCreated: start,
    productName: "fēnix 6X",
  });
  encoder.onMesg(Profile.MesgNum.SET, {
    timestamp: new Date("2026-07-23T16:10:00Z"),
    startTime: new Date("2026-07-23T16:09:30Z"),
    duration: 30,
    repetitions: 8,
    weight: 45,
    setType: "active",
    category: ["squat"],
    categorySubtype: [0],
  });
  encoder.onMesg(Profile.MesgNum.SESSION, {
    timestamp: new Date("2026-07-23T16:45:00Z"),
    startTime: start,
    sport: "training",
    subSport: "strengthTraining",
    totalElapsedTime: 2700,
    totalTimerTime: 2400,
    totalCalories: 325,
    avgHeartRate: 110,
    maxHeartRate: 151,
  });

  const encoded = encoder.close();
  const result = await parseGarminFit(encoded, { sourceFile: "sample.fit" });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].date, "2026-07-23");
  assert.equal(result.sessions[0].durationMin, 40);
  assert.equal(result.sessions[0].garmin.calories, 325);
  assert.equal(result.sessions[0].entries[0].sets[0].r, 8);
});

test("repeat imports are skipped without replacing existing sessions", () => {
  const imported = parseGarminCsv([
    "Activity ID,Activity Type,Date,Title,Time",
    "12345,Running,2026-07-22,Evening Run,00:30:00",
    "12345,Running,2026-07-22,Evening Run,00:30:00",
  ].join("\n")).sessions;
  const manualSession = {
    id: "manual",
    date: "2026-07-20",
    dayId: "Manual Strength",
    mode: "gym",
    entries: [],
  };
  const result = mergeGarminSessions([manualSession], imported);

  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.sessions.length, 2);
  assert.ok(result.sessions.includes(manualSession));
});

test("Garmin metric labels omit missing data", () => {
  assert.deepEqual(
    garminMetricItems({
      garmin: {
        calories: 412,
        avgHeartRate: 121,
        maxHeartRate: null,
        totalReps: 36,
        vo2Max: 42.8,
      },
    }),
    [
      ["Calories", "412"],
      ["Avg HR", "121 bpm"],
      ["VO₂ Max", "42.8 ml/kg/min"],
      ["Reps", "36"],
    ],
  );
});

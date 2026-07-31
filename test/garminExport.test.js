import assert from "node:assert/strict";
import test from "node:test";
import { Decoder, Stream } from "@garmin/fitsdk";
import { strFromU8, unzipSync } from "fflate";
import {
  createGarminActivityFit,
  createGarminActivityPack,
  createGarminWorkoutFit,
  garminExportSummary,
  isGarminActivityExportableSession,
  isGarminExportableSession,
  isGarminWorkoutExportableSession,
} from "../src/garminExport.js";
import { parseGarminFit } from "../src/garminImport.js";

const session = {
  id: "strength-1",
  date: "2026-07-24",
  startedAt: "2026-07-24T17:00:00Z",
  dayId: "Upper Strength",
  durationMin: 42,
  mode: "gym",
  source: "irondesk",
  entries: [
    {
      ex: "Barbell Bench Press",
      role: "comp",
      sets: [
        { w: 225, r: 5 },
        { w: 235, r: 3 },
      ],
    },
    {
      ex: "One-Arm DB Row",
      role: "acc",
      sets: [{ w: 75, r: 10 }],
    },
  ],
};

function decodeFit(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
  assert.equal(decoder.isFIT(), true);
  assert.equal(decoder.checkIntegrity(), true);
  const freshDecoder = new Decoder(Stream.fromArrayBuffer(buffer));
  return freshDecoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  }).messages;
}

test("completed IronDesk activities are eligible but Garmin imports are not", () => {
  assert.equal(isGarminExportableSession(session), true);
  assert.equal(isGarminActivityExportableSession(session), true);
  assert.equal(isGarminWorkoutExportableSession(session), true);
  assert.equal(isGarminExportableSession({ ...session, source: "garmin" }), false);
  assert.equal(isGarminActivityExportableSession({ ...session, entries: [] }), true);
  assert.equal(isGarminWorkoutExportableSession({ ...session, entries: [] }), false);
});

test("guided Progress History sessions create Garmin activity FIT files", () => {
  const vo2Session = {
    id: "vo2-1",
    date: "2026-07-25",
    startedAt: "2026-07-25T17:00:00Z",
    completedAt: Date.parse("2026-07-25T17:28:00Z"),
    dayId: "Norwegian 4 × 4",
    sessionType: "vo2",
    durationMin: 28,
    mode: "gym",
    entries: [{ ex: "Treadmill", summary: "4 × 4 min hard", sets: [] }],
  };

  assert.equal(isGarminActivityExportableSession(vo2Session), true);
  assert.equal(isGarminWorkoutExportableSession(vo2Session), false);
  const messages = decodeFit(createGarminActivityFit(vo2Session));
  assert.equal(messages.sessionMesgs[0].sport, "hiit");
  assert.equal(messages.sessionMesgs[0].subSport, "hiit");
  assert.equal((messages.setMesgs || []).length, 0);
  assert.equal(messages.sessionMesgs[0].totalTimerTime, 28 * 60);
  assert.throws(
    () => createGarminWorkoutFit(vo2Session),
    /completed set/i,
  );
});

test("guided activity types use valid Garmin FIT sport profiles", () => {
  const cases = [
    ["core", "training", "cardioTraining"],
    ["hiit", "hiit", "hiit"],
    ["mma", "mixedMartialArts", "generic"],
    ["pilates", "fitnessEquipment", "pilates"],
    ["yoga", "training", "yoga"],
  ];

  cases.forEach(([sessionType, sport, subSport], index) => {
    const messages = decodeFit(createGarminActivityFit({
      id: `guided-${sessionType}`,
      date: `2026-07-${String(20 + index).padStart(2, "0")}`,
      dayId: `${sessionType} session`,
      sessionType,
      durationMin: 20,
      entries: [{ ex: sessionType, summary: "Completed", sets: [] }],
    }));
    assert.equal(messages.sessionMesgs[0].sport, sport);
    assert.equal(messages.sessionMesgs[0].subSport, subSport);
  });
});

test("IronDesk creates an integrity-valid Garmin activity FIT with strength sets", async () => {
  const bytes = createGarminActivityFit(session);
  const messages = decodeFit(bytes);
  assert.equal(messages.fileIdMesgs[0].type, "activity");
  assert.equal(messages.sessionMesgs[0].sport, "training");
  assert.equal(messages.sessionMesgs[0].subSport, "strengthTraining");
  assert.equal(messages.setMesgs.length, 3);
  assert.equal(messages.setMesgs[0].repetitions, 5);
  assert.ok(Math.abs(messages.setMesgs[0].weight - 102.058) < 0.01);

  const imported = await parseGarminFit(bytes, { sourceFile: "irondesk.fit" });
  assert.equal(imported.sessions.length, 1);
  assert.equal(imported.sessions[0].entries.length, 2);
  assert.equal(imported.sessions[0].entries[0].sets[0].r, 5);
});

test("IronDesk creates an integrity-valid fenix strength workout FIT", () => {
  const bytes = createGarminWorkoutFit(session, {
    restSeconds: 75,
    workoutName: "ID Upper A",
  });
  const messages = decodeFit(bytes);
  assert.equal(messages.fileIdMesgs[0].type, "workout");
  assert.equal(messages.workoutMesgs[0].sport, "training");
  assert.equal(messages.workoutMesgs[0].subSport, "strengthTraining");
  assert.equal(messages.workoutMesgs[0].wktName, "ID Upper A");
  assert.equal(messages.workoutMesgs[0].numValidSteps, 5);
  assert.equal(messages.workoutStepMesgs.length, 5);
  assert.equal(messages.workoutStepMesgs[0].durationType, "reps");
  assert.equal(messages.workoutStepMesgs[0].durationReps, 5);
  assert.equal(messages.workoutStepMesgs[1].intensity, "rest");
  assert.equal(messages.workoutStepMesgs[1].durationTime, 75);
});

test("activity packs contain FIT files plus upload instructions", () => {
  const second = { ...session, id: "strength-2", date: "2026-07-25", dayId: "Lower Strength" };
  const archive = unzipSync(createGarminActivityPack([session, second]));
  const names = Object.keys(archive);
  assert.equal(names.filter((name) => name.endsWith(".fit")).length, 2);
  assert.match(
    strFromU8(archive["IRONDESK-GARMIN-IMPORT.txt"]),
    /Garmin Connect activity pack/i,
  );
});

test("Garmin export summaries report sets, reps, and duration", () => {
  assert.deepEqual(garminExportSummary(session), {
    sets: 3,
    reps: 18,
    durationMinutes: 42,
  });
});


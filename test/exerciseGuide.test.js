import assert from "node:assert/strict";
import test from "node:test";
import {
  CHATGPT_EXERCISE_URL,
  buildExerciseChatPrompt,
  createExerciseGuideCatalog,
  normalizeExerciseName,
  searchExerciseGuides,
} from "../src/exerciseGuide.js";

test("exercise catalog normalizes timed movements and removes duplicates", () => {
  const catalog = createExerciseGuideCatalog([
    { name: "Back Squat", category: "Legs", equipment: "both" },
    { name: "Back Squat", category: "Compound" },
    { name: "Incline Walk — 12 min", category: "Conditioning" },
  ]);

  assert.deepEqual(catalog.map((guide) => guide.name), ["Back Squat", "Incline Walk"]);
  assert.equal(catalog[0].category, "Legs");
  assert.equal(catalog[0].equipment, "Home or gym equipment");
  assert.equal(normalizeExerciseName("Bike — 20 min"), "Bike");
});

test("exercise search matches names, muscles, and equipment", () => {
  const catalog = createExerciseGuideCatalog([
    { name: "Back Squat", category: "Legs", equipment: "both" },
    { name: "Lat Pulldown", category: "Back", equipment: "gym" },
  ]);

  assert.deepEqual(searchExerciseGuides(catalog, "squat").map((guide) => guide.name), ["Back Squat"]);
  assert.deepEqual(searchExerciseGuides(catalog, "lats gym").map((guide) => guide.name), ["Lat Pulldown"]);
  assert.equal(typeof catalog[0].searchString, "string");
  assert.deepEqual(
    searchExerciseGuides(catalog, "knees inward").map((guide) => guide.name),
    ["Back Squat"],
  );
});

test("ChatGPT handoff contains only the selected exercise guidance and question", () => {
  const guide = createExerciseGuideCatalog(["Romanian Deadlift"])[0];
  const prompt = buildExerciseChatPrompt(guide, "How far should I lower the dumbbells?");

  assert.match(prompt, /Exercise: Romanian Deadlift/);
  assert.match(prompt, /How far should I lower the dumbbells/);
  assert.match(prompt, /Do not diagnose injuries/);
  assert.equal(prompt.includes("Garmin"), false);
  assert.equal(CHATGPT_EXERCISE_URL, "https://chatgpt.com/");
});

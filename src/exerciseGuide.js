export const CHATGPT_EXERCISE_URL = "https://chatgpt.com/";

const DEFAULT_GUIDE = {
  category: "Training",
  muscles: ["Primary working muscles", "Core stabilizers"],
  equipment: "Use the equipment shown in your workout",
  steps: [
    "Set the equipment and your body in a balanced, repeatable starting position.",
    "Move through a controlled range of motion without using momentum.",
    "Finish each rep in control, reset your brace, and repeat consistently.",
  ],
  cues: ["Move with control", "Keep a steady brace", "Stop before technique breaks down"],
  mistakes: ["Rushing the repetition", "Using more load than you can control", "Training through sharp pain"],
};

const GUIDE_RULES = [
  {
    match: /incline walk|bike|interval|jump rope|bag blast|mountain climber|burpee|cardio/,
    category: "Conditioning",
    muscles: ["Heart and lungs", "Legs", "Core"],
    equipment: "Cardio equipment or open floor",
    steps: [
      "Begin at an easy pace long enough to settle your breathing and posture.",
      "Build to the programmed effort while keeping your movement smooth and repeatable.",
      "Reduce the pace gradually at the end instead of stopping abruptly.",
    ],
    cues: ["Tall posture", "Relax the shoulders", "Use a pace you can repeat"],
    mistakes: ["Starting too fast", "Holding your breath", "Ignoring dizziness or unusual chest discomfort"],
  },
  {
    match: /hip thrust|glute bridge|shoulder bridge/,
    category: "Glutes",
    muscles: ["Glutes", "Hamstrings", "Core"],
    equipment: "Bench, floor, band, or barbell",
    steps: [
      "Plant your feet firmly and brace your ribs over your pelvis.",
      "Drive through the whole foot and extend the hips without arching the lower back.",
      "Pause with the glutes tight, then lower under control.",
    ],
    cues: ["Ribs down", "Drive through the floor", "Finish with the glutes"],
    mistakes: ["Overarching the lower back", "Pushing mainly through the toes", "Letting the knees collapse inward"],
  },
  {
    match: /romanian deadlift|stiff-leg deadlift|deadlift|good morning|kettlebell swing/,
    category: "Posterior Chain",
    muscles: ["Hamstrings", "Glutes", "Back"],
    equipment: "Barbell, dumbbells, or kettlebell",
    steps: [
      "Set your feet, brace your trunk, and keep the load close to your body.",
      "Push the hips back while keeping a long, neutral spine and stable knees.",
      "Drive the floor away and stand tall without leaning backward at the top.",
    ],
    cues: ["Hips back", "Keep the load close", "Push the floor away"],
    mistakes: ["Rounding the back", "Letting the load drift forward", "Jerking the weight from the floor"],
  },
  {
    match: /squat|leg press|hack squat/,
    category: "Legs",
    muscles: ["Quadriceps", "Glutes", "Core"],
    equipment: "Bodyweight, free weights, or machine",
    steps: [
      "Set a stable stance, brace your trunk, and keep the whole foot connected to the floor or platform.",
      "Lower under control while the knees track in the same direction as the toes.",
      "Drive through the floor to stand without losing your brace or balance.",
    ],
    cues: ["Brace before you descend", "Knees follow toes", "Push the floor away"],
    mistakes: ["Heels lifting", "Knees collapsing inward", "Going deeper than you can control"],
  },
  {
    match: /lunge|split squat|step-up/,
    category: "Single-Leg Strength",
    muscles: ["Quadriceps", "Glutes", "Adductors"],
    equipment: "Bodyweight, dumbbells, or barbell",
    steps: [
      "Choose a stance or step height that lets you stay balanced over the working leg.",
      "Lower with control while the front knee tracks over the foot.",
      "Drive through the working foot and finish tall without pushing off excessively with the other leg.",
    ],
    cues: ["Own the balance", "Front foot stays planted", "Drive through the working leg"],
    mistakes: ["Using a stance that is too narrow", "Front knee collapsing inward", "Bouncing out of the bottom"],
  },
  {
    match: /leg extension/,
    category: "Legs",
    muscles: ["Quadriceps"],
    equipment: "Leg-extension machine",
    steps: [
      "Align the machine pivot with your knee and place the pad above the ankle.",
      "Extend the knee smoothly without throwing the pad upward.",
      "Squeeze briefly, then lower the weight under control.",
    ],
    cues: ["Hips stay down", "Smooth extension", "Control the return"],
    mistakes: ["Using momentum", "Lifting the hips", "Locking out forcefully"],
  },
  {
    match: /leg curl|nordic curl/,
    category: "Hamstrings",
    muscles: ["Hamstrings", "Calves"],
    equipment: "Leg-curl machine or anchored bodyweight setup",
    steps: [
      "Set the pad or anchor securely and keep the hips steady.",
      "Bend the knees by contracting the hamstrings without swinging the torso.",
      "Pause briefly and return slowly to the starting position.",
    ],
    cues: ["Hips stay quiet", "Curl with the hamstrings", "Slow return"],
    mistakes: ["Arching the lower back", "Bouncing the weight", "Dropping through the lowering phase"],
  },
  {
    match: /calf raise/,
    category: "Calves",
    muscles: ["Calves", "Foot and ankle stabilizers"],
    equipment: "Floor, step, dumbbells, or machine",
    steps: [
      "Set the ball of the foot securely and keep the ankle aligned.",
      "Rise as high as you can without rolling the ankle outward.",
      "Pause, then lower slowly into a comfortable stretch.",
    ],
    cues: ["Press through the big toe", "Reach tall", "Use the full controlled range"],
    mistakes: ["Bouncing", "Rolling onto the outside of the foot", "Using a shortened range"],
  },
  {
    match: /overhead press|military press|arnold press|push press/,
    category: "Shoulders",
    muscles: ["Shoulders", "Triceps", "Upper back"],
    equipment: "Barbell or dumbbells",
    steps: [
      "Set the hands and feet, squeeze the glutes, and brace the trunk.",
      "Press upward while keeping the load stacked over your center of balance.",
      "Finish with stable shoulders, then lower to the start under control.",
    ],
    cues: ["Ribs down", "Press up and slightly back", "Finish stacked"],
    mistakes: ["Leaning back excessively", "Flaring the ribs", "Lowering faster than you can control"],
  },
  {
    match: /bench press|chest press|db press|push-up|close-grip bench|incline barbell press/,
    category: "Chest",
    muscles: ["Chest", "Triceps", "Front shoulders"],
    equipment: "Bench, barbell, dumbbells, machine, or floor",
    steps: [
      "Set your feet and upper back firmly, then bring the shoulders into a stable position.",
      "Lower the load with the forearms controlled and wrists stacked over the elbows.",
      "Press away while keeping your body position and shoulder control.",
    ],
    cues: ["Upper back stays set", "Wrists over elbows", "Press smoothly"],
    mistakes: ["Shoulders rolling forward", "Bouncing the load", "Using an unstable foot position"],
  },
  {
    match: /bent-over row|one-arm db row|cable row|band row|barbell row/,
    category: "Back",
    muscles: ["Lats", "Mid-back", "Biceps"],
    equipment: "Barbell, dumbbell, cable, or band",
    steps: [
      "Create a stable torso position with a braced trunk and long spine.",
      "Pull the elbow toward the hip or ribs without twisting the body.",
      "Pause briefly, then reach forward under control without losing position.",
    ],
    cues: ["Chest stays quiet", "Lead with the elbow", "Reach and pull"],
    mistakes: ["Jerking the torso", "Shrugging toward the ears", "Cutting the controlled stretch short"],
  },
  {
    match: /pull-up|pulldown/,
    category: "Back",
    muscles: ["Lats", "Upper back", "Biceps"],
    equipment: "Pull-up bar or cable machine",
    steps: [
      "Take a secure grip and begin with a tall, braced torso.",
      "Drive the elbows down while keeping the neck relaxed and chest controlled.",
      "Return to a comfortable full reach without dropping suddenly into the shoulders.",
    ],
    cues: ["Elbows toward the pockets", "Keep the neck long", "Control the stretch"],
    mistakes: ["Swinging for momentum", "Pulling behind the neck", "Dropping through the return"],
  },
  {
    match: /pec-deck|pec deck|cable fly|db fly/,
    category: "Chest",
    muscles: ["Chest", "Front shoulders"],
    equipment: "Dumbbells, cables, or pec-deck machine",
    steps: [
      "Set a stable torso with a soft, fixed bend in the elbows.",
      "Bring the arms together in a wide arc without turning the movement into a press.",
      "Squeeze briefly and reopen only as far as your shoulders remain comfortable.",
    ],
    cues: ["Hug the room", "Keep the elbow angle", "Chest does the work"],
    mistakes: ["Overstretching the shoulders", "Bending and straightening the elbows", "Using momentum"],
  },
  {
    match: /lateral raise|front raise|rear delt|reverse fly|face pull|upright row|3-way db raise/,
    category: "Shoulders",
    muscles: ["Shoulders", "Upper back"],
    equipment: "Dumbbells, cable, band, or machine",
    steps: [
      "Set a light, controllable load and keep the torso quiet.",
      "Move the arms through the intended path without shrugging or swinging.",
      "Pause near the top and lower more slowly than you lifted.",
    ],
    cues: ["Lead with the elbows", "Keep the neck relaxed", "Control the lowering phase"],
    mistakes: ["Using momentum", "Shrugging", "Choosing a load that changes the movement path"],
  },
  {
    match: /shrug/,
    category: "Upper Back",
    muscles: ["Trapezius", "Grip"],
    equipment: "Dumbbells, barbell, or machine",
    steps: [
      "Stand tall with the load balanced and arms long.",
      "Lift the shoulders straight upward without rolling them forward or backward.",
      "Pause at the top, then lower fully under control.",
    ],
    cues: ["Reach shoulders toward ears", "Arms stay long", "Pause and lower"],
    mistakes: ["Rolling the shoulders", "Bending the elbows", "Bouncing the load"],
  },
  {
    match: /tricep|skullcrusher|pushdown|kickback/,
    category: "Arms",
    muscles: ["Triceps"],
    equipment: "Dumbbells, bar, cable, or band",
    steps: [
      "Set the upper arm in a stable position and keep the wrist neutral.",
      "Straighten the elbow without swinging the shoulder or torso.",
      "Squeeze briefly and return through a comfortable range under control.",
    ],
    cues: ["Upper arm stays quiet", "Move at the elbow", "Control the return"],
    mistakes: ["Swinging the shoulder", "Flaring the elbows without control", "Using momentum"],
  },
  {
    match: /curl/,
    category: "Arms",
    muscles: ["Biceps", "Forearms"],
    equipment: "Dumbbells, bar, cable, or band",
    steps: [
      "Stand or sit tall with the upper arms stable and wrists neutral.",
      "Bend the elbows without swinging the torso or drifting the elbows forward.",
      "Squeeze briefly, then lower until the arms are long under control.",
    ],
    cues: ["Elbows stay quiet", "Curl without swinging", "Own the lowering phase"],
    mistakes: ["Leaning backward", "Letting the wrists bend", "Dropping the weight"],
  },
  {
    match: /plank|bird-dog/,
    category: "Core",
    muscles: ["Abdominals", "Obliques", "Shoulder and hip stabilizers"],
    equipment: "Floor or mat",
    steps: [
      "Set your hands or elbows securely and create a long line through the body.",
      "Brace as if preparing for contact while breathing behind the brace.",
      "Hold or move only as far as you can keep the pelvis and ribs controlled.",
    ],
    cues: ["Ribs over pelvis", "Squeeze the floor", "Breathe without losing the brace"],
    mistakes: ["Hips sagging", "Holding the breath", "Continuing after posture changes"],
  },
  {
    match: /crunch|sit-up|leg raise|air bike|hundred|teaser|scissors/,
    category: "Core",
    muscles: ["Abdominals", "Hip flexors"],
    equipment: "Floor, mat, bench, cable, or pull-up bar",
    steps: [
      "Begin with the ribs and pelvis controlled and the neck relaxed.",
      "Move through the trunk or hips without using momentum.",
      "Return slowly while maintaining abdominal tension and steady breathing.",
    ],
    cues: ["Exhale through the effort", "Move from the trunk", "Keep the neck relaxed"],
    mistakes: ["Pulling on the neck", "Swinging the legs", "Losing control of the lower back"],
  },
  {
    match: /twist|woodchop|side bend|saw/,
    category: "Core",
    muscles: ["Obliques", "Abdominals", "Hip stabilizers"],
    equipment: "Bodyweight, cable, band, or dumbbell",
    steps: [
      "Set a balanced base and brace before beginning the rotation or side bend.",
      "Move through a controlled range led by the trunk rather than the arms alone.",
      "Return to center slowly without losing your posture.",
    ],
    cues: ["Rotate with control", "Hips stay organized", "Return slowly"],
    mistakes: ["Yanking with the arms", "Moving beyond a comfortable range", "Rushing between sides"],
  },
  {
    match: /warrior|downward dog|upward dog|pigeon|forward fold|child's pose|tadasana|triangle|tree|cobra|cat-cow|chaturanga|savasana|sun salutation|half moon|crescent lunge|chair|eagle|boat/,
    category: "Mobility & Yoga",
    muscles: ["Mobility", "Balance", "Breathing control"],
    equipment: "Mat or clear floor",
    steps: [
      "Enter the position gradually while keeping a steady, comfortable breath.",
      "Use muscular control to support the pose instead of forcing extra range.",
      "Exit slowly if you feel pinching, numbness, dizziness, or sharp pain.",
    ],
    cues: ["Breathe steadily", "Create length", "Use a pain-free range"],
    mistakes: ["Forcing flexibility", "Holding the breath", "Ignoring joint pain or numbness"],
  },
];

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function equipmentLabel(value, fallback) {
  const labels = {
    both: "Home or gym equipment",
    gym: "Gym equipment",
    home: "Home equipment",
  };
  return labels[value] || value || fallback;
}

export function normalizeExerciseName(value) {
  return String(value || "")
    .replace(/\s+[—–-]\s+\d+\s*min(?:ute)?s?.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function exerciseGuideFor(item) {
  const source = typeof item === "string" ? { name: item } : (item || {});
  const name = normalizeExerciseName(source.name || source.n || source.ex);
  const normalized = name.toLowerCase();
  const rule = GUIDE_RULES.find((candidate) => candidate.match.test(normalized)) || DEFAULT_GUIDE;
  const sourceCue = String(source.cue || "").trim();
  return {
    name: name || "Exercise",
    key: (name || "Exercise").toLowerCase(),
    category: source.category || rule.category,
    muscles: [...rule.muscles],
    equipment: equipmentLabel(source.equipment || source.eq, rule.equipment),
    steps: [...rule.steps],
    cues: uniqueStrings([sourceCue, ...rule.cues]),
    mistakes: [...rule.mistakes],
  };
}

export function createExerciseGuideCatalog(items) {
  const merged = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const source = typeof item === "string" ? { name: item } : (item || {});
    const name = normalizeExerciseName(source.name || source.n || source.ex);
    const key = name.toLowerCase();
    if (!key) return;
    const previous = merged.get(key) || {};
    merged.set(key, {
      ...source,
      name,
      category: previous.category || source.category,
      equipment: previous.equipment || previous.eq || source.equipment || source.eq,
      cue: previous.cue || source.cue,
    });
  });
  return [...merged.values()]
    .map(exerciseGuideFor)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function searchExerciseGuides(catalog, query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return Array.isArray(catalog) ? catalog : [];
  return (Array.isArray(catalog) ? catalog : []).filter((guide) => {
    const haystack = [
      guide.name,
      guide.category,
      guide.equipment,
      ...(guide.muscles || []),
      ...(guide.cues || []),
    ].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function buildExerciseChatPrompt(guide, question = "") {
  const safeGuide = guide || exerciseGuideFor("Exercise");
  const request = String(question || "").trim()
    || "Explain how to perform this exercise safely and effectively for a beginner.";
  return [
    "Act as a careful strength and conditioning coach.",
    `Exercise: ${safeGuide.name}`,
    `Category: ${safeGuide.category}`,
    `Primary areas: ${(safeGuide.muscles || []).join(", ")}`,
    `Equipment: ${safeGuide.equipment}`,
    `IronDesk cues: ${(safeGuide.cues || []).join("; ")}`,
    `My question: ${request}`,
    "Answer with: setup, step-by-step execution, three short cues, common mistakes, and one easier regression.",
    "Keep it educational. Do not diagnose injuries. Tell me to stop and seek qualified help for sharp pain, numbness, dizziness, or symptoms that feel unsafe.",
  ].join("\n");
}

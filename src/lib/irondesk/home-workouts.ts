export type HomeWorkoutCategory = "strength" | "power" | "speed" | "conditioning";

export type HomeWorkoutLevel = "starter" | "build";

export interface HomeWorkoutExercise {
  name: string;
  starter: string;
  build: string;
  cue: string;
}

export interface HomeWorkout {
  id: string;
  title: string;
  category: HomeWorkoutCategory;
  focus: string;
  durationMinutes: readonly [number, number];
  space: string;
  equipment: string;
  format: string;
  rest: string;
  exercises: readonly HomeWorkoutExercise[];
  finish: string;
}

export const HOME_WORKOUT_CATEGORY_LABELS: Record<HomeWorkoutCategory, string> = {
  strength: "Strength",
  power: "Plyometrics",
  speed: "Speed",
  conditioning: "Conditioning",
};

export const HOME_WORKOUT_WARM_UP = [
  {
    name: "Easy march or light jog",
    dose: "60 seconds",
    cue: "Stand tall and gradually raise your body temperature.",
  },
  {
    name: "Ankle rocks",
    dose: "6 each side",
    cue: "Keep the heel down and use a comfortable range.",
  },
  {
    name: "Squat to reach",
    dose: "6 reps",
    cue: "Keep the whole foot down and finish tall.",
  },
  {
    name: "Reverse lunge and reach",
    dose: "4 each side",
    cue: "Step back softly and return to a balanced stance.",
  },
  {
    name: "A-march",
    dose: "10 each side",
    cue: "Drive the knee up, keep the toe up, and finish each step balanced.",
  },
] as const;

export const HOME_WORKOUTS = [
  {
    id: "total-body-foundation",
    title: "Total-Body Foundation",
    category: "strength",
    focus: "General bodyweight strength from the legs and hips through the upper body and trunk.",
    durationMinutes: [20, 25],
    space: "Safe indoor area or flat outdoor area",
    equipment: "None",
    format: "Move through the list as a circuit.",
    rest: "Rest 30-45 seconds between movements and 60 seconds after each round.",
    exercises: [
      {
        name: "Bodyweight squat",
        starter: "2 x 10",
        build: "3 x 10",
        cue: "Whole foot down; knees track over feet; stand tall.",
      },
      {
        name: "Incline push-up",
        starter: "2 x 8",
        build: "3 x 8-12",
        cue: "Use a stable wall or counter and keep one straight body line.",
      },
      {
        name: "Reverse lunge",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Step back softly and push the floor away through the front foot.",
      },
      {
        name: "Glute bridge",
        starter: "2 x 12",
        build: "3 x 12",
        cue: "Press through both feet and finish with the hips without arching.",
      },
      {
        name: "Two-leg calf raise",
        starter: "2 x 12",
        build: "3 x 12",
        cue: "Rise and lower slowly; use light fingertip support if needed.",
      },
      {
        name: "Dead bug",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Keep the trunk still while the opposite arm and leg move.",
      },
    ],
    finish: "Walk for 60 seconds and take five slow breaths.",
  },
  {
    id: "single-leg-strength",
    title: "Single-Leg Strength",
    category: "strength",
    focus: "Leg strength, balance, and hip control for running, cutting, jumping, and landing.",
    durationMinutes: [20, 25],
    space: "Safe indoor area or flat outdoor area",
    equipment: "None",
    format: "Complete all sets of one movement before moving to the next.",
    rest: "Rest 30-60 seconds between sets.",
    exercises: [
      {
        name: "Supported split squat",
        starter: "2 x 6/side",
        build: "3 x 8/side",
        cue: "Use a wall for balance; lower straight down; front knee follows the toes.",
      },
      {
        name: "Lateral lunge",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Sit the hips back over the working leg and keep the other leg long.",
      },
      {
        name: "Single-leg hip-hinge reach",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Reach forward as the free leg reaches back; keep the hips level.",
      },
      {
        name: "Staggered glute bridge",
        starter: "2 x 8/side",
        build: "3 x 8/side",
        cue: "Place one foot slightly forward and drive through the closer heel.",
      },
      {
        name: "Supported single-leg calf raise",
        starter: "2 x 8/side",
        build: "3 x 10/side",
        cue: "Rise tall through the big toe and lower slowly.",
      },
      {
        name: "Side plank from knees",
        starter: "2 x 20 sec/side",
        build: "3 x 30 sec/side",
        cue: "Place the shoulder over the elbow and make a long line from knee to head.",
      },
    ],
    finish: "Stand on one leg for 20 seconds per side, then walk and relax.",
  },
  {
    id: "upper-body-core",
    title: "Upper Body and Core",
    category: "strength",
    focus: "Pushing strength, shoulder control, and a stable trunk without weights.",
    durationMinutes: [18, 22],
    space: "Safe indoor area or flat outdoor area",
    equipment: "Stable wall or counter",
    format: "Move through the list as a circuit.",
    rest: "Rest 30-45 seconds between movements and 60 seconds between rounds.",
    exercises: [
      {
        name: "Incline push-up",
        starter: "2 x 8",
        build: "3 x 8-12",
        cue: "Lower the chest as one unit and press the surface away.",
      },
      {
        name: "Bear-plank shoulder tap",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Hover the knees just off the floor and keep the hips quiet.",
      },
      {
        name: "Bird dog",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Reach long without twisting and pause for one second.",
      },
      {
        name: "Side plank",
        starter: "2 x 15 sec/side",
        build: "3 x 25 sec/side",
        cue: "Use knees or feet and keep the body long and steady.",
      },
      {
        name: "Dead bug",
        starter: "2 x 6/side",
        build: "3 x 8/side",
        cue: "Exhale as the arm and leg extend; use only a controlled range.",
      },
      {
        name: "Prone W raise",
        starter: "2 x 8",
        build: "3 x 10",
        cue: "Lie face down, lift hands and elbows slightly, and keep the neck relaxed.",
      },
    ],
    finish: "Lie on your back with your feet down and take five slow breaths.",
  },
  {
    id: "slow-tempo-strength",
    title: "Slow-Tempo Strength",
    category: "strength",
    focus: "Control, strong positions, and time under tension using only bodyweight.",
    durationMinutes: [20, 25],
    space: "Safe indoor area or flat outdoor area",
    equipment: "Stable wall or counter",
    format: "Complete all sets of one movement before moving to the next.",
    rest: "Rest 45-60 seconds between sets. The tempo matters more than extra reps.",
    exercises: [
      {
        name: "Three-second squat",
        starter: "2 x 8",
        build: "3 x 8",
        cue: "Lower for three counts, pause briefly, and stand normally.",
      },
      {
        name: "Split squat with pause",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Lower under control and pause for two counts near the bottom.",
      },
      {
        name: "Slow incline push-up",
        starter: "2 x 6",
        build: "3 x 6-10",
        cue: "Lower for two counts, keep the body straight, and press normally.",
      },
      {
        name: "Glute-bridge march",
        starter: "2 x 6/side",
        build: "3 x 8/side",
        cue: "Hold the hips level while one foot lifts a few inches.",
      },
      {
        name: "Calf raise with pause",
        starter: "2 x 12",
        build: "3 x 12",
        cue: "Pause for two counts at the top and lower fully.",
      },
      {
        name: "Front plank",
        starter: "2 x 20 sec",
        build: "3 x 30 sec",
        cue: "Squeeze the glutes, keep the ribs down, and breathe normally.",
      },
    ],
    finish: "Easy march for 60 seconds.",
  },
  {
    id: "landing-school",
    title: "Landing School",
    category: "power",
    focus: "Quiet, balanced landing mechanics before chasing higher or farther jumps.",
    durationMinutes: [15, 20],
    space: "Clear indoor area or flat outdoor area with a non-slip surface",
    equipment: "None",
    format: "Reset fully before every repetition and hold each landing for two seconds.",
    rest: "Rest 45-60 seconds between sets.",
    exercises: [
      {
        name: "Snap-down and stick",
        starter: "2 x 3",
        build: "2 x 4",
        cue: "Drop into an athletic stance, land quietly, and freeze for two seconds.",
      },
      {
        name: "Small forward hop and stick",
        starter: "2 x 3",
        build: "2 x 4",
        cue: "Use a short hop and land on the whole foot under control.",
      },
      {
        name: "Lateral hop and stick",
        starter: "2 x 3/side",
        build: "2 x 4/side",
        cue: "Hop only as far as you can control; keep the knee following the toes.",
      },
      {
        name: "Vertical jump and stick",
        starter: "2 x 3",
        build: "2 x 4",
        cue: "Jump straight up, land quietly, and reset before the next jump.",
      },
      {
        name: "Standing broad jump and stick",
        starter: "2 x 3",
        build: "3 x 3",
        cue: "Jump forward only as far as you can land balanced.",
      },
    ],
    finish: "Repeat your quietest landing drill for one final set of three.",
  },
  {
    id: "vertical-forward-power",
    title: "Vertical and Forward Power",
    category: "power",
    focus: "Jump height and forward projection while every effort stays crisp.",
    durationMinutes: [18, 22],
    space: "Flat outdoor area preferred",
    equipment: "None",
    format: "Complete one drill at a time and reset between every jump.",
    rest: "Rest 60-90 seconds between sets.",
    exercises: [
      {
        name: "Low pogo jumps",
        starter: "2 x 10 contacts",
        build: "3 x 10 contacts",
        cue: "Stay tall, use quick ankles, and keep contacts low and quiet.",
      },
      {
        name: "Countermovement jump",
        starter: "2 x 4",
        build: "3 x 4",
        cue: "Dip smoothly, jump tall, land, and reset.",
      },
      {
        name: "Broad jump and stick",
        starter: "2 x 3",
        build: "3 x 3",
        cue: "Swing the arms, project forward, and finish balanced.",
      },
      {
        name: "Two small bounds into stick",
        starter: "2 x 3",
        build: "3 x 3",
        cue: "Use two smooth forward bounds and freeze the second landing.",
      },
      {
        name: "Five-meter burst",
        starter: "4 reps",
        build: "6 reps",
        cue: "Accelerate through five meters, walk back, and recover.",
      },
    ],
    finish: "Walk easily for 90 seconds.",
  },
  {
    id: "lateral-power",
    title: "Lateral Power",
    category: "power",
    focus: "Side-to-side push-off power and single-leg landing control.",
    durationMinutes: [18, 22],
    space: "Flat indoor or outdoor area with room to move sideways",
    equipment: "None",
    format: "Complete one drill at a time with equal work in both directions.",
    rest: "Rest 60-90 seconds between sets.",
    exercises: [
      {
        name: "Lateral shuffle",
        starter: "2 x 5 m/way",
        build: "3 x 5 m/way",
        cue: "Stay low enough to move and do not cross the feet.",
      },
      {
        name: "Lateral bound and stick",
        starter: "2 x 3/side",
        build: "3 x 4/side",
        cue: "Push sideways, land on the opposite leg, and freeze for two seconds.",
      },
      {
        name: "Skater hop",
        starter: "2 x 4/side",
        build: "3 x 5/side",
        cue: "Cover a comfortable distance and keep the chest controlled.",
      },
      {
        name: "Side-to-side line hops",
        starter: "2 x 10 sec",
        build: "3 x 10 sec",
        cue: "Use an imaginary line and stay light and rhythmic.",
      },
      {
        name: "Lateral push to five-meter sprint",
        starter: "2 reps/direction",
        build: "3 reps/direction",
        cue: "Push away from the outside leg and accelerate straight ahead.",
      },
    ],
    finish: "Walk until your breathing returns to normal.",
  },
  {
    id: "first-step-acceleration",
    title: "First-Step Acceleration",
    category: "speed",
    focus: "A strong starting position and fast acceleration over 10-15 meters.",
    durationMinutes: [20, 25],
    space: "Clear, flat outdoor lane of at least 20 meters",
    equipment: "Two ground markers",
    format: "Add two progressive 10-meter run-throughs after the standard warm-up.",
    rest: "Walk back and rest 60-90 seconds, or longer to repeat the same speed quality.",
    exercises: [
      {
        name: "Wall acceleration march",
        starter: "2 x 5/side",
        build: "3 x 5/side",
        cue: "Make one straight body line, drive one knee up, and push through the ground.",
      },
      {
        name: "A-march",
        starter: "2 x 10 m",
        build: "3 x 10 m",
        cue: "Step down under the hips and stay tall and rhythmic.",
      },
      {
        name: "Falling start",
        starter: "4 x 10 m",
        build: "6 x 10 m",
        cue: "Lean as one unit, catch the fall, and push the ground back.",
      },
      {
        name: "Split-stance start",
        starter: "4 x 10 m",
        build: "6 x 10 m",
        cue: "Load the front leg, drive out low, and rise naturally.",
      },
      {
        name: "Free-choice start",
        starter: "2 x 15 m",
        build: "4 x 15 m",
        cue: "Use the start that felt best and accelerate through the finish mark.",
      },
    ],
    finish: "Walk for two minutes.",
  },
  {
    id: "change-of-direction",
    title: "Change of Direction",
    category: "speed",
    focus: "Braking, planting, and reacceleration in a new direction.",
    durationMinutes: [20, 25],
    space: "Flat outdoor area with at least 15 meters of clear space",
    equipment: "Ground lines, shoes, or small objects as markers",
    format: "Add two progressive 10-meter run-throughs after the standard warm-up.",
    rest: "Rest 60 seconds between drills and 90 seconds between rounds.",
    exercises: [
      {
        name: "Run and controlled stop",
        starter: "2 x 3 reps",
        build: "3 x 3 reps",
        cue: "Lower the hips gradually, use several short steps, and finish balanced.",
      },
      {
        name: "Five-meter out and back",
        starter: "2 reps/direction",
        build: "3 reps/direction",
        cue: "Approach under control, plant outside the body, and push back strongly.",
      },
      {
        name: "Shuffle 5 m, sprint 10 m",
        starter: "2 reps/direction",
        build: "3 reps/direction",
        cue: "Stay square during the shuffle, then turn and accelerate decisively.",
      },
      {
        name: "Lateral bound and stick",
        starter: "2 x 3/side",
        build: "3 x 3/side",
        cue: "Land quietly, hold for two seconds, and own the plant position.",
      },
    ],
    finish: "Walk easily for 90 seconds.",
  },
  {
    id: "jump-rope-engine",
    title: "Jump-Rope Engine",
    category: "conditioning",
    focus: "Foot rhythm and interval conditioning with short, repeatable bouts.",
    durationMinutes: [15, 20],
    space: "Clear indoor or outdoor area",
    equipment: "Jump rope optional; shadow rope works too",
    format: "Complete each rope pattern once to make a block.",
    rest: "Rest 20 seconds between intervals and 60 seconds between blocks.",
    exercises: [
      {
        name: "Two-foot bounce",
        starter: "2 x 20 sec",
        build: "3 x 20 sec",
        cue: "Keep the jumps low, turn from the wrists, and land quietly.",
      },
      {
        name: "Boxer step",
        starter: "2 x 20 sec",
        build: "3 x 20 sec",
        cue: "Shift weight smoothly from foot to foot.",
      },
      {
        name: "Forward-back rhythm",
        starter: "2 x 20 sec",
        build: "3 x 20 sec",
        cue: "Use very small movement and keep the upper body relaxed.",
      },
      {
        name: "Fast-feet rhythm",
        starter: "2 x 15 sec",
        build: "3 x 15 sec",
        cue: "Use quick contacts and stop the interval before rhythm breaks down.",
      },
      {
        name: "Dead bug",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Move slowly and keep the trunk steady.",
      },
      {
        name: "Front plank",
        starter: "2 x 20 sec",
        build: "3 x 30 sec",
        cue: "Make one straight line and breathe normally.",
      },
    ],
    finish: "Walk and breathe for 60-90 seconds.",
  },
  {
    id: "strength-rope-mix",
    title: "Strength and Rope Mix",
    category: "conditioning",
    focus: "Full-body strength mixed with short jump-rope rhythm bouts.",
    durationMinutes: [20, 25],
    space: "Clear indoor or outdoor area",
    equipment: "Jump rope optional; shadow rope works too",
    format: "Move through the list as a circuit.",
    rest: "Rest 20-30 seconds between movements and 60 seconds after each round.",
    exercises: [
      {
        name: "Bodyweight squat",
        starter: "2 x 10",
        build: "3 x 10",
        cue: "Keep the whole foot down and stand tall and balanced.",
      },
      {
        name: "Jump rope or shadow rope",
        starter: "2 x 20 sec",
        build: "3 x 20 sec",
        cue: "Use low, quiet contacts and a smooth rhythm.",
      },
      {
        name: "Incline push-up",
        starter: "2 x 8",
        build: "3 x 8-12",
        cue: "Use a stable surface and keep the body in one line.",
      },
      {
        name: "Reverse lunge",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Step back softly and push through the front foot.",
      },
      {
        name: "Glute bridge",
        starter: "2 x 12",
        build: "3 x 12",
        cue: "Press through both feet and finish with the hips.",
      },
      {
        name: "Dead bug",
        starter: "2 x 6/side",
        build: "3 x 6/side",
        cue: "Keep the trunk still while the limbs move.",
      },
    ],
    finish: "Walk easily for 60 seconds.",
  },
  {
    id: "power-sprint-mix",
    title: "Power and Sprint Mix",
    category: "conditioning",
    focus: "Jumps and acceleration with enough recovery to keep every effort sharp.",
    durationMinutes: [20, 25],
    space: "Clear, flat outdoor lane of at least 20 meters",
    equipment: "Two ground markers",
    format: "Add two progressive 10-meter run-throughs, then complete the list as a round.",
    rest: "Rest 20-30 seconds between jumps, 60-90 seconds between sprints, and two minutes between rounds.",
    exercises: [
      {
        name: "Snap-down and stick",
        starter: "2 x 3",
        build: "3 x 3",
        cue: "Land quietly in an athletic stance and freeze for two seconds.",
      },
      {
        name: "Vertical jump and stick",
        starter: "2 x 3",
        build: "3 x 3",
        cue: "Jump tall, land quietly, and reset completely.",
      },
      {
        name: "Broad jump and stick",
        starter: "2 x 2",
        build: "3 x 2",
        cue: "Jump only as far as you can control.",
      },
      {
        name: "Falling-start acceleration",
        starter: "4 x 10 m",
        build: "6 x 10 m",
        cue: "Push the ground back and accelerate through the mark.",
      },
      {
        name: "Split-stance acceleration",
        starter: "2 x 15 m",
        build: "3 x 15 m",
        cue: "Load the front leg, drive out, and stay relaxed.",
      },
    ],
    finish: "Walk for two minutes.",
  },
] as const satisfies readonly HomeWorkout[];

export function homeWorkoutById(id: string): HomeWorkout | undefined {
  return HOME_WORKOUTS.find((workout) => workout.id === id);
}

export function validateHomeWorkoutLibrary(
  workouts: readonly HomeWorkout[] = HOME_WORKOUTS,
): readonly string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const categories = new Set<HomeWorkoutCategory>();

  if (workouts.length !== 12)
    errors.push("The public home-workout library must contain 12 workouts.");

  for (const workout of workouts) {
    if (ids.has(workout.id)) errors.push(`Duplicate workout id: ${workout.id}`);
    ids.add(workout.id);
    categories.add(workout.category);
    if (!workout.title.trim() || !workout.focus.trim())
      errors.push(`${workout.id} needs a title and focus.`);
    if (workout.durationMinutes[0] < 10 || workout.durationMinutes[1] > 30) {
      errors.push(`${workout.id} must remain a 10-30 minute session.`);
    }
    if (workout.durationMinutes[0] > workout.durationMinutes[1]) {
      errors.push(`${workout.id} has an invalid duration range.`);
    }
    if (workout.exercises.length < 4 || workout.exercises.length > 8) {
      errors.push(`${workout.id} must contain 4-8 movements.`);
    }
    for (const exercise of workout.exercises) {
      if (
        ![exercise.name, exercise.starter, exercise.build, exercise.cue].every((value) =>
          value.trim(),
        )
      ) {
        errors.push(`${workout.id} has an incomplete exercise prescription.`);
      }
    }
  }

  for (const category of Object.keys(HOME_WORKOUT_CATEGORY_LABELS) as HomeWorkoutCategory[]) {
    if (!categories.has(category)) errors.push(`Missing workout category: ${category}`);
  }

  return errors;
}

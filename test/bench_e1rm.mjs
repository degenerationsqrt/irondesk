import { performance } from 'perf_hooks';

// Mock data
const epley = (w, r) => w * (1 + r / 30);
const sel = 'squat';
const liftName = 'Squat';
const sessions = [];
for (let i = 0; i < 50000; i++) {
  sessions.push({
    date: `2023-01-0${i % 9 + 1}`,
    entries: i % 2 === 0 ? [
      { lift: 'bench', sets: [{ w: 100, r: 5 }] },
      { lift: 'squat', ex: 'Squat', sets: [{ w: 150, r: 5 }, { w: 160, r: 3 }] }
    ] : [
      { lift: 'deadlift', sets: [{ w: 200, r: 5 }] }
    ]
  });
}

function original() {
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
}

function iterateBackwards() {
  const pts = [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    (Array.isArray(s?.entries) ? s.entries : []).forEach(en => {
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
    });
  }
  return pts;
}

function reverseResult() {
  const pts = [];
  sessions.forEach(s => (Array.isArray(s?.entries) ? s.entries : []).forEach(en => {
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
  return pts.reverse();
}

const n = 100; // Increased iterations

let start = performance.now();
for (let i = 0; i < n; i++) original();
let end = performance.now();
console.log(`Original: ${(end - start).toFixed(2)}ms`);

start = performance.now();
for (let i = 0; i < n; i++) iterateBackwards();
end = performance.now();
console.log(`Iterate Backwards: ${(end - start).toFixed(2)}ms`);

start = performance.now();
for (let i = 0; i < n; i++) reverseResult();
end = performance.now();
console.log(`Reverse Result: ${(end - start).toFixed(2)}ms`);

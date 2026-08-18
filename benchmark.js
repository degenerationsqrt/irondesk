import fs from 'fs';
import { performance } from 'perf_hooks';

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

const sel = "deadlift";

const start = performance.now();
let count = 0;
for (let i = 0; i < 10000000; i++) {
  const liftName = LIFTS.find(l => l.key === sel)?.name;
  if (liftName) count++;
}
const end = performance.now();
console.log(`Array find took ${end - start} ms, count: ${count}`);

const LIFTS_BY_KEY = LIFTS.reduce((acc, l) => {
  acc[l.key] = l.name;
  return acc;
}, {});

const start2 = performance.now();
let count2 = 0;
for (let i = 0; i < 10000000; i++) {
  const liftName = LIFTS_BY_KEY[sel];
  if (liftName) count2++;
}
const end2 = performance.now();
console.log(`Object lookup took ${end2 - start2} ms, count: ${count2}`);

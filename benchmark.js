import { mergeHealthBodyweight } from "./src/healthConnect.js";

const current = [];
for (let i = 0; i < 10000; i++) {
  current.push({
    id: `manual:${i}`,
    date: `2026-07-${String(i % 28 + 1).padStart(2, '0')}`,
    weight: 200 + i % 50,
  });
}

const healthDays = [];
for (let i = 0; i < 10000; i++) {
  healthDays.push({
    date: `2026-07-${String(i % 28 + 1).padStart(2, '0')}`,
    weightLb: 200 + i % 50,
    bodyFat: 15 + i % 5,
  });
}

const start = performance.now();
for (let i = 0; i < 100; i++) {
  mergeHealthBodyweight(current, healthDays);
}
const end = performance.now();
console.log(`Baseline: ${end - start} ms`);

import assert from "node:assert/strict";
import test from "node:test";
import { solveLoadout } from "../src/loadout.js";

function referenceSolveLoadout(targetTotal, bar, pairs) {
  const perSide = Math.max(0, (targetTotal - bar) / 2);
  const denoms = pairs
    .filter(pair => pair.weight > 0 && Math.floor(pair.count / 2) > 0)
    .map(pair => ({ w: pair.weight, n: Math.floor(pair.count / 2) }))
    .sort((left, right) => right.w - left.w);
  let best = { sum: 0, combo: [] };
  const maxDenomination = denoms.reduce((maximum, plate) => Math.max(maximum, plate.w), 0);
  const visit = (index, sum, combo) => {
    if (Math.abs(sum - perSide) < Math.abs(best.sum - perSide)) {
      best = { sum, combo: [...combo] };
    }
    if (index >= denoms.length || sum > perSide + maxDenomination) return;
    for (let used = denoms[index].n; used >= 0; used -= 1) {
      visit(
        index + 1,
        sum + used * denoms[index].w,
        [...combo, ...Array(used).fill(denoms[index].w)],
      );
    }
  };
  visit(0, 0, []);
  const counts = {};
  best.combo.forEach((weight) => {
    counts[weight] = (counts[weight] || 0) + 1;
  });
  return { total: bar + best.sum * 2, counts };
}

test("optimized loadout solver matches the allocation-safe reference", () => {
  let seed = 73;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const weights = [55, 45, 35, 25, 10, 5, 2.5, 1.25];
  for (let trial = 0; trial < 75; trial += 1) {
    const pairs = weights.map(weight => ({
      weight,
      count: 2 * Math.floor(random() * 5),
    }));
    const target = 20 + random() * 600;
    const bar = [15, 35, 45][Math.floor(random() * 3)];
    assert.deepEqual(
      solveLoadout(target, bar, pairs),
      referenceSolveLoadout(target, bar, pairs),
    );
  }
});

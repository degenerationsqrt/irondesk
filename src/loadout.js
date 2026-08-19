export function solveLoadout(targetTotal, bar, pairs) {
  const perSide = Math.max(0, (targetTotal - bar) / 2);
  const denoms = (Array.isArray(pairs) ? pairs : [])
    .filter((pair) => pair.weight > 0 && Math.floor(pair.count / 2) > 0)
    .map((pair) => ({
      w: pair.weight,
      n: Math.floor(pair.count / 2),
    }))
    .sort((left, right) => right.w - left.w);
  let best = { sum: 0, combo: [] };
  const maxDenomination = denoms.reduce((maximum, plate) => Math.max(maximum, plate.w), 0);

  const visit = (index, sum, combo) => {
    if (Math.abs(sum - perSide) < Math.abs(best.sum - perSide)) {
      best = { sum, combo: [...combo] };
    }
    if (index >= denoms.length || sum > perSide + maxDenomination) return;

    const { w: weight, n: count } = denoms[index];
    for (let plate = 0; plate < count; plate += 1) combo.push(weight);
    for (let used = count; used >= 0; used -= 1) {
      visit(index + 1, sum + used * weight, combo);
      if (used > 0) combo.pop();
    }
  };

  visit(0, 0, []);
  const counts = {};
  best.combo.forEach((weight) => {
    counts[weight] = (counts[weight] || 0) + 1;
  });
  return {
    total: bar + best.sum * 2,
    counts,
  };
}

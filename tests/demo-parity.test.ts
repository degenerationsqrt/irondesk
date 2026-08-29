import { describe, expect, it } from "vitest";

import { dashboardDay, exercises, progressData } from "@/lib/irondesk/data";

describe("demo parity data", () => {
  it("shows the builder a full exercise catalog instead of a ten-item sample", () => {
    expect(exercises.length).toBeGreaterThanOrEqual(48);
    expect(new Set(exercises.map((exercise) => exercise.name)).size).toBe(exercises.length);
  });

  it("keeps weekly volume in canonical kilograms rather than mislabeled tonnes", () => {
    expect(Math.min(...progressData.volume.map((point) => point.tonnage))).toBeGreaterThan(30_000);
    expect(dashboardDay.recentProgress.find((item) => item.label === "Weekly tonnage")?.value).toBe(
      "58,400 kg",
    );
  });
});

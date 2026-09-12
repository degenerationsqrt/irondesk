import { z } from "zod";

import { isIsoDayKey } from "../irondesk/imported-data-adapter";

const note = z.string().trim().max(500).optional().describe("Note, up to 500 characters.");

// Match the persisted measurement constraints. Reject invalid measurements
// instead of silently changing what the athlete asked us to record.
export const recoveryInput = z.object({
  day: z
    .string()
    .refine(isIsoDayKey, "Use a real date in YYYY-MM-DD format.")
    .optional()
    .describe("ISO date (YYYY-MM-DD). Defaults to today in your profile timezone."),
  sleep_hours: z.number().finite().min(0).max(24).optional().describe("Hours slept, 0-24."),
  resting_hr: z
    .number()
    .int()
    .min(25)
    .max(140)
    .optional()
    .describe("Resting heart rate, 25-140 bpm."),
  hrv_ms: z.number().int().min(5).max(300).optional().describe("HRV, 5-300 milliseconds."),
  readiness: z.number().int().min(0).max(100).optional().describe("Readiness score, 0-100."),
  fatigue: z.number().int().min(1).max(10).optional().describe("Fatigue rating, 1-10."),
  stress: z.number().int().min(1).max(10).optional().describe("Stress rating, 1-10."),
  note,
});

export const bodyMetricInput = z.object({
  weight_kg: z
    .number()
    .finite()
    .min(20)
    .max(400)
    .optional()
    .describe("Body weight, 20-400 kilograms."),
  body_fat_percent: z
    .number()
    .finite()
    .min(2)
    .max(70)
    .optional()
    .describe("Body fat, 2-70 percent."),
  waist_cm: z
    .number()
    .finite()
    .positive()
    .max(999.9)
    .optional()
    .describe("Waist measurement in centimeters."),
  recorded_at: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("ISO timestamp with a timezone (Z or an offset). Defaults to now."),
  note,
});

export function invalidInput(error: z.ZodError) {
  return {
    content: [
      {
        type: "text" as const,
        text: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
      },
    ],
    isError: true,
  };
}

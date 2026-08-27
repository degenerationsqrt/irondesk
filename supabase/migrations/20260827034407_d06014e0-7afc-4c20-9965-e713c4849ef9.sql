-- Open all release gates: no more acknowledgment blockers for trainees.
UPDATE public.programs
SET release_gate = 'public', warnings = '[]'::jsonb
WHERE release_gate <> 'public' OR warnings <> '[]'::jsonb;

UPDATE public.workout_templates
SET release_gate = 'public',
    requires_acknowledgment = false,
    library_startable = true,
    warnings = '[]'::jsonb
WHERE release_gate <> 'public'
   OR requires_acknowledgment
   OR NOT library_startable
   OR warnings <> '[]'::jsonb;
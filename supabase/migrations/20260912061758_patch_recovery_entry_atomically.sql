-- Partial recovery check-ins must preserve real measurements and must never
-- promote untouched demonstration measurements into the athlete's real history.
-- ON CONFLICT performs the merge while holding the row lock; no read/replace
-- window can discard another partial check-in.
CREATE OR REPLACE FUNCTION public.patch_recovery_entry(_day date, _patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _entry public.recovery_entries%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _day IS NULL OR _patch IS NULL OR jsonb_typeof(_patch) <> 'object' OR _patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'A day and at least one recovery field are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each(_patch) AS field(key, value)
    WHERE field.key NOT IN ('sleep_hours', 'resting_hr', 'hrv_ms', 'readiness', 'fatigue', 'stress', 'note')
      OR (field.key <> 'note' AND jsonb_typeof(field.value) NOT IN ('number', 'null'))
      OR (field.key = 'note' AND jsonb_typeof(field.value) NOT IN ('string', 'null'))
  ) THEN
    RAISE EXCEPTION 'Unsupported recovery field or value type' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(_patch ->> 'note')) > 500 THEN
    RAISE EXCEPTION 'Recovery note exceeds 500 characters' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.recovery_entries AS existing (
    user_id, day, sleep_hours, resting_hr, hrv_ms, readiness, fatigue, stress, note, source, is_sample
  ) VALUES (
    _uid, _day, (_patch ->> 'sleep_hours')::numeric, (_patch ->> 'resting_hr')::smallint,
    (_patch ->> 'hrv_ms')::smallint, (_patch ->> 'readiness')::smallint,
    (_patch ->> 'fatigue')::smallint, (_patch ->> 'stress')::smallint,
    nullif(btrim(_patch ->> 'note'), ''), 'manual', false
  )
  ON CONFLICT (user_id, day) DO UPDATE SET
    sleep_hours = CASE WHEN _patch ? 'sleep_hours' THEN EXCLUDED.sleep_hours WHEN existing.is_sample THEN NULL ELSE existing.sleep_hours END,
    resting_hr = CASE WHEN _patch ? 'resting_hr' THEN EXCLUDED.resting_hr WHEN existing.is_sample THEN NULL ELSE existing.resting_hr END,
    hrv_ms = CASE WHEN _patch ? 'hrv_ms' THEN EXCLUDED.hrv_ms WHEN existing.is_sample THEN NULL ELSE existing.hrv_ms END,
    readiness = CASE WHEN _patch ? 'readiness' THEN EXCLUDED.readiness WHEN existing.is_sample THEN NULL ELSE existing.readiness END,
    fatigue = CASE WHEN _patch ? 'fatigue' THEN EXCLUDED.fatigue WHEN existing.is_sample THEN NULL ELSE existing.fatigue END,
    stress = CASE WHEN _patch ? 'stress' THEN EXCLUDED.stress WHEN existing.is_sample THEN NULL ELSE existing.stress END,
    note = CASE WHEN _patch ? 'note' THEN EXCLUDED.note WHEN existing.is_sample THEN NULL ELSE existing.note END,
    sleep_efficiency_percent = CASE WHEN existing.is_sample THEN NULL ELSE existing.sleep_efficiency_percent END,
    soreness = CASE WHEN existing.is_sample THEN '[]'::jsonb ELSE existing.soreness END,
    source = 'manual',
    is_sample = false
  RETURNING * INTO _entry;

  RETURN jsonb_build_object(
    'id', _entry.id, 'day', _entry.day, 'sleep_hours', _entry.sleep_hours,
    'resting_hr', _entry.resting_hr, 'hrv_ms', _entry.hrv_ms, 'readiness', _entry.readiness,
    'fatigue', _entry.fatigue, 'stress', _entry.stress, 'note', _entry.note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.patch_recovery_entry(date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.patch_recovery_entry(date, jsonb) TO authenticated;

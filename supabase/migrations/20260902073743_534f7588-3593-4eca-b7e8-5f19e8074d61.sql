-- Terminal workout transitions and IronDesk Black application are retry-safe
-- database transactions. Both functions run as the authenticated caller so
-- the existing workout/session/set RLS policies remain authoritative.

CREATE OR REPLACE FUNCTION public.transition_workout_session_terminal(
  _session_id uuid,
  _terminal_status text,
  _completed_at timestamptz,
  _allow_cancelled_recovery boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _session public.workout_sessions%ROWTYPE;
  _recovered boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _session_id IS NULL OR _terminal_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid workout terminal request' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_allow_cancelled_recovery, false) AND _terminal_status <> 'completed' THEN
    RAISE EXCEPTION 'Cancelled recovery only supports completion'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.* INTO _session
  FROM public.workout_sessions AS s
  WHERE s.id = _session_id
    AND s.user_id = _uid
    AND NOT s.is_sample
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workout was not found' USING ERRCODE = 'P0002';
  END IF;
  -- Exact same-terminal retries are acknowledgements, not timestamp rewrites.
  IF _session.status = _terminal_status THEN
    RETURN jsonb_build_object(
      'session_id', _session.id,
      'status', _session.status,
      'completed_at', _session.completed_at,
      'applied', true,
      'replayed', true,
      'recovered', false,
      'requires_timestamp_repair', _session.completed_at IS NULL
    );
  END IF;

  IF _session.status = 'cancelled'
     AND _terminal_status = 'completed'
     AND coalesce(_allow_cancelled_recovery, false) THEN
    _recovered := true;
  ELSIF _session.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'workout_terminal_conflict'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'requested', _terminal_status,
              'actual', _session.status
            )::text;
  ELSIF _session.status NOT IN ('active', 'draft') THEN
    RAISE EXCEPTION 'workout_terminal_conflict'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'requested', _terminal_status,
              'actual', _session.status
            )::text;
  END IF;

  -- The supplied timestamp is ignored on an exact replay, but is mandatory
  -- and bounded for every real transition (including explicit recovery).
  IF _completed_at IS NULL OR _completed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Invalid workout completion time' USING ERRCODE = '22023';
  END IF;
  IF _completed_at < _session.started_at THEN
    RAISE EXCEPTION 'Workout completion cannot precede its start'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workout_sessions AS s
  SET status = _terminal_status,
      completed_at = _completed_at
  WHERE s.id = _session_id
    AND s.user_id = _uid
  RETURNING s.* INTO _session;

  RETURN jsonb_build_object(
    'session_id', _session.id,
    'status', _session.status,
    'completed_at', _session.completed_at,
    'applied', true,
    'replayed', false,
    'recovered', _recovered,
    'requires_timestamp_repair', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_workout_session_terminal(
  uuid, text, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_workout_session_terminal(
  uuid, text, timestamptz, boolean
) TO authenticated;


-- Applies the complete client-composed Black plan and records its weekly
-- exposure in one transaction. Stable application/set UUIDs make an exact
-- response-lost retry provable without duplicating rows or exposure.
CREATE OR REPLACE FUNCTION public.apply_irondesk_black_plan(
  _application_id uuid,
  _session_id uuid,
  _window_id uuid,
  _target_region text,
  _week_start date,
  _prescriptions jsonb,
  _targets jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _session public.workout_sessions%ROWTYPE;
  _window public.training_specialization_windows%ROWTYPE;
  _existing_application public.black_exposures%ROWTYPE;
  _session_exercise public.session_exercises%ROWTYPE;
  _existing_set public.workout_sets%ROWTYPE;
  _request jsonb;
  _target jsonb;
  _set jsonb;
  _target_ordinal bigint;
  _set_ordinal bigint;
  _prescription_ordinal bigint;
  _target_count integer;
  _set_count integer := 0;
  _set_id uuid;
  _set_number integer;
  _set_number_value numeric;
  _weight_kg numeric;
  _reps numeric;
  _rpe numeric;
  _rest_seconds numeric;
  _method_segment text;
  _method_config jsonb;
  _segment_config jsonb;
  _is_warmup boolean;
  _canonical_region text;
  _matched_prescriptions bigint[] := ARRAY[]::bigint[];
  _seen_set_ids uuid[] := ARRAY[]::uuid[];
  _seen_set_numbers integer[];
  _uuid_pattern constant text :=
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF _application_id IS NULL OR _session_id IS NULL OR _window_id IS NULL THEN
    RAISE EXCEPTION 'Black application identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  _canonical_region := lower(regexp_replace(trim(coalesce(_target_region, '')), '[[:space:]]+', ' ', 'g'));
  IF _canonical_region = '' OR char_length(_canonical_region) > 120 THEN
    RAISE EXCEPTION 'Invalid Black target region' USING ERRCODE = '22023';
  END IF;
  IF _week_start IS NULL OR extract(isodow FROM _week_start) <> 1 THEN
    RAISE EXCEPTION 'Black week_start must be an ISO Monday'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_prescriptions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_prescriptions) < 1
     OR jsonb_array_length(_prescriptions) > 5 THEN
    RAISE EXCEPTION 'Black prescriptions must contain one to five items'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_targets) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_targets) < 1
     OR jsonb_array_length(_targets) > 5 THEN
    RAISE EXCEPTION 'Black targets must contain one to five items'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(_targets) <> jsonb_array_length(_prescriptions) THEN
    RAISE EXCEPTION 'Every Black prescription requires one workout target'
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(_prescriptions::text) + octet_length(_targets::text) > 250000 THEN
    RAISE EXCEPTION 'Black application payload is too large'
      USING ERRCODE = '22023';
  END IF;

  _request := jsonb_build_object(
    'version', 1,
    'applicationId', _application_id,
    'sessionId', _session_id,
    'windowId', _window_id,
    'targetRegion', _canonical_region,
    'weekStart', _week_start,
    'prescriptions', _prescriptions,
    'targets', _targets
  );

  -- Serialise exact replays of one application id before examining mutable
  -- session/window state. A committed application remains replayable after the
  -- workout or specialization window later closes.
  PERFORM pg_advisory_xact_lock(hashtextextended(_application_id::text, 73191));

  SELECT e.* INTO _existing_application
  FROM public.black_exposures AS e
  WHERE e.id = _application_id
    AND e.user_id = _uid;

  IF FOUND THEN
    IF _existing_application.session_id = _session_id
       AND _existing_application.window_id = _window_id
       AND lower(regexp_replace(trim(_existing_application.target_region), '[[:space:]]+', ' ', 'g')) = _canonical_region
       AND _existing_application.week_start = _week_start
       AND _existing_application.prescription -> 'application' = _request THEN
      SELECT coalesce(sum(jsonb_array_length(t.value -> 'sets')), 0)::integer
      INTO _set_count
      FROM jsonb_array_elements(_targets) AS t(value);

      RETURN jsonb_build_object(
        'application_id', _application_id,
        'exposure_id', _existing_application.id,
        'session_id', _session_id,
        'window_id', _window_id,
        'applied', true,
        'replayed', true,
        'exercise_count', jsonb_array_length(_targets),
        'set_count', _set_count
      );
    END IF;
    RAISE EXCEPTION 'black_application_id_conflict'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.* INTO _session
  FROM public.workout_sessions AS s
  WHERE s.id = _session_id
    AND s.user_id = _uid
    AND NOT s.is_sample
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workout was not found for this Black application'
      USING ERRCODE = 'P0002';
  END IF;
  IF _session.status <> 'active' THEN
    RAISE EXCEPTION 'Workout is not active' USING ERRCODE = '23514';
  END IF;
  IF _week_start <> date_trunc('week', timezone('UTC', _session.started_at))::date THEN
    RAISE EXCEPTION 'Black week_start does not match the workout week'
      USING ERRCODE = '22023';
  END IF;

  SELECT w.* INTO _window
  FROM public.training_specialization_windows AS w
  WHERE w.id = _window_id
    AND w.user_id = _uid
    AND w.method_id = 'irondesk-black'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IronDesk Black window was not found'
      USING ERRCODE = 'P0002';
  END IF;
  IF _window.status <> 'active' THEN
    RAISE EXCEPTION 'IronDesk Black window is not active'
      USING ERRCODE = '23514';
  END IF;
  IF timezone('UTC', _session.started_at)::date NOT BETWEEN _window.started_on AND _window.ends_on THEN
    RAISE EXCEPTION 'Workout is outside the IronDesk Black window'
      USING ERRCODE = '23514';
  END IF;
  IF lower(regexp_replace(trim(_window.target_region), '[[:space:]]+', ' ', 'g')) <> _canonical_region THEN
    RAISE EXCEPTION 'Black target region does not match its window'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(_window.config -> 'prescriptions', '[]'::jsonb) <> _prescriptions THEN
    RAISE EXCEPTION 'Black prescriptions do not match the saved window'
      USING ERRCODE = '22023';
  END IF;

  -- Different application ids for the same athlete/region/week are mutually
  -- exclusive even when the original table contains differently-cased text.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(_uid::text || ':' || _canonical_region || ':' || _week_start::text, 73192)
  );
  PERFORM 1
  FROM public.black_exposures AS e
  WHERE e.user_id = _uid
    AND lower(regexp_replace(trim(e.target_region), '[[:space:]]+', ' ', 'g')) = _canonical_region
    AND e.week_start = _week_start;
  IF FOUND THEN
    RAISE EXCEPTION 'That region already has a Black exposure for this week'
      USING ERRCODE = '23505';
  END IF;

  _target_count := jsonb_array_length(_targets);
  FOR _target, _target_ordinal IN
    SELECT item.value, item.ordinality
    FROM jsonb_array_elements(_targets) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    IF jsonb_typeof(_target) IS DISTINCT FROM 'object'
       OR jsonb_typeof(_target -> 'sessionExerciseId') IS DISTINCT FROM 'string'
       OR (_target ->> 'sessionExerciseId') !~ _uuid_pattern THEN
      RAISE EXCEPTION 'Invalid Black session exercise id at target %', _target_ordinal
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_target -> 'methodConfig') IS DISTINCT FROM 'object'
       OR octet_length((_target -> 'methodConfig')::text) > 10000 THEN
      RAISE EXCEPTION 'Invalid Black method config at target %', _target_ordinal
        USING ERRCODE = '22023';
    END IF;
    _method_config := _target -> 'methodConfig';
    IF _method_config ->> 'blackWindowId' <> _window_id::text THEN
      RAISE EXCEPTION 'Black method config has the wrong window at target %', _target_ordinal
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_target -> 'sets') IS DISTINCT FROM 'array'
       OR jsonb_array_length(_target -> 'sets') < 1
       OR jsonb_array_length(_target -> 'sets') > 20 THEN
      RAISE EXCEPTION 'Black target % must contain one to twenty sets', _target_ordinal
        USING ERRCODE = '22023';
    END IF;

    SELECT se.* INTO _session_exercise
    FROM public.session_exercises AS se
    WHERE se.id = (_target ->> 'sessionExerciseId')::uuid
      AND se.session_id = _session_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Black target exercise was not found in this workout'
        USING ERRCODE = 'P0002';
    END IF;

    _prescription_ordinal := NULL;
    SELECT p.ordinality INTO _prescription_ordinal
    FROM jsonb_array_elements(_prescriptions) WITH ORDINALITY AS p(value, ordinality)
    WHERE p.value ->> 'exerciseId' = _session_exercise.id::text
       OR (
         _session_exercise.exercise_id IS NOT NULL
         AND p.value ->> 'exerciseId' = _session_exercise.exercise_id::text
       )
       OR lower(trim(coalesce(p.value ->> 'exerciseName', ''))) = lower(trim(_session_exercise.exercise_name))
    ORDER BY CASE
      WHEN p.value ->> 'exerciseId' = _session_exercise.id::text THEN 0
      WHEN _session_exercise.exercise_id IS NOT NULL
           AND p.value ->> 'exerciseId' = _session_exercise.exercise_id::text THEN 1
      ELSE 2
    END, p.ordinality
    LIMIT 1;
    IF _prescription_ordinal IS NULL
       OR _prescription_ordinal = ANY(_matched_prescriptions) THEN
      RAISE EXCEPTION 'Black target does not uniquely match a saved prescription'
        USING ERRCODE = '22023';
    END IF;
    _matched_prescriptions := array_append(_matched_prescriptions, _prescription_ordinal);

    _seen_set_numbers := ARRAY[]::integer[];
    FOR _set, _set_ordinal IN
      SELECT item.value, item.ordinality
      FROM jsonb_array_elements(_target -> 'sets') WITH ORDINALITY AS item(value, ordinality)
    LOOP
      IF jsonb_typeof(_set) IS DISTINCT FROM 'object'
         OR jsonb_typeof(_set -> 'id') IS DISTINCT FROM 'string'
         OR (_set ->> 'id') !~ _uuid_pattern THEN
        RAISE EXCEPTION 'Invalid Black set id at target %, set %', _target_ordinal, _set_ordinal
          USING ERRCODE = '22023';
      END IF;
      _set_id := (_set ->> 'id')::uuid;
      IF _set_id = ANY(_seen_set_ids) THEN
        RAISE EXCEPTION 'A Black set id was repeated' USING ERRCODE = '22023';
      END IF;
      _seen_set_ids := array_append(_seen_set_ids, _set_id);

      IF jsonb_typeof(_set -> 'setNumber') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Invalid Black set number at target %, set %', _target_ordinal, _set_ordinal
          USING ERRCODE = '22023';
      END IF;
      _set_number_value := (_set ->> 'setNumber')::numeric;
      IF trunc(_set_number_value) <> _set_number_value
         OR _set_number_value < 1 OR _set_number_value > 100 THEN
        RAISE EXCEPTION 'Black set number is out of range'
          USING ERRCODE = '22023';
      END IF;
      _set_number := _set_number_value::integer;
      IF _set_number = ANY(_seen_set_numbers) THEN
        RAISE EXCEPTION 'A Black set number was repeated for one exercise'
          USING ERRCODE = '22023';
      END IF;
      _seen_set_numbers := array_append(_seen_set_numbers, _set_number);

      IF NOT (_set ? 'weightKg') OR jsonb_typeof(_set -> 'weightKg') = 'null' THEN
        _weight_kg := NULL;
      ELSIF jsonb_typeof(_set -> 'weightKg') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Black set weight must be numeric or null'
          USING ERRCODE = '22023';
      ELSE
        _weight_kg := (_set ->> 'weightKg')::numeric;
      END IF;
      IF _weight_kg IS NOT NULL AND (_weight_kg < 0 OR _weight_kg > 1000) THEN
        RAISE EXCEPTION 'Black set weight is out of range'
          USING ERRCODE = '22023';
      END IF;

      IF NOT (_set ? 'reps') OR jsonb_typeof(_set -> 'reps') = 'null' THEN
        _reps := NULL;
      ELSIF jsonb_typeof(_set -> 'reps') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Black set reps must be numeric or null'
          USING ERRCODE = '22023';
      ELSE
        _reps := (_set ->> 'reps')::numeric;
      END IF;
      IF _reps IS NOT NULL
         AND (trunc(_reps) <> _reps OR _reps < 0 OR _reps > 500) THEN
        RAISE EXCEPTION 'Black set reps are out of range'
          USING ERRCODE = '22023';
      END IF;

      IF NOT (_set ? 'rpe') OR jsonb_typeof(_set -> 'rpe') = 'null' THEN
        _rpe := NULL;
      ELSIF jsonb_typeof(_set -> 'rpe') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Black set RPE must be numeric or null'
          USING ERRCODE = '22023';
      ELSE
        _rpe := (_set ->> 'rpe')::numeric;
      END IF;
      IF _rpe IS NOT NULL
         AND (_rpe < 1 OR _rpe > 10 OR mod(_rpe * 2, 1) <> 0) THEN
        RAISE EXCEPTION 'Black set RPE must be 1 to 10 in 0.5 increments'
          USING ERRCODE = '22023';
      END IF;

      IF NOT (_set ? 'restSeconds') OR jsonb_typeof(_set -> 'restSeconds') = 'null' THEN
        _rest_seconds := NULL;
      ELSIF jsonb_typeof(_set -> 'restSeconds') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Black set rest must be numeric or null'
          USING ERRCODE = '22023';
      ELSE
        _rest_seconds := (_set ->> 'restSeconds')::numeric;
      END IF;
      IF _rest_seconds IS NOT NULL
         AND (trunc(_rest_seconds) <> _rest_seconds OR _rest_seconds < 0 OR _rest_seconds > 3600) THEN
        RAISE EXCEPTION 'Black set rest is out of range'
          USING ERRCODE = '22023';
      END IF;

      IF NOT (_set ? 'methodSegment') OR jsonb_typeof(_set -> 'methodSegment') = 'null' THEN
        _method_segment := NULL;
      ELSIF jsonb_typeof(_set -> 'methodSegment') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'Black method segment must be text or null'
          USING ERRCODE = '22023';
      ELSE
        _method_segment := nullif(trim(_set ->> 'methodSegment'), '');
      END IF;
      IF _method_segment IS NOT NULL AND char_length(_method_segment) > 80 THEN
        RAISE EXCEPTION 'Black method segment is too long'
          USING ERRCODE = '22023';
      END IF;

      IF jsonb_typeof(_set -> 'methodSegmentConfig') IS DISTINCT FROM 'object'
         OR octet_length((_set -> 'methodSegmentConfig')::text) > 10000 THEN
        RAISE EXCEPTION 'Invalid Black segment config'
          USING ERRCODE = '22023';
      END IF;
      _segment_config := _set -> 'methodSegmentConfig';
      IF _segment_config ->> 'methodId' <> 'irondesk-black'
         OR _segment_config ->> 'blackWindowId' <> _window_id::text THEN
        RAISE EXCEPTION 'Black segment config has the wrong method or window'
          USING ERRCODE = '22023';
      END IF;

      IF NOT (_set ? 'isWarmup') THEN
        _is_warmup := false;
      ELSIF jsonb_typeof(_set -> 'isWarmup') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Black isWarmup must be boolean'
          USING ERRCODE = '22023';
      ELSE
        _is_warmup := (_set ->> 'isWarmup')::boolean;
      END IF;

      SELECT ws.* INTO _existing_set
      FROM public.workout_sets AS ws
      WHERE ws.id = _set_id
      FOR UPDATE;

      IF FOUND THEN
        IF _existing_set.session_exercise_id <> _session_exercise.id THEN
          RAISE EXCEPTION 'Black set id belongs to another exercise'
            USING ERRCODE = '23505';
        END IF;
        IF _existing_set.completed THEN
          RAISE EXCEPTION 'Completed sets cannot be rewritten by a Black plan'
            USING ERRCODE = '23514';
        END IF;
        IF _existing_set.set_number <> _set_number THEN
          RAISE EXCEPTION 'Existing Black set number cannot be changed'
            USING ERRCODE = '23514';
        END IF;

        UPDATE public.workout_sets AS ws
        SET weight_kg = _weight_kg,
            reps = _reps::smallint,
            rpe = _rpe,
            completed_at = NULL,
            is_warmup = _is_warmup,
            rest_seconds = _rest_seconds::integer,
            method_segment = _method_segment,
            method_segment_config = _segment_config
        WHERE ws.id = _set_id;
      ELSE
        INSERT INTO public.workout_sets (
          id, session_exercise_id, set_number, weight_kg, reps, rpe,
          completed, is_warmup, rest_seconds, method_segment, method_segment_config
        ) VALUES (
          _set_id, _session_exercise.id, _set_number, _weight_kg, _reps::smallint, _rpe,
          false, _is_warmup, _rest_seconds::integer, _method_segment, _segment_config
        );
      END IF;
      _set_count := _set_count + 1;
    END LOOP;

    UPDATE public.session_exercises AS se
    SET training_method_id = 'irondesk-black',
        training_method_config = _method_config
    WHERE se.id = _session_exercise.id;
  END LOOP;

  IF cardinality(_matched_prescriptions) <> jsonb_array_length(_prescriptions) THEN
    RAISE EXCEPTION 'Every Black prescription must match exactly one target'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.black_exposures (
    id, user_id, window_id, session_id, target_region,
    week_start, prescription
  ) VALUES (
    _application_id, _uid, _window_id, _session_id, _window.target_region,
    _week_start, jsonb_build_object('application', _request)
  );

  RETURN jsonb_build_object(
    'application_id', _application_id,
    'exposure_id', _application_id,
    'session_id', _session_id,
    'window_id', _window_id,
    'applied', true,
    'replayed', false,
    'exercise_count', _target_count,
    'set_count', _set_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_irondesk_black_plan(
  uuid, uuid, uuid, text, date, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_irondesk_black_plan(
  uuid, uuid, uuid, text, date, jsonb, jsonb
) TO authenticated;

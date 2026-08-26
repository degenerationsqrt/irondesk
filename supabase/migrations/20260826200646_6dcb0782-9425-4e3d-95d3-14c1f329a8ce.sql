-- ============================================================================
-- IronDesk — assigned program delivery (additive, idempotent)
-- ============================================================================

-- 1. Template gating / provenance -------------------------------------------
ALTER TABLE public.workout_templates
  ADD COLUMN IF NOT EXISTS release_gate text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS requires_acknowledgment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS library_startable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_notes jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workout_templates_release_gate_check') THEN
    ALTER TABLE public.workout_templates
      ADD CONSTRAINT workout_templates_release_gate_check CHECK (release_gate IN (
        'public',
        'coach_review',
        'blocked_pending_source_review',
        'blocked_by_pyramid_engine_and_source_review'
      ));
  END IF;
END $$;

-- Legacy Beta templates inherit their program's gate + slot-scoped warnings.
UPDATE public.workout_templates t
SET release_gate = p.release_gate,
    requires_acknowledgment = true,
    library_startable = false,
    warnings = COALESCE((
      SELECT jsonb_agg(w)
      FROM jsonb_array_elements(COALESCE(p.warnings, '[]'::jsonb)) w
      WHERE COALESCE(w->>'workoutId', '') = COALESCE(pw.source_slot_key, '~none~')
    ), '[]'::jsonb),
    source_notes = jsonb_build_object(
      'program', p.name,
      'programSourceKey', p.source_key,
      'releaseGate', p.release_gate,
      'provenance', COALESCE(p.source_notes->'provenance', '{}'::jsonb),
      'riskFlags', COALESCE(p.source_notes->'riskFlags', '[]'::jsonb)
    )
FROM public.program_workouts pw
JOIN public.programs p ON p.id = pw.program_id
WHERE pw.template_id = t.id
  AND t.is_system
  AND 'legacy-beta' = ANY (t.tags);

-- 2. Enrollment acknowledgment + single current enrollment -------------------
ALTER TABLE public.program_enrollments
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_gate text;

CREATE UNIQUE INDEX IF NOT EXISTS program_enrollments_one_current_idx
  ON public.program_enrollments (user_id)
  WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS scheduled_workouts_user_status_idx
  ON public.scheduled_workouts (user_id, status, sequence_index);

-- 3. IronDesk Original rotations ---------------------------------------------
INSERT INTO public.programs (
  source_key, source_version, is_system, name, description, environment, level,
  days_per_week, cycle_length_weeks, schedule_mode, release_gate, warnings,
  source_notes, tags, sort_order, is_active
)
SELECT 'irondesk-original-home', 1, true, 'IronDesk Original · Home',
       'Six-day heavy/pump home rotation assembled from the original IronDesk day list.',
       'home', 'all', 6, 1, 'ordered_rotation', 'public', '[]'::jsonb,
       jsonb_build_object(
         'provenance', jsonb_build_object('type', 'irondesk_original', 'sourceTemplates', 'legacy-home-*'),
         'progression', jsonb_build_object('mode', 'repeat_cycle_until_changed', 'sourceSpecified', false)
       ),
       ARRAY['irondesk-original', 'home'], 1000, true
WHERE NOT EXISTS (SELECT 1 FROM public.programs WHERE source_key = 'irondesk-original-home');

INSERT INTO public.programs (
  source_key, source_version, is_system, name, description, environment, level,
  days_per_week, cycle_length_weeks, schedule_mode, release_gate, warnings,
  source_notes, tags, sort_order, is_active
)
SELECT 'irondesk-original-gym', 1, true, 'IronDesk Original · Gym',
       'Six-day heavy/pump gym rotation assembled from the original IronDesk day list.',
       'gym', 'all', 6, 1, 'ordered_rotation', 'public', '[]'::jsonb,
       jsonb_build_object(
         'provenance', jsonb_build_object('type', 'irondesk_original', 'sourceTemplates', 'legacy-gym-*'),
         'progression', jsonb_build_object('mode', 'repeat_cycle_until_changed', 'sourceSpecified', false)
       ),
       ARRAY['irondesk-original', 'gym'], 1001, true
WHERE NOT EXISTS (SELECT 1 FROM public.programs WHERE source_key = 'irondesk-original-gym');

INSERT INTO public.program_workouts (
  program_id, source_slot_key, position, template_id, template_version, label, metadata
)
SELECT s.program_id, s.source_key, s.position, s.template_id, s.source_version, s.name, '{}'::jsonb
FROM (
  SELECT p.id AS program_id, t.source_key, t.id AS template_id, t.source_version, t.name,
         (ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY t.sort_order))::smallint AS position
  FROM public.programs p
  JOIN public.workout_templates t
    ON t.is_system
   AND t.source_key LIKE (CASE WHEN p.source_key = 'irondesk-original-home' THEN 'legacy-home-%' ELSE 'legacy-gym-%' END)
  WHERE p.source_key IN ('irondesk-original-home', 'irondesk-original-gym')
) s
WHERE NOT EXISTS (
  SELECT 1 FROM public.program_workouts w WHERE w.program_id = s.program_id
);

-- 4. Enrollment lifecycle ----------------------------------------------------
DROP FUNCTION IF EXISTS public.enroll_in_program(uuid, smallint[]);

CREATE OR REPLACE FUNCTION public.enroll_in_program(
  _program_id uuid,
  _training_days smallint[] DEFAULT '{}'::smallint[],
  _acknowledged boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _enrollment_id uuid;
  _started_on date := current_date;
  _effective_days smallint[];
  _program record;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if exists (select 1 from unnest(coalesce(_training_days,'{}')) d where d < 1 or d > 7) then
    raise exception 'Training days must use ISO weekday numbers 1 through 7';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_uid::text, 41801));

  if exists (
    select 1 from public.workout_sessions
    where user_id=_uid and status in ('active','draft')
  ) then
    raise exception 'Finish or cancel your active workout before changing programs' using errcode='23505';
  end if;

  select p.* into _program
  from public.programs p
  where p.id=_program_id and p.is_active and (p.is_system or p.owner_id=_uid);
  if not found then
    raise exception 'Program is not available' using errcode='P0002';
  end if;

  if _program.release_gate <> 'public' and not coalesce(_acknowledged, false) then
    raise exception 'This program requires explicit warning acknowledgment' using errcode='42501';
  end if;

  update public.program_enrollments
  set status='cancelled', paused_at=null
  where user_id=_uid and status in ('active','paused');

  insert into public.program_enrollments(
    user_id, program_id, assigned_by, status, started_on,
    current_position, current_week, current_cycle, training_days,
    acknowledged_at, acknowledged_gate
  ) values (
    _uid, _program_id, _uid, 'active', _started_on,
    1, 1, 1, coalesce(_training_days,'{}'),
    case when _program.release_gate = 'public' then null else now() end,
    case when _program.release_gate = 'public' then null else _program.release_gate end
  ) returning id into _enrollment_id;

  if cardinality(coalesce(_training_days,'{}')) > 0 then
    _effective_days := _training_days;
  else
    select coalesce(array_agg(distinct pw.day_of_week order by pw.day_of_week) filter (where pw.day_of_week is not null), '{}')
    into _effective_days
    from public.program_workouts pw
    where pw.program_id=_program_id;
  end if;

  with eligible_dates as (
    select d::date as scheduled_for,
           row_number() over(order by d)::integer as rn
    from generate_series(_started_on::timestamp, (_started_on + 119)::timestamp, interval '1 day') d
    where cardinality(_effective_days)=0
       or extract(isodow from d)::smallint = any(_effective_days)
  )
  insert into public.scheduled_workouts(
    enrollment_id, user_id, program_workout_id, template_id,
    sequence_index, scheduled_for, status
  )
  select
    _enrollment_id, _uid, pw.id, pw.template_id,
    pw.position, ed.scheduled_for, 'planned'
  from public.program_workouts pw
  left join eligible_dates ed on ed.rn=pw.position
  where pw.program_id=_program_id
  order by pw.position;

  return _enrollment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pause_program_enrollment(_enrollment_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  update public.program_enrollments
  set status='paused', paused_at=now()
  where user_id=_uid and status='active'
    and (_enrollment_id is null or id=_enrollment_id)
  returning id into _id;
  if _id is null then
    raise exception 'No active program enrollment found' using errcode='P0002';
  end if;
  return _id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resume_program_enrollment(_enrollment_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  update public.program_enrollments
  set status='active', paused_at=null
  where user_id=_uid and status='paused'
    and (_enrollment_id is null or id=_enrollment_id)
  returning id into _id;
  if _id is null then
    raise exception 'No paused program enrollment found' using errcode='P0002';
  end if;
  return _id;
end;
$function$;

-- 5. Assigned start: acknowledgment enforcement ------------------------------
CREATE OR REPLACE FUNCTION public.start_assigned_workout(_enrollment_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _enrollment record;
  _program record;
  _slot record;
  _slot_count integer;
  _sequence_index integer;
  _schedule record;
  _active_session uuid;
  _session_id uuid;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_uid::text, 41802));

  select e.* into _enrollment
  from public.program_enrollments e
  where e.user_id=_uid
    and e.status='active'
    and (_enrollment_id is null or e.id=_enrollment_id)
  order by e.created_at desc
  limit 1;
  if not found then
    raise exception 'No active program enrollment found' using errcode='P0002';
  end if;

  select p.* into _program from public.programs p where p.id=_enrollment.program_id;
  if _program.release_gate <> 'public' and _enrollment.acknowledged_at is null then
    raise exception 'This program requires explicit warning acknowledgment' using errcode='42501';
  end if;

  select count(*) into _slot_count
  from public.program_workouts
  where program_id=_enrollment.program_id;
  if _slot_count=0 then
    raise exception 'Program has no workouts';
  end if;

  select pw.*, wt.name as template_name, wt.focus as template_focus
  into _slot
  from public.program_workouts pw
  join public.workout_templates wt on wt.id=pw.template_id
  where pw.program_id=_enrollment.program_id
    and pw.position=_enrollment.current_position;
  if not found then
    raise exception 'Current program position is invalid';
  end if;

  _sequence_index := ((_enrollment.current_cycle-1) * _slot_count) + _enrollment.current_position;

  insert into public.scheduled_workouts(
    enrollment_id,user_id,program_workout_id,template_id,sequence_index,scheduled_for,status
  ) values (
    _enrollment.id,_uid,_slot.id,_slot.template_id,_sequence_index,current_date,'planned'
  ) on conflict (enrollment_id,sequence_index) do nothing;

  select * into _schedule
  from public.scheduled_workouts
  where enrollment_id=_enrollment.id and sequence_index=_sequence_index
  for update;

  if _schedule.status='in_progress' and _schedule.session_id is not null then
    select id into _active_session
    from public.workout_sessions
    where id=_schedule.session_id and user_id=_uid and status in ('active','draft');
    if _active_session is not null then
      return _active_session;
    end if;
  end if;
  if _schedule.status in ('completed','skipped') then
    raise exception 'The current scheduled workout is already %', _schedule.status;
  end if;

  select id into _active_session
  from public.workout_sessions
  where user_id=_uid and status in ('active','draft')
  order by started_at desc limit 1;
  if _active_session is not null then
    raise exception 'You already have a session in progress' using errcode='23505';
  end if;

  insert into public.workout_sessions(
    user_id,title,kind,focus,status,template_id,scheduled_workout_id
  ) values (
    _uid,_slot.template_name,'strength',_slot.template_focus,'active',_slot.template_id,_schedule.id
  ) returning id into _session_id;

  insert into public.session_exercises(
    session_id,exercise_id,original_exercise_id,exercise_name,primary_muscle,equipment,
    position,target_sets,target_reps,notes,load_guidance,source_load_unit,
    is_drop_set,is_heavy,target_rpe,rest_seconds
  )
  select
    _session_id,te.exercise_id,null,te.exercise_name,x.primary_muscle,x.equipment,
    te.position,te.target_sets,te.target_reps,te.notes,te.load_guidance,te.source_load_unit,
    te.is_drop_set,te.is_heavy,te.target_rpe,te.rest_seconds
  from public.template_exercises te
  left join public.exercises x on x.id=te.exercise_id
  where te.template_id=_slot.template_id
  order by te.position;

  insert into public.workout_sets(
    session_exercise_id,set_number,weight_kg,reps,rpe,completed,is_warmup,rest_seconds
  )
  select
    se.id,
    gs.n::smallint,
    null,
    case
      when lower(coalesce(se.target_reps,'')) like '%failure%'
        or lower(coalesce(se.target_reps,'')) like '%unspecified%'
        or lower(coalesce(se.target_reps,'')) like '% min%'
        then null
      when lower(coalesce(se.target_reps,'')) like '%21s%' then 21
      when position('/' in coalesce(se.target_reps,'')) > 0 then
        (select (m[1])::smallint
         from regexp_matches(se.target_reps,'([0-9]+)','g') with ordinality r(m,ord)
         where ord=least(gs.n, (select count(*) from regexp_matches(se.target_reps,'([0-9]+)','g')))
         limit 1)
      when coalesce(se.target_reps,'') ~ '[0-9]+[[:space:]]*[×x][[:space:]]*[0-9]+' then
        substring(se.target_reps from '[0-9]+[[:space:]]*[×x][[:space:]]*([0-9]+)')::smallint
      else nullif(substring(coalesce(se.target_reps,'') from '([0-9]+)'),'')::smallint
    end,
    se.target_rpe,
    false,
    false,
    se.rest_seconds
  from public.session_exercises se
  cross join lateral generate_series(1,greatest(1,coalesce(se.target_sets,1))) gs(n)
  where se.session_id=_session_id;

  update public.scheduled_workouts
  set status='in_progress', session_id=_session_id, completed_at=null, skipped_at=null
  where id=_schedule.id;

  return _session_id;
end;
$function$;

-- 6. Session <-> schedule integrity -----------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_session_start_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.scheduled_workout_id is null and new.template_id is not null then
    if exists (
      select 1 from public.workout_templates t
      where t.id=new.template_id and t.is_system and not t.library_startable
    ) then
      raise exception 'This template can only be started through an acknowledged program assignment'
        using errcode='42501';
    end if;
  end if;

  if new.scheduled_workout_id is not null then
    if not exists (
      select 1 from public.scheduled_workouts s
      where s.id=new.scheduled_workout_id and s.user_id=new.user_id
    ) then
      raise exception 'Scheduled workout does not belong to this athlete' using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS workout_sessions_start_policy ON public.workout_sessions;
CREATE TRIGGER workout_sessions_start_policy
BEFORE INSERT ON public.workout_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_session_start_policy();

CREATE OR REPLACE FUNCTION public.sync_assigned_session_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _sched record;
  _enr record;
  _slot_count integer;
  _pos smallint;
begin
  if new.scheduled_workout_id is null or new.status = old.status then
    return new;
  end if;

  select * into _sched from public.scheduled_workouts
  where id=new.scheduled_workout_id and user_id=new.user_id
  for update;
  if not found then
    return new;
  end if;

  if new.status='completed' then
    update public.scheduled_workouts
    set status='completed', completed_at=coalesce(new.completed_at, now()), skipped_at=null
    where id=_sched.id;

    select e.* into _enr from public.program_enrollments e
    where e.id=_sched.enrollment_id and e.user_id=new.user_id
    for update;
    if found and _enr.status='active' then
      select count(*) into _slot_count from public.program_workouts where program_id=_enr.program_id;
      select position into _pos from public.program_workouts where id=_sched.program_workout_id;
      if _pos = _enr.current_position then
        update public.program_enrollments
        set current_position = case when _enr.current_position < _slot_count then _enr.current_position + 1 else 1 end,
            current_cycle = case when _enr.current_position < _slot_count then _enr.current_cycle else _enr.current_cycle + 1 end,
            current_week = case when _enr.current_position < _slot_count then _enr.current_week else 1 end
        where id=_enr.id;
      end if;
    end if;
  elsif new.status='cancelled' then
    update public.scheduled_workouts
    set status='planned', session_id=null, completed_at=null, skipped_at=null
    where id=_sched.id;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS workout_sessions_sync_schedule ON public.workout_sessions;
CREATE TRIGGER workout_sessions_sync_schedule
AFTER UPDATE OF status ON public.workout_sessions
FOR EACH ROW EXECUTE FUNCTION public.sync_assigned_session_status();

-- 7. Execute grants ----------------------------------------------------------
REVOKE ALL ON FUNCTION public.enroll_in_program(uuid, smallint[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_program_enrollment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_program_enrollment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_assigned_workout(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.skip_current_program_workout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enroll_in_program(uuid, smallint[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_program_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_program_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_assigned_workout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_current_program_workout(uuid) TO authenticated;
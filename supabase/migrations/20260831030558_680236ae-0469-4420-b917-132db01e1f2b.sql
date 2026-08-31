-- 1. Method segment identity on individual sets (additive, non-destructive)
ALTER TABLE public.workout_sets
  ADD COLUMN IF NOT EXISTS method_segment text,
  ADD COLUMN IF NOT EXISTS method_segment_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_method_segment_check;
ALTER TABLE public.workout_sets
  ADD CONSTRAINT workout_sets_method_segment_check
  CHECK (method_segment IS NULL OR char_length(method_segment) <= 80);

-- 2. Specialization windows may expire
ALTER TABLE public.training_specialization_windows
  DROP CONSTRAINT IF EXISTS training_specialization_windows_status_check;
ALTER TABLE public.training_specialization_windows
  ADD CONSTRAINT training_specialization_windows_status_check
  CHECK (status = ANY (ARRAY['active','suspended','completed','cancelled','expired']));

-- 3. One IronDesk Black exposure per target region per week
CREATE TABLE IF NOT EXISTS public.black_exposures (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_id uuid REFERENCES public.training_specialization_windows(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.workout_sessions(id) ON DELETE SET NULL,
  target_region text NOT NULL,
  week_start date NOT NULL,
  prescription jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT black_exposures_region_week_unique UNIQUE (user_id, target_region, week_start)
);

GRANT SELECT, INSERT, DELETE ON public.black_exposures TO authenticated;
GRANT ALL ON public.black_exposures TO service_role;

ALTER TABLE public.black_exposures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "black_exposures_select_own" ON public.black_exposures;
CREATE POLICY "black_exposures_select_own" ON public.black_exposures
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "black_exposures_insert_own" ON public.black_exposures;
CREATE POLICY "black_exposures_insert_own" ON public.black_exposures
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "black_exposures_delete_own" ON public.black_exposures;
CREATE POLICY "black_exposures_delete_own" ON public.black_exposures
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- 4. Carry template training-method selections into started sessions
CREATE OR REPLACE FUNCTION public.start_library_workout(_template_id uuid, _acknowledged boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _uid uuid := auth.uid();
  _template record;
  _active_session uuid;
  _session_id uuid;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_uid::text, 41803));

  select * into _template
  from public.workout_templates t
  where t.id=_template_id
    and (t.is_system or t.user_id=_uid);
  if not found then
    raise exception 'Template not found' using errcode='P0002';
  end if;

  if (_template.is_system and not _template.library_startable)
     or _template.requires_acknowledgment
     or _template.release_gate <> 'public' then
    if not coalesce(_acknowledged, false) then
      raise exception 'This workout requires explicit warning acknowledgment before free training'
        using errcode='42501';
    end if;
  end if;

  select id into _active_session
  from public.workout_sessions
  where user_id=_uid and status in ('active','draft')
  order by started_at desc limit 1;
  if _active_session is not null then
    raise exception 'You already have a session in progress' using errcode='23505';
  end if;

  perform set_config('irondesk.acknowledged_template_id', _template_id::text, true);

  insert into public.workout_sessions(user_id,title,kind,focus,status,template_id)
  values (_uid,_template.name,'strength',_template.focus,'active',_template.id)
  returning id into _session_id;

  perform set_config('irondesk.acknowledged_template_id', '', true);

  insert into public.session_exercises(
    session_id,exercise_id,original_exercise_id,exercise_name,primary_muscle,equipment,
    position,target_sets,target_reps,notes,load_guidance,source_load_unit,
    is_drop_set,is_heavy,target_rpe,rest_seconds,
    training_method_id,training_method_config
  )
  select
    _session_id,te.exercise_id,null,te.exercise_name,x.primary_muscle,x.equipment,
    te.position,te.target_sets,te.target_reps,te.notes,te.load_guidance,te.source_load_unit,
    te.is_drop_set,te.is_heavy,te.target_rpe,te.rest_seconds,
    te.training_method_id,coalesce(te.training_method_config,'{}'::jsonb)
  from public.template_exercises te
  left join public.exercises x on x.id=te.exercise_id
  where te.template_id=_template.id
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

  return _session_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_assigned_workout(_enrollment_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  if _program.release_gate <> 'public'
     and (_enrollment.acknowledged_at is null
          or _enrollment.acknowledged_gate is distinct from _program.release_gate) then
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

  if _schedule.status='in_progress' then
    select id into _active_session
    from public.workout_sessions
    where id=_schedule.session_id and user_id=_uid and status in ('active','draft');
    if _active_session is not null then
      return _active_session;
    end if;
    update public.scheduled_workouts
    set status='planned', session_id=null, completed_at=null, skipped_at=null
    where id=_schedule.id
    returning * into _schedule;
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

  perform set_config('irondesk.assigned_schedule_id', _schedule.id::text, true);

  insert into public.workout_sessions(
    user_id,title,kind,focus,status,template_id,scheduled_workout_id
  ) values (
    _uid,_slot.template_name,'strength',_slot.template_focus,'active',_slot.template_id,_schedule.id
  ) returning id into _session_id;

  perform set_config('irondesk.assigned_schedule_id', '', true);

  insert into public.session_exercises(
    session_id,exercise_id,original_exercise_id,exercise_name,primary_muscle,equipment,
    position,target_sets,target_reps,notes,load_guidance,source_load_unit,
    is_drop_set,is_heavy,target_rpe,rest_seconds,
    training_method_id,training_method_config
  )
  select
    _session_id,te.exercise_id,null,te.exercise_name,x.primary_muscle,x.equipment,
    te.position,te.target_sets,te.target_reps,te.notes,te.load_guidance,te.source_load_unit,
    te.is_drop_set,te.is_heavy,te.target_rpe,te.rest_seconds,
    te.training_method_id,coalesce(te.training_method_config,'{}'::jsonb)
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

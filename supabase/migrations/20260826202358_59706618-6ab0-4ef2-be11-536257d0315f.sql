-- ============================================================================
-- Assigned-program security & lifecycle hardening (additive).
-- 1) enrollment/schedule tables become read-only to clients (RPC/trigger only)
-- 2) lifecycle RPCs become SECURITY DEFINER with a locked search_path
-- 3) skip reason is written server-side
-- 4) assigned session linkage is RPC-only and immutable
-- ============================================================================

-- ---------------------------------------------------------------------------
-- B. Client mutation surface removed. SELECT stays private to auth.uid().
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS program_enrollments_insert_own ON public.program_enrollments;
DROP POLICY IF EXISTS program_enrollments_update_own ON public.program_enrollments;
DROP POLICY IF EXISTS program_enrollments_delete_own ON public.program_enrollments;
DROP POLICY IF EXISTS scheduled_workouts_insert_own ON public.scheduled_workouts;
DROP POLICY IF EXISTS scheduled_workouts_update_own ON public.scheduled_workouts;
DROP POLICY IF EXISTS scheduled_workouts_delete_own ON public.scheduled_workouts;

REVOKE INSERT, UPDATE, DELETE ON public.program_enrollments FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.scheduled_workouts FROM authenticated, anon;
REVOKE ALL ON public.program_enrollments FROM anon;
REVOKE ALL ON public.scheduled_workouts FROM anon;
GRANT SELECT ON public.program_enrollments TO authenticated;
GRANT SELECT ON public.scheduled_workouts TO authenticated;
GRANT ALL ON public.program_enrollments TO service_role;
GRANT ALL ON public.scheduled_workouts TO service_role;

-- ---------------------------------------------------------------------------
-- Drop the duplicate completion handler (the guarded internal one is kept).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS workout_sessions_sync_schedule ON public.workout_sessions;
DROP FUNCTION IF EXISTS public.sync_assigned_session_status();

-- ---------------------------------------------------------------------------
-- A/E. enroll / pause / resume as SECURITY DEFINER with locked search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enroll_in_program(
  _program_id uuid,
  _training_days smallint[] DEFAULT '{}'::smallint[],
  _acknowledged boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
  if exists (select 1 from unnest(coalesce(_training_days,'{}'::smallint[])) d where d < 1 or d > 7) then
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
    1, 1, 1, coalesce(_training_days,'{}'::smallint[]),
    case when _program.release_gate = 'public' then null else now() end,
    case when _program.release_gate = 'public' then null else _program.release_gate end
  ) returning id into _enrollment_id;

  if cardinality(coalesce(_training_days,'{}'::smallint[])) > 0 then
    _effective_days := _training_days;
  else
    select coalesce(array_agg(distinct pw.day_of_week order by pw.day_of_week) filter (where pw.day_of_week is not null), '{}'::smallint[])
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

CREATE OR REPLACE FUNCTION public.pause_program_enrollment(_enrollment_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _uid uuid := auth.uid();
  _id uuid;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  -- E. A live session would complete against a paused cursor; refuse instead.
  if exists (
    select 1 from public.workout_sessions
    where user_id=_uid and status in ('active','draft')
  ) then
    raise exception 'Finish or cancel your active workout before pausing this program' using errcode='23505';
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

CREATE OR REPLACE FUNCTION public.resume_program_enrollment(_enrollment_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

-- ---------------------------------------------------------------------------
-- C. skip with a server-written reason. The 1-arg signature is retired.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.skip_current_program_workout(uuid);

CREATE OR REPLACE FUNCTION public.skip_current_program_workout(
  _enrollment_id uuid DEFAULT NULL::uuid,
  _reason text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _uid uuid := auth.uid();
  _enrollment record;
  _slot record;
  _slot_count integer;
  _sequence_index integer;
  _schedule_id uuid;
  _changed integer;
  _clean_reason text := nullif(left(btrim(coalesce(_reason,'')), 500), '');
  _adjustment jsonb;
begin
  if _uid is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_uid::text, 41803));

  select e.* into _enrollment
  from public.program_enrollments e
  where e.user_id=_uid and e.status='active'
    and (_enrollment_id is null or e.id=_enrollment_id)
  order by e.created_at desc limit 1
  for update;
  if not found then
    raise exception 'No active program enrollment found' using errcode='P0002';
  end if;

  select count(*) into _slot_count from public.program_workouts where program_id=_enrollment.program_id;
  select * into _slot from public.program_workouts
  where program_id=_enrollment.program_id and position=_enrollment.current_position;
  if not found then raise exception 'Current program position is invalid'; end if;

  _sequence_index := ((_enrollment.current_cycle-1) * _slot_count) + _enrollment.current_position;

  _adjustment := jsonb_strip_nulls(jsonb_build_object(
    'skippedBy', 'athlete',
    'skippedAt', to_jsonb(now()),
    'skipReason', _clean_reason
  ));

  insert into public.scheduled_workouts(
    enrollment_id,user_id,program_workout_id,template_id,sequence_index,scheduled_for,status
  ) values (
    _enrollment.id,_uid,_slot.id,_slot.template_id,_sequence_index,current_date,'planned'
  ) on conflict (enrollment_id,sequence_index) do nothing;

  update public.scheduled_workouts
  set status='skipped', skipped_at=now(), session_id=null,
      adjustment = coalesce(adjustment,'{}'::jsonb) || _adjustment
  where enrollment_id=_enrollment.id and sequence_index=_sequence_index
    and user_id=_uid
    and status='planned'
  returning id into _schedule_id;
  get diagnostics _changed = row_count;

  if _changed=0 then
    select id into _schedule_id from public.scheduled_workouts
    where enrollment_id=_enrollment.id and sequence_index=_sequence_index;
    if exists (select 1 from public.scheduled_workouts where id=_schedule_id and status='in_progress') then
      raise exception 'Cancel the in-progress session before skipping this workout';
    end if;
    return _schedule_id;
  end if;

  update public.program_enrollments
  set current_position=case when current_position < _slot_count then current_position+1 else 1 end,
      current_cycle=case when current_position < _slot_count then current_cycle else current_cycle+1 end,
      current_week=case when current_position < _slot_count then current_week else 1 end
  where id=_enrollment.id
    and user_id=_uid
    and current_position=_enrollment.current_position
    and current_cycle=_enrollment.current_cycle;

  return _schedule_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- D. start_assigned_workout announces the linkage through a txn-local GUC.
-- ---------------------------------------------------------------------------
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
    -- Stale in_progress row (session gone or already closed): recover it.
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

  -- Only this RPC may link a session to a schedule; the insert trigger checks it.
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

-- ---------------------------------------------------------------------------
-- D. Session start policy: assigned linkage is RPC-only and fully validated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_session_start_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _announced text := nullif(current_setting('irondesk.assigned_schedule_id', true), '');
  _schedule record;
  _enrollment record;
  _program record;
  _slot record;
  _slot_count integer;
begin
  if new.scheduled_workout_id is null then
    if new.template_id is not null and exists (
      select 1 from public.workout_templates t
      where t.id=new.template_id and t.is_system and not t.library_startable
    ) then
      raise exception 'This template can only be started through an acknowledged program assignment'
        using errcode='42501';
    end if;
    return new;
  end if;

  if _announced is null or _announced <> new.scheduled_workout_id::text then
    raise exception 'Assigned workouts can only be started through start_assigned_workout()'
      using errcode='42501';
  end if;

  select * into _schedule from public.scheduled_workouts where id=new.scheduled_workout_id;
  if not found or _schedule.user_id <> new.user_id then
    raise exception 'Scheduled workout does not belong to this athlete' using errcode='42501';
  end if;
  if _schedule.status <> 'planned' then
    raise exception 'Scheduled workout is not startable (status %)', _schedule.status using errcode='42501';
  end if;
  if new.template_id is null or _schedule.template_id <> new.template_id then
    raise exception 'Session template does not match the scheduled workout' using errcode='42501';
  end if;

  select * into _slot from public.program_workouts where id=_schedule.program_workout_id;
  if not found or _slot.template_id <> new.template_id then
    raise exception 'Program slot template does not match the scheduled workout' using errcode='42501';
  end if;

  select * into _enrollment from public.program_enrollments where id=_schedule.enrollment_id;
  if not found or _enrollment.user_id <> new.user_id or _enrollment.status <> 'active' then
    raise exception 'Program enrollment is not active for this athlete' using errcode='42501';
  end if;
  if _slot.program_id <> _enrollment.program_id then
    raise exception 'Program slot does not belong to the enrolled program' using errcode='42501';
  end if;

  select count(*) into _slot_count from public.program_workouts where program_id=_enrollment.program_id;
  if _slot.position <> _enrollment.current_position
     or _schedule.sequence_index <> ((_enrollment.current_cycle-1)*_slot_count + _enrollment.current_position) then
    raise exception 'Scheduled workout is not the current program position' using errcode='42501';
  end if;

  select * into _program from public.programs p where p.id=_enrollment.program_id;
  if _program.release_gate <> 'public'
     and (_enrollment.acknowledged_at is null
          or _enrollment.acknowledged_gate is distinct from _program.release_gate) then
    raise exception 'This program requires explicit warning acknowledgment' using errcode='42501';
  end if;

  return new;
end;
$function$;

-- Linkage, template and owner are immutable once a session exists.
CREATE OR REPLACE FUNCTION irondesk_internal.enforce_session_link_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Session ownership cannot be changed' using errcode='42501';
  end if;
  if new.template_id is distinct from old.template_id then
    raise exception 'Session template cannot be changed' using errcode='42501';
  end if;
  if new.scheduled_workout_id is distinct from old.scheduled_workout_id then
    -- The only allowed transition is the cancel-unlink performed by the
    -- completion handler; a free session can never be linked afterwards.
    if old.scheduled_workout_id is not null
       and new.scheduled_workout_id is null
       and new.status = 'cancelled' then
      return new;
    end if;
    raise exception 'Assigned workout linkage cannot be changed' using errcode='42501';
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS workout_sessions_link_immutable ON public.workout_sessions;
CREATE TRIGGER workout_sessions_link_immutable
BEFORE UPDATE OF scheduled_workout_id, template_id, user_id ON public.workout_sessions
FOR EACH ROW EXECUTE FUNCTION irondesk_internal.enforce_session_link_immutable();

-- ---------------------------------------------------------------------------
-- F. Execute privileges: authenticated only; trigger helpers stay internal.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enroll_in_program(uuid, smallint[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_program_enrollment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_program_enrollment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.skip_current_program_workout(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_assigned_workout(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.enroll_in_program(uuid, smallint[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_program_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_program_enrollment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_current_program_workout(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_assigned_workout(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_session_start_policy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION irondesk_internal.enforce_session_link_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION irondesk_internal.handle_assigned_session_status() FROM PUBLIC, anon, authenticated;

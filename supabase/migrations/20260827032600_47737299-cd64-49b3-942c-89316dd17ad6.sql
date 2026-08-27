-- Allow an explicit, acknowledged free start of assignment-only system templates.
CREATE OR REPLACE FUNCTION public.enforce_session_start_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _announced text := nullif(current_setting('irondesk.assigned_schedule_id', true), '');
  _ack_template text := nullif(current_setting('irondesk.acknowledged_template_id', true), '');
  _schedule record;
  _enrollment record;
  _program record;
  _slot record;
  _slot_count integer;
begin
  if new.scheduled_workout_id is null then
    if new.template_id is not null
       and (_ack_template is null or _ack_template <> new.template_id::text)
       and exists (
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

-- Start any active template (including assignment-only Legacy Beta content) as
-- free training, but only with an explicit warning acknowledgment.
CREATE OR REPLACE FUNCTION public.start_library_workout(
  _template_id uuid,
  _acknowledged boolean DEFAULT false
) RETURNS uuid
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
    is_drop_set,is_heavy,target_rpe,rest_seconds
  )
  select
    _session_id,te.exercise_id,null,te.exercise_name,x.primary_muscle,x.equipment,
    te.position,te.target_sets,te.target_reps,te.notes,te.load_guidance,te.source_load_unit,
    te.is_drop_set,te.is_heavy,te.target_rpe,te.rest_seconds
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

REVOKE ALL ON FUNCTION public.start_library_workout(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_library_workout(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.start_library_workout(uuid, boolean) TO authenticated;
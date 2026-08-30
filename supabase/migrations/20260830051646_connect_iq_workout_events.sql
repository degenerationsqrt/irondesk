-- IronDesk Garmin Connect IQ companion support.
--
-- Device pairing and workout events are handled only by trusted server routes
-- using the service role. No anonymous or authenticated Data API client gets
-- direct access to event receipts or either RPC below.

-- Pairing codes are purpose-bound so a Garmin code cannot be consumed by the
-- Health Connect endpoint (or vice versa). Existing rows are Android codes.
alter table public.device_pairings
  add column if not exists platform text not null default 'android';

alter table public.device_pairings
  drop constraint if exists device_pairings_platform_check;
alter table public.device_pairings
  add constraint device_pairings_platform_check
  check (platform in ('android', 'connect_iq'));

-- Device links are also purpose-bound. The base schema predates the Garmin
-- companion and allowed arbitrary free text here, so constrain it explicitly
-- before trusted routes begin relying on the platform discriminator.
alter table public.device_links
  drop constraint if exists device_links_platform_check;
alter table public.device_links
  add constraint device_links_platform_check
  check (platform in ('android', 'connect_iq'));

-- An event receipt is the durable idempotency boundary for offline watch
-- queues. The unique device/event key rejects reuse of an event id, while the
-- request hash distinguishes an exact replay from a conflicting payload.
create table if not exists public.connect_iq_event_receipts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.device_links(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  event_type text not null check (event_type in ('set.updated', 'workout.finished')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  set_id uuid references public.workout_sets(id) on delete set null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (device_id, event_id)
);

create index if not exists connect_iq_receipts_user_created_idx
  on public.connect_iq_event_receipts (user_id, created_at desc);
create index if not exists connect_iq_receipts_user_set_occurred_idx
  on public.connect_iq_event_receipts (user_id, set_id, event_type, occurred_at desc)
  include (created_at)
  where set_id is not null and response @> '{"applied": true}'::jsonb;

revoke all on table public.connect_iq_event_receipts from PUBLIC, anon, authenticated;
grant all on table public.connect_iq_event_receipts to service_role;
alter table public.connect_iq_event_receipts enable row level security;

-- Atomically consumes a one-time pairing code and creates the linked device.
-- SECURITY INVOKER is intentional: the trusted server calls this as
-- service_role. Execute is explicitly unavailable to browser roles.
create or replace function public.exchange_device_pairing(
  _code_hash text,
  _device_label text,
  _platform text,
  _token_hash text,
  _data_source_type text default null
)
returns table(linked_device_id uuid, linked_user_id uuid, linked_label text)
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  _pair public.device_pairings%rowtype;
  _source_id uuid;
  _device_id uuid;
  _label text;
begin
  if _platform not in ('android', 'connect_iq') then
    raise exception 'Unsupported device platform' using errcode = '22023';
  end if;
  if _code_hash !~ '^[0-9a-f]{64}$' or _token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid token digest' using errcode = '22023';
  end if;
  if _data_source_type is not null
     and not (_platform = 'android' and _data_source_type = 'health_connect') then
    raise exception 'Invalid device data source' using errcode = '22023';
  end if;

  select p.* into _pair
  from public.device_pairings p
  where p.code_hash = _code_hash
  for update;

  if not found
     or _pair.consumed_at is not null
     or _pair.expires_at < now()
     or _pair.platform <> _platform then
    raise exception 'Pairing code is unavailable' using errcode = 'P0002';
  end if;

  _label := coalesce(nullif(left(btrim(_device_label), 80), ''), _pair.label);

  if _data_source_type = 'health_connect' then
    insert into public.data_sources (
      user_id, source_type, label, status, retain_original_files, metadata
    ) values (
      _pair.user_id,
      'health_connect',
      _label,
      'connected',
      false,
      jsonb_build_object('platform', _platform, 'paired_at', now())
    )
    on conflict (user_id, source_type, label) do update
      set status = 'connected',
          metadata = excluded.metadata,
          updated_at = now()
    returning id into _source_id;
  end if;

  insert into public.device_links (
    user_id, data_source_id, label, platform, token_hash
  ) values (
    _pair.user_id, _source_id, _label, _platform, _token_hash
  )
  returning id into _device_id;

  update public.device_pairings
  set consumed_at = now()
  where id = _pair.id;

  return query select _device_id, _pair.user_id, _label;
end;
$function$;

revoke all on function public.exchange_device_pairing(text, text, text, text, text)
  from PUBLIC, anon, authenticated;
grant execute on function public.exchange_device_pairing(text, text, text, text, text)
  to service_role;

-- Applies one normalized Connect IQ event and records its response in the same
-- transaction. Exact replays return the original response with replayed=true;
-- reusing an event id for a different request is rejected.
create or replace function public.apply_connect_iq_event(
  _device_id uuid,
  _user_id uuid,
  _event_id text,
  _event_type text,
  _request_hash text,
  _session_id uuid,
  _set_id uuid,
  _occurred_at timestamptz,
  _payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
declare
  _device public.device_links%rowtype;
  _receipt public.connect_iq_event_receipts%rowtype;
  _session public.workout_sessions%rowtype;
  _set public.workout_sets%rowtype;
  _latest_set_event timestamptz;
  _latest_set_receipt_created timestamptz;
  _stale_reason text;
  _response jsonb;
  _completed_sets integer;
  _total_reps integer;
  _tonnage_kg numeric;
  _avg_rpe numeric;
  _duration_sec integer;
begin
  if length(_event_id) < 8 or length(_event_id) > 128
     or _event_id !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'Invalid event id' using errcode = '22023';
  end if;
  if _event_type not in ('set.updated', 'workout.finished') then
    raise exception 'Unsupported event type' using errcode = '22023';
  end if;
  if _request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid request hash' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Event payload must be an object' using errcode = '22023';
  end if;

  -- Serialise all requests for one watch and independently re-check the token-
  -- resolved identity supplied by the trusted server route.
  select d.* into _device
  from public.device_links d
  where d.id = _device_id
    and d.user_id = _user_id
    and d.platform = 'connect_iq'
  for update;
  if not found then
    raise exception 'Connect IQ device is unavailable' using errcode = 'P0002';
  end if;

  select r.* into _receipt
  from public.connect_iq_event_receipts r
  where r.device_id = _device_id and r.event_id = _event_id;

  if found then
    if _receipt.request_hash <> _request_hash then
      raise exception 'Event id was already used for a different request' using errcode = '23505';
    end if;
    return jsonb_set(_receipt.response, '{replayed}', 'true'::jsonb, true);
  end if;

  -- Check the offline-queue window only for a new event. A receipt remains a
  -- durable idempotency record, so an exact replay still succeeds later.
  if _occurred_at < now() - interval '30 days'
     or _occurred_at > now() + interval '5 minutes' then
    raise exception 'Event time is outside the accepted window' using errcode = '22023';
  end if;

  select s.* into _session
  from public.workout_sessions s
  where s.id = _session_id and s.user_id = _user_id and not s.is_sample
  for update;
  if not found then
    raise exception 'Workout was not found for this device' using errcode = 'P0002';
  end if;
  if _occurred_at < _session.started_at then
    raise exception 'Event time cannot precede the workout start' using errcode = '22023';
  end if;

  if _event_type = 'set.updated' then
    if _set_id is null then
      raise exception 'set_id is required for set.updated' using errcode = '22023';
    end if;
    if _session.status <> 'active' then
      raise exception 'Workout is not active' using errcode = '23514';
    end if;

    select ws.* into _set
    from public.workout_sets ws
    join public.session_exercises se on se.id = ws.session_exercise_id
    where ws.id = _set_id
      and se.session_id = _session_id
    for update of ws;
    if not found then
      raise exception 'Set was not found in this workout' using errcode = 'P0002';
    end if;

    -- A delayed older event is acknowledged but cannot roll back a later watch
    -- edit. Equal timestamps retain request order inside the submitted batch.
    select r.occurred_at, r.created_at
    into _latest_set_event, _latest_set_receipt_created
    from public.connect_iq_event_receipts r
    where r.user_id = _user_id
      and r.set_id = _set_id
      and r.event_type = 'set.updated'
      and r.response @> '{"applied": true}'::jsonb
    order by r.occurred_at desc, r.created_at desc
    limit 1;

    -- A browser edit has no Connect IQ receipt at its updated_at. Preserve it
    -- when this queued watch event happened earlier; a newer watch edit may
    -- still intentionally win.
    if _latest_set_event is not null and _occurred_at < _latest_set_event then
      _stale_reason := 'newer_watch_event';
    elsif _set.updated_at > coalesce(_latest_set_receipt_created, _set.created_at)
          and _occurred_at < _set.updated_at then
      _stale_reason := 'newer_web_edit';
    else
      _stale_reason := null;
    end if;

    if _stale_reason is not null then
      _response := jsonb_build_object(
        'event_id', _event_id,
        'type', _event_type,
        'applied', false,
        'ignored', true,
        'reason', _stale_reason,
        'replayed', false
      );
    else
      if not (_payload ?| array['weight_kg', 'reps', 'rpe', 'completed', 'rest_seconds']) then
        raise exception 'set.updated payload is empty' using errcode = '22023';
      end if;
      if _payload ? 'weight_kg'
         and (_payload->>'weight_kg') is not null
         and ((_payload->>'weight_kg')::numeric < 0 or (_payload->>'weight_kg')::numeric > 1000) then
        raise exception 'weight_kg is out of range' using errcode = '22023';
      end if;
      if _payload ? 'reps'
         and (_payload->>'reps') is not null
         and ((_payload->>'reps')::integer < 0 or (_payload->>'reps')::integer > 500) then
        raise exception 'reps is out of range' using errcode = '22023';
      end if;
      if _payload ? 'rpe'
         and (_payload->>'rpe') is not null
         and ((_payload->>'rpe')::numeric < 1 or (_payload->>'rpe')::numeric > 10) then
        raise exception 'rpe is out of range' using errcode = '22023';
      end if;
      if _payload ? 'rest_seconds'
         and (_payload->>'rest_seconds') is not null
         and ((_payload->>'rest_seconds')::integer < 0 or (_payload->>'rest_seconds')::integer > 3600) then
        raise exception 'rest_seconds is out of range' using errcode = '22023';
      end if;
      if _payload ? 'completed' and jsonb_typeof(_payload->'completed') <> 'boolean' then
        raise exception 'completed must be boolean' using errcode = '22023';
      end if;

      update public.workout_sets ws
      set weight_kg = case when _payload ? 'weight_kg' then (_payload->>'weight_kg')::numeric else ws.weight_kg end,
          reps = case when _payload ? 'reps' then (_payload->>'reps')::smallint else ws.reps end,
          rpe = case when _payload ? 'rpe' then (_payload->>'rpe')::numeric else ws.rpe end,
          rest_seconds = case when _payload ? 'rest_seconds' then (_payload->>'rest_seconds')::integer else ws.rest_seconds end,
          completed = case when _payload ? 'completed' then (_payload->>'completed')::boolean else ws.completed end,
          completed_at = case
            when not (_payload ? 'completed') then ws.completed_at
            when (_payload->>'completed')::boolean then _occurred_at
            else null
          end
      where ws.id = _set_id
      returning ws.* into _set;

      _response := jsonb_build_object(
        'event_id', _event_id,
        'type', _event_type,
        'applied', true,
        'replayed', false,
        'set', jsonb_build_object(
          'id', _set.id,
          'weight_kg', _set.weight_kg,
          'reps', _set.reps,
          'rpe', _set.rpe,
          'completed', _set.completed,
          'rest_seconds', _set.rest_seconds
        )
      );
    end if;
  else
    if _set_id is not null then
      raise exception 'set_id is not valid for workout.finished' using errcode = '22023';
    end if;
    if _session.status <> 'active' then
      raise exception 'Workout is not active' using errcode = '23514';
    end if;

    if _payload ? 'avg_hr'
       and (_payload->>'avg_hr') is not null
       and ((_payload->>'avg_hr')::integer < 30 or (_payload->>'avg_hr')::integer > 240) then
      raise exception 'avg_hr is out of range' using errcode = '22023';
    end if;
    if _payload ? 'max_hr'
       and (_payload->>'max_hr') is not null
       and ((_payload->>'max_hr')::integer < 30 or (_payload->>'max_hr')::integer > 260) then
      raise exception 'max_hr is out of range' using errcode = '22023';
    end if;
    if (_payload->>'avg_hr') is not null
       and (_payload->>'max_hr') is not null
       and (_payload->>'max_hr')::integer < (_payload->>'avg_hr')::integer then
      raise exception 'max_hr cannot be lower than avg_hr' using errcode = '22023';
    end if;

    update public.workout_sessions s
    set status = 'completed',
        completed_at = _occurred_at,
        avg_hr = case when _payload ? 'avg_hr' then (_payload->>'avg_hr')::smallint else s.avg_hr end,
        max_hr = case when _payload ? 'max_hr' then (_payload->>'max_hr')::smallint else s.max_hr end
    where s.id = _session_id
    returning s.* into _session;

    select
      count(*)::integer,
      coalesce(sum(ws.reps), 0)::integer,
      coalesce(sum(ws.weight_kg * ws.reps), 0),
      coalesce(round(avg(ws.rpe), 1), 0)
    into _completed_sets, _total_reps, _tonnage_kg, _avg_rpe
    from public.workout_sets ws
    join public.session_exercises se on se.id = ws.session_exercise_id
    where se.session_id = _session_id and ws.completed;

    _duration_sec := greatest(
      0,
      extract(epoch from (coalesce(_session.completed_at, _occurred_at) - _session.started_at))::integer
    );

    _response := jsonb_build_object(
      'event_id', _event_id,
      'type', _event_type,
      'applied', true,
      'replayed', false,
      'summary', jsonb_build_object(
        'session_id', _session_id,
        'duration_sec', _duration_sec,
        'sets', _completed_sets,
        'reps', _total_reps,
        'tonnage_kg', _tonnage_kg,
        'avg_rpe', _avg_rpe
      )
    );
  end if;

  insert into public.connect_iq_event_receipts (
    device_id, user_id, event_id, event_type, request_hash,
    session_id, set_id, occurred_at, payload, response
  ) values (
    _device_id, _user_id, _event_id, _event_type, _request_hash,
    _session_id, _set_id, _occurred_at, _payload, _response
  );

  update public.device_links
  set last_sync_at = now(),
      last_sync_summary = jsonb_build_object(
        'event_type', _event_type,
        'session_id', _session_id,
        'event_id', _event_id
      )
  where id = _device_id;

  return _response;
end;
$function$;

revoke all on function public.apply_connect_iq_event(
  uuid, uuid, text, text, text, uuid, uuid, timestamptz, jsonb
) from PUBLIC, anon, authenticated;
grant execute on function public.apply_connect_iq_event(
  uuid, uuid, text, text, text, uuid, uuid, timestamptz, jsonb
) to service_role;

-- ============================================================================
-- IronDesk — legacy workout template migration
--
-- 1. Extends workout_templates / template_exercises so ONE table holds both
--    shared read-only "IronDesk Original" system templates (user_id null,
--    is_system true) and personal athlete templates (user_id = owner).
-- 2. Re-states RLS: system rows are readable by any authenticated athlete but
--    writable by nobody from the client; personal rows stay owner-scoped.
-- 3. Idempotently seeds the 12 legacy templates / 62 prescribed movements
--    recovered from the original IronDesk.jsx (PROGRAM_HOME + PROGRAM_GYM),
--    matched on source_key. Re-running never duplicates rows.
--
-- Legacy numeric load guidance (e.g. '315-345') is POUNDS. It is stored
-- verbatim as text with source_load_unit = 'lb'; no weight is ever inferred
-- as kilograms.
-- ============================================================================

-- --------------------------------------------------------- workout_templates
alter table public.workout_templates alter column user_id drop not null;

alter table public.workout_templates
  add column if not exists source_key text,
  add column if not exists source_name text,
  add column if not exists source_version integer not null default 1,
  add column if not exists is_system boolean not null default false,
  add column if not exists environment text,
  add column if not exists workout_type text,
  add column if not exists category text default 'strength',
  add column if not exists level text,
  add column if not exists estimated_minutes integer,
  add column if not exists tags text[] not null default '{}',
  add column if not exists sort_order integer not null default 100,
  add column if not exists legacy_day_id text;

alter table public.workout_templates drop constraint if exists workout_templates_environment_check;
alter table public.workout_templates
  add constraint workout_templates_environment_check
  check (environment is null or environment in ('home', 'gym'));

alter table public.workout_templates drop constraint if exists workout_templates_workout_type_check;
alter table public.workout_templates
  add constraint workout_templates_workout_type_check
  check (workout_type is null or workout_type in ('heavy', 'pump'));

-- Ownership integrity: system templates are unowned, personal templates owned.
alter table public.workout_templates drop constraint if exists workout_templates_ownership_check;
alter table public.workout_templates
  add constraint workout_templates_ownership_check
  check ((is_system and user_id is null) or (not is_system and user_id is not null));

create unique index if not exists workout_templates_source_key_uniq
  on public.workout_templates (source_key) where source_key is not null;
create index if not exists workout_templates_system_idx
  on public.workout_templates (is_system, sort_order);

-- -------------------------------------------------------- template_exercises
alter table public.template_exercises
  add column if not exists load_guidance text,
  add column if not exists source_load_unit text,
  add column if not exists is_drop_set boolean not null default false,
  add column if not exists is_heavy boolean not null default false;

alter table public.template_exercises drop constraint if exists template_exercises_source_load_unit_check;
alter table public.template_exercises
  add constraint template_exercises_source_load_unit_check
  check (source_load_unit is null or source_load_unit in ('kg', 'lb'));

-- Prescription context is copied into the live session so the workout console
-- can surface load guidance, heavy / drop-set instructions and rest defaults.
alter table public.session_exercises
  add column if not exists load_guidance text,
  add column if not exists source_load_unit text,
  add column if not exists is_drop_set boolean not null default false,
  add column if not exists is_heavy boolean not null default false,
  add column if not exists target_rpe numeric,
  add column if not exists rest_seconds integer;

alter table public.session_exercises drop constraint if exists session_exercises_source_load_unit_check;
alter table public.session_exercises
  add constraint session_exercises_source_load_unit_check
  check (source_load_unit is null or source_load_unit in ('kg', 'lb'));

-- ---------------------------------------------------------- helper functions
-- Readable: system templates, or the caller's own personal template.
create or replace function public.template_readable(_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workout_templates t
    where t.id = _template_id
      and (t.is_system or t.user_id = auth.uid())
  )
$$;

-- Writable: only the caller's own personal (non-system) template.
create or replace function public.template_writable(_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workout_templates t
    where t.id = _template_id
      and t.is_system = false
      and t.user_id = auth.uid()
  )
$$;

create or replace function public.template_owner(_template_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.workout_templates where id = _template_id
$$;

-- ----------------------------------------------------------------------- RLS
alter table public.workout_templates enable row level security;
drop policy if exists "templates_select_own" on public.workout_templates;
drop policy if exists "templates_select_system_or_own" on public.workout_templates;
drop policy if exists "templates_insert_own" on public.workout_templates;
drop policy if exists "templates_update_own" on public.workout_templates;
drop policy if exists "templates_delete_own" on public.workout_templates;

-- Read: shared IronDesk Originals + the athlete's own templates.
create policy "templates_select_system_or_own" on public.workout_templates
  for select to authenticated
  using (is_system or user_id = auth.uid());
-- Write: personal templates only. System rows are read-only to every client.
create policy "templates_insert_own" on public.workout_templates
  for insert to authenticated
  with check (is_system = false and user_id = auth.uid());
create policy "templates_update_own" on public.workout_templates
  for update to authenticated
  using (is_system = false and user_id = auth.uid())
  with check (is_system = false and user_id = auth.uid());
create policy "templates_delete_own" on public.workout_templates
  for delete to authenticated
  using (is_system = false and user_id = auth.uid());

alter table public.template_exercises enable row level security;
drop policy if exists "template_exercises_select_own" on public.template_exercises;
drop policy if exists "template_exercises_select_readable" on public.template_exercises;
drop policy if exists "template_exercises_insert_own" on public.template_exercises;
drop policy if exists "template_exercises_update_own" on public.template_exercises;
drop policy if exists "template_exercises_delete_own" on public.template_exercises;

-- Children inherit the parent template's visibility / writability.
create policy "template_exercises_select_readable" on public.template_exercises
  for select to authenticated using (public.template_readable(template_id));
create policy "template_exercises_insert_own" on public.template_exercises
  for insert to authenticated with check (public.template_writable(template_id));
create policy "template_exercises_update_own" on public.template_exercises
  for update to authenticated
  using (public.template_writable(template_id))
  with check (public.template_writable(template_id));
create policy "template_exercises_delete_own" on public.template_exercises
  for delete to authenticated using (public.template_writable(template_id));

grant select, insert, update, delete on public.workout_templates to authenticated;
grant all on public.workout_templates to service_role;
grant select, insert, update, delete on public.template_exercises to authenticated;
grant all on public.template_exercises to service_role;

-- ----------------------------------------- legacy system template seed (idempotent)
create temporary table _legacy_tpl (
  source_key text, name text, focus text, environment text, workout_type text,
  estimated_minutes int, tags text[], sort_order int, legacy_day_id text, source_version int
);

insert into _legacy_tpl values
  ('legacy-home-chest','Chest · Home','HEAVY DAY · bench-led, long rest, no pump chase','home','heavy',60,array['home','heavy','chest'],100,'Chest',1),
  ('legacy-home-arms','Arms · Home','PUMP DAY · supersets, short rest, chase the burn','home','pump',50,array['home','pump','arms'],101,'Arms',1),
  ('legacy-home-back','Back · Home','HEAVY DAY · deadlift + rows, long rest','home','heavy',60,array['home','heavy','back'],102,'Back',1),
  ('legacy-home-shoulders','Shoulders · Home','PUMP DAY · laterals & rear delts, chase the burn','home','pump',50,array['home','pump','shoulders'],103,'Shoulders',1),
  ('legacy-home-legs','Legs · Home','HEAVY DAY · squat-led, long rest','home','heavy',60,array['home','heavy','legs'],104,'Legs',1),
  ('legacy-home-calves-plus-abs','Calves+Abs · Home','PUMP DAY · high rep, drop sets','home','pump',50,array['home','pump','calves-plus-abs'],105,'Calves+Abs',1),
  ('legacy-gym-chest','Chest · Gym','HEAVY DAY · bench-led + machine volume','gym','heavy',60,array['gym','heavy','chest'],200,'Chest',1),
  ('legacy-gym-arms','Arms · Gym','PUMP DAY · cables & machines, chase the burn','gym','pump',50,array['gym','pump','arms'],201,'Arms',1),
  ('legacy-gym-back','Back · Gym','HEAVY DAY · deadlift + cable/machine rows','gym','heavy',60,array['gym','heavy','back'],202,'Back',1),
  ('legacy-gym-shoulders','Shoulders · Gym','PUMP DAY · cable laterals & machine presses','gym','pump',50,array['gym','pump','shoulders'],203,'Shoulders',1),
  ('legacy-gym-legs','Legs · Gym','HEAVY DAY · squat + leg press & machines','gym','heavy',60,array['gym','heavy','legs'],204,'Legs',1),
  ('legacy-gym-calves-plus-abs','Calves+Abs · Gym','PUMP DAY · machines, high rep, drop sets','gym','pump',50,array['gym','pump','calves-plus-abs'],205,'Calves+Abs',1);

create temporary table _legacy_tex (
  source_key text, position int, exercise_name text, canonical_name text,
  target_sets int, target_reps text, target_rpe numeric, rest_seconds int,
  load_guidance text, source_load_unit text, is_drop_set boolean, is_heavy boolean, notes text
);

insert into _legacy_tex values
  ('legacy-home-chest',0,'Bench Press','Barbell Bench Press',4,'4',8,180,'315–345','lb',false,true,'Top strength lift — rest 3 min'),
  ('legacy-home-chest',1,'Incline Barbell / DB Press','Incline Bench Press',3,'5',8,180,'heavy',null,false,true,'Upper chest'),
  ('legacy-home-chest',2,'Flat DB Press','Dumbbell Bench Press',3,'6',8,90,'heavy',null,false,false,'Stretch at bottom'),
  ('legacy-home-chest',3,'Weighted Dip','Dip',2,'6',8,90,'add load',null,false,false,'Optional finisher'),
  ('legacy-home-arms',0,'EZ Bar Curl','Barbell Curl',3,'10',8,60,'moderate',null,false,false,'Strict'),
  ('legacy-home-arms',1,'Tricep Pushdown','Triceps Pushdown',3,'12',8,60,'moderate',null,true,false,'Superset w/ curls · drop last set'),
  ('legacy-home-arms',2,'Hammer Curl','Incline Dumbbell Curl',3,'12',8,60,'moderate',null,true,false,'Drop last set'),
  ('legacy-home-arms',3,'Overhead Tricep Ext','Skullcrusher',3,'12',8,60,'moderate',null,false,false,'Full stretch'),
  ('legacy-home-arms',4,'Wide-Grip Curl','Barbell Curl',2,'15',8,60,'light',null,false,false,'Burnout'),
  ('legacy-home-arms',5,'Cable Kickback','Triceps Pushdown',2,'15',8,60,'light',null,true,false,'Squeeze · drop last set'),
  ('legacy-home-back',0,'Deadlift','Conventional Deadlift',4,'3',8,180,'405–455','lb',false,true,'Bar speed fast or stop'),
  ('legacy-home-back',1,'Barbell Bent-Over Row','Barbell Row',4,'5',8,180,'heavy',null,false,true,'Controlled, no jerk'),
  ('legacy-home-back',2,'Weighted Pull-up','Pull-Up',3,'5',8,90,'add load',null,false,false,'Full hang'),
  ('legacy-home-back',3,'One-Arm DB Row','Dumbbell Row',3,'6',8,90,'heavy',null,false,false,'Stretch each rep'),
  ('legacy-home-shoulders',0,'Lateral Raises','Lateral Raise',4,'15',8,60,'light, strict',null,true,false,'Drop last set — no swing'),
  ('legacy-home-shoulders',1,'DB Arnold Press','Seated Dumbbell Press',3,'12',8,60,'moderate',null,false,false,'Full ROM'),
  ('legacy-home-shoulders',2,'Cable Rear Delt Fly','Rear Delt Fly',3,'15',8,60,'light',null,false,false,'Squeeze back'),
  ('legacy-home-shoulders',3,'Reverse Pec Deck','Rear Delt Fly',3,'15',8,60,'light',null,true,false,'Drop last set'),
  ('legacy-home-shoulders',4,'Shoulder Shrugs','Farmer Carry',3,'15',8,60,'moderate',null,false,false,'Traps'),
  ('legacy-home-shoulders',5,'Upright Row / Front Raise','Lateral Raise',2,'15',8,60,'light',null,false,false,'Burnout'),
  ('legacy-home-legs',0,'Back Squat','Back Squat',4,'4',8,180,'385–425','lb',false,true,'Pins set — rest 3 min'),
  ('legacy-home-legs',1,'Romanian Deadlift','Romanian Deadlift',3,'6',8,180,'heavy',null,false,true,'Hamstrings loaded'),
  ('legacy-home-legs',2,'Front Squat / Hack Squat','Front Squat',3,'6',8,90,'moderate-heavy',null,false,false,'Quad focus'),
  ('legacy-home-legs',3,'Leg Curl','Leg Curl',3,'8',8,90,'moderate',null,false,false,'Hamstring isolation'),
  ('legacy-home-calves-plus-abs',0,'Standing Calf Raise','Standing Calf Raise',4,'15',8,60,'loaded',null,true,false,'Pause at top · drop last set'),
  ('legacy-home-calves-plus-abs',1,'Seated Calf Raise','Standing Calf Raise',3,'20',8,60,'moderate',null,false,false,'Soleus'),
  ('legacy-home-calves-plus-abs',2,'Hanging Leg Raise','Hanging Leg Raise',3,'15',8,60,'bodyweight',null,false,false,'Slow negative'),
  ('legacy-home-calves-plus-abs',3,'Cable Crunch','Cable Crunch',3,'15',8,60,'loaded',null,true,false,'Drop last set'),
  ('legacy-home-calves-plus-abs',4,'Weighted Sit-Ups','Cable Crunch',3,'20',8,60,'light plate',null,false,false,'Full range'),
  ('legacy-home-calves-plus-abs',5,'Air Bike','Air Bike Intervals',2,'30',8,60,'bodyweight',null,false,false,'Burnout'),
  ('legacy-gym-chest',0,'Barbell Bench Press','Barbell Bench Press',4,'4',8,180,'315–345','lb',false,true,'Top strength lift — rest 3 min'),
  ('legacy-gym-chest',1,'Incline Smith / Leverage Press','Machine Chest Press',3,'6',8,180,'heavy',null,false,true,'Machine — upper chest'),
  ('legacy-gym-chest',2,'Pec Deck / Cable Fly','Cable Fly',3,'10',8,90,'moderate',null,true,false,'Squeeze · drop last set'),
  ('legacy-gym-chest',3,'Weighted Dip','Dip',2,'8',8,90,'add load',null,false,false,'Finisher'),
  ('legacy-gym-arms',0,'Cable Tricep Pushdown','Triceps Pushdown',3,'12',8,60,'moderate',null,true,false,'Superset · drop last set'),
  ('legacy-gym-arms',1,'EZ Bar Curl','Barbell Curl',3,'10',8,60,'moderate',null,false,false,'Strict'),
  ('legacy-gym-arms',2,'Cable Curl','Barbell Curl',3,'12',8,60,'moderate',null,true,false,'Constant tension · drop last'),
  ('legacy-gym-arms',3,'Overhead Cable Ext','Skullcrusher',3,'12',8,60,'moderate',null,false,false,'Full stretch'),
  ('legacy-gym-arms',4,'Machine Preacher Curl','Barbell Curl',2,'15',8,60,'light',null,false,false,'Burnout'),
  ('legacy-gym-arms',5,'Rope Hammer Curl','Incline Dumbbell Curl',2,'15',8,60,'light',null,true,false,'Drop last set'),
  ('legacy-gym-back',0,'Deadlift','Conventional Deadlift',4,'3',8,180,'405–455','lb',false,true,'Bar speed fast or stop'),
  ('legacy-gym-back',1,'Lat Pulldown / Weighted Pull-up','Lat Pulldown',4,'8',8,180,'heavy',null,false,true,'Full stretch'),
  ('legacy-gym-back',2,'Seated Cable Row','Seated Cable Row',3,'8',8,90,'heavy',null,false,false,'Squeeze shoulder blades'),
  ('legacy-gym-back',3,'Hammer / Machine Row','Seated Cable Row',3,'10',8,90,'moderate',null,true,false,'Drop last set'),
  ('legacy-gym-back',4,'Straight-Arm Pulldown','Lat Pulldown',2,'15',8,90,'light',null,false,false,'Lat isolation'),
  ('legacy-gym-shoulders',0,'Cable Lateral Raise','Lateral Raise',4,'15',8,60,'light',null,true,false,'Constant tension · drop last set'),
  ('legacy-gym-shoulders',1,'Machine Shoulder Press','Seated Dumbbell Press',3,'12',8,60,'moderate',null,false,false,'Full ROM'),
  ('legacy-gym-shoulders',2,'Reverse Pec Deck','Rear Delt Fly',3,'15',8,60,'light',null,true,false,'Rear delts · drop last set'),
  ('legacy-gym-shoulders',3,'Cable Rear Delt Fly','Rear Delt Fly',3,'15',8,60,'light',null,false,false,'Squeeze back'),
  ('legacy-gym-shoulders',4,'Machine / DB Shrugs','Farmer Carry',3,'15',8,60,'heavy',null,false,false,'Traps'),
  ('legacy-gym-shoulders',5,'Cable Upright Row','Lateral Raise',2,'15',8,60,'light',null,false,false,'Burnout'),
  ('legacy-gym-legs',0,'Back Squat','Back Squat',4,'4',8,180,'385–425','lb',false,true,'Rest 3 min'),
  ('legacy-gym-legs',1,'Leg Press','Leg Press',3,'8',8,180,'heavy',null,false,true,'Full depth'),
  ('legacy-gym-legs',2,'Hack Squat','Front Squat',3,'8',8,90,'moderate-heavy',null,false,false,'Quad focus'),
  ('legacy-gym-legs',3,'Lying Leg Curl','Leg Curl',3,'10',8,90,'moderate',null,true,false,'Hamstrings · drop last set'),
  ('legacy-gym-legs',4,'Leg Extension','Leg Extension',3,'12',8,90,'moderate',null,true,false,'Quads · drop last set'),
  ('legacy-gym-calves-plus-abs',0,'Standing Calf Machine','Standing Calf Raise',4,'15',8,60,'heavy',null,true,false,'Pause at top · drop last set'),
  ('legacy-gym-calves-plus-abs',1,'Seated Calf Machine','Standing Calf Raise',3,'20',8,60,'moderate',null,false,false,'Soleus'),
  ('legacy-gym-calves-plus-abs',2,'Cable Crunch','Cable Crunch',3,'15',8,60,'loaded',null,true,false,'Drop last set'),
  ('legacy-gym-calves-plus-abs',3,'Captain''s Chair Leg Raise','Hanging Leg Raise',3,'15',8,60,'bodyweight',null,false,false,'Slow negative'),
  ('legacy-gym-calves-plus-abs',4,'Weighted Sit-Ups','Cable Crunch',3,'20',8,60,'light plate',null,false,false,'Full range'),
  ('legacy-gym-calves-plus-abs',5,'Air Bike','Air Bike Intervals',2,'30',8,60,'bodyweight',null,false,false,'Burnout');

insert into public.workout_templates (
  user_id, name, focus, notes, is_system, source_key, source_name, source_version,
  environment, workout_type, category, level, estimated_minutes, tags, sort_order, legacy_day_id
)
select
  null, s.name, s.focus, null, true, s.source_key, 'IronDesk.jsx', s.source_version,
  s.environment, s.workout_type, 'strength', null, s.estimated_minutes, s.tags, s.sort_order, s.legacy_day_id
from _legacy_tpl s
on conflict (source_key) where source_key is not null do update set
  name = excluded.name,
  focus = excluded.focus,
  is_system = true,
  source_name = excluded.source_name,
  source_version = excluded.source_version,
  environment = excluded.environment,
  workout_type = excluded.workout_type,
  category = excluded.category,
  estimated_minutes = excluded.estimated_minutes,
  tags = excluded.tags,
  sort_order = excluded.sort_order,
  legacy_day_id = excluded.legacy_day_id;

-- Child rows are rebuilt per seeded template so counts stay exact and any
-- source_version change applies cleanly.
delete from public.template_exercises te
using public.workout_templates t
where te.template_id = t.id
  and t.source_key in (select source_key from _legacy_tpl);

insert into public.template_exercises (
  template_id, exercise_id, exercise_name, position, target_sets, target_reps,
  target_rpe, rest_seconds, notes, load_guidance, source_load_unit, is_drop_set, is_heavy
)
select
  t.id,
  x.id, -- null when no canonical system movement matches; never duplicate the library
  e.exercise_name, e.position, e.target_sets, e.target_reps, e.target_rpe, e.rest_seconds,
  e.notes, e.load_guidance, e.source_load_unit, e.is_drop_set, e.is_heavy
from _legacy_tex e
join public.workout_templates t on t.source_key = e.source_key
left join public.exercises x on x.owner_id is null and x.name = e.canonical_name;

drop table _legacy_tex;
drop table _legacy_tpl;
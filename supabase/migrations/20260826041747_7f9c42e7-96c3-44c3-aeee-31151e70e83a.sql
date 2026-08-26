-- =========================================================================
-- IronDesk 2.0 — Phase 2A core schema
-- Conventions: uuid PKs, timestamptz, updated_at triggers, RLS on all
-- user-data tables, ownership always derived from auth.uid().
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Athlete',
  avatar_url text,
  date_of_birth date,
  height_cm numeric(5,1) check (height_cm is null or (height_cm > 60 and height_cm < 260)),
  current_weight_kg numeric(6,2) check (current_weight_kg is null or (current_weight_kg > 20 and current_weight_kg < 400)),
  onboarding_completed boolean not null default false,
  onboarding_step smallint not null default 0 check (onboarding_step between 0 and 10),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
-- Intent: a profile row is readable/writable only by the auth user it belongs to.
create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_delete_own" on public.profiles for delete to authenticated using (id = auth.uid());
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- ----------------------------------------------------------- user_preferences
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  units text not null default 'metric' check (units in ('metric','imperial')),
  primary_goal text not null default 'strength' check (primary_goal in ('strength','hypertrophy','conditioning','recomposition','endurance','sport_performance')),
  training_days_per_week smallint not null default 4 check (training_days_per_week between 1 and 7),
  calorie_target integer check (calorie_target is null or calorie_target between 800 and 8000),
  protein_target_g integer check (protein_target_g is null or protein_target_g between 20 and 500),
  notify_workout_reminders boolean not null default true,
  notify_weekly_summary boolean not null default true,
  notify_pr_alerts boolean not null default true,
  share_anonymous_analytics boolean not null default false,
  public_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;
alter table public.user_preferences enable row level security;
-- Intent: preferences are private to their owner.
create policy "prefs_select_own" on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy "prefs_insert_own" on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy "prefs_update_own" on public.user_preferences for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "prefs_delete_own" on public.user_preferences for delete to authenticated using (user_id = auth.uid());
create trigger prefs_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

-- --------------------------------------------------------- equipment catalog
create table public.equipment_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null default 'general',
  sort_order smallint not null default 100,
  created_at timestamptz not null default now()
);
grant select on public.equipment_catalog to authenticated;
grant all on public.equipment_catalog to service_role;
alter table public.equipment_catalog enable row level security;
-- Intent: shared reference data — readable by any signed-in athlete, never client-writable.
create policy "equipment_catalog_read" on public.equipment_catalog for select to authenticated using (true);

create table public.user_equipment (
  user_id uuid not null references auth.users(id) on delete cascade,
  equipment_id uuid not null references public.equipment_catalog(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, equipment_id)
);
grant select, insert, update, delete on public.user_equipment to authenticated;
grant all on public.user_equipment to service_role;
alter table public.user_equipment enable row level security;
create policy "user_equipment_select_own" on public.user_equipment for select to authenticated using (user_id = auth.uid());
create policy "user_equipment_insert_own" on public.user_equipment for insert to authenticated with check (user_id = auth.uid());
create policy "user_equipment_delete_own" on public.user_equipment for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------- exercises
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}',
  equipment text not null default 'bodyweight',
  movement_pattern text not null default 'other',
  cues text[] not null default '{}',
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exercises_system_name_key on public.exercises (lower(name)) where owner_id is null;
create unique index exercises_owner_name_key on public.exercises (owner_id, lower(name)) where owner_id is not null;
create index exercises_owner_idx on public.exercises (owner_id);
create index exercises_muscle_idx on public.exercises (primary_muscle);
grant select, insert, update, delete on public.exercises to authenticated;
grant all on public.exercises to service_role;
alter table public.exercises enable row level security;
-- Intent: system rows (owner_id is null) are read-only shared library; custom rows are private to owner.
create policy "exercises_select_system_or_own" on public.exercises for select to authenticated using (owner_id is null or owner_id = auth.uid());
create policy "exercises_insert_own" on public.exercises for insert to authenticated with check (owner_id = auth.uid());
create policy "exercises_update_own" on public.exercises for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "exercises_delete_own" on public.exercises for delete to authenticated using (owner_id = auth.uid());
create trigger exercises_updated_at before update on public.exercises for each row execute function public.set_updated_at();

create table public.exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);
grant select, insert, delete on public.exercise_favorites to authenticated;
grant all on public.exercise_favorites to service_role;
alter table public.exercise_favorites enable row level security;
create policy "favorites_select_own" on public.exercise_favorites for select to authenticated using (user_id = auth.uid());
create policy "favorites_insert_own" on public.exercise_favorites for insert to authenticated with check (user_id = auth.uid());
create policy "favorites_delete_own" on public.exercise_favorites for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------- templates
create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  focus text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_templates_user_idx on public.workout_templates (user_id);
grant select, insert, update, delete on public.workout_templates to authenticated;
grant all on public.workout_templates to service_role;
alter table public.workout_templates enable row level security;
create policy "templates_select_own" on public.workout_templates for select to authenticated using (user_id = auth.uid());
create policy "templates_insert_own" on public.workout_templates for insert to authenticated with check (user_id = auth.uid());
create policy "templates_update_own" on public.workout_templates for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "templates_delete_own" on public.workout_templates for delete to authenticated using (user_id = auth.uid());
create trigger templates_updated_at before update on public.workout_templates for each row execute function public.set_updated_at();

-- Security-definer ownership helpers. Used so nested rows are gated by the
-- owner of their PARENT row instead of a client-supplied user_id.
create or replace function public.template_owner(_template_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.workout_templates where id = _template_id
$$;

create table public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workout_templates(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  position smallint not null default 0,
  target_sets smallint,
  target_reps text,
  target_rpe numeric(3,1),
  rest_seconds integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index template_exercises_template_idx on public.template_exercises (template_id, position);
grant select, insert, update, delete on public.template_exercises to authenticated;
grant all on public.template_exercises to service_role;
alter table public.template_exercises enable row level security;
create policy "template_exercises_select_own" on public.template_exercises for select to authenticated using (public.template_owner(template_id) = auth.uid());
create policy "template_exercises_insert_own" on public.template_exercises for insert to authenticated with check (public.template_owner(template_id) = auth.uid());
create policy "template_exercises_update_own" on public.template_exercises for update to authenticated using (public.template_owner(template_id) = auth.uid()) with check (public.template_owner(template_id) = auth.uid());
create policy "template_exercises_delete_own" on public.template_exercises for delete to authenticated using (public.template_owner(template_id) = auth.uid());
create trigger template_exercises_updated_at before update on public.template_exercises for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ sessions
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Training Session',
  kind text not null default 'strength' check (kind in ('strength','cardio','conditioning','mobility')),
  focus text,
  status text not null default 'active' check (status in ('draft','active','completed','cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  perceived_effort numeric(3,1) check (perceived_effort is null or perceived_effort between 1 and 10),
  calories integer check (calories is null or calories between 0 and 10000),
  avg_hr smallint check (avg_hr is null or avg_hr between 30 and 240),
  max_hr smallint check (max_hr is null or max_hr between 30 and 260),
  cardio_load integer,
  active_zone_minutes integer,
  template_id uuid references public.workout_templates(id) on delete set null,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_sessions_user_started_idx on public.workout_sessions (user_id, started_at desc);
create index workout_sessions_user_status_idx on public.workout_sessions (user_id, status);
grant select, insert, update, delete on public.workout_sessions to authenticated;
grant all on public.workout_sessions to service_role;
alter table public.workout_sessions enable row level security;
create policy "sessions_select_own" on public.workout_sessions for select to authenticated using (user_id = auth.uid());
create policy "sessions_insert_own" on public.workout_sessions for insert to authenticated with check (user_id = auth.uid());
create policy "sessions_update_own" on public.workout_sessions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "sessions_delete_own" on public.workout_sessions for delete to authenticated using (user_id = auth.uid());
create trigger sessions_updated_at before update on public.workout_sessions for each row execute function public.set_updated_at();

create or replace function public.session_owner(_session_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.workout_sessions where id = _session_id
$$;

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  original_exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  primary_muscle text,
  equipment text,
  position smallint not null default 0,
  target_sets smallint,
  target_reps text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_exercises_session_idx on public.session_exercises (session_id, position);
create index session_exercises_exercise_idx on public.session_exercises (exercise_id);
grant select, insert, update, delete on public.session_exercises to authenticated;
grant all on public.session_exercises to service_role;
alter table public.session_exercises enable row level security;
-- Intent: gated by the owner of the parent session, not a client-supplied user id.
create policy "session_exercises_select_own" on public.session_exercises for select to authenticated using (public.session_owner(session_id) = auth.uid());
create policy "session_exercises_insert_own" on public.session_exercises for insert to authenticated with check (public.session_owner(session_id) = auth.uid());
create policy "session_exercises_update_own" on public.session_exercises for update to authenticated using (public.session_owner(session_id) = auth.uid()) with check (public.session_owner(session_id) = auth.uid());
create policy "session_exercises_delete_own" on public.session_exercises for delete to authenticated using (public.session_owner(session_id) = auth.uid());
create trigger session_exercises_updated_at before update on public.session_exercises for each row execute function public.set_updated_at();

create or replace function public.session_exercise_owner(_session_exercise_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.user_id
  from public.session_exercises se
  join public.workout_sessions s on s.id = se.session_id
  where se.id = _session_exercise_id
$$;

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  set_number smallint not null default 1,
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 0 and 1000),
  reps smallint check (reps is null or reps between 0 and 500),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  completed boolean not null default false,
  is_warmup boolean not null default false,
  rest_seconds integer check (rest_seconds is null or rest_seconds between 0 and 3600),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_exercise_id, set_number)
);
create index workout_sets_session_exercise_idx on public.workout_sets (session_exercise_id, set_number);
grant select, insert, update, delete on public.workout_sets to authenticated;
grant all on public.workout_sets to service_role;
alter table public.workout_sets enable row level security;
-- Intent: gated through session_exercise -> session ownership.
create policy "sets_select_own" on public.workout_sets for select to authenticated using (public.session_exercise_owner(session_exercise_id) = auth.uid());
create policy "sets_insert_own" on public.workout_sets for insert to authenticated with check (public.session_exercise_owner(session_exercise_id) = auth.uid());
create policy "sets_update_own" on public.workout_sets for update to authenticated using (public.session_exercise_owner(session_exercise_id) = auth.uid()) with check (public.session_exercise_owner(session_exercise_id) = auth.uid());
create policy "sets_delete_own" on public.workout_sets for delete to authenticated using (public.session_exercise_owner(session_exercise_id) = auth.uid());
create trigger workout_sets_updated_at before update on public.workout_sets for each row execute function public.set_updated_at();

-- -------------------------------------------------------------- body metrics
create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 20 and 400),
  body_fat_percent numeric(4,1) check (body_fat_percent is null or body_fat_percent between 2 and 70),
  waist_cm numeric(5,1),
  note text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index body_metrics_user_recorded_idx on public.body_metrics (user_id, recorded_at desc);
grant select, insert, update, delete on public.body_metrics to authenticated;
grant all on public.body_metrics to service_role;
alter table public.body_metrics enable row level security;
create policy "body_metrics_select_own" on public.body_metrics for select to authenticated using (user_id = auth.uid());
create policy "body_metrics_insert_own" on public.body_metrics for insert to authenticated with check (user_id = auth.uid());
create policy "body_metrics_update_own" on public.body_metrics for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "body_metrics_delete_own" on public.body_metrics for delete to authenticated using (user_id = auth.uid());
create trigger body_metrics_updated_at before update on public.body_metrics for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------- cardio
create table public.cardio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.workout_sessions(id) on delete cascade,
  name text not null default 'Cardio',
  started_at timestamptz not null default now(),
  duration_min integer not null default 0 check (duration_min between 0 and 1440),
  distance_km numeric(6,2),
  calories integer,
  avg_hr smallint,
  max_hr smallint,
  cardio_load integer,
  active_zone_minutes integer,
  zones jsonb not null default '[]'::jsonb,
  notes text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cardio_sessions_user_started_idx on public.cardio_sessions (user_id, started_at desc);
grant select, insert, update, delete on public.cardio_sessions to authenticated;
grant all on public.cardio_sessions to service_role;
alter table public.cardio_sessions enable row level security;
create policy "cardio_select_own" on public.cardio_sessions for select to authenticated using (user_id = auth.uid());
create policy "cardio_insert_own" on public.cardio_sessions for insert to authenticated with check (user_id = auth.uid());
create policy "cardio_update_own" on public.cardio_sessions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cardio_delete_own" on public.cardio_sessions for delete to authenticated using (user_id = auth.uid());
create trigger cardio_sessions_updated_at before update on public.cardio_sessions for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- nutrition
create table public.nutrition_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  calorie_target integer,
  protein_target_g integer,
  carb_target_g integer,
  fat_target_g integer,
  calories integer not null default 0,
  protein_g integer not null default 0,
  carbs_g integer not null default 0,
  fat_g integer not null default 0,
  hydration_target_ml integer not null default 3000,
  hydration_ml integer not null default 0,
  weight_goal_direction text not null default 'maintain' check (weight_goal_direction in ('cut','maintain','gain')),
  weight_goal_rate_kg_per_week numeric(3,2) not null default 0,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index nutrition_days_user_day_idx on public.nutrition_days (user_id, day desc);
grant select, insert, update, delete on public.nutrition_days to authenticated;
grant all on public.nutrition_days to service_role;
alter table public.nutrition_days enable row level security;
create policy "nutrition_days_select_own" on public.nutrition_days for select to authenticated using (user_id = auth.uid());
create policy "nutrition_days_insert_own" on public.nutrition_days for insert to authenticated with check (user_id = auth.uid());
create policy "nutrition_days_update_own" on public.nutrition_days for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "nutrition_days_delete_own" on public.nutrition_days for delete to authenticated using (user_id = auth.uid());
create trigger nutrition_days_updated_at before update on public.nutrition_days for each row execute function public.set_updated_at();

create or replace function public.nutrition_day_owner(_day_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.nutrition_days where id = _day_id
$$;

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  nutrition_day_id uuid not null references public.nutrition_days(id) on delete cascade,
  name text not null,
  eaten_at_label text,
  eaten_at timestamptz,
  calories integer not null default 0,
  protein_g integer not null default 0,
  carbs_g integer not null default 0,
  fat_g integer not null default 0,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index meals_day_idx on public.meals (nutrition_day_id);
grant select, insert, update, delete on public.meals to authenticated;
grant all on public.meals to service_role;
alter table public.meals enable row level security;
-- Intent: gated through the parent nutrition day's owner.
create policy "meals_select_own" on public.meals for select to authenticated using (public.nutrition_day_owner(nutrition_day_id) = auth.uid());
create policy "meals_insert_own" on public.meals for insert to authenticated with check (public.nutrition_day_owner(nutrition_day_id) = auth.uid());
create policy "meals_update_own" on public.meals for update to authenticated using (public.nutrition_day_owner(nutrition_day_id) = auth.uid()) with check (public.nutrition_day_owner(nutrition_day_id) = auth.uid());
create policy "meals_delete_own" on public.meals for delete to authenticated using (public.nutrition_day_owner(nutrition_day_id) = auth.uid());
create trigger meals_updated_at before update on public.meals for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------- recovery
create table public.recovery_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  readiness smallint check (readiness is null or readiness between 0 and 100),
  sleep_hours numeric(4,2) check (sleep_hours is null or sleep_hours between 0 and 24),
  sleep_efficiency_percent smallint check (sleep_efficiency_percent is null or sleep_efficiency_percent between 0 and 100),
  resting_hr smallint check (resting_hr is null or resting_hr between 25 and 140),
  hrv_ms smallint check (hrv_ms is null or hrv_ms between 5 and 300),
  fatigue smallint check (fatigue is null or fatigue between 1 and 10),
  stress smallint check (stress is null or stress between 1 and 10),
  soreness jsonb not null default '[]'::jsonb,
  note text,
  source text not null default 'manual' check (source in ('manual','wearable','estimated')),
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);
create index recovery_entries_user_day_idx on public.recovery_entries (user_id, day desc);
grant select, insert, update, delete on public.recovery_entries to authenticated;
grant all on public.recovery_entries to service_role;
alter table public.recovery_entries enable row level security;
create policy "recovery_select_own" on public.recovery_entries for select to authenticated using (user_id = auth.uid());
create policy "recovery_insert_own" on public.recovery_entries for insert to authenticated with check (user_id = auth.uid());
create policy "recovery_update_own" on public.recovery_entries for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "recovery_delete_own" on public.recovery_entries for delete to authenticated using (user_id = auth.uid());
create trigger recovery_entries_updated_at before update on public.recovery_entries for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- bootstrap
-- Creates the profile + default preferences for the CURRENT auth user.
-- Idempotent; ownership is taken from auth.uid(), never from client input.
create or replace function public.bootstrap_current_user(_display_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, display_name)
  values (uid, coalesce(nullif(trim(_display_name), ''), 'Athlete'))
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (uid)
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.bootstrap_current_user(text) from public;
grant execute on function public.bootstrap_current_user(text) to authenticated;

-- ------------------------------------------------------------------- seeds
insert into public.equipment_catalog (slug, name, category, sort_order) values
  ('barbell','Barbell','free_weight',10),
  ('dumbbell','Dumbbells','free_weight',20),
  ('kettlebell','Kettlebell','free_weight',30),
  ('ez_bar','EZ Bar','free_weight',40),
  ('trap_bar','Trap Bar','free_weight',50),
  ('bench','Adjustable Bench','support',60),
  ('squat_rack','Squat Rack','support',70),
  ('pull_up_bar','Pull-Up Bar','support',80),
  ('dip_station','Dip Station','support',90),
  ('cable_machine','Cable Machine','machine',100),
  ('smith_machine','Smith Machine','machine',110),
  ('leg_press','Leg Press','machine',120),
  ('lat_pulldown','Lat Pulldown','machine',130),
  ('leg_curl','Leg Curl / Extension','machine',140),
  ('machine_press','Chest / Shoulder Machine','machine',150),
  ('bands','Resistance Bands','accessory',160),
  ('trx','Suspension Trainer','accessory',170),
  ('med_ball','Medicine Ball','accessory',180),
  ('sled','Sled','conditioning',190),
  ('rower','Rowing Machine','conditioning',200),
  ('assault_bike','Air Bike','conditioning',210),
  ('treadmill','Treadmill','conditioning',220),
  ('jump_rope','Jump Rope','conditioning',230),
  ('bodyweight','Bodyweight Only','general',240)
on conflict (slug) do nothing;

insert into public.exercises (owner_id, name, primary_muscle, secondary_muscles, equipment, movement_pattern, cues) values
  (null,'Back Squat','Quads','{Glutes,Core}','barbell','squat','{"Brace hard before descending","Knees track over mid-foot","Drive the floor away"}'),
  (null,'Front Squat','Quads','{Core,Upper Back}','barbell','squat','{"Elbows high","Stay upright"}'),
  (null,'Goblet Squat','Quads','{Glutes,Core}','kettlebell','squat','{"Chest tall","Elbows inside knees"}'),
  (null,'Leg Press','Quads','{Glutes}','leg_press','squat','{"Full but controlled range"}'),
  (null,'Bulgarian Split Squat','Quads','{Glutes,Adductors}','dumbbell','lunge','{"Front shin vertical","Control the descent"}'),
  (null,'Walking Lunge','Quads','{Glutes,Hamstrings}','dumbbell','lunge','{"Long stride","Torso upright"}'),
  (null,'Step-Up','Quads','{Glutes}','dumbbell','lunge','{"Drive through the top leg"}'),
  (null,'Conventional Deadlift','Hamstrings','{Glutes,"Upper Back",Core}','barbell','hinge','{"Bar over mid-foot","Wedge into the bar","Push the floor"}'),
  (null,'Trap Bar Deadlift','Hamstrings','{Glutes,Quads}','trap_bar','hinge','{"Neutral spine","Hips and knees together"}'),
  (null,'Romanian Deadlift','Hamstrings','{Glutes,"Lower Back"}','barbell','hinge','{"Hips back","Bar stays on the thighs"}'),
  (null,'Hip Thrust','Glutes','{Hamstrings}','barbell','hinge','{"Ribs down","Full lockout squeeze"}'),
  (null,'Kettlebell Swing','Glutes','{Hamstrings,Core}','kettlebell','hinge','{"Hinge not squat","Snap the hips"}'),
  (null,'Back Extension','Lower Back','{Glutes,Hamstrings}','bodyweight','hinge','{"Move from the hips"}'),
  (null,'Leg Curl','Hamstrings','{Calves}','leg_curl','isolation','{"Slow eccentric"}'),
  (null,'Leg Extension','Quads','{}','leg_curl','isolation','{"Pause at the top"}'),
  (null,'Standing Calf Raise','Calves','{}','machine_press','isolation','{"Full stretch at the bottom"}'),
  (null,'Barbell Bench Press','Chest','{Triceps,"Front Delts"}','barbell','horizontal_push','{"Shoulder blades tucked","Bar to lower chest","Leg drive"}'),
  (null,'Incline Bench Press','Chest','{"Front Delts",Triceps}','barbell','horizontal_push','{"30-45 degree bench","Control the touch"}'),
  (null,'Dumbbell Bench Press','Chest','{Triceps}','dumbbell','horizontal_push','{"Wrists stacked","Deep but safe stretch"}'),
  (null,'Machine Chest Press','Chest','{Triceps}','machine_press','horizontal_push','{"Consistent tempo"}'),
  (null,'Push-Up','Chest','{Triceps,Core}','bodyweight','horizontal_push','{"Body in one line","Elbows 45 degrees"}'),
  (null,'Cable Fly','Chest','{}','cable_machine','isolation','{"Slight elbow bend","Squeeze at midline"}'),
  (null,'Overhead Press','Shoulders','{Triceps,Core}','barbell','vertical_push','{"Ribs down","Head through at lockout"}'),
  (null,'Seated Dumbbell Press','Shoulders','{Triceps}','dumbbell','vertical_push','{"No lower-back arch"}'),
  (null,'Lateral Raise','Shoulders','{}','dumbbell','isolation','{"Lead with the elbow"}'),
  (null,'Rear Delt Fly','Shoulders','{"Upper Back"}','dumbbell','isolation','{"Thumbs slightly down"}'),
  (null,'Dip','Triceps','{Chest,Shoulders}','dip_station','vertical_push','{"Slight forward lean"}'),
  (null,'Pull-Up','Lats','{Biceps,"Upper Back"}','pull_up_bar','vertical_pull','{"Chest to the bar","Depress the shoulders first"}'),
  (null,'Chin-Up','Lats','{Biceps}','pull_up_bar','vertical_pull','{"Full hang each rep"}'),
  (null,'Lat Pulldown','Lats','{Biceps}','lat_pulldown','vertical_pull','{"Elbows to the ribs"}'),
  (null,'Barbell Row','Upper Back','{Lats,Biceps}','barbell','horizontal_pull','{"Torso ~45 degrees","Row to the navel"}'),
  (null,'Dumbbell Row','Upper Back','{Lats,Biceps}','dumbbell','horizontal_pull','{"No torso rotation"}'),
  (null,'Seated Cable Row','Upper Back','{Lats,Biceps}','cable_machine','horizontal_pull','{"Chest proud","Pause at contraction"}'),
  (null,'Face Pull','Upper Back','{Shoulders}','cable_machine','horizontal_pull','{"High elbows","External rotation at the end"}'),
  (null,'Barbell Curl','Biceps','{Forearms}','barbell','isolation','{"Elbows pinned"}'),
  (null,'Incline Dumbbell Curl','Biceps','{}','dumbbell','isolation','{"Full stretch at the bottom"}'),
  (null,'Triceps Pushdown','Triceps','{}','cable_machine','isolation','{"Upper arm still"}'),
  (null,'Skullcrusher','Triceps','{}','ez_bar','isolation','{"Elbows in"}'),
  (null,'Plank','Core','{Shoulders}','bodyweight','core','{"Glutes and abs tight"}'),
  (null,'Hanging Leg Raise','Core','{Hip Flexors}','pull_up_bar','core','{"Posterior pelvic tilt"}'),
  (null,'Cable Crunch','Core','{}','cable_machine','core','{"Flex the spine, not the hips"}'),
  (null,'Pallof Press','Core','{Obliques}','cable_machine','core','{"Resist rotation"}'),
  (null,'Farmer Carry','Core','{Traps,Forearms}','dumbbell','carry','{"Tall posture","Even steps"}'),
  (null,'Sled Push','Quads','{Glutes,Calves}','sled','conditioning','{"Low body angle","Short fast steps"}'),
  (null,'Row Erg Intervals','Full Body','{Legs,Back}','rower','conditioning','{"Legs, hips, arms order"}'),
  (null,'Air Bike Intervals','Full Body','{Legs,Lungs}','assault_bike','conditioning','{"Consistent cadence"}'),
  (null,'Treadmill Zone 2','Full Body','{Legs}','treadmill','conditioning','{"Nasal-breathing pace"}'),
  (null,'Jump Rope','Calves','{Shoulders}','jump_rope','conditioning','{"Wrists drive the rope"}')
on conflict do nothing;
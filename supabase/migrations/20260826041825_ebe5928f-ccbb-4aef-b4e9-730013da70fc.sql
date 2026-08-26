-- Replace SECURITY DEFINER ownership helpers with inline EXISTS checks so no
-- helper function is exposed through the API. Parent-table RLS still applies,
-- and ownership is always derived from auth.uid().

drop policy "template_exercises_select_own" on public.template_exercises;
drop policy "template_exercises_insert_own" on public.template_exercises;
drop policy "template_exercises_update_own" on public.template_exercises;
drop policy "template_exercises_delete_own" on public.template_exercises;

create policy "template_exercises_select_own" on public.template_exercises for select to authenticated
  using (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = auth.uid()));
create policy "template_exercises_insert_own" on public.template_exercises for insert to authenticated
  with check (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = auth.uid()));
create policy "template_exercises_update_own" on public.template_exercises for update to authenticated
  using (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = auth.uid()));
create policy "template_exercises_delete_own" on public.template_exercises for delete to authenticated
  using (exists (select 1 from public.workout_templates t where t.id = template_id and t.user_id = auth.uid()));

drop policy "session_exercises_select_own" on public.session_exercises;
drop policy "session_exercises_insert_own" on public.session_exercises;
drop policy "session_exercises_update_own" on public.session_exercises;
drop policy "session_exercises_delete_own" on public.session_exercises;

create policy "session_exercises_select_own" on public.session_exercises for select to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "session_exercises_insert_own" on public.session_exercises for insert to authenticated
  with check (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "session_exercises_update_own" on public.session_exercises for update to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));
create policy "session_exercises_delete_own" on public.session_exercises for delete to authenticated
  using (exists (select 1 from public.workout_sessions s where s.id = session_id and s.user_id = auth.uid()));

drop policy "sets_select_own" on public.workout_sets;
drop policy "sets_insert_own" on public.workout_sets;
drop policy "sets_update_own" on public.workout_sets;
drop policy "sets_delete_own" on public.workout_sets;

create policy "sets_select_own" on public.workout_sets for select to authenticated
  using (exists (
    select 1 from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()));
create policy "sets_insert_own" on public.workout_sets for insert to authenticated
  with check (exists (
    select 1 from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()));
create policy "sets_update_own" on public.workout_sets for update to authenticated
  using (exists (
    select 1 from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()))
  with check (exists (
    select 1 from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()));
create policy "sets_delete_own" on public.workout_sets for delete to authenticated
  using (exists (
    select 1 from public.session_exercises se
    join public.workout_sessions s on s.id = se.session_id
    where se.id = session_exercise_id and s.user_id = auth.uid()));

drop policy "meals_select_own" on public.meals;
drop policy "meals_insert_own" on public.meals;
drop policy "meals_update_own" on public.meals;
drop policy "meals_delete_own" on public.meals;

create policy "meals_select_own" on public.meals for select to authenticated
  using (exists (select 1 from public.nutrition_days d where d.id = nutrition_day_id and d.user_id = auth.uid()));
create policy "meals_insert_own" on public.meals for insert to authenticated
  with check (exists (select 1 from public.nutrition_days d where d.id = nutrition_day_id and d.user_id = auth.uid()));
create policy "meals_update_own" on public.meals for update to authenticated
  using (exists (select 1 from public.nutrition_days d where d.id = nutrition_day_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.nutrition_days d where d.id = nutrition_day_id and d.user_id = auth.uid()));
create policy "meals_delete_own" on public.meals for delete to authenticated
  using (exists (select 1 from public.nutrition_days d where d.id = nutrition_day_id and d.user_id = auth.uid()));

drop function if exists public.template_owner(uuid);
drop function if exists public.session_owner(uuid);
drop function if exists public.session_exercise_owner(uuid);
drop function if exists public.nutrition_day_owner(uuid);
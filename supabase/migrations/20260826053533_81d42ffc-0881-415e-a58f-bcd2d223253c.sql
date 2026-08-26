-- Replace the security-definer template helpers with inline ownership checks so
-- no extra callable function is exposed on the API surface. Behaviour is
-- identical: system templates are readable by any authenticated athlete and
-- writable by nobody; personal templates stay owner-scoped.

drop policy if exists "template_exercises_select_readable" on public.template_exercises;
drop policy if exists "template_exercises_insert_own" on public.template_exercises;
drop policy if exists "template_exercises_update_own" on public.template_exercises;
drop policy if exists "template_exercises_delete_own" on public.template_exercises;

create policy "template_exercises_select_readable" on public.template_exercises
  for select to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_exercises.template_id
      and (t.is_system or t.user_id = auth.uid())
  ));

create policy "template_exercises_insert_own" on public.template_exercises
  for insert to authenticated
  with check (exists (
    select 1 from public.workout_templates t
    where t.id = template_exercises.template_id
      and t.is_system = false and t.user_id = auth.uid()
  ));

create policy "template_exercises_update_own" on public.template_exercises
  for update to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_exercises.template_id
      and t.is_system = false and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.workout_templates t
    where t.id = template_exercises.template_id
      and t.is_system = false and t.user_id = auth.uid()
  ));

create policy "template_exercises_delete_own" on public.template_exercises
  for delete to authenticated
  using (exists (
    select 1 from public.workout_templates t
    where t.id = template_exercises.template_id
      and t.is_system = false and t.user_id = auth.uid()
  ));

drop function if exists public.template_readable(uuid);
drop function if exists public.template_writable(uuid);
drop function if exists public.template_owner(uuid);
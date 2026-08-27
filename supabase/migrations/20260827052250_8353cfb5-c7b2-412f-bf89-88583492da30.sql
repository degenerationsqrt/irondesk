create table if not exists public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  label text not null default 'Android phone',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists device_pairings_code_hash_key on public.device_pairings (code_hash);
create index if not exists device_pairings_user_idx on public.device_pairings (user_id, created_at desc);

grant select, insert, delete on public.device_pairings to authenticated;
grant all on public.device_pairings to service_role;
alter table public.device_pairings enable row level security;

drop policy if exists "device_pairings_select_own" on public.device_pairings;
create policy "device_pairings_select_own" on public.device_pairings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "device_pairings_insert_own" on public.device_pairings;
create policy "device_pairings_insert_own" on public.device_pairings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "device_pairings_delete_own" on public.device_pairings;
create policy "device_pairings_delete_own" on public.device_pairings
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.device_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data_source_id uuid references public.data_sources(id) on delete set null,
  label text not null,
  platform text not null default 'android',
  token_hash text not null,
  last_sync_at timestamptz,
  last_sync_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists device_links_token_hash_key on public.device_links (token_hash);
create index if not exists device_links_user_idx on public.device_links (user_id, created_at desc);

grant select, delete on public.device_links to authenticated;
grant all on public.device_links to service_role;
alter table public.device_links enable row level security;

drop policy if exists "device_links_select_own" on public.device_links;
create policy "device_links_select_own" on public.device_links
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "device_links_delete_own" on public.device_links;
create policy "device_links_delete_own" on public.device_links
  for delete to authenticated using (user_id = auth.uid());
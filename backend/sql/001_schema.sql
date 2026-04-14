-- PostgreSQL schema for Cat Game (Supabase)
-- Run in Supabase SQL editor

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  kitten_config jsonb not null default '{}'::jsonb,
  selected_parts jsonb not null default '{}'::jsonb,
  part_library jsonb not null default '{}'::jsonb,
  skin_parts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_cats_updated_at
before update on public.cats
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.cats enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "cats_select_own" on public.cats;
create policy "cats_select_own"
on public.cats
for select
using (auth.uid() = user_id);

drop policy if exists "cats_insert_own" on public.cats;
create policy "cats_insert_own"
on public.cats
for insert
with check (auth.uid() = user_id);

drop policy if exists "cats_update_own" on public.cats;
create policy "cats_update_own"
on public.cats
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

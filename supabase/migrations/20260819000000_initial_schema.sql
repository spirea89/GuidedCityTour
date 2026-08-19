-- GuidedCityTour shared cache (project: ifoybmzofjdgekvvrsot)
-- Run in Supabase SQL Editor or via: supabase db push

create extension if not exists "pgcrypto";

-- Verified tour / story payloads (one row per cache key)
create table if not exists public.place_research (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  place_id text,
  geohash text,
  lat numeric(10, 5),
  lng numeric(10, 5),
  name_normalized text,
  entity_type text,
  categories text[] default '{}',
  kids_mode boolean default false,
  verified_payload jsonb not null,
  sources jsonb default '[]'::jsonb,
  confidence numeric(4, 3),
  pipeline_version text not null,
  researched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists place_research_place_id_idx
  on public.place_research (place_id)
  where place_id is not null;

create index if not exists place_research_geo_idx
  on public.place_research (lat, lng);

create index if not exists place_research_expires_idx
  on public.place_research (expires_at);

-- Notable-place discovery for a map area (pins list)
create table if not exists public.area_locations (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  center_lat numeric(10, 5) not null,
  center_lng numeric(10, 5) not null,
  radius_meters integer not null,
  area_label text,
  places jsonb not null default '[]'::jsonb,
  pipeline_version text not null,
  model text,
  researched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists area_locations_geo_idx
  on public.area_locations (center_lat, center_lng);

create index if not exists area_locations_expires_idx
  on public.area_locations (expires_at);

-- Keep updated_at fresh on upsert
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists place_research_updated_at on public.place_research;
create trigger place_research_updated_at
  before update on public.place_research
  for each row execute function public.set_updated_at();

drop trigger if exists area_locations_updated_at on public.area_locations;
create trigger area_locations_updated_at
  before update on public.area_locations
  for each row execute function public.set_updated_at();

-- Row level security: public read of fresh rows; clients may upsert cache entries
alter table public.place_research enable row level security;
alter table public.area_locations enable row level security;

drop policy if exists "public_read_fresh_stories" on public.place_research;
create policy "public_read_fresh_stories"
  on public.place_research
  for select
  to anon, authenticated
  using (expires_at > now());

drop policy if exists "public_upsert_stories" on public.place_research;
create policy "public_upsert_stories"
  on public.place_research
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public_update_stories" on public.place_research;
create policy "public_update_stories"
  on public.place_research
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "public_read_fresh_areas" on public.area_locations;
create policy "public_read_fresh_areas"
  on public.area_locations
  for select
  to anon, authenticated
  using (expires_at > now());

drop policy if exists "public_upsert_areas" on public.area_locations;
create policy "public_upsert_areas"
  on public.area_locations
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public_update_areas" on public.area_locations;
create policy "public_update_areas"
  on public.area_locations
  for update
  to anon, authenticated
  using (true)
  with check (true);

-- Allow clients to delete rows that have already expired
drop policy if exists "public_delete_expired_stories" on public.place_research;
create policy "public_delete_expired_stories"
  on public.place_research
  for delete
  to anon, authenticated
  using (expires_at < now());

drop policy if exists "public_delete_expired_areas" on public.area_locations;
create policy "public_delete_expired_areas"
  on public.area_locations
  for delete
  to anon, authenticated
  using (expires_at < now());
